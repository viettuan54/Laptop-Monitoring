"""Validate external application and website classification CSV datasets.

The validator deliberately separates structural JSON Schema checks from
semantic checks such as canonical domain parsing and duplicate detection.  It
does not modify the source CSV, infer labels, or add Gemini output to training
data.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import jsonschema


TRAINING_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_ROOT = TRAINING_ROOT / "datasets" / "schema"
DEFAULT_TAXONOMY_PATH = SCHEMA_ROOT / "content_classification_taxonomy.json"
DEFAULT_TAXONOMY_SCHEMA_PATH = (
    SCHEMA_ROOT / "content_classification_taxonomy.schema.json"
)
MAX_DATASET_BYTES = 100 * 1024 * 1024
DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

DATASET_SPECS = {
    "apps": {
        "taxonomy_key": "app",
        "headers": ("app_name", "display_name", "label"),
        "key_field": "app_name",
        "schema_path": SCHEMA_ROOT / "app_classification_record.schema.json",
    },
    "websites": {
        "taxonomy_key": "web",
        "headers": ("domain", "title", "label"),
        "key_field": "domain",
        "schema_path": SCHEMA_ROOT / "web_classification_record.schema.json",
    },
}


class DatasetContractError(ValueError):
    """Raised when a schema/taxonomy contract is invalid or inconsistent."""


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise DatasetContractError(f"Missing JSON contract: {path}") from error
    except json.JSONDecodeError as error:
        raise DatasetContractError(
            f"Invalid JSON contract {path}: line {error.lineno}: {error.msg}"
        ) from error


def _format_schema_error(error: jsonschema.ValidationError) -> str:
    location = ".".join(str(part) for part in error.absolute_path) or "record"
    return f"{location}: {error.message}"


def load_taxonomy(path: Path | str = DEFAULT_TAXONOMY_PATH) -> dict:
    taxonomy_path = Path(path)
    taxonomy = _load_json(taxonomy_path)
    taxonomy_schema = _load_json(DEFAULT_TAXONOMY_SCHEMA_PATH)
    jsonschema.Draft202012Validator.check_schema(taxonomy_schema)
    validator = jsonschema.Draft202012Validator(taxonomy_schema)
    errors = sorted(validator.iter_errors(taxonomy), key=lambda item: list(item.path))
    if errors:
        raise DatasetContractError(
            f"Invalid taxonomy {taxonomy_path}: {_format_schema_error(errors[0])}"
        )

    expected_contract = {
        "app": {
            "key_field": "app_name",
            "display_field": "display_name",
            "labels": ["learning", "entertainment", "browsers", "unknown"],
        },
        "web": {
            "key_field": "domain",
            "display_field": "title",
            "labels": [
                "education",
                "entertainment",
                "social",
                "unsafe",
                "unknown",
            ],
        },
    }
    if taxonomy["resources"] != expected_contract:
        raise DatasetContractError(
            "Taxonomy labels/fields do not match the backend app/web contracts"
        )
    if taxonomy["confidence_threshold"] != 0.7:
        raise DatasetContractError("Taxonomy confidence_threshold must be 0.7")
    return taxonomy


def _load_record_validator(spec: dict, taxonomy: dict):
    schema = _load_json(spec["schema_path"])
    jsonschema.Draft202012Validator.check_schema(schema)
    schema_labels = schema.get("properties", {}).get("label", {}).get("enum")
    taxonomy_labels = taxonomy["resources"][spec["taxonomy_key"]]["labels"]
    if schema_labels != taxonomy_labels:
        raise DatasetContractError(
            f"Label enum in {spec['schema_path'].name} is out of sync with taxonomy"
        )
    return jsonschema.Draft202012Validator(schema)


def _has_control_characters(value: str) -> bool:
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def normalize_app_name(value: str) -> str:
    candidate = unicodedata.normalize("NFKC", value).strip().casefold()
    if not candidate:
        raise ValueError("app_name cannot be empty")
    if len(candidate) > 150:
        raise ValueError("app_name cannot exceed 150 characters")
    if _has_control_characters(candidate):
        raise ValueError("app_name cannot contain control characters")
    if "/" in candidate or "\\" in candidate:
        raise ValueError("app_name must be a file name, not a path")
    return candidate


def normalize_domain(value: str) -> str:
    candidate = unicodedata.normalize("NFKC", value).strip().casefold()
    if not candidate:
        raise ValueError("domain cannot be empty")
    if _has_control_characters(candidate):
        raise ValueError("domain cannot contain control characters")
    if "://" in candidate or any(marker in candidate for marker in "/?#@\\"):
        raise ValueError("domain must not contain a scheme, path, query, or credentials")
    candidate = candidate[:-1] if candidate.endswith(".") else candidate
    if candidate.startswith("www."):
        candidate = candidate[4:]

    try:
        ascii_domain = candidate.encode("idna").decode("ascii")
    except (UnicodeError, ValueError) as error:
        raise ValueError("domain is not valid IDNA") from error

    if len(ascii_domain) > 253:
        raise ValueError("domain cannot exceed 253 ASCII characters")
    labels = ascii_domain.split(".")
    if len(labels) < 2 or any(not DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
        raise ValueError("domain must contain valid DNS labels and a suffix")
    return ascii_domain


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _append_issue(report: dict, severity: str, message: str, *, row=None, field=None):
    issue = {"message": message}
    if row is not None:
        issue["row"] = row
    if field:
        issue["field"] = field
    report[severity].append(issue)


def validate_csv_dataset(
    dataset_type: str,
    path: Path | str,
    *,
    taxonomy_path: Path | str = DEFAULT_TAXONOMY_PATH,
    minimum_samples_per_label: int = 1,
    max_errors: int = 100,
) -> dict:
    if dataset_type not in DATASET_SPECS:
        raise DatasetContractError(
            f"dataset_type must be one of: {', '.join(DATASET_SPECS)}"
        )
    if minimum_samples_per_label < 1:
        raise DatasetContractError("minimum_samples_per_label must be at least 1")
    if max_errors < 1:
        raise DatasetContractError("max_errors must be at least 1")

    dataset_path = Path(path)
    if not dataset_path.is_file():
        raise DatasetContractError(f"Dataset file does not exist: {dataset_path}")
    if dataset_path.stat().st_size > MAX_DATASET_BYTES:
        raise DatasetContractError(
            f"Dataset exceeds the {MAX_DATASET_BYTES // (1024 * 1024)} MB limit"
        )

    taxonomy = load_taxonomy(taxonomy_path)
    spec = DATASET_SPECS[dataset_type]
    validator = _load_record_validator(spec, taxonomy)
    labels = taxonomy["resources"][spec["taxonomy_key"]]["labels"]
    report = {
        "dataset_type": dataset_type,
        "file": str(dataset_path),
        "sha256": _sha256(dataset_path),
        "taxonomy_version": taxonomy["taxonomy_version"],
        "row_count": 0,
        "valid_unique_record_count": 0,
        "duplicate_count": 0,
        "label_counts": {label: 0 for label in labels},
        "errors": [],
        "warnings": [],
    }
    first_by_key = {}

    try:
        handle = dataset_path.open("r", encoding="utf-8-sig", newline="")
    except UnicodeError as error:
        raise DatasetContractError(f"Dataset must be UTF-8: {dataset_path}") from error

    with handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames
        if headers is None:
            _append_issue(report, "errors", "CSV header is missing")
            report["status"] = "failed"
            return report
        if len(headers) != len(set(headers)):
            _append_issue(report, "errors", "CSV header contains duplicate columns")
        if tuple(headers) != spec["headers"]:
            _append_issue(
                report,
                "errors",
                f"CSV header must be exactly: {','.join(spec['headers'])}",
            )
            report["status"] = "failed"
            return report

        for row_number, raw_record in enumerate(reader, start=2):
            report["row_count"] += 1
            if len(report["errors"]) >= max_errors:
                _append_issue(
                    report,
                    "warnings",
                    f"Validation stopped after {max_errors} errors",
                )
                break
            record = {
                field: (raw_record.get(field) or "").strip()
                for field in spec["headers"]
            }
            if None in raw_record or any(value is None for value in raw_record.values()):
                _append_issue(
                    report,
                    "errors",
                    "Row does not match the declared CSV column count",
                    row=row_number,
                )
                continue

            schema_errors = sorted(
                validator.iter_errors(record), key=lambda item: list(item.path)
            )
            if schema_errors:
                for error in schema_errors:
                    field = str(next(iter(error.path), "record"))
                    _append_issue(
                        report,
                        "errors",
                        _format_schema_error(error),
                        row=row_number,
                        field=field,
                    )
                    if len(report["errors"]) >= max_errors:
                        break
                continue

            for text_field in spec["headers"][:-1]:
                if _has_control_characters(record[text_field]):
                    _append_issue(
                        report,
                        "errors",
                        f"{text_field} cannot contain control characters",
                        row=row_number,
                        field=text_field,
                    )
                    break
            else:
                try:
                    if dataset_type == "apps":
                        normalized_key = normalize_app_name(record[spec["key_field"]])
                    else:
                        normalized_key = normalize_domain(record[spec["key_field"]])
                except ValueError as error:
                    _append_issue(
                        report,
                        "errors",
                        str(error),
                        row=row_number,
                        field=spec["key_field"],
                    )
                    continue

                previous = first_by_key.get(normalized_key)
                if previous:
                    report["duplicate_count"] += 1
                    previous_row, previous_label = previous
                    if previous_label == record["label"]:
                        message = (
                            f"Duplicate normalized key; first seen at row {previous_row}"
                        )
                    else:
                        message = (
                            f"Conflicting labels '{previous_label}' and '{record['label']}' "
                            f"for the same normalized key; first seen at row {previous_row}"
                        )
                    _append_issue(
                        report,
                        "errors",
                        message,
                        row=row_number,
                        field=spec["key_field"],
                    )
                    continue

                first_by_key[normalized_key] = (row_number, record["label"])
                report["valid_unique_record_count"] += 1
                report["label_counts"][record["label"]] += 1

    for label, count in report["label_counts"].items():
        if count < minimum_samples_per_label:
            _append_issue(
                report,
                "errors",
                f"Label '{label}' has {count} valid unique sample(s); "
                f"minimum is {minimum_samples_per_label}",
                field="label",
            )

    nonzero_counts = [count for count in report["label_counts"].values() if count]
    if nonzero_counts and min(nonzero_counts) > 0:
        imbalance_ratio = max(nonzero_counts) / min(nonzero_counts)
        if imbalance_ratio >= 5:
            _append_issue(
                report,
                "warnings",
                f"Class imbalance ratio is {imbalance_ratio:.2f}:1",
                field="label",
            )

    if report["errors"]:
        report["status"] = "failed"
    elif report["warnings"]:
        report["status"] = "passed_with_warnings"
    else:
        report["status"] = "passed"
    return report


def build_validation_report(dataset_reports: list[dict], taxonomy: dict) -> dict:
    has_errors = any(report["errors"] for report in dataset_reports)
    has_warnings = any(report["warnings"] for report in dataset_reports)
    status = "failed" if has_errors else "passed_with_warnings" if has_warnings else "passed"
    return {
        "report_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "taxonomy_version": taxonomy["taxonomy_version"],
        "confidence_threshold": taxonomy["confidence_threshold"],
        "status": status,
        "datasets": {report["dataset_type"]: report for report in dataset_reports},
    }


def _render_console(report: dict) -> str:
    lines = [
        f"Content dataset validation: {report['status']}",
        f"Taxonomy: {report['taxonomy_version']} | confidence threshold: "
        f"{report['confidence_threshold']:.2f}",
    ]
    for dataset_type, dataset in report["datasets"].items():
        lines.append(
            f"- {dataset_type}: {dataset['status']} | rows={dataset['row_count']} | "
            f"valid_unique={dataset['valid_unique_record_count']} | "
            f"duplicates={dataset['duplicate_count']}"
        )
        lines.append(f"  labels={json.dumps(dataset['label_counts'], sort_keys=True)}")
        for issue in dataset["errors"]:
            location = f" row={issue['row']}" if "row" in issue else ""
            lines.append(f"  ERROR{location}: {issue['message']}")
        for issue in dataset["warnings"]:
            location = f" row={issue['row']}" if "row" in issue else ""
            lines.append(f"  WARNING{location}: {issue['message']}")
    return "\n".join(lines)


def _write_json_atomic(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate external app/website classification CSV datasets."
    )
    parser.add_argument("--apps", type=Path, help="Path to apps CSV dataset")
    parser.add_argument("--websites", type=Path, help="Path to websites CSV dataset")
    parser.add_argument(
        "--taxonomy", type=Path, default=DEFAULT_TAXONOMY_PATH, help="Taxonomy JSON"
    )
    parser.add_argument(
        "--minimum-samples-per-label",
        type=int,
        default=1,
        help="Fail when a label has fewer valid unique samples (default: 1)",
    )
    parser.add_argument(
        "--max-errors", type=int, default=100, help="Stop each file after this many errors"
    )
    parser.add_argument("--report", type=Path, help="Optional JSON report output path")
    args = parser.parse_args(argv)
    if not args.apps and not args.websites:
        parser.error("at least one of --apps or --websites is required")
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        taxonomy = load_taxonomy(args.taxonomy)
        dataset_reports = []
        if args.apps:
            dataset_reports.append(
                validate_csv_dataset(
                    "apps",
                    args.apps,
                    taxonomy_path=args.taxonomy,
                    minimum_samples_per_label=args.minimum_samples_per_label,
                    max_errors=args.max_errors,
                )
            )
        if args.websites:
            dataset_reports.append(
                validate_csv_dataset(
                    "websites",
                    args.websites,
                    taxonomy_path=args.taxonomy,
                    minimum_samples_per_label=args.minimum_samples_per_label,
                    max_errors=args.max_errors,
                )
            )
        report = build_validation_report(dataset_reports, taxonomy)
        if args.report:
            _write_json_atomic(args.report, report)
        print(_render_console(report))
        return 1 if report["status"] == "failed" else 0
    except (DatasetContractError, OSError, UnicodeError) as error:
        print(f"Dataset validation could not start: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
