"""Portable word/character query inference; training stays in a separate module."""

from __future__ import annotations

import math

from text_safety.normalization import normalize_text
from .linear_query_model import word_features

ALGORITHM = "tfidf_word_char_softmax_v1"


def hybrid_features(text: str) -> set[str]:
    value = " " + normalize_text(text).folded + " "
    return word_features(text) | {
        "c:" + value[index:index + size]
        for size in range(3, 6) for index in range(len(value) - size + 1)
    }


def predict_scores_hybrid(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") != ALGORITHM:
        raise ValueError("Unsupported hybrid query artifact")
    labels = tuple(model["labels"])
    entries = [model["features"][key] for key in sorted(hybrid_features(text))
               if key in model["features"]]
    if not entries:
        return {label: float(model["fallback_prior"][label]) for label in labels}
    norm = math.sqrt(sum(entry[0] ** 2 for entry in entries))
    logits = list(map(float, model["bias"]))
    for idf, *weights in entries:
        for index, weight in enumerate(weights):
            logits[index] += idf * weight / norm
    peak = max(logits)
    scores = [math.exp(value - peak) for value in logits]
    total = sum(scores)
    return {label: score / total for label, score in zip(labels, scores)}
