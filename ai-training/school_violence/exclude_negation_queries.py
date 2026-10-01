"""Create a new query CSV without the v2.2 synthetic negation cohort.

The decision is based on the source's query_type annotation, not a keyword.
Questions such as "co ai giup em khong" must remain in the corpus.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


EXCLUDED_QUERY_TYPE = "negation_hard_negative"
SOURCE_VERSION = "v2.2"
OUTPUT_VERSION = "v2.3"


def build_filtered_query(source: Path, output: Path, manifest: Path) -> dict:
    if output.exists() or manifest.exists() or output.resolve() == source.resolve():
        raise FileExistsError("Output and manifest must be new files separate from the source")
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        if not {"id", "text", "label", "query_type", "group_id", "split", "dataset_version"}.issubset(fields):
            raise ValueError("Input must be a versioned school-violence query CSV")
        rows = list(reader)
    if not rows or {row["dataset_version"] for row in rows} != {SOURCE_VERSION}:
        raise ValueError("Input must contain only v2.2 query records")
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Input contains duplicate IDs")

    excluded = [row for row in rows if row["query_type"] == EXCLUDED_QUERY_TYPE]
    if not excluded:
        raise ValueError("Input contains no annotated negation cohort")
    retained = [dict(row, dataset_version=OUTPUT_VERSION) for row in rows
                if row["query_type"] != EXCLUDED_QUERY_TYPE]
    report = {
        "dataset_version": OUTPUT_VERSION,
        "source_file": source.name,
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "filter": f"query_type == {EXCLUDED_QUERY_TYPE}",
        "source_rows": len(rows),
        "retained_rows": len(retained),
        "excluded_rows": len(excluded),
        "excluded_ids": [row["id"] for row in excluded],
        "excluded_by_split": dict(Counter(row["split"] for row in excluded)),
        "excluded_by_label": dict(Counter(row["label"] for row in excluded)),
        "retained_by_split": dict(Counter(row["split"] for row in retained)),
        "retained_by_label": dict(Counter(row["label"] for row in retained)),
        "source_unchanged": True,
        "human_review_claimed": False,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(retained)
    report["output_sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    base = Path(__file__).resolve().parents[2] / "Mô tả"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=base / "laptopmonitoring_query_dataset_v2_2.csv")
    parser.add_argument("--output", type=Path, default=base / "laptopmonitoring_query_dataset_v2_3.csv")
    parser.add_argument("--manifest", type=Path, default=base / "query_dataset_v2_3_filter_report.json")
    args = parser.parse_args()
    report = build_filtered_query(args.input, args.output, args.manifest)
    print(json.dumps({key: report[key] for key in (
        "source_rows", "retained_rows", "excluded_rows", "excluded_by_split", "excluded_by_label"
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
