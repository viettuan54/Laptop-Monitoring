import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))
AGENT_COMPANION_ROOT = TRAINING_ROOT.parent / "child-monitor-agent" / "companion"
if str(AGENT_COMPANION_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_COMPANION_ROOT))

from data_collection.capture_landmarks import (
    PRIMARY_CLASS_TO_SELECTED_LABELS,
    build_landmark_record,
)
from data_collection.distance_measurement import normalize_distance_measurement
from posture_model import PRIMARY_CLASSES
from training.posture_pipeline import (
    compute_readiness,
    run_full_build,
    sync_selection_file,
)


def _pose_for_class(primary_class, subject_offset=0.0):
    points = [
        {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.95, "presence": 0.95}
        for _ in range(33)
    ]
    # Default neutral upper body with clearly visible ears, shoulders, and hips
    ear_x_shift = 0.0
    ear_z_shift = 0.0
    shoulder_x_shift = 0.0
    left_shoulder_y = 0.45
    right_shoulder_y = 0.45

    if primary_class in ("bad", "slouching"):
        shoulder_x_shift = 0.12
        ear_x_shift = 0.24
        ear_z_shift = -0.20
    elif primary_class == "forward_head":
        ear_x_shift = 0.12
        ear_z_shift = -0.18
    elif primary_class == "trunk_lean":
        shoulder_x_shift = 0.14
        ear_x_shift = 0.14
    elif primary_class == "shoulder_tilt_left":
        left_shoulder_y = 0.53
        right_shoulder_y = 0.41
    elif primary_class == "shoulder_tilt_right":
        left_shoulder_y = 0.41
        right_shoulder_y = 0.53

    points[7].update(
        x=0.43 + ear_x_shift + subject_offset,
        y=0.25,
        z=ear_z_shift,
    )
    points[8].update(
        x=0.57 + ear_x_shift + subject_offset,
        y=0.25,
        z=ear_z_shift,
    )
    points[11].update(
        x=0.35 + shoulder_x_shift + subject_offset,
        y=left_shoulder_y,
        z=0.0,
    )
    points[12].update(
        x=0.65 + shoulder_x_shift + subject_offset,
        y=right_shoulder_y,
        z=0.0,
    )
    points[23].update(x=0.40 + subject_offset, y=0.80, z=0.0)
    points[24].update(x=0.60 + subject_offset, y=0.80, z=0.0)
    return points


class PosturePipelineTest(unittest.TestCase):
    @staticmethod
    def _face():
        return [
            {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.95, "presence": 0.95}
            for _ in range(478)
        ]

    def _write_session(
        self,
        root,
        *,
        session_id,
        subject_id,
        primary_class,
        record_count=12,
        quality_gate_version="2.0.0",
        subject_offset=0.0,
    ):
        if primary_class == "bad":
            labels = ["forward_head", "trunk_lean"]
        else:
            labels = list(PRIMARY_CLASS_TO_SELECTED_LABELS[primary_class])
        records_path = root / f"{session_id}.landmarks.jsonl"
        lines = []
        label_counts = {
            "forward_head": 0,
            "trunk_lean": 0,
            "shoulder_tilt_left": 0,
            "shoulder_tilt_right": 0,
            "slouching": 0,
        }
        for idx in range(record_count):
            record = build_landmark_record(
                session_id=session_id,
                subject_id=subject_id,
                camera_id="camera-test",
                timestamp_ms=idx * 500,
                distance_measurement=normalize_distance_measurement(
                    None, status="not_measured"
                ),
                visibility_state="visible",
                posture_labels=labels,
                transition=False,
                face_landmarks=self._face(),
                pose_landmarks=_pose_for_class(primary_class, subject_offset),
                frame_width=640,
                frame_height=480,
            )
            for lbl in record["posture_labels"]:
                label_counts[lbl] += 1
            lines.append(json.dumps(record, separators=(",", ":")))

        records_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        digest = hashlib.sha256(records_path.read_bytes()).hexdigest()
        manifest = {
            "collection_session_version": "1.0.0",
            "record_schema_version": "1.1.0",
            "taxonomy_version": "1.0.0",
            "session_id": session_id,
            "subject_id": subject_id,
            "camera_id": "camera-test",
            "camera_index": 0,
            "frame_width": 640,
            "frame_height": 480,
            "sample_rate_hz": 2.0,
            "quality_gate_version": quality_gate_version,
            "records_file": records_path.name,
            "status": "completed",
            "sample_count": record_count,
            "rejected_sample_count": 0,
            "quality_rejection_counts": {},
            "transition_count": 0,
            "visibility_counts": {
                "visible": record_count,
                "partially_visible": 0,
                "not_visible": 0,
            },
            "label_counts": label_counts,
            "records_sha256": digest,
        }
        (root / f"{session_id}.manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

    def test_sync_and_full_build_succeeds_for_three_subjects(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Empty trial session should be automatically excluded
            self._write_session(
                root,
                session_id="session-empty-trial",
                subject_id="subject-001",
                primary_class="good",
                record_count=0,
            )

            for s_idx in range(3):
                subject_id = f"subject-00{s_idx + 1}"
                offset = s_idx * 0.002
                for primary_class in PRIMARY_CLASSES:
                    rec_count = 30 if primary_class == "good" else 12
                    for rep in range(2):
                        self._write_session(
                            root,
                            session_id=f"session-{subject_id}-{primary_class}-{rep}",
                            subject_id=subject_id,
                            primary_class=primary_class,
                            record_count=rec_count,
                            subject_offset=offset,
                        )

            selection, eligible, ineligible = sync_selection_file(root)
            self.assertEqual(len(eligible), 12)
            self.assertEqual(len(ineligible), 1)
            readiness = compute_readiness(eligible)
            self.assertTrue(readiness["ready_for_loso"])

            out_model = root / "posture_baseline_v1.json"
            out_report = root / "posture_loso_report.json"
            result = run_full_build(
                root,
                output_model_path=out_model,
                output_report_path=out_report,
                deploy_to_agent=False,
            )
            self.assertTrue(out_model.is_file())
            self.assertTrue(out_Model_sha := Path(f"{out_model}.sha256").is_file())
            self.assertTrue(result["model"]["deployment_approved"])
            self.assertEqual(len(result["built_profiles"]), 3)


if __name__ == "__main__":
    unittest.main()
