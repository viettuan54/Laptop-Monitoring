import os
import sys
import unittest


TRAINING_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TRAINING_ROOT not in sys.path:
    sys.path.insert(0, TRAINING_ROOT)
AGENT_COMPANION_ROOT = os.path.join(
    os.path.dirname(TRAINING_ROOT),
    "child-monitor-agent",
    "companion",
)
if AGENT_COMPANION_ROOT not in sys.path:
    sys.path.insert(0, AGENT_COMPANION_ROOT)

from posture_model import FRAME_FEATURE_NAMES, PRIMARY_CLASSES, window_feature_names
from training.train_posture_baseline import train_with_loso


class TrainPostureBaselineTest(unittest.TestCase):
    @staticmethod
    def _dataset(subject_count=3):
        samples = []
        good_vectors = []
        feature_count = len(window_feature_names())
        for subject_index in range(subject_count):
            subject_id = f"subject-{subject_index + 1}"
            for class_index, class_name in enumerate(PRIMARY_CLASSES):
                for sample_index in range(5):
                    features = [0.0] * feature_count
                    features[class_index] = 10.0 + (subject_index * 0.01)
                    features[-1] = sample_index * 0.001
                    samples.append(
                        {
                            "features": features,
                            "label": class_name,
                            "subject_id": subject_id,
                            "session_id": f"session-{subject_index}-{class_index}",
                        }
                    )
                if class_name == "good":
                    good_vectors.extend(
                        [[0.0] * len(FRAME_FEATURE_NAMES) for _ in range(5)]
                    )
        return samples, good_vectors

    def test_three_subject_loso_builds_valid_final_model(self):
        samples, good_vectors = self._dataset()
        model, report = train_with_loso(
            samples,
            good_vectors,
            window_size=10,
        )
        self.assertEqual(report["evaluation_method"], "leave_one_subject_out")
        self.assertEqual(len(report["folds"]), 3)
        self.assertEqual(report["mean_accuracy"], 1.0)
        self.assertTrue(report["acceptance"]["passed"])
        self.assertTrue(model["deployment_approved"])
        self.assertEqual(model["training_summary"]["subject_count"], 3)

    def test_loso_rejects_fewer_than_three_subjects(self):
        samples, good_vectors = self._dataset(subject_count=2)
        with self.assertRaisesRegex(ValueError, "three subjects"):
            train_with_loso(samples, good_vectors, window_size=10)


if __name__ == "__main__":
    unittest.main()
