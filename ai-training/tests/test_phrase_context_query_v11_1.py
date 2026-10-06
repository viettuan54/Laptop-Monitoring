"""Conservative behavior and transport checks; never training/holdout rows."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence.context_query_model import context_features as v10_context
from school_violence.context_query_model_v11_1 import ALGORITHM, context_features
from school_violence.experiment_phrase_context_v11_1 import fit
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


class PhraseContextTests(unittest.TestCase):
    def test_nonviolent_phrase_loses_physical_features_without_losing_wording(self):
        from school_violence.context_query_model_v11_1 import query_features
        from school_violence.linear_query_model import word_features
        text = "Em đánh giá việc học"
        old, new = v10_context(text), context_features(text)
        self.assertIn("ctx:physical", old)
        self.assertNotIn("ctx:physical", new)
        self.assertNotIn("ctx:self_reference+physical", new)
        self.assertIn("ctx:academic_action", new)
        self.assertTrue(word_features(text) <= query_features(text))
        self.assertEqual(new, {key for key in old if key != "ctx:physical" and not key.endswith("+physical")})

    def test_all_original_context_is_preserved_when_assault_or_no_academic_phrase(self):
        for text in ("Em đang đánh giá việc học nhưng bị bạn đánh", "Em bị bóp cổ",
                     "Em chứng kiến một bạn bị đánh", "Em bị yêu cầu đưa mật khẩu", "Em học toán"):
            with self.subTest(text=text):
                self.assertEqual(context_features(text), v10_context(text))

    def test_phrase_extraction_does_not_force_output_labels(self):
        model = dict(algorithm=ALGORITHM, labels=list(LABELS), head=dict(labels=list(LABELS),
            features={}, bias=[0, 0, 0], fallback_prior=dict(zip(LABELS, (0.1, 0.1, 0.8)))))
        scores = predict_scores(model, "Em đánh giá việc học")
        self.assertEqual(select_label(model, scores), "HIGH_RISK")

    def test_portable_saved_model_matches_training_and_uses_argmax(self):
        rows = [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
            ("SAFE", "Em đánh giá việc học"), ("RISK", "Em bị bạn trêu chọc"),
            ("HIGH_RISK", "Em bị đánh và bóp cổ")])]
        model = fit(rows)
        self.assertEqual(model["algorithm"], ALGORITHM)
        model["model_version"] = "functional-phrase-context-fixture"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for row in rows:
                expected = predict_scores(model, row["text"])
                actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                self.assertEqual(actual["label"], max(LABELS, key=expected.get))
                self.assertEqual(actual["scores"], expected)
                self.assertAlmostEqual(sum(expected.values()), 1)


if __name__ == "__main__":
    unittest.main()
