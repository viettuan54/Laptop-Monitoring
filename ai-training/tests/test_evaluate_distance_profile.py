import os
import sys
import unittest
from datetime import datetime, timezone

TRAINING_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TRAINING_ROOT not in sys.path:
    sys.path.insert(0, TRAINING_ROOT)

from evaluation.evaluate_distance_profile import evaluate_profile


class DistanceProfileEvaluationTest(unittest.TestCase):
    def _profile(self):
        return {
            "profile_version": "2.0.0",
            "model_type": "inverse_eye_separation_polynomial",
            "coefficients": {
                "quadratic": 0.0,
                "linear": 5.0,
                "intercept": 0.0,
            },
            "feature_range": {
                "inverse_eye_separation_min": 4.0,
                "inverse_eye_separation_max": 20.0,
            },
            "camera_id": "camera-test",
            "subject_id": "subject-test",
            "frame_width": 640,
            "frame_height": 480,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def _session(self):
        samples = []
        for distance in (25.0, 30.0, 35.0, 40.0):
            samples.append(
                {
                    "actual_distance_cm": distance,
                    "eye_separation_normalized": 5.0 / distance,
                }
            )
        return {
            "status": "completed",
            "session_id": "calibration-test",
            "camera_id": "camera-test",
            "subject_id": "subject-test",
            "frame_width": 640,
            "frame_height": 480,
            "samples": samples,
        }

    def test_perfect_profile_passes_acceptance(self):
        report = evaluate_profile(self._profile(), self._session())
        self.assertEqual(report["overall"]["mae_cm"], 0.0)
        self.assertEqual(report["threshold_classification"]["false_positive"], 0)
        self.assertEqual(report["threshold_classification"]["false_negative"], 0)
        self.assertTrue(report["acceptance"]["passed"])

    def test_rejects_profile_from_another_camera(self):
        session = self._session()
        session["camera_id"] = "camera-other"
        with self.assertRaises(ValueError):
            evaluate_profile(self._profile(), session)


if __name__ == "__main__":
    unittest.main()
