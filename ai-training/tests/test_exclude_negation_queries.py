import csv
import tempfile
import unittest
from pathlib import Path

from school_violence.exclude_negation_queries import build_filtered_query


class ExcludeNegationQueriesTests(unittest.TestCase):
    def test_excludes_annotated_cohort_from_all_splits_and_keeps_real_help_question(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, output, manifest = (base / name for name in ("source.csv", "output.csv", "manifest.json"))
            fields = ["id", "text", "label", "query_type", "group_id", "split", "dataset_version", "review_status"]
            rows = [
                ["neg-train", "em khong bi danh", "RISK", "negation_hard_negative", "g1", "train", "v2.2", "unreviewed"],
                ["neg-test", "khong ai bat nat em", "RISK", "negation_hard_negative", "g2", "test", "v2.2", "unreviewed"],
                ["help", "co ai giup em khong", "HIGH_RISK", "direct_personal_risk", "g3", "validation", "v2.2", "unreviewed"],
            ]
            with source.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(fields)
                writer.writerows(rows)
            before = source.read_bytes()
            report = build_filtered_query(source, output, manifest)
            with output.open(encoding="utf-8-sig", newline="") as handle:
                retained = list(csv.DictReader(handle))
            self.assertEqual(report["excluded_rows"], 2)
            self.assertEqual(set(report["excluded_ids"]), {"neg-train", "neg-test"})
            self.assertEqual(report["excluded_by_split"], {"train": 1, "test": 1})
            self.assertEqual([row["id"] for row in retained], ["help"])
            self.assertEqual(retained[0]["dataset_version"], "v2.3")
            self.assertEqual(retained[0]["review_status"], "unreviewed")
            self.assertEqual(source.read_bytes(), before)
            with self.assertRaises(FileExistsError):
                build_filtered_query(source, output, manifest)


if __name__ == "__main__":
    unittest.main()
