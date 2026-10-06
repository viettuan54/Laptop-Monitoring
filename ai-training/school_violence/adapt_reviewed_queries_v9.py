"""Bounded, nested grouped development comparison after the Dulieu4 evaluation.

All 282 supplied labels stay unchanged. Dulieu4 is development data for v9.
No independent-test or deployment claim is made from these results.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
from collections import Counter
from functools import lru_cache
from pathlib import Path
from statistics import mean

import numpy as np

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v7 import make_cv_folds, metrics_from_matrix
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT, BASE_V5_SHA256, CV_SEEDS, EPOCHS, PENALTY, development_rows,
)
from .analyze_v8_error_stability import V8_MODEL_SHA256
from .evaluate_query_csv import read_queries
from .hybrid_query_model import ALGORITHM as HYBRID_ALGORITHM, hybrid_features
from .linear_query_model import ALGORITHM as WORD_ALGORITHM, word_features
from .predict import load_model
from .training import LABELS, evaluate, predict, predict_scores


MODEL_VERSION = "vi-school-violence-linear-v9-reviewed-query-candidate"
DATASET_VERSION = "school-violence-reviewed-query-development-v4"
DULIEU4_SHA256 = "e504cc10089cc135d19e59fe4d4ea3407abb7de028d68d9031899c71023f7587"
FINAL_SEED = 20261007
PLAN = Path(__file__).with_name("V9_EXPERIMENT_PLAN.md")
BASE = "word_df2"
CONFIGURATIONS = {
    BASE: dict(hybrid=False, min_df=2, safe_weight=1.5, high_weight=3.0),
    "word_df1": dict(hybrid=False, min_df=1, safe_weight=1.5, high_weight=3.0),
    "hybrid_df2": dict(hybrid=True, min_df=2, safe_weight=1.5, high_weight=3.0),
    "hybrid_df1": dict(hybrid=True, min_df=1, safe_weight=1.5, high_weight=3.0),
    "word_df1_safe2": dict(hybrid=False, min_df=1, safe_weight=2.0, high_weight=3.0),
    "hybrid_df1_safe2": dict(hybrid=True, min_df=1, safe_weight=2.0, high_weight=3.0),
}
CHARACTER_SCALE = 0.25
PRIORITY_IDS = ("Dulieu4:66", "Dulieu4:83", "Dulieu4:90")


@lru_cache(maxsize=1024)
def training_features(text: str, hybrid: bool) -> frozenset[str]:
    # Stateless feature extraction only: no vocabulary/IDF from held-out rows.
    # This cache belongs to the offline trainer, never to the API runtime.
    return frozenset(hybrid_features(text) if hybrid else word_features(text))


def fit(rows: list[dict], name: str) -> dict:
    config = CONFIGURATIONS[name]
    if {row["label"] for row in rows} != set(LABELS):
        raise ValueError("Training needs all three labels")
    keys = [training_features(row["text"], config["hybrid"]) for row in rows]
    counts = Counter(key for features in keys for key in features)
    features = {
        key: [(math.log((1 + len(rows)) / (1 + counts[key])) + 1)
              * (CHARACTER_SCALE if key.startswith("c:") else 1.0)]
        for key in sorted(counts) if counts[key] >= config["min_df"]
    }
    if not features:
        raise ValueError("Training vocabulary is empty")
    columns = {key: index for index, key in enumerate(features)}
    doc_indices, feature_indices, values = [], [], []
    for doc_index, row_keys in enumerate(keys):
        present = sorted(key for key in row_keys if key in columns)
        norm = math.sqrt(sum(features[key][0] ** 2 for key in present))
        for key in present:
            doc_indices.append(doc_index)
            feature_indices.append(columns[key])
            values.append(features[key][0] / norm)
    docs = np.asarray(doc_indices, dtype=np.intp)
    cols = np.asarray(feature_indices, dtype=np.intp)
    data = np.asarray(values, dtype=np.float64)
    actual = np.asarray([LABELS.index(row["label"]) for row in rows])
    sample_weights = np.asarray((config["safe_weight"], 1, config["high_weight"]))[actual]
    targets = np.eye(len(LABELS))[actual]
    weights = np.zeros((len(features), len(LABELS)), dtype=np.float64)
    bias = np.zeros(len(LABELS), dtype=np.float64)
    for epoch in range(EPOCHS):
        # Sparse matrix products using numpy; no new training/runtime dependency.
        logits = np.column_stack([
            np.bincount(docs, weights=data * weights[cols, k], minlength=len(rows))
            for k in range(len(LABELS))
        ]) + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        residual = (probabilities - targets) * (sample_weights / sample_weights.sum())[:, None]
        gradient = np.column_stack([
            np.bincount(cols, weights=data * residual[docs, k], minlength=len(features))
            for k in range(len(LABELS))
        ])
        rate = 5.0 / (1 + epoch / 30)
        weights -= rate * (gradient + PENALTY * weights)
        bias -= rate * residual.sum(axis=0)
    for index, key in enumerate(features):
        features[key].extend(map(float, weights[index]))
    return dict(
        algorithm=HYBRID_ALGORITHM if config["hybrid"] else WORD_ALGORITHM,
        labels=list(LABELS), features=features, bias=list(map(float, bias)),
        fallback_prior={label: sum(row["label"] == label for row in rows) / len(rows)
                        for label in LABELS},
    )


def score_predictions(predictions: list[dict]) -> dict:
    matrix = {a: {b: 0 for b in LABELS} for a in LABELS}
    for row in predictions:
        matrix[row["label"]][row["predicted"]] += 1
    return {**metrics_from_matrix(matrix), "predictions_by_id": predictions,
            "errors_by_id": [row for row in predictions if row["label"] != row["predicted"]],
            "by_source": {
                source: metrics_from_matrix({a: {b: sum(
                    row["id"].split(":", 1)[0] == source and row["label"] == a
                    and row["predicted"] == b for row in predictions) for b in LABELS}
                    for a in LABELS})
                for source in sorted({row["id"].split(":", 1)[0] for row in predictions})
            }}


def indicators(result: dict) -> dict:
    matrix = result["confusion_matrix"]
    return dict(macro_f1=result["macro_f1"],
                high_risk_correct=matrix["HIGH_RISK"]["HIGH_RISK"],
                high_risk_to_safe=matrix["HIGH_RISK"]["SAFE"],
                safe_alerts=matrix["SAFE"]["RISK"] + matrix["SAFE"]["HIGH_RISK"],
                risk_to_high=matrix["RISK"]["HIGH_RISK"],
                risk_to_safe=matrix["RISK"]["SAFE"])


def average(results: list[dict]) -> dict:
    values = [indicators(result) for result in results]
    return {key: mean(row[key] for row in values) for key in values[0]}


def qualifies(candidate: dict, baseline: dict) -> bool:
    return (candidate["macro_f1"] >= baseline["macro_f1"] - 1e-12
            and candidate["high_risk_correct"] >= baseline["high_risk_correct"]
            and all(candidate[key] <= baseline[key] for key in (
                "high_risk_to_safe", "safe_alerts", "risk_to_high", "risk_to_safe"))
            and any(candidate[key] != baseline[key] for key in baseline))


def choose_inner(rows: list[dict], *, seed: int) -> dict:
    folds, groups = make_cv_folds(rows, seed=seed)
    options = {}
    for name in CONFIGURATIONS:
        predictions = []
        for fold in folds:
            held = set(fold)
            model = fit([row for i, row in enumerate(rows) if i not in held], name)
            predictions.extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                    predicted=predict(model, rows[i]["text"])) for i in fold)
        options[name] = indicators(score_predictions(predictions))
    eligible = [name for name in options if name != BASE and qualifies(options[name], options[BASE])]
    selected = min(eligible, key=lambda name: (
        options[name]["high_risk_to_safe"], -options[name]["high_risk_correct"],
        options[name]["safe_alerts"] + options[name]["risk_to_high"],
        options[name]["risk_to_safe"], -options[name]["macro_f1"],
        list(CONFIGURATIONS).index(name))) if eligible else BASE
    return dict(selected_configuration=selected, options=options,
                inner_group_count=groups, selection_ids=[row["id"] for row in rows],
                inner_fold_ids=[[rows[i]["id"] for i in fold] for fold in folds])


def nested_compare(rows: list[dict], *, seed: int) -> dict:
    folds, groups = make_cv_folds(rows, seed=seed)
    predictions = {key: [] for key in ("baseline", "selected")}
    audit = []
    for fold_index, fold in enumerate(folds):
        held = set(fold)
        train = [row for i, row in enumerate(rows) if i not in held]
        selection = choose_inner(train, seed=seed + 100 + fold_index)
        audit.append(dict(outer_fold=fold_index, held_ids=[rows[i]["id"] for i in fold],
                          inner_selection=selection))
        baseline = fit(train, BASE)
        selected = (baseline if selection["selected_configuration"] == BASE
                    else fit(train, selection["selected_configuration"]))
        for key, model in (("baseline", baseline), ("selected", selected)):
            predictions[key].extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                          predicted=predict(model, rows[i]["text"])) for i in fold)
    return {key: score_predictions(values) for key, values in predictions.items()} | {
        "seed": seed, "near_duplicate_group_count": groups, "selection_audit": audit}


def error_diagnostics(v8: dict, rows: list[dict], old_rows: list[dict]) -> dict:
    old_counts = Counter(feature for row in old_rows for feature in word_features(row["text"]))
    errors = []
    for row in rows:
        predicted = predict(v8, row["text"])
        if predicted == row["label"]:
            continue
        keys = word_features(row["text"])
        missing = keys - v8["features"].keys()
        errors.append(dict(id=row["id"], label=row["label"], predicted=predicted,
                           word_feature_count=len(keys), known_word_features=len(keys) - len(missing),
                           discarded_single_occurrence_features=sum(old_counts[key] == 1 for key in missing),
                           previously_unseen_features=sum(old_counts[key] == 0 for key in missing)))
    return dict(error_count=len(errors), errors_by_id=errors,
                interpretation="Limited word coverage and discarded rare features; no query-specific rules.")


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(base_dir: Path, v8_dir: Path, review2: Path, review3: Path, legacy: Path,
        provenance: Path, dulieu4: Path, output: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if sha256(v8_dir / "model.json.gz") != V8_MODEL_SHA256:
        raise ValueError("Locked v8 model changed")
    if sha256(base_dir / "model.json.gz") != BASE_V5_SHA256:
        raise ValueError("Default v5 model changed")
    if sha256(dulieu4) != DULIEU4_SHA256:
        raise ValueError("Dulieu4 changed; audit it before training")
    old_rows = development_rows(review2, review3, legacy, provenance)
    new_rows = [{**row, "id": "Dulieu4:" + row["id"]} for row in read_queries(dulieu4)]
    rows = old_rows + new_rows
    seen_ids, seen_keys = set(), set()
    from .evaluate_real_world import _text_keys
    for row in rows:
        keys = _text_keys(row["text"])
        if row["id"] in seen_ids or seen_keys & keys:
            raise ValueError("Duplicate development query")
        seen_ids.add(row["id"])
        seen_keys.update(keys)
    folds, groups = make_cv_folds(rows, seed=CV_SEEDS[0])
    source_audit = dict(
        csv_sha256={"DuLieuThat1": sha256(legacy), "DuLieuThat2": sha256(review2),
                    "DuLieuThat3": sha256(review3), "Dulieu4": sha256(dulieu4)},
        provenance_sha256=sha256(provenance), v8_sha256=V8_MODEL_SHA256, v5_sha256=BASE_V5_SHA256,
        plan_sha256=sha256(PLAN), configurations=CONFIGURATIONS, character_scale=CHARACTER_SCALE,
        penalty=PENALTY, epochs=EPOCHS, seeds=list(CV_SEEDS), final_seed=FINAL_SEED,
        code_sha256={name: sha256(Path(__file__).with_name(name)) for name in (
            "adapt_reviewed_queries_v9.py", "hybrid_query_model.py", "linear_query_model.py",
            "training.py", "adapt_reviewed_queries_v7.py", "adapt_reviewed_queries_v8.py")})
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(dulieu4, output / "source_snapshot.csv")
    write_json(output / "preflight_audit.json", dict(
        source_audit=source_audit, rows=len(rows), label_counts=dict(Counter(r["label"] for r in rows)),
        near_duplicate_group_count=groups, all_labels_preserved=True,
        training_authorized_by_user_request=True, dulieu4_is_development_data=True,
        independent_final_holdout_evaluated=False, deployment_eligible=False))
    v8 = load_model(v8_dir / "model.json.gz")
    diagnosis = error_diagnostics(v8, new_rows, old_rows)
    write_json(output / "v8_dulieu4_error_diagnostics.json", diagnosis)
    results = []
    for seed in CV_SEEDS:
        result = nested_compare(rows, seed=seed)
        results.append(result)
        write_json(output / f"nested_seed_{seed}.json", result)
        print(json.dumps(dict(completed_seed=seed, baseline=indicators(result["baseline"]),
                              selected=indicators(result["selected"]))), flush=True)
    baseline_mean = average([result["baseline"] for result in results])
    selected_mean = average([result["selected"] for result in results])
    accepted = qualifies(selected_mean, baseline_mean)
    final_selection = choose_inner(rows, seed=FINAL_SEED) if accepted else None
    name = final_selection["selected_configuration"] if final_selection else BASE
    model = fit(rows, name)
    fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True).encode()).hexdigest()
    configuration = dict(
        **CONFIGURATIONS[name], name=name, input_columns=["text"],
        character_scale=CHARACTER_SCALE if CONFIGURATIONS[name]["hybrid"] else 0,
        penalty=PENALTY, epochs=EPOCHS, decision_rule="argmax_without_score_shifts",
        selection_method="nested_near_duplicate_grouped_development_cv",
        final_independent_test_available=False, scores_are_calibrated_probabilities=False)
    model.update(model_version=MODEL_VERSION, dataset_version=DATASET_VERSION,
                 combined_dataset_sha256=fingerprint, training_configuration=configuration,
                 deployment_eligible=False)
    candidate = output / MODEL_VERSION
    candidate.mkdir()
    model_path = candidate / "model.json.gz"
    with model_path.open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(json.dumps(model, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8"))
    with (candidate / "train.jsonl").open("x", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps({**row, "source_ids": [row["id"]], "split": "train",
                                     "source": "user_reviewed_query", "review_status": "user_labeled"},
                                    ensure_ascii=False) + "\n")
    for split in ("validation", "test"):
        shutil.copyfile(v8_dir / f"{split}.jsonl", candidate / f"{split}.jsonl")
    from text_safety.engine import ModerationInput, ThreeLabelEngine
    engine = ThreeLabelEngine(model_path)
    fit_predictions = []
    for row in rows:
        scores = predict_scores(model, row["text"])
        response = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
        label = max(LABELS, key=scores.get)
        if response["label"] != label or any(abs(response["scores"][key] - scores[key]) > 1e-12
                                              for key in LABELS):
            raise AssertionError("Saved candidate and training inference disagree")
        fit_predictions.append(dict(id=row["id"], label=row["label"], predicted=label))
    historical = {split: evaluate(engine.model, [json.loads(line) for line in
        (candidate / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()])
        for split in ("validation", "test")}
    report = dict(
        source_audit=source_audit, development_rows=len(rows),
        label_counts=dict(Counter(row["label"] for row in rows)),
        development_source_counts=dict(Counter(row["id"].split(":", 1)[0] for row in rows)),
        predeclared_plan_sha256=sha256(PLAN), error_diagnostics=diagnosis,
        baseline_mean=baseline_mean, nested_selected_mean=selected_mean,
        selected_procedure_qualifies=accepted, final_selection=final_selection,
        final_configuration=configuration, selected_model_version=MODEL_VERSION,
        selected_artifact=str(model_path.resolve()), selected_model_sha256=sha256(model_path),
        by_seed=results, development_training_fit=score_predictions(fit_predictions),
        v8_historical_dulieu4=score_predictions([
            dict(id=row["id"], label=row["label"], predicted=predict(v8, row["text"]))
            for row in new_rows]),
        priority_ids_out_of_fold={identifier: {
            key: [next(row["predicted"] for row in result[key]["predictions_by_id"]
                       if row["id"] == identifier) for result in results]
            for key in ("baseline", "selected")} for identifier in PRIORITY_IDS},
        historical_synthetic_regression=historical,
        service_matches_saved_artifact_on_all_rows=True,
        operator_asserted_training_authorization=True, permission_verified_by_code=False,
        independent_final_holdout_evaluated=False, deployment_eligible=False,
        limitations=[
            "All 282 queries are development data; Dulieu4 is no longer an independent v9 test.",
            "Nested folds exclude held queries from fitting and selection, but the sources informed prior work.",
            "Five seed repetitions reuse the same queries; they are not 1410 independent examples.",
            "Near-character duplicate groups cannot establish child/session/semantic independence.",
            "Training-fit improvements on previously misclassified queries do not establish generalization.",
            "Historical synthetic validation/test results are regression checks, not deployment gates.",
        ])
    current_hashes = {"DuLieuThat1": sha256(legacy), "DuLieuThat2": sha256(review2),
                      "DuLieuThat3": sha256(review3), "Dulieu4": sha256(dulieu4)}
    if (current_hashes != source_audit["csv_sha256"] or sha256(provenance) != source_audit["provenance_sha256"]
            or sha256(v8_dir / "model.json.gz") != V8_MODEL_SHA256
            or sha256(base_dir / "model.json.gz") != BASE_V5_SHA256 or sha256(PLAN) != source_audit["plan_sha256"]):
        raise RuntimeError("Source data, plan or baseline changed during training")
    write_json(output / "evaluation_report.json", report)
    write_json(candidate / "training_config.json", configuration)
    write_json(candidate / "dataset_manifest.json", dict(
        dataset_version=DATASET_VERSION, combined_dataset_sha256=fingerprint,
        development_rows=len(rows), sources=source_audit["csv_sha256"], deployment_eligible=False))
    write_json(candidate / "evaluation_report.json", report)
    training_features.cache_clear()
    print(json.dumps(dict(selected_configuration=name, baseline_mean=baseline_mean,
                          nested_selected_mean=selected_mean, selected_procedure_qualifies=accepted,
                          model_sha256=report["selected_model_sha256"], deployment_eligible=False)), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base-artifact", "v8-artifact", "review2", "review3", "legacy-review",
                 "provenance", "dulieu4", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run(args.base_artifact, args.v8_artifact, args.review2, args.review3, args.legacy_review,
        args.provenance, args.dulieu4, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
