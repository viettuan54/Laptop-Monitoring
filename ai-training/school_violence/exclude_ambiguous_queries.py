"""Version query v2.3 after excluding 13 user-confirmed test-label disagreements.

The user confirmed the model's HIGH_RISK predictions for these test rows, whose
stored labels are RISK. Removing them changes only the test set, not training.
The resulting test score is diagnostic, not an unbiased quality estimate.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


SOURCE_VERSION = "v2.3"
OUTPUT_VERSION = "v2.4"
SOURCE_SHA256 = "b0b95d6d8b9e26f37c4c4384ae5b432fcfc2cf6752ddeeb57bfdb067ad8dd8b0"
BASELINE_MODEL_SHA256 = "a7ecf2eeb0191bb6c0c626000b2302f5a465542cded77d0c95780b5cbd4bac85"
EXCLUDED_IDS = (
    "Q_002005", "Q_002010", "Q_002013", "Q_002029", "Q_002036",
    "Q_002044", "Q_002053", "Q_002057", "Q_002058", "Q_003402",
    "Q_003706", "Q_003708", "Q_003709",
)


def build_filtered_query(
    source: Path, output: Path, manifest: Path, *,
    expected_source_sha256: str = SOURCE_SHA256,
    excluded_ids: tuple[str, ...] = EXCLUDED_IDS,
) -> dict:
    if output.exists() or manifest.exists() or len({source.resolve(), output.resolve(), manifest.resolve()}) != 3:
        raise FileExistsError("Output and manifest must be new files separate from the source")
    raw = source.read_bytes()
    source_sha256 = hashlib.sha256(raw).hexdigest()
    if source_sha256 != expected_source_sha256:
        raise ValueError("Source CSV SHA-256 differs from the reviewed v2.3 version")
    if len(excluded_ids) != 13 or len(set(excluded_ids)) != 13:
        raise ValueError("Exclusion list must contain exactly 13 unique IDs")
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        if len(fields) != len(set(fields)) or not {
            "id", "text", "label", "query_type", "group_id", "split", "dataset_version"
        }.issubset(fields):
            raise ValueError("Input must be a versioned school-violence query CSV")
        rows = list(reader)
    if not rows or {row["dataset_version"] for row in rows} != {SOURCE_VERSION}:
        raise ValueError("Input must contain only v2.3 query records")
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Input contains duplicate IDs")
    by_id = {row["id"]: row for row in rows}
    if set(excluded_ids) - by_id.keys():
        raise ValueError("One or more exclusion IDs are absent from the source")
    group_counts = Counter(row["group_id"] for row in rows)
    excluded = [by_id[identifier] for identifier in excluded_ids]
    for row in excluded:
        if (row["label"], row["split"], row["query_type"]) != (
            "RISK", "test", "very_short_or_ambiguous"
        ) or group_counts[row["group_id"]] != 1:
            raise ValueError(f"Exclusion metadata or group membership changed: {row['id']}")
    retained = [dict(row, dataset_version=OUTPUT_VERSION) for row in rows
                if row["id"] not in excluded_ids]
    report = {
        "dataset_version": OUTPUT_VERSION,
        "source_file": source.name,
        "source_sha256": source_sha256,
        "selection_basis": "13 test-only ambiguous rows labeled RISK; user confirmed v4-query HIGH_RISK predictions were correct",
        "filter_scope": "test_only",
        "excluded_rows_original_test_label": "RISK",
        "excluded_rows_user_confirmed_model_label": "HIGH_RISK",
        "baseline_model_sha256": BASELINE_MODEL_SHA256,
        "test_score_independent": False,
        "source_rows": len(rows),
        "retained_rows": len(retained),
        "excluded_rows": len(excluded),
        "excluded_ids": list(excluded_ids),
        "excluded_by_split": dict(Counter(row["split"] for row in excluded)),
        "excluded_by_label": dict(Counter(row["label"] for row in excluded)),
        "retained_by_split": dict(Counter(row["split"] for row in retained)),
        "retained_by_label": dict(Counter(row["label"] for row in retained)),
        "source_unchanged": True,
        "retained_rows_human_review_claimed": False,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(retained)
    report["output_sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    with manifest.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main() -> None:
    base = Path(__file__).resolve().parents[2] / "Mô tả"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=base / "laptopmonitoring_query_dataset_v2_3.csv")
    parser.add_argument("--output", type=Path, default=base / "laptopmonitoring_query_dataset_v2_4.csv")
    parser.add_argument("--manifest", type=Path, default=base / "query_dataset_v2_4_filter_report.json")
    args = parser.parse_args()
    report = build_filtered_query(args.input, args.output, args.manifest)
    print(json.dumps({key: report[key] for key in (
        "source_rows", "retained_rows", "excluded_rows", "excluded_by_split", "excluded_by_label"
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
