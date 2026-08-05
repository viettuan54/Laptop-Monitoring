"""Train and honestly evaluate a small posture baseline by subject.

The model is deliberately simple and auditable: standardized temporal-window
features followed by one centroid per posture class.  Leave-one-subject-out
evaluation is mandatory and training refuses fewer than three real subjects.
"""

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = TRAINING_ROOT.parent
AGENT_COMPANION_ROOT = REPOSITORY_ROOT / "child-monitor-agent" / "companion"
for import_root in (TRAINING_ROOT, AGENT_COMPANION_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from data_collection.calibration_ui import write_json_atomic
from posture_model import (
    FRAME_FEATURE_NAMES,
    PRIMARY_CLASSES,
    aggregate_feature_window,
    extract_posture_features,
    validate_posture_model,
    window_feature_names,
)


MODEL_VERSION = "1.0.0"
REQUIRED_QUALITY_GATE_VERSION = "2.0.0"


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_selected_dataset(
    selection_path,
    *,
    window_size=6,
    stride=6,
    sample_interval_seconds=0.5,
):
    """Load checksum-pinned, quality-gated static sessions into windows."""
    selection_path = Path(selection_path).resolve()
    dataset_dir = selection_path.parent
    selection = _load_json(selection_path)
    entries = selection.get("accepted_sessions")
    if not isinstance(entries, list) or not entries:
        raise ValueError("accepted_sessions is empty")
    if window_size < 3 or stride < 1:
        raise ValueError("window_size/stride is invalid")

    samples = []
    good_frame_vectors = []
    session_summary = []
    for entry in entries:
        session_id = entry.get("session_id")
        primary_class = entry.get("primary_class")
        if primary_class not in PRIMARY_CLASSES:
            raise ValueError(f"unsupported primary_class for {session_id}")
        records_path = dataset_dir / f"{session_id}.landmarks.jsonl"
        manifest_path = dataset_dir / f"{session_id}.manifest.json"
        if not records_path.is_file() or not manifest_path.is_file():
            raise ValueError(f"missing files for accepted session {session_id}")
        expected_hash = entry.get("expected_records_sha256")
        actual_hash = _sha256(records_path)
        if actual_hash != expected_hash:
            raise ValueError(f"checksum mismatch for accepted session {session_id}")

        manifest = _load_json(manifest_path)
        if manifest.get("quality_gate_version") != REQUIRED_QUALITY_GATE_VERSION:
            raise ValueError(
                f"session {session_id} must be recollected with quality gate "
                f"{REQUIRED_QUALITY_GATE_VERSION}"
            )
        if manifest.get("subject_id") is None:
            raise ValueError(f"session {session_id} has no subject_id")

        vectors = []
        last_kept_timestamp_ms = None
        with records_path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("transition") or record.get("visibility_state") != "visible":
                    continue
                timestamp_ms = record.get("timestamp_ms")
                if not isinstance(timestamp_ms, int):
                    raise ValueError(
                        f"accepted session {session_id} has an invalid timestamp"
                    )
                if (
                    last_kept_timestamp_ms is not None
                    and timestamp_ms - last_kept_timestamp_ms
                    < (sample_interval_seconds * 1000) - 1
                ):
                    continue
                vector = extract_posture_features(
                    record.get("pose_landmarks"),
                    record.get("frame_width"),
                    record.get("frame_height"),
                )
                if vector is None:
                    raise ValueError(
                        f"accepted session {session_id} has an unobservable record "
                        f"at line {line_number}"
                    )
                vectors.append(vector)
                last_kept_timestamp_ms = timestamp_ms

        if len(vectors) < window_size:
            raise ValueError(f"session {session_id} has too few usable records")
        window_count = 0
        for start in range(0, len(vectors) - window_size + 1, stride):
            samples.append(
                {
                    "features": aggregate_feature_window(
                        vectors[start : start + window_size]
                    ),
                    "label": primary_class,
                    "subject_id": manifest["subject_id"],
                    "session_id": session_id,
                }
            )
            window_count += 1
        if primary_class == "good":
            good_frame_vectors.extend(vectors)
        session_summary.append(
            {
                "session_id": session_id,
                "subject_id": manifest["subject_id"],
                "primary_class": primary_class,
                "record_count": len(vectors),
                "window_count": window_count,
            }
        )

    subjects = sorted({sample["subject_id"] for sample in samples})
    if len(subjects) < 3:
        raise ValueError(
            "leave-one-subject-out evaluation requires at least 3 real subjects"
        )
    for subject in subjects:
        present = {sample["label"] for sample in samples if sample["subject_id"] == subject}
        missing = set(PRIMARY_CLASSES) - present
        if missing:
            raise ValueError(
                f"subject {subject} is missing posture classes: {sorted(missing)}"
            )
        for class_name in PRIMARY_CLASSES:
            session_count = len(
                {
                    sample["session_id"]
                    for sample in samples
                    if sample["subject_id"] == subject
                    and sample["label"] == class_name
                }
            )
            if session_count < 2:
                raise ValueError(
                    f"subject {subject} class {class_name} requires at least "
                    "two independent sessions"
                )
    return samples, good_frame_vectors, session_summary


def fit_centroid_model(
    samples,
    good_frame_vectors,
    *,
    window_size,
    sample_interval_seconds=0.5,
    minimum_confidence=0.65,
):
    x = np.asarray([sample["features"] for sample in samples], dtype=float)
    labels = [sample["label"] for sample in samples]
    if x.ndim != 2 or x.shape[1] != len(window_feature_names()):
        raise ValueError("training feature matrix has invalid shape")
    mean = np.mean(x, axis=0)
    scale = np.std(x, axis=0)
    scale = np.where(scale < 1e-6, 1.0, scale)
    standardized = (x - mean) / scale

    centroids = {}
    own_distances = []
    for class_name in PRIMARY_CLASSES:
        indices = [index for index, label in enumerate(labels) if label == class_name]
        if not indices:
            raise ValueError(f"training data is missing class {class_name}")
        centroid = np.mean(standardized[indices], axis=0)
        centroids[class_name] = centroid
        own_distances.extend(
            float(np.sum(np.square(standardized[index] - centroid)))
            for index in indices
        )
    positive_distances = [value for value in own_distances if value > 1e-9]
    temperature = float(np.median(positive_distances)) if positive_distances else 1.0
    temperature = max(0.05, temperature)

    if not good_frame_vectors:
        raise ValueError("training data has no good-posture frame features")
    reference_good = np.median(np.asarray(good_frame_vectors, dtype=float), axis=0)
    model = {
        "model_version": MODEL_VERSION,
        "model_type": "nearest_centroid_window",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "frame_feature_names": list(FRAME_FEATURE_NAMES),
        "window_feature_names": list(window_feature_names()),
        "window_size": int(window_size),
        "sample_interval_seconds": round(float(sample_interval_seconds), 4),
        "classes": list(PRIMARY_CLASSES),
        "minimum_confidence": round(float(minimum_confidence), 4),
        "temperature": round(temperature, 10),
        "scaler_mean": [round(float(value), 10) for value in mean],
        "scaler_scale": [round(float(value), 10) for value in scale],
        "centroids": {
            name: [round(float(value), 10) for value in centroids[name]]
            for name in PRIMARY_CLASSES
        },
        "reference_good_frame": [
            round(float(value), 10) for value in reference_good
        ],
        "training_summary": {
            "subject_count": len({sample["subject_id"] for sample in samples}),
            "session_count": len({sample["session_id"] for sample in samples}),
            "window_count": len(samples),
            "class_window_counts": dict(Counter(labels)),
        },
    }
    return validate_posture_model(model)


def predict_features(model, features):
    standardized = [
        (value - model["scaler_mean"][index]) / model["scaler_scale"][index]
        for index, value in enumerate(features)
    ]
    distances = {
        name: sum(
            (value - model["centroids"][name][index]) ** 2
            for index, value in enumerate(standardized)
        )
        for name in PRIMARY_CLASSES
    }
    minimum = min(distances.values())
    scores = {
        name: math.exp(-min(60.0, (distance - minimum) / model["temperature"]))
        for name, distance in distances.items()
    }
    total = sum(scores.values())
    probabilities = {name: score / total for name, score in scores.items()}
    predicted = max(probabilities, key=probabilities.get)
    return predicted, probabilities[predicted]


def _fold_metrics(actual, predicted, confidences, threshold):
    confusion = {
        actual_name: {predicted_name: 0 for predicted_name in PRIMARY_CLASSES}
        for actual_name in PRIMARY_CLASSES
    }
    for expected, received in zip(actual, predicted):
        confusion[expected][received] += 1
    recalls = []
    for class_name in PRIMARY_CLASSES:
        total = sum(confusion[class_name].values())
        recalls.append(confusion[class_name][class_name] / total if total else 0.0)
    correct = sum(a == p for a, p in zip(actual, predicted))
    conclusive = sum(confidence >= threshold for confidence in confidences)
    conclusive_correct = sum(
        a == p and confidence >= threshold
        for a, p, confidence in zip(actual, predicted, confidences)
    )
    return {
        "sample_count": len(actual),
        "accuracy": round(correct / len(actual), 4),
        "macro_recall": round(sum(recalls) / len(recalls), 4),
        "conclusive_coverage": round(conclusive / len(actual), 4),
        "conclusive_accuracy": (
            round(conclusive_correct / conclusive, 4) if conclusive else None
        ),
        "confusion_matrix": confusion,
    }


def train_with_loso(
    samples,
    good_frame_vectors,
    *,
    window_size=6,
    sample_interval_seconds=0.5,
    minimum_confidence=0.65,
    minimum_macro_recall=0.70,
    minimum_conclusive_accuracy=0.80,
    minimum_conclusive_coverage=0.50,
):
    subjects = sorted({sample["subject_id"] for sample in samples})
    if len(subjects) < 3:
        raise ValueError("LOSO requires at least three subjects")
    folds = []
    for held_out in subjects:
        training_samples = [sample for sample in samples if sample["subject_id"] != held_out]
        testing_samples = [sample for sample in samples if sample["subject_id"] == held_out]
        # Fold predictions are unpersonalized, but keep the model metadata free
        # of held-out-subject leakage by deriving its neutral reference only
        # from good windows in the training subjects.
        training_good = [
            sample["features"][: len(FRAME_FEATURE_NAMES)]
            for sample in training_samples
            if sample["label"] == "good"
        ]
        model = fit_centroid_model(
            training_samples,
            training_good,
            window_size=window_size,
            sample_interval_seconds=sample_interval_seconds,
            minimum_confidence=minimum_confidence,
        )
        outputs = [predict_features(model, sample["features"]) for sample in testing_samples]
        folds.append(
            {
                "held_out_subject": held_out,
                **_fold_metrics(
                    [sample["label"] for sample in testing_samples],
                    [output[0] for output in outputs],
                    [output[1] for output in outputs],
                    minimum_confidence,
                ),
            }
        )

    final_model = fit_centroid_model(
        samples,
        good_frame_vectors,
        window_size=window_size,
        sample_interval_seconds=sample_interval_seconds,
        minimum_confidence=minimum_confidence,
    )
    conclusive_accuracies = [
        fold["conclusive_accuracy"]
        for fold in folds
        if fold["conclusive_accuracy"] is not None
    ]
    report = {
        "report_version": "1.0.0",
        "evaluation_method": "leave_one_subject_out",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "subject_count": len(subjects),
        "subjects": subjects,
        "folds": folds,
        "mean_accuracy": round(sum(fold["accuracy"] for fold in folds) / len(folds), 4),
        "mean_macro_recall": round(
            sum(fold["macro_recall"] for fold in folds) / len(folds),
            4,
        ),
        "mean_conclusive_coverage": round(
            sum(fold["conclusive_coverage"] for fold in folds) / len(folds),
            4,
        ),
        "mean_conclusive_accuracy": (
            round(sum(conclusive_accuracies) / len(conclusive_accuracies), 4)
            if conclusive_accuracies
            else None
        ),
    }
    report["acceptance"] = {
        "minimum_macro_recall": minimum_macro_recall,
        "minimum_conclusive_accuracy": minimum_conclusive_accuracy,
        "minimum_conclusive_coverage": minimum_conclusive_coverage,
        "passed": (
            report["mean_macro_recall"] >= minimum_macro_recall
            and report["mean_conclusive_accuracy"] is not None
            and report["mean_conclusive_accuracy"] >= minimum_conclusive_accuracy
            and report["mean_conclusive_coverage"] >= minimum_conclusive_coverage
        ),
    }
    final_model["deployment_approved"] = report["acceptance"]["passed"]
    final_model["loso_summary"] = {
        "mean_accuracy": report["mean_accuracy"],
        "mean_macro_recall": report["mean_macro_recall"],
        "mean_conclusive_coverage": report["mean_conclusive_coverage"],
    }
    return final_model, report


def main():
    parser = argparse.ArgumentParser(
        description="Train a posture baseline with mandatory LOSO evaluation."
    )
    parser.add_argument(
        "--selection",
        type=Path,
        default=TRAINING_ROOT / "datasets" / "pilot" / "accepted_sessions.json",
    )
    parser.add_argument("--window-size", type=int, default=6)
    parser.add_argument("--stride", type=int, default=6)
    parser.add_argument("--sample-interval-seconds", type=float, default=0.5)
    parser.add_argument("--minimum-confidence", type=float, default=0.65)
    parser.add_argument(
        "--output-model",
        type=Path,
        default=TRAINING_ROOT / "artifacts" / "posture_baseline_v1.json",
    )
    parser.add_argument(
        "--output-report",
        type=Path,
        default=TRAINING_ROOT / "artifacts" / "posture_loso_report.json",
    )
    args = parser.parse_args()
    try:
        if not 3 <= args.window_size <= 60:
            raise ValueError("window-size must be between 3 and 60")
        if args.stride < 1:
            raise ValueError("stride must be positive")
        if not 0.2 <= args.sample_interval_seconds <= 5.0:
            raise ValueError("sample-interval-seconds must be between 0.2 and 5")
        if not 0.5 <= args.minimum_confidence <= 0.99:
            raise ValueError("minimum-confidence must be between 0.5 and 0.99")
        samples, good_vectors, sessions = load_selected_dataset(
            args.selection,
            window_size=args.window_size,
            stride=args.stride,
            sample_interval_seconds=args.sample_interval_seconds,
        )
        model, report = train_with_loso(
            samples,
            good_vectors,
            window_size=args.window_size,
            sample_interval_seconds=args.sample_interval_seconds,
            minimum_confidence=args.minimum_confidence,
        )
        report["sessions"] = sessions
        write_json_atomic(args.output_model.resolve(), model)
        write_json_atomic(args.output_report.resolve(), report)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(f"Posture model: {args.output_model.resolve()}")
    print(f"LOSO report: {args.output_report.resolve()}")
    print(f"Mean LOSO accuracy: {report['mean_accuracy']:.2%}")
    print(f"Conclusive coverage: {report['mean_conclusive_coverage']:.2%}")
    print(
        "Deployment gate: "
        f"{'PASS' if report['acceptance']['passed'] else 'FAIL (runtime will fallback)'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
