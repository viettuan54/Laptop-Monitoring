import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.audit_holdout_candidate import audit_candidate


class CandidateAuditTests(unittest.TestCase):
    def test_reports_all_candidate_problems_without_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.jsonl"
            rows = [
                {
                    "id": "one", "text": "sensitive example", "label": "SAFE",
                    "source_type": "search_query", "group_id": "g1", "split": "test",
                    "source": "real_world", "review_status": "reviewed",
                    "annotator_id": "", "pii_removed": True,
                    "permission_reference": "not_applicable_synthetic", "dataset_version": "draft",
                },
                {
                    "id": "two", "text": "sensitive example", "label": "RISK",
                    "source_type": "search_query", "group_id": "g2", "split": "test",
                    "source": "real_world", "review_status": "reviewed",
                    "annotator_id": "", "pii_removed": True,
                    "permission_reference": "not_applicable_synthetic", "dataset_version": "draft",
                },
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            report = audit_candidate(path)
        self.assertEqual(report["issues"]["review_not_verifiable"]["count"], 2)
        self.assertEqual(report["issues"]["permission_reference_placeholder"]["count"], 2)
        self.assertEqual(report["issues"]["duplicate_normalized_text"]["ids"], ["two"])
        self.assertEqual(report["issues"]["missing_source_label_strata"]["count"], 4)
        self.assertFalse(report["schema_ready_for_official_evaluator"])
        self.assertFalse(report["deployment_eligible"])
        self.assertNotIn("sensitive example", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
