import os
import sys
import unittest

TRAINING_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TRAINING_ROOT not in sys.path:
    sys.path.insert(0, TRAINING_ROOT)

from data_collection.labels import normalize_posture_annotation


class LabelNormalizationTest(unittest.TestCase):
    def test_empty_visible_annotation_is_good(self):
        result = normalize_posture_annotation("visible", [])
        self.assertEqual(result["posture_state"], "good")
        self.assertEqual(result["posture_labels"], [])

    def test_slouching_is_derived_from_components(self):
        result = normalize_posture_annotation(
            "visible",
            ["trunk_lean", "forward_head"],
        )
        self.assertEqual(
            result["posture_labels"],
            ["forward_head", "trunk_lean", "slouching"],
        )
        self.assertEqual(result["posture_state"], "bad")

    def test_slouching_is_removed_without_both_components(self):
        result = normalize_posture_annotation(
            "visible",
            ["forward_head", "slouching"],
        )
        self.assertEqual(result["posture_labels"], ["forward_head"])

    def test_non_visible_annotation_cannot_have_posture_labels(self):
        with self.assertRaises(ValueError):
            normalize_posture_annotation("not_visible", ["forward_head"])

    def test_shoulder_directions_are_mutually_exclusive(self):
        with self.assertRaises(ValueError):
            normalize_posture_annotation(
                "visible",
                ["shoulder_tilt_left", "shoulder_tilt_right"],
            )


if __name__ == "__main__":
    unittest.main()
