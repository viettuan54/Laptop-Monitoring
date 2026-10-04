"""Summarize repeated development errors without copying search text."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v8 import (
    ARTIFACT_ROOT,
    CV_SEEDS,
    MODEL_VERSION,
    cross_validate,
    development_rows,
)
from .predict import load_model
from .training import LABELS


V8_MODEL_SHA256 = "ab55715bb011c4735349b3d340bd0aa6502286f29c08a5fc2f8a1fc35d9d9134"


def summarize_errors(rows: list[dict], results: list[dict]) -> dict:
    seeds = [result["seed"] for result in results]
    if len(seeds) != len(set(seeds)) or not results:
        raise ValueError("Development seeds must be distinct and non-empty")
    labels = {row["id"]: row["label"] for row in rows}
    if len(labels) != len(rows):
        raise ValueError("Development IDs must be unique")
    wrong_count: Counter[str] = Counter()
    wrong_predictions: dict[str, Counter[str]] = defaultdict(Counter)
    by_seed = []
    for result in results:
        seen: set[str] = set()
        for error in result["errors_by_id"]:
            identifier = error["id"]
            if (identifier not in labels or identifier in seen
                    or error["label"] != labels[identifier]
                    or error["predicted"] not in LABELS
                    or error["predicted"] == error["label"]):
                raise ValueError("Invalid out-of-fold error record")
            seen.add(identifier)
            wrong_count[identifier] += 1
            wrong_predictions[identifier][error["predicted"]] += 1
        matrix = result["confusion_matrix"]
        if (any(sum(matrix[label].values()) != sum(value == label for value in labels.values())
                for label in LABELS)
                or sum(matrix[actual][predicted]
                       for actual in LABELS for predicted in LABELS
                       if actual != predicted) != len(seen)):
            raise ValueError("Out-of-fold errors do not match the confusion matrix")
        by_seed.append({
            "seed": result["seed"],
            "macro_f1": result["macro_f1"],
            "confusion_matrix": result["confusion_matrix"],
        })
    return {
        "development_rows": len(rows),
        "label_counts": dict(Counter(labels.values())),
        "fold_seeds": seeds,
        "by_seed": by_seed,
        "error_frequency": [
            {"id": row["id"], "label": row["label"],
             "wrong_count": wrong_count[row["id"]],
             "wrong_predictions": dict(wrong_predictions[row["id"]])}
            for row in rows if wrong_count[row["id"]]
        ],
        "contains_query_text": False,
        "independent_test": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--review2", required=True, type=Path)
    parser.add_argument("--review3", required=True, type=Path)
    parser.add_argument("--legacy-review", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ARTIFACT_ROOT.resolve()) or output == ARTIFACT_ROOT.resolve():
        parser.error("Output must be inside the ignored artifact directory")
    if output.exists():
        parser.error("Output already exists")
    if sha256(args.artifact) != V8_MODEL_SHA256:
        parser.error("Unexpected v8 model artifact")
    model = load_model(args.artifact)
    if model.get("model_version") != MODEL_VERSION or model.get("deployment_eligible") is not False:
        parser.error("Expected non-deployable v8 candidate")
    rows = development_rows(args.review2, args.review3, args.legacy_review,
                            args.provenance)
    results = [cross_validate(rows, seed=seed) for seed in CV_SEEDS]
    report = summarize_errors(rows, results)
    report["model_sha256"] = V8_MODEL_SHA256
    report["review_sha256"] = {
        "DuLieuThat1": sha256(args.legacy_review),
        "DuLieuThat2": sha256(args.review2),
        "DuLieuThat3": sha256(args.review3),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    print(json.dumps({"report": str(output), "rows": len(rows),
                      "seeds": len(CV_SEEDS), "contains_query_text": False}))


if __name__ == "__main__":
    main()
