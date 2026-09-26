"""Three-label contract shared with the school-violence trainer."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from school_violence.training import LABELS


TAXONOMY_PATH = Path(__file__).resolve().parent.parent / "school_violence" / "labels.json"


@lru_cache(maxsize=1)
def load_taxonomy() -> dict:
    payload = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    if tuple(payload.get("labels", ())) != LABELS or payload.get("problem_type") != "single_label_classification":
        raise ValueError("Invalid three-label taxonomy")
    return payload
