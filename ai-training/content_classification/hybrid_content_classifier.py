"""Deterministic lookup and safe routing for the hybrid content pipeline."""

from __future__ import annotations

from collections import Counter

from content_classification.content_model import (
    canonical_key,
    predict_model,
    validate_model,
)


LOOKUP_VERSION = "1.0.0"


def build_exact_lookup(
    records: list[dict],
    resource_type: str,
    classes: list[str] | tuple[str, ...],
    *,
    dataset_sha256: str,
    generated_at: str,
) -> dict:
    """Build an auditable exact-label map from already reviewed records."""
    key_field = "app_name" if resource_type == "apps" else "domain"
    labels = {}
    counts = Counter()
    for record in records:
        key = canonical_key(resource_type, record[key_field])
        label = record["label"]
        if label not in classes:
            raise ValueError(f"label outside exact lookup classes: {label}")
        previous = labels.setdefault(key, label)
        if previous != label:
            raise ValueError(f"conflicting exact labels for {key}")
        counts[label] += 1
    lookup = {
        "lookup_version": LOOKUP_VERSION,
        "resource_type": resource_type,
        "key_field": key_field,
        "classes": list(classes),
        "normalization": "canonical_content_identifier_v1",
        "dataset_sha256": dataset_sha256,
        "generated_at": generated_at,
        "record_count": len(labels),
        "label_counts": dict(sorted(counts.items())),
        "labels": dict(sorted(labels.items())),
    }
    return validate_exact_lookup(lookup)


def validate_exact_lookup(lookup: dict) -> dict:
    if not isinstance(lookup, dict) or lookup.get("lookup_version") != LOOKUP_VERSION:
        raise ValueError("unsupported exact lookup version")
    resource_type = lookup.get("resource_type")
    if resource_type not in {"apps", "websites"}:
        raise ValueError("invalid exact lookup resource_type")
    expected_key = "app_name" if resource_type == "apps" else "domain"
    if lookup.get("key_field") != expected_key:
        raise ValueError("exact lookup key_field is incompatible")
    classes = lookup.get("classes")
    if not isinstance(classes, list) or len(classes) < 2 or len(classes) != len(set(classes)):
        raise ValueError("exact lookup classes are invalid")
    labels = lookup.get("labels")
    if not isinstance(labels, dict) or not labels:
        raise ValueError("exact lookup labels are empty")
    if any(
        not isinstance(key, str)
        or canonical_key(resource_type, key) != key
        or label not in classes
        for key, label in labels.items()
    ):
        raise ValueError("exact lookup contains an invalid key or label")
    if lookup.get("record_count") != len(labels):
        raise ValueError("exact lookup record_count does not match labels")
    return lookup


def route_content_classification(
    model: dict,
    lookup: dict | None,
    value: str,
    metadata_value: str | None = None,
) -> dict:
    """Route one identifier without invoking Gemini itself.

    A reviewed exact match is always authoritative. The trained model may only
    return a final label when its deployment gate passed and confidence is at
    least 0.70. Every other case explicitly requests the Gemini fallback.
    """
    validate_model(model)
    if lookup is not None:
        validate_exact_lookup(lookup)
        if model["resource_type"] != lookup["resource_type"]:
            raise ValueError("model and exact lookup resource_type do not match")
    key = canonical_key(model["resource_type"], value)
    exact_label = lookup["labels"].get(key) if lookup is not None else None
    if exact_label is not None:
        return {
            "label": exact_label,
            "candidate_label": exact_label,
            "confidence": 1.0,
            "decision_source": "exact_lookup",
            "requires_gemini": False,
            "reason": "reviewed_identifier_match",
        }

    prediction = predict_model(model, key, metadata_value)
    model_can_decide = model["deployment_approved"] and prediction["conclusive"]
    return {
        "label": prediction["label"] if model_can_decide else None,
        "candidate_label": prediction["label"],
        "confidence": prediction["confidence"],
        "decision_source": "trained_model" if model_can_decide else "gemini_required",
        "requires_gemini": not model_can_decide,
        "reason": (
            "model_confidence_at_or_above_threshold"
            if model_can_decide
            else (
                "model_not_deployment_approved"
                if not model["deployment_approved"]
                else (
                    "runtime_metadata_missing"
                    if prediction.get("metadata_available") is False
                    else "model_confidence_below_threshold"
                )
            )
        ),
        "probabilities": prediction["probabilities"],
    }
