"""Pure geometry helpers for on-device eye-distance and posture analysis.

The functions in this module intentionally do not import MediaPipe or OpenCV so
they can be unit tested without a camera or native ML runtime.
"""

import math


# MediaPipe Face Landmarker indices. Eye centres are approximated from the
# inner/outer eye corners so the calculation also works when iris landmarks are
# unavailable.
RIGHT_EYE_CORNERS = (33, 133)
LEFT_EYE_CORNERS = (362, 263)

# MediaPipe Pose Landmarker indices.
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24
NOSE_TIP = 1

DEFAULT_MIN_POSTURE_VISIBILITY = 0.55
DEFAULT_MAX_NECK_ANGLE_DEGREES = 25.0
DEFAULT_MAX_TORSO_ANGLE_DEGREES = 18.0
DEFAULT_MAX_SHOULDER_TILT_DEGREES = 12.0

# These limits are intentionally identical to ai-training's calibration
# measurement standard. A profile prediction is only valid when runtime
# landmarks satisfy the same geometry constraints as its training samples.
CALIBRATED_MAX_HEAD_YAW_RATIO = 0.12
CALIBRATED_MAX_CENTER_OFFSET_X = 0.10
CALIBRATED_MAX_CENTER_OFFSET_Y = 0.10
CALIBRATED_MAX_EYE_ROLL_DEGREES = 8.0
CALIBRATED_MIN_HEAD_PITCH_RATIO = 0.12
CALIBRATED_MAX_HEAD_PITCH_RATIO = 0.65


def _number(value, default=0.0):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _coordinate(point, name):
    if isinstance(point, dict):
        return _number(point.get(name))
    return _number(getattr(point, name, 0.0))


def _visibility(point):
    if isinstance(point, dict):
        value = point.get("visibility", 1.0)
    else:
        value = getattr(point, "visibility", 1.0)
    return _number(value, 1.0)


def _midpoint(first, second):
    return (
        (_coordinate(first, "x") + _coordinate(second, "x")) / 2.0,
        (_coordinate(first, "y") + _coordinate(second, "y")) / 2.0,
        (_coordinate(first, "z") + _coordinate(second, "z")) / 2.0,
    )


def _distance_2d(first, second):
    return math.hypot(first[0] - second[0], first[1] - second[1])


def _angle_from_vertical(lower, upper):
    """Return the 3D angle between lower→upper and the upward Y axis."""
    dx = upper[0] - lower[0]
    dy = upper[1] - lower[1]
    dz = upper[2] - lower[2]
    magnitude = math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
    if magnitude <= 1e-9:
        return None
    cosine = max(-1.0, min(1.0, (-dy) / magnitude))
    return math.degrees(math.acos(cosine))


def _posture_labels(reasons, shoulder_tilt_direction):
    """Map geometry-rule output to the shared ai-training taxonomy."""
    labels = []
    if "neck" in reasons:
        labels.append("forward_head")
    if "torso" in reasons:
        labels.append("trunk_lean")
    if "shoulders" in reasons:
        if shoulder_tilt_direction == "left_shoulder_lower":
            labels.append("shoulder_tilt_left")
        elif shoulder_tilt_direction == "right_shoulder_lower":
            labels.append("shoulder_tilt_right")
    if "forward_head" in labels and "trunk_lean" in labels:
        labels.append("slouching")
    return labels


def _calibrated_eye_measurement(face_landmarks, image_width, image_height):
    if not face_landmarks or len(face_landmarks) <= max(LEFT_EYE_CORNERS):
        return {"valid": False, "rejection_reason": "face_not_detected"}

    width = _number(image_width)
    height = _number(image_height)
    if width <= 0 or height <= 0:
        return {"valid": False, "rejection_reason": "frame_dimensions_invalid"}

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
        return {"valid": False, "rejection_reason": "eye_geometry_invalid"}

    nose_x = _coordinate(face_landmarks[NOSE_TIP], "x")
    nose_y = _coordinate(face_landmarks[NOSE_TIP], "y")
    yaw_ratio = abs(nose_x - eye_midpoint[0]) / separation
    center_offset_x = abs(eye_midpoint[0] - 0.5)
    center_offset_y = abs(eye_midpoint[1] - 0.5)
    eye_dx = left_eye[0] - right_eye[0]
    eye_dy = (left_eye[1] - right_eye[1]) * (height / width)
    eye_roll_degrees = math.degrees(
        math.atan2(eye_dy, max(abs(eye_dx), 1e-9))
    )
    head_pitch_ratio = (
        (nose_y - eye_midpoint[1]) * (height / width)
    ) / separation

    checks = (
        (yaw_ratio > CALIBRATED_MAX_HEAD_YAW_RATIO, "head_yaw"),
        (center_offset_x > CALIBRATED_MAX_CENTER_OFFSET_X, "off_center_x"),
        (center_offset_y > CALIBRATED_MAX_CENTER_OFFSET_Y, "off_center_y"),
        (
            abs(eye_roll_degrees) > CALIBRATED_MAX_EYE_ROLL_DEGREES,
            "head_roll",
        ),
        (
            not CALIBRATED_MIN_HEAD_PITCH_RATIO
            <= head_pitch_ratio
            <= CALIBRATED_MAX_HEAD_PITCH_RATIO,
            "head_pitch",
        ),
    )
    for rejected, reason in checks:
        if rejected:
            return {"valid": False, "rejection_reason": reason}

    return {
        "valid": True,
        "rejection_reason": None,
        "eye_separation_normalized": round(separation, 8),
        "head_yaw_ratio": round(yaw_ratio, 4),
        "head_pitch_ratio": round(head_pitch_ratio, 4),
        "eye_roll_degrees": round(eye_roll_degrees, 2),
    }


def classify_eye_distance_zone(distance_cm, decision_policy):
    """Apply the frozen warning/uncertain/safe boundary semantics."""
    distance = _number(distance_cm, -1.0)
    if distance < 0 or not isinstance(decision_policy, dict):
        return "unknown"
    threshold = _number(decision_policy.get("threshold_cm"), -1.0)
    warning_below = _number(decision_policy.get("warning_below_cm"), -1.0)
    safe_at_or_above = _number(
        decision_policy.get("safe_at_or_above_cm"),
        -1.0,
    )
    if not 0 < warning_below < threshold < safe_at_or_above:
        return "unknown"
    if distance < warning_below:
        return "warning"
    if distance < safe_at_or_above:
        return "uncertain"
    return "safe"


def analyze_calibrated_eye_distance(
    face_landmarks,
    image_width,
    image_height,
    profile,
):
    """Estimate distance with a validated v3 profile and classify its zone."""
    measurement = _calibrated_eye_measurement(
        face_landmarks,
        image_width,
        image_height,
    )
    base_result = {
        "reliable": False,
        "estimated_distance_cm": None,
        "estimation_method": "calibration_profile_v3",
        "profile_version": profile.get("profile_version"),
        "decision_zone": "unknown",
        "outside_feature_range": None,
        "rejection_reason": measurement["rejection_reason"],
    }
    if not measurement["valid"]:
        return base_result

    separation = measurement["eye_separation_normalized"]
    inverse_separation = 1.0 / separation
    coefficients = profile["coefficients"]
    distance_cm = (
        _number(coefficients["slope"]) * inverse_separation
        + _number(coefficients["intercept"])
    )
    if not 10.0 <= distance_cm <= 250.0:
        base_result["rejection_reason"] = "distance_out_of_bounds"
        return base_result

    distance_cm = round(distance_cm, 1)
    feature_range = profile["feature_range"]
    feature_min = _number(feature_range["inverse_eye_separation_min"])
    feature_max = _number(feature_range["inverse_eye_separation_max"])
    base_result.update(
        {
            "reliable": True,
            "estimated_distance_cm": distance_cm,
            "decision_zone": classify_eye_distance_zone(
                distance_cm,
                profile["decision_policy"],
            ),
            "outside_feature_range": not (
                feature_min <= inverse_separation <= feature_max
            ),
            "rejection_reason": None,
            "eye_separation_normalized": separation,
        }
    )
    return base_result


def estimate_eye_distance_cm(
    face_landmarks,
    image_width,
    *,
    image_height=None,
    horizontal_fov_degrees=60.0,
    assumed_ipd_cm=6.3,
    calibration_scale_cm=0.0,
    max_head_yaw_ratio=0.45,
):
    """Estimate camera-to-eye distance with a pinhole-camera approximation.

    This is an estimate, not a medical measurement. Accuracy depends mainly on
    the camera horizontal field of view and the user's actual interpupillary
    distance (IPD), both of which are configurable.
    """
    if not face_landmarks or len(face_landmarks) <= max(LEFT_EYE_CORNERS):
        return None

    width = _number(image_width)
    height = _number(image_height, width)
    fov = _number(horizontal_fov_degrees)
    ipd = _number(assumed_ipd_cm)
    if (
        width <= 0
        or height <= 0
        or not 20.0 <= fov <= 140.0
        or not 4.0 <= ipd <= 8.5
    ):
        return None

    right_eye = _midpoint(
        face_landmarks[RIGHT_EYE_CORNERS[0]],
        face_landmarks[RIGHT_EYE_CORNERS[1]],
    )
    left_eye = _midpoint(
        face_landmarks[LEFT_EYE_CORNERS[0]],
        face_landmarks[LEFT_EYE_CORNERS[1]],
    )
    eye_separation_px = math.hypot(
        (left_eye[0] - right_eye[0]) * width,
        (left_eye[1] - right_eye[1]) * height,
    )
    if eye_separation_px < 2.0:
        return None

    # Reject strong head yaw: perspective foreshortening makes the pinhole
    # distance unreliable when the nose moves too far from the eye midpoint.
    nose_x_px = _coordinate(face_landmarks[NOSE_TIP], "x") * width
    eye_midpoint_x_px = ((left_eye[0] + right_eye[0]) / 2.0) * width
    yaw_ratio = abs(nose_x_px - eye_midpoint_x_px) / eye_separation_px
    if yaw_ratio > _number(max_head_yaw_ratio, 0.45):
        return None

    eye_separation_normalized = eye_separation_px / width
    calibrated_scale = _number(calibration_scale_cm)
    if 1.0 <= calibrated_scale <= 20.0:
        distance_cm = calibrated_scale / eye_separation_normalized
    else:
        focal_length_px = width / (2.0 * math.tan(math.radians(fov) / 2.0))
        distance_cm = (focal_length_px * ipd) / eye_separation_px
    if not 10.0 <= distance_cm <= 250.0:
        return None
    return round(distance_cm, 1)


def analyze_posture(
    pose_landmarks,
    pose_world_landmarks=None,
    *,
    image_width=640,
    image_height=480,
    min_visibility=DEFAULT_MIN_POSTURE_VISIBILITY,
    max_neck_angle_degrees=DEFAULT_MAX_NECK_ANGLE_DEGREES,
    max_torso_angle_degrees=DEFAULT_MAX_TORSO_ANGLE_DEGREES,
    max_shoulder_tilt_degrees=DEFAULT_MAX_SHOULDER_TILT_DEGREES,
):
    """Calculate upper-body posture angles from MediaPipe pose landmarks."""
    required = (LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER)
    if not pose_landmarks or len(pose_landmarks) <= max(required):
        return {
            "reliable": False,
            "visibility_state": "not_visible",
            "confidence": 0.0,
            "is_bad": False,
            "reasons": [],
            "posture_labels": [],
            "posture_state": "unknown",
        }

    required_visibilities = [_visibility(pose_landmarks[index]) for index in required]
    if any(value < min_visibility for value in required_visibilities):
        return {
            "reliable": False,
            "visibility_state": "partially_visible",
            "confidence": round(min(required_visibilities), 2),
            "is_bad": False,
            "reasons": [],
            "posture_labels": [],
            "posture_state": "unknown",
        }

    shoulder_left = pose_landmarks[LEFT_SHOULDER]
    shoulder_right = pose_landmarks[RIGHT_SHOULDER]
    shoulder_dx = (
        _coordinate(shoulder_right, "x") - _coordinate(shoulder_left, "x")
    ) * _number(image_width, 640.0)
    shoulder_dy = (
        _coordinate(shoulder_right, "y") - _coordinate(shoulder_left, "y")
    ) * _number(image_height, 480.0)
    shoulder_tilt_signed = math.degrees(
        math.atan2(shoulder_dy, max(abs(shoulder_dx), 1e-9))
    )
    shoulder_tilt = abs(shoulder_tilt_signed)

    geometry_landmarks = pose_world_landmarks or pose_landmarks
    has_hips = (
        len(geometry_landmarks) > RIGHT_HIP
        and len(pose_landmarks) > RIGHT_HIP
        and _visibility(pose_landmarks[LEFT_HIP]) >= min_visibility
        and _visibility(pose_landmarks[RIGHT_HIP]) >= min_visibility
    )

    ears = _midpoint(
        geometry_landmarks[LEFT_EAR],
        geometry_landmarks[RIGHT_EAR],
    )
    shoulders = _midpoint(
        geometry_landmarks[LEFT_SHOULDER],
        geometry_landmarks[RIGHT_SHOULDER],
    )
    neck_angle = _angle_from_vertical(shoulders, ears)

    torso_angle = None
    if has_hips:
        hips = _midpoint(
            geometry_landmarks[LEFT_HIP],
            geometry_landmarks[RIGHT_HIP],
        )
        torso_angle = _angle_from_vertical(hips, shoulders)

    reasons = []
    if neck_angle is not None and neck_angle > max_neck_angle_degrees:
        reasons.append("neck")
    if torso_angle is not None and torso_angle > max_torso_angle_degrees:
        reasons.append("torso")
    if shoulder_tilt > max_shoulder_tilt_degrees:
        reasons.append("shoulders")

    quality_visibilities = list(required_visibilities)
    if has_hips:
        quality_visibilities.extend(
            [_visibility(pose_landmarks[LEFT_HIP]), _visibility(pose_landmarks[RIGHT_HIP])]
        )
    shoulder_tilt_direction = None
    if shoulder_tilt > max_shoulder_tilt_degrees:
        shoulder_tilt_direction = (
            "right_shoulder_lower" if shoulder_tilt_signed > 0 else "left_shoulder_lower"
        )
    posture_labels = _posture_labels(reasons, shoulder_tilt_direction)

    return {
        "reliable": neck_angle is not None,
        "visibility_state": "visible",
        "confidence": round(min(quality_visibilities), 2),
        "is_bad": bool(reasons),
        "posture_labels": posture_labels,
        "posture_state": "bad" if posture_labels else "good",
        "neck_angle_degrees": round(neck_angle, 1) if neck_angle is not None else None,
        "torso_angle_degrees": round(torso_angle, 1) if torso_angle is not None else None,
        "shoulder_tilt_degrees": round(shoulder_tilt, 1),
        "shoulder_tilt_signed_degrees": round(shoulder_tilt_signed, 1),
        "shoulder_tilt_direction": shoulder_tilt_direction,
        "reasons": reasons,
    }
