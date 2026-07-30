"""Rebuild a quadratic calibration profile from an existing session."""

import argparse
import json
import sys
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from data_collection.calibration_ui import validate_json, write_json_atomic
from data_collection.distance_measurement import build_calibration_profile


def build_profile_from_sessions(session_paths, output_path=None):
    session_paths = [Path(path).resolve() for path in session_paths]
    if not session_paths:
        raise ValueError("At least one calibration session is required")
    session_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_session.schema.json"
    )
    sessions = []
    for session_path in session_paths:
        session = json.loads(session_path.read_text(encoding="utf-8"))
        validate_json(session, session_schema)
        if session["status"] != "completed":
            raise ValueError("Only completed calibration sessions can build a profile")
        sessions.append(session)

    reference = sessions[0]
    for session in sessions[1:]:
        for field in ("camera_id", "subject_id", "frame_width", "frame_height"):
            if session[field] != reference[field]:
                raise ValueError(
                    f"Session mismatch for {field}: "
                    f"{reference[field]!r} != {session[field]!r}"
                )

    profile = build_calibration_profile(
        [
            sample
            for session in sessions
            for sample in session["samples"]
        ],
        camera_id=reference["camera_id"],
        subject_id=reference["subject_id"],
        frame_width=reference["frame_width"],
        frame_height=reference["frame_height"],
        source_session_ids=[session["session_id"] for session in sessions],
    )
    profile_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_profile.schema.json"
    )
    validate_json(profile, profile_schema)

    if output_path is None:
        output_path = session_paths[0].parent / (
            f"{reference['camera_id']}-{reference['subject_id']}.v3.profile.json"
        )
    output_path = Path(output_path).resolve()
    write_json_atomic(output_path, profile)
    return output_path, profile


def main():
    parser = argparse.ArgumentParser(
        description="Build a v3 monotonic profile from completed sessions."
    )
    parser.add_argument("sessions", type=Path, nargs="+")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output_path, profile = build_profile_from_sessions(args.sessions, args.output)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))

    metrics = profile["training_metrics"]
    legacy = profile["legacy_single_scale"]
    print(f"Profile written: {output_path}")
    print(f"Monotonic linear training MAE: {metrics['mae_cm']:.2f} cm")
    print(f"Monotonic linear training RMSE: {metrics['rmse_cm']:.2f} cm")
    print(f"Legacy single-scale MAE: {legacy['training_mae_cm']:.2f} cm")
    print("Note: training metrics are not independent validation results.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
