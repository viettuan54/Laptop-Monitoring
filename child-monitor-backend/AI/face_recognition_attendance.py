"""SafeNest admin face classifier.

This process receives 1-3 local image paths, classifies each frame with the
bundled FaceNet + SVM artifacts, and writes one machine-readable result line.
It never accepts a role/label from the browser.
"""

import json
import math
import os
import pickle
import shutil
import sys
import tempfile
from pathlib import Path

# Configure DeepFace before importing TensorFlow/DeepFace so the bundled
# FaceNet weight is used instead of downloading a model at authentication time.
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "face_models_facenet"
RUNTIME_HOME = Path(os.environ.get(
    "FACE_MODEL_CACHE_DIR",
    str(Path(tempfile.gettempdir()) / "safenest-deepface"),
))
WEIGHTS_DIR = RUNTIME_HOME / ".deepface" / "weights"
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
os.environ["DEEPFACE_HOME"] = str(RUNTIME_HOME)
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

BUNDLED_WEIGHT = MODEL_DIR / "facenet_weights.h5"
CACHED_WEIGHT = WEIGHTS_DIR / "facenet_weights.h5"
if not CACHED_WEIGHT.exists() or CACHED_WEIGHT.stat().st_size != BUNDLED_WEIGHT.stat().st_size:
    shutil.copy2(BUNDLED_WEIGHT, CACHED_WEIGHT)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from deepface import DeepFace  # noqa: E402
from mtcnn import MTCNN  # noqa: E402

SVM_PATH = MODEL_DIR / "svm_facenet.pkl"
ENCODER_PATH = MODEL_DIR / "label_encoder_facenet.pkl"
EXPECTED_LABEL = "admin"
CLASSIFICATION_THRESHOLD = float(os.environ.get("FACE_CLASSIFICATION_THRESHOLD", "0.6"))
DETECTION_THRESHOLD = float(os.environ.get("FACE_DETECTION_THRESHOLD", "0.60"))
RESULT_PREFIX = "SAFENEST_FACE_RESULT:"
FACENET_INPUT_SIZE = (160, 160)


def emit(result):
    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}", flush=True)


def l2(vector):
    vector = np.asarray(vector, dtype=np.float32)
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError("Invalid face embedding")
    return vector / norm


def create_embedding(face, facenet):
    """Reproduce the preprocessing used to train the bundled SVM.

    btl_ndkm.py trained the classifier with 160x160 RGB crops that were
    standardized per image before being passed directly to FaceNet. Using
    DeepFace.represent with its default `base` normalization produces a
    different embedding space and makes valid admin faces look unknown.
    """
    resized = cv2.resize(face, FACENET_INPUT_SIZE)
    normalized = resized.astype(np.float32)
    mean = float(normalized.mean())
    std = float(normalized.std())
    normalized = (normalized - mean) / (std + 1e-6)
    batch = np.expand_dims(normalized, axis=0)
    embedding = np.asarray(facenet.forward(batch), dtype=np.float32).reshape(-1)
    return l2(embedding)


def classify_frame(image_path, detector, facenet, svm, encoder):
    image = cv2.imread(str(image_path))
    if image is None:
        return {"label": "fail", "confidence": 0.0, "faces_detected": 0}

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    detected = [
        item for item in detector.detect_faces(rgb)
        if float(item.get("confidence", 0.0)) >= DETECTION_THRESHOLD
    ]
    if len(detected) != 1:
        return {"label": "fail", "confidence": 0.0, "faces_detected": len(detected)}

    x, y, width, height = detected[0]["box"]
    x, y = max(0, x), max(0, y)
    face = rgb[y:y + max(0, height), x:x + max(0, width)]
    if face.size == 0:
        return {"label": "fail", "confidence": 0.0, "faces_detected": 1}

    embedding = create_embedding(face, facenet)
    probabilities = svm.predict_proba([embedding])[0]
    probability_index = int(np.argmax(probabilities))
    encoded_class = int(svm.classes_[probability_index])
    predicted = str(encoder.inverse_transform([encoded_class])[0]).strip().lower()
    confidence = float(probabilities[probability_index])

    return {
        "label": predicted if confidence >= CLASSIFICATION_THRESHOLD else "fail",
        "confidence": round(confidence, 6),
        "faces_detected": 1,
    }


def main():
    image_paths = [Path(value).resolve() for value in sys.argv[1:]]
    if not 1 <= len(image_paths) <= 3:
        emit({"label": "fail", "reason": "invalid_frame_count"})
        return 0
    if any(not path.is_file() for path in image_paths):
        emit({"label": "fail", "reason": "image_not_found"})
        return 0

    with SVM_PATH.open("rb") as svm_file:
        svm = pickle.load(svm_file)
    with ENCODER_PATH.open("rb") as encoder_file:
        encoder = pickle.load(encoder_file)

    detector = MTCNN()
    facenet = DeepFace.build_model("Facenet")
    frames = [
        classify_frame(path, detector, facenet, svm, encoder)
        for path in image_paths
    ]
    required_matches = max(1, math.ceil(len(frames) * 2 / 3))
    matching = [
        frame for frame in frames
        if frame["label"] == EXPECTED_LABEL
        and frame["confidence"] >= CLASSIFICATION_THRESHOLD
        and frame["faces_detected"] == 1
    ]
    accepted = len(matching) >= required_matches
    confidence = (
        sum(frame["confidence"] for frame in matching) / len(matching)
        if matching else 0.0
    )
    emit({
        "label": EXPECTED_LABEL if accepted else "fail",
        "confidence": round(confidence, 6),
        "matched_frames": len(matching),
        "required_frames": required_matches,
        "frames": frames,
    })
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Return a fail-closed protocol response.
        print(f"[FaceAuth] {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        emit({"label": "fail", "reason": "model_error"})
        raise SystemExit(0)
