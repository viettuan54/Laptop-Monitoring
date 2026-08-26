from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


DEFAULT_MODEL_VERSION = "vi-context-rules-v1"


@dataclass(frozen=True)
class Settings:
    environment: str
    api_key: str
    model_version: str

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def validate(self) -> None:
        if self.is_production and len(self.api_key) < 16:
            raise RuntimeError(
                "TEXT_SAFETY_API_KEY must contain at least 16 characters in production"
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings(
        environment=os.getenv("TEXT_SAFETY_ENV", "development").strip().lower(),
        api_key=os.getenv("TEXT_SAFETY_API_KEY", "").strip(),
        model_version=(
            os.getenv("TEXT_SAFETY_MODEL_VERSION", DEFAULT_MODEL_VERSION).strip()
            or DEFAULT_MODEL_VERSION
        ),
    )
    settings.validate()
    return settings


def reset_settings_cache() -> None:
    """Test helper for environment-based settings."""

    get_settings.cache_clear()
