"""Build a non-deployable v6 candidate from the 12 explicitly corrected queries.

The 94-query review is model-informed, so it is never used as an evaluation set.
Only the 12 user-identified errors enter training. Raw query text is written
only inside the local artifact directory, which must be Git-ignored.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import shutil
import unicodedata
from collections import Counter
from copy import deepcopy
from pathlib import Path

from .evaluate_real_world import BACKEND_REJECTED_TEXT, _text_keys
from .predict import load_model
from .training import LABELS, SENSITIVE_PATTERNS, evaluate, features, predict


MODEL_VERSION = "vi-school-violence-char-nb-v6-query-candidate"
DATASET_VERSION = "school-violence-query-v2.4-plus-confirmed-errors-v1"
BASE_MODEL_SEMANTIC_SHA256 = "26a48a8e326c8aa71023b560918fb66c3d752ba95df64bf75d13056f23633317"
REVIEW_SHA256 = "6f664dafafde038b636831e00cdd81f1b3963402deba1dc21ff5acb91c3a4462"
PROVENANCE_SHA256 = "944faf9aa8d9ec1c785776d2bb3ebabfd921f52acd2b366b5e251d0b7952eb81"
CORRECTION_WEIGHT = 2  # Smallest integer weight that fits the 12 training examples.
ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "school_violence"
CORRECTED_LABELS = {
    "50": "HIGH_RISK", "53": "HIGH_RISK", "55": "RISK", "57": "HIGH_RISK",
    "58": "HIGH_RISK", "62": "RISK", "67": "HIGH_RISK", "70": "HIGH_RISK",
    "74": "HIGH_RISK", "79": "HIGH_RISK", "84": "HIGH_RISK", "88": "HIGH_RISK",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def semantic_sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def read_csv(path: Path, expected_fields: list[str]) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != expected_fields:
            raise ValueError(f"Unexpected columns in {path.name}")
        rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError(f"Malformed CSV in {path.name}")
    ids = [row["id"].strip() for row in rows]
    if not ids or any(not identifier for identifier in ids) or len(ids) != len(set(ids)):
        raise ValueError(f"Empty or duplicate IDs in {path.name}")
    return rows


def load_corrections(review_path: Path, provenance_path: Path, base_model: dict) -> list[dict]:
    if sha256(review_path) != REVIEW_SHA256 or sha256(provenance_path) != PROVENANCE_SHA256:
        raise ValueError("The reviewed label snapshot changed; verify it before training")
    review = read_csv(review_path, ["id", "text", "label"])
    provenance = read_csv(provenance_path, ["id", "label_origin"])
    if [row["id"] for row in review] != [row["id"] for row in provenance]:
        raise ValueError("Review and label provenance IDs do not match")
    if len(review) != 94 or any(row["label"] not in LABELS for row in review):
        raise ValueError("Expected 94 fully labelled review rows")
    selected = [row for row, origin in zip(review, provenance)
                if origin["label_origin"] == "user_explicit_correction"]
    if {row["id"]: row["label"] for row in selected} != CORRECTED_LABELS:
        raise ValueError("Explicit corrections do not match the 12 confirmed decisions")
    seen_text: set[str] = set()
    for row in selected:
        value = unicodedata.normalize("NFKC", row["text"])
        value = " ".join(value.split())
        if not value or len(value) > 1000 or any(
            ord(char) < 32 and char not in "\t\n\r" or ord(char) == 127 for char in value
        ):
            raise ValueError(f"Invalid query text at ID {row['id']}")
        if any(pattern.search(value) for pattern in (*SENSITIVE_PATTERNS, *BACKEND_REJECTED_TEXT)):
            raise ValueError(f"Potential private identifier at ID {row['id']}")
        keys = _text_keys(row["text"])
        if not keys or keys & seen_text:
            raise ValueError(f"Duplicate normalized correction at ID {row['id']}")
        seen_text.update(keys)
        if predict(base_model, row["text"]) == row["label"]:
            raise ValueError(f"ID {row['id']} is no longer a base-model error")
    return selected


def augment(base_model: dict, corrections: list[dict], weight: int = CORRECTION_WEIGHT) -> dict:
    if not isinstance(weight, int) or isinstance(weight, bool) or weight < 1:
        raise ValueError("Correction weight must be a positive integer")
    model = deepcopy(base_model)
    for row in corrections:
        label = row["label"]
        counts = features(row["text"])
        model["class_docs"][label] += weight
        model["class_totals"][label] += weight * sum(counts.values())
        for feature, count in counts.items():
            old = model["feature_counts"][label].get(feature, 0)
            model["feature_counts"][label][feature] = old + weight * count
    model["vocabulary_size"] = len(set().union(*(
        set(model["feature_counts"][label]) for label in LABELS
    )))
    return model


def read_reference(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    if not rows:
        raise ValueError(f"Empty baseline reference: {path.name}")
    return rows


def build_candidate(base_dir: Path, review_path: Path, provenance_path: Path,
                    output_dir: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Explicit authorization for training on the collected queries is required")
    if not output_dir.resolve().is_relative_to(ARTIFACT_ROOT.resolve()) or output_dir.resolve() == ARTIFACT_ROOT.resolve():
        raise ValueError("Candidate output must be inside the local ignored artifact directory")
    model_path = base_dir / "model.json.gz"
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"Output directory is not empty: {output_dir}")
    base_model = load_model(model_path)
    if semantic_sha256(base_model) != BASE_MODEL_SEMANTIC_SHA256:
        raise ValueError("Unexpected v5 baseline model content")
    if base_model.get("model_version") != "vi-school-violence-char-nb-v5-query":
        raise ValueError("Wrong baseline model version")
    corrections = load_corrections(review_path, provenance_path, base_model)
    references = {split: read_reference(base_dir / f"{split}.jsonl")
                  for split in ("train", "validation", "test")}
    known_ids = set()
    known_text: set[str] = set()
    for records in references.values():
        for row in records:
            known_ids.update(row.get("source_ids", [row["id"]]))
            known_text.update(_text_keys(row["text"]))
    for row in corrections:
        if row["id"] in known_ids or _text_keys(row["text"]) & known_text:
            raise ValueError(f"Correction overlaps baseline reference: ID {row['id']}")

    model = augment(base_model, corrections)
    correction_fingerprint = hashlib.sha256(json.dumps(
        [{key: row[key] for key in ("id", "text", "label")} for row in corrections],
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    combined_fingerprint = hashlib.sha256(json.dumps({
        "base_model_semantic_sha256": BASE_MODEL_SEMANTIC_SHA256,
        "corrections_sha256": correction_fingerprint,
        "correction_weight": CORRECTION_WEIGHT,
    }, sort_keys=True).encode("utf-8")).hexdigest()
    model.update(
        model_version=MODEL_VERSION,
        dataset_version=DATASET_VERSION,
        combined_dataset_sha256=combined_fingerprint,
        deployment_eligible=False,
        training_configuration={
            "algorithm": "weighted_character_ngram_naive_bayes_update",
            "base_model_version": base_model["model_version"],
            "base_model_semantic_sha256": BASE_MODEL_SEMANTIC_SHA256,
            "correction_weight": CORRECTION_WEIGHT,
            "selected_using_independent_real_holdout": False,
            "review_sha256": REVIEW_SHA256,
            "provenance_sha256": PROVENANCE_SHA256,
            "corrections_sha256": correction_fingerprint,
            "input_columns": ["text"],
        },
    )
    base_validation = evaluate(base_model, references["validation"])
    candidate_validation = evaluate(model, references["validation"])
    # The historical synthetic test is a regression check, never a release gate.
    base_test = evaluate(base_model, references["test"])
    candidate_test = evaluate(model, references["test"])
    leave_one_out = Counter()
    for row in corrections:
        others = [candidate for candidate in corrections if candidate["id"] != row["id"]]
        if predict(augment(base_model, others), row["text"]) == row["label"]:
            leave_one_out[row["label"]] += 1
    fit_counts = Counter(row["label"] for row in corrections
                         if predict(model, row["text"]) == row["label"])
    correction_counts = Counter(row["label"] for row in corrections)
    report = {
        "model_version": MODEL_VERSION,
        "source_audit": {"combined_dataset_sha256": combined_fingerprint},
        "base_model_semantic_sha256": BASE_MODEL_SEMANTIC_SHA256,
        "review_sha256": REVIEW_SHA256,
        "provenance_sha256": PROVENANCE_SHA256,
        "correction_ids": [row["id"] for row in corrections],
        "correction_label_counts": dict(correction_counts),
        "correction_weight": CORRECTION_WEIGHT,
        "correction_training_fit": {label: fit_counts[label] for label in LABELS},
        "correction_leave_one_out_correct": {label: leave_one_out[label] for label in LABELS},
        "synthetic_validation": {"base": base_validation, "candidate": candidate_validation},
        "historical_synthetic_test_regression": {"base": base_test, "candidate": candidate_test},
        "independent_real_holdout_evaluated": False,
        "operator_asserted_training_authorization": True,
        "permission_verified_by_code": False,
        "deployment_eligible": False,
        "limitations": [
            "The 12 corrections were selected after inspecting v5 predictions.",
            "Training-set fit and leave-one-out results on selected errors are not independent accuracy estimates.",
            "Most of the remaining 94 review labels were confirmed from v5 predictions and are not used for fitting or evaluation.",
            "No newly collected blind real-world test set was available at training time.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for split in ("validation", "test"):
        shutil.copyfile(base_dir / f"{split}.jsonl", output_dir / f"{split}.jsonl")
    shutil.copyfile(base_dir / "train.jsonl", output_dir / "train.jsonl")
    with (output_dir / "train.jsonl").open("a", encoding="utf-8") as handle:
        for row in corrections:
            identifier = f"confirmed-query-v1:{row['id']}"
            handle.write(json.dumps({
                "id": identifier, "source_ids": [identifier], "text": row["text"],
                "label": row["label"], "split": "train", "source": "user_confirmed_query",
                "review_status": "user_explicit_correction", "group_ids": [],
            }, ensure_ascii=False) + "\n")
    with gzip.open(output_dir / "model.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, separators=(",", ":"))
    for name, payload in (
        ("evaluation_report.json", report),
        ("training_config.json", model["training_configuration"]),
        ("dataset_manifest.json", {
            "dataset_version": DATASET_VERSION,
            "combined_dataset_sha256": combined_fingerprint,
            "base_model_semantic_sha256": BASE_MODEL_SEMANTIC_SHA256,
            "review_sha256": REVIEW_SHA256,
            "provenance_sha256": PROVENANCE_SHA256,
            "corrections_sha256": correction_fingerprint,
            "correction_count": len(corrections),
            "deployment_eligible": False,
        }),
    ):
        (output_dir / name).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-artifact", required=True, type=Path)
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--authorized", action="store_true",
                        help="Operator confirms this local query data may be used for training")
    arguments = parser.parse_args()
    report = build_candidate(arguments.base_artifact, arguments.review,
                             arguments.provenance, arguments.output_dir,
                             authorized=arguments.authorized)
    print(json.dumps({
        "model_version": report["model_version"],
        "correction_count": len(report["correction_ids"]),
        "independent_real_holdout_evaluated": False,
        "deployment_eligible": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
