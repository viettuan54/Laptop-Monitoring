import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.audit_labels_v2_2 import audit, sha256


class LabelAuditV22Tests(unittest.TestCase):
    def test_priority_queue_is_not_a_human_review_or_relabel(self):
        base = ROOT.parent / "Mô tả"
        query = base / "laptopmonitoring_query_dataset_v2_2.csv"
        page = base / "laptopmonitoring_webpage_dataset_v2_2.csv"
        if not query.exists() or not page.exists():
            self.skipTest("v2.2 datasets are not in this checkout")
        before = (sha256(query), sha256(page))
        report, queue = audit(query, page)
        self.assertEqual(report["queue_by_priority"][1], 100)
        self.assertEqual(report["queue_by_priority"][2], 393)
        self.assertEqual(report["human_review_decisions_applied"], 0)
        self.assertEqual(report["changed_labels"], 0)
        self.assertEqual(report["source_review_status"], {"unreviewed": 11986})
        self.assertEqual(report["observations"]["negation_RISK_consistent_template"], 211)
        self.assertEqual(report["observations"]["negation_SAFE_consistent_template"], 182)
        self.assertEqual(report["observations"].get("quote_metadata_mismatches", 0), 0)
        self.assertEqual(report["observations"].get("educational_quote_without_context_cue", 0), 0)
        self.assertEqual(len(queue), len({item["id"] for item in queue}))
        self.assertTrue(all(item["review_status"] == "unreviewed" for item in queue))
        self.assertEqual(before, (sha256(query), sha256(page)))


if __name__ == "__main__":
    unittest.main()
