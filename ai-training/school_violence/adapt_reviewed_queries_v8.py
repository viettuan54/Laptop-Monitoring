"""Build a non-deployable linear candidate from reviewed search queries.

The three review files are development data. In particular, DuLieuThat3 has
already been evaluated on earlier models, so its cross-validation results are
not a final independent performance estimate. Raw text stays in ignored local
artifacts.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import shutil
import unicodedata
from collections import Counter
from pathlib import Path

import numpy as np

from .adapt_confirmed_errors_v6 import read_csv, sha256
from .adapt_reviewed_queries_v7 import (
    load_legacy_corrections,
    load_real_review,
    make_cv_folds,
    metrics_from_matrix,
)
from .evaluate_real_world import BACKEND_REJECTED_TEXT, _text_keys, check_independence
from .linear_query_model import ALGORITHM, predict_scores_linear, word_features
from .training import LABELS, SENSITIVE_PATTERNS, evaluate


MODEL_VERSION = "vi-school-violence-word-linear-v8-query-candidate"
DATASET_VERSION = "school-violence-reviewed-query-development-v3"
REVIEW3_SHA256 = "a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1"
REVIEW3_COUNTS = {"SAFE": 39, "RISK": 33, "HIGH_RISK": 9}
BASE_V5_SHA256 = "8c9c9642f796a596ce091ee8cf3ebe564be859862f115f22c985faba58f2bc7b"
ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "school_violence"
PENALTY = 0.001
HIGH_WEIGHT = 3.0
SAFE_WEIGHT = 1.5
EPOCHS = 200
MIN_DOCUMENT_FREQUENCY = 2
CV_SEEDS = (20261002, 20261003, 20261004, 20261005, 20261006)


def load_review3(path: Path) -> list[dict]:
    if sha256(path) != REVIEW3_SHA256:
        raise ValueError("DuLieuThat3 review changed; audit labels before training")
    rows = read_csv(path, ["id", "text", "label"])
    if len(rows) != 81 or dict(Counter(row["label"] for row in rows)) != REVIEW3_COUNTS:
        raise ValueError("Unexpected DuLieuThat3 label counts")
    seen: set[str] = set()
    for row in rows:
        value = " ".join(unicodedata.normalize("NFKC", row["text"]).split())
        if not value or len(value) > 1000 or any(
            ord(char) < 32 and char not in "\t\n\r" or ord(char) == 127 for char in value
        ):
            raise ValueError(f"Invalid text at ID {row['id']}")
        if any(pattern.search(value) for pattern in (*SENSITIVE_PATTERNS, *BACKEND_REJECTED_TEXT)):
            raise ValueError(f"Potential private identifier at ID {row['id']}")
        keys = _text_keys(row["text"])
        if not keys or keys & seen:
            raise ValueError(f"Duplicate normalized text at ID {row['id']}")
        seen.update(keys)
    return rows


def development_rows(review2: Path, review3: Path, legacy: Path,
                     provenance: Path) -> list[dict]:
    sources = (
        ("DuLieuThat1", load_legacy_corrections(legacy, provenance)),
        ("DuLieuThat2", load_real_review(review2)),
        ("DuLieuThat3", load_review3(review3)),
    )
    rows = [{"id": f"{source}:{row['id']}", "text": row["text"], "label": row["label"]}
            for source, records in sources for row in records]
    seen: set[str] = set()
    for row in rows:
        keys = _text_keys(row["text"])
        if keys & seen:
            raise ValueError(f"Cross-review duplicate at ID {row['id']}")
        seen.update(keys)
    return rows


def _vectorize(rows: list[dict], features: dict[str, list[float]]) -> np.ndarray:
    columns = {feature: index for index, feature in enumerate(features)}
    matrix = np.zeros((len(rows), len(columns)), dtype=np.float64)
    for index, row in enumerate(rows):
        for feature in word_features(row["text"]):
            column = columns.get(feature)
            if column is not None:
                matrix[index, column] = features[feature][0]
    norms = np.linalg.norm(matrix, axis=1)
    matrix /= np.maximum(norms[:, None], 1e-12)
    return matrix


def fit_linear(rows: list[dict]) -> dict:
    if {row["label"] for row in rows} != set(LABELS):
        raise ValueError("Training needs all three labels")
    frequencies = Counter(feature for row in rows for feature in word_features(row["text"]))
    features = {
        feature: [math.log((1 + len(rows)) / (1 + frequencies[feature])) + 1]
        for feature in sorted(frequencies) if frequencies[feature] >= MIN_DOCUMENT_FREQUENCY
    }
    if not features:
        raise ValueError("No shared word features")
    matrix = _vectorize(rows, features)
    actual = np.array([LABELS.index(row["label"]) for row in rows])
    class_weights = np.array((SAFE_WEIGHT, 1.0, HIGH_WEIGHT))
    sample_weights = class_weights[actual]
    targets = np.eye(len(LABELS))[actual]
    weights = np.zeros((len(features), len(LABELS)), dtype=np.float64)
    bias = np.zeros(len(LABELS), dtype=np.float64)
    for epoch in range(EPOCHS):
        logits = matrix @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        residual = (probabilities - targets) * (sample_weights / sample_weights.sum())[:, None]
        rate = 5.0 / (1 + epoch / 30)
        weights -= rate * (matrix.T @ residual + PENALTY * weights)
        bias -= rate * residual.sum(axis=0)
    for index, feature in enumerate(features):
        features[feature].extend(float(weight) for weight in weights[index])
    return {
        "algorithm": ALGORITHM,
        "labels": list(LABELS),
        "features": features,
        "bias": [float(value) for value in bias],
        "fallback_prior": {label: sum(row["label"] == label for row in rows) / len(rows)
                           for label in LABELS},
    }


def cross_validate(rows: list[dict], *, seed: int = CV_SEEDS[0]) -> dict:
    folds, group_count = make_cv_folds(rows, seed=seed)
    matrix = {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
    source_matrices = {
        source: {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
        for source in ("DuLieuThat1", "DuLieuThat2", "DuLieuThat3")
    }
    errors: list[dict] = []
    for fold in folds:
        held = set(fold)
        model = fit_linear([row for index, row in enumerate(rows) if index not in held])
        for index in fold:
            row = rows[index]
            predicted = max(LABELS, key=predict_scores_linear(model, row["text"]).get)
            source = row["id"].split(":", 1)[0]
            matrix[row["label"]][predicted] += 1
            source_matrices[source][row["label"]][predicted] += 1
            if predicted != row["label"]:
                errors.append({"id": row["id"], "label": row["label"], "predicted": predicted})
    return {
        **metrics_from_matrix(matrix),
        "seed": seed,
        "fold_count": len(folds),
        "near_duplicate_group_count": group_count,
        "fold_label_counts": [dict(Counter(rows[index]["label"] for index in fold))
                              for fold in folds],
        "by_review": {source: metrics_from_matrix(source_matrix)
                      for source, source_matrix in source_matrices.items()},
        "errors_by_id": sorted(errors, key=lambda row: row["id"]),
    }


def build_candidate(base_dir: Path, review2: Path, review3: Path, legacy: Path,
                    provenance: Path, output_dir: Path, *, authorized: bool) -> dict:
    if not authorized:
        raise ValueError("Training authorization for reviewed queries is required")
    resolved = output_dir.resolve()
    if not resolved.is_relative_to(ARTIFACT_ROOT.resolve()) or resolved == ARTIFACT_ROOT.resolve():
        raise ValueError("Output must be inside the ignored artifact directory")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if sha256(base_dir / "model.json.gz") != BASE_V5_SHA256:
        raise ValueError("Unexpected v5 baseline artifact")
    rows = development_rows(review2, review3, legacy, provenance)
    independence = check_independence(rows, base_dir)
    cv = cross_validate(rows)
    sensitivity = [cv, *(cross_validate(rows, seed=seed) for seed in CV_SEEDS[1:])]
    cv_sensitivity = {
        "seeds": list(CV_SEEDS),
        "macro_f1": [result["macro_f1"] for result in sensitivity],
        "high_risk_correct": [result["confusion_matrix"]["HIGH_RISK"]["HIGH_RISK"]
                              for result in sensitivity],
        "safe_alerts": [sum(result["confusion_matrix"]["SAFE"][label]
                            for label in ("RISK", "HIGH_RISK")) for result in sensitivity],
    }
    model = fit_linear(rows)
    fingerprint = hashlib.sha256(json.dumps({
        "base_v5_sha256": BASE_V5_SHA256,
        "legacy_review_sha256": sha256(legacy),
        "legacy_provenance_sha256": sha256(provenance),
        "review2_sha256": sha256(review2),
        "review3_sha256": sha256(review3),
        "algorithm": ALGORITHM,
        "penalty": PENALTY,
        "high_weight": HIGH_WEIGHT,
        "safe_weight": SAFE_WEIGHT,
        "epochs": EPOCHS,
        "min_document_frequency": MIN_DOCUMENT_FREQUENCY,
    }, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    configuration = {
        "algorithm": ALGORITHM,
        "input_columns": ["text"],
        "features": "binary_unicode_word_unigrams_and_bigrams_tfidf_l2",
        "no_known_feature_behavior": "unweighted_training_label_prior",
        "min_document_frequency": MIN_DOCUMENT_FREQUENCY,
        "penalty": PENALTY,
        "high_weight": HIGH_WEIGHT,
        "safe_weight": SAFE_WEIGHT,
        "epochs": EPOCHS,
        "selection_method": "exploratory_grouped_development_cv_priority_high_recall_and_safe_alerts",
        "development_data_used_for_configuration_selection": True,
        "final_independent_test_available": False,
    }
    model.update(
        model_version=MODEL_VERSION,
        dataset_version=DATASET_VERSION,
        combined_dataset_sha256=fingerprint,
        training_configuration=configuration,
        deployment_eligible=False,
    )
    fit_metrics = evaluate(model, rows)
    report = {
        "model_version": MODEL_VERSION,
        "source_audit": {"combined_dataset_sha256": fingerprint},
        "development_rows": len(rows),
        "development_label_counts": dict(Counter(row["label"] for row in rows)),
        "review_sha256": {"DuLieuThat1": sha256(legacy),
                          "DuLieuThat2": sha256(review2),
                          "DuLieuThat3": sha256(review3)},
        "base_v5_sha256": BASE_V5_SHA256,
        "reference_independence": independence,
        "configuration": configuration,
        "development_cv": cv,
        "development_cv_sensitivity": cv_sensitivity,
        "development_training_fit": fit_metrics,
        "operator_asserted_training_authorization": True,
        "permission_verified_by_code": False,
        "deployment_eligible": False,
        "limitations": [
            "All three review files are development data; DuLieuThat3 predictions were inspected before v8 was built.",
            "The same development data informed feature and weight selection, so cross-validation is optimistic.",
            "Near-duplicate character grouping cannot prove independence by child, session or meaning.",
            "No independent new holdout was used for a deployment decision.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "train.jsonl").open("x", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps({
                "id": row["id"], "text": row["text"], "label": row["label"],
                "split": "train", "source": "user_reviewed_query",
                "review_status": "user_labeled", "source_ids": [row["id"]],
                "group_ids": [],
            }, ensure_ascii=False) + "\n")
    for split in ("validation", "test"):
        shutil.copyfile(base_dir / f"{split}.jsonl", output_dir / f"{split}.jsonl")
    encoded = json.dumps(model, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    with (output_dir / "model.json.gz").open("xb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as archive:
            archive.write(encoded)
    for name, payload in (
        ("evaluation_report.json", report),
        ("training_config.json", configuration),
        ("dataset_manifest.json", {
            "dataset_version": DATASET_VERSION,
            "combined_dataset_sha256": fingerprint,
            "development_rows": len(rows),
            "deployment_eligible": False,
        }),
    ):
        (output_dir / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-artifact", required=True, type=Path)
    parser.add_argument("--review2", required=True, type=Path)
    parser.add_argument("--review3", required=True, type=Path)
    parser.add_argument("--legacy-review", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    report = build_candidate(args.base_artifact, args.review2, args.review3,
                             args.legacy_review, args.provenance, args.output_dir,
                             authorized=args.authorized)
    matrix = report["development_cv"]["confusion_matrix"]
    print(json.dumps({
        "model_version": report["model_version"],
        "development_cv_macro_f1": report["development_cv"]["macro_f1"],
        "development_cv_high_risk_correct": matrix["HIGH_RISK"]["HIGH_RISK"],
        "development_cv_safe_alerts": matrix["SAFE"]["RISK"] + matrix["SAFE"]["HIGH_RISK"],
        "deployment_eligible": False,
    }))


if __name__ == "__main__":
    main()
