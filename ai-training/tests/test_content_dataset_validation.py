import csv
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.validate_dataset import (
    DatasetContractError,
    load_taxonomy,
    main,
    normalize_app_name,
    normalize_domain,
    validate_csv_dataset,
)


class ContentDatasetValidationTest(unittest.TestCase):
    @staticmethod
    def _write_csv(path, headers, rows):
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(headers)
            writer.writerows(rows)

    def test_example_datasets_pass_the_contract(self):
        apps = validate_csv_dataset(
            "apps", TRAINING_ROOT / "datasets" / "content" / "apps.example.csv"
        )
        websites = validate_csv_dataset(
            "websites",
            TRAINING_ROOT / "datasets" / "content" / "websites.example.csv",
        )

        self.assertEqual(apps["status"], "passed")
        self.assertEqual(apps["valid_unique_record_count"], 6)
        self.assertEqual(apps["label_counts"]["browsers"], 3)
        self.assertEqual(websites["status"], "passed")
        self.assertEqual(websites["valid_unique_record_count"], 5)

    def test_normalization_matches_runtime_identifiers(self):
        self.assertEqual(normalize_app_name("  Chrome.EXE  "), "chrome.exe")
        self.assertEqual(normalize_domain("WWW.Example.COM."), "example.com")
        self.assertEqual(normalize_domain("münchen.example"), "xn--mnchen-3ya.example")

        with self.assertRaisesRegex(ValueError, "not a path"):
            normalize_app_name(r"C:\\Program Files\\Browser\\chrome.exe")
        with self.assertRaisesRegex(ValueError, "scheme"):
            normalize_domain("https://example.com/path")

    def test_conflicting_case_insensitive_app_key_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "apps.csv"
            self._write_csv(
                path,
                ["app_name", "display_name", "label"],
                [
                    ["chrome.exe", "Chrome", "browsers"],
                    ["Chrome.EXE", "Duplicate", "learning"],
                    ["word.exe", "Word", "learning"],
                    ["game.exe", "Game", "entertainment"],
                    ["other.exe", "Other", "unknown"],
                ],
            )
            report = validate_csv_dataset("apps", path)

        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["duplicate_count"], 1)
        self.assertTrue(
            any("Conflicting labels" in issue["message"] for issue in report["errors"])
        )

    def test_invalid_label_url_and_column_count_are_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            invalid_label = root / "invalid-label.csv"
            self._write_csv(
                invalid_label,
                ["domain", "title", "label"],
                [
                    ["learn.example", "Learn", "education"],
                    ["video.example", "Video", "entertainment"],
                    ["social.example", "Social", "social"],
                    ["unsafe.example", "Unsafe", "unsafe"],
                    ["unknown.example", "Unknown", "not-a-label"],
                ],
            )
            label_report = validate_csv_dataset("websites", invalid_label)

            malformed = root / "malformed.csv"
            malformed.write_text(
                "domain,title,label\n"
                "https://learn.example/path,Learn,education\n"
                "video.example,Video,entertainment,extra\n",
                encoding="utf-8",
            )
            malformed_report = validate_csv_dataset("websites", malformed)

        self.assertEqual(label_report["status"], "failed")
        self.assertTrue(
            any("not-a-label" in issue["message"] for issue in label_report["errors"])
        )
        messages = [issue["message"] for issue in malformed_report["errors"]]
        self.assertTrue(any("scheme" in message for message in messages))
        self.assertTrue(any("column count" in message for message in messages))

    def test_taxonomy_is_fixed_to_labels_and_threshold(self):
        taxonomy = load_taxonomy()
        self.assertEqual(taxonomy["confidence_threshold"], 0.7)
        self.assertEqual(
            taxonomy["resources"]["app"]["labels"],
            ["learning", "entertainment", "browsers", "unknown"],
        )

        with tempfile.TemporaryDirectory() as temporary:
            invalid_path = Path(temporary) / "taxonomy.json"
            invalid = dict(taxonomy)
            invalid["confidence_threshold"] = 0.75
            invalid_path.write_text(json.dumps(invalid), encoding="utf-8")
            with self.assertRaisesRegex(DatasetContractError, "must be 0.7"):
                load_taxonomy(invalid_path)

    def test_cli_writes_machine_readable_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            report_path = Path(temporary) / "validation.json"
            output = io.StringIO()
            with redirect_stdout(output):
                exit_code = main(
                    [
                        "--apps",
                        str(
                            TRAINING_ROOT
                            / "datasets"
                            / "content"
                            / "apps.example.csv"
                        ),
                        "--websites",
                        str(
                            TRAINING_ROOT
                            / "datasets"
                            / "content"
                            / "websites.example.csv"
                        ),
                        "--report",
                        str(report_path),
                    ]
                )
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["status"], "passed")
        self.assertIn("apps", payload["datasets"])
        self.assertIn("websites", payload["datasets"])
        self.assertIn("Content dataset validation: passed", output.getvalue())


if __name__ == "__main__":
    unittest.main()
