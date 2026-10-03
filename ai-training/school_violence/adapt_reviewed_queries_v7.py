"""Build a non-deployable v7 candidate from reviewed real search queries.

DuLieuThat2 was a blind test for v5/v6, but its labels were subsequently
revised after predictions were seen. It is development data from this point
onward. Cross-validation below selects an update weight; it is not a final
independent performance estimate. Raw queries stay in ignored local artifacts.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import random
import shutil
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

from .adapt_confirmed_errors_v6 import (
    CORRECTED_LABELS,
    PROVENANCE_SHA256,
    REVIEW_SHA256,
    augment,
    read_csv,
    semantic_sha256,
    sha256,
)
from .evaluate_real_world import BACKEND_REJECTED_TEXT, _text_keys
from .predict import load_model
from .training import LABELS, SENSITIVE_PATTERNS, evaluate, predict


MODEL_VERSION = "vi-school-violence-char-nb-v7-query-candidate"
DATASET_VERSION = "school-violence-query-v2.4-plus-reviewed-real-v2"
BASE_MODEL_SHA256 = "610207001150ead8b5db1d5ee438872509e319b05c32b205d091ddd57c29088d"
REAL_REVIEW_SHA256 = "5672f8379aaf309234df0382d5986d1e9210dbbe913daaa7e47413900e23b349"
REAL_LABEL_COUNTS = {"SAFE": 10, "RISK": 42, "HIGH_RISK": 47}
LEGACY_EXTRA_WEIGHT = 1
WEIGHTS = (1, 2, 4, 8, 16, 32, 64, 128, 256)
FOLDS = 5
NEAR_DUPLICATE_RATIO = 0.85
CV_SEED = 20261002
ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "school_violence"


def load_legacy_corrections(review_path: Path, provenance_path: Path) -> list[dict]:
    if sha256(review_path) != REVIEW_SHA256 or sha256(provenance_path) != PROVENANCE_SHA256:
        raise ValueError("The original 12-correction snapshot changed")
    review = read_csv(review_path, ["id", "text", "label"])
    provenance = read_csv(provenance_path, ["id", "label_origin"])
    if len(review) != 94 or [r["id"] for r in review] != [r["id"] for r in provenance]:
        raise ValueError("Original review/provenance IDs do not match")
    selected = [row for row, origin in zip(review, provenance)
                if origin["label_origin"] == "user_explicit_correction"]
    if {row["id"]: row["label"] for row in selected} != CORRECTED_LABELS:
        raise ValueError("Original corrections no longer match the confirmed decisions")
    return selected


def load_real_review(path: Path) -> list[dict]:
    if sha256(path) != REAL_REVIEW_SHA256:
        raise ValueError("DuLieuThat2 review changed; audit labels before training")
    rows = read_csv(path, ["id", "text", "label"])
    if len(rows) != 99 or dict(Counter(row["label"] for row in rows)) != REAL_LABEL_COUNTS:
        raise ValueError("Unexpected DuLieuThat2 label counts")
    seen_text: set[str] = set()
    for row in rows:
        value = " ".join(unicodedata.normalize("NFKC", row["text"]).split())
        if not value or len(value) > 1000 or any(
            ord(char) < 32 and char not in "\t\n\r" or ord(char) == 127 for char in value
        ):
            raise ValueError(f"Invalid text at ID {row['id']}")
        if any(pattern.search(value) for pattern in (*SENSITIVE_PATTERNS, *BACKEND_REJECTED_TEXT)):
            raise ValueError(f"Potential private identifier at ID {row['id']}")
        keys = _text_keys(row["text"])
        if not keys or keys & seen_text:
            raise ValueError(f"Duplicate normalized text at ID {row['id']}")
        seen_text.update(keys)
    return rows


def read_references(base_dir: Path) -> dict[str, list[dict]]:
    references = {}
    for split in ("train", "validation", "test"):
        path = base_dir / f"{split}.jsonl"
        with path.open(encoding="utf-8") as handle:
            references[split] = [json.loads(line) for line in handle if line.strip()]
        if not references[split] or any(row.get("split") != split for row in references[split]):
            raise ValueError(f"Invalid base {split} reference")
    return references


def check_reference_overlap(rows: list[dict], references: dict[str, list[dict]]) -> None:
    known_ids: set[str] = set()
    known_text: set[str] = set()
    for records in references.values():
        for row in records:
            known_ids.update(row.get("source_ids", [row["id"]]))
            known_text.update(_text_keys(row["text"]))
    for row in rows:
        identifier = f"DuLieuThat2:{row['id']}"
        if identifier in known_ids or _text_keys(row["text"]) & known_text:
            raise ValueError(f"Real review overlaps base references at ID {row['id']}")


def make_cv_folds(rows: list[dict], *, seed: int = CV_SEED) -> tuple[list[list[int]], int]:
    """Keep near-identical queries in the same development fold."""
    normalized = [" ".join(unicodedata.normalize("NFKC", row["text"]).casefold().split())
                  for row in rows]
    parent = list(range(len(rows)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if SequenceMatcher(None, normalized[i], normalized[j]).ratio() >= NEAR_DUPLICATE_RATIO:
                parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for index in range(len(rows)):
        groups.setdefault(find(index), []).append(index)
    if any(len({rows[index]["label"] for index in group}) != 1 for group in groups.values()):
        raise ValueError("Near-duplicate queries have conflicting labels")
    ordered = list(groups.values())
    random.Random(seed).shuffle(ordered)
    ordered.sort(key=lambda group: -len(group))
    folds: list[list[int]] = [[] for _ in range(FOLDS)]
    label_counts = [Counter() for _ in range(FOLDS)]
    for group in ordered:
        label = rows[group[0]]["label"]
        fold_index = min(range(FOLDS), key=lambda index:
                         (label_counts[index][label], len(folds[index]), index))
        folds[fold_index].extend(group)
        label_counts[fold_index][label] += len(group)
    if any({rows[index]["label"] for index in fold} != set(LABELS) for fold in folds):
        raise ValueError("Every development fold needs all three labels")
    return folds, len(groups)


def metrics_from_matrix(matrix: dict[str, dict[str, int]]) -> dict:
    per_label = {}
    for label in LABELS:
        tp = matrix[label][label]
        fn = sum(matrix[label].values()) - tp
        fp = sum(matrix[other][label] for other in LABELS if other != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_label[label] = {
            "support": tp + fn, "precision": precision, "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
            "false_positive": fp, "false_negative": fn,
        }
    return {
        "confusion_matrix": matrix,
        "per_label": per_label,
        "macro_f1": sum(per_label[label]["f1"] for label in LABELS) / len(LABELS),
        "high_risk_recall": per_label["HIGH_RISK"]["recall"],
    }


def cross_validate(base_model: dict, rows: list[dict], folds: list[list[int]],
                   weights: tuple[int, ...] = WEIGHTS) -> dict[int, dict]:
    results = {}
    for weight in weights:
        matrix = {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
        for fold in folds:
            held_out = set(fold)
            model = augment(base_model, [row for index, row in enumerate(rows)
                                         if index not in held_out], weight=weight)
            for index in fold:
                actual = rows[index]["label"]
                matrix[actual][predict(model, rows[index]["text"])] += 1
        results[weight] = metrics_from_matrix(matrix)
    return results


def build_candidate(base_dir: Path, real_review_path: Path, legacy_review_path: Path,
                    provenance_path: Path, output_dir: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization for the collected queries is required")
    resolved = output_dir.resolve()
    if not resolved.is_relative_to(ARTIFACT_ROOT.resolve()) or resolved == ARTIFACT_ROOT.resolve():
        raise ValueError("Output must be inside the ignored artifact directory")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"Output directory is not empty: {output_dir}")
    model_path = base_dir / "model.json.gz"
    if sha256(model_path) != BASE_MODEL_SHA256:
        raise ValueError("Unexpected v6 candidate artifact")
    base = load_model(model_path)
    if base.get("model_version") != "vi-school-violence-char-nb-v6-query-candidate":
        raise ValueError("Wrong base model version")
    corrections = load_legacy_corrections(legacy_review_path, provenance_path)
    rows = load_real_review(real_review_path)
    references = read_references(base_dir)
    check_reference_overlap(rows, references)
    folds, group_count = make_cv_folds(rows)
    base_with_corrections = augment(base, corrections, weight=LEGACY_EXTRA_WEIGHT)
    cv = cross_validate(base_with_corrections, rows, folds)
    selected_weight = max(WEIGHTS, key=lambda weight: (cv[weight]["macro_f1"], -weight))
    model = augment(base_with_corrections, rows, weight=selected_weight)
    fingerprint = hashlib.sha256(json.dumps({
        "base_model_sha256": BASE_MODEL_SHA256,
        "legacy_review_sha256": REVIEW_SHA256,
        "real_review_sha256": REAL_REVIEW_SHA256,
        "legacy_extra_weight": LEGACY_EXTRA_WEIGHT,
        "real_weight": selected_weight,
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    configuration = {
        "algorithm": "weighted_character_ngram_naive_bayes_update",
        "base_model_sha256": BASE_MODEL_SHA256,
        "legacy_extra_weight": LEGACY_EXTRA_WEIGHT,
        "real_weight_candidates": list(WEIGHTS),
        "selected_real_weight": selected_weight,
        "selection_method": "five_fold_near_duplicate_grouped_development_cv_macro_f1",
        "near_duplicate_ratio": NEAR_DUPLICATE_RATIO,
        "cv_seed": CV_SEED,
        "original_blind_test_reused_for_development": True,
        "final_independent_test_available": False,
        "input_columns": ["text"],
    }
    model.update(
        model_version=MODEL_VERSION,
        dataset_version=DATASET_VERSION,
        combined_dataset_sha256=fingerprint,
        training_configuration=configuration,
        deployment_eligible=False,
    )
    legacy_fit = sum(predict(model, row["text"]) == row["label"] for row in corrections)
    report = {
        "model_version": MODEL_VERSION,
        "source_audit": {"combined_dataset_sha256": fingerprint},
        "base_model_sha256": BASE_MODEL_SHA256,
        "real_review_sha256": REAL_REVIEW_SHA256,
        "real_label_counts": REAL_LABEL_COUNTS,
        "legacy_review_sha256": REVIEW_SHA256,
        "provenance_sha256": PROVENANCE_SHA256,
        "configuration": configuration,
        "development_cv": {
            "fold_count": FOLDS,
            "near_duplicate_group_count": group_count,
            "fold_label_counts": [dict(Counter(rows[index]["label"] for index in fold))
                                  for fold in folds],
            "by_weight": {str(weight): cv[weight] for weight in WEIGHTS},
            "selected_weight": selected_weight,
            "selection_uses_same_99_reviewed_queries": True,
        },
        "development_training_fit": evaluate(model, rows),
        "legacy_correction_training_fit": {"correct": legacy_fit, "total": len(corrections)},
        "historical_synthetic_validation_regression": evaluate(model, references["validation"]),
        "historical_synthetic_test_regression": evaluate(model, references["test"]),
        "independent_final_holdout_evaluated": False,
        "operator_asserted_training_authorization": True,
        "permission_verified_by_code": False,
        "deployment_eligible": False,
        "limitations": [
            "DuLieuThat2 labels were revised after v5/v6 predictions were inspected.",
            "The development cross-validation also selects the update weight, so its score is not a final independent estimate.",
            "Near-duplicate character grouping cannot prove independence by child, session or meaning.",
            "Only ten SAFE queries are present; false-alert performance remains uncertain.",
            "The historical synthetic validation and test sets are regression checks, not release gates.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for split in ("train", "validation", "test"):
        shutil.copyfile(base_dir / f"{split}.jsonl", output_dir / f"{split}.jsonl")
    with (output_dir / "train.jsonl").open("a", encoding="utf-8") as handle:
        for row in rows:
            identifier = f"DuLieuThat2:{row['id']}"
            handle.write(json.dumps({
                "id": identifier, "source_ids": [identifier], "text": row["text"],
                "label": row["label"], "split": "train", "source": "user_reviewed_query",
                "review_status": "user_labeled", "group_ids": [],
            }, ensure_ascii=False) + "\n")
    with gzip.open(output_dir / "model.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, separators=(",", ":"))
    for name, payload in (
        ("evaluation_report.json", report),
        ("training_config.json", configuration),
        ("dataset_manifest.json", {
            "dataset_version": DATASET_VERSION,
            "combined_dataset_sha256": fingerprint,
            "base_model_sha256": BASE_MODEL_SHA256,
            "real_review_sha256": REAL_REVIEW_SHA256,
            "real_label_counts": REAL_LABEL_COUNTS,
            "real_rows_added_to_training": len(rows),
            "legacy_corrections_reweighted": len(corrections),
            "deployment_eligible": False,
        }),
    ):
        (output_dir / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-artifact", required=True, type=Path)
    parser.add_argument("--real-review", required=True, type=Path)
    parser.add_argument("--legacy-review", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    report = build_candidate(args.base_artifact, args.real_review, args.legacy_review,
                             args.provenance, args.output_dir, authorized=args.authorized)
    print(json.dumps({
        "model_version": report["model_version"],
        "selected_weight": report["configuration"]["selected_real_weight"],
        "development_cv_macro_f1": report["development_cv"]["by_weight"][
            str(report["configuration"]["selected_real_weight"])]["macro_f1"],
        "deployment_eligible": False,
    }))


if __name__ == "__main__":
    main()
