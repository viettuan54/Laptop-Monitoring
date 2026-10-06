"""One predeclared context/high-first experiment on the locked v9 development folds."""

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

import numpy as np

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v7 import make_cv_folds
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT, EPOCHS, PENALTY, development_rows
from .adapt_reviewed_queries_v9 import (
    BASE as V9_BASE, FINAL_SEED, average, fit as fit_v9, indicators, score_predictions, write_json,
)
from .context_query_model import FLAT_ALGORITHM, HIGH_FIRST_ALGORITHM, query_features
from .evaluate_query_csv import read_queries
from .predict import load_model
from .training import LABELS, evaluate, predict, predict_scores, select_label

LOCK = Path(__file__).with_name("query_v9_candidate.lock.json")
PLAN = Path(__file__).with_name("V10_EXPERIMENT_PLAN.md")
MODEL_VERSION = "vi-school-violence-context-v10-query-candidate"
BASE = "v9"
CONTEXT_SCALE = 2.0
RECIPES = {
    "flat_context_high2": dict(kind="flat", context=True, high_weight=2.0),
    "flat_context_high3": dict(kind="flat", context=True, high_weight=3.0),
    "high_context_1.5_045": dict(kind="high_first", context=True, high_weight=1.5, threshold=0.45),
    "high_context_1.5_050": dict(kind="high_first", context=True, high_weight=1.5, threshold=0.50),
    "high_context_1.5_055": dict(kind="high_first", context=True, high_weight=1.5, threshold=0.55),
    "high_context_2_050": dict(kind="high_first", context=True, high_weight=2.0, threshold=0.50),
    "high_context_2_055": dict(kind="high_first", context=True, high_weight=2.0, threshold=0.55),
    "high_words_1.5_050": dict(kind="high_first", context=False, high_weight=1.5, threshold=0.50),
}
WATCH_IDS = ("Dulieu4:66", "Dulieu4:83", "Dulieu4:90", "Dulieu4:32",
             "Dulieu4:35", "Dulieu4:50", "Dulieu4:57")


@lru_cache(maxsize=1024)
def training_keys(text: str, context: bool) -> frozenset[str]:
    return frozenset(query_features(text, context))


def fit_head(rows: list[dict], labels: tuple[str, ...], class_weights: tuple[float, ...],
             *, context: bool, min_df: int) -> dict:
    if {row["label"] for row in rows} != set(labels):
        raise ValueError("Every head needs all its labels")
    if len(class_weights) != len(labels) or any(not math.isfinite(x) or x <= 0 for x in class_weights):
        raise ValueError("Invalid head class weights")
    keys = [training_keys(row["text"], context) for row in rows]
    counts = Counter(key for features in keys for key in features)
    features = {key: [(math.log((1 + len(rows)) / (1 + counts[key])) + 1)
                      * (CONTEXT_SCALE if key.startswith("ctx:") else 1.0)]
                for key in sorted(counts) if counts[key] >= min_df}
    if not features:
        raise ValueError("Training vocabulary is empty")
    columns = {key: i for i, key in enumerate(features)}
    docs, cols, values = [], [], []
    for i, row_keys in enumerate(keys):
        known = sorted(key for key in row_keys if key in columns)
        norm = math.sqrt(sum(features[key][0] ** 2 for key in known))
        for key in known:
            docs.append(i); cols.append(columns[key]); values.append(features[key][0] / norm)
    docs, cols = np.asarray(docs, dtype=np.intp), np.asarray(cols, dtype=np.intp)
    values = np.asarray(values, dtype=np.float64)
    actual = np.asarray([labels.index(row["label"]) for row in rows])
    sample_weights = np.asarray(class_weights)[actual]
    targets = np.eye(len(labels))[actual]
    weights = np.zeros((len(features), len(labels)))
    bias = np.zeros(len(labels))
    for epoch in range(EPOCHS):
        logits = np.column_stack([np.bincount(docs, weights=values * weights[cols, k],
                                              minlength=len(rows)) for k in range(len(labels))]) + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        residual = (probabilities - targets) * (sample_weights / sample_weights.sum())[:, None]
        gradient = np.column_stack([np.bincount(cols, weights=values * residual[docs, k],
                                                minlength=len(features)) for k in range(len(labels))])
        rate = 5.0 / (1 + epoch / 30)
        weights -= rate * (gradient + PENALTY * weights)
        bias -= rate * residual.sum(axis=0)
    for i, key in enumerate(features):
        features[key].extend(map(float, weights[i]))
    return dict(labels=list(labels), features=features, bias=list(map(float, bias)),
                context_features=context, fallback_prior={label: sum(row["label"] == label for row in rows)
                                                           / len(rows) for label in labels})


def fit_model(rows: list[dict], name: str) -> dict:
    if name == BASE:
        return fit_v9(rows, V9_BASE)
    recipe = RECIPES[name]
    context = recipe["context"]
    if recipe["kind"] == "flat":
        return dict(algorithm=FLAT_ALGORITHM, labels=list(LABELS),
                    head=fit_head(rows, LABELS, (1.5, 1.0, recipe["high_weight"]),
                                  context=context, min_df=1))
    gate_rows = [{**row, "label": "HIGH_RISK" if row["label"] == "HIGH_RISK" else "OTHER"}
                 for row in rows]
    rest_rows = [row for row in rows if row["label"] != "HIGH_RISK"]
    return dict(algorithm=HIGH_FIRST_ALGORITHM, labels=list(LABELS),
                heads={"high": fit_head(gate_rows, ("OTHER", "HIGH_RISK"), (1.0, recipe["high_weight"]),
                                         context=context, min_df=1),
                       "rest": fit_head(rest_rows, ("SAFE", "RISK"), (1.5, 1.0), context=context, min_df=2)},
                high_threshold=recipe["threshold"], decision_rule="high_first_then_safe_risk")


def noninferior(candidate: dict, baseline: dict) -> bool:
    return (candidate["macro_f1"] >= baseline["macro_f1"] - 1e-12
            and candidate["high_risk_correct"] >= baseline["high_risk_correct"]
            and all(candidate[key] <= baseline[key] for key in (
                "high_risk_to_safe", "safe_alerts", "risk_to_high", "risk_to_safe")))


def qualifies_inner(candidate: dict, baseline: dict) -> bool:
    return noninferior(candidate, baseline) and any(candidate[key] < baseline[key] for key in (
        "high_risk_to_safe", "risk_to_high"))


def qualifies_outer(candidate: dict, baseline: dict) -> bool:
    return noninferior(candidate, baseline) and all(candidate[key] < baseline[key] for key in (
        "high_risk_to_safe", "risk_to_high"))


def choose_inner(rows: list[dict], *, seed: int) -> dict:
    folds, groups = make_cv_folds(rows, seed=seed)
    predictions = {name: [] for name in (BASE, *RECIPES)}
    for fold in folds:
        held = set(fold)
        train = [row for i, row in enumerate(rows) if i not in held]
        fitted = {}
        for name in predictions:
            recipe = RECIPES.get(name)
            signature = (recipe["kind"], recipe["context"], recipe["high_weight"]) if recipe else (BASE,)
            if signature not in fitted:
                fitted[signature] = fit_model(train, name)
            model = fitted[signature]
            if recipe and recipe["kind"] == "high_first":
                model = {**model, "high_threshold": recipe["threshold"]}
            predictions[name].extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                          predicted=predict(model, rows[i]["text"])) for i in fold)
    options = {name: indicators(score_predictions(values)) for name, values in predictions.items()}
    eligible = [name for name in RECIPES if qualifies_inner(options[name], options[BASE])]
    selected = min(eligible, key=lambda name: (
        options[name]["high_risk_to_safe"], -options[name]["high_risk_correct"],
        options[name]["risk_to_high"], options[name]["safe_alerts"],
        options[name]["risk_to_safe"], -options[name]["macro_f1"], list(RECIPES).index(name))) if eligible else BASE
    return dict(selected_configuration=selected, options=options, inner_group_count=groups,
                selection_ids=[row["id"] for row in rows],
                inner_fold_ids=[[rows[i]["id"] for i in fold] for fold in folds])


def nested_compare(rows: list[dict], folds: list[list[int]], *, seed: int) -> dict:
    predictions = {name: [] for name in ("baseline", "selected")}
    audit = []
    for fold_index, fold in enumerate(folds):
        held = set(fold)
        train = [row for i, row in enumerate(rows) if i not in held]
        selection = choose_inner(train, seed=seed + 100 + fold_index)
        baseline = fit_model(train, BASE)
        selected = (baseline if selection["selected_configuration"] == BASE
                    else fit_model(train, selection["selected_configuration"]))
        for name, model in (("baseline", baseline), ("selected", selected)):
            predictions[name].extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                          predicted=predict(model, rows[i]["text"])) for i in fold)
        audit.append(dict(outer_fold=fold_index, held_ids=[rows[i]["id"] for i in fold], inner_selection=selection))
    return {name: score_predictions(values) for name, values in predictions.items()} | {
        "seed": seed, "selection_audit": audit}


def load_sources(source: Path) -> tuple[list[dict], dict, dict, Path]:
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    ai = Path(__file__).resolve().parents[1]
    model_path = ai / lock["artifact_relative_to_ai_training"]
    report_path = ai / lock["selection_report_relative_to_ai_training"]
    if sha256(model_path) != lock["model_sha256"] or sha256(report_path) != lock["selection_report_sha256"]:
        raise ValueError("V9 artifact or selection report no longer matches its lock")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    paths = {"DuLieuThat1": source / "DuLieuThat1_review.csv", "DuLieuThat2": source / "DuLieuThat2_review.csv",
             "DuLieuThat3": source / "DuLieuThat3_review.csv", "Dulieu4": source / "Dulieu4.csv"}
    if {name: sha256(path) for name, path in paths.items()} != report["source_audit"]["csv_sha256"]:
        raise ValueError("Source CSV changed; audit it before this experiment")
    provenance = source / "DuLieuThat1_label_provenance.csv"
    if sha256(provenance) != report["source_audit"]["provenance_sha256"]:
        raise ValueError("Label provenance changed")
    rows = development_rows(paths["DuLieuThat2"], paths["DuLieuThat3"], paths["DuLieuThat1"], provenance)
    rows += [{**row, "id": "Dulieu4:" + row["id"]} for row in read_queries(paths["Dulieu4"])]
    saved = [json.loads(line) for line in (model_path.parent / "train.jsonl").read_text(encoding="utf-8").splitlines()]
    if rows != [{key: row[key] for key in ("id", "text", "label")} for row in saved]:
        raise ValueError("V9 reference rows differ from the confirmed source queries")
    audit = dict(lock_sha256=sha256(LOCK), model_sha256=sha256(model_path),
                 report_sha256=sha256(report_path), train_sha256=sha256(model_path.parent / "train.jsonl"),
                 source_csv_sha256=report["source_audit"]["csv_sha256"],
                 provenance_sha256=sha256(provenance), source_dir=str(source.resolve()))
    return rows, report, audit, model_path


def run(source: Path, output: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    rows, v9_report, source_audit, v9_path = load_sources(source)
    source_audit.update(plan_sha256=sha256(PLAN), recipes=RECIPES, context_scale=CONTEXT_SCALE,
                        code_sha256={name: sha256(Path(__file__).with_name(name)) for name in (
                            "context_query_model.py", "experiment_context_queries_v10.py", "training.py",
                            "adapt_reviewed_queries_v9.py", "adapt_reviewed_queries_v7.py")})
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "Dulieu4.csv", output / "source_snapshot.csv")
    write_json(output / "preflight_audit.json", dict(source_audit=source_audit, development_rows=len(rows),
        label_counts=dict(Counter(row["label"] for row in rows)), operator_asserted_training_authorization=True,
        all_source_labels_preserved=True, deployment_eligible=False))
    indices = {row["id"]: index for index, row in enumerate(rows)}
    results = []
    for old in v9_report["by_seed"]:
        folds = [[indices[identifier] for identifier in fold["held_ids"]] for fold in old["selection_audit"]]
        flattened = [i for fold in folds for i in fold]
        if len(flattened) != len(rows) or set(flattened) != set(range(len(rows))):
            raise ValueError("Invalid frozen outer folds")
        result = nested_compare(rows, folds, seed=old["seed"])
        if result["baseline"]["confusion_matrix"] != old["baseline"]["confusion_matrix"]:
            raise AssertionError("Repeated v9 baseline differs on the frozen folds")
        results.append(result)
        write_json(output / f"nested_seed_{old['seed']}.json", result)
        print(json.dumps(dict(completed_seed=old["seed"], baseline=indicators(result["baseline"]),
                              selected=indicators(result["selected"]))), flush=True)
    baseline_mean = average([row["baseline"] for row in results])
    selected_mean = average([row["selected"] for row in results])
    accepted_procedure = qualifies_outer(selected_mean, baseline_mean)
    final_selection = choose_inner(rows, seed=FINAL_SEED) if accepted_procedure else None
    accepted = accepted_procedure and final_selection["selected_configuration"] != BASE
    model_path, model = v9_path, load_model(v9_path)
    configuration = None
    if accepted:
        name = final_selection["selected_configuration"]
        model = fit_model(rows, name)
        configuration = dict(name=name, **RECIPES[name], context_scale=CONTEXT_SCALE,
                             penalty=PENALTY, epochs=EPOCHS, input_columns=["text"],
                             selection_method="nested_grouped_development_cv", final_independent_test_available=False,
                             features_are_learned_not_label_overrides=True, scores_are_calibrated_probabilities=False)
        fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True).encode()).hexdigest()
        model.update(model_version=MODEL_VERSION, dataset_version="school-violence-reviewed-query-development-v4",
                     combined_dataset_sha256=fingerprint, training_configuration=configuration, deployment_eligible=False)
        candidate = output / MODEL_VERSION
        candidate.mkdir()
        model_path = candidate / "model.json.gz"
        with model_path.open("xb") as handle:
            with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
                archive.write(json.dumps(model, ensure_ascii=False, sort_keys=True,
                                         separators=(",", ":")).encode("utf-8"))
        for split in ("train", "validation", "test"):
            shutil.copyfile(v9_path.parent / f"{split}.jsonl", candidate / f"{split}.jsonl")
        write_json(candidate / "training_config.json", configuration)
        write_json(candidate / "dataset_manifest.json", dict(development_rows=len(rows),
            source_audit=source_audit, combined_dataset_sha256=fingerprint, deployment_eligible=False))
    from text_safety.engine import ModerationInput, ThreeLabelEngine
    engine = ThreeLabelEngine(model_path)
    fit_predictions = []
    for row in rows:
        scores = predict_scores(model, row["text"])
        predicted = select_label(model, scores)
        actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
        if actual["label"] != predicted or any(abs(actual["scores"][key] - scores[key]) > 1e-12 for key in LABELS):
            raise AssertionError("Saved artifact and training inference disagree")
        if any(not math.isfinite(x) or not 0 <= x <= 1 for x in scores.values()) or abs(sum(scores.values()) - 1) > 1e-12:
            raise AssertionError("Invalid runtime scores")
        fit_predictions.append(dict(id=row["id"], label=row["label"], predicted=predicted))
    report = dict(source_audit=source_audit, development_rows=len(rows),
                  label_counts=dict(Counter(row["label"] for row in rows)),
                  baseline_mean=baseline_mean, selected_mean=selected_mean,
                  selected_procedure_qualifies=accepted_procedure, candidate_selected=accepted,
                  final_selection=final_selection, final_configuration=configuration,
                  selected_model_version=model["model_version"], selected_artifact=str(model_path.resolve()),
                  selected_model_sha256=sha256(model_path), by_seed=results,
                  development_training_fit=score_predictions(fit_predictions),
                  watched_ids_out_of_fold={identifier: {
                      key: [next(row["predicted"] for row in result[key]["predictions_by_id"]
                                 if row["id"] == identifier) for result in results]
                      for key in ("baseline", "selected")} for identifier in WATCH_IDS},
                  historical_synthetic_regression={split: evaluate(model, [json.loads(line) for line in
                      (model_path.parent / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()])
                      for split in ("validation", "test")},
                  service_matches_saved_artifact_on_all_rows=True,
                  independent_final_holdout_evaluated=False, deployment_eligible=False,
                  limitations=["All 282 queries were inspected development data, not an independent test.",
                               "Context concepts were designed after earlier error inspection; nested CV remains a development estimate.",
                               "No phrase or query ID overrides labels; all head coefficients are learned in training folds.",
                               "Same queries reused across five seeds; no child/session/semantic independence proof.",
                               "No deployment acceptance decision; historical synthetic data are regression checks."])
    _, _, final_audit, _ = load_sources(source)
    if any(final_audit[key] != source_audit[key] for key in final_audit) or sha256(PLAN) != source_audit["plan_sha256"]:
        raise RuntimeError("Sources, locked baseline or experiment plan changed during the run")
    write_json(output / "evaluation_report.json", report)
    if accepted:
        write_json(model_path.parent / "evaluation_report.json", report)
    training_keys.cache_clear()
    print(json.dumps(dict(baseline_mean=baseline_mean, selected_mean=selected_mean,
                          candidate_selected=accepted, selected_model=model["model_version"],
                          deployment_eligible=False)), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run(args.source_dir, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
