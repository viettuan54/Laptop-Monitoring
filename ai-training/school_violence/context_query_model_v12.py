"""Learned context with typed pressure and versioned recipient extraction."""

from __future__ import annotations

from text_safety.normalization import normalize_text
from .component_context_query_model import head_scores
from .context_query_model import FOLDED_PHRASES, PHYSICAL_TOKENS, context_features as legacy_context
from .context_query_model_v11 import (
    ACTION_GROUPS, CLAUSES, DOMAINS, NONVIOLENT, OTHER, TARGET_LINKS, self_at, spans,
)
from .linear_query_model import word_features

ALGORITHM = "typed_context_word_softmax_v1"
CONSEQUENCES = {
    "threat": ("đe dọa", "hăm dọa", "dọa", "trả thù", "chặn đánh"),
    "movement": ("khóa cửa", "nhốt", "giam", "không cho về", "không cho rời",
                 "không được về", "ngăn không cho", "không cho mình về"),
    "deprivation": ("không được ăn", "không cho ăn", "không được ngủ", "ép uống",
                    "ép hút", "uống một chất"),
    "humiliation": ("quỳ", "quay video", "quay clip", "vẽ bậy lên người", "cởi quần",
                    "cởi áo", "lột quần", "lột áo"),
    "property": ("lấy điện thoại", "giữ điện thoại", "không chịu trả", "giao điện thoại", "giao ví"),
    "money": ("đưa tiền", "nộp tiền", "đòi tiền", "giao ví"),
    "privacy": ("ảnh nhạy cảm", "ảnh riêng tư", "hình ảnh riêng tư", "tung tin",
                "phát tán", "đăng lên mạng"),
}
FOLDED_CONSEQUENCES = {key: tuple(tuple(normalize_text(phrase).folded.split()) for phrase in phrases)
                       for key, phrases in CONSEQUENCES.items()}
REQUESTS = tuple(tuple(normalize_text(phrase).folded.split()) for phrase in (
    "yêu cầu", "thúc ép", "chứng minh tình bạn", "phải đưa"))
REPEATED_PRESSURE = tuple(tuple(normalize_text(phrase).folded.split()) for phrase in (
    "ngày nào cũng", "luôn", "liên tục", "thường xuyên", "nhiều lần", "cứ ép"))


def other_at(tokens: list[str], accented: list[str], index: int) -> bool:
    if tokens[index] not in OTHER:
        return False
    # Folding may merge a person with an adverb/object. Use available accents.
    if accented[index] in ("chỉ", "ảnh", "bàn", "bán", "bắn", "bẻ"):
        return False
    return True


def subject_roles(tokens: list[str], accented: list[str], stop: int) -> set[str]:
    left = max(0, stop - 6)
    selves = [i for i in range(left, stop) if self_at(tokens, i)]
    others = [i for i in range(left, stop) if other_at(tokens, accented, i)]
    if others:
        last = others[-1]
        if not selves or last > selves[-1] or all(
                token in ("cua", "minh", "em", "toi", "to") for token in tokens[last + 1:stop]):
            result = {"other_affected"}
            if selves and "va" in tokens[selves[-1] + 1:last]:
                result.add("self_affected")
            return result
    return {"self_affected"} if selves else set()


def event_roles(tokens: list[str], accented: list[str], start: int, end: int, group: str) -> set[str]:
    roles = set()
    passive = [i for i in range(max(0, start - 8), start) if tokens[i] == "bi"]
    if passive:
        roles.update(subject_roles(tokens, accented, passive[-1]))
    for i in range(end, min(len(tokens), end + 4)):
        if not all(token in TARGET_LINKS for token in tokens[end:i]):
            break
        if self_at(tokens, i):
            roles.add("self_affected")
            break
        if other_at(tokens, accented, i):
            roles.add("other_affected")
            break
    if group in ("threat", "weapon"):
        for i in range(end, min(len(tokens) - 1, end + 14)):
            if tokens[i] in ("tim", "giet", "danh") and self_at(tokens, i + 1):
                roles.add("self_affected")
    return roles


def role_features(text: str) -> set[str]:
    """Keep v11 local extraction; change only accent-aware other-person matching."""
    features = set()
    for clause in CLAUSES.split(text):
        normalized = normalize_text(clause)
        tokens, accented = normalized.folded.split(), normalized.unicode.split()
        if not tokens:
            continue
        events = {group: set() for group in FOLDED_PHRASES}
        for group, phrases in FOLDED_PHRASES.items():
            if group != "witness":
                for phrase in phrases:
                    events[group].update(spans(tokens, tuple(phrase.split())))
        masked = {i for phrase in NONVIOLENT for start, end in spans(tokens, phrase) for i in range(start, end)}
        if masked:
            events["academic_action"].add((min(masked), max(masked) + 1))
        for i, token in enumerate(accented):
            if i in masked:
                continue
            unaccented_action = tokens[i] in ("danh", "dam", "tat", "bop") and "bi" in tokens[max(0, i - 4):i]
            if token in PHYSICAL_TOKENS or unaccented_action:
                events["physical"].add((i, i + 1))
            if token in ("ép", "buộc") or tokens[i] in ("ep", "buoc"):
                events["pressure"].add((i, i + 1))
        events["physical"] = {(start, end) for start, end in events["physical"]
                              if not any(i in masked for i in range(start, end))}
        groups = {group for group, found in events.items() if found}
        if "neu" in tokens:
            groups.add("general")
        if any(self_at(tokens, i) for i in range(len(tokens))):
            groups.add("self_reference")
        if "bi" in tokens:
            groups.add("affected")
        observer = any(tuple(phrase) == tuple(tokens[i:i + len(phrase)])
                       for phrase in (("chung", "kien"), ("nhin", "thay"), ("thay", "ban"))
                       for i in range(len(tokens)))
        for group in ACTION_GROUPS & groups:
            roles = set().union(*(event_roles(tokens, accented, start, end, group)
                                  for start, end in events[group]))
            features.update("ctx:" + role + "+" + group for role in roles)
            groups.update(roles)
            if "self_affected" in roles:
                features.add("ctx:self_reference+" + group)
            if roles and "bi" in tokens:
                features.add("ctx:affected+" + group)
            if "other_affected" in roles and (observer or "bi" in tokens):
                groups.add("witness")
                features.add("ctx:witness+" + group)
        if observer:
            groups.add("witness")
        for role in ("general", "repeated"):
            if role in groups:
                features.update("ctx:" + role + "+" + group for group in groups
                                if group in ACTION_GROUPS or group in ("urgent", "academic_action"))
        if "self_reference" in groups and "academic_action" in groups:
            features.add("ctx:self_reference+academic_action")
        features.update("ctx:" + group for group in groups)
    return features


def pressure_features(text: str, context: set[str]) -> set[str]:
    if "ctx:pressure" not in context:
        return set()
    normalized = normalize_text(text)
    tokens = normalized.folded.split()
    request_spans = [(start, end) for phrase in REQUESTS for start, end in spans(tokens, phrase)]
    # "thúc ép" is a distinct wording type; a second standalone "ép" is retained.
    urge = {i for start, end in spans(tokens, ("thuc", "ep")) for i in range(start, end)}
    modes = set()
    if request_spans:
        modes.add("request")
    if any(token in ("ep", "buoc", "bat") and i not in urge for i, token in enumerate(tokens)):
        modes.add("coercion")
    if any(spans(tokens, ("lam", "theo"))):
        modes.add("compliance")
    if not modes:
        modes.add("unspecified")
    consequences = {kind for kind, phrases in FOLDED_CONSEQUENCES.items()
                    if any(any(spans(tokens, phrase)) for phrase in phrases)}
    for group in ("physical", "weapon", "money_coercion", "property_harm", "disclosure"):
        if "ctx:" + group in context:
            consequences.add(group)
    if not consequences:
        consequences.add("unspecified")
    topics = {topic for topic, phrases in DOMAINS.items()
              if any(any(spans(tokens, tuple(normalize_text(phrase).folded.split()))) for phrase in phrases)}
    features = {"ctx:pressure"}
    for mode in modes:
        features.add("ctx:pressure_mode:" + mode)
        features.update("ctx:pressure_mode:" + mode + "+consequence:" + kind for kind in consequences)
        features.update("ctx:pressure_mode:" + mode + "+topic:" + topic for topic in topics)
    if any(any(spans(tokens, phrase)) for phrase in REPEATED_PRESSURE):
        features.add("ctx:pressure_pattern:repeated")
    return features


def context_features(text: str) -> set[str]:
    context = role_features(text)
    # Retain useful legacy verbal/exclusion interactions without restoring global
    # self+physical linkage or forcing a predicted risk level.
    context.update(key for key in legacy_context(text)
                   if key.endswith("+verbal") or key.endswith("+exclusion"))
    base = {key for key in context if key != "ctx:pressure" and not key.endswith("+pressure")}
    return base | pressure_features(text, context)


def query_features(text: str) -> set[str]:
    return word_features(text) | context_features(text)


def predict_scores_typed_context(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported typed-context artifact")
    return head_scores(model["head"], query_features(text))
