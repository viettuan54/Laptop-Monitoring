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
            decisions.write_text(json.dumps({"id": "item-1", "label": "SAFE"}) + "\n", encoding="utf-8")
            self.assertEqual(apply_reviews(source, decisions, output)["labels"]["SAFE"], 1)
            with output.open("r", encoding="utf-8", newline="") as handle:
                row = next(csv.DictReader(handle))
            self.assertEqual(row["label"], "SAFE")
            self.assertEqual(row["review_status"], "reviewed")
            self.assertNotIn("annotator_id", row)
            with self.assertRaises(FileExistsError):
                apply_reviews(source, decisions, output)
            with source.open("r", encoding="utf-8", newline="") as handle:
                self.assertEqual(next(csv.DictReader(handle))["label"], "RISK")

    def test_partial_decisions_only_mark_submitted_rows_reviewed(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, decisions, output = base / "source.csv", base / "decisions.jsonl", base / "reviewed.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "group_id", "split", "source", "review_status", "dataset_version", "annotation_status"])
                writer.writerow(["item-1", "Em bị đánh", "RISK", "g1", "train", "synthetic", "unreviewed", "v2.2", "needs_human_context_review"])
                writer.writerow(["item-2", "Học toán", "SAFE", "g2", "test", "synthetic", "unreviewed", "v2.2", "automated_policy_alignment_unreviewed"])
            original = source.read_bytes()
            decisions.write_text(json.dumps({"id": "item-1", "label": "HIGH_RISK"}) + "\n", encoding="utf-8")
            result = apply_reviews(source, decisions, output, dataset_version="v2.3")
            self.assertEqual(result["decisions_applied"], 1)
            self.assertEqual(result["reviewed_rows"], 1)
            self.assertEqual(result["changed_labels"], 1)
            self.assertEqual(result["dataset_version"], "v2.3")
            with output.open("r", encoding="utf-8-sig", newline="") as handle:
                rows = {row["id"]: row for row in csv.DictReader(handle)}
            self.assertEqual(rows["item-1"]["label"], "HIGH_RISK")
            self.assertEqual(rows["item-1"]["label_before_human_review"], "RISK")
            self.assertNotIn("annotator_id", rows["item-1"])
            self.assertEqual(rows["item-1"]["review_status"], "reviewed")
            self.assertEqual(rows["item-1"]["annotation_status"], "human_reviewed")
            self.assertEqual(rows["item-2"]["label"], "SAFE")
            self.assertEqual(rows["item-2"]["review_status"], "unreviewed")
            self.assertEqual(rows["item-2"]["annotation_status"], "automated_policy_alignment_unreviewed")
            self.assertNotIn("annotator_id", rows["item-2"])
            self.assertEqual(rows["item-2"]["label_before_human_review"], "")
            self.assertEqual({row["dataset_version"] for row in rows.values()}, {"v2.3"})
            self.assertEqual(source.read_bytes(), original)

    def test_rejects_missing_decision_version_and_equivalent_label_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, decisions, output = base / "source.csv", base / "decisions.jsonl", base / "reviewed.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "text_normalized", "label", "split", "source", "review_status", "dataset_version"])
                writer.writerow(["one", "bi bat nat", "bị bắt nạt", "RISK", "train", "synthetic", "unreviewed", "v2.2"])
                writer.writerow(["two", "bị bắt nạt", "bị bắt nạt", "RISK", "train", "synthetic", "unreviewed", "v2.2"])
            decisions.write_text(json.dumps({"id": "one", "label": "HIGH_RISK"}) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "dataset_version"):
                apply_reviews(source, decisions, output)
            with self.assertRaisesRegex(ValueError, "dataset_version"):
                apply_reviews(source, decisions, output, dataset_version="v2.2")
            with self.assertRaisesRegex(ValueError, "Conflicting labels for equivalent"):
                apply_reviews(source, decisions, output, dataset_version="v2.3")
            self.assertFalse(output.exists())
            decisions.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "at least one decision"):
                apply_reviews(source, decisions, output, dataset_version="v2.3")
            decisions.write_text(json.dumps({"id": "missing", "label": "RISK"}) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "known unique source IDs"):
                apply_reviews(source, decisions, output, dataset_version="v2.3")

    def test_partial_relabel_cannot_split_an_originally_consistent_group(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, decisions, output = base / "source.csv", base / "decisions.jsonl", base / "reviewed.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "group_id", "split", "source", "review_status", "dataset_version"])
                writer.writerow(["one", "Bị bắt nạt thì làm sao", "RISK", "linked", "train", "synthetic", "unreviewed", "v2.2"])
                writer.writerow(["two", "Bị bắt nạt xử lý thế nào", "RISK", "linked", "train", "synthetic", "unreviewed", "v2.2"])
            decisions.write_text(json.dumps({"id": "one", "label": "HIGH_RISK"}) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "single-label group"):
                apply_reviews(source, decisions, output, dataset_version="v2.3")
            self.assertFalse(output.exists())

    def test_legacy_reviewer_column_is_dropped_and_reviewed_rows_need_no_code(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, decisions, output = base / "source.csv", base / "decisions.jsonl", base / "reviewed.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "split", "source", "review_status", "annotator_id"])
                writer.writerow(["one", "Hoc toan", "SAFE", "train", "synthetic", "reviewed", ""])
                writer.writerow(["two", "Can giup do", "RISK", "train", "synthetic", "unreviewed", ""])
            decisions.write_text(json.dumps({"id": "two", "label": "RISK", "annotator_id": "legacy"}), encoding="utf-8")
            report = apply_reviews(source, decisions, output)
            self.assertEqual(report["reviewed_rows"], 2)
            with output.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertTrue(all("annotator_id" not in row for row in rows))


if __name__ == "__main__":
    unittest.main()
