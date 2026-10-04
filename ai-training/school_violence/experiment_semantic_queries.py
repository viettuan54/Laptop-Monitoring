"""Compare frozen multilingual sentence embeddings with v8 on identical folds."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.metadata
import json
import math
import shutil
import time
from collections import Counter
from pathlib import Path

import numpy as np

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v7 import make_cv_folds, metrics_from_matrix
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT, BASE_V5_SHA256, CV_SEEDS, cross_validate, development_rows,
)
from .evaluate_real_world import check_independence
from .experiment_two_stage_queries import is_noninferior, mean_metrics
from .prepare_semantic_encoder import REPOSITORY, REVISION
from .semantic_query_model import ALGORITHM, FrozenSentenceEncoder, scores_from_embeddings
from .training import LABELS


MODEL_VERSION = "vi-school-violence-semantic-query-experiment-v2"
DATASET_VERSION = "school-violence-reviewed-query-development-v3"
EPOCHS = 1000
# Fixed before inspecting semantic predictions; no post-hoc threshold search.
CONFIGURATIONS = tuple((penalty, safe, high)
                       for penalty in (0.0001, 0.001)
                       for safe in (1.0, 1.5)
                       for high in (1.0, 2.0, 3.0, 4.0))


def fit_head(embeddings: np.ndarray, labels: list[str], configuration: tuple[float, float, float]) -> dict:
    x = np.asarray(embeddings, dtype=np.float64)
    if x.ndim != 2 or len(x) != len(labels) or not np.isfinite(x).all():
        raise ValueError("Invalid training embeddings")
    if set(labels) != set(LABELS):
        raise ValueError("Semantic head training needs all three labels")
    penalty, safe_weight, high_weight = configuration
    if penalty <= 0 or safe_weight <= 0 or high_weight <= 0:
        raise ValueError("Penalty and class weights must be positive")
    # Both transforms are fitted strictly on this training fold.
    mean = x.mean(axis=0)
    scale = np.maximum(x.std(axis=0), 1e-6)
    x = (x - mean) / scale / math.sqrt(x.shape[1])
    actual = np.array([LABELS.index(label) for label in labels])
    sample_weights = np.asarray((safe_weight, 1.0, high_weight))[actual]
    targets = np.eye(len(LABELS))[actual]
    weights = np.zeros((x.shape[1], len(LABELS)), dtype=np.float64)
    bias = np.zeros(len(LABELS), dtype=np.float64)
    for epoch in range(EPOCHS):
        logits = x @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        scores = np.exp(logits)
        scores /= scores.sum(axis=1, keepdims=True)
        residual = (scores - targets) * (sample_weights / sample_weights.sum())[:, None]
        rate = 10.0 / (1 + epoch / 100)
        weights -= rate * (x.T @ residual + penalty * weights)
        bias -= rate * residual.sum(axis=0)
    return {"algorithm": ALGORITHM, "labels": list(LABELS), "head": {
        "mean": mean.tolist(), "scale": scale.tolist(),
        "weights": weights.tolist(), "bias": bias.tolist(),
    }}


def qualifies(candidate: dict, baseline: dict) -> bool:
    return is_noninferior(candidate, baseline) and (
        candidate["safe_alerts"] < baseline["safe_alerts"]
        or candidate["risk_to_high"] < baseline["risk_to_high"])


def compare_folds(rows: list[dict], embeddings: np.ndarray, folds: list[list[int]],
                  group_count: int, seed: int, configuration: tuple[float, float, float]) -> dict:
    matrix = {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
    errors = []
    predictions = []
    for fold in folds:
        held = set(fold)
        train = [index for index in range(len(rows)) if index not in held]
        model = fit_head(embeddings[train], [rows[index]["label"] for index in train], configuration)
        labels = np.argmax(scores_from_embeddings(model, embeddings[fold]), axis=1)
        for index, label_index in zip(fold, labels):
            row = rows[index]
            predicted = LABELS[label_index]
            matrix[row["label"]][predicted] += 1
            prediction = {"id": row["id"], "label": row["label"], "predicted": predicted}
            predictions.append(prediction)
            if predicted != row["label"]:
                errors.append(prediction)
    return {**metrics_from_matrix(matrix), "seed": seed, "fold_count": len(folds),
            "near_duplicate_group_count": group_count, "errors_by_id": errors,
            "predictions_by_id": predictions}


def run_experiment(base_dir: Path, review2: Path, review3: Path, legacy: Path,
                   provenance: Path, encoder_dir: Path, output_dir: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization for reviewed queries is required")
    output = output_dir.resolve()
    if not output.is_relative_to(ARTIFACT_ROOT.resolve()) or output == ARTIFACT_ROOT.resolve():
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if sha256(base_dir / "model.json.gz") != BASE_V5_SHA256:
        raise ValueError("Unexpected v5 reference artifact")
    rows = development_rows(review2, review3, legacy, provenance)
    independence = check_independence(rows, base_dir)
    encoder = FrozenSentenceEncoder(encoder_dir)
    if encoder.manifest["repository"] != REPOSITORY or encoder.manifest["revision"] != REVISION:
        raise ValueError("Encoder does not match the predeclared experiment")
    lengths = encoder.token_lengths([row["text"] for row in rows])
    started = time.perf_counter()
    # A fixed, externally pretrained encoder sees no project labels and fits no
    # parameters here, so precomputing embeddings does not fit held-out data.
    embeddings = encoder.encode([row["text"] for row in rows])
    encoding_seconds = time.perf_counter() - started
    print(json.dumps({"encoded_rows": len(rows), "dimension": embeddings.shape[1],
                      "encoding_seconds": encoding_seconds,
                      "truncated_rows": sum(n > encoder.manifest["max_sequence_length"] for n in lengths)}), flush=True)
    baseline_results = [cross_validate(rows, seed=seed) for seed in CV_SEEDS]
    baseline = mean_metrics(baseline_results)
    shared_folds = {seed: make_cv_folds(rows, seed=seed) for seed in CV_SEEDS}
    variants = []
    for configuration in CONFIGURATIONS:
        results = [compare_folds(rows, embeddings, *shared_folds[seed], seed, configuration)
                   for seed in CV_SEEDS]
        metrics = mean_metrics(results)
        variants.append({"configuration": list(configuration), "mean": metrics,
                         "qualifies_over_v8": qualifies(metrics, baseline), "by_seed": results})
        print(json.dumps({"configuration": configuration, "mean": metrics,
                          "qualifies_over_v8": qualifies(metrics, baseline)}), flush=True)
    qualified = [variant for variant in variants if variant["qualifies_over_v8"]]
    selected = max(qualified or variants, key=lambda variant:
                   (variant["mean"]["macro_f1"], variant["mean"]["high_risk_correct"]))
    model = fit_head(embeddings, [row["label"] for row in rows], tuple(selected["configuration"]))
    source_audit = {
        "review_sha256": {"DuLieuThat1": sha256(legacy), "DuLieuThat2": sha256(review2),
                          "DuLieuThat3": sha256(review3)},
        "legacy_provenance_sha256": sha256(provenance),
        "encoder_manifest_sha256": sha256(encoder_dir / "encoder_manifest.json"),
        "encoder_repository": REPOSITORY, "encoder_revision": REVISION,
        "code_sha256": {name: sha256(Path(__file__).parent / name) for name in (
            "experiment_semantic_queries.py", "semantic_query_model.py",
            "prepare_semantic_encoder.py", "adapt_reviewed_queries_v7.py", "adapt_reviewed_queries_v8.py")},
        "packages": {name: importlib.metadata.version(name) for name in (
            "numpy", "onnxruntime", "tokenizers")},
        "input_columns": ["text"], "frozen_encoder": True, "epochs": EPOCHS,
        "encoder_batch_size": 1,
        "configuration": selected["configuration"],
        "preprocessing": "NFKC whitespace; masked mean pooling; L2; train-fold mean/std",
    }
    fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True,
        separators=(",", ":")).encode()).hexdigest()
    model.update(model_version=MODEL_VERSION, dataset_version=DATASET_VERSION,
                 combined_dataset_sha256=fingerprint, training_configuration=source_audit,
                 encoder={"directory": "encoder", "manifest_sha256": source_audit["encoder_manifest_sha256"]},
                 deployment_eligible=False)
    report = {
        "model_version": MODEL_VERSION, "source_audit": source_audit,
        "combined_dataset_sha256": fingerprint, "development_rows": len(rows),
        "development_label_counts": dict(Counter(row["label"] for row in rows)),
        "seeds": list(CV_SEEDS), "folds_by_seed": {str(seed):
            [[rows[index]["id"] for index in fold] for fold in folds]
            for seed, (folds, _) in shared_folds.items()},
        "baseline_v8": {"mean": baseline, "by_seed": baseline_results},
        "variants": variants, "selected_configuration": selected["configuration"],
        "selected_mean": selected["mean"], "preferred_over_v8": bool(qualified),
        "qualified_configuration_count": len(qualified), "reference_independence": independence,
        "encoding": {"seconds": encoding_seconds, "dimension": embeddings.shape[1],
                     "max_token_length": max(lengths), "truncated_rows": sum(
                         n > encoder.manifest["max_sequence_length"] for n in lengths)},
        "operator_asserted_training_authorization": True, "permission_verified_by_code": False,
        "deployment_eligible": False,
        "next_stage": "runtime_and_alert_flow_checks" if qualified else "not_selected_against_v8",
        "limitations": [
            "All 192 rows and all configuration comparisons are development data, not an independent final test.",
            "Configuration selection on these folds makes performance estimates optimistic.",
            "Frozen multilingual embeddings do not guarantee victim/witness or coercion interpretation.",
            "No child/session grouping or complete semantic duplicate audit is available.",
            "DuLieuThat3:55 retains the user label; the coercion context is unresolved.",
            "Joint softmax scores are not calibrated probabilities of correctness.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(encoder_dir, output / "encoder")
    np.savez_compressed(output / "development_embeddings.npz", embeddings=embeddings,
                        ids=np.asarray([row["id"] for row in rows]))
    with (output / "train.jsonl").open("x", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps({**row, "source_ids": [row["id"]], "group_ids": [],
                "split": "train", "source": "user_reviewed_query", "review_status": "user_labeled"},
                ensure_ascii=False) + "\n")
    for split in ("validation", "test"):
        shutil.copyfile(base_dir / f"{split}.jsonl", output / f"{split}.jsonl")
    with (output / "model.json.gz").open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(json.dumps(model, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8"))
    report["model_sha256"] = sha256(output / "model.json.gz")
    (output / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "training_config.json").write_text(
        json.dumps(source_audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model_version": MODEL_VERSION, "selected_mean": selected["mean"],
                      "preferred_over_v8": bool(qualified), "deployment_eligible": False}), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base-artifact", "review2", "review3", "legacy-review", "provenance", "encoder-dir", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run_experiment(args.base_artifact, args.review2, args.review3, args.legacy_review,
                   args.provenance, args.encoder_dir, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
