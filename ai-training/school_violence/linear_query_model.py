"""Portable inference for the experimental word TF-IDF query classifier."""

from __future__ import annotations

import math
import re

from text_safety.normalization import normalize_text


ALGORITHM = "tfidf_word_softmax_v1"


def word_features(text: str) -> set[str]:
    tokens = re.findall(r"\w+", normalize_text(text).folded, flags=re.UNICODE)
    return ({"w:" + token for token in tokens}
            | {"b:" + first + " " + second
               for first, second in zip(tokens, tokens[1:])})


def predict_scores_linear(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") != ALGORITHM:
        raise ValueError("Unsupported linear query artifact")
    labels = tuple(model["labels"])
    features = [model["features"][key] for key in word_features(text)
                if key in model["features"]]
    if not features:
        return {label: float(model["fallback_prior"][label]) for label in labels}
    norm = math.sqrt(sum(entry[0] ** 2 for entry in features))
    scores = [float(value) for value in model["bias"]]
    if norm:
        for idf, *weights in features:
            for index, weight in enumerate(weights):
                scores[index] += idf * weight / norm
    peak = max(scores)
    probabilities = [math.exp(value - peak) for value in scores]
    total = sum(probabilities)
    return {label: probability / total
            for label, probability in zip(labels, probabilities)}
