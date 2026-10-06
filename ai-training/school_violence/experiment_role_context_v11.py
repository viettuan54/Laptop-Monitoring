"""One fixed-recipe semantic-feature repair on the locked development folds."""

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
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT, EPOCHS, PENALTY
from .adapt_reviewed_queries_v9 import average, indicators, score_predictions, write_json
from .context_query_model_v11 import ALGORITHM, query_features
from .experiment_context_queries_v10 import fit_model as fit_v10, load_sources
from .predict import load_model
from .training import LABELS, evaluate, predict, predict_scores

LOCK = Path(__file__).with_name("query_v10_candidate.lock.json")
PLAN = Path(__file__).with_name("V11_EXPERIMENT_PLAN.md")
MODEL_VERSION = "vi-school-violence-role-context-v11-query-candidate"
CONFIGURATION = dict(name="role_context_fixed_high3", min_df=1, context_scale=2.0,
                     class_weights=dict(zip(LABELS, (1.5, 1.0, 3.0))), epochs=EPOCHS,
                     penalty=PENALTY, decision_rule="argmax", input_columns=["text"],
                     features_are_learned_not_label_overrides=True,
                     scores_are_calibrated_probabilities=False)
WATCH_IDS = tuple("Dulieu4:" + str(i) for i in (30, 35, 57, 82, 66, 83, 90, 32, 50))


@lru_cache(maxsize=1024)
def training_keys(text: str) -> frozenset[str]:
    return frozenset(query_features(text))


def fit(rows: list[dict], *, feature_keys=None, algorithm: str = ALGORITHM, configuration=None) -> dict:
    """Keep v10 sparse softmax math, versioning extraction independently."""
    config = CONFIGURATION if configuration is None else configuration
    extract = training_keys if feature_keys is None else feature_keys
    if {row["label"] for row in rows} != set(LABELS):
        raise ValueError("Training needs all three labels")
    keys = [extract(row["text"]) for row in rows]
    counts = Counter(key for features in keys for key in features)
    features = {key: [(math.log((1 + len(rows)) / (1 + counts[key])) + 1)
                      * (config["context_scale"] if key.startswith("ctx:") else 1.0)]
                for key in sorted(counts) if counts[key] >= config["min_df"]}
    if not features:
        raise ValueError("Training vocabulary is empty")
    columns = {key: i for i, key in enumerate(features)}
    docs, cols, values = [], [], []
    for i, row_keys in enumerate(keys):
        known = sorted(key for key in row_keys if key in columns)
        norm = math.sqrt(sum(features[key][0] ** 2 for key in known))
        for key in known:
            docs.append(i)
            cols.append(columns[key])
            values.append(features[key][0] / norm)
    docs, cols = np.asarray(docs, dtype=np.intp), np.asarray(cols, dtype=np.intp)
    values = np.asarray(values, dtype=np.float64)
    actual = np.asarray([LABELS.index(row["label"]) for row in rows])
    sample_weights = np.asarray([config["class_weights"][label] for label in LABELS])[actual]
    targets = np.eye(len(LABELS))[actual]
    weights = np.zeros((len(features), len(LABELS)))
    bias = np.zeros(len(LABELS))
    for epoch in range(config["epochs"]):
        logits = np.column_stack([np.bincount(docs, weights=values * weights[cols, k],
                                             minlength=len(rows)) for k in range(len(LABELS))]) + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        residual = (probabilities - targets) * (sample_weights / sample_weights.sum())[:, None]
        gradient = np.column_stack([np.bincount(cols, weights=values * residual[docs, k],
                                               minlength=len(features)) for k in range(len(LABELS))])
        rate = 5.0 / (1 + epoch / 30)
        weights -= rate * (gradient + config["penalty"] * weights)
        bias -= rate * residual.sum(axis=0)
    for i, key in enumerate(features):
        features[key].extend(map(float, weights[i]))
    return dict(algorithm=algorithm, labels=list(LABELS),
                head=dict(labels=list(LABELS), features=features, bias=list(map(float, bias)),
                          fallback_prior={label: sum(row["label"] == label for row in rows) / len(rows)
                                          for label in LABELS}))


def compare(rows: list[dict], folds: list[list[int]], *, candidate_fit=None) -> dict:
    train_candidate = fit if candidate_fit is None else candidate_fit
    flat = [i for fold in folds for i in fold]
    if len(flat) != len(rows) or set(flat) != set(range(len(rows))):
        raise ValueError("Frozen folds must hold each query exactly once")
    predictions = {name: [] for name in ("baseline", "candidate")}
    audit = []
    for fold_index, fold in enumerate(folds):
        held = set(fold)
        train = [row for i, row in enumerate(rows) if i not in held]
        models = dict(baseline=fit_v10(train, "flat_context_high3"), candidate=train_candidate(train))
        for name, model in models.items():
            predictions[name].extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                          predicted=predict(model, rows[i]["text"])) for i in fold)
        audit.append(dict(outer_fold=fold_index, held_ids=[rows[i]["id"] for i in fold],
                          training_ids=[row["id"] for row in train]))
    return {name: score_predictions(values) for name, values in predictions.items()} | {"fold_audit": audit}


def noninferior(candidate: dict, baseline: dict) -> bool:
    return (candidate["macro_f1"] >= baseline["macro_f1"] - 1e-12
            and candidate["high_risk_correct"] >= baseline["high_risk_correct"]
            and all(candidate[key] <= baseline[key] for key in (
                "high_risk_to_safe", "safe_alerts", "risk_to_high", "risk_to_safe")))


def qualifies(candidate: dict, baseline: dict, candidate_d4: dict, baseline_d4: dict) -> bool:
    return (noninferior(candidate, baseline)
            and any(candidate[key] < baseline[key] for key in ("safe_alerts", "risk_to_high"))
            and candidate_d4["high_risk_correct"] >= baseline_d4["high_risk_correct"]
            and all(candidate_d4[key] <= baseline_d4[key] for key in (
                "high_risk_to_safe", "safe_alerts", "risk_to_high", "risk_to_safe")))


def locked_inputs(source: Path):
    rows, v9_report, source_audit, _ = load_sources(source)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    ai = Path(__file__).resolve().parents[1]
    paths = {key: ai / lock[key + "_relative_to_ai_training"] for key in (
        "artifact", "selection_report", "fixed_recipe_audit")}
    hashes = {"artifact": "model_sha256", "selection_report": "selection_report_sha256",
              "fixed_recipe_audit": "fixed_recipe_audit_sha256"}
    if any(sha256(path) != lock[hashes[key]] for key, path in paths.items()):
        raise ValueError("V10 baseline/report no longer matches its lock")
    source_audit.update(v10_lock_sha256=sha256(LOCK), v10_model_sha256=sha256(paths["artifact"]),
                        v10_report_sha256=sha256(paths["selection_report"]),
                        v10_fixed_recipe_audit_sha256=sha256(paths["fixed_recipe_audit"]))
    return rows, v9_report, source_audit, paths, json.loads(paths["fixed_recipe_audit"].read_text(encoding="utf-8"))


def run(source: Path, output: Path, *, authorized: bool, candidate_fit=None, plan: Path = PLAN,
        model_version: str = MODEL_VERSION, configuration=None,
        additional_code_paths: tuple[Path, ...] = (), previous_report: Path | None = None) -> dict:
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    rows, v9_report, source_audit, paths, fixed_v10 = locked_inputs(source)
    train_candidate = fit if candidate_fit is None else candidate_fit
    config = CONFIGURATION if configuration is None else configuration
    code_paths = [Path(__file__), Path(__file__).with_name("context_query_model_v11.py"),
                  Path(__file__).with_name("context_query_model.py"), Path(__file__).with_name("training.py"),
                  *additional_code_paths]
    source_audit.update(plan_sha256=sha256(plan), plan_path=str(plan.resolve()), configuration=config,
                        code_sha256={path.name: sha256(path) for path in code_paths})
    if previous_report is not None:
        source_audit.update(previous_attempt_report=str(previous_report.resolve()),
                            previous_attempt_report_sha256=sha256(previous_report))
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "Dulieu4.csv", output / "source_snapshot.csv")
    write_json(output / "preflight_audit.json", dict(source_audit=source_audit, development_rows=len(rows),
        labels=dict(Counter(row["label"] for row in rows)), operator_asserted_training_authorization=True,
        source_labels_preserved=True, deployment_eligible=False))
    indices = {row["id"]: i for i, row in enumerate(rows)}
    results = []
    for old in v9_report["by_seed"]:
        folds = [[indices[identifier] for identifier in fold["held_ids"]] for fold in old["selection_audit"]]
        result = compare(rows, folds, candidate_fit=train_candidate) | {"seed": old["seed"]}
        results.append(result)
        write_json(output / f"fixed_seed_{old['seed']}.json", result)
        print(json.dumps(dict(completed_seed=old["seed"], baseline=indicators(result["baseline"]),
                              candidate=indicators(result["candidate"]))), flush=True)
    baseline_mean = average([result["baseline"] for result in results])
    if any(abs(baseline_mean[key] - fixed_v10["mean"][key]) > 1e-12 for key in baseline_mean):
        raise AssertionError("Fixed-recipe v10 baseline differs from its locked audit")
    candidate_mean = average([result["candidate"] for result in results])
    subgroup = {name: average([result[name]["by_source"]["Dulieu4"] for result in results])
                for name in ("baseline", "candidate")}
    accepted = qualifies(candidate_mean, baseline_mean, subgroup["candidate"], subgroup["baseline"])
    model = train_candidate(rows)
    fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True).encode()).hexdigest()
    model.update(model_version=model_version, dataset_version="school-violence-reviewed-query-development-v4",
                 combined_dataset_sha256=fingerprint, training_configuration=config, deployment_eligible=False)
    directory = output / model_version
    directory.mkdir()
    model_path = directory / "model.json.gz"
    with model_path.open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(json.dumps(model, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    for split in ("train", "validation", "test"):
        shutil.copyfile(paths["artifact"].parent / f"{split}.jsonl", directory / f"{split}.jsonl")
    write_json(directory / "training_config.json", config)
    write_json(directory / "dataset_manifest.json", dict(development_rows=len(rows), source_audit=source_audit,
                                                         deployment_eligible=False))
    saved, baseline = load_model(model_path), load_model(paths["artifact"])
    from text_safety.engine import ModerationInput, ThreeLabelEngine
    engine = ThreeLabelEngine(model_path)
    predictions = {name: [] for name in ("baseline", "candidate")}
    for row in rows:
        scores = predict_scores(saved, row["text"])
        actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
        if actual["label"] != predict(model, row["text"]) or any(
                abs(actual["scores"][label] - scores[label]) > 1e-12 for label in LABELS):
            raise AssertionError("Saved artifact and training inference disagree")
        if abs(sum(scores.values()) - 1) > 1e-12 or any(not math.isfinite(x) or not 0 <= x <= 1 for x in scores.values()):
            raise AssertionError("Invalid runtime scores")
        for name, item in (("baseline", baseline), ("candidate", saved)):
            predictions[name].append(dict(id=row["id"], label=row["label"], predicted=predict(item, row["text"])))
    fits = {name: score_predictions(values) for name, values in predictions.items()}
    selected_path = model_path if accepted else paths["artifact"]
    selected_model = load_model(selected_path)
    report = dict(source_audit=source_audit, development_rows=len(rows),
        label_counts=dict(Counter(row["label"] for row in rows)), baseline_mean=baseline_mean,
        candidate_mean=candidate_mean, dulieu4_mean=subgroup, by_seed=results,
        evaluation_method="fixed_recipe_grouped_development_cv_after_prior_error_inspection",
        candidate_selected=accepted, candidate_artifact=str(model_path.resolve()), candidate_model_sha256=sha256(model_path),
        candidate_model_version=model_version, selected_artifact=str(selected_path.resolve()),
        selected_model_version=selected_model["model_version"], selected_model_sha256=sha256(selected_path),
        configuration=config, development_training_fit=fits,
        watched_ids_out_of_fold={identifier: {name: [next(row["predicted"] for row in result[name]["predictions_by_id"]
            if row["id"] == identifier) for result in results] for name in ("baseline", "candidate")} for identifier in WATCH_IDS},
        historical_synthetic_regression={split: evaluate(saved, [json.loads(line) for line in
            (directory / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]) for split in ("validation", "test")},
        service_matches_saved_artifact_on_all_rows=True, independent_final_holdout_evaluated=False,
        deployment_eligible=False, limitations=[
            "All 282 queries are inspected development data; this is not an independent test.",
            "V10 recipe and V11 feature design use prior development inspection; no unbiased performance claim.",
            "Five seeds repeat the same queries, not five independent samples.",
            "Local phrase/recipient features do not perform full semantic or child/session disambiguation.",
            "Softmax scores with class weights are not calibrated risk probabilities."])
    _, _, final_audit, _, _ = locked_inputs(source)
    if any(final_audit[key] != source_audit[key] for key in final_audit) or sha256(plan) != source_audit["plan_sha256"]:
        raise RuntimeError("Locked baseline, plan or source changed during the run")
    if {path.name: sha256(path) for path in code_paths} != source_audit["code_sha256"]:
        raise RuntimeError("Experiment code changed during the run")
    if previous_report is not None and sha256(previous_report) != source_audit["previous_attempt_report_sha256"]:
        raise RuntimeError("Previous attempt report changed during the run")
    write_json(output / "evaluation_report.json", report)
    write_json(directory / "evaluation_report.json", report)
    # Explicit experimental selection for the generic runtime checker, even on failure.
    write_json(output / "runtime_check_selection.json", dict(selected_artifact=str(model_path.resolve()),
        selected_model_sha256=sha256(model_path), selected_model_version=model_version,
        development_rows=len(rows), candidate_selected=accepted, experimental_functional_check_only=True,
        deployment_eligible=False, independent_final_holdout_evaluated=False))
    training_keys.cache_clear()
    print(json.dumps(dict(baseline_mean=baseline_mean, candidate_mean=candidate_mean, dulieu4_mean=subgroup,
                          candidate_selected=accepted, selected_model=selected_model["model_version"],
                          deployment_eligible=False)), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run(args.source_dir, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
