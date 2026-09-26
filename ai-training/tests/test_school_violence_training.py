import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.predict import load_model
from school_violence.training import LABELS, evaluate, fit, load_source, predict, run, split_records


class SchoolViolenceTrainingTests(unittest.TestCase):
    def test_rejects_private_or_non_synthetic_training_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "data.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "split", "source", "review_status"])
                writer.writerow(["one", "Liên hệ child@example.com", "SAFE", "train", "synthetic", ""])
            with self.assertRaisesRegex(ValueError, "Potential private identifier") as captured:
                load_source(source)
            self.assertNotIn("child@example.com", str(captured.exception))
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "split", "source", "review_status"])
                writer.writerow(["one", "Một câu ví dụ", "SAFE", "train", "internal", "reviewed"])
            with self.assertRaisesRegex(ValueError, "only accepts synthetic"):
                load_source(source)

    def test_dedup_and_grouped_split(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "data.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["id", "text", "label", "split", "source", "review_status"])
                for label in LABELS:
                    for index in range(12):
                        writer.writerow([f"{label}-{index}", f"Ví dụ {label} số {index}", label,
                                         "train" if index % 2 else "test", "synthetic", ""])
                writer.writerow(["duplicate", "VÍ DỤ SAFE SỐ 0", "SAFE", "train", "synthetic", ""])
            records, audit = load_source(source)
            self.assertEqual(audit["removed_duplicate_rows"], 1)
            self.assertGreater(audit["original_cross_split_groups"], 0)
            splits, report = split_records(records)
            self.assertEqual(report["cross_split_normalized_groups"], 0)
            for name in ("train", "validation", "test"):
                self.assertEqual(set(LABELS), {row["label"] for row in splits[name]})
            model = fit(splits["train"], 1.0)
            self.assertIn(predict(model, "Ví dụ SAFE số 1"), LABELS)
            self.assertIn("confusion_matrix", evaluate(model, splits["test"]))
            output = Path(directory) / "artifact"
            report = run(source, output)
            self.assertFalse(report["deployment_eligible"])
            self.assertEqual(sum(report["split"]["counts"][name][label]
                                 for name in ("train", "validation", "test") for label in LABELS), 36)
            self.assertEqual(tuple(load_model(output / "model.json.gz")["labels"]), LABELS)
            with self.assertRaises(FileExistsError):
                run(source, output)


if __name__ == "__main__":
    unittest.main()
