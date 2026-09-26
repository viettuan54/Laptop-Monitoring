"""Apply one human three-label decision per CSV row without editing the source."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from school_violence.training import LABELS


ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


def apply_reviews(source: Path, decisions: Path, output: Path) -> dict:
    if output.exists():
        raise FileExistsError("Reviewed output already exists")
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        if not {"id", "text", "label", "split", "source", "review_status"}.issubset(fields):
            raise ValueError("Source CSV lacks required three-label columns")
        rows = list(reader)
    reviews = {}
    with decisions.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            decision = json.loads(line)
            if set(decision) != {"id", "label", "annotator_id"}:
                raise ValueError(f"Review line {number} has missing or extra fields")
            identifier = decision["id"]
            if (not isinstance(identifier, str) or not ID_PATTERN.fullmatch(identifier)
                    or not isinstance(decision["annotator_id"], str)
                    or not ID_PATTERN.fullmatch(decision["annotator_id"])
                    or decision["label"] not in LABELS or identifier in reviews):
                raise ValueError(f"Invalid or duplicate review at line {number}")
            reviews[identifier] = decision
    ids = [row["id"] for row in rows]
    if len(set(ids)) != len(ids) or set(ids) != set(reviews):
        raise ValueError("Each source ID must have exactly one review decision")
    output_rows = []
    for row in rows:
        row = dict(row)
        row["label"] = reviews[row["id"]]["label"]
        row["review_status"] = "reviewed"
        row["annotator_id"] = reviews[row["id"]]["annotator_id"]
        output_rows.append(row)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields + (["annotator_id"] if "annotator_id" not in fields else []))
        writer.writeheader()
        writer.writerows(output_rows)
    return {"rows": len(output_rows), "labels": {label: sum(row["label"] == label for row in output_rows) for label in LABELS}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--decisions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(apply_reviews(args.input, args.decisions, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
