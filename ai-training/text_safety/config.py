from __future__ import annotations

import os
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "artifacts" / "school_violence" / "vi-school-violence-char-nb-v2" / "model.json.gz"
)


@dataclass(frozen=True)
class Settings:
    environment: str
    api_key: str
    model_path: Path
    deployment_eligible: bool

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def validate(self) -> None:
        if self.is_production and len(self.api_key) < 16:
            raise RuntimeError(
                "TEXT_SAFETY_API_KEY must contain at least 16 characters in production"
            )
        if not self.model_path.is_file():
            raise RuntimeError(f"Three-label model artifact is missing: {self.model_path}")
        if self.is_production and not self.deployment_eligible:
            raise RuntimeError("Unapproved three-label model cannot run in production")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    model_path = Path(os.getenv("TEXT_SAFETY_MODEL_PATH", str(DEFAULT_MODEL_PATH))).resolve()
    try:
        report = json.loads((model_path.parent / "evaluation_report.json").read_text(encoding="utf-8"))
        deployment_eligible = report.get("deployment_eligible") is True
    except (OSError, ValueError):
        deployment_eligible = False
    settings = Settings(
        environment=os.getenv("TEXT_SAFETY_ENV", "development").strip().lower(),
        api_key=os.getenv("TEXT_SAFETY_API_KEY", "").strip(),
        model_path=model_path,
        deployment_eligible=deployment_eligible,
    )
    settings.validate()
    return settings


def reset_settings_cache() -> None:
    """Test helper for environment-based settings."""

    get_settings.cache_clear()
