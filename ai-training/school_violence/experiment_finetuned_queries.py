"""Partially fine-tune MiniLM on the existing reviewed-query development folds."""

from __future__ import annotations

import argparse
import gc
import gzip
import hashlib
import importlib.metadata
import json
import shutil
import time
from collections import Counter
from pathlib import Path

import numpy as np

from .adapt_reviewed_queries_v7 import make_cv_folds, metrics_from_matrix
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT, BASE_V5_SHA256, CV_SEEDS, cross_validate, development_rows,
)
from .evaluate_real_world import check_independence
from .experiment_semantic_queries import fit_head, qualifies
from .experiment_two_stage_queries import mean_metrics
from .finetuned_query_model import (
    ALGORITHM, FrozenPrefix, build_tail_classifier, pad_records, tail_scores,
)
from .prepare_finetune_encoder import file_sha256
from .prepare_semantic_encoder import REPOSITORY, REVISION
from .training import LABELS


MODEL_VERSION = "vi-school-violence-partial-minilm-query-experiment-v1"
EPOCHS = 4
BATCH_SIZE = 4
HEAD_LEARNING_RATE = 0.0001
CONFIGURATIONS = ((0.00001, 3.0), (0.00003, 3.0), (0.00001, 5.0), (0.00003, 5.0))


def fit_tail(config_dict: dict, initial_tail: dict, records: list[dict],
             embeddings: np.ndarray, labels: list[str], configuration: tuple[float, float],
             *, seed: int):
    import torch

    if len(records) != len(labels) or len(records) != len(embeddings) or set(labels) != set(LABELS):
        raise ValueError("Fine-tuning needs aligned records and all three labels")
    torch.manual_seed(seed)
    encoder_rate, high_weight = configuration
    if encoder_rate <= 0 or high_weight <= 0:
        raise ValueError("Learning rate and class weight must be positive")
    warm = fit_head(embeddings, labels, (0.001, 1.5, high_weight))["head"]
    model = build_tail_classifier(config_dict, initial_tail)
    with torch.no_grad():
        model.mean.copy_(torch.tensor(warm["mean"], dtype=torch.float32))
        model.scale.copy_(torch.tensor(warm["scale"], dtype=torch.float32))
        model.classifier.weight.copy_(torch.tensor(warm["weights"], dtype=torch.float32).T)
        model.classifier.bias.copy_(torch.tensor(warm["bias"], dtype=torch.float32))
    optimizer = torch.optim.AdamW([
        {"params": model.layers.parameters(), "lr": encoder_rate, "weight_decay": 0.01},
        {"params": model.classifier.parameters(), "lr": HEAD_LEARNING_RATE, "weight_decay": 0.001},
    ])
    targets = torch.tensor([LABELS.index(label) for label in labels], dtype=torch.long)
    class_weights = torch.tensor([1.5, 1.0, high_weight])
    normalizer = class_weights[targets].mean()
    generator = torch.Generator().manual_seed(seed)
    model.train()
    for _ in range(EPOCHS):
        order = torch.randperm(len(records), generator=generator).tolist()
        for start in range(0, len(order), BATCH_SIZE):
            indexes = order[start:start + BATCH_SIZE]
            logits = model(*pad_records([records[index] for index in indexes]))
            actual = targets[indexes]
            losses = torch.nn.functional.cross_entropy(logits, actual, reduction="none")
            loss = (losses * class_weights[actual]).mean() / normalizer
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
    model.eval()
    return model


def evaluate_seed(rows: list[dict], records: list[dict], embeddings: np.ndarray,
                  config_dict: dict, initial_tail: dict, configuration: tuple[float, float],
                  seed: int, folds: list[list[int]], groups: int) -> dict:
    matrix = {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
    predictions = []
    for fold_index, fold in enumerate(folds):
        held = set(fold)
        train = [index for index in range(len(rows)) if index not in held]
        model = fit_tail(config_dict, initial_tail, [records[index] for index in train],
                         embeddings[train], [rows[index]["label"] for index in train],
                         configuration, seed=seed * 10 + fold_index)
        scores = tail_scores(model, [records[index] for index in fold])
        for index, label_index in zip(fold, np.argmax(scores, axis=1)):
            row = rows[index]
            predicted = LABELS[label_index]
            matrix[row["label"]][predicted] += 1
            predictions.append({"id": row["id"], "label": row["label"], "predicted": predicted})
        del model
        gc.collect()
    return {**metrics_from_matrix(matrix), "seed": seed, "fold_count": len(folds),
            "near_duplicate_group_count": groups, "predictions_by_id": predictions,
            "errors_by_id": [row for row in predictions if row["label"] != row["predicted"]]}


def run_experiment(base_dir: Path, review2: Path, review3: Path, legacy: Path,
                   provenance: Path, encoder_dir: Path, output_dir: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization for reviewed queries is required")
    output = output_dir.resolve()
    if not output.is_relative_to(ARTIFACT_ROOT.resolve()) or output == ARTIFACT_ROOT.resolve():
        raise ValueError("Output must stay inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if file_sha256(base_dir / "model.json.gz") != BASE_V5_SHA256:
        raise ValueError("Unexpected v5 reference artifact")
    rows = development_rows(review2, review3, legacy, provenance)
    independence = check_independence(rows, base_dir)
    import torch
    import psutil
    from safetensors.torch import save_file

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    started = time.perf_counter()
    prefix = FrozenPrefix(encoder_dir)
    if prefix.manifest["repository"] != REPOSITORY or prefix.manifest["revision"] != REVISION:
        raise ValueError("Unexpected encoder revision")
    records = [prefix.encode_prefix(row["text"]) for row in rows]
    config_dict, initial_tail = prefix.config_dict, prefix.initial_tail
    initial_model = build_tail_classifier(config_dict, initial_tail)
    initial_model.eval()
    with torch.inference_mode():
        embeddings = np.vstack([initial_model.embeddings(*pad_records([record]))[0].numpy()
                                for record in records])
    parameter_count = sum(parameter.numel() for parameter in initial_model.parameters())
    del initial_model, prefix
    gc.collect()
    prefix_seconds = time.perf_counter() - started
    print(json.dumps({"stage": "frozen_prefix_cache", "rows": len(rows),
                      "trainable_parameters": parameter_count, "seconds": prefix_seconds,
                      "rss_mb": psutil.Process().memory_info().rss / 1024**2}), flush=True)
    baseline_results = [cross_validate(rows, seed=seed) for seed in CV_SEEDS]
    baseline = mean_metrics(baseline_results)
    folds_by_seed = {seed: make_cv_folds(rows, seed=seed) for seed in CV_SEEDS}
    output.mkdir(parents=True, exist_ok=True)
    variants = []
    for configuration in CONFIGURATIONS:
        results = []
        for seed in CV_SEEDS:
            started_seed = time.perf_counter()
            result = evaluate_seed(rows, records, embeddings, config_dict, initial_tail,
                                   configuration, seed, *folds_by_seed[seed])
            results.append(result)
            print(json.dumps({"configuration": configuration, "seed": seed,
                              "mean": mean_metrics([result]),
                              "seconds": time.perf_counter() - started_seed}), flush=True)
            (output / "progress.json").write_text(json.dumps({
                "completed_variants": variants, "active_configuration": configuration,
                "completed_seeds": results, "deployment_eligible": False,
            }, indent=2) + "\n", encoding="utf-8")
        metrics = mean_metrics(results)
        variants.append({"configuration": list(configuration), "mean": metrics,
                         "qualifies_over_v8": qualifies(metrics, baseline), "by_seed": results})
    qualified = [variant for variant in variants if variant["qualifies_over_v8"]]
    selected = max(qualified or variants, key=lambda variant:
                   (variant["mean"]["macro_f1"], variant["mean"]["high_risk_correct"]))
    final = fit_tail(config_dict, initial_tail, records, embeddings,
                     [row["label"] for row in rows], tuple(selected["configuration"]), seed=20261004)
    save_file({name: value.detach().contiguous() for name, value in final.state_dict().items()},
              str(output / "adapted_tail.safetensors"))
    tail_sha256 = file_sha256(output / "adapted_tail.safetensors")
    source_audit = {
        "review_sha256": {"DuLieuThat1": file_sha256(legacy), "DuLieuThat2": file_sha256(review2),
                          "DuLieuThat3": file_sha256(review3)},
        "legacy_provenance_sha256": file_sha256(provenance),
        "base_manifest_sha256": file_sha256(encoder_dir / "base_manifest.json"),
        "encoder_repository": REPOSITORY, "encoder_revision": REVISION,
        "code_sha256": {name: file_sha256(Path(__file__).parent / name) for name in (
            "experiment_finetuned_queries.py", "finetuned_query_model.py", "prepare_finetune_encoder.py")},
        "packages": {name: importlib.metadata.version(name) for name in (
            "numpy", "torch", "transformers", "safetensors", "tokenizers")},
        "input_columns": ["text"], "frozen_prefix_layers": 10, "fine_tuned_tail_layers": 2,
        "epochs": EPOCHS, "batch_size": BATCH_SIZE, "head_learning_rate": HEAD_LEARNING_RATE,
        "configuration": selected["configuration"], "safe_weight": 1.5,
        "warm_head_l2": 0.001, "optimizer": "AdamW", "gradient_clip": 1.0,
        "checkpoint_selection": "fixed_epoch_count; no outer-fold early stopping",
    }
    fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True,
        separators=(",", ":")).encode()).hexdigest()
    metadata = {
        "algorithm": ALGORITHM, "labels": list(LABELS), "model_version": MODEL_VERSION,
        "dataset_version": "school-violence-reviewed-query-development-v3",
        "combined_dataset_sha256": fingerprint, "training_configuration": source_audit,
        "encoder": {"directory": "encoder", "manifest_sha256": source_audit["base_manifest_sha256"]},
        "tail_file": "adapted_tail.safetensors", "tail_sha256": tail_sha256,
        "deployment_eligible": False,
    }
    shutil.copytree(encoder_dir, output / "encoder")
    with (output / "model.json.gz").open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode())
    for split in ("validation", "test"):
        shutil.copyfile(base_dir / f"{split}.jsonl", output / f"{split}.jsonl")
    with (output / "train.jsonl").open("x", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps({**row, "source_ids": [row["id"]], "group_ids": [],
                "split": "train", "source": "user_reviewed_query", "review_status": "user_labeled"},
                ensure_ascii=False) + "\n")
    np.savez_compressed(output / "development_prefix.npz", **{
        key: value for index, record in enumerate(records)
        for key, value in ((f"hidden_{index}", record["hidden"]), (f"mask_{index}", record["mask"]))})
    final_scores = tail_scores(final, records)
    report = {
        "model_version": MODEL_VERSION, "source_audit": source_audit,
        "combined_dataset_sha256": fingerprint, "model_sha256": file_sha256(output / "model.json.gz"),
        "tail_sha256": tail_sha256, "development_rows": len(rows),
        "development_label_counts": dict(Counter(row["label"] for row in rows)),
        "seeds": list(CV_SEEDS), "baseline_v8": {"mean": baseline, "by_seed": baseline_results},
        "folds_by_seed": {str(seed): [[rows[index]["id"] for index in fold] for fold in folds]
                          for seed, (folds, _) in folds_by_seed.items()},
        "variants": variants, "selected_configuration": selected["configuration"],
        "selected_mean": selected["mean"], "preferred_over_v8": bool(qualified),
        "qualified_configuration_count": len(qualified), "reference_independence": independence,
        "trainable_parameters": parameter_count, "prefix_preparation_seconds": prefix_seconds,
        "final_training_predictions_by_id": [
            {"id": row["id"], "predicted": LABELS[index]} for row, index in zip(rows, np.argmax(final_scores, axis=1))],
        "operator_asserted_training_authorization": True, "permission_verified_by_code": False,
        "deployment_eligible": False,
        "next_stage": "runtime_and_alert_flow_checks" if qualified else "not_selected_against_v8",
        "limitations": [
            "All 192 queries and all configuration selections are development data, not an independent final test.",
            "Only the last two encoder layers are fine-tuned; the embedding table and first ten layers stay frozen.",
            "The frozen prefix cache sees no project labels and fits no parameters on held-out rows.",
            "The warm classifier, normalization, encoder-tail updates and label weights fit only training rows per fold.",
            "No child/session grouping or complete semantic duplicate detection is available.",
            "DuLieuThat3:55 retains the user label with unresolved coercion context.",
            "Softmax confidence has not been calibrated as probability of correctness.",
        ],
    }
    (output / "evaluation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "training_config.json").write_text(json.dumps(source_audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model_version": MODEL_VERSION, "selected_mean": selected["mean"],
                      "preferred_over_v8": bool(qualified), "deployment_eligible": False}), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base-artifact", "review2", "review3", "legacy-review", "provenance", "encoder-dir", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run_experiment(args.base_artifact, args.review2, args.review3, args.legacy_review,
                   args.provenance, args.encoder_dir, args.output_dir, authorized=args.authorized)
