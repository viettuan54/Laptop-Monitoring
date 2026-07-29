"""Evaluate a frozen v2 distance profile on an independent session."""

import argparse
import json
import math
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from data_collection.calibration_ui import validate_json, write_json_atomic
from data_collection.distance_measurement import estimate_distance_from_profile


REPORT_VERSION = "1.0.0"


def _safe_ratio(numerator, denominator):
    return round(numerator / denominator, 4) if denominator else None


def _metrics(actual, predicted):
    residuals = [
        predicted_value - actual_value
        for actual_value, predicted_value in zip(actual, predicted)
    ]
    absolute_errors = [abs(value) for value in residuals]
    return {
        "sample_count": len(actual),
        "mae_cm": round(statistics.mean(absolute_errors), 2),
        "rmse_cm": round(
            math.sqrt(statistics.mean(value * value for value in residuals)),
            2,
        ),
        "bias_cm": round(statistics.mean(residuals), 2),
        "max_absolute_error_cm": round(max(absolute_errors), 2),
    }


def _check_compatibility(profile, session):
    mismatches = []
    for field in ("camera_id", "subject_id", "frame_width", "frame_height"):
        if profile.get(field) != session.get(field):
            mismatches.append(
                f"{field}: profile={profile.get(field)!r}, "
                f"session={session.get(field)!r}"
            )
    if mismatches:
        raise ValueError("Profile/session mismatch: " + "; ".join(mismatches))


def evaluate_profile(profile, session, *, threshold_cm=35.0):
    _check_compatibility(profile, session)
    if session.get("status") != "completed":
        raise ValueError("Validation session must be completed")

    feature_range = profile["feature_range"]
    feature_min = feature_range["inverse_eye_separation_min"]
    feature_max = feature_range["inverse_eye_separation_max"]
    evaluated = []
    outside_feature_range = 0

    for sample in session["samples"]:
        separation = float(sample["eye_separation_normalized"])
        predicted = estimate_distance_from_profile(separation, profile)
        if predicted is None:
            continue
        inverse_separation = 1.0 / separation
        outside = not feature_min <= inverse_separation <= feature_max
        outside_feature_range += int(outside)
        evaluated.append(
            {
                "actual_distance_cm": float(sample["actual_distance_cm"]),
                "predicted_distance_cm": predicted,
                "absolute_error_cm": round(
                    abs(predicted - float(sample["actual_distance_cm"])),
                    2,
                ),
                "outside_feature_range": outside,
            }
        )

    if not evaluated:
        raise ValueError("Validation session has no evaluable samples")

    actual = [item["actual_distance_cm"] for item in evaluated]
    predicted = [item["predicted_distance_cm"] for item in evaluated]
    overall = _metrics(actual, predicted)

    per_distance = []
    for distance in sorted(set(actual)):
        group_predictions = [
            item["predicted_distance_cm"]
            for item in evaluated
            if item["actual_distance_cm"] == distance
        ]
        group_actual = [distance] * len(group_predictions)
        distance_metrics = _metrics(group_actual, group_predictions)
        per_distance.append(
            {
                "actual_distance_cm": distance,
                "predicted_mean_cm": round(statistics.mean(group_predictions), 2),
                **distance_metrics,
            }
        )

    near_threshold_items = [
        item
        for item in evaluated
        if 30.0 <= item["actual_distance_cm"] <= 40.0
    ]
    near_threshold = _metrics(
        [item["actual_distance_cm"] for item in near_threshold_items],
        [item["predicted_distance_cm"] for item in near_threshold_items],
    )

    true_positive = true_negative = false_positive = false_negative = 0
    for item in evaluated:
        actual_too_close = item["actual_distance_cm"] < threshold_cm
        predicted_too_close = item["predicted_distance_cm"] < threshold_cm
        if actual_too_close and predicted_too_close:
            true_positive += 1
        elif not actual_too_close and not predicted_too_close:
            true_negative += 1
        elif not actual_too_close and predicted_too_close:
            false_positive += 1
        else:
            false_negative += 1

    total = len(evaluated)
    threshold_classification = {
        "threshold_cm": threshold_cm,
        "rule": "too_close when distance_cm < threshold_cm",
        "true_positive": true_positive,
        "true_negative": true_negative,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "accuracy": _safe_ratio(true_positive + true_negative, total),
        "precision": _safe_ratio(true_positive, true_positive + false_positive),
        "recall": _safe_ratio(true_positive, true_positive + false_negative),
        "specificity": _safe_ratio(true_negative, true_negative + false_positive),
        "false_positive_rate": _safe_ratio(
            false_positive,
            false_positive + true_negative,
        ),
        "false_negative_rate": _safe_ratio(
            false_negative,
            false_negative + true_positive,
        ),
    }

    acceptance = {
        "overall_mae_at_most_5_cm": overall["mae_cm"] <= 5.0,
        "near_threshold_mae_at_most_3_cm": near_threshold["mae_cm"] <= 3.0,
        "threshold_recall_at_least_90_percent": (
            threshold_classification["recall"] is not None
            and threshold_classification["recall"] >= 0.9
        ),
        "false_positive_rate_at_most_10_percent": (
            threshold_classification["false_positive_rate"] is not None
            and threshold_classification["false_positive_rate"] <= 0.1
        ),
        "all_samples_inside_feature_range": outside_feature_range == 0,
    }
    acceptance["passed"] = all(acceptance.values())

    return {
        "report_version": REPORT_VERSION,
        "evaluation_scope": "independent_session",
        "profile_version": profile["profile_version"],
        "profile_created_at": profile["created_at"],
        "validation_session_id": session["session_id"],
        "camera_id": session["camera_id"],
        "subject_id": session["subject_id"],
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "evaluated_sample_count": len(evaluated),
        "skipped_sample_count": len(session["samples"]) - len(evaluated),
        "outside_feature_range_count": outside_feature_range,
        "overall": overall,
        "near_threshold_30_40_cm": near_threshold,
        "per_distance": per_distance,
        "threshold_classification": threshold_classification,
        "acceptance": acceptance,
    }


def evaluate_files(profile_path, session_path, *, threshold_cm=35.0, output_path=None):
    profile_path = Path(profile_path).resolve()
    session_path = Path(session_path).resolve()
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    session = json.loads(session_path.read_text(encoding="utf-8"))
    validate_json(
        profile,
        TRAINING_ROOT / "datasets" / "schema" / "calibration_profile.schema.json",
    )
    validate_json(
        session,
        TRAINING_ROOT / "datasets" / "schema" / "calibration_session.schema.json",
    )
    report = evaluate_profile(profile, session, threshold_cm=threshold_cm)
    if output_path is None:
        output_path = session_path.with_name(
            f"{session_path.stem}.profile-evaluation.json"
        )
    output_path = Path(output_path).resolve()
    write_json_atomic(output_path, report)
    return output_path, report


def _print_report(report):
    print(
        "Distance | Samples | Predicted mean | MAE | Bias"
    )
    for item in report["per_distance"]:
        print(
            f"{item['actual_distance_cm']:8.1f} | "
            f"{item['sample_count']:7d} | "
            f"{item['predicted_mean_cm']:14.2f} | "
            f"{item['mae_cm']:4.2f} | "
            f"{item['bias_cm']:5.2f}"
        )
    overall = report["overall"]
    near = report["near_threshold_30_40_cm"]
    threshold = report["threshold_classification"]
    print(f"Overall MAE: {overall['mae_cm']:.2f} cm")
    print(f"Overall RMSE: {overall['rmse_cm']:.2f} cm")
    print(f"30-40 cm MAE: {near['mae_cm']:.2f} cm")
    print(
        "Threshold confusion [TP, TN, FP, FN]: "
        f"[{threshold['true_positive']}, {threshold['true_negative']}, "
        f"{threshold['false_positive']}, {threshold['false_negative']}]"
    )
    print(f"Acceptance: {'PASS' if report['acceptance']['passed'] else 'FAIL'}")


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate a frozen v2 profile on an independent session."
    )
    parser.add_argument("profile", type=Path)
    parser.add_argument("session", type=Path)
    parser.add_argument("--threshold-cm", type=float, default=35.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output_path, report = evaluate_files(
            args.profile,
            args.session,
            threshold_cm=args.threshold_cm,
            output_path=args.output,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    _print_report(report)
    print(f"Report written: {output_path}")
    return 0 if report["acceptance"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
