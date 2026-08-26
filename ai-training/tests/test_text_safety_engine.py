import sys
import unittest
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from text_safety.engine import ContextRuleEngine, ModerationInput
from text_safety.normalization import normalize_text


class TextSafetyNormalizationTest(unittest.TestCase):
    def test_normalizes_teencode_and_obfuscated_letters(self):
        normalized = normalize_text("K.o muốn c.h.ế.t")

        self.assertIn("khong", normalized.folded)
        self.assertIn("chet", normalized.folded)

    def test_does_not_confuse_vietnamese_tu_tu_with_self_harm_phrase(self):
        engine = ContextRuleEngine()

        result = engine.moderate(
            ModerationInput("safe-1", "Em cứ từ từ thôi nhé", "chat_received")
        )

        self.assertFalse(result["flagged"])
        self.assertEqual(result["action"], "allow")
        self.assertEqual(result["riskType"], "none")


class ContextRuleEngineTest(unittest.TestCase):
    def setUp(self):
        self.engine = ContextRuleEngine()

    def moderate(
        self,
        text,
        source_type="chat_authored",
        direction="authored",
        context=(),
    ):
        return self.engine.moderate(
            ModerationInput(
                item_id="test-item",
                text=text,
                source_type=source_type,
                direction=direction,
                context=tuple(context),
            )
        )

    def test_safe_text_is_allowed(self):
        result = self.moderate("Ngày mai mình cùng làm bài tập nhé")

        self.assertFalse(result["flagged"])
        self.assertEqual(result["action"], "allow")
        self.assertEqual(result["severity"], "low")

    def test_first_person_self_harm_intent_is_critical(self):
        result = self.moderate("Mình không còn muốn sống nữa")

        self.assertTrue(result["flagged"])
        self.assertEqual(result["riskType"], "self_harm")
        self.assertEqual(result["primaryCategory"], "self-harm/intent")
        self.assertEqual(result["severity"], "critical")
        self.assertIn("first_person_self_harm_intent", result["matchedSignals"])

    def test_method_search_is_critical(self):
        result = self.moderate(
            "cách tự tử",
            source_type="search_query",
            direction="unknown",
        )

        self.assertTrue(result["flagged"])
        self.assertEqual(result["primaryCategory"], "self-harm/instructions")

    def test_protective_context_does_not_become_self_harm_alert(self):
        result = self.moderate(
            "Bài viết phòng chống tự tử và giúp đỡ nạn nhân",
            source_type="page_content",
            direction="unknown",
        )

        self.assertFalse(result["flagged"])
        self.assertNotEqual(result["action"], "alert")

    def test_received_targeted_threat_is_critical(self):
        result = self.moderate(
            "Tao sẽ đánh mày",
            source_type="chat_received",
            direction="received",
        )

        self.assertTrue(result["flagged"])
        self.assertEqual(result["riskType"], "harassment")
        self.assertEqual(result["primaryCategory"], "harassment/threatening")
        self.assertIn("received_message_context", result["matchedSignals"])

    def test_repeated_context_can_raise_harassment_risk(self):
        result = self.moderate(
            "Đừng nhắn cho mình nữa",
            source_type="chat_received",
            direction="received",
            context=("Mày là đồ ngu", "Mày là đồ vô dụng"),
        )

        self.assertTrue(result["flagged"])
        self.assertEqual(result["riskType"], "harassment")
        self.assertIn("repeated_context_signal", result["matchedSignals"])

    def test_batch_preserves_order_and_ids(self):
        results = self.engine.moderate_batch(
            [
                ModerationInput("one", "Chào bạn", "chat_received"),
                ModerationInput("two", "Tao sẽ đánh mày", "chat_received"),
            ]
        )

        self.assertEqual([result["id"] for result in results], ["one", "two"])


if __name__ == "__main__":
    unittest.main()
