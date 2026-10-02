"""Evaluate a frozen three-label model on a separately collected real-world holdout.

The input must be consented/permitted, de-identified and human-labelled. These
metadata claims cannot be authenticated by code. No real text is copied into
the report, and a successful run never approves the model for deployment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from text_safety.normalization import normalize_text

from .predict import load_model
from . import training


SOURCE_TYPES = ("search_query", "page_content")
PLACEHOLDER_PERMISSION_REFERENCES = {
    "unknown", "n/a", "na", "none", "not_applicable_synthetic",
}
REQUIRED = {
    "id", "text", "label", "source_type", "split",
    "source", "review_status", "pii_removed",
    "permission_reference", "dataset_version",
}
BACKEND_REJECTED_TEXT = (
    re.compile(r"https?://\S+", re.IGNORECASE),
    re.compile(r"\b(?:password|passwd|mật khẩu|api[_ -]?key|token|secret)\s*[:=]", re.IGNORECASE),
    re.compile(r"\bbearer\s+\S+", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
)


def _nonempty_string(row: dict, key: str, line_number: int) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Line {line_number}: {key} must be a non-empty string")
    return value.strip()


def _text_keys(text: str) -> set[str]:
    keys = {normalize_text(text).folded}
    if "\n" in text:
        body = normalize_text(text.split("\n", 1)[1]).folded
        if body:
            keys.add(body)
    return keys - {""}


def load_holdout(path: Path) -> tuple[list[dict], dict]:
    raw = path.read_bytes()
    try:
        lines = raw.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as error:
        raise ValueError("Holdout must be UTF-8 JSONL") from error
    records: list[dict] = []
    seen_ids: set[str] = set()
    seen_text: set[str] = set()
    versions: set[str] = set()
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Line {line_number}: invalid JSON") from error
        if not isinstance(row, dict) or not REQUIRED.issubset(row):
            raise ValueError(f"Line {line_number}: missing required holdout fields")
        identifier = _nonempty_string(row, "id", line_number)
        text = _nonempty_string(row, "text", line_number)
        permission_reference = _nonempty_string(row, "permission_reference", line_number)
        if permission_reference.lower() in PLACEHOLDER_PERMISSION_REFERENCES:
            raise ValueError(f"Line {line_number}: permission_reference is a placeholder")
        versions.add(_nonempty_string(row, "dataset_version", line_number))
        if identifier in seen_ids:
            raise ValueError(f"Line {line_number}: duplicate holdout ID")
        seen_ids.add(identifier)
        if row["label"] not in training.LABELS:
            raise ValueError(f"Line {line_number}: invalid label")
        if row["source_type"] not in SOURCE_TYPES:
            raise ValueError(f"Line {line_number}: invalid source_type")
        if row["source"] != "real_world" or row["split"] != "test":
            raise ValueError(f"Line {line_number}: holdout must declare real_world/test")
        if row["review_status"] != "reviewed" or row["pii_removed"] is not True:
            raise ValueError(f"Line {line_number}: human review and de-identification are required")
        backend_text = unicodedata.normalize("NFKC", text)
        if any(ord(char) < 32 and char not in "\t\n\r" or ord(char) == 127
               for char in backend_text):
            raise ValueError(f"Line {line_number}: text contains unsupported control characters")
        backend_text = " ".join(backend_text.split())
        if len(backend_text) > 1000:
            raise ValueError(f"Line {line_number}: text exceeds backend 1000-character limit")
        if any(pattern.search(backend_text) for pattern in
               (*training.SENSITIVE_PATTERNS, *BACKEND_REJECTED_TEXT)):
            raise ValueError(f"Line {line_number}: potential private identifier; inspect securely")
        keys = _text_keys(text)
        if not keys or keys & seen_text:
            raise ValueError(f"Line {line_number}: empty or duplicate holdout text")
        seen_text.update(keys)
        records.append(row)
    group_presence = ["group_id" in row for row in records]
    if any(group_presence):
        if not all(group_presence):
            raise ValueError("group_id must be supplied for every row or omitted entirely")
        for line_number, row in enumerate(records, start=1):
            _nonempty_string(row, "group_id", line_number)
    if len(versions) != 1 or not records:
        raise ValueError("Holdout must contain records from exactly one dataset version")
    by_source = defaultdict(set)
    for row in records:
        by_source[row["source_type"]].add(row["label"])
    # Search queries are the current product scope. Evaluate pages only when
    # supplied; their absence must not block a search-query release.
    for source_type in set(by_source) | {"search_query"}:
        if by_source[source_type] != set(training.LABELS):
            raise ValueError(f"Holdout {source_type} needs all three labels")
    return records, {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "dataset_version": next(iter(versions)),
        "rows": len(records),
        "label_counts": dict(Counter(row["label"] for row in records)),
        "source_counts": dict(Counter(row["source_type"] for row in records)),
        "group_count": len({row["group_id"] for row in records}) if any(group_presence) else None,
        "group_metadata_supplied": any(group_presence),
    }


def check_independence(records: list[dict], artifact_dir: Path) -> dict:
    known_ids: set[str] = set()
    known_groups: set[str] = set()
    known_text: set[str] = set()
    reference_rows = 0
    for split in training.SPLITS:
        path = artifact_dir / f"{split}.jsonl"
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                reference = json.loads(line)
                if reference.get("split") != split:
                    raise ValueError(f"Reference {split} record {line_number} has wrong split")
                known_ids.update(reference.get("source_ids", [reference["id"]]))
                groups = reference.get("group_ids")
                if groups is None:
                    groups = [reference["group_id"]] if reference.get("group_id") else []
                known_groups.update(groups)
                known_text.update(_text_keys(reference["text"]))
                reference_rows += 1
    for row in records:
        if row["id"] in known_ids:
            raise ValueError(f"Holdout ID overlaps model reference splits: {row['id']}")
        if row.get("group_id") in known_groups:
            raise ValueError(f"Holdout group overlaps model reference splits: {row['id']}")
        if _text_keys(row["text"]) & known_text:
            raise ValueError(f"Holdout text overlaps model reference splits: {row['id']}")
    return {
        "reference_rows": reference_rows,
        "reference_splits_checked": list(training.SPLITS),
        "id_and_runtime_text_overlap": 0,
        "group_overlap_checked": "group_id" in records[0],
        "group_overlap": 0 if "group_id" in records[0] else None,
        "provenance_authenticity_verified_by_code": False,
        "semantic_near_duplicate_detection_complete": False,
        "same_child_or_session_independence_verified": False,
    }


def evaluate_holdout(holdout_path: Path, artifact_dir: Path) -> dict:
    records, holdout = load_holdout(holdout_path)
    independence = check_independence(records, artifact_dir)
    model_path = artifact_dir / "model.json.gz"
    model = load_model(model_path)
    training_report = json.loads((artifact_dir / "evaluation_report.json").read_text(encoding="utf-8"))
    if model.get("model_version") != training_report.get("model_version") or (
        model.get("combined_dataset_sha256") != training_report.get("source_audit", {}).get("combined_dataset_sha256")
    ):
        raise ValueError("Model and training report provenance do not match")
    overall = training.evaluate(model, records)
    by_source = {
        source_type: training.evaluate(model, [row for row in records if row["source_type"] == source_type])
        for source_type in sorted({row["source_type"] for row in records})
    }
    high_risk_misses = [
        {"id": row["id"], "source_type": row["source_type"], "predicted": predicted}
        for row in records
        if row["label"] == "HIGH_RISK"
        for predicted in [training.predict(model, row["text"])]
        if predicted != "HIGH_RISK"
    ]
    return {
        "model_version": model["model_version"],
        "model_sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        "holdout": holdout,
        "independence_checks": independence,
        "overall": overall,
        "by_source_type": by_source,
        "high_risk_false_negatives": high_risk_misses,
        "high_risk_false_negative_count": len(high_risk_misses),
        "test_only_no_refitting_or_threshold_selection": True,
        "deployment_eligible": False,
        "limitations": [
            "Source, permission, de-identification and human review are metadata claims requiring manual verification.",
            "Exact/runtime text checks cannot rule out all semantic near-duplicates.",
            "Without group metadata, overlap by child or search session cannot be checked."
            if not holdout["group_metadata_supplied"] else
            "Group checks cannot prove independence by child or search session.",
            "This evaluation does not authorize alerts; deployment requires an independently approved safety review.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--holdout", required=True, type=Path)
    parser.add_argument("--artifact-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output report already exists; choose a new path")
    report = evaluate_holdout(args.holdout, args.artifact_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(args.output),
        "rows": report["holdout"]["rows"],
        "high_risk_false_negative_count": report["high_risk_false_negative_count"],
        "deployment_eligible": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
