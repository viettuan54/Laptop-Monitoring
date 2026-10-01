import gzip
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.evaluate_real_world import evaluate_holdout, load_holdout, main
from school_violence.training import LABELS, fit


def holdout_row(identifier, label, source_type, text):
    # Synthetic unit-test fixture only; not a real-world evaluation sample.
    return {
        "id": identifier, "text": text, "label": label, "source_type": source_type,
        "group_id": f"holdout-group-{identifier}", "split": "test",
        "source": "real_world", "review_status": "reviewed",
        "pii_removed": True,
        "permission_reference": "fixture-permission", "dataset_version": "fixture-v1",
    }


class RealWorldEvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "artifact"
        self.artifacts.mkdir()
        self.holdout = self.root / "holdout.jsonl"
        train = [{"text": f"training sample {label}", "label": label} for label in LABELS]
        model = fit(train, 0.5)
        model["combined_dataset_sha256"] = "fixture-combined-sha"
        with gzip.open(self.artifacts / "model.json.gz", "wt", encoding="utf-8") as handle:
            json.dump(model, handle)
        (self.artifacts / "evaluation_report.json").write_text(json.dumps({
            "model_version": model["model_version"],
            "source_audit": {"combined_dataset_sha256": "fixture-combined-sha"},
        }), encoding="utf-8")
        for split in ("train", "validation", "test"):
            with (self.artifacts / f"{split}.jsonl").open("w", encoding="utf-8") as handle:
                for label in LABELS:
                    handle.write(json.dumps({
                        "id": f"ref-{split}-{label}",
                        "source_ids": [f"ref-{split}-{label}"],
                        "group_id": f"reference-{split}-{label}",
                        "group_ids": [f"reference-{split}-{label}"],
                        "split": split,
                        "text": f"reference {split} {label}",
                    }) + "\n")
        self.rows = [
            holdout_row(f"{source_type}-{label}", label, source_type,
                        f"holdout {source_type} {label}")
            for source_type in ("search_query", "page_content") for label in LABELS
        ]
        self._write_rows()

    def tearDown(self):
        self.temp.cleanup()

    def _write_rows(self):
        self.holdout.write_text("".join(json.dumps(row) + "\n" for row in self.rows), encoding="utf-8")

    def test_reports_high_risk_misses_without_text_and_never_approves(self):
        def fake_predict(_model, text):
            if text == "holdout search_query HIGH_RISK":
                return "RISK"
            return text.split()[-1]

        with patch("school_violence.training.predict", side_effect=fake_predict):
            report = evaluate_holdout(self.holdout, self.artifacts)
        self.assertEqual(report["holdout"]["rows"], 6)
        self.assertEqual(report["high_risk_false_negative_count"], 1)
        self.assertEqual(report["high_risk_false_negatives"], [{
            "id": "search_query-HIGH_RISK", "source_type": "search_query", "predicted": "RISK",
        }])
        self.assertEqual(report["overall"]["per_label"]["HIGH_RISK"]["false_negative"], 1)
        self.assertFalse(report["deployment_eligible"])
        self.assertNotIn("holdout search_query HIGH_RISK", json.dumps(report))

    def test_rejects_undeclared_review_permission_and_private_identifiers(self):
        for change, expected in [
            ({"review_status": "unreviewed"}, "human review"),
            ({"source": "synthetic"}, "real_world/test"),
            ({"pii_removed": False}, "de-identification"),
            ({"permission_reference": ""}, "permission_reference"),
            ({"permission_reference": "not_applicable_synthetic"}, "placeholder"),
            ({"text": "example@example.com"}, "private identifier"),
            ({"text": "https://example.org/page"}, "private identifier"),
            ({"text": "a" * 1001}, "1000-character limit"),
        ]:
            with self.subTest(change=change):
                self.rows[0].update(change)
                self._write_rows()
                with self.assertRaisesRegex(ValueError, expected):
                    load_holdout(self.holdout)
                self.rows[0] = holdout_row("search_query-SAFE", "SAFE", "search_query",
                                           "holdout search_query SAFE")

    def test_query_only_holdout_needs_no_page_samples_or_reviewer_code(self):
        self.rows = [row for row in self.rows if row["source_type"] == "search_query"]
        self._write_rows()
        report = evaluate_holdout(self.holdout, self.artifacts)
        self.assertEqual(report["holdout"]["rows"], 3)
        self.assertEqual(set(report["by_source_type"]), {"search_query"})
        self.assertFalse(report["deployment_eligible"])

    def test_pages_alone_cannot_validate_search_query_scope(self):
        self.rows = [row for row in self.rows if row["source_type"] == "page_content"]
        self._write_rows()
        with self.assertRaisesRegex(ValueError, "search_query needs all three labels"):
            load_holdout(self.holdout)

    def test_rejects_reference_overlap_and_missing_source_label(self):
        self.rows[0]["text"] = "reference train SAFE"
        self._write_rows()
        with self.assertRaisesRegex(ValueError, "text overlaps"):
            evaluate_holdout(self.holdout, self.artifacts)
        self.rows[0]["text"] = "holdout search_query SAFE"
        self.rows[0]["group_id"] = "reference-test-SAFE"
        self._write_rows()
        with self.assertRaisesRegex(ValueError, "group overlaps"):
            evaluate_holdout(self.holdout, self.artifacts)
        self.rows = self.rows[1:]
        self._write_rows()
        with self.assertRaisesRegex(ValueError, "needs all three labels"):
            load_holdout(self.holdout)

    def test_cli_writes_metrics_without_raw_text(self):
        output = self.root / "result.json"
        argv = ["evaluate_real_world", "--holdout", str(self.holdout),
                "--artifact-dir", str(self.artifacts), "--output", str(output)]
        with patch.object(sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()):
            main()
        report = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(report["holdout"]["rows"], 6)
        self.assertIn("confusion_matrix", report["overall"])
        self.assertFalse(report["deployment_eligible"])
        self.assertNotIn("holdout search_query", output.read_text(encoding="utf-8"))
        with patch.object(sys, "argv", argv), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                main()


if __name__ == "__main__":
    unittest.main()
