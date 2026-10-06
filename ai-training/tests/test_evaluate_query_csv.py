import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import evaluate_query_csv as evaluation


class QueryCsvEvaluationTests(unittest.TestCase):
    def test_source_queries_keep_supplied_labels_and_reject_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.csv"
            rows = [{"id": str(i), "text": text, "label": label} for i, (text, label) in enumerate([
                ("ordinary learning exercise", "SAFE"), ("verbal teasing fixture", "RISK"),
                ("direct threat fixture", "HIGH_RISK")])]

            def write():
                with path.open("w", encoding="utf-8-sig", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=["id", "text", "label"])
                    writer.writeheader()
                    writer.writerows(rows)

            write()
            before = path.read_bytes()
            self.assertEqual(evaluation.read_queries(path), rows)
            self.assertEqual(path.read_bytes(), before)
            rows[1]["text"] = rows[0]["text"]
            write()
            with self.assertRaisesRegex(ValueError, "Duplicate query"):
                evaluation.read_queries(path)

    def test_changed_artifact_is_rejected_before_predictions(self):
        with tempfile.TemporaryDirectory(dir=evaluation.ARTIFACT_ROOT) as directory, \
             patch.object(evaluation, "sha256", return_value="changed"), \
             patch.object(evaluation, "load_model") as predict:
            with self.assertRaisesRegex(ValueError, "candidate lock"):
                evaluation.run(Path("unused.csv"), Path(directory))
            predict.assert_not_called()

    def test_reference_overlap_is_reported_without_copying_query_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for split in ("train", "validation", "test"):
                (root / f"{split}.jsonl").write_text(json.dumps({
                    "id": f"old-{split}", "text": "reference confidential test phrase",
                    "split": split, "label": "SAFE"}) + "\n", encoding="utf-8")
            report = evaluation.overlap_audit([{
                "id": "new", "text": "reference confidential test phrase", "label": "RISK"}], root)
            self.assertEqual(len(report["exact_text_overlap"]), 1)
            self.assertEqual(len(report["near_reference_overlap"]), 1)
            self.assertNotIn("confidential test phrase", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
