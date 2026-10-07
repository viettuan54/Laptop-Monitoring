"""Runtime adapter for the trained three-class Vietnamese text classifier."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from school_violence.predict import load_model
from school_violence.training import LABELS, predict_scores, select_label


@dataclass(frozen=True)
class ModerationInput:
    item_id: str
    text: str
    source_type: str
    direction: str = "unknown"
    context: tuple[str, ...] = ()


class ThreeLabelEngine:
    """Classify one sentence as SAFE, RISK or HIGH_RISK.

    Source/direction/context remain accepted by the transport API for existing
    clients, but the training corpus does not support using them as features.
    """

    def __init__(self, model_path: Path):
        artifact_bytes = model_path.read_bytes()
        self.model = load_model(model_path, artifact_bytes=artifact_bytes)
        self.model_sha256 = sha256(artifact_bytes).hexdigest()
        self.model_version = str(self.model["model_version"])
        if tuple(self.model["labels"]) != LABELS:
            raise ValueError("Runtime artifact must have exactly three labels")

    def moderate(self, item: ModerationInput) -> dict:
        scores = predict_scores(self.model, item.text)
        label = select_label(self.model, scores)
        return {
            "id": item.item_id,
            "label": label,
            "scores": scores,
            "confidence": scores[label],
            "flagged": label != "SAFE",
            "action": {"SAFE": "allow", "RISK": "review", "HIGH_RISK": "alert"}[label],
        }

    def moderate_batch(self, items: list[ModerationInput]) -> list[dict]:
        return [self.moderate(item) for item in items]
