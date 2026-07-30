"""Freeze an accepted distance profile and validation report by hash."""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from data_collection.calibration_ui import write_json_atomic


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def freeze_candidate(profile_path, validation_report_path, output_path=None):
    profile_path = Path(profile_path).resolve()
    validation_report_path = Path(validation_report_path).resolve()
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    report = json.loads(validation_report_path.read_text(encoding="utf-8"))
    if profile.get("profile_version") != "3.0.0":
        raise ValueError("Only profile version 3.0.0 can be frozen")
    if not report.get("acceptance", {}).get("passed"):
        raise ValueError("Validation report did not pass acceptance criteria")
    if report.get("profile_version") != profile.get("profile_version"):
        raise ValueError("Validation report does not match profile version")

    manifest = {
        "manifest_version": "1.0.0",
        "candidate_status": "awaiting_final_test",
        "profile_path": str(profile_path),
        "profile_sha256": _sha256(profile_path),
        "profile_version": profile["profile_version"],
        "model_type": profile["model_type"],
        "source_session_ids": profile["source_session_ids"],
        "decision_policy": profile["decision_policy"],
        "validation_report_path": str(validation_report_path),
        "validation_report_sha256": _sha256(validation_report_path),
        "validation_session_id": report["validation_session_id"],
        "validation_summary": {
            "evaluated_sample_count": report["evaluated_sample_count"],
            "overall_mae_cm": report["overall"]["mae_cm"],
            "near_threshold_mae_cm": report["near_threshold_30_40_cm"]["mae_cm"],
            "dangerous_miss_rate": report["uncertainty_zone"]["dangerous_miss_rate"],
            "false_warning_rate": report["uncertainty_zone"]["false_warning_rate"],
            "uncertain_rate": report["uncertainty_zone"]["uncertain_rate"],
        },
        "final_test": {
            "status": "pending",
            "must_not_refit_profile": True,
        },
        "frozen_at": datetime.now(timezone.utc).isoformat(),
    }
    if output_path is None:
        output_path = profile_path.with_name("distance-v3-candidate.manifest.json")
    output_path = Path(output_path).resolve()
    write_json_atomic(output_path, manifest)
    return output_path, manifest


def main():
    parser = argparse.ArgumentParser(
        description="Freeze an accepted distance candidate for final testing."
    )
    parser.add_argument("profile", type=Path)
    parser.add_argument("validation_report", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output_path, manifest = freeze_candidate(
            args.profile,
            args.validation_report,
            args.output,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(f"Candidate manifest: {output_path}")
    print(f"Profile SHA-256: {manifest['profile_sha256']}")
    print("Status: awaiting_final_test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
