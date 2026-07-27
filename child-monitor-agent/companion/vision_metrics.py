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


def estimate_eye_distance_cm(
    face_landmarks,
    image_width,
    *,
    horizontal_fov_degrees=60.0,
    assumed_ipd_cm=6.3,
):
    """Estimate camera-to-eye distance with a pinhole-camera approximation.

    This is an estimate, not a medical measurement. Accuracy depends mainly on
    the camera horizontal field of view and the user's actual interpupillary
    distance (IPD), both of which are configurable.
    """
    if not face_landmarks or len(face_landmarks) <= max(LEFT_EYE_CORNERS):
        return None

    width = _number(image_width)
    fov = _number(horizontal_fov_degrees)
    ipd = _number(assumed_ipd_cm)
    if width <= 0 or not 20.0 <= fov <= 140.0 or not 4.0 <= ipd <= 8.5:
        return None

    right_eye = _midpoint(
        face_landmarks[RIGHT_EYE_CORNERS[0]],
        face_landmarks[RIGHT_EYE_CORNERS[1]],
    )
    left_eye = _midpoint(
        face_landmarks[LEFT_EYE_CORNERS[0]],
        face_landmarks[LEFT_EYE_CORNERS[1]],
    )
    eye_separation_px = abs(left_eye[0] - right_eye[0]) * width
    if eye_separation_px < 2.0:
        return None

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
    min_visibility=0.55,
    max_neck_angle_degrees=25.0,
    max_torso_angle_degrees=18.0,
    max_shoulder_tilt_degrees=12.0,
):
    """Calculate upper-body posture angles from MediaPipe pose landmarks."""
    required = (LEFT_EAR, RIGHT_EAR, LEFT_SHOULDER, RIGHT_SHOULDER)
    if not pose_landmarks or len(pose_landmarks) <= max(required):
        return {"reliable": False, "is_bad": False, "reasons": []}
    if any(_visibility(pose_landmarks[index]) < min_visibility for index in required):
        return {"reliable": False, "is_bad": False, "reasons": []}

    shoulder_left = pose_landmarks[LEFT_SHOULDER]
    shoulder_right = pose_landmarks[RIGHT_SHOULDER]
    shoulder_dx = (
        _coordinate(shoulder_right, "x") - _coordinate(shoulder_left, "x")
    ) * _number(image_width, 640.0)
    shoulder_dy = (
        _coordinate(shoulder_right, "y") - _coordinate(shoulder_left, "y")
    ) * _number(image_height, 480.0)
    shoulder_tilt = math.degrees(math.atan2(abs(shoulder_dy), max(abs(shoulder_dx), 1e-9)))

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

    return {
        "reliable": neck_angle is not None,
        "is_bad": bool(reasons),
        "neck_angle_degrees": round(neck_angle, 1) if neck_angle is not None else None,
        "torso_angle_degrees": round(torso_angle, 1) if torso_angle is not None else None,
        "shoulder_tilt_degrees": round(shoulder_tilt, 1),
        "reasons": reasons,
    }
