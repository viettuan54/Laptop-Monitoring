import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from edge_vision import EdgeVisionMonitor, SustainedAlertGate, normalize_vision_config


class EdgeVisionTest(unittest.TestCase):
    class _PipeClient:
        def __init__(self):
            self.alerts = []

        def send_vision_alert(self, alert_type, message, metrics):
            self.alerts.append((alert_type, message, metrics))
            return {"queued": True}

    @staticmethod
    def _landmarks_for_distance(distance_cm, profile):
        slope = profile["coefficients"]["slope"]
        intercept = profile["coefficients"]["intercept"]
        separation = 1.0 / ((distance_cm - intercept) / slope)
        points = [
            {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 1.0}
            for _ in range(478)
        ]
        for index in (33, 133):
            points[index].update(x=0.5 - separation / 2, y=0.45)
        for index in (362, 263):
            points[index].update(x=0.5 + separation / 2, y=0.45)
        points[1].update(x=0.5, y=0.53)
        return points

    @staticmethod
    def _profile():
        return {
            "profile_version": "3.0.0",
            "coefficients": {"slope": 5.0, "intercept": 0.0},
            "feature_range": {
                "inverse_eye_separation_min": 4.0,
                "inverse_eye_separation_max": 10.0,
            },
            "decision_policy": {
                "threshold_cm": 35.0,
                "warning_below_cm": 33.0,
                "safe_at_or_above_cm": 37.0,
                "uncertain_action": "continue_sampling",
            },
        }

    def test_config_is_disabled_by_default_and_values_are_bounded(self):
        config = normalize_vision_config({
            "enabled": "true",
            "min_eye_distance_cm": 500,
            "sample_interval_seconds": 0,
        })
        self.assertFalse(config["enabled"])
        self.assertEqual(config["min_eye_distance_cm"], 80.0)
        self.assertEqual(config["sample_interval_seconds"], 0.2)
        self.assertEqual(config["eye_distance_calibration_scale_cm"], 0.0)

    def test_alert_gate_requires_duration_and_enforces_cooldown(self):
        gate = SustainedAlertGate()
        self.assertFalse(gate.observe("posture", True, 10.0, 5.0, 60.0))
        self.assertFalse(gate.observe("posture", True, 12.5, 5.0, 60.0))
        self.assertTrue(gate.observe("posture", True, 15.0, 5.0, 60.0))
        self.assertFalse(gate.observe("posture", True, 70.0, 5.0, 60.0))
        self.assertFalse(gate.observe("posture", True, 72.5, 5.0, 60.0))
        self.assertTrue(gate.observe("posture", True, 75.0, 5.0, 60.0))

    def test_alert_gate_ignores_invalid_landmark_sample(self):
        gate = SustainedAlertGate()
        self.assertFalse(gate.observe("eye", True, 0.0, 5.0, 60.0))
        self.assertFalse(gate.observe("eye", None, 2.0, 5.0, 60.0))
        self.assertFalse(gate.observe("eye", True, 2.5, 5.0, 60.0))
        self.assertTrue(gate.observe("eye", True, 5.0, 5.0, 60.0))

    def test_alert_gate_does_not_alert_below_vote_ratio(self):
        gate = SustainedAlertGate()
        gate.observe("eye", True, 0.0, 5.0, 60.0)
        gate.observe("eye", False, 2.0, 5.0, 60.0)
        self.assertFalse(gate.observe("eye", True, 5.0, 5.0, 60.0))

    def test_missing_pipe_response_does_not_disable_existing_policy(self):
        monitor = EdgeVisionMonitor(pipe_client=None)
        monitor.update_config({"enabled": True})
        monitor.update_config(None)
        self.assertTrue(monitor._get_config()["enabled"])

    def test_uncertain_profile_samples_do_not_add_or_clear_votes(self):
        pipe_client = self._PipeClient()
        monitor = EdgeVisionMonitor(pipe_client)
        config = normalize_vision_config({
            "enabled": True,
            "alert_hold_seconds": 5.0,
        })
        profile = self._profile()
        face_result = SimpleNamespace(
            face_landmarks=[self._landmarks_for_distance(35.0, profile)]
        )
        with patch("edge_vision.time.monotonic", side_effect=(0.0, 2.5, 5.0)):
            for _ in range(3):
                monitor._evaluate(
                    face_result,
                    None,
                    640,
                    480,
                    config,
                    profile,
                    "profile-hash",
                )
        self.assertEqual(pipe_client.alerts, [])
        self.assertEqual(len(monitor._gate.observations["eye_distance"]), 0)

    def test_sustained_warning_uses_profile_v3_metadata(self):
        pipe_client = self._PipeClient()
        monitor = EdgeVisionMonitor(pipe_client)
        config = normalize_vision_config({
            "enabled": True,
            "alert_hold_seconds": 5.0,
        })
        profile = self._profile()
        face_result = SimpleNamespace(
            face_landmarks=[self._landmarks_for_distance(30.0, profile)]
        )
        with patch("edge_vision.time.monotonic", side_effect=(0.0, 2.5, 5.0)):
            for _ in range(3):
                monitor._evaluate(
                    face_result,
                    None,
                    640,
                    480,
                    config,
                    profile,
                    "profile-hash",
                )
        self.assertEqual(len(pipe_client.alerts), 1)
        alert_type, _, metrics = pipe_client.alerts[0]
        self.assertEqual(alert_type, "eye_distance_warning")
        self.assertEqual(metrics["decision_zone"], "warning")
        self.assertEqual(metrics["profile_version"], "3.0.0")
        self.assertEqual(metrics["profile_sha256"], "profile-hash")


if __name__ == "__main__":
    unittest.main()
