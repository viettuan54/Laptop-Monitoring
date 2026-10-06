"""Predeclared four-profile context ablation on frozen development folds."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from functools import lru_cache
from pathlib import Path

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .adapt_reviewed_queries_v9 import average, indicators, score_predictions, write_json
from .component_context_query_model import ALGORITHM, PROFILES, query_features
from .experiment_context_queries_v10 import fit_model as fit_v10
from .experiment_role_context_v11 import CONFIGURATION, WATCH_IDS, fit as fit_context, locked_inputs
from .training import predict

PLAN = Path(__file__).with_name("V12_ABLATION_PLAN.md")
PREVIOUS_LOCK = Path(__file__).with_name("query_v11_experiment.lock.json")


@lru_cache(maxsize=4096)
def training_keys(text: str, profile: str) -> frozenset[str]:
    return frozenset(query_features(text, profile))


def fit(rows: list[dict], profile: str) -> dict:
    if profile not in PROFILES:
        raise ValueError("Unknown context component profile")
    model = fit_context(rows, feature_keys=lambda text: training_keys(text, profile), algorithm=ALGORITHM)
    return {**model, "context_profile": profile}


def compare(rows: list[dict], folds: list[list[int]]) -> dict:
    flat = [i for fold in folds for i in fold]
    if len(flat) != len(rows) or set(flat) != set(range(len(rows))):
        raise ValueError("Frozen folds must hold each query exactly once")
    predictions = {name: [] for name in ("v10", *PROFILES)}
    audit = []
    for index, fold in enumerate(folds):
        held = set(fold)
        train = [row for i, row in enumerate(rows) if i not in held]
        models = {"v10": fit_v10(train, "flat_context_high3")}
        models.update({name: fit(train, name) for name in PROFILES})
        for name, model in models.items():
            predictions[name].extend(dict(id=rows[i]["id"], label=rows[i]["label"],
                                          predicted=predict(model, rows[i]["text"])) for i in fold)
        audit.append(dict(outer_fold=index, held_ids=[rows[i]["id"] for i in fold],
                          training_ids=[row["id"] for row in train]))
    return {name: score_predictions(values) for name, values in predictions.items()} | {"fold_audit": audit}


def run(source: Path, output: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization is required")
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    rows, reference, audit, _, fixed_v10 = locked_inputs(source)
    ai = Path(__file__).resolve().parents[1]
    old_lock = json.loads(PREVIOUS_LOCK.read_text(encoding="utf-8"))
    trial = next(t for t in old_lock["trials"] if t["name"] == "v11_full_context")
    report_path = ai / trial["evaluation_report_relative_to_ai_training"]
    if sha256(report_path) != trial["evaluation_report_sha256"]:
        raise ValueError("V11 reference report changed")
    original = json.loads(report_path.read_text(encoding="utf-8"))
    paths = [Path(__file__), Path(__file__).with_name("component_context_query_model.py"),
             Path(__file__).with_name("context_query_model_v11.py"), Path(__file__).with_name("training.py"),
             Path(__file__).with_name("experiment_role_context_v11.py")]
    audit.update(plan_sha256=sha256(PLAN), previous_lock_sha256=sha256(PREVIOUS_LOCK),
                 v11_reference_sha256=sha256(report_path), profiles=PROFILES, configuration=CONFIGURATION,
                 code_sha256={path.name: sha256(path) for path in paths})
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / "preflight_audit.json", dict(source_audit=audit, development_rows=len(rows),
        label_counts=dict(Counter(row["label"] for row in rows)), authorized=True,
        all_source_labels_preserved=True, deployment_eligible=False))
    indices = {row["id"]: i for i, row in enumerate(rows)}
    results = []
    for old in reference["by_seed"]:
        folds = [[indices[identifier] for identifier in fold["held_ids"]] for fold in old["selection_audit"]]
        result = compare(rows, folds) | {"seed": old["seed"]}
        full_reference = next(item for item in original["by_seed"] if item["seed"] == old["seed"])
        if result["v11_full"]["confusion_matrix"] != full_reference["candidate"]["confusion_matrix"]:
            raise AssertionError("Full v11 ablation does not reproduce the locked result")
        results.append(result)
        write_json(output / f"ablation_seed_{old['seed']}.json", result)
        print(json.dumps(dict(completed_seed=old["seed"], metrics={name: indicators(result[name])
                              for name in ("v10", *PROFILES)})), flush=True)
    means = {name: average([result[name] for result in results]) for name in ("v10", *PROFILES)}
    if any(abs(means["v10"][key] - fixed_v10["mean"][key]) > 1e-12 for key in means["v10"]):
        raise AssertionError("V10 baseline does not reproduce the locked audit")
    by_d4 = {name: average([result[name]["by_source"]["Dulieu4"] for result in results])
             for name in ("v10", *PROFILES)}
    report = dict(source_audit=audit, development_rows=len(rows), mean_by_profile=means,
        dulieu4_mean_by_profile=by_d4, by_seed=results, groups_are_disjoint=True,
        all_source_labels_preserved=True, v10_and_full_v11_reproduced=True,
        watched_ids_out_of_fold={identifier: {name: [next(row["predicted"] for row in result[name]["predictions_by_id"]
            if row["id"] == identifier) for result in results] for name in ("v10", *PROFILES)} for identifier in WATCH_IDS},
        independent_final_holdout_evaluated=False, deployment_eligible=False,
        candidate_selected=False, evaluation_method="fixed_recipe_feature_ablation_on_inspected_development_queries",
        limitations=["Ablation groups remove feature columns, not the underlying phrase/role parser.",
                     "Same inspected development queries reused across five seeds; no independent-test claim.",
                     "Feature groups interact through normalization and training; effects need not be additive.",
                     "This diagnostic does not select or deploy a model."])
    _, _, final_audit, _, _ = locked_inputs(source)
    if any(final_audit[key] != audit[key] for key in final_audit):
        raise RuntimeError("Sources or locked baseline changed")
    if sha256(PLAN) != audit["plan_sha256"] or sha256(PREVIOUS_LOCK) != audit["previous_lock_sha256"]:
        raise RuntimeError("Plan or previous lock changed")
    if {path.name: sha256(path) for path in paths} != audit["code_sha256"]:
        raise RuntimeError("Code changed during ablation")
    write_json(output / "ablation_report.json", report)
    training_keys.cache_clear()
    print(json.dumps(dict(mean_by_profile=means, dulieu4_mean_by_profile=by_d4,
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
