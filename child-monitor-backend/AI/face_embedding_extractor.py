"""Extract exactly five FaceNet embeddings; no identity classification or SVM.

The caller selects the account/template. All frames must independently satisfy
quality checks. Distinct image bytes are checked by Node, not a liveness claim.
"""
import json
import sys
import traceback
from pathlib import Path
import numpy as np
from calibrate_face_verification import model_id
from facenet_runtime import create_embedding, DeepFace, MTCNN, cv2

BASE = Path(__file__).resolve().parent
PREFIX = 'SAFENEST_FACE_RESULT:'


def extract_frame(image_path, detector, facenet, policy):
    image = cv2.imread(str(image_path))
    if image is None or max(image.shape[:2]) > 4096:
        raise ValueError('invalid_image')
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    detected = detector.detect_faces(rgb)
    # Count BEFORE confidence filtering: a second low-confidence face is rejected.
    if len(detected) != 1:
        raise ValueError('exactly_one_face_required')
    face = detected[0]
    if float(face.get('confidence', 0)) < policy['detection_threshold']:
        raise ValueError('face_detection_confidence_low')
    x, y, w, h = face['box']
    if min(w, h) < policy['min_face_pixels'] or x < 0 or y < 0 or x+w > rgb.shape[1] or y+h > rgb.shape[0]:
        raise ValueError('face_too_small_or_cropped')
    embedding = create_embedding(rgb[y:y+h, x:x+w], facenet)
    if embedding.shape != (128,) or not np.isfinite(embedding).all():
        raise RuntimeError('invalid_embedding')
    return embedding.tolist()


def main():
    policy = json.loads((BASE / 'face_verification_policy.json').read_text(encoding='utf-8'))
    identifier = model_id()
    if identifier != policy['model_id']:
        raise RuntimeError('model_policy_mismatch')
    paths = [Path(value) for value in sys.argv[1:]]
    if len(paths) != 5:
        raise ValueError('invalid_frame_count')
    detector = MTCNN()
    facenet = DeepFace.build_model('Facenet')
    embeddings = [extract_frame(p, detector, facenet, policy) for p in paths]
    return dict(ok=True, embeddings=embeddings, model_id=identifier)


if __name__ == '__main__':
    try:
        result = main()
    except ValueError as error:
        result = dict(ok=False, reason=str(error))
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        result = dict(ok=False, reason='model_error')
    print(PREFIX + json.dumps(result, allow_nan=False), flush=True)
