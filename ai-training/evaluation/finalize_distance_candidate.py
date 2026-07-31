"""Finalize a frozen candidate after an independent final test passes."""

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


def finalize_candidate(manifest_path, final_report_path):
    manifest_path = Path(manifest_path).resolve()
    final_report_path = Path(final_report_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    report = json.loads(final_report_path.read_text(encoding="utf-8"))

    profile_path = Path(manifest["profile_path"])
    current_profile_hash = _sha256(profile_path)
    if current_profile_hash != manifest["profile_sha256"]:
        raise ValueError("Frozen profile hash no longer matches the manifest")
    if not report.get("acceptance", {}).get("passed"):
        raise ValueError("Final test did not pass acceptance criteria")
    if report.get("profile_version") != manifest.get("profile_version"):
        raise ValueError("Final report profile version does not match candidate")

    final_session_id = report["validation_session_id"]
    if final_session_id in manifest["source_session_ids"]:
        raise ValueError("Final test session was used for profile training")
    if final_session_id == manifest["validation_session_id"]:
        raise ValueError("Final test session must differ from validation session")

    manifest["candidate_status"] = "final_test_passed"
    manifest["final_test"] = {
        "status": "passed",
        "must_not_refit_profile": True,
        "session_id": final_session_id,
        "report_path": str(final_report_path),
        "report_sha256": _sha256(final_report_path),
        "evaluated_sample_count": report["evaluated_sample_count"],
        "overall_mae_cm": report["overall"]["mae_cm"],
        "near_threshold_mae_cm": report["near_threshold_30_40_cm"]["mae_cm"],
        "dangerous_miss_rate": report["uncertainty_zone"]["dangerous_miss_rate"],
        "false_warning_rate": report["uncertainty_zone"]["false_warning_rate"],
        "uncertain_rate": report["uncertainty_zone"]["uncertain_rate"],
        "outside_feature_range_count": report["outside_feature_range_count"],
    }
    manifest["finalized_at"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(manifest_path, manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Finalize a frozen distance candidate after final testing."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("final_report", type=Path)
    args = parser.parse_args()
    try:
        manifest = finalize_candidate(args.manifest, args.final_report)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(f"Candidate status: {manifest['candidate_status']}")
    print(f"Final-test session: {manifest['final_test']['session_id']}")
    print(f"Final-test MAE: {manifest['final_test']['overall_mae_cm']:.2f} cm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
