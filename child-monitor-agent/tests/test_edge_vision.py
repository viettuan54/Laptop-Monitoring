import os
import sys
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from edge_vision import EdgeVisionMonitor, SustainedAlertGate, normalize_vision_config


class EdgeVisionTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
