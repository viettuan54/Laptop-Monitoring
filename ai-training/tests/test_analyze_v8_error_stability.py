import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.analyze_v8_error_stability import summarize_errors


class V8ErrorStabilityTests(unittest.TestCase):
    def test_repeated_errors_are_counted_without_query_text(self):
        rows = [
            {"id": "set:1", "label": "SAFE", "text": "private fixture text"},
            {"id": "set:2", "label": "HIGH_RISK", "text": "another private fixture"},
        ]
        matrix = {
            "SAFE": {"SAFE": 0, "RISK": 1, "HIGH_RISK": 0},
            "RISK": {"SAFE": 0, "RISK": 0, "HIGH_RISK": 0},
            "HIGH_RISK": {"SAFE": 0, "RISK": 1, "HIGH_RISK": 0},
        }
        reports = [
            {"seed": seed, "macro_f1": 0.0, "confusion_matrix": matrix,
             "errors_by_id": [
                 {"id": "set:1", "label": "SAFE", "predicted": "RISK"},
                 {"id": "set:2", "label": "HIGH_RISK", "predicted": "RISK"},
             ]}
            for seed in (1, 2)
        ]
        result = summarize_errors(rows, reports)
        self.assertEqual([item["wrong_count"] for item in result["error_frequency"]], [2, 2])
        self.assertNotIn("private fixture text", json.dumps(result))
        self.assertFalse(result["independent_test"])

    def test_invalid_error_id_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid out-of-fold"):
            summarize_errors([{"id": "set:1", "label": "SAFE", "text": "fixture"}], [
                {"seed": 1, "macro_f1": 0.0, "confusion_matrix": {},
                 "errors_by_id": [{"id": "unknown", "label": "SAFE", "predicted": "RISK"}]}
            ])


if __name__ == "__main__":
    unittest.main()
