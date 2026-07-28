"""Ground-truth distance normalization and camera calibration helpers."""

import math
import statistics
from datetime import datetime, timezone


DISTANCE_STANDARD_VERSION = "1.0.0"
CALIBRATION_PROFILE_VERSION = "1.0.0"
TARGET_DISTANCES_CM = (25.0, 30.0, 35.0, 40.0, 50.0, 60.0, 80.0)
MEASUREMENT_METHODS = frozenset({"tape_measure", "laser_measure"})
MEASUREMENT_REFERENCE = "camera_lens_center_to_eye_midpoint"


def _finite_number(value, field):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


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
    if not isinstance(camera_id, str) or len(camera_id) < 8:
        raise ValueError("camera_id must contain at least 8 characters")
    if not isinstance(subject_id, str) or not subject_id.startswith("subject-"):
        raise ValueError("subject_id must start with 'subject-'")

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

    scales = [distance * separation for distance, separation in normalized_samples]
    calibration_scale_cm = statistics.median(scales)
    errors = [
        abs((calibration_scale_cm / separation) - distance)
        for distance, separation in normalized_samples
    ]

    return {
        "profile_version": CALIBRATION_PROFILE_VERSION,
        "distance_standard_version": DISTANCE_STANDARD_VERSION,
        "profile_scope": "subject_camera",
        "camera_id": camera_id,
        "subject_id": subject_id,
        "frame_width": width,
        "frame_height": height,
        "calibration_scale_cm": round(calibration_scale_cm, 6),
        "sample_count": len(normalized_samples),
        "calibration_distances_cm": sorted(distinct_distances),
        "training_mae_cm": round(statistics.mean(errors), 2),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
