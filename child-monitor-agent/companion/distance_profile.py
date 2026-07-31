"""Loading and compatibility checks for the frozen eye-distance profile."""

import hashlib
import json
import math
import platform
import re


PROFILE_FILENAME = "eye_distance_profile_v3.json"
# Frozen candidate that passed the independent final test on 2026-07-31.
EXPECTED_PROFILE_SHA256 = (
    "815fb3e281eb68d55fc45d513f215a53676519161c5a5cea20a5ea7feeb4b472"
)


def _finite_number(value, field):
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def _positive_integer(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def validate_distance_profile(profile):
    """Validate the runtime-critical subset of the v3 profile schema."""
    if not isinstance(profile, dict):
        raise ValueError("distance profile must be a JSON object")
    required_constants = {
        "profile_version": "3.0.0",
        "distance_standard_version": "1.0.0",
        "profile_scope": "subject_camera",
        "model_type": "monotonic_inverse_eye_separation_linear",
    }
    for field, expected in required_constants.items():
        if profile.get(field) != expected:
            raise ValueError(f"unsupported distance profile {field}")
    if profile.get("coefficient_order") != ["slope", "intercept"]:
        raise ValueError("unsupported distance profile coefficient_order")

    coefficients = profile.get("coefficients")
    if not isinstance(coefficients, dict):
        raise ValueError("distance profile coefficients are missing")
    slope = _finite_number(coefficients.get("slope"), "coefficients.slope")
    _finite_number(coefficients.get("intercept"), "coefficients.intercept")
    if slope <= 0:
        raise ValueError("coefficients.slope must be positive")

    feature_range = profile.get("feature_range")
    if not isinstance(feature_range, dict):
        raise ValueError("distance profile feature_range is missing")
    feature_min = _finite_number(
        feature_range.get("inverse_eye_separation_min"),
        "feature_range.inverse_eye_separation_min",
    )
    feature_max = _finite_number(
        feature_range.get("inverse_eye_separation_max"),
        "feature_range.inverse_eye_separation_max",
    )
    if feature_min <= 0 or feature_min >= feature_max:
        raise ValueError("distance profile feature_range is invalid")

    operating_range = profile.get("operating_distance_range_cm")
    if not isinstance(operating_range, dict):
        raise ValueError("distance profile operating range is missing")
    operating_min = _finite_number(
        operating_range.get("minimum"),
        "operating_distance_range_cm.minimum",
    )
    operating_max = _finite_number(
        operating_range.get("maximum"),
        "operating_distance_range_cm.maximum",
    )
    if not 20.0 <= operating_min < operating_max <= 200.0:
        raise ValueError("distance profile operating range is invalid")

    policy = profile.get("decision_policy")
    if not isinstance(policy, dict):
        raise ValueError("distance profile decision_policy is missing")
    threshold = _finite_number(policy.get("threshold_cm"), "policy.threshold_cm")
    warning_below = _finite_number(
        policy.get("warning_below_cm"),
        "policy.warning_below_cm",
    )
    safe_at_or_above = _finite_number(
        policy.get("safe_at_or_above_cm"),
        "policy.safe_at_or_above_cm",
    )
    if not 20.0 <= warning_below < threshold < safe_at_or_above <= 100.0:
        raise ValueError("distance profile three-zone policy is invalid")
    if policy.get("uncertain_action") != "continue_sampling":
        raise ValueError("unsupported distance profile uncertain_action")

    camera_id = profile.get("camera_id")
    if not isinstance(camera_id, str) or not re.fullmatch(
        r"camera-[A-Za-z0-9_-]{1,120}",
        camera_id,
    ):
        raise ValueError("distance profile camera_id is invalid")
    subject_id = profile.get("subject_id")
    if not isinstance(subject_id, str) or not re.fullmatch(
        r"subject-[A-Za-z0-9_-]+",
        subject_id,
    ):
        raise ValueError("distance profile subject_id is invalid")
    _positive_integer(profile.get("frame_width"), "frame_width")
    _positive_integer(profile.get("frame_height"), "frame_height")
    return profile


def load_distance_profile(path, expected_sha256=EXPECTED_PROFILE_SHA256):
    """Read, hash-check, decode, and validate a profile file."""
    with open(path, "rb") as stream:
        payload = stream.read()
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if expected_sha256 and actual_sha256.lower() != expected_sha256.lower():
        raise ValueError(
            "distance profile integrity check failed "
            f"(expected {expected_sha256}, got {actual_sha256})"
        )
    try:
        profile = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("distance profile is not valid UTF-8 JSON") from error
    validate_distance_profile(profile)
    return profile, actual_sha256


def camera_id(camera_index, frame_width, frame_height, hostname=None):
    """Reproduce the identifier used by calibration_ui.py."""
    node_name = platform.node() if hostname is None else str(hostname)
    source = (
        f"{node_name}|opencv-camera:{int(camera_index)}|"
        f"{int(frame_width)}x{int(frame_height)}"
    )
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]
    return f"camera-{digest}"


def assert_profile_compatible(
    profile,
    *,
    camera_index,
    frame_width,
    frame_height,
    threshold_cm,
    hostname=None,
):
    """Reject subject-camera profiles outside their calibrated runtime."""
    expected_camera_id = camera_id(
        camera_index,
        frame_width,
        frame_height,
        hostname=hostname,
    )
    mismatches = []
    if profile["camera_id"] != expected_camera_id:
        mismatches.append(
            f"camera_id profile={profile['camera_id']} runtime={expected_camera_id}"
        )
    if profile["frame_width"] != int(frame_width):
        mismatches.append(
            f"frame_width profile={profile['frame_width']} runtime={int(frame_width)}"
        )
    if profile["frame_height"] != int(frame_height):
        mismatches.append(
            f"frame_height profile={profile['frame_height']} runtime={int(frame_height)}"
        )
    profile_threshold = float(profile["decision_policy"]["threshold_cm"])
    if not math.isclose(
        profile_threshold,
        float(threshold_cm),
        rel_tol=0.0,
        abs_tol=0.05,
    ):
        mismatches.append(
            f"threshold_cm profile={profile_threshold} runtime={float(threshold_cm)}"
        )
    if mismatches:
        raise ValueError("distance profile/runtime mismatch: " + "; ".join(mismatches))
    return expected_camera_id
