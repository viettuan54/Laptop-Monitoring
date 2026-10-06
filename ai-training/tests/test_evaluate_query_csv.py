import csv
import gzip
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
    def test_custom_lock_is_used_and_version_is_checked_before_predictions(self):
        with tempfile.TemporaryDirectory(dir=evaluation.ARTIFACT_ROOT) as directory:
            root = Path(directory)
            artifact = root / "model.json.gz"
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump({"model_version": "actual-fixture", "labels": list(evaluation.LABELS)}, handle)
            lock = root / "lock.json"
            lock.write_text(json.dumps({"artifact_relative_to_ai_training": str(artifact.relative_to(ROOT)),
                "model_sha256": evaluation.sha256(artifact), "model_version": "wrong-fixture"}), encoding="utf-8")
            with patch.object(evaluation, "predict_scores") as predict:
                with self.assertRaisesRegex(ValueError, "version"):
                    evaluation.run(Path("unused.csv"), root / "output", candidate_lock=lock)
                predict.assert_not_called()

    def test_independent_mode_rejects_unknown_metadata_before_predictions(self):
        with tempfile.TemporaryDirectory(dir=evaluation.ARTIFACT_ROOT) as directory:
            root = Path(directory)
            artifact = root / "model.json.gz"
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump({"model_version": "fixture", "labels": list(evaluation.LABELS)}, handle)
            lock = root / "lock.json"
            lock.write_text(json.dumps({"artifact_relative_to_ai_training": str(artifact.relative_to(ROOT)),
                "model_sha256": evaluation.sha256(artifact), "model_version": "fixture"}), encoding="utf-8")
            path = root / "new.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["id", "text", "label"])
                writer.writeheader()
                writer.writerows([dict(id=str(i), text=text, label=label) for i, (text, label) in enumerate([
                    ("independent ordinary reading fixture", "SAFE"), ("independent teasing fixture", "RISK"),
                    ("independent direct threat fixture", "HIGH_RISK")])])
            audit = {"exact_text_overlap": [], "near_reference_overlap": [], "near_pairs_in_new_set": []}
            with patch.object(evaluation, "overlap_audit", return_value=audit), \
                 patch.object(evaluation, "predict_scores") as predict:
                with self.assertRaisesRegex(ValueError, "Independent real-world"):
                    evaluation.run(path, root / "output", candidate_lock=lock, require_independent=True)
                predict.assert_not_called()
            self.assertTrue((root / "output/preflight_audit.json").is_file())
            overlapping = {**audit, "exact_text_overlap": [{"id": "0", "references": []}]}
            with patch.object(evaluation, "overlap_audit", return_value=overlapping), \
                 patch.object(evaluation, "predict_scores") as predict:
                with self.assertRaisesRegex(ValueError, "Independent real-world"):
                    evaluation.run(path, root / "overlap-output", candidate_lock=lock,
                                   require_independent=True, origin="real_world", metadata_confirmed=True)
                predict.assert_not_called()

    def test_inspected_but_untrained_query_is_also_an_overlap_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for split in ("train", "validation", "test"):
                (root / f"{split}.jsonl").write_text(json.dumps({"id": split, "text": "other reference phrase",
                    "split": split, "label": "SAFE"}) + "\n", encoding="utf-8")
            extra = [{"id": "inspected-unused", "text": "inspected confidential query fixture", "label": "RISK", "split": "inspected"}]
            report = evaluation.overlap_audit([{"id": "new", "text": extra[0]["text"], "label": "HIGH_RISK"}],
                                              root, additional_references=extra)
            self.assertEqual(report["exact_text_overlap"][0]["references"][0]["split"], "inspected")
            self.assertNotIn(extra[0]["text"], json.dumps(report))

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
