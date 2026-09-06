from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


ZERO_WIDTH = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]")
NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
WHITESPACE = re.compile(r"\s+")
REPEATED_CHARACTERS = re.compile(r"([^\W\d_])\1{2,}", re.UNICODE)
# The final character may itself be repeated (``n g uuuuuu``).  Joining first
# lets the repeated-character normalizer reduce the evasion form afterwards.
SINGLE_LETTER_SEQUENCE = re.compile(
    r"(?<!\w)(?:[^\W\d_]\s+){2,}(?P<final>[^\W\d_])(?P=final)*(?!\w)",
    re.IGNORECASE,
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
    # These are deliberately expanded into tokens instead of deleted.  They are
    # common Vietnamese obfuscations and carry useful context for the classifier.
    "dm": "dit me",
    "dmm": "dit me may",
    "m": "may",
    "cl": "con lon",
    "dell": "deo",
    "del": "deo",
    "đell": "deo",
}

# Keep a small, explicit vocabulary instead of adding an emoji dependency to the
# local service.  The tokens survive the punctuation cleanup below and allow a
# text model to learn that an emoji changes the tone of an otherwise ordinary
# sentence.  Unknown emoji are still safely removed.
EMOJI_TOKENS = {
    "💀": " emoji_skull ",
    "🔪": " emoji_knife ",
    "😡": " emoji_angry ",
    "🤬": " emoji_swearing ",
    "😭": " emoji_crying ",
    "💔": " emoji_broken_heart ",
    "❤️": " emoji_heart ",
    "❤": " emoji_heart ",
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


def _replace_emoji(value: str) -> str:
    for emoji, replacement in EMOJI_TOKENS.items():
        value = value.replace(emoji, replacement)
    return value


def normalize_text(value: str) -> NormalizedText:
    value = unicodedata.normalize("NFKC", value)
    value = _replace_emoji(ZERO_WIDTH.sub("", value).lower())
    value = NON_WORD.sub(" ", value)
    value = SINGLE_LETTER_SEQUENCE.sub(lambda match: match.group(0).replace(" ", ""), value)
    value = REPEATED_CHARACTERS.sub(r"\1\1", value)
    value = WHITESPACE.sub(" ", value).strip()
    value = _expand_teencode(value)
    folded = WHITESPACE.sub(" ", _fold_vietnamese(value)).strip()
    compact = re.sub(r"[^a-z0-9]+", "", folded)
    return NormalizedText(unicode=value, folded=folded, compact=compact)
