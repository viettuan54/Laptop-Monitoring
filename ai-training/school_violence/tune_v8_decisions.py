"""One bounded nested-CV adjustment of v8 weights and decision boundaries.

Outer queries never participate in vocabulary, weight or boundary selection.
This remains a development estimate because these sources informed earlier work.
Search text and trained features stay in ignored local artifacts.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import math
import shutil
from collections import Counter
from pathlib import Path

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v7 import make_cv_folds, metrics_from_matrix
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT, BASE_V5_SHA256, CV_SEEDS, development_rows, fit_linear,
)
from .analyze_v8_error_stability import V8_MODEL_SHA256, summarize_errors
from .experiment_two_stage_queries import is_noninferior, mean_metrics
from .linear_query_model import predict_scores_linear
from .predict import load_model
from .training import LABELS


WEIGHTS = ((1.5, 3.0), (2.0, 3.0), (2.0, 4.0))
BOUNDARIES = tuple((safe, high) for safe in (1.0, 1.15, 1.3)
                   for high in (0.9, 1.0, 1.1))
BASE_CONFIGURATION = (1.5, 3.0, 1.0, 1.0)
FINAL_SELECTION_SEED = 20261007
MODEL_VERSION = "vi-school-violence-word-linear-v9-nested-query-candidate"


def matrix_for(rows: list[dict], scores: list[dict], safe: float, high: float) -> dict:
    matrix = {a: {b: 0 for b in LABELS} for a in LABELS}
    multipliers = dict(zip(LABELS, (safe, 1.0, high)))
    for row, values in zip(rows, scores, strict=True):
        label = max(LABELS, key=lambda key: values[key] * multipliers[key])
        matrix[row["label"]][label] += 1
    return metrics_from_matrix(matrix)


def qualifies(candidate: dict, baseline: dict) -> bool:
    return is_noninferior(candidate, baseline) and (
        candidate["safe_alerts"] < baseline["safe_alerts"]
        or candidate["risk_to_high"] < baseline["risk_to_high"])


def choose_inner(rows: list[dict], *, seed: int) -> dict:
    """Choose only from grouped out-of-fold scores within the training rows."""
    folds, groups = make_cv_folds(rows, seed=seed)
    options = []
    for safe_weight, high_weight in WEIGHTS:
        scores = [None] * len(rows)
        for fold in folds:
            held = set(fold)
            model = fit_linear([row for i, row in enumerate(rows) if i not in held],
                               safe_weight=safe_weight, high_weight=high_weight)
            for index in fold:
                scores[index] = predict_scores_linear(model, rows[index]["text"])
        for safe, high in BOUNDARIES:
            metrics = mean_metrics([matrix_for(rows, scores, safe, high)])
            options.append({"configuration": [safe_weight, high_weight, safe, high],
                            "mean": metrics})
    baseline = next(option for option in options
                    if tuple(option["configuration"]) == BASE_CONFIGURATION)
    accepted = [option for option in options
                if qualifies(option["mean"], baseline["mean"])]
    selected = min(accepted, key=lambda option: (
        option["mean"]["safe_alerts"] + option["mean"]["risk_to_high"],
        -option["mean"]["macro_f1"], option["configuration"],
    )) if accepted else baseline
    return {"seed": seed, "groups": groups, "rows": len(rows),
            "selection_row_ids": [row["id"] for row in rows],
            "fold_ids": [[rows[i]["id"] for i in fold] for fold in folds],
            "selected_configuration": selected["configuration"],
            "selected_mean": selected["mean"], "baseline_mean": baseline["mean"],
            "accepted_option_count": len(accepted), "options": options}


def adjust_boundaries(model: dict, safe: float, high: float) -> dict:
    """Store log-score shifts in the existing portable v8 artifact format."""
    if any(not math.isfinite(value) or value <= 0 for value in (safe, high)):
        raise ValueError("Decision multipliers must be finite and positive")
    adjusted = copy.deepcopy(model)
    factors = (safe, 1.0, high)
    adjusted["bias"] = [value + math.log(factor)
                        for value, factor in zip(model["bias"], factors, strict=True)]
    prior = {label: model["fallback_prior"][label] * factor
             for label, factor in zip(LABELS, factors)}
    total = sum(prior.values())
    adjusted["fallback_prior"] = {label: value / total for label, value in prior.items()}
    return adjusted


def nested_compare(rows: list[dict], *, seed: int) -> dict:
    folds, groups = make_cv_folds(rows, seed=seed)
    matrices = {name: {a: {b: 0 for b in LABELS} for a in LABELS}
                for name in ("baseline", "tuned")}
    predictions = {name: [] for name in matrices}
    audit = []
    for fold_index, fold in enumerate(folds):
        held = set(fold)
        train = [row for index, row in enumerate(rows) if index not in held]
        selection = choose_inner(train, seed=seed + 100 + fold_index)
        safe_weight, high_weight, safe, high = selection["selected_configuration"]
        baseline = fit_linear(train)
        tuned = adjust_boundaries(fit_linear(train, safe_weight=safe_weight,
                                             high_weight=high_weight), safe, high)
        audit.append({"outer_fold": fold_index,
                      "held_ids": [rows[i]["id"] for i in fold],
                      "inner_selection": selection})
        for name, model in (("baseline", baseline), ("tuned", tuned)):
            for index in fold:
                row = rows[index]
                scores = predict_scores_linear(model, row["text"])
                predicted = max(LABELS, key=scores.get)
                matrices[name][row["label"]][predicted] += 1
                predictions[name].append({"id": row["id"], "label": row["label"],
                                          "predicted": predicted})
    return {name: {**metrics_from_matrix(matrix), "seed": seed,
                   "near_duplicate_group_count": groups,
                   "predictions_by_id": predictions[name],
                   "errors_by_id": [row for row in predictions[name]
                                    if row["label"] != row["predicted"]]}
            for name, matrix in matrices.items()} | {"selection_audit": audit}


def run(base_dir: Path, v8_dir: Path, review2: Path, review3: Path, legacy: Path,
        provenance: Path, output: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if sha256(base_dir / "model.json.gz") != BASE_V5_SHA256:
        raise ValueError("Unexpected v5 artifact")
    if sha256(v8_dir / "model.json.gz") != V8_MODEL_SHA256:
        raise ValueError("Unexpected v8 artifact")
    rows = development_rows(review2, review3, legacy, provenance)
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for seed in CV_SEEDS:
        result = nested_compare(rows, seed=seed)
        results.append(result)
        print(json.dumps({"completed_seed": seed,
                          "baseline": mean_metrics([result["baseline"]]),
                          "tuned": mean_metrics([result["tuned"]])}), flush=True)
    baseline = mean_metrics([result["baseline"] for result in results])
    tuned = mean_metrics([result["tuned"] for result in results])
    accepted = qualifies(tuned, baseline)
    final_selection = choose_inner(rows, seed=FINAL_SELECTION_SEED) if accepted else None
    source_audit = {
        "review_sha256": {"DuLieuThat1": sha256(legacy), "DuLieuThat2": sha256(review2),
                          "DuLieuThat3": sha256(review3)},
        "provenance_sha256": sha256(provenance),
        "v5_sha256": BASE_V5_SHA256, "v8_sha256": V8_MODEL_SHA256,
        "code_sha256": {name: sha256(Path(__file__).parent / name) for name in (
            "tune_v8_decisions.py", "adapt_reviewed_queries_v8.py",
            "adapt_reviewed_queries_v7.py", "linear_query_model.py")},
        "weights": WEIGHTS, "boundaries": BOUNDARIES,
        "final_selection_seed": FINAL_SELECTION_SEED,
    }
    model_path = v8_dir / "model.json.gz"
    if accepted:
        sw, hw, safe, high = final_selection["selected_configuration"]
        model = adjust_boundaries(fit_linear(rows, safe_weight=sw, high_weight=hw), safe, high)
        fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True).encode()).hexdigest()
        model.update(model_version=MODEL_VERSION,
                     dataset_version="school-violence-reviewed-query-development-v3",
                     combined_dataset_sha256=fingerprint, deployment_eligible=False,
                     training_configuration={"input_columns": ["text"],
                         "selection": "nested_grouped_cv", "configuration": [sw, hw, safe, high],
                         "scores_are_calibrated_probabilities": False,
                         "final_independent_test_available": False})
        model_path = output / "model.json.gz"
        with model_path.open("xb") as handle:
            with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
                archive.write(json.dumps(model, ensure_ascii=False, sort_keys=True,
                                         separators=(",", ":")).encode("utf-8"))
        for split in ("train", "validation", "test"):
            shutil.copyfile(v8_dir / f"{split}.jsonl", output / f"{split}.jsonl")
    model = load_model(model_path)
    report = {
        "source_audit": source_audit, "development_rows": len(rows),
        "label_counts": dict(Counter(row["label"] for row in rows)),
        "seeds": list(CV_SEEDS), "baseline_mean": baseline, "tuned_mean": tuned,
        "qualifies_over_v8": accepted, "final_selection": final_selection,
        "selected_model_version": model["model_version"],
        "selected_artifact": str(model_path.resolve()), "selected_model_sha256": sha256(model_path),
        "baseline_error_audit": summarize_errors(rows, [result["baseline"] for result in results]),
        "by_seed": results, "independent_final_holdout_evaluated": False,
        "deployment_eligible": False,
        "limitations": ["Previously inspected development data; not an independent test.",
                        "Near-duplicate groups are not child/session/semantic groups.",
                        "Twenty-seven inner options; one predeclared procedure; no further search."],
    }
    (output / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"baseline_mean": baseline, "tuned_mean": tuned,
                      "qualifies_over_v8": accepted, "selected_model": model["model_version"]}), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base-artifact", "v8-artifact", "review2", "review3", "legacy-review",
                 "provenance", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run(args.base_artifact, args.v8_artifact, args.review2, args.review3,
        args.legacy_review, args.provenance, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
