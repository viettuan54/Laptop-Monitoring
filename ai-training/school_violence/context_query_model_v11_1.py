"""Conservative v10 phrase disambiguation after the full-role trial failed."""

from __future__ import annotations

import math

from .context_query_model import context_features as v10_context
from .context_query_model_v11 import context_features as role_context
from .linear_query_model import word_features

ALGORITHM = "phrase_context_word_softmax_v1"


def context_features(text: str) -> set[str]:
    original = v10_context(text)
    local = role_context(text)
    if "ctx:academic_action" in local and "ctx:physical" not in local:
        return {key for key in original if key != "ctx:physical" and not key.endswith("+physical")}
    return original


def query_features(text: str) -> set[str]:
    return word_features(text) | context_features(text)


def predict_scores_phrase_context(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported phrase-context artifact")
    head = model["head"]
    entries = [head["features"][key] for key in sorted(query_features(text)) if key in head["features"]]
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
