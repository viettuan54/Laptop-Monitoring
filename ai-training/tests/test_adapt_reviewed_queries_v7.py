import csv
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence import adapt_reviewed_queries_v7 as adaptation


class ReviewedQueryAdaptationTests(unittest.TestCase):
    def test_near_duplicate_queries_stay_in_one_development_fold(self):
        rows = [
            {"id": "1", "text": "ordinary mathematics homework", "label": "SAFE"},
            {"id": "2", "text": "ordinary geography revision", "label": "SAFE"},
            {"id": "3", "text": "classmate took my blue notebook", "label": "RISK"},
            {"id": "4", "text": "classmate took my red notebook", "label": "RISK"},
            {"id": "5", "text": "uncomfortable before recess", "label": "RISK"},
            {"id": "6", "text": "someone threatened to hit me", "label": "HIGH_RISK"},
            {"id": "7", "text": "someone forced me to hand over money", "label": "HIGH_RISK"},
        ]
        with patch.object(adaptation, "FOLDS", 2):
            folds, group_count = adaptation.make_cv_folds(rows)
        self.assertEqual(group_count, len(rows) - 1)
        self.assertEqual(len(folds), 2)
        self.assertTrue(any({2, 3}.issubset(set(fold)) for fold in folds))
        self.assertEqual(sorted(index for fold in folds for index in fold), list(range(len(rows))))

    def test_changed_review_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            review = Path(directory) / "review.csv"
            with review.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["id", "text", "label"])
                writer.writeheader()
                writer.writerow({"id": "1", "text": "fixture", "label": "SAFE"})
            with self.assertRaisesRegex(ValueError, "changed"):
                adaptation.load_real_review(review)

    def test_training_requires_authorization_and_local_artifact_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate"
            with self.assertRaisesRegex(ValueError, "authorization"):
                adaptation.build_candidate(path, path, path, path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact directory"):
                adaptation.build_candidate(path, path, path, path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
