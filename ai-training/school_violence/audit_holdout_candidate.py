"""Audit a proposed holdout without treating metadata claims as verified facts.

The report contains counts and IDs only, never raw text. Passing this audit is
not evidence of consent, human review, de-identification, or deployment safety.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

from .evaluate_real_world import (
    PLACEHOLDER_PERMISSION_REFERENCES, REQUIRED, SOURCE_TYPES, _text_keys, load_holdout,
)
from .training import LABELS


PLACEHOLDER_PERMISSION = {"", *PLACEHOLDER_PERMISSION_REFERENCES}


def audit_candidate(path: Path) -> dict:
    raw = path.read_bytes()
    issues: dict[str, list[str]] = defaultdict(list)
    rows: list[dict] = []
    seen_ids: set[str] = set()
    seen_text: set[str] = set()
    try:
        lines = raw.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as error:
        raise ValueError("Candidate must be UTF-8 JSONL") from error

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            issues["invalid_json"].append(f"line:{line_number}")
            continue
        if not isinstance(row, dict):
            issues["non_object_row"].append(f"line:{line_number}")
            continue
        identifier = row.get("id")
        identifier = identifier if isinstance(identifier, str) and identifier.strip() else f"line:{line_number}"
        rows.append(row)
        if not REQUIRED.issubset(row):
            issues["missing_required_fields"].append(identifier)
        if identifier in seen_ids:
            issues["duplicate_id"].append(identifier)
        seen_ids.add(identifier)
        if row.get("label") not in LABELS:
            issues["invalid_label"].append(identifier)
        if row.get("source_type") not in SOURCE_TYPES:
            issues["invalid_source_type"].append(identifier)
        if row.get("source") != "real_world" or row.get("split") != "test":
            issues["not_real_world_test_declaration"].append(identifier)
        if row.get("review_status") != "reviewed":
            issues["review_not_declared"].append(identifier)
        if row.get("pii_removed") is not True:
            issues["pii_removal_not_declared"].append(identifier)
        permission = str(row.get("permission_reference") or "").strip().lower()
        if permission in PLACEHOLDER_PERMISSION:
            issues["permission_reference_placeholder"].append(identifier)
        text = row.get("text")
        if not isinstance(text, str) or not text.strip():
            issues["empty_text"].append(identifier)
        else:
            keys = _text_keys(text)
            if keys & seen_text:
                issues["duplicate_normalized_text"].append(identifier)
            seen_text.update(keys)

    by_source = defaultdict(set)
    for row in rows:
        if row.get("source_type") in SOURCE_TYPES and row.get("label") in LABELS:
            by_source[row["source_type"]].add(row["label"])
    missing_strata = {
        source_type: sorted(set(LABELS) - by_source[source_type])
        for source_type in sorted(set(by_source) | {"search_query"})
        if by_source[source_type] != set(LABELS)
    }
    if missing_strata:
        issues["missing_source_label_strata"].extend(
            f"{source_type}:{label}" for source_type, labels in missing_strata.items() for label in labels
        )

    schema_ready = not issues
    if schema_ready:
        try:
            load_holdout(path)
        except ValueError as error:
            schema_ready = False
            issues["official_validator_rejected"].append(str(error))
    return {
        "candidate_sha256": hashlib.sha256(raw).hexdigest(),
        "rows": len(rows),
        "label_counts": dict(Counter(
            row.get("label") if isinstance(row.get("label"), str) else "<invalid>" for row in rows
        )),
        "source_type_counts": dict(Counter(
            row.get("source_type") if isinstance(row.get("source_type"), str) else "<invalid>"
            for row in rows
        )),
        "issues": {code: {"count": len(ids), "ids": ids} for code, ids in sorted(issues.items())},
        "schema_ready_for_official_evaluator": schema_ready,
        "group_metadata_supplied": bool(rows) and all("group_id" in row for row in rows),
        "same_child_or_session_independence_verified": False,
        "provenance_and_review_verified_by_code": False,
        "deployment_eligible": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="Optional JSON report path; existing files are never overwritten")
    args = parser.parse_args()
    report = audit_candidate(args.candidate)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        if args.output.exists():
            parser.error("Output report already exists")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(json.dumps({
        "rows": report["rows"],
        "issues": {code: value["count"] for code, value in report["issues"].items()},
        "schema_ready_for_official_evaluator": report["schema_ready_for_official_evaluator"],
        "output": str(args.output) if args.output else None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
