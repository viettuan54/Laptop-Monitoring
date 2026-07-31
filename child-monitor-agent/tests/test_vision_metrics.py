import math
import os
import sys
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from vision_metrics import (
    analyze_calibrated_eye_distance,
    analyze_posture,
    classify_eye_distance_zone,
    estimate_eye_distance_cm,
)


def landmarks(count, **defaults):
    return [
        {
            "x": defaults.get("x", 0.5),
            "y": defaults.get("y", 0.5),
            "z": defaults.get("z", 0.0),
            "visibility": defaults.get("visibility", 1.0),
        }
        for _ in range(count)
    ]


class VisionMetricsTest(unittest.TestCase):
    def _profile(self):
        return {
            "profile_version": "3.0.0",
            "coefficients": {
                "slope": 5.888908775393,
                "intercept": -0.895370049444,
            },
            "feature_range": {
                "inverse_eye_separation_min": 5.27165636,
                "inverse_eye_separation_max": 7.26562176,
            },
            "decision_policy": {
                "threshold_cm": 35.0,
                "warning_below_cm": 33.0,
                "safe_at_or_above_cm": 37.0,
                "uncertain_action": "continue_sampling",
            },
        }

    def _calibrated_face_for_distance(self, distance_cm):
        profile = self._profile()
        slope = profile["coefficients"]["slope"]
        intercept = profile["coefficients"]["intercept"]
        inverse_separation = (distance_cm - intercept) / slope
        separation = 1.0 / inverse_separation
        points = landmarks(478)
        for index in (33, 133):
            points[index].update(x=0.5 - separation / 2, y=0.45)
        for index in (362, 263):
            points[index].update(x=0.5 + separation / 2, y=0.45)
        points[1].update(x=0.5, y=0.53)
        return points

    def test_estimates_eye_distance_from_eye_separation(self):
        points = landmarks(478)
        width = 640
        focal = width / (2 * math.tan(math.radians(60) / 2))
        target_distance = 30.0
        separation = (focal * 6.3 / target_distance) / width
        for index in (33, 133):
            points[index]["x"] = 0.5 - separation / 2
        for index in (362, 263):
            points[index]["x"] = 0.5 + separation / 2

        result = estimate_eye_distance_cm(points, width)
        self.assertAlmostEqual(result, target_distance, places=1)

    def test_returns_none_for_missing_or_degenerate_face(self):
        self.assertIsNone(estimate_eye_distance_cm([], 640))
        self.assertIsNone(estimate_eye_distance_cm(landmarks(478), 640))

    def test_rejects_eye_distance_when_head_yaw_is_too_large(self):
        points = landmarks(478)
        for index in (33, 133):
            points[index]["x"] = 0.4
        for index in (362, 263):
            points[index]["x"] = 0.6
        points[1]["x"] = 0.7
        self.assertIsNone(estimate_eye_distance_cm(points, 640))

    def test_uses_resolution_independent_calibration_scale(self):
        points = landmarks(478)
        for index in (33, 133):
            points[index]["x"] = 0.45
        for index in (362, 263):
            points[index]["x"] = 0.55

        result_640 = estimate_eye_distance_cm(
            points,
            640,
            image_height=480,
            calibration_scale_cm=4.0,
        )
        result_1280 = estimate_eye_distance_cm(
            points,
            1280,
            image_height=960,
            calibration_scale_cm=4.0,
        )
        self.assertEqual(result_640, 40.0)
        self.assertEqual(result_1280, 40.0)

    def test_three_zone_policy_uses_exact_boundaries(self):
        policy = self._profile()["decision_policy"]
        self.assertEqual(classify_eye_distance_zone(32.9, policy), "warning")
        self.assertEqual(classify_eye_distance_zone(33.0, policy), "uncertain")
        self.assertEqual(classify_eye_distance_zone(36.9, policy), "uncertain")
        self.assertEqual(classify_eye_distance_zone(37.0, policy), "safe")

    def test_profile_v3_estimates_and_classifies_all_three_zones(self):
        profile = self._profile()
        expected_zones = ((31.0, "warning"), (35.0, "uncertain"), (39.0, "safe"))
        for distance_cm, expected_zone in expected_zones:
            with self.subTest(distance_cm=distance_cm):
                result = analyze_calibrated_eye_distance(
                    self._calibrated_face_for_distance(distance_cm),
                    640,
                    480,
                    profile,
                )
                self.assertTrue(result["reliable"])
                self.assertAlmostEqual(
                    result["estimated_distance_cm"],
                    distance_cm,
                    places=1,
                )
                self.assertEqual(result["decision_zone"], expected_zone)

    def test_profile_v3_rejects_geometry_not_matching_calibration_standard(self):
        points = self._calibrated_face_for_distance(31.0)
        points[1]["x"] = 0.55
        result = analyze_calibrated_eye_distance(
            points,
            640,
            480,
            self._profile(),
        )
        self.assertFalse(result["reliable"])
        self.assertEqual(result["decision_zone"], "unknown")
        self.assertEqual(result["rejection_reason"], "head_yaw")

    def test_profile_v3_marks_monotonic_extrapolation(self):
        result = analyze_calibrated_eye_distance(
            self._calibrated_face_for_distance(25.0),
            640,
            480,
            self._profile(),
        )
        self.assertTrue(result["reliable"])
        self.assertTrue(result["outside_feature_range"])
        self.assertEqual(result["decision_zone"], "warning")

    def test_upright_posture_is_not_flagged(self):
        normalized = landmarks(33)
        world = landmarks(33)
        for collection in (normalized, world):
            collection[7].update(x=-0.1, y=-0.75, z=0.0)
            collection[8].update(x=0.1, y=-0.75, z=0.0)
            collection[11].update(x=-0.2, y=-0.5, z=0.0)
            collection[12].update(x=0.2, y=-0.5, z=0.0)
            collection[23].update(x=-0.2, y=0.0, z=0.0)
            collection[24].update(x=0.2, y=0.0, z=0.0)

        result = analyze_posture(normalized, world)
        self.assertTrue(result["reliable"])
        self.assertFalse(result["is_bad"])
        self.assertEqual(result["reasons"], [])
        self.assertEqual(result["visibility_state"], "visible")
        self.assertEqual(result["confidence"], 1.0)
        self.assertEqual(result["posture_state"], "good")
        self.assertEqual(result["posture_labels"], [])

    def test_forward_neck_and_torso_lean_are_flagged(self):
        normalized = landmarks(33)
        world = landmarks(33)
        for collection in (normalized, world):
            collection[7].update(x=0.1, y=-0.72, z=0.3)
            collection[8].update(x=0.3, y=-0.72, z=0.3)
            collection[11].update(x=0.0, y=-0.5, z=0.15)
            collection[12].update(x=0.4, y=-0.5, z=0.15)
            collection[23].update(x=-0.2, y=0.0, z=0.0)
            collection[24].update(x=0.2, y=0.0, z=0.0)

        result = analyze_posture(normalized, world)
        self.assertTrue(result["is_bad"])
        self.assertIn("neck", result["reasons"])
        self.assertIn("torso", result["reasons"])
        self.assertEqual(
            result["posture_labels"],
            ["forward_head", "trunk_lean", "slouching"],
        )
        self.assertEqual(result["posture_state"], "bad")

    def test_shoulder_tilt_preserves_direction(self):
        normalized = landmarks(33)
        world = landmarks(33)
        for collection in (normalized, world):
            collection[7].update(x=-0.1, y=-0.75, z=0.0)
            collection[8].update(x=0.1, y=-0.75, z=0.0)
            collection[11].update(x=-0.2, y=-0.6, z=0.0)
            collection[12].update(x=0.2, y=-0.45, z=0.0)
            collection[23].update(x=-0.2, y=0.0, z=0.0)
            collection[24].update(x=0.2, y=0.0, z=0.0)

        result = analyze_posture(normalized, world)
        self.assertIn("shoulders", result["reasons"])
        self.assertGreater(result["shoulder_tilt_signed_degrees"], 0)
        self.assertEqual(result["shoulder_tilt_direction"], "right_shoulder_lower")
        self.assertIn("shoulder_tilt_right", result["posture_labels"])

    def test_low_visibility_reports_partial_body_without_warning(self):
        normalized = landmarks(33)
        normalized[7]["visibility"] = 0.2
        result = analyze_posture(normalized)
        self.assertFalse(result["reliable"])
        self.assertFalse(result["is_bad"])
        self.assertEqual(result["visibility_state"], "partially_visible")
        self.assertEqual(result["posture_state"], "unknown")
        self.assertEqual(result["posture_labels"], [])


if __name__ == "__main__":
    unittest.main()
