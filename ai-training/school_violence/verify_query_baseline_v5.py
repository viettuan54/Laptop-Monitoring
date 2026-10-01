"""Lock and verify the query-v2.4/v5 experimental baseline.

The gzip archive can differ between identical training runs because it embeds
metadata. Compare the decompressed model and evaluation without trained_at_utc
for reproducibility; retain the original archive checksum for provenance.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import tempfile
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from school_violence.exclude_ambiguous_queries import EXCLUDED_IDS
from school_violence.training import LABELS, SPLITS, run


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "Mô tả"
SOURCE = DATA_DIR / "laptopmonitoring_query_dataset_v2_3.csv"
DATASET = DATA_DIR / "laptopmonitoring_query_dataset_v2_4.csv"
FILTER_REPORT = DATA_DIR / "query_dataset_v2_4_filter_report.json"
ARTIFACT = ROOT / "ai-training" / "artifacts" / "school_violence" / "vi-school-violence-char-nb-v5-query"
LOCK = Path(__file__).resolve().parent / "query_v2_4_v5_baseline.lock.json"
MODEL_VERSION = "vi-school-violence-char-nb-v5-query"
DATASET_VERSION = "school-violence-query-v2.4"
PARAMETER_KEYS = ("labels", "alpha", "class_docs", "class_totals", "vocabulary_size", "feature_counts")
CODE_FILES = (
    "ai-training/school_violence/exclude_ambiguous_queries.py",
    "ai-training/school_violence/training.py",
    "ai-training/text_safety/normalization.py",
    "ai-training/text_safety/config.py",
    "ai-training/text_safety/engine.py",
    "ai-training/text_safety/main.py",
    "ai-training/school_violence/labels.json",
)


class BaselineMismatch(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BaselineMismatch(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_sha256(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def dataset_snapshot() -> dict:
    old, current = read_rows(SOURCE), read_rows(DATASET)
    filter_report = read_json(FILTER_REPORT)
    old_ids, current_ids = [row["id"] for row in old], [row["id"] for row in current]
    require(len(old) == 5607 and len(current) == 5594, "Unexpected dataset row count")
    require(len(set(old_ids)) == len(old_ids) and len(set(current_ids)) == len(current_ids),
            "Duplicate dataset IDs")
    require({row["dataset_version"] for row in old} == {"v2.3"}
            and {row["dataset_version"] for row in current} == {"v2.4"},
            "Unexpected dataset version")
    require(set(old_ids) - set(current_ids) == set(EXCLUDED_IDS), "Excluded IDs changed")
    require([row["id"] for row in old if row["id"] not in EXCLUDED_IDS] == current_ids,
            "Retained row order changed")
    old_by_id = {row["id"]: row for row in old}
    for row in current:
        require(row == dict(old_by_id[row["id"]], dataset_version="v2.4"),
                f"Retained record changed: {row['id']}")
    require(all(old_by_id[identifier]["split"] == "test"
                and old_by_id[identifier]["label"] == "RISK"
                for identifier in EXCLUDED_IDS), "Excluded records are not the 13 old RISK test rows")
    split_counts = dict(Counter(row["split"] for row in current))
    require(split_counts == {"train": 3932, "validation": 839, "test": 823},
            "Dataset split counts changed")
    require(filter_report["excluded_ids"] == list(EXCLUDED_IDS)
            and filter_report["filter_scope"] == "test_only"
            and filter_report["excluded_rows_user_confirmed_model_label"] == "HIGH_RISK"
            and filter_report["test_score_independent"] is False,
            "Filter report no longer describes the reviewed test-only exclusion")
    require(filter_report["source_sha256"] == sha256(SOURCE)
            and filter_report["output_sha256"] == sha256(DATASET),
            "Filter report does not match CSV bytes")
    return {
        "source_v2_3_sha256": sha256(SOURCE),
        "query_v2_4_sha256": sha256(DATASET),
        "filter_report_sha256": sha256(FILTER_REPORT),
        "excluded_test_ids": list(EXCLUDED_IDS),
        "split_rows": split_counts,
        "total_rows": len(current),
    }


def artifact_snapshot(artifact: Path) -> dict:
    with gzip.open(artifact / "model.json.gz", "rt", encoding="utf-8") as handle:
        model = json.load(handle)
    config = read_json(artifact / "training_config.json")
    manifest = read_json(artifact / "dataset_manifest.json")
    evaluation = read_json(artifact / "evaluation_report.json")
    require(model["model_version"] == config["model_version"] == evaluation["model_version"] == MODEL_VERSION,
            "Model version changed")
    require(model["dataset_version"] == config["dataset_version"] == manifest["dataset_version"]
            == evaluation["dataset_version"] == DATASET_VERSION, "Dataset version changed")
    require(tuple(model["labels"]) == LABELS, "Model label set/order changed")
    require(model["training_configuration"] == config == evaluation["configuration"],
            "Training configuration differs between artifact files")
    require(manifest == evaluation["dataset_manifest"], "Dataset manifest differs from evaluation")
    require(model["deployment_eligible"] is False
            and evaluation["deployment_eligible"] is False
            and manifest["deployment_eligible"] is False,
            "Experimental baseline must not be production eligible")
    require(config["trainer_sha256"] == sha256(ROOT / "ai-training/school_violence/training.py")
            and config["preprocessing"]["sha256"]
            == sha256(ROOT / "ai-training/text_safety/normalization.py"),
            "Training code differs from artifact provenance")
    require(manifest["inputs"][0]["sha256"] == sha256(DATASET)
            and len(manifest["inputs"]) == 1, "Artifact was not built only from query v2.4")

    source_rows = read_rows(DATASET)
    split_files = {}
    for split in SPLITS:
        path = artifact / f"{split}.jsonl"
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        original_ids = {row["id"] for row in source_rows if row["split"] == split}
        artifact_ids = [identifier for record in records for identifier in record["source_ids"]]
        require(len(artifact_ids) == len(original_ids)
                and set(artifact_ids) == original_ids,
                f"Artifact {split} split does not match CSV IDs")
        split_files[split] = sha256(path)
    require(evaluation["split"]["counts"] == {
        split: dict(Counter(row["label"] for row in source_rows if row["split"] == split))
        for split in SPLITS
    }, "Evaluation split label counts changed")
    normalized_evaluation = dict(evaluation)
    normalized_evaluation.pop("trained_at_utc", None)
    return {
        "model_version": MODEL_VERSION,
        "dataset_version": DATASET_VERSION,
        "labels": list(LABELS),
        "selected_alpha": config["selected_alpha"],
        "model_parameters_sha256": json_sha256({key: model[key] for key in PARAMETER_KEYS}),
        "model_semantic_sha256": json_sha256(model),
        "training_config_sha256": sha256(artifact / "training_config.json"),
        "dataset_manifest_sha256": sha256(artifact / "dataset_manifest.json"),
        "evaluation_without_timestamp_sha256": json_sha256(normalized_evaluation),
        "split_files_sha256": split_files,
        "test_confusion_matrix": evaluation["test"]["confusion_matrix"],
        "test_macro_f1": evaluation["test"]["macro_f1"],
        "deployment_eligible": False,
    }


def current_snapshot(artifact: Path) -> dict:
    from text_safety.config import DEFAULT_MODEL_PATH

    require(DEFAULT_MODEL_PATH.resolve() == ARTIFACT.joinpath("model.json.gz").resolve(),
            "Service default no longer points to v5-query")
    return {
        "baseline_id": "school-violence-query-v2.4-v5",
        "scope": "search_query_only",
        "test_score_independent": False,
        "dataset": dataset_snapshot(),
        "code_sha256": {name: sha256(ROOT / name) for name in CODE_FILES},
        "artifact": artifact_snapshot(artifact),
    }


def api_smoke(artifact: Path) -> None:
    from fastapi.testclient import TestClient
    from text_safety.config import get_settings, reset_settings_cache
    from text_safety.main import app, get_engine

    examples = (
        ("Cách ôn tập môn toán", "SAFE"),
        ("Hướng dẫn phòng chống bạo lực học đường", "RISK"),
        ("Em bị bạn đánh phải làm sao?", "HIGH_RISK"),
    )
    environment = {
        "TEXT_SAFETY_ENV": "development",
        "TEXT_SAFETY_API_KEY": "baseline-local-test-key",
        "TEXT_SAFETY_MODEL_PATH": str(artifact / "model.json.gz"),
    }
    with patch.dict(os.environ, environment):
        reset_settings_cache()
        get_engine.cache_clear()
        try:
            with TestClient(app) as client:
                health = client.get("/health")
                require(health.status_code == 200
                        and health.json()["model"] == MODEL_VERSION
                        and health.json()["deploymentEligible"] is False,
                        "API health response differs from baseline")
                response = client.post(
                    "/v1/moderate",
                    headers={"X-Local-Moderation-Key": environment["TEXT_SAFETY_API_KEY"]},
                    json={"items": [
                        {"id": str(index), "text": value, "sourceType": "search_query"}
                        for index, (value, _) in enumerate(examples)
                    ]},
                )
                require(response.status_code == 200, "API moderation request failed")
                results = response.json()["results"]
                require([result["label"] for result in results]
                        == [label for _, label in examples], "API three-label examples changed")
                require(all(set(result["scores"]) == set(LABELS) for result in results),
                        "API scores do not expose exactly three labels")
            with patch.dict(os.environ, {"TEXT_SAFETY_ENV": "production"}):
                reset_settings_cache()
                try:
                    get_settings()
                except RuntimeError as error:
                    require("Unapproved" in str(error), "Unexpected production configuration failure")
                else:
                    raise BaselineMismatch("Unapproved v5 baseline was accepted in production")
        finally:
            get_engine.cache_clear()
            reset_settings_cache()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-lock", action="store_true", help="Create the lock once; refuse overwrite")
    parser.add_argument("--retrain", action="store_true", help="Retrain in a temporary directory and compare")
    parser.add_argument("--api-smoke", action="store_true", help="Exercise the development API")
    parser.add_argument("--artifact-dir", type=Path, default=ARTIFACT)
    args = parser.parse_args()
    artifact = args.artifact_dir.resolve()
    snapshot = current_snapshot(artifact)
    if args.create_lock:
        require(not args.retrain and not args.api_smoke, "Create the lock in a separate invocation")
        lock = dict(snapshot, reference_gzip_sha256=sha256(artifact / "model.json.gz"))
        with LOCK.open("x", encoding="utf-8") as handle:
            json.dump(lock, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(json.dumps({"baseline_id": snapshot["baseline_id"], "lock_created": str(LOCK)}, ensure_ascii=False))
        return
    locked = read_json(LOCK)
    reference_archive = locked.pop("reference_gzip_sha256")
    require(snapshot == locked, "Current data, code, or artifact differs from the locked v5 baseline")
    result = {
        "baseline_id": snapshot["baseline_id"],
        "verified": True,
        "reference_gzip_matches": sha256(artifact / "model.json.gz") == reference_archive,
        "retrained": False,
        "api_smoke": False,
        "deployment_eligible": False,
    }
    if args.retrain:
        with tempfile.TemporaryDirectory(prefix="query-v5-retrain-") as directory:
            rerun_dir = Path(directory) / "model"
            run(DATASET, rerun_dir, model_version=MODEL_VERSION, dataset_version=DATASET_VERSION)
            require(artifact_snapshot(rerun_dir) == snapshot["artifact"],
                    "Retrained artifact differs from the locked v5 baseline")
        result["retrained"] = True
    if args.api_smoke:
        api_smoke(artifact)
        result["api_smoke"] = True
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
