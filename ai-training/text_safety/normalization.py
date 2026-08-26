from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


ZERO_WIDTH = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")
NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
WHITESPACE = re.compile(r"\s+")
REPEATED_CHARACTERS = re.compile(r"([^\W\d_])\1{2,}", re.UNICODE)
SINGLE_LETTER_SEQUENCE = re.compile(
    r"(?<!\w)(?:[^\W\d_]\s+){2,}[^\W\d_](?!\w)", re.IGNORECASE
)

TEENCODE = {
    "0": "khong",
    "k": "khong",
    "ko": "khong",
    "k0": "khong",
    "kh": "khong",
    "khum": "khong",
    "hok": "khong",
    "dc": "duoc",
    "đc": "duoc",
    "vs": "voi",
    "z": "vay",
    "j": "gi",
}


@dataclass(frozen=True)
class NormalizedText:
    unicode: str
    folded: str
    compact: str


def _fold_vietnamese(value: str) -> str:
    value = value.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(character for character in decomposed if not unicodedata.combining(character))


def _expand_teencode(value: str) -> str:
    tokens = value.split()
    return " ".join(TEENCODE.get(token, token) for token in tokens)


def normalize_text(value: str) -> NormalizedText:
    value = unicodedata.normalize("NFKC", value)
    value = ZERO_WIDTH.sub("", value).lower()
    value = NON_WORD.sub(" ", value)
    value = SINGLE_LETTER_SEQUENCE.sub(lambda match: match.group(0).replace(" ", ""), value)
    value = REPEATED_CHARACTERS.sub(r"\1\1", value)
    value = WHITESPACE.sub(" ", value).strip()
    value = _expand_teencode(value)
    folded = WHITESPACE.sub(" ", _fold_vietnamese(value)).strip()
    compact = re.sub(r"[^a-z0-9]+", "", folded)
    return NormalizedText(unicode=value, folded=folded, compact=compact)
