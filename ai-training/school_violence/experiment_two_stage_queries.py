"""Try a two-stage query classifier on the frozen v8 development benchmark.

Each head learns its vocabulary and IDF only from its training fold. All
comparisons are development estimates; no result authorizes deployment.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
from collections import Counter
from pathlib import Path
from statistics import mean

import numpy as np

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v7 import make_cv_folds, metrics_from_matrix
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT, BASE_V5_SHA256, CV_SEEDS, EPOCHS,
    MIN_DOCUMENT_FREQUENCY, PENALTY, _vectorize, cross_validate, development_rows,
)
from .evaluate_real_world import check_independence
from .linear_query_model import word_features
from .two_stage_query_model import ALGORITHM, predict_scores_two_stage, select_two_stage_label
from .training import LABELS, evaluate


MODEL_VERSION = "vi-school-violence-two-stage-query-experiment-v1"
DATASET_VERSION = "school-violence-reviewed-query-development-v3"
# Bounded development comparison; thresholds are fixed before running.
CONFIGURATIONS = (
    (1.5, 1.0, 2.0), (1.5, 1.0, 3.0),
    (2.0, 1.0, 2.0), (2.0, 1.0, 3.0),
    (1.5, 1.5, 3.0), (2.0, 1.5, 3.0),
)
DECISION_RULES = ("joint_argmax", "hard_route")


def fit_head(rows: list[dict], labels: tuple[str, str],
             class_weights: tuple[float, float]) -> dict:
    if {row["label"] for row in rows} != set(labels):
        raise ValueError("Each binary head needs both classes")
    counts = Counter(feature for row in rows for feature in word_features(row["text"]))
    features = {
        feature: [math.log((1 + len(rows)) / (1 + counts[feature])) + 1]
        for feature in sorted(counts) if counts[feature] >= MIN_DOCUMENT_FREQUENCY
    }
    if not features:
        raise ValueError("No shared features for binary head")
    matrix = _vectorize(rows, features)
    actual = np.array([labels.index(row["label"]) for row in rows])
    sample_weights = np.asarray(class_weights)[actual]
    targets = np.eye(2)[actual]
    weights = np.zeros((len(features), 2), dtype=np.float64)
    bias = np.zeros(2, dtype=np.float64)
    for epoch in range(EPOCHS):
        logits = matrix @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        residual = (probabilities - targets) * (sample_weights / sample_weights.sum())[:, None]
        rate = 5.0 / (1 + epoch / 30)
        weights -= rate * (matrix.T @ residual + PENALTY * weights)
        bias -= rate * residual.sum(axis=0)
    for index, feature in enumerate(features):
        features[feature].extend(map(float, weights[index]))
    return {
        "labels": list(labels), "features": features, "bias": list(map(float, bias)),
        "fallback_prior": {label: sum(row["label"] == label for row in rows) / len(rows)
                           for label in labels},
    }


def fit_two_stage(rows: list[dict], configuration: tuple[float, float, float],
                  *, decision_rule: str = "joint_argmax") -> dict:
    if {row["label"] for row in rows} != set(LABELS):
        raise ValueError("Two-stage training needs all three labels")
    if decision_rule not in DECISION_RULES:
        raise ValueError("Unknown decision rule")
    safe_weight, alert_weight, high_weight = configuration
    gate_rows = [{**row, "label": "SAFE" if row["label"] == "SAFE" else "ALERT"}
                 for row in rows]
    severity_rows = [row for row in rows if row["label"] != "SAFE"]
    return {
        "algorithm": ALGORITHM,
        "labels": list(LABELS),
        "heads": {
            "gate": fit_head(gate_rows, ("SAFE", "ALERT"), (safe_weight, alert_weight)),
            "severity": fit_head(severity_rows, ("RISK", "HIGH_RISK"), (1.0, high_weight)),
        },
        "decision_rule": decision_rule,
        "gate_threshold": 0.5,
        "severity_threshold": 0.5,
    }


def compare_fold(rows: list[dict], seed: int,
                 configuration: tuple[float, float, float]) -> dict[str, dict]:
    folds, groups = make_cv_folds(rows, seed=seed)
    matrices = {rule: {a: {b: 0 for b in LABELS} for a in LABELS}
                for rule in DECISION_RULES}
    errors = {rule: [] for rule in DECISION_RULES}
    gate_misses = {rule: [] for rule in DECISION_RULES}
    for fold in folds:
        held = set(fold)
        model = fit_two_stage([row for index, row in enumerate(rows) if index not in held],
                              configuration)
        for index in fold:
            row = rows[index]
            scores = predict_scores_two_stage(model, row["text"])
            for rule in DECISION_RULES:
                model["decision_rule"] = rule
                predicted = select_two_stage_label(model, scores)
                matrices[rule][row["label"]][predicted] += 1
                if predicted != row["label"]:
                    errors[rule].append({"id": row["id"], "label": row["label"],
                                         "predicted": predicted})
                if row["label"] == "HIGH_RISK" and predicted == "SAFE":
                    gate_misses[rule].append(row["id"])
    return {
        rule: {**metrics_from_matrix(matrices[rule]), "seed": seed,
               "fold_count": len(folds), "near_duplicate_group_count": groups,
               "errors_by_id": errors[rule], "high_risk_to_safe_ids": gate_misses[rule]}
        for rule in DECISION_RULES
    }


def mean_metrics(results: list[dict]) -> dict:
    return {
        "macro_f1": mean(result["macro_f1"] for result in results),
        "high_risk_correct": mean(result["confusion_matrix"]["HIGH_RISK"]["HIGH_RISK"]
                                  for result in results),
        "high_risk_to_safe": mean(result["confusion_matrix"]["HIGH_RISK"]["SAFE"]
                                  for result in results),
        "safe_alerts": mean(sum(result["confusion_matrix"]["SAFE"][label]
                                for label in ("RISK", "HIGH_RISK")) for result in results),
        "risk_to_high": mean(result["confusion_matrix"]["RISK"]["HIGH_RISK"]
                             for result in results),
    }


def is_noninferior(candidate: dict, baseline: dict) -> bool:
    return (candidate["high_risk_correct"] >= baseline["high_risk_correct"]
            and candidate["high_risk_to_safe"] <= baseline["high_risk_to_safe"]
            and candidate["safe_alerts"] <= baseline["safe_alerts"]
            and candidate["risk_to_high"] <= baseline["risk_to_high"]
            and candidate["macro_f1"] >= baseline["macro_f1"])


def run_experiment(base_dir: Path, review2: Path, review3: Path, legacy: Path,
                   provenance: Path, output_dir: Path, *, authorized: bool) -> dict:
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
    baseline_results = [cross_validate(rows, seed=seed) for seed in CV_SEEDS]
    baseline = mean_metrics(baseline_results)
    candidates = []
    for configuration in CONFIGURATIONS:
        seed_results = [compare_fold(rows, seed, configuration) for seed in CV_SEEDS]
        for rule in DECISION_RULES:
            results = [result[rule] for result in seed_results]
            metrics = mean_metrics(results)
            candidates.append({
                "configuration": list(configuration), "decision_rule": rule,
                "mean": metrics, "noninferior_to_v8": is_noninferior(metrics, baseline),
                "by_seed": results,
            })
        print(json.dumps({"configuration": configuration,
                          "means": {rule: mean_metrics([result[rule] for result in seed_results])
                                    for rule in DECISION_RULES}}), flush=True)
    qualified = [candidate for candidate in candidates if candidate["noninferior_to_v8"]]
    # Save a reviewable experimental artifact even if no candidate qualifies.
    selected = max(qualified or candidates,
                   key=lambda candidate: (candidate["mean"]["macro_f1"],
                                          candidate["mean"]["high_risk_correct"]))
    model = fit_two_stage(rows, tuple(selected["configuration"]),
                          decision_rule=selected["decision_rule"])
    audit = {
        "review_sha256": {"DuLieuThat1": sha256(legacy), "DuLieuThat2": sha256(review2),
                          "DuLieuThat3": sha256(review3)},
        "legacy_provenance_sha256": sha256(provenance),
        "input_columns": ["text"], "min_df": MIN_DOCUMENT_FREQUENCY,
        "penalty": PENALTY, "epochs": EPOCHS,
        "configuration": selected["configuration"], "decision_rule": selected["decision_rule"],
        "gate_threshold": 0.5, "severity_threshold": 0.5,
    }
    fingerprint = hashlib.sha256(json.dumps(audit, sort_keys=True,
        separators=(",", ":")).encode("utf-8")).hexdigest()
    model.update(model_version=MODEL_VERSION, dataset_version=DATASET_VERSION,
                 combined_dataset_sha256=fingerprint, training_configuration=audit,
                 deployment_eligible=False)
    report = {
        "model_version": MODEL_VERSION,
        "source_audit": {"combined_dataset_sha256": fingerprint, **audit},
        "development_rows": len(rows),
        "development_label_counts": dict(Counter(row["label"] for row in rows)),
        "seeds": list(CV_SEEDS), "baseline_v8": {"mean": baseline, "by_seed": baseline_results},
        "variants": candidates, "selected_configuration": selected["configuration"],
        "selected_decision_rule": selected["decision_rule"], "selected_mean": selected["mean"],
        "preferred_over_v8": bool(qualified), "reference_independence": independence,
        "development_training_fit": evaluate(model, rows),
        "operator_asserted_training_authorization": True,
        "permission_verified_by_code": False,
        "deployment_eligible": False,
        "limitations": [
            "All 192 reviewed queries and all configuration comparisons are development data.",
            "Selecting architecture, class weights or decision rules on these folds makes metrics optimistic.",
            "A SAFE decision at the first stage may discard a genuine HIGH_RISK query.",
            "There is no independent final holdout or verified child/session grouping.",
            "ID 55 retains the user label despite unresolved coercion context at the start of the experiment.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
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
    (output / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "training_config.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model_version": MODEL_VERSION, "selected_mean": selected["mean"],
                      "preferred_over_v8": bool(qualified), "deployment_eligible": False}), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-artifact", required=True, type=Path)
    parser.add_argument("--review2", required=True, type=Path)
    parser.add_argument("--review3", required=True, type=Path)
    parser.add_argument("--legacy-review", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run_experiment(args.base_artifact, args.review2, args.review3, args.legacy_review,
                   args.provenance, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
