import math
import os
import sys
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from vision_metrics import analyze_posture, estimate_eye_distance_cm


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


if __name__ == "__main__":
    unittest.main()
