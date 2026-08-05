"""Build a personal neutral-posture profile from accepted good sessions."""

import argparse
import hashlib
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = TRAINING_ROOT.parent
AGENT_COMPANION_ROOT = REPOSITORY_ROOT / "child-monitor-agent" / "companion"
for import_root in (TRAINING_ROOT, AGENT_COMPANION_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from data_collection.calibration_ui import write_json_atomic
from posture_model import (
    FRAME_FEATURE_NAMES,
    extract_posture_features,
    validate_posture_profile,
)


REQUIRED_QUALITY_GATE_VERSION = "2.0.0"


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_personal_profile(selection_path, subject_id, output_path=None):
    selection_path = Path(selection_path).resolve()
    dataset_dir = selection_path.parent
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    good_entries = [
        entry
        for entry in selection.get("accepted_sessions", [])
        if entry.get("primary_class") == "good"
    ]
    vectors = []
    source_sessions = []
    camera_ids = set()
    resolutions = set()
    for entry in good_entries:
        session_id = entry["session_id"]
        manifest_path = dataset_dir / f"{session_id}.manifest.json"
        records_path = dataset_dir / f"{session_id}.landmarks.jsonl"
        if not manifest_path.is_file() or not records_path.is_file():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("subject_id") != subject_id:
            continue
        if manifest.get("quality_gate_version") != REQUIRED_QUALITY_GATE_VERSION:
            raise ValueError(
                f"good session {session_id} must use quality gate "
                f"{REQUIRED_QUALITY_GATE_VERSION}"
            )
        if _sha256(records_path) != entry.get("expected_records_sha256"):
            raise ValueError(f"checksum mismatch for good session {session_id}")
        camera_ids.add(manifest["camera_id"])
        resolutions.add((manifest["frame_width"], manifest["frame_height"]))
        with records_path.open("r", encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("transition"):
                    continue
                vector = extract_posture_features(
                    record.get("pose_landmarks"),
                    record.get("frame_width"),
                    record.get("frame_height"),
                )
                if vector is None:
                    raise ValueError(
                        f"good session {session_id} contains an unobservable record"
                    )
                vectors.append(vector)
        source_sessions.append(session_id)

    if len(source_sessions) < 2:
        raise ValueError(
            "a personal posture profile requires at least two accepted good sessions"
        )
    if len(camera_ids) != 1 or len(resolutions) != 1:
        raise ValueError("personal posture sessions must use one camera and resolution")
    if len(vectors) < 50:
        raise ValueError("personal posture profile requires at least 50 good records")

    baseline = [
        statistics.median(vector[index] for vector in vectors)
        for index in range(len(FRAME_FEATURE_NAMES))
    ]
    deviations = [
        statistics.median(
            abs(vector[index] - baseline[index]) for vector in vectors
        )
        for index in range(len(FRAME_FEATURE_NAMES))
    ]
    width, height = next(iter(resolutions))
    profile = {
        "profile_version": "1.0.0",
        "profile_scope": "subject_camera",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "subject_id": subject_id,
        "camera_id": next(iter(camera_ids)),
        "frame_width": int(width),
        "frame_height": int(height),
        "sample_count": len(vectors),
        "source_session_ids": sorted(source_sessions),
        "frame_feature_names": list(FRAME_FEATURE_NAMES),
        "baseline_frame_features": [round(float(value), 10) for value in baseline],
        "median_absolute_deviation": [
            round(float(value), 10) for value in deviations
        ],
    }
    validate_posture_profile(profile)
    if output_path is None:
        output_path = dataset_dir / f"{subject_id}.posture-profile.json"
    output_path = Path(output_path).resolve()
    write_json_atomic(output_path, profile)
    return output_path, profile


def main():
    parser = argparse.ArgumentParser(
        description="Build a personal posture baseline from accepted good sessions."
    )
    parser.add_argument("--subject-id", required=True)
    parser.add_argument(
        "--selection",
        type=Path,
        default=TRAINING_ROOT / "datasets" / "pilot" / "accepted_sessions.json",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output_path, profile = build_personal_profile(
            args.selection,
            args.subject_id,
            args.output,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(f"Posture profile: {output_path}")
    print(f"Good samples: {profile['sample_count']}")
    print(f"Sessions: {len(profile['source_session_ids'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
