"""One preregistered feature repair; compare against the locked v12.1."""
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

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .adapt_reviewed_queries_v9 import average, indicators, score_predictions, write_json
from .context_query_model_v13 import ALGORITHM, query_features
from .evaluate_query_csv import read_queries
from .experiment_financial_context_v12_1 import CONFIGURATION as BASE_CONFIG, fit as fit_baseline
from .experiment_role_context_v11 import fit as fit_context, locked_inputs, noninferior
from .predict import load_model
from .training import LABELS, evaluate, predict, predict_scores
from text_safety.engine import ModerationInput, ThreeLabelEngine

AI = Path(__file__).resolve().parents[1]
LOCK = Path(__file__).with_name("query_v12_1_candidate.lock.json")
PLAN = Path(__file__).with_name("V13_EXPERIMENT_PLAN.md")
MODEL_VERSION = "vi-school-violence-recipient-context-v13-query-candidate"
CONFIGURATION = {**BASE_CONFIG, "name": "recipient_context_fixed_high3"}
D5_SHA = "0d292e9ad186f9af9a7d8bcfa3670475989df2865f550eea57c63ff1e46e7be5"
D5_REPORT = AI / "artifacts/school_violence/dulieu5_v12_1_evaluation_20261006/scoring/evaluation_report.json"
D5_REPORT_SHA = "bc815e28713e2da7db3f3c1b7b6def4c2c39e8b7c4f77842c8b58a45ba4b4432"


@lru_cache(maxsize=1024)
def training_keys(text):
    return frozenset(query_features(text))


def fit(rows):
    return fit_context(rows, feature_keys=training_keys, algorithm=ALGORITHM, configuration=CONFIGURATION)


def selection_checks(candidate, baseline, candidate_d4, baseline_d4, candidate_d5, baseline_d5):
    return {
        "old_grouped_cv_noninferior": noninferior(candidate, baseline),
        "dulieu4_high_recall_preserved": candidate_d4["high_risk_correct"] >= baseline_d4["high_risk_correct"],
        "dulieu4_errors_noninferior": all(candidate_d4[key] <= baseline_d4[key] for key in
            ("high_risk_to_safe", "safe_alerts", "risk_to_high", "risk_to_safe")),
        "dulieu5_noninferior": noninferior(candidate_d5, baseline_d5),
        "dulieu5_false_alerts_strictly_reduced": any(candidate_d5[key] < baseline_d5[key]
            for key in ("safe_alerts", "risk_to_high")),
    }


def technical_targets(result):
    m = result["confusion_matrix"]
    total = sum(sum(values.values()) for values in m.values())
    counts = {label: sum(m[label].values()) for label in LABELS}
    return {
        "high_risk_to_safe_zero": m["HIGH_RISK"]["SAFE"] == 0,
        "high_risk_recall_at_least_95_percent": m["HIGH_RISK"]["HIGH_RISK"] / counts["HIGH_RISK"] >= .95,
        "safe_alerts_at_most_10_percent": (m["SAFE"]["RISK"] + m["SAFE"]["HIGH_RISK"]) / counts["SAFE"] <= .10,
        "risk_to_high_at_most_15_percent": m["RISK"]["HIGH_RISK"] / counts["RISK"] <= .15,
        "risk_to_safe_at_most_10_percent": m["RISK"]["SAFE"] / counts["RISK"] <= .10,
        "macro_f1_at_least_085": result["macro_f1"] >= .85,
        "proposed_accuracy_at_least_90_percent": sum(m[label][label] for label in LABELS) / total >= .90,
    }


def predictions(model, rows):
    return [dict(id=row["id"], label=row["label"], predicted=predict(model, row["text"])) for row in rows]


def run(source, output, *, authorized=False):
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    rows, v9, source_audit, _, _ = locked_inputs(source)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    baseline_path = AI / lock["artifact_relative_to_ai_training"]
    baseline_report_path = AI / lock["selection_report_relative_to_ai_training"]
    references = AI / lock["inspected_queries_relative_to_ai_training"]
    for path, expected in ((baseline_path, lock["model_sha256"]),
                           (baseline_report_path, lock["selection_report_sha256"]),
                           (references, lock["inspected_queries_sha256"]),
                           (source / "Dulieu5.csv", D5_SHA), (D5_REPORT, D5_REPORT_SHA)):
        if sha256(path) != expected:
            raise ValueError(f"Frozen input changed: {path.name}")
    previous = json.loads(baseline_report_path.read_text(encoding="utf-8"))
    previous_d5 = json.loads(D5_REPORT.read_text(encoding="utf-8"))
    d5 = [{**row, "id": "Dulieu5:" + row["id"]} for row in read_queries(source / "Dulieu5.csv")]
    assert len(rows) == 282 and len(d5) == 90 and not any(row["id"].startswith("Dulieu5:") for row in rows)
    code_paths = [Path(__file__), PLAN, LOCK, AI / "text_safety/normalization.py", *(
        Path(__file__).with_name(name) for name in ("context_query_model_v13.py", "context_query_model_v12_1.py",
        "context_query_model_v12.py", "context_query_model_v11.py", "context_query_model.py",
        "component_context_query_model.py", "linear_query_model.py", "training.py",
        "experiment_role_context_v11.py", "experiment_financial_context_v12_1.py"))]
    pinned = {str(path.relative_to(AI)): sha256(path) for path in code_paths}
    source_audit.update(v12_1_lock_sha256=sha256(LOCK), v12_1_model_sha256=sha256(baseline_path),
        v12_1_report_sha256=sha256(baseline_report_path), dulieu5_sha256=D5_SHA,
        dulieu5_baseline_report_sha256=D5_REPORT_SHA, plan_sha256=sha256(PLAN), code_sha256=pinned,
        dulieu5_used_for_error_inspection=True, dulieu5_used_for_vocabulary_idf_or_weights=False)
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PLAN, output / "plan_snapshot.md")
    shutil.copyfile(source / "Dulieu5.csv", output / "dulieu5_snapshot.csv")
    write_json(output / "preflight_audit.json", dict(source_audit=source_audit, training_rows=len(rows),
        comparison_rows_dulieu5=len(d5), configuration=CONFIGURATION, training_authorization=True,
        dulieu5_origin="unspecified", deployment_eligible=False))
    snapshot = output / "code_snapshot"
    for path in code_paths:
        destination = snapshot / path.relative_to(AI)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
    indices = {row["id"]: i for i, row in enumerate(rows)}
    results = []
    for old in v9["by_seed"]:
        folds = [[indices[identifier] for identifier in fold["held_ids"]] for fold in old["selection_audit"]]
        flat = [i for fold in folds for i in fold]
        assert len(flat) == len(rows) and set(flat) == set(range(len(rows)))
        predicted = {name: [] for name in ("baseline", "candidate")}
        audits = []
        for i, held in enumerate(folds):
            training = [row for index, row in enumerate(rows) if index not in set(held)]
            testing = [rows[index] for index in held]
            for name, trainer in (("baseline", fit_baseline), ("candidate", fit)):
                predicted[name].extend(predictions(trainer(training), testing))
            audits.append(dict(outer_fold=i, training_ids=[row["id"] for row in training],
                               held_ids=[row["id"] for row in testing]))
        expected = next(result for result in previous["by_seed"] if result["seed"] == old["seed"])["candidate"]
        assert sorted(predicted["baseline"], key=lambda x: x["id"]) == sorted(expected["predictions_by_id"], key=lambda x: x["id"])
        result = {name: score_predictions(items) for name, items in predicted.items()} | dict(seed=old["seed"], fold_audit=audits)
        results.append(result)
        write_json(output / f"seed_{old['seed']}.json", result)
        print(json.dumps(dict(completed_seed=old["seed"], baseline=indicators(result["baseline"]),
                              candidate=indicators(result["candidate"]))), flush=True)
    means = {name: average([result[name] for result in results]) for name in predicted}
    assert all(abs(means["baseline"][key] - lock["candidate_mean"][key]) < 1e-12 for key in means["baseline"])
    d4_means = {name: average([result[name]["by_source"]["Dulieu4"] for result in results]) for name in predicted}
    baseline = load_model(baseline_path)
    assert fit_baseline(rows)["head"] == baseline["head"]
    candidate = fit(rows)
    fingerprint = hashlib.sha256(json.dumps(source_audit, sort_keys=True).encode()).hexdigest()
    candidate.update(model_version=MODEL_VERSION, dataset_version="school-violence-reviewed-query-development-v4",
        combined_dataset_sha256=fingerprint, training_configuration=CONFIGURATION, deployment_eligible=False)
    directory = output / MODEL_VERSION
    directory.mkdir()
    model_path = directory / "model.json.gz"
    with model_path.open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    for split in ("train", "validation", "test"):
        shutil.copyfile(baseline_path.parent / f"{split}.jsonl", directory / f"{split}.jsonl")
    write_json(directory / "training_config.json", CONFIGURATION)
    write_json(directory / "dataset_manifest.json", dict(development_rows=len(rows), source_audit=source_audit,
                                                         deployment_eligible=False))
    saved, engine = load_model(model_path), ThreeLabelEngine(model_path)
    for row in rows + d5:
        scores = predict_scores(saved, row["text"])
        result = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
        assert result["label"] == predict(candidate, row["text"])
        assert all(abs(result["scores"][label] - scores[label]) < 1e-12 for label in LABELS)
        assert abs(sum(scores.values()) - 1) < 1e-12 and all(math.isfinite(x) and 0 <= x <= 1 for x in scores.values())
    d5_results = {name: score_predictions(predictions(model, d5)) for name, model in (("baseline", baseline), ("candidate", saved))}
    assert d5_results["baseline"]["confusion_matrix"] == previous_d5["overall"]["confusion_matrix"]
    for actual, expected in zip(d5_results["baseline"]["predictions_by_id"], previous_d5["predictions_by_id"]):
        assert actual == {"id": "Dulieu5:" + expected["id"], "label": expected["label"], "predicted": expected["predicted"]}
    checks = selection_checks(means["candidate"], means["baseline"], d4_means["candidate"], d4_means["baseline"],
                              indicators(d5_results["candidate"]), indicators(d5_results["baseline"]))
    accepted = all(checks.values())
    selected_path = model_path if accepted else baseline_path
    selected = saved if accepted else baseline
    changes = [dict(id=a["id"], label=a["label"], before=a["predicted"], after=b["predicted"],
                    fixed=a["predicted"] != a["label"] and b["predicted"] == b["label"],
                    regression=a["predicted"] == a["label"] and b["predicted"] != b["label"])
               for a, b in zip(d5_results["baseline"]["predictions_by_id"], d5_results["candidate"]["predictions_by_id"])
               if a["predicted"] != b["predicted"]]
    report = dict(model_version=MODEL_VERSION, source_audit=source_audit, development_rows=len(rows),
        label_counts=dict(Counter(row["label"] for row in rows)), baseline_mean=means["baseline"],
        candidate_mean=means["candidate"], dulieu4_mean=d4_means, by_seed=results,
        dulieu5_development_comparison=d5_results, dulieu5_prediction_changes=changes,
        dulieu5_technical_targets={name: technical_targets(result) for name, result in d5_results.items()},
        selection_checks=checks, candidate_selected=accepted, candidate_artifact=str(model_path.resolve()),
        candidate_model_sha256=sha256(model_path), candidate_model_version=MODEL_VERSION,
        selected_artifact=str(selected_path.resolve()), selected_model_version=selected["model_version"],
        selected_model_sha256=sha256(selected_path), configuration=CONFIGURATION,
        development_training_fit={name: score_predictions(predictions(model, rows)) for name, model in (("baseline", baseline), ("candidate", saved))},
        historical_synthetic_regression={split: evaluate(saved, [json.loads(line) for line in
            (directory / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]) for split in ("validation", "test")},
        service_matches_saved_artifact_rows=len(rows) + len(d5), baseline_oof_and_dulieu5_predictions_reproduced=True,
        evaluation_method="fixed_recipe_grouped_development_cv_and_inspected_Dulieu5_regression",
        independent_final_holdout_evaluated=False, deployment_eligible=False,
        limitations=["Dulieu5 was inspected to design v13; its score is development feedback, not an independent test.",
                     "Dulieu5 does not enter vocabulary, IDF or coefficient training.",
                     "Five seeds repeat the same 282 queries; child/session independence is unverified.",
                     "Local recipient extraction is not a full Vietnamese semantic parser.",
                     "Uncalibrated weighted softmax scores are not risk probabilities."])
    _, _, final_audit, _, _ = locked_inputs(source)
    assert all(source_audit[key] == value for key, value in final_audit.items())
    assert pinned == {str(path.relative_to(AI)): sha256(path) for path in code_paths}
    assert sha256(source / "Dulieu5.csv") == D5_SHA and sha256(D5_REPORT) == D5_REPORT_SHA
    assert sha256(baseline_path) == lock["model_sha256"] and sha256(baseline_report_path) == lock["selection_report_sha256"]
    write_json(output / "evaluation_report.json", report)
    write_json(directory / "evaluation_report.json", report)
    write_json(output / "runtime_check_selection.json", dict(selected_artifact=str(model_path.resolve()),
        selected_model_sha256=sha256(model_path), selected_model_version=MODEL_VERSION, development_rows=len(rows),
        candidate_selected=accepted, experimental_functional_check_only=True, deployment_eligible=False))
    # Future audits must also know that these 90 queries have been inspected.
    inspected = [json.loads(line) for line in references.read_text(encoding="utf-8").splitlines()]
    inspected += [{**row, "split": "inspected"} for row in d5]
    (output / "inspected_queries.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in inspected), encoding="utf-8")
    print(json.dumps(dict(baseline_mean=means["baseline"], candidate_mean=means["candidate"], dulieu4_mean=d4_means,
        dulieu5={name: indicators(result) for name, result in d5_results.items()}, selection_checks=checks,
        candidate_selected=accepted, selected_model=selected["model_version"], changes=changes)), flush=True)
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
