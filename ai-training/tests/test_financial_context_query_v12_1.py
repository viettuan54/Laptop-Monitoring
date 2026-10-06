"""Financial wording recognition/transport fixtures, not performance data."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence.context_query_model_v12_1 import ALGORITHM, context_features
from school_violence.experiment_financial_context_v12_1 import fit
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


class FinancialContextTests(unittest.TestCase):
    def test_forced_purchase_and_routine_purchase_are_distinct_features(self):
        coercion = context_features("Em luôn phải mua đồ khi đi cùng nhóm bạn")
        self.assertIn("ctx:money_coercion", coercion)
        self.assertIn("ctx:self_affected+money_coercion", coercion)
        for text in ("Em phải mua sách cho lớp học", "Em thường mua đồ cùng gia đình",
                     "Em luôn phải mua bàn cho phòng học"):
            self.assertNotIn("ctx:money_coercion", context_features(text))
        self.assertNotIn("ctx:self_affected+money_coercion",
                         context_features("Mình thấy bạn luôn phải mua đồ cho nhóm"))

    def test_retention_requires_demand_and_conditional_subject_is_local(self):
        self.assertIn("ctx:money_coercion", context_features("Bạn giữ lại ví để yêu cầu một người làm theo"))
        self.assertNotIn("ctx:self_affected+money_coercion",
                         context_features("Mình thấy bạn giữ lại ví để yêu cầu một người làm theo"))
        self.assertIn("ctx:self_affected+money_coercion",
                      context_features("Bạn giữ lại ví nếu em không làm theo yêu cầu"))
        self.assertNotIn("ctx:money_coercion", context_features("Mình giữ lại điện thoại để đọc bài"))

    def test_new_concept_does_not_force_high_label(self):
        model = dict(algorithm=ALGORITHM, labels=list(LABELS), head=dict(labels=list(LABELS),
            features={}, bias=[0, 0, 0], fallback_prior=dict(zip(LABELS, (0.8, 0.1, 0.1)))))
        self.assertEqual(select_label(model, predict_scores(model, "Em bị ép mua đồ cho nhóm bạn")), "SAFE")

    def test_saved_artifact_scores_match_engine_and_argmax(self):
        rows = [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
            ("SAFE", "Em đọc sách"), ("RISK", "Em bị trêu chọc"),
            ("HIGH_RISK", "Em bị ép mua đồ cho nhóm bạn")])]
        model = fit(rows)
        model["model_version"] = "functional-financial-fixture"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for row in rows:
                expected = predict_scores(model, row["text"])
                actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                self.assertEqual(actual["scores"], expected)
                self.assertEqual(actual["label"], max(LABELS, key=expected.get))
                self.assertAlmostEqual(sum(expected.values()), 1)


if __name__ == "__main__":
    unittest.main()
