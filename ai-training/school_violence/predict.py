"""Local inference for the experimental three-class school-violence model."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

from .training import LABELS, predict


def load_model(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        model = json.load(handle)
    if tuple(model.get("labels", ())) != LABELS:
        raise ValueError("Artifact label order is not SAFE, RISK, HIGH_RISK")
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    arguments = parser.parse_args()
    content = sys.stdin.read().strip()
    if not content:
        parser.error("Send non-empty text through stdin")
    print(json.dumps({"label": predict(load_model(arguments.model), content)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
