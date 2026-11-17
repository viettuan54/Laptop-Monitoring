"""Pinned FaceNet extraction pipeline, independent of the legacy SVM classifier."""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import numpy as np

BASE = Path(__file__).resolve().parent
RUNTIME_HOME = Path(os.environ.get('FACE_MODEL_CACHE_DIR', str(Path(tempfile.gettempdir()) / 'safenest-deepface')))
WEIGHTS_DIR = RUNTIME_HOME / '.deepface' / 'weights'
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
os.environ['DEEPFACE_HOME'] = str(RUNTIME_HOME)
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
bundled = BASE / 'face_models_facenet/facenet_weights.h5'
cached = WEIGHTS_DIR / 'facenet_weights.h5'
if not cached.exists() or hashlib.sha256(cached.read_bytes()).digest() != hashlib.sha256(bundled.read_bytes()).digest():
    shutil.copy2(bundled, cached)

import cv2  # noqa: E402
from deepface import DeepFace  # noqa: E402
from mtcnn import MTCNN  # noqa: E402


def create_embedding(face, facenet):
    resized = cv2.resize(face, (160, 160)).astype(np.float32)
    normalized = (resized - float(resized.mean())) / (float(resized.std()) + 1e-6)
    embedding = np.asarray(facenet.forward(np.expand_dims(normalized, axis=0)), dtype=np.float32).reshape(-1)
    norm = np.linalg.norm(embedding)
    if not np.isfinite(norm) or norm <= 0:
        raise RuntimeError('invalid_embedding')
    return embedding / norm
