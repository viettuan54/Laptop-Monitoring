import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.training import LABELS, fit
from text_safety.engine import ModerationInput, ThreeLabelEngine
from text_safety.normalization import normalize_text


class ThreeLabelEngineTest(unittest.TestCase):
    def test_engine_emits_only_three_label_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            records = [
                {"text": "Chúng mình cùng học bài", "label": "SAFE"},
                {"text": "Bạn ấy trêu em mỗi ngày", "label": "RISK"},
                {"text": "Họ đe dọa đánh em", "label": "HIGH_RISK"},
            ]
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(fit(records, 1.0), handle, ensure_ascii=False)
            engine = ThreeLabelEngine(path)
            results = engine.moderate_batch([
                ModerationInput("one", "Chúng mình cùng học bài", "chat_received"),
                ModerationInput("two", "Họ đe dọa đánh em", "chat_received"),
            ])
            self.assertEqual([item["id"] for item in results], ["one", "two"])
            for result in results:
                self.assertIn(result["label"], LABELS)
                self.assertEqual(set(result["scores"]), set(LABELS))
                self.assertAlmostEqual(sum(result["scores"].values()), 1.0)
                self.assertEqual(result["flagged"], result["label"] != "SAFE")
                self.assertNotIn("primaryCategory", result)

    def test_vietnamese_normalization_remains_available(self):
        normalized = normalize_text("DMM m là n g uuuuuu 💀")
        self.assertIn("dit me may", normalized.unicode)
        self.assertIn("may la ngu", normalized.folded)


if __name__ == "__main__":
    unittest.main()
