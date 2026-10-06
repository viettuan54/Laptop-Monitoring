"""Versioned phrase/recipient features; learned softmax, never keyword labels.

V10 extraction is deliberately unchanged. Local role rules are conservative
features, not a full Vietnamese dependency parser or a diagnosis.
"""

from __future__ import annotations

import math
import re

from text_safety.normalization import normalize_text
from .context_query_model import FOLDED_PHRASES, PHYSICAL_TOKENS
from .linear_query_model import word_features

ALGORITHM = "role_context_word_softmax_v1"
NONVIOLENT = tuple(tuple(normalize_text(x).folded.split()) for x in (
    "đánh giá", "đánh vần", "đánh cờ", "đánh đàn", "đánh bóng", "đánh dấu",
    "đá bóng", "đá cầu", "đấm bốc", "đập bóng",
))
ACTION_GROUPS = frozenset(("physical", "threat", "weapon", "money_coercion",
                           "property_harm", "disclosure", "pressure", "verbal", "exclusion"))
DIRECT_DANGER = frozenset(("physical", "threat", "weapon", "money_coercion",
                           "property_harm", "disclosure", "urgent"))
SELF = frozenset(("minh", "em", "toi", "to", "tao", "con"))
OTHER = frozenset(("ban", "nguoi", "chi", "anh", "be", "vat", "cun", "cho", "meo"))
TARGET_LINKS = frozenset(("co", "dau", "mat", "nguoi", "vao", "cua", "mot", "cac"))
CLAUSES = re.compile(r"[.!?;,\n]+|\b(?:nhưng|nhung|sau đó|sau do)\b", re.IGNORECASE)
DOMAINS = {"credential": ("mật khẩu", "tài khoản", "thông tin cá nhân"),
           "challenge": ("thử thách", "tham gia", "trò chơi"),
           "school_task": ("làm hộ bài", "làm bài hộ", "bài tập")}


def spans(tokens: list[str], phrase: tuple[str, ...]):
    for start in range(len(tokens) - len(phrase) + 1):
        if tuple(tokens[start:start + len(phrase)]) == phrase:
            yield start, start + len(phrase)


def self_at(tokens: list[str], index: int) -> bool:
    if tokens[index] not in SELF:
        return False
    if tokens[index] == "minh" and index and tokens[index - 1] == "chung":
        return False  # "chứng minh" is not a pronoun
    return not (tokens[index] == "con" and index + 1 < len(tokens)
                and tokens[index + 1] in ("vat", "cho", "cun", "meo", "so", "duong"))


def subject_roles(tokens: list[str], stop: int) -> set[str]:
    """Subject just before passive 'bị', excluding observer/possessive pronouns."""
    left = max(0, stop - 6)
    selves = [i for i in range(left, stop) if self_at(tokens, i)]
    others = [i for i in range(left, stop) if tokens[i] in OTHER]
    if others:
        last_other = others[-1]
        # "bạn của mình bị ..." and "bạn mình bị ...": the victim is the friend.
        if not selves or last_other > selves[-1] or all(
                token in ("cua", "minh", "em", "toi", "to") for token in tokens[last_other + 1:stop]):
            result = {"other_affected"}
            if selves and "va" in tokens[selves[-1] + 1:last_other]:
                result.add("self_affected")
            return result
    return {"self_affected"} if selves else set()


def event_roles(tokens: list[str], start: int, end: int, group: str) -> set[str]:
    roles = set()
    passive = [i for i in range(max(0, start - 8), start) if tokens[i] == "bi"]
    if passive:
        roles.update(subject_roles(tokens, passive[-1]))
    # Direct object: "đánh em", "bóp cổ mình", "đánh một bạn".
    for index in range(end, min(len(tokens), end + 4)):
        if all(token in TARGET_LINKS for token in tokens[end:index]):
            if self_at(tokens, index):
                roles.add("self_affected")
                break
            if tokens[index] in OTHER:
                roles.add("other_affected")
                break
        else:
            break
    # Threats may put a target after an explicit purpose, "... để tìm mình".
    if group in ("threat", "weapon"):
        for index in range(end, min(len(tokens) - 1, end + 14)):
            if tokens[index] in ("tim", "giet", "danh") and self_at(tokens, index + 1):
                roles.add("self_affected")
    return roles


def context_features(text: str) -> set[str]:
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
        masked = {i for phrase in NONVIOLENT for start, end in spans(tokens, phrase)
                  for i in range(start, end)}
        if masked:
            events["academic_action"].add((min(masked), max(masked) + 1))
        for index, token in enumerate(accented):
            if index in masked:
                continue
            folded_action = tokens[index] in ("danh", "dam", "tat", "bop")
            unaccented_context = "bi" in tokens[max(0, index - 4):index]
            if token in PHYSICAL_TOKENS or (folded_action and unaccented_context):
                events["physical"].add((index, index + 1))
            if token in ("ép", "buộc") or tokens[index] in ("ep", "buoc"):
                events["pressure"].add((index, index + 1))
        # Do not let a folded phrase reintroduce a masked physical meaning.
        events["physical"] = {(start, end) for start, end in events["physical"]
                              if not any(i in masked for i in range(start, end))}
        groups = {group for group, found in events.items() if found}
        if "nếu" in accented or "neu" in tokens:
            groups.add("general")
        if any(self_at(tokens, i) for i in range(len(tokens))):
            groups.add("self_reference")
        if "bi" in tokens:
            groups.add("affected")
        observer = any(tuple(phrase) == tuple(tokens[i:i + len(phrase)])
                       for phrase in (("chung", "kien"), ("nhin", "thay"), ("thay", "ban"))
                       for i in range(len(tokens)))
        for group in ACTION_GROUPS & groups:
            roles = set().union(*(event_roles(tokens, start, end, group)
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
        # Retain non-role context interactions; these describe context, not labels.
        for role in ("general", "repeated"):
            if role in groups:
                features.update("ctx:" + role + "+" + group for group in groups
                                if group in ACTION_GROUPS or group in ("urgent", "academic_action"))
        if "self_reference" in groups and "academic_action" in groups:
            features.add("ctx:self_reference+academic_action")
        if "pressure" in groups:
            danger = bool(groups & DIRECT_DANGER)
            features.add("ctx:pressure+" + ("direct_danger" if danger else "unspecified_consequence"))
            for domain, phrases in DOMAINS.items():
                if any(any(spans(tokens, tuple(normalize_text(phrase).folded.split()))) for phrase in phrases):
                    features.add("ctx:pressure+" + domain)
        features.update("ctx:" + group for group in groups)
    return features


def query_features(text: str) -> set[str]:
    return word_features(text) | context_features(text)


def predict_scores_role_context(model: dict, text: str) -> dict[str, float]:
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported role-context artifact")
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
