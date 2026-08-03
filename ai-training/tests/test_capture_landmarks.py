import io
import json
import math
import os
import sys
import unittest

TRAINING_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TRAINING_ROOT not in sys.path:
    sys.path.insert(0, TRAINING_ROOT)

from data_collection.capture_landmarks import (
    _append_jsonl,
    _distance_measurement_from_args,
    _toggle_label,
    _validate_args,
    build_landmark_record,
    build_parser,
    create_record_validator,
    serialize_landmarks,
    validate_landmark_record,
)
from data_collection.distance_measurement import normalize_distance_measurement


class CaptureLandmarksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = create_record_validator()

    @staticmethod
    def _landmark(**overrides):
        landmark = {
            "x": 0.25,
            "y": 0.5,
            "z": -0.1,
            "visibility": 0.9,
            "presence": 0.8,
        }
        landmark.update(overrides)
        return landmark

    def _record(self, **overrides):
        values = {
            "session_id": "session-test",
            "subject_id": "subject-test",
            "camera_id": "camera-test",
            "timestamp_ms": 123,
            "distance_measurement": normalize_distance_measurement(
                35.0,
                method="tape_measure",
                uncertainty_cm=1.0,
            ),
            "visibility_state": "visible",
            "posture_labels": ["trunk_lean", "forward_head"],
            "transition": False,
            "face_landmarks": [self._landmark()],
            "pose_landmarks": [self._landmark()],
            "frame_width": 640,
            "frame_height": 480,
        }
        values.update(overrides)
        return build_landmark_record(**values)

    def test_builds_schema_valid_record_and_derives_slouching(self):
        record = self._record()
        validate_landmark_record(record, self.validator)
        self.assertEqual(
            record["posture_labels"],
            ["forward_head", "trunk_lean", "slouching"],
        )
        self.assertEqual(record["posture_state"], "bad")
        self.assertEqual(record["actual_distance_cm"], 35.0)
        self.assertEqual(record["face_landmarks"][0]["visibility"], 0.9)

    def test_non_visible_record_has_unknown_posture_and_no_labels(self):
        record = self._record(
            visibility_state="not_visible",
            posture_labels=[],
            face_landmarks=[],
            pose_landmarks=[],
            distance_measurement=normalize_distance_measurement(
                None,
                status="not_measured",
            ),
        )
        validate_landmark_record(record, self.validator)
        self.assertEqual(record["posture_state"], "unknown")
        self.assertEqual(record["posture_labels"], [])
        self.assertIsNone(record["actual_distance_cm"])

    def test_schema_validation_reports_invalid_record_path(self):
        record = self._record()
        record["frame_width"] = 0
        with self.assertRaisesRegex(ValueError, "frame_width"):
            validate_landmark_record(record, self.validator)

    def test_landmark_serialization_rejects_non_finite_geometry(self):
        with self.assertRaisesRegex(ValueError, "landmark.x"):
            serialize_landmarks([self._landmark(x=math.nan)])

    def test_landmark_confidence_is_clamped_to_schema_range(self):
        result = serialize_landmarks(
            [self._landmark(visibility=1.0001, presence=-0.1)]
        )
        self.assertEqual(result[0]["visibility"], 1.0)
        self.assertEqual(result[0]["presence"], 0.0)

    def test_shoulder_hotkeys_keep_directions_mutually_exclusive(self):
        labels = _toggle_label(set(), "shoulder_tilt_left")
        labels = _toggle_label(labels, "shoulder_tilt_right")
        self.assertNotIn("shoulder_tilt_left", labels)
        self.assertIn("shoulder_tilt_right", labels)

    def test_cli_derives_distance_status_and_rejects_missing_measurement(self):
        parser = build_parser()
        measured_args = parser.parse_args(["--distance-cm", "35"])
        _validate_args(measured_args)
        measured = _distance_measurement_from_args(measured_args)
        self.assertEqual(measured["distance_measurement_status"], "measured")

        unmeasured_args = parser.parse_args([])
        _validate_args(unmeasured_args)
        unmeasured = _distance_measurement_from_args(unmeasured_args)
        self.assertEqual(
            unmeasured["distance_measurement_status"],
            "not_measured",
        )

        invalid_args = parser.parse_args(
            ["--distance-status", "measured"]
        )
        with self.assertRaisesRegex(ValueError, "distance-cm is required"):
            _validate_args(invalid_args)

    def test_jsonl_writer_emits_one_compact_record_per_line(self):
        record = self._record()
        stream = io.StringIO()
        _append_jsonl(stream, record)
        lines = stream.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), record)


if __name__ == "__main__":
    unittest.main()
