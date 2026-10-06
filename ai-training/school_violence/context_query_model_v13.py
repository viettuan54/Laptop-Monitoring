"""Accent-aware event recipients for a learned classifier; no label rules."""
from __future__ import annotations

from text_safety.normalization import normalize_text
from .component_context_query_model import head_scores
from .context_query_model import PHRASES, PHYSICAL_TOKENS, context_features as legacy_context
from .context_query_model_v11 import ACTION_GROUPS, CLAUSES, TARGET_LINKS, self_at, spans
from .context_query_model_v12 import other_at, pressure_features
from .context_query_model_v12_1 import financial_features
from .linear_query_model import word_features

ALGORITHM = "recipient_context_word_softmax_v1"
NONVIOLENT = ("đánh giá", "đánh vần", "đánh cờ", "đánh đàn", "đánh bóng", "đánh dấu",
              "đá bóng", "đá cầu", "đấm bốc", "đập bóng")
PEOPLE = (("hoc", "sinh"), ("sinh", "vien"), ("tre", "em"), ("em", "trai"),
          ("em", "gai"), ("anh", "trai"), ("chi", "gai"))
BOUNDARIES = ("tự ý", "chưa hỏi", "không hỏi", "chưa được đồng ý", "không đồng ý",
              "không thích", "không muốn", "khó chịu", "ý kiến", "quan điểm",
              "áp lực", "đổ lỗi", "trách", "ranh giới", "giới hạn")
ROLE_ACTIONS = ACTION_GROUPS | {"urgent"}


def phrase_spans(tokens, accented, phrase):
    """Use available accents to distinguish e.g. 'dõi tiến' from 'đòi tiền'."""
    normalized = normalize_text(phrase)
    expected, folded = normalized.unicode.split(), tuple(normalized.folded.split())
    for start, end in spans(tokens, folded):
        if phrase == "đòi tiền" and start and tokens[start - 1] == "theo":
            continue
        if all(accented[i] == tokens[i] or accented[i] == expected[i - start]
               for i in range(start, end)):
            yield start, end


def passive_at(tokens, accented, index):
    return (tokens[index] == "bi" and accented[index] in ("bi", "bị")
            and not (index and tokens[index - 1] in ("chuan", "thiet", "trang")))


def person_at(tokens, accented, index):
    return other_at(tokens, accented, index) or any(
        tuple(tokens[index:index + len(phrase)]) == phrase for phrase in PEOPLE)


def subject_roles(tokens, accented, stop):
    # The subject may include possessives: "a friend of mine" is another person.
    left = max(0, stop - 8)
    selves = [i for i in range(left, stop) if self_at(tokens, i)]
    others = [i for i in range(left, stop) if person_at(tokens, accented, i)]
    if others:
        last = others[-1]
        possessive = all(token in ("cua", "minh", "em", "toi", "to")
                         for token in tokens[last + 1:stop])
        if not selves or last > selves[-1] or possessive:
            roles = {"other_affected"}
            if selves and "va" in tokens[selves[-1] + 1:last]:
                roles.add("self_affected")
            return roles
    return {"self_affected"} if selves else set()


def event_roles(tokens, accented, start, end, group):
    roles = set()
    passive = [i for i in range(start) if passive_at(tokens, accented, i)]
    if passive:
        roles.update(subject_roles(tokens, accented, passive[-1]))
    for i in range(end, min(len(tokens), end + 5)):
        if not all(token in TARGET_LINKS for token in tokens[end:i]):
            break
        if person_at(tokens, accented, i):
            roles.add("other_affected")
            break
        if self_at(tokens, i):
            roles.add("self_affected")
            break
    if group in ("threat", "weapon"):
        for i in range(end, min(len(tokens) - 1, end + 14)):
            if tokens[i] in ("tim", "giet", "danh") and self_at(tokens, i + 1):
                roles.add("self_affected")
    return roles


def observer_in_clause(tokens, accented):
    for phrase in (("chung", "kien"), ("nhin", "thay"), ("phat", "hien"), ("thay",)):
        for _, end in spans(tokens, phrase):
            if any(person_at(tokens, accented, i) for i in range(end, min(len(tokens), end + 6))):
                return True
    return False


def clause_features(clause):
    normalized = normalize_text(clause)
    tokens, accented = normalized.folded.split(), normalized.unicode.split()
    if not tokens:
        return set()
    events = {group: set() for group in PHRASES}
    for group, phrases in PHRASES.items():
        if group != "witness":
            for phrase in phrases:
                events[group].update(phrase_spans(tokens, accented, phrase))
    events["pressure"].update(phrase_spans(tokens, accented, "gây áp lực"))
    masked = {i for phrase in NONVIOLENT for start, end in phrase_spans(tokens, accented, phrase)
              for i in range(start, end)}
    if masked:
        events["academic_action"].add((min(masked), max(masked) + 1))
    passives = [i for i in range(len(tokens)) if passive_at(tokens, accented, i)]
    for i, token in enumerate(accented):
        if i in masked:
            continue
        unaccented_action = (token == tokens[i] and token in ("danh", "dam", "tat", "bop")
                             and any(0 < i - p <= 4 for p in passives))
        if token in PHYSICAL_TOKENS or unaccented_action:
            events["physical"].add((i, i + 1))
        if token in ("ép", "buộc", "ep", "buoc"):
            events["pressure"].add((i, i + 1))
    events["physical"] = {(start, end) for start, end in events["physical"]
                          if not any(i in masked for i in range(start, end))}
    groups = {group for group, found in events.items() if found}
    if "neu" in tokens:
        groups.add("general")
    if any(self_at(tokens, i) for i in range(len(tokens))):
        groups.add("self_reference")
    passive_roles = [subject_roles(tokens, accented, i) for i in passives]
    observed = observer_in_clause(tokens, accented)
    only_other_passive = bool(passive_roles) and all(roles == {"other_affected"} for roles in passive_roles)
    if passives and not only_other_passive:
        groups.add("affected")
    if observed or only_other_passive:
        groups.add("witness")
    features, unscoped = set(), set()
    recipients, previous_roles = {}, set()
    for start, end, group in sorted((start, end, group) for group in ROLE_ACTIONS
                                     for start, end in events[group]):
        roles = event_roles(tokens, accented, start, end, group)
        if not roles:
            roles = {"other_affected"} if only_other_passive else previous_roles.copy()
        recipients[start, end, group] = roles
        if roles:
            previous_roles = roles
    for group in ROLE_ACTIONS & groups:
        group_roles = [recipients[start, end, group] for start, end in events[group]]
        roles = set().union(*group_roles)
        other_only = bool(group_roles) and all(role == {"other_affected"} for role in group_roles)
        if other_only:
            groups.update(("witness", "other_affected"))
            features.update(("ctx:other_affected+" + group, "ctx:witness+" + group))
        else:
            unscoped.add(group)
        if group == "pressure":
            # A request recipient is not automatically the victim of physical harm.
            features.update("ctx:pressure_recipient:" + role for role in roles)
        else:
            features.update("ctx:" + role + "+" + group for role in roles)
            groups.update(roles)
            if "self_affected" in roles:
                features.add("ctx:self_reference+" + group)
            if passives and roles and not other_only:
                features.add("ctx:affected+" + group)
    # Role-scoped actions must not also produce the old unscoped danger signal.
    groups.difference_update(ROLE_ACTIONS - unscoped)
    for role in ("general", "repeated"):
        if role in groups:
            features.update("ctx:" + role + "+" + group for group in unscoped)
    if "self_reference" in groups and "academic_action" in groups:
        features.add("ctx:self_reference+academic_action")
    features.update("ctx:" + group for group in groups)
    pressure_context = features | ({"ctx:pressure"} if events["pressure"] else set())
    pressure = pressure_features(clause, pressure_context)
    if events["pressure"] and "pressure" not in unscoped:
        pressure = {"ctx:observed_" + key[4:] for key in pressure}
    features.discard("ctx:pressure")
    features.update(pressure)
    if ("self_reference" in groups and any(person_at(tokens, accented, i) for i in range(len(tokens)))
            and any(any(phrase_spans(tokens, accented, phrase)) for phrase in BOUNDARIES)):
        features.add("ctx:interpersonal_boundary")
        if events["pressure"]:
            features.add("ctx:interpersonal_boundary+pressure")
    return features


def context_features(text):
    context = set().union(*(clause_features(clause) for clause in CLAUSES.split(text)))
    context.update(key for key in legacy_context(text)
                   if key.endswith("+verbal") or key.endswith("+exclusion"))
    return context | financial_features(text, context)


def query_features(text):
    return word_features(text) | context_features(text)


def predict_scores_recipient_context(model, text):
    if model["algorithm"] != ALGORITHM:
        raise ValueError("Unsupported recipient-context artifact")
    return head_scores(model["head"], query_features(text))
