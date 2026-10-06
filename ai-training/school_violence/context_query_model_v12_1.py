"""Financial coercion aliases; learned features, never label-routing rules."""

from __future__ import annotations

from text_safety.normalization import normalize_text
from .component_context_query_model import head_scores
from .context_query_model_v11 import self_at, spans
from .context_query_model_v12 import context_features as typed_context, other_at, subject_roles
from .linear_query_model import word_features

ALGORITHM = "financial_context_word_softmax_v1"
PURCHASE = (("phai", "mua"), ("ep", "mua"), ("bat", "mua"))
RETENTION = (("khong", "chiu", "tra"), ("khong", "tra"), ("giu", "lai"))
PROPERTY = (("dien", "thoai"), ("vi",), ("do",), ("tai", "san"))


def financial_features(text: str, context: set[str]) -> set[str]:
    normalized = normalize_text(text)
    tokens, accented = normalized.folded.split(), normalized.unicode.split()
    purchases = [(start, end) for phrase in PURCHASE for start, end in spans(tokens, phrase)]
    peers = "nhom" in tokens or any(token == "ban" and other_at(tokens, accented, i)
                                    for i, token in enumerate(tokens))
    persistent = bool(set(tokens) & {"luon", "cu"}) or any(spans(tokens, ("nhieu", "lan")))
    forced = bool(set(tokens) & {"ep", "bat"})
    obligation = bool(purchases) and peers and (persistent or forced)
    retained = (any(any(spans(tokens, phrase)) for phrase in RETENTION)
                and any(any(spans(tokens, phrase)) for phrase in PROPERTY)
                and "ctx:pressure" in context)
    if not obligation and not retained:
        return set()
    features = {"ctx:money_coercion"}
    self_target = any("self_affected" in subject_roles(tokens, accented, start)
                      for start, _ in purchases) if obligation else False
    if retained:
        # Subject of a conditional demand, not a pronoun anywhere in the query.
        for start, _ in spans(tokens, ("neu",)):
            if start + 1 < len(tokens) and self_at(tokens, start + 1):
                self_target = True
    if self_target:
        features.update(("ctx:self_affected", "ctx:self_affected+money_coercion",
                         "ctx:self_reference+money_coercion"))
    if "ctx:general" in context:
        features.add("ctx:general+money_coercion")
    if "ctx:repeated" in context:
        features.add("ctx:repeated+money_coercion")
    return features


def context_features(text: str) -> set[str]:
    context = typed_context(text)
    return context | financial_features(text, context)


def query_features(text: str) -> set[str]:
    return word_features(text) | context_features(text)


def predict_scores_financial_context(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported financial-context artifact")
    return head_scores(model["head"], query_features(text))
