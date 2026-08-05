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

from data_collection.capture_landmarks import build_landmark_record
from data_collection.distance_measurement import normalize_distance_measurement
from evaluation.report_pilot_dataset import (
    audit_pilot_dataset,
    load_selection,
    render_markdown,
)


class ReportPilotDatasetTest(unittest.TestCase):
    @staticmethod
    def _landmark():
        return {
            "x": 0.5,
            "y": 0.5,
            "z": 0.0,
            "visibility": 0.9,
            "presence": 0.9,
        }

    def _create_dataset(self, directory, *, primary_class="good"):
        session_id = "session-test-report"
        labels = [] if primary_class == "good" else [primary_class]
        record = build_landmark_record(
            session_id=session_id,
            subject_id="subject-test",
            camera_id="camera-test",
            timestamp_ms=1,
            distance_measurement=normalize_distance_measurement(
                None, status="not_measured"
            ),
            visibility_state="visible",
            posture_labels=labels,
            transition=False,
            face_landmarks=[self._landmark()] * 478,
            pose_landmarks=[self._landmark()] * 33,
            frame_width=640,
            frame_height=480,
        )
        records_path = directory / f"{session_id}.landmarks.jsonl"
        records_path.write_text(json.dumps(record) + "\n", encoding="utf-8")
        digest = hashlib.sha256(records_path.read_bytes()).hexdigest()
        manifest = {
            "session_id": session_id,
            "subject_id": "subject-test",
            "camera_id": "camera-test",
            "status": "completed",
            "records_file": records_path.name,
            "sample_count": 1,
            "records_sha256": digest,
            "label_counts": {
                label: int(label in record["posture_labels"])
                for label in (
                    "forward_head",
                    "trunk_lean",
                    "shoulder_tilt_left",
                    "shoulder_tilt_right",
                    "slouching",
                )
            },
            "visibility_counts": {
                "visible": 1,
                "partially_visible": 0,
                "not_visible": 0,
            },
        }
        (directory / f"{session_id}.manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        selection = {
            "selection_version": "1.0.0",
            "dataset_id": "test-pilot",
            "accepted_sessions": [
                {
                    "session_id": session_id,
                    "primary_class": primary_class,
                    "expected_sample_count": 1,
                    "expected_records_sha256": digest,
                }
            ],
            "excluded_sessions": [],
        }
        selection_path = directory / "accepted_sessions.json"
        selection_path.write_text(json.dumps(selection), encoding="utf-8")
        return selection_path

    def test_audit_reports_valid_balanced_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            selection = load_selection(self._create_dataset(directory))
            report = audit_pilot_dataset(directory, selection)

        self.assertEqual(report["status"], "pass_with_warnings")
        self.assertEqual(report["summary"]["accepted_record_count"], 1)
        self.assertEqual(report["summary"]["schema_valid_record_rate"], 1.0)
        self.assertEqual(report["landmark_quality"]["pose_complete_rate"], 1.0)
        self.assertEqual(report["label_conflict_counts"], {})
        self.assertIn("# Báo cáo", render_markdown(report))

    def test_audit_rejects_primary_class_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            selection_path = self._create_dataset(directory)
            selection = load_selection(selection_path)
            selection["accepted_sessions"][0]["primary_class"] = "forward_head"
            report = audit_pilot_dataset(directory, selection)

        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any("primary_class=forward_head" in item for item in report["errors"])
        )


if __name__ == "__main__":
    unittest.main()
