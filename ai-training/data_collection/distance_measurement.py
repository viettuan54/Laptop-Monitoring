"""Ground-truth distance normalization and camera calibration helpers."""

import math
import re
import statistics
from datetime import datetime, timezone

import numpy as np


DISTANCE_STANDARD_VERSION = "1.0.0"
CALIBRATION_PROFILE_VERSION = "2.0.0"
TARGET_DISTANCES_CM = (25.0, 30.0, 35.0, 40.0, 50.0, 60.0, 80.0)
MEASUREMENT_METHODS = frozenset({"tape_measure", "laser_measure"})
MEASUREMENT_REFERENCE = "camera_lens_center_to_eye_midpoint"
RIGHT_EYE_CORNERS = (33, 133)
LEFT_EYE_CORNERS = (362, 263)
NOSE_TIP = 1


def _finite_number(value, field):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def _coordinate(point, name):
    if isinstance(point, dict):
        return _finite_number(point.get(name, 0.0), name)
    return _finite_number(getattr(point, name, 0.0), name)


def _midpoint(first, second):
    return (
        (_coordinate(first, "x") + _coordinate(second, "x")) / 2.0,
        (_coordinate(first, "y") + _coordinate(second, "y")) / 2.0,
    )


def extract_eye_measurement(
    face_landmarks,
    frame_width,
    frame_height,
    *,
    max_head_yaw_ratio=0.45,
    max_center_offset_x=0.3,
    max_center_offset_y=0.35,
):
    """Extract the normalized eye feature used by calibration and inference.

    Returns ``None`` when the face is degenerate, too far off-axis or appears
    to have strong head yaw.
    """
    if not face_landmarks or len(face_landmarks) <= max(LEFT_EYE_CORNERS):
        return None

    width = _finite_number(frame_width, "frame_width")
    height = _finite_number(frame_height, "frame_height")
    if width <= 0 or height <= 0:
        raise ValueError("frame dimensions must be positive")

    right_eye = _midpoint(
        face_landmarks[RIGHT_EYE_CORNERS[0]],
        face_landmarks[RIGHT_EYE_CORNERS[1]],
    )
    left_eye = _midpoint(
        face_landmarks[LEFT_EYE_CORNERS[0]],
        face_landmarks[LEFT_EYE_CORNERS[1]],
    )
    eye_midpoint = (
        (left_eye[0] + right_eye[0]) / 2.0,
        (left_eye[1] + right_eye[1]) / 2.0,
    )
    separation = math.hypot(
        left_eye[0] - right_eye[0],
        (left_eye[1] - right_eye[1]) * (height / width),
    )
    if not 0.01 <= separation <= 0.5:
        return None

    nose_x = _coordinate(face_landmarks[NOSE_TIP], "x")
    yaw_ratio = abs(nose_x - eye_midpoint[0]) / separation
    center_offset_x = abs(eye_midpoint[0] - 0.5)
    center_offset_y = abs(eye_midpoint[1] - 0.5)
    if (
        yaw_ratio > max_head_yaw_ratio
        or center_offset_x > max_center_offset_x
        or center_offset_y > max_center_offset_y
    ):
        return None

    return {
        "eye_separation_normalized": round(separation, 8),
        "head_yaw_ratio": round(yaw_ratio, 4),
        "eye_center_offset_x": round(center_offset_x, 4),
        "eye_center_offset_y": round(center_offset_y, 4),
    }


def normalize_distance_measurement(
    actual_distance_cm,
    *,
    status="measured",
    method="tape_measure",
    uncertainty_cm=1.0,
):
    """Normalize one ground-truth measurement for a landmark record."""
    if status not in {"measured", "not_measured", "invalid"}:
        raise ValueError(f"Unknown distance measurement status: {status!r}")

    if status != "measured":
        if actual_distance_cm is not None:
            raise ValueError("actual_distance_cm must be null unless status is measured")
        return {
            "distance_measurement_status": status,
            "actual_distance_cm": None,
            "distance_measurement_method": None,
            "distance_reference": MEASUREMENT_REFERENCE,
            "distance_uncertainty_cm": None,
        }

    distance = _finite_number(actual_distance_cm, "actual_distance_cm")
    uncertainty = _finite_number(uncertainty_cm, "distance_uncertainty_cm")
    if not 20.0 <= distance <= 200.0:
        raise ValueError("actual_distance_cm must be between 20 and 200 cm")
    if method not in MEASUREMENT_METHODS:
        raise ValueError(f"Unknown distance measurement method: {method!r}")
    if not 0.1 <= uncertainty <= 5.0:
        raise ValueError("distance_uncertainty_cm must be between 0.1 and 5 cm")

    return {
        "distance_measurement_status": "measured",
        "actual_distance_cm": round(distance, 1),
        "distance_measurement_method": method,
        "distance_reference": MEASUREMENT_REFERENCE,
        "distance_uncertainty_cm": round(uncertainty, 1),
    }


def build_calibration_profile(
    samples,
    *,
    camera_id,
    subject_id,
    frame_width,
    frame_height,
):
    """Build a subject-camera profile from normalized eye-separation samples.

    Each sample contains ``actual_distance_cm`` and
    ``eye_separation_normalized``. The latter is the pixel eye separation
    divided by frame width.
    """
    if not isinstance(camera_id, str) or not re.fullmatch(
        r"camera-[A-Za-z0-9_-]{1,120}",
        camera_id,
    ):
        raise ValueError("camera_id must use the form camera-<safe-id>")
    if not isinstance(subject_id, str) or not re.fullmatch(
        r"subject-[A-Za-z0-9_-]+",
        subject_id,
    ):
        raise ValueError("subject_id must use the form subject-<safe-id>")

    width = int(_finite_number(frame_width, "frame_width"))
    height = int(_finite_number(frame_height, "frame_height"))
    if width <= 0 or height <= 0:
        raise ValueError("frame dimensions must be positive")

    normalized_samples = []
    for sample in samples:
        distance = _finite_number(sample.get("actual_distance_cm"), "actual_distance_cm")
        separation = _finite_number(
            sample.get("eye_separation_normalized"),
            "eye_separation_normalized",
        )
        if not 20.0 <= distance <= 200.0:
            raise ValueError("calibration distance must be between 20 and 200 cm")
        if not 0.01 <= separation <= 0.5:
            raise ValueError("eye_separation_normalized must be between 0.01 and 0.5")
        normalized_samples.append((distance, separation))

    distinct_distances = {round(distance, 1) for distance, _ in normalized_samples}
    if len(normalized_samples) < 6 or len(distinct_distances) < 3:
        raise ValueError("calibration requires at least 6 samples at 3 distances")

    actual_distances = np.asarray(
        [distance for distance, _ in normalized_samples],
        dtype=float,
    )
    inverse_eye_separations = np.asarray(
        [1.0 / separation for _, separation in normalized_samples],
        dtype=float,
    )
    if len(np.unique(np.round(inverse_eye_separations, 8))) < 3:
        raise ValueError("quadratic calibration requires at least 3 distinct features")

    quadratic, linear, intercept = np.polyfit(
        inverse_eye_separations,
        actual_distances,
        2,
    )
    predictions = np.polyval(
        [quadratic, linear, intercept],
        inverse_eye_separations,
    )
    residuals = predictions - actual_distances
    absolute_errors = np.abs(residuals)

    legacy_scales = [
        distance * separation for distance, separation in normalized_samples
    ]
    legacy_scale_cm = statistics.median(legacy_scales)
    legacy_errors = [
        abs((legacy_scale_cm / separation) - distance)
        for distance, separation in normalized_samples
    ]

    per_distance_metrics = []
    for distance in sorted(distinct_distances):
        mask = actual_distances == distance
        distance_predictions = predictions[mask]
        distance_residuals = residuals[mask]
        per_distance_metrics.append(
            {
                "actual_distance_cm": distance,
                "sample_count": int(np.sum(mask)),
                "predicted_mean_cm": round(float(np.mean(distance_predictions)), 2),
                "bias_cm": round(float(np.mean(distance_residuals)), 2),
                "mae_cm": round(float(np.mean(np.abs(distance_residuals))), 2),
            }
        )

    return {
        "profile_version": CALIBRATION_PROFILE_VERSION,
        "distance_standard_version": DISTANCE_STANDARD_VERSION,
        "profile_scope": "subject_camera",
        "model_type": "inverse_eye_separation_polynomial",
        "polynomial_degree": 2,
        "coefficient_order": ["quadratic", "linear", "intercept"],
        "coefficients": {
            "quadratic": round(float(quadratic), 12),
            "linear": round(float(linear), 12),
            "intercept": round(float(intercept), 12),
        },
        "feature_range": {
            "inverse_eye_separation_min": round(
                float(np.min(inverse_eye_separations)),
                8,
            ),
            "inverse_eye_separation_max": round(
                float(np.max(inverse_eye_separations)),
                8,
            ),
        },
        "camera_id": camera_id,
        "subject_id": subject_id,
        "frame_width": width,
        "frame_height": height,
        "sample_count": len(normalized_samples),
        "calibration_distances_cm": sorted(distinct_distances),
        "training_metrics": {
            "evaluation_scope": "training_data_only",
            "mae_cm": round(float(np.mean(absolute_errors)), 2),
            "rmse_cm": round(float(np.sqrt(np.mean(np.square(residuals)))), 2),
            "max_absolute_error_cm": round(float(np.max(absolute_errors)), 2),
            "per_distance": per_distance_metrics,
        },
        "legacy_single_scale": {
            "calibration_scale_cm": round(legacy_scale_cm, 6),
            "training_mae_cm": round(statistics.mean(legacy_errors), 2),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def estimate_distance_from_profile(eye_separation_normalized, profile):
    """Apply a validated v2 quadratic calibration profile."""
    separation = _finite_number(
        eye_separation_normalized,
        "eye_separation_normalized",
    )
    if not 0.01 <= separation <= 0.5:
        return None
    if profile.get("profile_version") != CALIBRATION_PROFILE_VERSION:
        raise ValueError("Only calibration profile version 2.0.0 is supported")
    if profile.get("model_type") != "inverse_eye_separation_polynomial":
        raise ValueError("Unsupported distance calibration model")

    coefficients = profile.get("coefficients") or {}
    quadratic = _finite_number(coefficients.get("quadratic"), "quadratic")
    linear = _finite_number(coefficients.get("linear"), "linear")
    intercept = _finite_number(coefficients.get("intercept"), "intercept")
    inverse_separation = 1.0 / separation
    distance = (
        quadratic * inverse_separation * inverse_separation
        + linear * inverse_separation
        + intercept
    )
    if not 10.0 <= distance <= 250.0:
        return None
    return round(distance, 1)
