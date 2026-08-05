import os
import sys
import unittest


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from posture_model import (
    FRAME_FEATURE_NAMES,
    PRIMARY_CLASSES,
    PostureBaselineClassifier,
    aggregate_feature_window,
    extract_posture_features,
    window_feature_names,
)


def _pose():
    points = [
        {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 1.0}
        for _ in range(33)
    ]
    points[7].update(x=0.43, y=0.25)
    points[8].update(x=0.57, y=0.25)
    points[11].update(x=0.35, y=0.45)
    points[12].update(x=0.65, y=0.45)
    points[23].update(x=0.40, y=0.80)
    points[24].update(x=0.60, y=0.80)
    return points


class PostureModelTest(unittest.TestCase):
    @staticmethod
    def _model(target_vector, *, identical=False):
        aggregated = aggregate_feature_window([target_vector] * 3)
        centroids = {}
        for index, class_name in enumerate(PRIMARY_CLASSES):
            if identical:
                centroid = aggregated
            elif class_name == "good":
                centroid = aggregated
            else:
                centroid = [value + 10.0 + index for value in aggregated]
            centroids[class_name] = centroid
        return {
            "model_version": "1.0.0",
            "model_type": "nearest_centroid_window",
            "frame_feature_names": list(FRAME_FEATURE_NAMES),
            "window_feature_names": list(window_feature_names()),
            "window_size": 3,
            "sample_interval_seconds": 0.5,
            "classes": list(PRIMARY_CLASSES),
            "minimum_confidence": 0.65,
            "temperature": 1.0,
            "scaler_mean": [0.0] * len(aggregated),
            "scaler_scale": [1.0] * len(aggregated),
            "centroids": centroids,
            "reference_good_frame": target_vector,
            "deployment_approved": True,
        }

    def test_extract_requires_full_visible_upper_body(self):
        points = _pose()
        self.assertEqual(
            len(extract_posture_features(points, 640, 480)),
            len(FRAME_FEATURE_NAMES),
        )
        points[23]["visibility"] = 0.1
        self.assertIsNone(extract_posture_features(points, 640, 480))

    def test_window_classifier_waits_then_returns_conclusive_prediction(self):
        points = _pose()
        vector = extract_posture_features(points, 640, 480)
        classifier = PostureBaselineClassifier(self._model(vector))
        self.assertIsNone(classifier.observe(points, 640, 480))
        self.assertIsNone(classifier.observe(points, 640, 480))
        result = classifier.observe(points, 640, 480)
        self.assertEqual(result["predicted_class"], "good")
        self.assertTrue(result["conclusive"])

    def test_ambiguous_model_is_inconclusive_for_rule_fallback(self):
        points = _pose()
        vector = extract_posture_features(points, 640, 480)
        classifier = PostureBaselineClassifier(
            self._model(vector, identical=True)
        )
        for _ in range(3):
            result = classifier.observe(points, 640, 480)
        self.assertFalse(result["conclusive"])
        self.assertAlmostEqual(result["confidence"], 1.0 / 6.0, places=3)


if __name__ == "__main__":
    unittest.main()
