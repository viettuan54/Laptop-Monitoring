import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from text_safety.review import apply_reviews


class ThreeLabelReviewTest(unittest.TestCase):
    def test_one_decision_per_row_and_no_source_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source.csv"
            decisions = base / "decisions.jsonl"
            output = base / "reviewed.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "split", "source", "review_status"])
                writer.writerow(["item-1", "Câu ví dụ", "RISK", "train", "synthetic", ""])
            decisions.write_text(json.dumps({"id": "item-1", "label": "SAFE", "annotator_id": "reviewer-1"}) + "\n", encoding="utf-8")
            self.assertEqual(apply_reviews(source, decisions, output)["labels"]["SAFE"], 1)
            with output.open("r", encoding="utf-8", newline="") as handle:
                row = next(csv.DictReader(handle))
            self.assertEqual(row["label"], "SAFE")
            self.assertEqual(row["review_status"], "reviewed")
            with self.assertRaises(FileExistsError):
                apply_reviews(source, decisions, output)
            with source.open("r", encoding="utf-8", newline="") as handle:
                self.assertEqual(next(csv.DictReader(handle))["label"], "RISK")


if __name__ == "__main__":
    unittest.main()
