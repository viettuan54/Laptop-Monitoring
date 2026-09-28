"""Apply explicit human decisions to a subset of rows without editing the source."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

from school_violence.training import LABELS
from text_safety.normalization import normalize_text


ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


def apply_reviews(source: Path, decisions: Path, output: Path,
                  *, dataset_version: str | None = None) -> dict:
    if output.exists():
        raise FileExistsError("Reviewed output already exists")
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        if not {"id", "text", "label", "split", "source", "review_status"}.issubset(fields):
            raise ValueError("Source CSV lacks required three-label columns")
        rows = list(reader)
    if not rows:
        raise ValueError("Source CSV is empty")
    if "dataset_version" in fields:
        source_versions = {row["dataset_version"] for row in rows}
        if (not isinstance(dataset_version, str) or not dataset_version.strip()
                or dataset_version.strip() in source_versions):
            raise ValueError("Reviewed CSV requires a new non-empty dataset_version")
        dataset_version = dataset_version.strip()
    elif dataset_version is not None:
        raise ValueError("Cannot set dataset_version when source lacks that column")
    reviews = {}
    decisions_bytes = decisions.read_bytes()
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
    if not reviews or len(set(ids)) != len(ids) or not set(reviews).issubset(ids):
        raise ValueError("Provide at least one decision, with known unique source IDs")
    original_group_labels = {}
    for row in rows:
        if row.get("group_id"):
            original_group_labels.setdefault(row["group_id"], set()).add(row["label"])
    output_rows = []
    for row in rows:
        row = dict(row)
        if row["label"] not in LABELS or row["review_status"] not in ("", "unreviewed", "reviewed"):
            raise ValueError("Invalid source label or review_status")
        if row["id"] in reviews:
            row["label_before_human_review"] = row["label"]
            row["label"] = reviews[row["id"]]["label"]
            row["review_status"] = "reviewed"
            row["annotator_id"] = reviews[row["id"]]["annotator_id"]
            if "annotation_status" in fields:
                row["annotation_status"] = "human_reviewed"
        elif row["review_status"] == "reviewed" and not row.get("annotator_id"):
            raise ValueError("Existing reviewed row has no annotator_id")
        else:
            if row["review_status"] != "reviewed" and row.get("annotator_id"):
                raise ValueError("Unreviewed source row has an annotator_id")
            row.setdefault("annotator_id", "")
            row.setdefault("label_before_human_review", "")
            if not row["review_status"]:
                row["review_status"] = "unreviewed"
        if dataset_version is not None:
            row["dataset_version"] = dataset_version
        output_rows.append(row)
    # Reject a partial decision that contradicts an equivalent still-pending
    # example. The annotator must explicitly decide all such variants.
    labels_by_equivalent_text = {}
    for row in output_rows:
        keys = {normalize_text(row["text"]).folded}
        if row.get("text_normalized"):
            keys.add(normalize_text(row["text_normalized"]).folded)
        for key in keys:
            if key in labels_by_equivalent_text and labels_by_equivalent_text[key] != row["label"]:
                raise ValueError("Conflicting labels for equivalent rows; review all linked variants")
            labels_by_equivalent_text[key] = row["label"]
    revised_group_labels = {}
    for row in output_rows:
        if row.get("group_id"):
            revised_group_labels.setdefault(row["group_id"], set()).add(row["label"])
    for group_id, labels in revised_group_labels.items():
        if len(original_group_labels[group_id]) == 1 and len(labels) > 1:
            raise ValueError("Conflicting labels in an originally single-label group; review linked variants")
    output.parent.mkdir(parents=True, exist_ok=True)
    extra_fields = [field for field in ("annotator_id", "label_before_human_review") if field not in fields]
    with output.open("x", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields + extra_fields)
        writer.writeheader()
        writer.writerows(output_rows)
    return {"rows": len(output_rows), "decisions_applied": len(reviews),
            "reviewed_rows": sum(row["review_status"] == "reviewed" for row in output_rows),
            "changed_labels": sum(row["id"] in reviews and row["label_before_human_review"] != row["label"]
                                  for row in output_rows),
            "dataset_version": dataset_version,
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "decisions_sha256": hashlib.sha256(decisions_bytes).hexdigest(),
            "labels": {label: sum(row["label"] == label for row in output_rows) for label in LABELS}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--decisions", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--dataset-version", help="Required new version when the input CSV has dataset_version")
    args = parser.parse_args()
    print(json.dumps(apply_reviews(args.input, args.decisions, args.output,
                                   dataset_version=args.dataset_version), ensure_ascii=False))


if __name__ == "__main__":
    main()
