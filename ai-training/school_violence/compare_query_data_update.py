"""Paired development audit of adding Dulieu4 to the unchanged v8 recipe.

Reuse the completed v9 outer folds, not their held text for any selection.
This audit changes neither the chosen configuration nor the locked artifact.
"""

import argparse
import json
from pathlib import Path

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .adapt_reviewed_queries_v9 import BASE, average, fit, indicators, score_predictions
from .training import predict


def run(selection: Path, output: Path) -> dict:
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.exists():
        raise ValueError("Output must be a new ignored artifact file")
    report = json.loads(selection.read_text(encoding="utf-8"))
    model_path = Path(report["selected_artifact"])
    if not model_path.resolve().is_relative_to(root):
        raise ValueError("Candidate must be a local ignored artifact")
    if sha256(model_path) != report["selected_model_sha256"]:
        raise ValueError("Selected model changed")
    train_path = model_path.parent / "train.jsonl"
    rows = [json.loads(line) for line in train_path.read_text(encoding="utf-8").splitlines()]
    all_ids = {row["id"] for row in rows}
    if len(all_ids) != len(rows) or len(rows) != report["development_rows"]:
        raise ValueError("Unexpected candidate development rows")
    results = []
    for seed in report["by_seed"]:
        predictions, fold_audit, seen = [], [], set()
        for fold in seed["selection_audit"]:
            held = set(fold["held_ids"])
            if held & seen or not held <= all_ids:
                raise ValueError("Invalid saved outer folds")
            seen |= held
            old_train = [row for row in rows if row["id"] not in held
                         and not row["id"].startswith("Dulieu4:")]
            model = fit(old_train, BASE)
            fold_audit.append(dict(held_ids=fold["held_ids"],
                                   old_training_ids=[row["id"] for row in old_train]))
            predictions.extend(dict(id=row["id"], label=row["label"],
                                    predicted=predict(model, row["text"]))
                               for row in rows if row["id"] in held)
        if seen != all_ids:
            raise ValueError("Saved folds do not cover every query")
        results.append(dict(seed=seed["seed"], old_data_only=score_predictions(predictions),
                            expanded_data=seed["baseline"], fold_audit=fold_audit))
    payload = dict(selection_report_sha256=sha256(selection),
                   candidate_model_sha256=sha256(model_path), train_jsonl_sha256=sha256(train_path),
                   old_recipe_data_only_mean=average([x["old_data_only"] for x in results]),
                   expanded_recipe_data_mean=average([x["expanded_data"] for x in results]),
                   by_seed=results, configuration_unchanged=BASE,
                   did_not_change_candidate_selection=True, independent_final_holdout_evaluated=False,
                   deployment_eligible=False,
                   limitations=["Post-selection explanatory audit, not an independent performance test.",
                                "Same held queries/folds and v8 recipe; only available training sources differ.",
                                "The old-data models omit each fold's held old queries; they are not the frozen v8 artifact."])
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "old_recipe_data_only_mean", "expanded_recipe_data_mean", "deployment_eligible")}), flush=True)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.selection_report, args.output)


if __name__ == "__main__":
    main()
