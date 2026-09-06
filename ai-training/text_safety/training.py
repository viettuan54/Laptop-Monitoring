"""Dataset preparation, fine-tuning and safety evaluation for Vietnamese text safety.

The module deliberately keeps preparation and evaluation free of PyTorch so that
contracts can be checked in CI without downloading a model.  PyTorch and
Transformers are imported only when ``train_model`` is called.
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

from .normalization import normalize_text
from .taxonomy import load_taxonomy


PACKAGE_ROOT = Path(__file__).resolve().parent
TRAINING_ROOT = PACKAGE_ROOT.parent
DATASET_SCHEMA_PATH = TRAINING_ROOT / "datasets" / "schema" / "text_safety_record.schema.json"
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "text_safety_training_config.json"

# Model outputs remain aligned with the existing taxonomy.  The aliases below
# make reports easy to compare with product requirements that use snake_case.
METRIC_ALIASES = {
    "self-harm/intent": "self_harm_intent",
    "harassment/threatening": "harassment_threatening",
    "hate/threatening": "hate_threatening",
    "violence/inciting": "violence_inciting",
}
SERIOUS_THREAT_LABELS = (
    "harassment/threatening",
    "hate/threatening",
    "violence/inciting",
)
PERSONAL_IDENTIFIER_PATTERNS = (
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    re.compile(r"\b(?:\+?84|0)(?:[ .-]?\d){8,10}\b"),
    re.compile(r"\b(?:bearer|api[_ -]?key|password)\s*[:=]", re.IGNORECASE),
    re.compile(r"https?://\S+\?\S+", re.IGNORECASE),
)


class TextSafetyTrainingError(ValueError):
    """A data or training contract prevents a reproducible safe run."""


class TrainingDependencyError(RuntimeError):
    """Optional model-training dependencies are not installed."""


@dataclass(frozen=True)
class AnnotationRecord:
    """Validated canonical record.  ``payload`` never leaves the local run."""

    payload: dict[str, Any]
    source_path: str
    source_line: int

    @property
    def record_id(self) -> str:
        return str(self.payload["record_id"])

    @property
    def labels(self) -> tuple[str, ...]:
        return tuple(self.payload["labels"])

    @property
    def group_key(self) -> str:
        conversation_id = self.payload.get("conversation_id")
        if conversation_id:
            return f"conversation:{conversation_id}"
        subject_id = self.payload.get("subject_id")
        if subject_id:
            return f"subject:{subject_id}"
        raise TextSafetyTrainingError(
            f"Record {self.record_id} must have a non-empty conversation_id or subject_id"
        )


def canonical_labels() -> tuple[str, ...]:
    return tuple(load_taxonomy().categories)


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_json_dump(value).encode("utf-8")).hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise TextSafetyTrainingError(f"Cannot read JSON configuration {path}: {error}") from error
    if not isinstance(payload, dict):
        raise TextSafetyTrainingError(f"Configuration {path} must be a JSON object")
    return payload


def _schema_validator():
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        # The fallback below keeps preflight checks usable in a bare Python CI
        # runner.  Production environments still get full Draft 2020-12 schema
        # validation from the declared jsonschema dependency.
        return None

    schema = _load_json(DATASET_SCHEMA_PATH)
    return Draft202012Validator(schema)


def _fallback_schema_error(payload: dict[str, Any]) -> str | None:
    """Minimal equivalent of the record contract for dependency-free CI runs."""

    allowed = {
        "record_id", "conversation_id", "subject_id", "text", "context", "labels", "target",
        "offensive_spans", "source_type", "direction", "severity", "requires_immediate_alert", "annotator_ids",
        "split", "provenance",
    }
    required = {
        "record_id", "text", "labels", "target", "source_type", "direction", "severity",
        "requires_immediate_alert", "annotator_ids", "split", "provenance",
    }
    missing = sorted(required - set(payload))
    if missing:
        return f"missing required field {missing[0]}"
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        return f"unexpected field {unexpected[0]}"
    if not isinstance(payload["record_id"], str) or not payload["record_id"].strip():
        return "record_id must be a non-empty string"
    if not isinstance(payload["text"], str) or not 1 <= len(payload["text"]) <= 4000:
        return "text must contain 1 to 4000 characters"
    if not isinstance(payload["labels"], list) or len(set(payload["labels"])) != len(payload["labels"]):
        return "labels must be a unique array"
    if not isinstance(payload["context"], list) or len(payload["context"]) > 5:
        return "context must contain at most five items"
    if any(not isinstance(value, str) or not 1 <= len(value) <= 1000 for value in payload["context"]):
        return "context items must contain 1 to 1000 characters"
    spans = payload.get("offensive_spans", [])
    if not isinstance(spans, list) or len(spans) > 20:
        return "offensive_spans must contain at most 20 items"
    for span in spans:
        if not isinstance(span, dict) or set(span) - {"start", "end", "source_label"} or not {"start", "end"}.issubset(span):
            return "offensive_spans items are invalid"
        if not isinstance(span["start"], int) or not isinstance(span["end"], int) or not 0 <= span["start"] < span["end"] <= len(payload["text"]):
            return "offensive_spans positions are invalid"
        if "source_label" in span and (
            not isinstance(span["source_label"], str) or not 1 <= len(span["source_label"]) <= 128
        ):
            return "offensive_spans source_label is invalid"
    if payload["target"] not in {"unknown", "self", "individual", "child", "group"}:
        return "target is invalid"
    if payload["source_type"] not in load_taxonomy().source_types:
        return "source_type is invalid"
    if payload["direction"] not in load_taxonomy().directions:
        return "direction is invalid"
    if payload["severity"] not in {"low", "medium", "high", "critical"}:
        return "severity is invalid"
    if not isinstance(payload["requires_immediate_alert"], bool):
        return "requires_immediate_alert must be boolean"
    annotators = payload["annotator_ids"]
    if not isinstance(annotators, list) or len(annotators) < 2 or len(set(annotators)) != len(annotators):
        return "annotator_ids must contain at least two unique reviewers"
    if payload["split"] not in {"train", "validation", "test"}:
        return "split is invalid"
    if not isinstance(payload["provenance"], dict):
        return "provenance must be an object"
    if set(payload["provenance"]) != {"source", "license", "allowed_use"}:
        return "provenance fields are invalid"
    if payload["provenance"].get("allowed_use") not in {"research", "commercial", "internal_evaluation"}:
        return "provenance.allowed_use is invalid"
    conversation = payload.get("conversation_id")
    subject = payload.get("subject_id")
    if not (isinstance(conversation, str) and conversation) and not (
        isinstance(subject, str) and subject
    ):
        return "conversation_id or subject_id must be a non-empty string"
    return None


def _canonicalize_field_names(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept the review-UI camelCase alert key but persist one Python-style key."""

    canonical = dict(payload)
    camel_value = canonical.pop("requiresImmediateAlert", None)
    if camel_value is not None:
        snake_value = canonical.get("requires_immediate_alert")
        if snake_value is not None and snake_value != camel_value:
            raise TextSafetyTrainingError(
                "requiresImmediateAlert conflicts with requires_immediate_alert"
            )
        canonical["requires_immediate_alert"] = camel_value
    return canonical


def _validation_error_location(error: Any) -> str:
    path = "/".join(str(part) for part in error.absolute_path)
    return path or "record"


def _assert_anonymized(payload: dict[str, Any], record_id: str) -> None:
    values = [payload.get("text", ""), *payload.get("context", [])]
    for value in values:
        for pattern in PERSONAL_IDENTIFIER_PATTERNS:
            if pattern.search(value):
                raise TextSafetyTrainingError(
                    f"Record {record_id} contains a possible personal identifier; anonymize it before training"
                )


def _assert_pseudonymous_identifiers(payload: dict[str, Any], record_id: str) -> None:
    identifier_pattern = re.compile(r"^[A-Za-z0-9_-]{3,128}$")
    values = [
        payload.get("conversation_id"),
        payload.get("subject_id"),
        *payload.get("annotator_ids", []),
    ]
    for value in values:
        if value is not None and not identifier_pattern.fullmatch(str(value)):
            raise TextSafetyTrainingError(
                f"Record {record_id} has an invalid pseudonymous identifier"
            )


def validate_annotation_records(
    records: Iterable[AnnotationRecord],
    *,
    allowed_uses: set[str] | None = None,
) -> list[AnnotationRecord]:
    """Validate schema, consent/provenance, de-identification and leakage risks.

    Exceptions intentionally identify only record IDs and fields, never the source
    text.  This makes it safe to put CLI errors in CI logs.
    """

    validator = _schema_validator()
    labels = set(canonical_labels())
    allowed_uses = allowed_uses or {"commercial", "internal_evaluation"}
    accepted: list[AnnotationRecord] = []
    record_ids: set[str] = set()
    normalized_text_splits: dict[str, str] = {}
    groups: dict[str, set[str]] = defaultdict(set)

    for record in records:
        payload = record.payload
        record_id = str(payload.get("record_id", f"line-{record.source_line}"))
        if validator is None:
            fallback_error = _fallback_schema_error(payload)
            if fallback_error:
                raise TextSafetyTrainingError(f"Record {record_id} fails schema: {fallback_error}")
        else:
            schema_errors = sorted(validator.iter_errors(payload), key=_validation_error_location)
            if schema_errors:
                error = schema_errors[0]
                raise TextSafetyTrainingError(
                    f"Record {record_id} fails schema at {_validation_error_location(error)}: {error.message}"
                )
        if record_id in record_ids:
            raise TextSafetyTrainingError(f"Duplicate record_id: {record_id}")
        record_ids.add(record_id)
        if not set(payload["labels"]).issubset(labels):
            raise TextSafetyTrainingError(f"Record {record_id} has a label outside taxonomy")
        if payload["provenance"]["allowed_use"] not in allowed_uses:
            raise TextSafetyTrainingError(
                f"Record {record_id} has provenance not approved for this training run"
            )
        _assert_anonymized(payload, record_id)
        _assert_pseudonymous_identifiers(payload, record_id)
        for span in payload.get("offensive_spans", []):
            if not 0 <= span["start"] < span["end"] <= len(payload["text"]):
                raise TextSafetyTrainingError(
                    f"Record {record_id} has an offensive span outside the text bounds"
                )
        group_key = record.group_key
        groups[group_key].add(payload["split"])
        normalized_hash = _sha256_text(normalize_text(payload["text"]).unicode)
        known_split = normalized_text_splits.get(normalized_hash)
        if known_split is not None and known_split != payload["split"]:
            raise TextSafetyTrainingError(
                f"Record {record_id} duplicates text assigned to another split"
            )
        normalized_text_splits[normalized_hash] = payload["split"]
        accepted.append(record)

    for group_key, splits in groups.items():
        if len(splits) > 1:
            raise TextSafetyTrainingError(
                f"Conversation/subject group {group_key} appears in more than one split"
            )
    if not accepted:
        raise TextSafetyTrainingError("No annotation records supplied")
    return accepted


def load_jsonl_records(paths: Sequence[Path]) -> list[AnnotationRecord]:
    """Load canonical JSONL files without emitting their text in error messages."""

    records: list[AnnotationRecord] = []
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise TextSafetyTrainingError(f"Cannot read dataset file {path}: {error}") from error
        for line_number, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as error:
                raise TextSafetyTrainingError(
                    f"Invalid JSONL at {path.name}:{line_number}: {error.msg}"
                ) from error
            if not isinstance(payload, dict):
                raise TextSafetyTrainingError(
                    f"Dataset item at {path.name}:{line_number} must be an object"
                )
            records.append(
                AnnotationRecord(
                    payload=_canonicalize_field_names(payload),
                    source_path=str(path),
                    source_line=line_number,
                )
            )
    return records


def _validate_split_ratios(ratios: dict[str, float]) -> dict[str, float]:
    expected = {"train", "validation", "test"}
    if set(ratios) != expected:
        raise TextSafetyTrainingError("split_ratios must contain train, validation and test")
    parsed = {name: float(value) for name, value in ratios.items()}
    if any(value <= 0 for value in parsed.values()) or not math.isclose(
        sum(parsed.values()), 1.0, rel_tol=0, abs_tol=1e-9
    ):
        raise TextSafetyTrainingError("split_ratios must be positive and sum to 1.0")
    return parsed


def _stable_group_order(seed: str, group_key: str) -> str:
    return hashlib.sha256(f"{seed}:{group_key}".encode("utf-8")).hexdigest()


def grouped_multilabel_split(
    records: Sequence[AnnotationRecord],
    *,
    ratios: dict[str, float],
    seed: str,
) -> tuple[dict[str, list[AnnotationRecord]], dict[str, Any]]:
    """Split complete conversations/subjects with a deterministic label-aware greedy pass."""

    ratios = _validate_split_ratios(ratios)
    grouped: dict[str, list[AnnotationRecord]] = defaultdict(list)
    for record in records:
        grouped[record.group_key].append(record)
    if len(grouped) < 3:
        raise TextSafetyTrainingError(
            "At least three conversation/subject groups are required for train/validation/test"
        )

    label_names = canonical_labels()
    label_totals = Counter(label for record in records for label in record.labels)
    target_sizes = {name: len(records) * ratio for name, ratio in ratios.items()}
    target_labels = {
        split: {label: label_totals[label] * ratio for label in label_names}
        for split, ratio in ratios.items()
    }
    current_sizes = Counter()
    current_labels: dict[str, Counter[str]] = {split: Counter() for split in ratios}
    assignments: dict[str, str] = {}
    ordered_groups = sorted(
        grouped,
        key=lambda key: (
            -len(grouped[key]),
            -sum(len(record.labels) for record in grouped[key]),
            _stable_group_order(seed, key),
        ),
    )

    for position, group_key in enumerate(ordered_groups):
        group_records = grouped[group_key]
        group_labels = Counter(label for record in group_records for label in record.labels)
        remaining = len(ordered_groups) - position
        candidates = []
        for split in ratios:
            # Make each split non-empty whenever group count permits it.
            empty_splits = sum(1 for name in ratios if current_sizes[name] == 0)
            would_leave_empty = current_sizes[split] > 0 and empty_splits >= remaining
            if would_leave_empty:
                continue
            projected_size = current_sizes[split] + len(group_records)
            size_cost = ((projected_size - target_sizes[split]) / max(target_sizes[split], 1)) ** 2
            label_cost = sum(
                ((current_labels[split][label] + group_labels[label] - target_labels[split][label])
                / max(target_labels[split][label], 1)) ** 2
                for label in label_names
                if label_totals[label]
            )
            # Label balance is more important than equal raw row counts for this task.
            candidates.append((label_cost * 3 + size_cost, split))
        if not candidates:  # defensive fallback for unusual ratio/group combinations
            candidates = [(0.0, split) for split in ratios]
        _, selected = min(candidates, key=lambda value: (value[0], value[1]))
        assignments[group_key] = selected
        current_sizes[selected] += len(group_records)
        current_labels[selected].update(group_labels)

    splits = {name: [] for name in ratios}
    for group_key, group_records in grouped.items():
        splits[assignments[group_key]].extend(group_records)
    metadata = {
        "strategy": "deterministic_grouped_multilabel_greedy_v1",
        "seed": seed,
        "group_count": len(grouped),
        "record_count": len(records),
        "split_counts": {split: len(items) for split, items in splits.items()},
        "label_counts": {
            split: {label: sum(label in record.labels for record in items) for label in label_names}
            for split, items in splits.items()
        },
    }
    return splits, metadata


def preserved_group_splits(
    records: Sequence[AnnotationRecord],
) -> tuple[dict[str, list[AnnotationRecord]], dict[str, Any]]:
    splits = {"train": [], "validation": [], "test": []}
    owners: dict[str, str] = {}
    for record in records:
        split = record.payload["split"]
        owner = owners.setdefault(record.group_key, split)
        if owner != split:
            raise TextSafetyTrainingError(
                f"Conversation/subject group {record.group_key} appears in more than one split"
            )
        splits[split].append(record)
    if any(not records_in_split for records_in_split in splits.values()):
        raise TextSafetyTrainingError("Preserved splits require non-empty train, validation and test")
    return splits, {
        "strategy": "provided_grouped_splits",
        "group_count": len(owners),
        "record_count": len(records),
        "split_counts": {split: len(items) for split, items in splits.items()},
    }


def format_model_text(record: AnnotationRecord) -> str:
    """Normalize robustly while retaining reviewed source/direction/target context."""

    payload = record.payload
    prefix = (
        f"nguon_{payload['source_type']} huong_{payload['direction']} "
        f"muc_tieu_{payload['target']}"
    )
    context = " ".join(normalize_text(value).unicode for value in payload.get("context", []))
    text = normalize_text(payload["text"]).unicode
    return " ".join(part for part in (prefix, context, text) if part)


def label_vector(record: AnnotationRecord, labels: Sequence[str] | None = None) -> list[float]:
    labels = labels or canonical_labels()
    active = set(record.labels)
    return [1.0 if label in active else 0.0 for label in labels]


def sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1 / (1 + exponent)
    exponent = math.exp(value)
    return exponent / (1 + exponent)


def probabilities_from_logits(logits: Sequence[Sequence[float]]) -> list[list[float]]:
    return [[sigmoid(float(value)) for value in row] for row in logits]


def _binary_counts(
    actual: Sequence[int], predicted: Sequence[int]
) -> dict[str, int]:
    true_positive = sum(a == 1 and p == 1 for a, p in zip(actual, predicted))
    false_positive = sum(a == 0 and p == 1 for a, p in zip(actual, predicted))
    false_negative = sum(a == 1 and p == 0 for a, p in zip(actual, predicted))
    true_negative = sum(a == 0 and p == 0 for a, p in zip(actual, predicted))
    return {
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "true_negative": true_negative,
    }


def _precision_recall_f1(counts: dict[str, int]) -> dict[str, float]:
    tp, fp, fn = counts["true_positive"], counts["false_positive"], counts["false_negative"]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def multilabel_evaluation(
    records: Sequence[AnnotationRecord],
    probabilities: Sequence[Sequence[float]],
    thresholds: dict[str, float],
    *,
    labels: Sequence[str] | None = None,
    error_limit: int = 200,
) -> dict[str, Any]:
    """Report label-level metrics and privacy-safe FP/FN samples for multi-label data."""

    labels = tuple(labels or canonical_labels())
    if len(records) != len(probabilities):
        raise TextSafetyTrainingError("Prediction count does not match evaluation records")
    if any(len(row) != len(labels) for row in probabilities):
        raise TextSafetyTrainingError("Prediction width does not match taxonomy labels")
    if set(thresholds) != set(labels):
        raise TextSafetyTrainingError("Thresholds must cover every taxonomy label")
    if any(not 0 < float(value) < 1 for value in thresholds.values()):
        raise TextSafetyTrainingError("Every classification threshold must be between 0 and 1")

    actual_matrix = [label_vector(record, labels) for record in records]
    predicted_matrix = [
        [1.0 if probability >= thresholds[label] else 0.0 for label, probability in zip(labels, row)]
        for row in probabilities
    ]
    per_label: dict[str, Any] = {}
    all_counts = Counter()
    false_positives: list[dict[str, str]] = []
    false_negatives: list[dict[str, str]] = []

    for index, label in enumerate(labels):
        actual = [int(row[index]) for row in actual_matrix]
        predicted = [int(row[index]) for row in predicted_matrix]
        counts = _binary_counts(actual, predicted)
        all_counts.update(counts)
        per_label[label] = {
            **_precision_recall_f1(counts),
            "support": sum(actual),
            "threshold": thresholds[label],
            "confusion_matrix": counts,
        }
        for row_index, (expected, observed) in enumerate(zip(actual, predicted)):
            if expected == 0 and observed == 1 and len(false_positives) < error_limit:
                false_positives.append({"record_id": records[row_index].record_id, "label": label})
            if expected == 1 and observed == 0 and len(false_negatives) < error_limit:
                false_negatives.append({"record_id": records[row_index].record_id, "label": label})

    macro = {
        metric: sum(values[metric] for values in per_label.values()) / len(labels)
        for metric in ("precision", "recall", "f1")
    }
    micro = _precision_recall_f1(dict(all_counts))
    critical_recall = {
        METRIC_ALIASES[label]: per_label[label]["recall"]
        for label in ("self-harm/intent", *SERIOUS_THREAT_LABELS)
        if label in per_label
    }
    return {
        "sample_count": len(records),
        "per_label": per_label,
        "macro": macro,
        "micro": micro,
        "confusion_matrices": {
            label: values["confusion_matrix"] for label, values in per_label.items()
        },
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "error_examples_truncated": len(false_positives) >= error_limit or len(false_negatives) >= error_limit,
        "critical_recall": critical_recall,
        "note": "False-positive/false-negative lists contain record IDs and labels only; raw text is not written to reports.",
    }


def select_thresholds(
    records: Sequence[AnnotationRecord],
    probabilities: Sequence[Sequence[float]],
    *,
    candidates: Sequence[float],
    minimum_recall: dict[str, float],
    labels: Sequence[str] | None = None,
) -> tuple[dict[str, float], dict[str, Any]]:
    """Tune only on validation, prioritising mandated recall for critical labels."""

    labels = tuple(labels or canonical_labels())
    if not candidates or any(not 0 < float(value) < 1 for value in candidates):
        raise TextSafetyTrainingError("threshold candidates must be values strictly between 0 and 1")
    unknown_requirements = set(minimum_recall) - set(labels)
    if unknown_requirements:
        raise TextSafetyTrainingError("minimum_recall contains labels outside taxonomy")
    thresholds: dict[str, float] = {}
    details: dict[str, Any] = {}
    actual_matrix = [label_vector(record, labels) for record in records]
    for index, label in enumerate(labels):
        actual = [int(row[index]) for row in actual_matrix]
        options = []
        for threshold in sorted({float(value) for value in candidates}):
            predicted = [int(row[index] >= threshold) for row in probabilities]
            counts = _binary_counts(actual, predicted)
            metrics = _precision_recall_f1(counts)
            options.append({"threshold": threshold, **metrics, "support": sum(actual)})
        target_recall = float(minimum_recall.get(label, 0.0))
        satisfying = [option for option in options if option["recall"] >= target_recall]
        if satisfying:
            selected = max(
                satisfying,
                key=lambda option: (option["f1"], option["precision"], option["threshold"]),
            )
            recall_constraint_met = True
        else:
            selected = max(
                options,
                key=lambda option: (option["recall"], option["f1"], -option["threshold"]),
            )
            recall_constraint_met = False
        thresholds[label] = selected["threshold"]
        details[label] = {
            "selected": selected,
            "minimum_recall": target_recall,
            "recall_constraint_met": recall_constraint_met,
            "candidates": options,
        }
    return thresholds, details


def _source_summary(records: Sequence[AnnotationRecord]) -> dict[str, Any]:
    sources: dict[tuple[str, str, str], int] = Counter()
    for record in records:
        provenance = record.payload["provenance"]
        sources[(provenance["source"], provenance["license"], provenance["allowed_use"])] += 1
    return {
        "records_by_source": [
            {"source": source, "license": license_name, "allowed_use": allowed_use, "record_count": count}
            for (source, license_name, allowed_use), count in sorted(sources.items())
        ],
        "label_counts": dict(sorted(Counter(label for record in records for label in record.labels).items())),
    }


def dataset_fingerprint(records: Sequence[AnnotationRecord]) -> str:
    # The fingerprint is a one-way checksum for auditing; it is not a text export.
    canonical_rows = [record.payload for record in sorted(records, key=lambda item: item.record_id)]
    return _sha256_json(canonical_rows)


def load_training_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    config = _load_json(path)
    required = {
        "config_version",
        "dataset_version",
        "model",
        "split_ratios",
        "split_seed",
        "training",
        "threshold_tuning",
        "acceptance",
    }
    missing = sorted(required - set(config))
    if missing:
        raise TextSafetyTrainingError(f"Training configuration is missing: {', '.join(missing)}")
    _validate_split_ratios(config["split_ratios"])
    model = config["model"]
    if not isinstance(model, dict) or not model.get("id") or not model.get("revision"):
        raise TextSafetyTrainingError("model.id and immutable model.revision are required")
    training = config["training"]
    if int(training.get("max_length", 0)) < 32 or int(training.get("max_length", 0)) > 512:
        raise TextSafetyTrainingError("training.max_length must be between 32 and 512")
    if int(training.get("epochs", 0)) < 1:
        raise TextSafetyTrainingError("training.epochs must be at least 1")
    thresholds = config["threshold_tuning"]
    if not isinstance(thresholds.get("candidates"), list):
        raise TextSafetyTrainingError("threshold_tuning.candidates must be a list")
    label_set = set(canonical_labels())
    if not set(thresholds.get("minimum_recall", {})).issubset(label_set):
        raise TextSafetyTrainingError("threshold_tuning.minimum_recall has unknown taxonomy labels")
    acceptance = config["acceptance"]
    if not set(acceptance.get("minimum_test_recall", {})).issubset(label_set):
        raise TextSafetyTrainingError("acceptance.minimum_test_recall has unknown taxonomy labels")
    if float(acceptance.get("minimum_macro_f1", -1)) < 0 or int(
        acceptance.get("minimum_test_support_per_critical_label", -1)
    ) < 0:
        raise TextSafetyTrainingError("acceptance thresholds must be non-negative")
    return config


def deployment_gate(report: dict[str, Any], acceptance: dict[str, Any]) -> dict[str, Any]:
    """A model is not approved just because aggregate accuracy looks good."""

    minimum_macro_f1 = float(acceptance["minimum_macro_f1"])
    minimum_support = int(acceptance["minimum_test_support_per_critical_label"])
    minimum_critical_recall = acceptance["minimum_test_recall"]
    gates = [
        {
            "name": "macro_f1",
            "actual": report["macro"]["f1"],
            "required": minimum_macro_f1,
            "passed": report["macro"]["f1"] >= minimum_macro_f1,
        }
    ]
    for label, required_recall in minimum_critical_recall.items():
        values = report["per_label"][label]
        gates.extend(
            [
                {
                    "name": f"{METRIC_ALIASES.get(label, label)}_test_support",
                    "actual": values["support"],
                    "required": minimum_support,
                    "passed": values["support"] >= minimum_support,
                },
                {
                    "name": f"{METRIC_ALIASES.get(label, label)}_recall",
                    "actual": values["recall"],
                    "required": float(required_recall),
                    "passed": values["recall"] >= float(required_recall),
                },
            ]
        )
    return {"passed": all(gate["passed"] for gate in gates), "gates": gates}


def _load_training_dependencies():
    try:
        import torch
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
            DataCollatorWithPadding,
            Trainer,
            TrainingArguments,
        )
    except ImportError as error:  # pragma: no cover - depends on optional install
        raise TrainingDependencyError(
            "Training requires PyTorch and Transformers. Install text_safety/requirements-training.txt."
        ) from error
    return (
        torch,
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        Trainer,
        TrainingArguments,
    )


def train_model(
    splits: dict[str, list[AnnotationRecord]],
    config: dict[str, Any],
    output_dir: Path,
) -> tuple[Any, Any, list[list[float]], list[list[float]], dict[str, Any]]:
    """Fine-tune a multi-label encoder and return validation/test probabilities.

    No model is downloaded until this function is invoked.  It is intentionally
    separate from validation so CI can test data contracts in an offline runner.
    """

    if any(not splits.get(name) for name in ("train", "validation", "test")):
        raise TextSafetyTrainingError("Training requires non-empty train, validation and test splits")
    (
        torch,
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        Trainer,
        TrainingArguments,
    ) = _load_training_dependencies()
    labels = canonical_labels()
    model_config = config["model"]
    training = config["training"]
    tokenizer = AutoTokenizer.from_pretrained(
        model_config["id"], revision=model_config["revision"], use_fast=True
    )
    model = AutoModelForSequenceClassification.from_pretrained(
        model_config["id"],
        revision=model_config["revision"],
        num_labels=len(labels),
        id2label={index: label for index, label in enumerate(labels)},
        label2id={label: index for index, label in enumerate(labels)},
        problem_type="multi_label_classification",
    )

    class SafetyDataset(torch.utils.data.Dataset):
        def __init__(self, items: Sequence[AnnotationRecord]) -> None:
            self.items = list(items)
            self.encodings = tokenizer(
                [format_model_text(item) for item in self.items],
                truncation=True,
                max_length=int(training["max_length"]),
            )

        def __len__(self) -> int:
            return len(self.items)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return {
                **{key: value[index] for key, value in self.encodings.items()},
                "labels": label_vector(self.items[index], labels),
            }

    class MultiLabelDataCollator(DataCollatorWithPadding):
        def __call__(self, features: list[dict[str, Any]]) -> dict[str, Any]:
            label_values = [feature.pop("labels") for feature in features]
            batch = super().__call__(features)
            batch["labels"] = torch.tensor(label_values, dtype=torch.float32)
            return batch

    positive_counts = [sum(vector[index] for vector in (label_vector(item, labels) for item in splits["train"])) for index in range(len(labels))]
    train_size = len(splits["train"])
    # Cap a rare-label weight; a single reviewed sample must not destabilize BCE.
    positive_weights = [
        min(20.0, (train_size - count) / count) if count else 1.0
        for count in positive_counts
    ]

    class WeightedMultiLabelTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **_: Any):
            model_inputs = dict(inputs)
            expected = model_inputs.pop("labels").float()
            outputs = model(**model_inputs)
            weights = torch.tensor(positive_weights, dtype=torch.float32, device=outputs.logits.device)
            loss = torch.nn.BCEWithLogitsLoss(pos_weight=weights)(outputs.logits, expected)
            return (loss, outputs) if return_outputs else loss

    train_dataset = SafetyDataset(splits["train"])
    validation_dataset = SafetyDataset(splits["validation"])
    test_dataset = SafetyDataset(splits["test"])

    def trainer_metrics(prediction: Any) -> dict[str, float]:
        raw_predictions = prediction.predictions
        if isinstance(raw_predictions, tuple):
            raw_predictions = raw_predictions[0]
        probabilities = probabilities_from_logits(raw_predictions.tolist())
        flat_records = [
            AnnotationRecord(
                payload={"record_id": str(index), "labels": [label for label, value in zip(labels, row) if value >= 0.5]},
                source_path="memory",
                source_line=index,
            )
            for index, row in enumerate(prediction.label_ids.tolist())
        ]
        metrics = multilabel_evaluation(
            flat_records, probabilities, {label: 0.5 for label in labels}, labels=labels, error_limit=0
        )
        return {"macro_f1": metrics["macro"]["f1"], "micro_f1": metrics["micro"]["f1"]}

    output_dir.mkdir(parents=True, exist_ok=False)
    arguments_kwargs = {
        "output_dir": str(output_dir / "checkpoints"),
        "learning_rate": float(training["learning_rate"]),
        "per_device_train_batch_size": int(training["train_batch_size"]),
        "per_device_eval_batch_size": int(training["eval_batch_size"]),
        "num_train_epochs": float(training["epochs"]),
        "weight_decay": float(training["weight_decay"]),
        "warmup_ratio": float(training["warmup_ratio"]),
        "logging_strategy": "epoch",
        "save_strategy": "epoch",
        "load_best_model_at_end": True,
        "metric_for_best_model": "macro_f1",
        "greater_is_better": True,
        "seed": int(training["seed"]),
        "data_seed": int(training["seed"]),
        "report_to": [],
        "remove_unused_columns": False,
        "fp16": False,
    }
    signature = inspect.signature(TrainingArguments.__init__).parameters
    arguments_kwargs["eval_strategy" if "eval_strategy" in signature else "evaluation_strategy"] = "epoch"
    trainer = WeightedMultiLabelTrainer(
        model=model,
        args=TrainingArguments(**arguments_kwargs),
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=MultiLabelDataCollator(tokenizer=tokenizer),
        compute_metrics=trainer_metrics,
    )
    train_result = trainer.train()
    trainer.save_model(str(output_dir / "model"))
    tokenizer.save_pretrained(output_dir / "model")

    def predict(dataset: Any) -> list[list[float]]:
        prediction = trainer.predict(dataset)
        logits = prediction.predictions[0] if isinstance(prediction.predictions, tuple) else prediction.predictions
        return probabilities_from_logits(logits.tolist())

    resolved_revision = getattr(model.config, "_commit_hash", None) or model_config["revision"]
    run_summary = {
        "base_model": model_config["id"],
        "requested_revision": model_config["revision"],
        "resolved_revision": resolved_revision,
        "positive_class_weights": {label: weight for label, weight in zip(labels, positive_weights)},
        "training_metrics": {key: value for key, value in train_result.metrics.items() if isinstance(value, (int, float))},
    }
    return model, tokenizer, predict(validation_dataset), predict(test_dataset), run_summary


def run_training(
    input_paths: Sequence[Path],
    *,
    config_path: Path = DEFAULT_CONFIG_PATH,
    output_dir: Path,
    preserve_splits: bool = False,
) -> dict[str, Any]:
    """Run the complete preparation → training → held-out evaluation workflow."""

    config = load_training_config(config_path)
    records = validate_annotation_records(
        load_jsonl_records(input_paths),
        allowed_uses=set(config.get("allowed_dataset_uses", ["commercial", "internal_evaluation"])),
    )
    if preserve_splits:
        splits, split_metadata = preserved_group_splits(records)
    else:
        splits, split_metadata = grouped_multilabel_split(
            records, ratios=config["split_ratios"], seed=str(config["split_seed"])
        )
    model, tokenizer, validation_probabilities, test_probabilities, run_summary = train_model(
        splits, config, output_dir
    )
    del model, tokenizer  # avoid retaining a large model while serialising reports
    labels = canonical_labels()
    thresholds, threshold_report = select_thresholds(
        splits["validation"],
        validation_probabilities,
        candidates=config["threshold_tuning"]["candidates"],
        minimum_recall=config["threshold_tuning"].get("minimum_recall", {}),
        labels=labels,
    )
    test_report = multilabel_evaluation(
        splits["test"], test_probabilities, thresholds, labels=labels
    )
    gate = deployment_gate(test_report, config["acceptance"])
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    dataset_hash = dataset_fingerprint(records)
    manifest = {
        "pipeline_version": "text-safety-training-v1",
        "created_at": timestamp,
        "model_version": config["model_version"],
        "dataset_version": config["dataset_version"],
        "dataset_fingerprint_sha256": dataset_hash,
        "training_config_version": config["config_version"],
        "training_config_sha256": _sha256_json(config),
        "taxonomy_version": load_taxonomy().version,
        "labels": list(labels),
        "model": run_summary,
        "split": split_metadata,
        "sources": _source_summary(records),
        "privacy": {
            "raw_text_written_to_reports": False,
            "error_examples_include_only": ["record_id", "label"],
        },
    }
    metadata = {
        "model_version": config["model_version"],
        "dataset_version": config["dataset_version"],
        "taxonomy_version": load_taxonomy().version,
        "base_model": run_summary["base_model"],
        "base_model_revision": run_summary["resolved_revision"],
        "labels": list(labels),
        "thresholds": thresholds,
        "deployment_approved": gate["passed"],
        "manifest_file": "../training_manifest.json",
    }
    _write_json(output_dir / "training_config.json", config)
    _write_json(output_dir / "training_manifest.json", manifest)
    _write_json(output_dir / "thresholds.json", {"thresholds": thresholds, "validation": threshold_report})
    _write_json(output_dir / "evaluation_report.json", {"test": test_report, "deployment_gate": gate})
    _write_json(output_dir / "model" / "text_safety_model_metadata.json", metadata)
    return {
        "output_dir": str(output_dir),
        "deployment_approved": gate["passed"],
        "macro_f1": test_report["macro"]["f1"],
        "critical_recall": test_report["critical_recall"],
        "dataset_fingerprint_sha256": dataset_hash,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fine-tune and evaluate the Vietnamese multi-label text-safety model."
    )
    parser.add_argument(
        "--input",
        action="append",
        required=True,
        type=Path,
        help="Accepted anonymized JSONL file. Repeat once per reviewed source.",
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="New, not-yet-created artifact directory for this immutable model version.",
    )
    parser.add_argument(
        "--preserve-splits",
        action="store_true",
        help="Use reviewed split fields after verifying conversation/subject isolation.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = run_training(
            args.input,
            config_path=args.config,
            output_dir=args.output_dir,
            preserve_splits=args.preserve_splits,
        )
    except (TextSafetyTrainingError, TrainingDependencyError, OSError, ValueError) as error:
        print(f"Text-safety training failed: {error}", file=sys.stderr)
        return 2
    print(
        "Text-safety training completed: "
        f"approved={report['deployment_approved']} macro_f1={report['macro_f1']:.4f} "
        f"artifacts={report['output_dir']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
