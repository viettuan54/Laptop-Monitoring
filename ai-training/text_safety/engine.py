from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from .normalization import NormalizedText, normalize_text
from .taxonomy import TextSafetyTaxonomy, load_taxonomy


SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
CATEGORY_PRIORITY = {
    "self-harm/intent": 100,
    "self-harm/instructions": 95,
    "harassment/threatening": 90,
    "hate/threatening": 85,
    "violence/inciting": 80,
    "self-harm": 70,
    "harassment": 60,
    "hate": 55,
    "violence/graphic": 50,
    "violence": 40,
}


@dataclass(frozen=True)
class ModerationInput:
    item_id: str
    text: str
    source_type: str
    direction: str = "unknown"
    context: tuple[str, ...] = ()


@dataclass(frozen=True)
class Signal:
    code: str
    category: str
    weight: float
    patterns: tuple[re.Pattern[str], ...]
    compact_terms: tuple[str, ...] = ()

    def matches(self, text: NormalizedText) -> bool:
        return any(pattern.search(text.folded) for pattern in self.patterns) or any(
            term in text.compact for term in self.compact_terms
        )


def _patterns(*values: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(value, re.IGNORECASE) for value in values)


SIGNALS = (
    Signal(
        "first_person_self_harm_intent",
        "self-harm/intent",
        0.96,
        _patterns(
            r"\b(toi|minh|em|con|tui|to)\s+(dang\s+)?(muon|dinh|tinh|se)\s+(chet|tu tu|tu hai)\b",
            r"\b(toi|minh|em|con|tui|to)\s+khong\s+(con\s+)?muon\s+(song|tiep tuc)\b",
            r"\bkhong\s+con\s+ly\s+do\s+(de\s+)?song\b",
        ),
        ("toimuonchet", "minhmuonchet", "emmuonchet"),
    ),
    Signal(
        "self_harm_plan_or_method_request",
        "self-harm/instructions",
        0.94,
        _patterns(
            r"\b(cach|lam sao|huong dan|phuong phap)\s+(de\s+)?(tu tu|tu hai|chet)\b",
            r"\b(tu tu|tu hai)\s+(bang|nhu the nao)\b",
        ),
        ("cachtutu", "lamsaodetutu", "huongdantutu"),
    ),
    Signal(
        "encouraged_self_harm",
        "self-harm/instructions",
        0.9,
        _patterns(
            r"\b(may|ban|no)\s+(nen\s+)?(chet|tu tu|tu hai)\s+di\b",
            r"\b(chet|tu tu)\s+di\b",
        ),
        ("chetdi", "tutudi"),
    ),
    Signal(
        "general_self_harm_reference",
        "self-harm",
        0.58,
        _patterns(r"\b(tu tu|tu hai|ket thuc cuoc doi)\b"),
        ("tuhai",),
    ),
    Signal(
        "targeted_threat",
        "harassment/threatening",
        0.93,
        _patterns(
            r"\b(tao|toi|tui)\s+se\s+(danh|dap|giet|xu|tim)\s+(may|ban)\b",
            r"\b(danh|dap|giet|xu)\s+(chet\s+)?(may|ban|no)\b",
            r"\bcoi\s+chung\s+(tao|bi)\b",
            r"\btim\s+(den\s+)?(nha|truong)\s+(may|ban)\b",
        ),
        ("taosedanhmay", "taosegietmay"),
    ),
    Signal(
        "targeted_humiliation",
        "harassment",
        0.76,
        _patterns(
            r"\b(may|ban|no)\s+(la\s+)?(do\s+)?(ngu+|vo dung|rac ruoi|xau xi)\b",
            r"\b(do\s+ngu+|do\s+vo\s+dung|do\s+rac\s+ruoi)\b",
            r"\bkhong\s+ai\s+(ua|thich|can)\s+(may|ban)\b",
            r"\bbien\s+di\b",
        ),
        ("dongu", "dovodung", "doracruoi"),
    ),
    Signal(
        "protected_group_dehumanization",
        "hate",
        0.82,
        _patterns(
            r"\b(bon|lu)\s+(da den|dong tinh|khuyet tat|ton giao|dan toc)\s+"
            r"(ban thiu|rac ruoi|khong dang song|bien di)\b"
        ),
    ),
    Signal(
        "protected_group_threat",
        "hate/threatening",
        0.9,
        _patterns(
            r"\b(giet|danh|tan cong|loai bo)\s+(het\s+)?(bon|lu)\s+"
            r"(da den|dong tinh|khuyet tat|ton giao|dan toc)\b"
        ),
    ),
    Signal(
        "call_to_violence",
        "violence/inciting",
        0.9,
        _patterns(
            r"\b(hay|cung|phai|nen)\s+(danh|dap|giet|tan cong|dot)\s+"
            r"(no|chung no|bon no|nguoi)\b",
            r"\bkeo\s+nhau\s+di\s+(danh|dap|tan cong)\b",
        ),
    ),
    Signal(
        "violent_act",
        "violence",
        0.74,
        _patterns(
            r"\b(dam chem|danh nhau|giet nguoi|tan cong bang|hanh hung)\b",
            r"\b(danh|dap)\s+(cho\s+)?(no|may|ban)\s+(mot tran|chet)\b",
        ),
        ("damchem", "gietnguoi"),
    ),
    Signal(
        "graphic_violence",
        "violence/graphic",
        0.8,
        _patterns(r"\b(chat xac|phan thay|mau me|noi tang|xac khong dau)\b"),
        ("chatxac", "xackhongdau"),
    ),
)

PROTECTIVE_SELF_HARM = _patterns(
    r"\b(toi|minh|em|con)\s+khong\s+muon\s+chet\b",
    r"\b(ngan chan|phong chong|ho tro|giup do)\s+(nan nhan\s+)?(tu tu|tu hai)\b",
    r"\bcan\s+giup\s+(nguoi|ban)\s+(muon\s+)?(tu tu|tu hai)\b",
)
INFORMATIONAL_CONTEXT = _patterns(
    r"\b(la gi|bai viet|tin tuc|nghien cuu|bao cao|phong chong|canh bao|trich dan)\b",
    r"\b(noi rang|viet rang|ke lai)\b",
)


def _combine_score(current: float, addition: float) -> float:
    return 1 - ((1 - current) * (1 - addition))


class ContextRuleEngine:
    """Deterministic Vietnamese baseline; scores are not calibrated probabilities."""

    def __init__(
        self,
        model_version: str = "vi-context-rules-v1",
        taxonomy: TextSafetyTaxonomy | None = None,
    ) -> None:
        self.model_version = model_version
        self.taxonomy = taxonomy or load_taxonomy()

    def _score_signals(
        self, text: str
    ) -> tuple[dict[str, float], dict[str, set[str]], NormalizedText]:
        normalized = normalize_text(text)
        scores = {category: 0.0 for category in self.taxonomy.categories}
        matched = {category: set() for category in self.taxonomy.categories}
        for signal in SIGNALS:
            if signal.matches(normalized):
                scores[signal.category] = _combine_score(
                    scores[signal.category], signal.weight
                )
                matched[signal.category].add(signal.code)
        return scores, matched, normalized

    @staticmethod
    def _matches_any(
        patterns: Iterable[re.Pattern[str]], normalized: NormalizedText
    ) -> bool:
        return any(pattern.search(normalized.folded) for pattern in patterns)

    def moderate(self, item: ModerationInput) -> dict[str, object]:
        if item.source_type not in self.taxonomy.source_types:
            raise ValueError("Unsupported source_type")
        if item.direction not in self.taxonomy.directions:
            raise ValueError("Unsupported direction")

        scores, matched, normalized = self._score_signals(item.text)
        if re.search(r"\btừ\s+từ\b", normalized.unicode) and not re.search(
            r"\btự\s+tử\b", normalized.unicode
        ):
            scores["self-harm"] = 0.0
            matched["self-harm"].discard("general_self_harm_reference")
        is_informational = self._matches_any(INFORMATIONAL_CONTEXT, normalized)
        has_protective_self_harm = self._matches_any(PROTECTIVE_SELF_HARM, normalized)

        if has_protective_self_harm and not matched["self-harm/intent"]:
            for category in ("self-harm", "self-harm/instructions"):
                scores[category] *= 0.25
            matched["self-harm"].add("protective_context")

        if is_informational:
            for category in (
                "self-harm",
                "harassment",
                "hate",
                "violence",
                "violence/graphic",
            ):
                scores[category] *= 0.45
            for category, codes in matched.items():
                if codes:
                    codes.add("informational_context")

        if item.source_type == "chat_received" or item.direction == "received":
            for category in ("harassment", "harassment/threatening", "hate", "hate/threatening"):
                if scores[category] > 0:
                    scores[category] = min(1.0, scores[category] + 0.04)
                    matched[category].add("received_message_context")

        if item.source_type == "chat_authored" or item.direction == "authored":
            if scores["self-harm/intent"] > 0:
                scores["self-harm/intent"] = min(
                    1.0, scores["self-harm/intent"] + 0.03
                )
                matched["self-harm/intent"].add("authored_message_context")

        context_category_hits = {category: [] for category in self.taxonomy.categories}
        for context_text in item.context:
            context_scores, _, _ = self._score_signals(context_text)
            for category, score in context_scores.items():
                if score >= 0.5:
                    context_category_hits[category].append(score)

        for category, context_scores in context_category_hits.items():
            if len(context_scores) >= 2:
                context_score = min(0.9, max(context_scores) * 0.8 + 0.18)
                scores[category] = max(scores[category], context_score)
                matched[category].add("repeated_context_signal")
            elif context_scores and scores[category] > 0:
                scores[category] = min(1.0, scores[category] + 0.05)
                matched[category].add("supporting_context_signal")

        scores = {name: round(min(1.0, max(0.0, score)), 4) for name, score in scores.items()}
        flagged_categories = [
            name
            for name, definition in self.taxonomy.categories.items()
            if scores[name] >= definition.alert_threshold
        ]
        ranked_categories = sorted(
            self.taxonomy.categories,
            key=lambda name: (
                SEVERITY_RANK[self.taxonomy.categories[name].default_severity],
                CATEGORY_PRIORITY.get(name, 0),
                scores[name],
            ),
            reverse=True,
        )
        confidence = max(scores.values(), default=0.0)

        if flagged_categories:
            primary = max(
                flagged_categories,
                key=lambda name: (
                    SEVERITY_RANK[self.taxonomy.categories[name].default_severity],
                    CATEGORY_PRIORITY.get(name, 0),
                    scores[name],
                ),
            )
            definition = self.taxonomy.categories[primary]
            flagged = True
            action = "alert"
            risk_type = definition.risk_type
            severity = definition.default_severity
            primary_category: str | None = primary
        elif confidence >= 0.35:
            primary = max(ranked_categories, key=lambda name: scores[name])
            flagged = False
            action = "review"
            risk_type = self.taxonomy.categories[primary].risk_type
            severity = "medium"
            primary_category = primary
        else:
            flagged = False
            action = "allow"
            risk_type = "none"
            severity = "low"
            primary_category = None

        signal_codes = sorted(
            set().union(*(codes for codes in matched.values() if codes))
        )
        return {
            "id": item.item_id,
            "flagged": flagged,
            "action": action,
            "riskType": risk_type,
            "severity": severity,
            "primaryCategory": primary_category,
            "confidence": round(confidence, 4),
            "categoryScores": scores,
            "matchedSignals": signal_codes,
        }

    def moderate_batch(self, items: Iterable[ModerationInput]) -> list[dict[str, object]]:
        return [self.moderate(item) for item in items]
