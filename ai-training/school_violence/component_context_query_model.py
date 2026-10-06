"""Serializable context-feature ablation; no output-label overrides."""

from __future__ import annotations

import math

from .context_query_model_v11 import context_features
from .linear_query_model import word_features

ALGORITHM = "component_context_word_softmax_v1"
PROFILES = {"v11_full": None, "omit_academic": "academic",
            "omit_roles": "roles", "omit_pressure": "pressure"}
ROLES = ("self_reference", "affected", "witness", "self_affected", "other_affected")


def family(feature: str) -> str:
    if not feature.startswith("ctx:"):
        return "word"
    value = feature[4:]
    if value == "pressure" or value.startswith("pressure+") or value.endswith("+pressure"):
        return "pressure"
    if value == "academic_action" or value.endswith("+academic_action"):
        return "academic"
    if any(value == role or value.startswith(role + "+") for role in ROLES):
        return "roles"
    return "other_context"


def query_features(text: str, profile: str) -> set[str]:
    if profile not in PROFILES:
        raise ValueError("Unknown context component profile")
    excluded = PROFILES[profile]
    return word_features(text) | {key for key in context_features(text) if family(key) != excluded}


def head_scores(head: dict, keys: set[str]) -> dict[str, float]:
    entries = [head["features"][key] for key in sorted(keys) if key in head["features"]]
    if not entries:
        return {label: float(head["fallback_prior"][label]) for label in head["labels"]}
    norm = math.sqrt(sum(entry[0] ** 2 for entry in entries))
    logits = list(map(float, head["bias"]))
    for idf, *weights in entries:
        for index, weight in enumerate(weights):
            logits[index] += idf * weight / norm
    peak = max(logits)
    probabilities = [math.exp(value - peak) for value in logits]
    total = sum(probabilities)
    return {label: value / total for label, value in zip(head["labels"], probabilities)}


def predict_scores_components(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported component-context artifact")
    return head_scores(model["head"], query_features(text, model["context_profile"]))
