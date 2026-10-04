"""Portable inference for a two-stage SAFE/alert and RISK/HIGH_RISK model."""

from __future__ import annotations

import math

from .linear_query_model import word_features


ALGORITHM = "tfidf_two_stage_query_v1"


def _head_scores(head: dict, text: str) -> dict[str, float]:
    labels = head["labels"]
    entries = [head["features"][feature] for feature in word_features(text)
               if feature in head["features"]]
    if not entries:
        return {label: float(head["fallback_prior"][label]) for label in labels}
    norm = math.sqrt(sum(entry[0] ** 2 for entry in entries))
    logits = list(head["bias"])
    for idf, *weights in entries:
        for index, weight in enumerate(weights):
            logits[index] += idf * weight / norm
    peak = max(logits)
    values = [math.exp(logit - peak) for logit in logits]
    total = sum(values)
    return {label: value / total for label, value in zip(labels, values)}


def predict_scores_two_stage(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") != ALGORITHM:
        raise ValueError("Unsupported two-stage query artifact")
    gate = _head_scores(model["heads"]["gate"], text)
    severity = _head_scores(model["heads"]["severity"], text)
    return {
        "SAFE": gate["SAFE"],
        "RISK": gate["ALERT"] * severity["RISK"],
        "HIGH_RISK": gate["ALERT"] * severity["HIGH_RISK"],
    }


def select_two_stage_label(model: dict, scores: dict[str, float]) -> str:
    rule = model.get("decision_rule", "joint_argmax")
    if rule == "joint_argmax":
        return max(("SAFE", "RISK", "HIGH_RISK"), key=scores.get)
    if rule != "hard_route":
        raise ValueError("Unknown two-stage decision rule")
    alert_probability = scores["RISK"] + scores["HIGH_RISK"]
    if alert_probability < model["gate_threshold"]:
        return "SAFE"
    high_probability = scores["HIGH_RISK"] / alert_probability if alert_probability else 0.0
    return "HIGH_RISK" if high_probability >= model["severity_threshold"] else "RISK"
