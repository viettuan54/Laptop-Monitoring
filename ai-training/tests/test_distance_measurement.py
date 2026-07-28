import json
import os
import sys
import unittest
from pathlib import Path

import jsonschema

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from data_collection.distance_measurement import (
    build_calibration_profile,
    normalize_distance_measurement,
)


class DistanceMeasurementTest(unittest.TestCase):
    def test_normalizes_measured_distance(self):
        result = normalize_distance_measurement(
            35.04,
            method="tape_measure",
            uncertainty_cm=0.8,
        )
        self.assertEqual(result["actual_distance_cm"], 35.0)
        self.assertEqual(result["distance_measurement_status"], "measured")
        self.assertEqual(
            result["distance_reference"],
            "camera_lens_center_to_eye_midpoint",
        )

    def test_non_measured_distance_has_no_value_or_method(self):
        result = normalize_distance_measurement(
            None,
            status="not_measured",
        )
        self.assertIsNone(result["actual_distance_cm"])
        self.assertIsNone(result["distance_measurement_method"])
        self.assertIsNone(result["distance_uncertainty_cm"])

    def test_rejects_unmeasured_record_with_distance(self):
        with self.assertRaises(ValueError):
            normalize_distance_measurement(35, status="not_measured")

    def test_builds_resolution_independent_calibration_profile(self):
        expected_scale = 5.4
        samples = []
        for distance in (25, 30, 35, 40, 50, 60):
            samples.append(
                {
                    "actual_distance_cm": distance,
                    "eye_separation_normalized": expected_scale / distance,
                }
            )
        profile = build_calibration_profile(
            samples,
            camera_id="camera-12345678",
            subject_id="subject-001",
            frame_width=640,
            frame_height=480,
        )
        self.assertAlmostEqual(profile["calibration_scale_cm"], expected_scale)
        self.assertEqual(profile["training_mae_cm"], 0.0)
        self.assertEqual(profile["sample_count"], 6)

        schema_path = (
            TRAINING_ROOT
            / "datasets"
            / "schema"
            / "calibration_profile.schema.json"
        )
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator(schema).validate(profile)

    def test_calibration_requires_three_distances(self):
        samples = [
            {
                "actual_distance_cm": 30 if index < 3 else 40,
                "eye_separation_normalized": 0.18 if index < 3 else 0.135,
            }
            for index in range(6)
        ]
        with self.assertRaises(ValueError):
            build_calibration_profile(
                samples,
                camera_id="camera-12345678",
                subject_id="subject-001",
                frame_width=640,
                frame_height=480,
            )


if __name__ == "__main__":
    unittest.main()
