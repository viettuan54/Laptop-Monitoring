import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from school_violence.exclude_ambiguous_queries import EXCLUDED_IDS, build_filtered_query


class ExcludeAmbiguousQueriesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.source, self.output, self.manifest = (
            base / name for name in ("source.csv", "output.csv", "manifest.json")
        )
        fields = ["id", "text", "label", "query_type", "group_id", "split", "dataset_version", "review_status"]
        rows = [
            [identifier, f"cau {index}", "RISK", "very_short_or_ambiguous", f"group-{index}", "test", "v2.3", "unreviewed"]
            for index, identifier in enumerate(EXCLUDED_IDS)
        ]
        rows.extend([
            ["keep-short", "cau ngan khac", "RISK", "very_short_or_ambiguous", "keep-group", "test", "v2.3", "unreviewed"],
            ["keep-train", "cau train", "SAFE", "ordinary", "train-group", "train", "v2.3", "unreviewed"],
        ])
        with self.source.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(fields)
            writer.writerows(rows)
        self.source_bytes = self.source.read_bytes()
        self.sha256 = hashlib.sha256(self.source_bytes).hexdigest()

    def build(self):
        return build_filtered_query(self.source, self.output, self.manifest,
                                    expected_source_sha256=self.sha256)

    def test_removes_only_selected_test_ids_and_preserves_source(self):
        report = self.build()
        with self.output.open(encoding="utf-8-sig", newline="") as handle:
            retained = list(csv.DictReader(handle))
        self.assertEqual(report["excluded_ids"], list(EXCLUDED_IDS))
        self.assertEqual(report["excluded_by_split"], {"test": 13})
        self.assertEqual(report["filter_scope"], "test_only")
        self.assertFalse(report["test_score_independent"])
        self.assertEqual(report["excluded_rows_original_test_label"], "RISK")
        self.assertEqual(report["excluded_rows_user_confirmed_model_label"], "HIGH_RISK")
        self.assertEqual([row["id"] for row in retained], ["keep-short", "keep-train"])
        self.assertTrue(all(row["dataset_version"] == "v2.4" for row in retained))
        self.assertTrue(all(row["review_status"] == "unreviewed" for row in retained))
        self.assertEqual(self.source.read_bytes(), self.source_bytes)
        self.assertEqual(json.loads(self.manifest.read_text(encoding="utf-8")), report)
        with self.assertRaises(FileExistsError):
            self.build()

    def test_rejects_changed_source_or_exclusion_metadata(self):
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            build_filtered_query(self.source, self.output, self.manifest,
                                 expected_source_sha256="0" * 64)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.manifest.exists())
        contents = self.source.read_text(encoding="utf-8-sig").replace("very_short_or_ambiguous", "ordinary", 1)
        self.source.write_text(contents, encoding="utf-8-sig")
        with self.assertRaisesRegex(ValueError, "metadata"):
            build_filtered_query(self.source, self.output, self.manifest,
                                 expected_source_sha256=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertFalse(self.output.exists())

    def test_rejects_missing_id_without_writing_output(self):
        contents = self.source.read_text(encoding="utf-8-sig").replace(EXCLUDED_IDS[0], "different", 1)
        self.source.write_text(contents, encoding="utf-8-sig")
        with self.assertRaisesRegex(ValueError, "absent"):
            build_filtered_query(self.source, self.output, self.manifest,
                                 expected_source_sha256=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertFalse(self.output.exists())
        self.assertFalse(self.manifest.exists())


if __name__ == "__main__":
    unittest.main()
