"""Small, auditable posture classifier helpers for on-device inference.

The custom classifier consumes only normalized MediaPipe pose landmarks.  It
does not replace the geometry safety rules in ``vision_metrics``; callers must
fall back to those rules whenever the model is absent or inconclusive.
"""

import hashlib
import json
import math
from collections import deque


LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24

PRIMARY_CLASSES = (
    "good",
    "forward_head",
    "trunk_lean",
    "shoulder_tilt_left",
    "shoulder_tilt_right",
    "slouching",
)

CLASS_LABELS = {
    "good": [],
    "forward_head": ["forward_head"],
    "trunk_lean": ["trunk_lean"],
    "shoulder_tilt_left": ["shoulder_tilt_left"],
    "shoulder_tilt_right": ["shoulder_tilt_right"],
    "slouching": ["forward_head", "trunk_lean", "slouching"],
}

FRAME_FEATURE_NAMES = (
    "neck_dx",
    "neck_dy",
    "neck_dz",
    "torso_dx",
    "torso_dy",
    "torso_dz",
    "shoulder_dy",
    "shoulder_dz",
    "hip_dy",
    "ear_dy",
    "left_ear_shoulder_distance",
    "right_ear_shoulder_distance",
    "torso_length",
    "hip_width_ratio",
)


def _finite(value, default=None):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _value(point, name, default=None):
    if isinstance(point, dict):
        return _finite(point.get(name), default)
    return _finite(getattr(point, name, None), default)


def _point(point, width, height):
    x = _value(point, "x")
    y = _value(point, "y")
    z = _value(point, "z")
    if x is None or y is None or z is None:
        return None
    return (x * width, y * height, z * width)


def _visibility(point):
    return _value(point, "visibility", 1.0)


def _midpoint(first, second):
    return tuple((a + b) / 2.0 for a, b in zip(first, second))


def _distance(first, second):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(first, second)))


def extract_posture_features(
    pose_landmarks,
    image_width=640,
    image_height=480,
    *,
    min_visibility=0.55,
):
    """Return a translation/scale-normalized feature vector or ``None``.

    A full upper body, including both hips, is required.  This makes every
    static record observable for all supported posture labels and prevents a
    missing hip from silently becoming a negative ``trunk_lean`` label.
    """
    if not pose_landmarks or len(pose_landmarks) <= RIGHT_HIP:
        return None
    width = _finite(image_width)
    height = _finite(image_height)
    if width is None or height is None or width <= 0 or height <= 0:
        return None

    indices = (
        LEFT_EAR,
        RIGHT_EAR,
        LEFT_SHOULDER,
        RIGHT_SHOULDER,
        LEFT_HIP,
        RIGHT_HIP,
    )
    if any((_visibility(pose_landmarks[index]) or 0.0) < min_visibility for index in indices):
        return None

    points = {
        index: _point(pose_landmarks[index], width, height)
        for index in indices
    }
    if any(point is None for point in points.values()):
        return None

    left_ear = points[LEFT_EAR]
    right_ear = points[RIGHT_EAR]
    left_shoulder = points[LEFT_SHOULDER]
    right_shoulder = points[RIGHT_SHOULDER]
    left_hip = points[LEFT_HIP]
    right_hip = points[RIGHT_HIP]
    ears = _midpoint(left_ear, right_ear)
    shoulders = _midpoint(left_shoulder, right_shoulder)
    hips = _midpoint(left_hip, right_hip)

    shoulder_width = _distance(left_shoulder, right_shoulder)
    if shoulder_width < 2.0:
        return None

    def normalized_delta(upper, lower):
        return tuple((a - b) / shoulder_width for a, b in zip(upper, lower))

    neck = normalized_delta(ears, shoulders)
    torso = normalized_delta(shoulders, hips)
    shoulder_line = normalized_delta(right_shoulder, left_shoulder)
    hip_line = normalized_delta(right_hip, left_hip)
    ear_line = normalized_delta(right_ear, left_ear)

    values = (
        neck[0],
        neck[1],
        neck[2],
        torso[0],
        torso[1],
        torso[2],
        shoulder_line[1],
        shoulder_line[2],
        hip_line[1],
        ear_line[1],
        _distance(left_ear, left_shoulder) / shoulder_width,
        _distance(right_ear, right_shoulder) / shoulder_width,
        _distance(shoulders, hips) / shoulder_width,
        _distance(left_hip, right_hip) / shoulder_width,
    )
    if any(not math.isfinite(value) for value in values):
        return None
    return [round(value, 8) for value in values]


def window_feature_names():
    return tuple(
        [f"mean:{name}" for name in FRAME_FEATURE_NAMES]
        + [f"std:{name}" for name in FRAME_FEATURE_NAMES]
    )


def aggregate_feature_window(vectors):
    if not vectors:
        return None
    width = len(FRAME_FEATURE_NAMES)
    if any(len(vector) != width for vector in vectors):
        raise ValueError("posture feature vector width is invalid")
    means = [sum(vector[index] for vector in vectors) / len(vectors) for index in range(width)]
    variances = [
        sum((vector[index] - means[index]) ** 2 for vector in vectors) / len(vectors)
        for index in range(width)
    ]
    return means + [math.sqrt(max(0.0, value)) for value in variances]


def validate_posture_model(model):
    if not isinstance(model, dict):
        raise ValueError("posture model must be an object")
    if model.get("model_version") != "1.0.0":
        raise ValueError("unsupported posture model version")
    if model.get("model_type") != "nearest_centroid_window":
        raise ValueError("unsupported posture model type")
    if tuple(model.get("frame_feature_names") or ()) != FRAME_FEATURE_NAMES:
        raise ValueError("posture model frame features are incompatible")
    if tuple(model.get("window_feature_names") or ()) != window_feature_names():
        raise ValueError("posture model window features are incompatible")
    if tuple(model.get("classes") or ()) != PRIMARY_CLASSES:
        raise ValueError("posture model classes are incompatible")

    window_size = model.get("window_size")
    if isinstance(window_size, bool) or not isinstance(window_size, int) or not 3 <= window_size <= 60:
        raise ValueError("posture model window_size is invalid")
    sample_interval = _finite(model.get("sample_interval_seconds"))
    if sample_interval is None or not 0.2 <= sample_interval <= 5.0:
        raise ValueError("posture model sample_interval_seconds is invalid")
    minimum_confidence = _finite(model.get("minimum_confidence"))
    temperature = _finite(model.get("temperature"))
    if minimum_confidence is None or not 0.5 <= minimum_confidence <= 0.99:
        raise ValueError("posture model minimum_confidence is invalid")
    if temperature is None or not 1e-6 <= temperature <= 1e6:
        raise ValueError("posture model temperature is invalid")

    vector_size = len(window_feature_names())
    for field in ("scaler_mean", "scaler_scale", "reference_good_frame"):
        values = model.get(field)
        expected = len(FRAME_FEATURE_NAMES) if field == "reference_good_frame" else vector_size
        if not isinstance(values, list) or len(values) != expected:
            raise ValueError(f"posture model {field} has invalid size")
        parsed = [_finite(value) for value in values]
        if any(value is None for value in parsed):
            raise ValueError(f"posture model {field} contains invalid values")
        if field == "scaler_scale" and any(value <= 0 for value in parsed):
            raise ValueError("posture model scaler_scale must be positive")

    centroids = model.get("centroids")
    if not isinstance(centroids, dict) or set(centroids) != set(PRIMARY_CLASSES):
        raise ValueError("posture model centroids are incomplete")
    for class_name, centroid in centroids.items():
        if not isinstance(centroid, list) or len(centroid) != vector_size:
            raise ValueError(f"posture centroid {class_name} has invalid size")
        if any(_finite(value) is None for value in centroid):
            raise ValueError(f"posture centroid {class_name} contains invalid values")
    return model


def validate_posture_profile(profile):
    if not isinstance(profile, dict) or profile.get("profile_version") != "1.0.0":
        raise ValueError("unsupported posture profile")
    if profile.get("profile_scope") != "subject_camera":
        raise ValueError("unsupported posture profile scope")
    if tuple(profile.get("frame_feature_names") or ()) != FRAME_FEATURE_NAMES:
        raise ValueError("posture profile frame features are incompatible")
    baseline = profile.get("baseline_frame_features")
    if not isinstance(baseline, list) or len(baseline) != len(FRAME_FEATURE_NAMES):
        raise ValueError("posture profile baseline has invalid size")
    if any(_finite(value) is None for value in baseline):
        raise ValueError("posture profile baseline contains invalid values")
    for field in ("subject_id", "camera_id"):
        if not isinstance(profile.get(field), str) or not profile[field]:
            raise ValueError(f"posture profile {field} is invalid")
    for field in ("frame_width", "frame_height", "sample_count"):
        value = profile.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"posture profile {field} is invalid")
    return profile


def load_json_asset(path, validator, maximum_bytes=1024 * 1024):
    with open(path, "rb") as stream:
        payload = stream.read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError("posture asset is too large")
    hash_path = f"{path}.sha256"
    try:
        with open(hash_path, "r", encoding="ascii") as stream:
            expected_hash = stream.read().strip().lower()
    except FileNotFoundError:
        expected_hash = None
    if expected_hash:
        if len(expected_hash) != 64 or any(
            character not in "0123456789abcdef" for character in expected_hash
        ):
            raise ValueError("posture asset hash sidecar is invalid")
        actual_hash = hashlib.sha256(payload).hexdigest()
        if actual_hash != expected_hash:
            raise ValueError("posture asset integrity check failed")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("posture asset is not valid UTF-8 JSON") from error
    return validator(value)


class PostureBaselineClassifier:
    """Windowed nearest-centroid inference with optional personal baseline."""

    def __init__(self, model, profile=None):
        self.model = validate_posture_model(model)
        self.profile = validate_posture_profile(profile) if profile else None
        self.window = deque(maxlen=model["window_size"])

    def reset(self):
        self.window.clear()

    def _personalize(self, vector):
        if not self.profile:
            return vector
        baseline = self.profile["baseline_frame_features"]
        reference = self.model["reference_good_frame"]
        return [
            value - baseline[index] + reference[index]
            for index, value in enumerate(vector)
        ]

    def observe(self, pose_landmarks, image_width, image_height):
        vector = extract_posture_features(
            pose_landmarks,
            image_width,
            image_height,
        )
        if vector is None:
            return None
        self.window.append(self._personalize(vector))
        if len(self.window) < self.window.maxlen:
            return None

        aggregated = aggregate_feature_window(list(self.window))
        standardized = [
            (value - self.model["scaler_mean"][index])
            / self.model["scaler_scale"][index]
            for index, value in enumerate(aggregated)
        ]
        distances = {}
        for class_name in PRIMARY_CLASSES:
            centroid = self.model["centroids"][class_name]
            distances[class_name] = sum(
                (value - centroid[index]) ** 2
                for index, value in enumerate(standardized)
            )
        minimum_distance = min(distances.values())
        temperature = self.model["temperature"]
        scores = {
            name: math.exp(-min(60.0, (distance - minimum_distance) / temperature))
            for name, distance in distances.items()
        }
        score_sum = sum(scores.values())
        probabilities = {name: score / score_sum for name, score in scores.items()}
        predicted = max(probabilities, key=probabilities.get)
        confidence = probabilities[predicted]
        return {
            "predicted_class": predicted,
            "posture_labels": CLASS_LABELS[predicted].copy(),
            "is_bad": predicted != "good",
            "confidence": round(confidence, 4),
            "minimum_confidence": self.model["minimum_confidence"],
            "conclusive": confidence >= self.model["minimum_confidence"],
            "model_version": self.model["model_version"],
            "profile_subject_id": self.profile.get("subject_id") if self.profile else None,
        }
