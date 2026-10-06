"""Learned context features and a portable high-first query classifier.

The feature vocabulary describes wording, not output labels. No feature or
phrase overrides a prediction: all head weights come from labelled training.
"""

from __future__ import annotations

import math
import re

from text_safety.normalization import normalize_text
from .linear_query_model import word_features

FLAT_ALGORITHM = "context_word_softmax_v1"
HIGH_FIRST_ALGORITHM = "high_first_query_v1"

# Broad concepts from the annotation policy. These are fixed before fitting.
# Short ambiguous syllables use accented tokens; multiword phrases also cover
# unaccented queries through the normalizer's folded representation.
PHRASES = {
    "physical": ("bóp cổ", "siết cổ", "đẩy ngã", "giật tóc", "đập đầu", "đánh đập", "đánh mình", "đánh em", "đánh tôi"),
    "threat": ("đe dọa", "hăm dọa", "dọa đánh", "dọa giết", "chặn đánh", "trả thù"),
    "weapon": ("hung khí", "vũ khí", "cầm dao", "mang dao", "dao nhọn"),
    "money_coercion": ("tống tiền", "trấn lột", "ép đưa tiền", "bắt nộp tiền", "đòi tiền"),
    "property_harm": ("xé vở", "xé sách", "đập hỏng", "phá hỏng", "đốt cặp", "cố tình phá"),
    "disclosure": ("tung ảnh", "đăng ảnh", "tung clip", "đăng clip", "bêu xấu", "tiết lộ", "tung thông tin"),
    "pressure": ("yêu cầu", "ép buộc", "thúc ép", "bắt phải", "làm theo", "phải đưa", "chứng minh tình bạn"),
    "verbal": ("trêu chọc", "biệt danh", "nói xấu", "chế nhạo", "khó chịu", "chửi mình"),
    "exclusion": ("cô lập", "không chơi", "loại khỏi", "tẩy chay"),
    "repeated": ("hàng ngày", "mỗi ngày", "liên tục", "thường xuyên", "nhiều lần"),
    "witness": ("chứng kiến", "thấy bạn", "bạn bị", "người bạn", "con vật", "con cún"),
    "general": ("có phải", "khái niệm", "là gì", "thuyết trình", "phòng chống", "phòng tránh", "tìm hiểu"),
    "urgent": ("khẩn cấp", "khó thở", "chảy máu", "cấp cứu", "ngay bây giờ"),
    "academic_action": ("đánh giá", "đánh vần", "đánh cờ", "đánh đàn", "đánh bóng"),
}
FOLDED_PHRASES = {group: tuple(normalize_text(phrase).folded for phrase in phrases)
                  for group, phrases in PHRASES.items()}
PHYSICAL_TOKENS = {"đấm", "đá", "đạp", "tát", "đập", "bóp", "siết", "trói", "đánh"}


def context_features(text: str) -> set[str]:
    normalized = normalize_text(text)
    value = " " + normalized.folded + " "
    tokens = set(normalized.unicode.split())
    folded_tokens = set(normalized.folded.split())
    groups = {group for group, phrases in FOLDED_PHRASES.items()
              if any(" " + phrase + " " in value for phrase in phrases)}
    if tokens & PHYSICAL_TOKENS or re.search(r"\bbi (?:\w+ ){0,3}(?:danh|dam|tat|bop)\b", value):
        groups.add("physical")
    if "thấy" in tokens:
        groups.add("witness")
    if "nếu" in tokens:
        groups.add("general")
    if tokens & {"ép", "buộc"}:
        groups.add("pressure")
    if folded_tokens & {"minh", "em", "toi", "to", "tao", "con"}:
        groups.add("self_reference")
    if "bi" in folded_tokens:
        groups.add("affected")
    features = {"ctx:" + group for group in groups}
    for role in ("self_reference", "affected", "witness", "general", "repeated"):
        if role in groups:
            features.update("ctx:" + role + "+" + action for action in groups
                            if action not in (role, "self_reference", "affected", "witness", "general", "repeated"))
    return features


def query_features(text: str, context: bool) -> set[str]:
    return word_features(text) | (context_features(text) if context else set())


def head_scores(head: dict, text: str) -> dict[str, float]:
    labels = head["labels"]
    entries = [head["features"][key] for key in sorted(query_features(text, head["context_features"]))
               if key in head["features"]]
    if not entries:
        return {label: float(head["fallback_prior"][label]) for label in labels}
    norm = math.sqrt(sum(entry[0] ** 2 for entry in entries))
    logits = list(map(float, head["bias"]))
    for idf, *weights in entries:
        for index, weight in enumerate(weights):
            logits[index] += idf * weight / norm
    peak = max(logits)
    probabilities = [math.exp(value - peak) for value in logits]
    total = sum(probabilities)
    return {label: value / total for label, value in zip(labels, probabilities)}


def predict_scores_context(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] == FLAT_ALGORITHM:
        return head_scores(model["head"], text)
    if model["algorithm"] != HIGH_FIRST_ALGORITHM:
        raise ValueError("Unsupported context query artifact")
    high = head_scores(model["heads"]["high"], text)
    rest = head_scores(model["heads"]["rest"], text)
    return {"SAFE": high["OTHER"] * rest["SAFE"],
            "RISK": high["OTHER"] * rest["RISK"], "HIGH_RISK": high["HIGH_RISK"]}


def select_context_label(model: dict, scores: dict[str, float]) -> str:
    if model["algorithm"] == FLAT_ALGORITHM:
        return max(("SAFE", "RISK", "HIGH_RISK"), key=scores.get)
    threshold = model["high_threshold"]
    if not math.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError("High-risk threshold must be finite and inside (0,1)")
    if scores["HIGH_RISK"] >= threshold:
        return "HIGH_RISK"
    return "RISK" if scores["RISK"] >= scores["SAFE"] else "SAFE"
