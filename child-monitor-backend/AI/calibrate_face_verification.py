"""Reproducible offline cosine calibration. No SVM probabilities are used.

Identity-stratified image split, NOT independent webcam sessions. Holdout results
are descriptive and must not be interpreted as a production false-accept bound.
"""
import hashlib
import json
from pathlib import Path
import numpy as np

BASE = Path(__file__).resolve().parent
PIPELINE = 'facenet128-rgb160-per-image-standardization-l2-v1'


def model_id():
    return PIPELINE + ':' + hashlib.sha256((BASE / 'face_models_facenet/facenet_weights.h5').read_bytes()).hexdigest()


def scores(x, y, rng):
    genuine, impostor, consistency = [], [], []
    for label in np.unique(y):
        indices = np.flatnonzero(y == label)
        for _ in range(100):
            enrollment = rng.choice(indices, 3, replace=False)
            template = x[enrollment].mean(axis=0)
            template /= np.linalg.norm(template)
            probes = np.setdiff1d(indices, enrollment)
            genuine.extend((x[probes] @ template).tolist())
            impostor.extend((x[y != label] @ template).tolist())
            consistency.extend((x[enrollment] @ x[enrollment].T)[np.triu_indices(3, 1)].tolist())
    return np.array(genuine), np.array(impostor), np.array(consistency)


def metrics(genuine, impostor, threshold):
    return dict(genuine_comparisons=len(genuine), impostor_comparisons=len(impostor),
                false_accepts=int(np.sum(impostor >= threshold)),
                false_reject_rate=float(np.mean(genuine < threshold)),
                max_impostor=float(np.max(impostor)), min_genuine=float(np.min(genuine)))


def batch_metrics(x, y, threshold, rng):
    results = {}
    def consistent(frames):
        return bool(np.all((frames @ frames.T)[np.triu_indices(3, 1)] >= threshold))
    for label in np.unique(y):
        own = np.flatnonzero(y == label)
        rejected_enrollments = rejected_genuine = accepted_enrollments = false_accepts = impostor_batches = 0
        for _ in range(100):
            selected = rng.choice(own, 6, replace=False)
            enroll, probe = x[selected[:3]], x[selected[3:]]
            if not consistent(enroll):
                rejected_enrollments += 1
                continue
            accepted_enrollments += 1
            template = enroll.mean(axis=0); template /= np.linalg.norm(template)
            if not consistent(probe) or not np.all(probe @ template >= threshold): rejected_genuine += 1
            for other in np.unique(y[y != label]):
                foreign = x[rng.choice(np.flatnonzero(y == other), 3, replace=False)]
                impostor_batches += 1
                if consistent(foreign) and np.all(foreign @ template >= threshold): false_accepts += 1
        results[str(label)] = dict(enrollment_trials=100, rejected_enrollments=rejected_enrollments,
                                  accepted_enrollments=accepted_enrollments, rejected_genuine_batches=rejected_genuine,
                                  impostor_batches=impostor_batches, false_accepts=false_accepts)
    return results


def main():
    dataset = BASE / 'face_models_facenet/faces_embeddings_facenet.npz'
    data = np.load(dataset, allow_pickle=False)
    x = data['embeddings'].astype(np.float64)
    y = data['labels']
    assert x.shape[1] == 128 and np.isfinite(x).all()
    x /= np.linalg.norm(x, axis=1, keepdims=True)
    rng = np.random.default_rng(20261117)
    calibration, holdout = [], []
    for label in np.unique(y):
        indices = rng.permutation(np.flatnonzero(y == label))
        split = max(4, int(len(indices) * .6))
        calibration.extend(indices[:split]); holdout.extend(indices[split:])
    g, i, consistency = scores(x[calibration], y[calibration], rng)
    # Zero observed calibration false accepts plus a conservative cosine margin.
    threshold = float(np.ceil((i.max() + .02) * 1000) / 1000)
    assert 0 < threshold < 1
    enrollment_threshold = threshold  # all three pairwise scores must pass too
    hg, hi, hc = scores(x[holdout], y[holdout], rng)
    policy = dict(version=1, metric='cosine', model_id=model_id(),
                  threshold=threshold, enrollment_threshold=enrollment_threshold,
                  detection_threshold=.98, min_face_pixels=80,
                  dataset_sha256=hashlib.sha256(dataset.read_bytes()).hexdigest(),
                  webcam_validated=False)
    report = dict(policy=policy, sample_counts={str(v): int(sum(y == v)) for v in np.unique(y)},
                  split={'calibration': len(calibration), 'holdout': len(holdout), 'seed': 20261117},
                  calibration=metrics(g, i, threshold), holdout=metrics(hg, hi, threshold),
                  enrollment_pair_reject_rate=float(np.mean(consistency < enrollment_threshold)),
                  holdout_enrollment_pair_reject_rate=float(np.mean(hc < enrollment_threshold)),
                  holdout_three_frame_pipeline=batch_metrics(x[holdout], y[holdout], threshold, rng),
                  limitations=['Image-level split may share capture sessions; no live webcam validation.',
                               'Repeated correlated comparisons are not independent trials.',
                               '9 identities cannot establish production FAR; no presentation-attack detection.'])
    (BASE / 'face_verification_policy.json').write_text(json.dumps(policy, indent=2) + '\n', encoding='utf-8')
    (BASE / 'face_verification_calibration.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
