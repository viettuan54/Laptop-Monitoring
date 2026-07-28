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


def build_profile_from_session(session_path, output_path=None):
    session_path = Path(session_path).resolve()
    session = json.loads(session_path.read_text(encoding="utf-8"))
    session_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_session.schema.json"
    )
    validate_json(session, session_schema)
    if session["status"] != "completed":
        raise ValueError("Only a completed calibration session can build a profile")

    profile = build_calibration_profile(
        session["samples"],
        camera_id=session["camera_id"],
        subject_id=session["subject_id"],
        frame_width=session["frame_width"],
        frame_height=session["frame_height"],
    )
    profile_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_profile.schema.json"
    )
    validate_json(profile, profile_schema)

    if output_path is None:
        output_path = session_path.parent / (
            f"{session['camera_id']}-{session['subject_id']}.v2.profile.json"
        )
    output_path = Path(output_path).resolve()
    write_json_atomic(output_path, profile)
    return output_path, profile


def main():
    parser = argparse.ArgumentParser(
        description="Build a v2 quadratic profile from a completed session."
    )
    parser.add_argument("session", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output_path, profile = build_profile_from_session(args.session, args.output)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))

    metrics = profile["training_metrics"]
    legacy = profile["legacy_single_scale"]
    print(f"Profile written: {output_path}")
    print(f"Quadratic training MAE: {metrics['mae_cm']:.2f} cm")
    print(f"Quadratic training RMSE: {metrics['rmse_cm']:.2f} cm")
    print(f"Legacy single-scale MAE: {legacy['training_mae_cm']:.2f} cm")
    print("Note: training metrics are not independent validation results.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
