from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


TAXONOMY_PATH = (
    Path(__file__).resolve().parent.parent
    / "datasets"
    / "schema"
    / "text_safety_taxonomy.json"
)


@dataclass(frozen=True)
class CategoryDefinition:
    name: str
    risk_type: str
    default_severity: str
    alert_threshold: float
    description: str


@dataclass(frozen=True)
class TextSafetyTaxonomy:
    version: str
    source_types: frozenset[str]
    directions: frozenset[str]
    risk_types: frozenset[str]
    severity_levels: tuple[str, ...]
    categories: dict[str, CategoryDefinition]
    privacy: dict[str, Any]


@lru_cache(maxsize=1)
def load_taxonomy(path: Path = TAXONOMY_PATH) -> TextSafetyTaxonomy:
    payload = json.loads(path.read_text(encoding="utf-8"))
    categories = {
        name: CategoryDefinition(
            name=name,
            risk_type=value["risk_type"],
            default_severity=value["default_severity"],
            alert_threshold=float(value["alert_threshold"]),
            description=value["description"],
        )
        for name, value in payload["categories"].items()
    }
    risk_types = frozenset(payload["risk_types"])
    severity_levels = tuple(payload["severity_levels"])
    if "none" not in risk_types or severity_levels != (
        "low",
        "medium",
        "high",
        "critical",
    ):
        raise ValueError("Text-safety taxonomy has invalid risk or severity levels")
    for category in categories.values():
        if category.risk_type not in risk_types - {"none"}:
            raise ValueError(f"Invalid risk type for category {category.name}")
        if category.default_severity not in severity_levels:
            raise ValueError(f"Invalid severity for category {category.name}")
        if not 0 < category.alert_threshold <= 1:
            raise ValueError(f"Invalid threshold for category {category.name}")

    return TextSafetyTaxonomy(
        version=payload["taxonomy_version"],
        source_types=frozenset(payload["source_types"]),
        directions=frozenset(payload["directions"]),
        risk_types=risk_types,
        severity_levels=severity_levels,
        categories=categories,
        privacy=payload["privacy"],
    )
