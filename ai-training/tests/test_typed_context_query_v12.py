"""Wording/role and runtime checks, never an accuracy holdout."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence.context_query_model_v12 import ALGORITHM, context_features
from school_violence.experiment_typed_context_v12 import fit, run
from school_violence.experiment_role_context_v11 import fit as fit_v11
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


def rows():
    return [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
        ("SAFE", "ordinary shared homework reading"), ("RISK", "classmate shared teasing words"),
        ("HIGH_RISK", "classmate shared threatened hit me"),
        ("SAFE", "ordinary shared homework lessons"), ("RISK", "classmate shared teasing jokes"),
        ("HIGH_RISK", "classmate shared threatened hurt me")])]


class TypedContextTests(unittest.TestCase):
    def test_only_adverb_is_not_sister_and_picture_is_not_brother(self):
        only = context_features("Chỉ khi bị đánh mới cần báo ai")
        self.assertNotIn("ctx:other_affected+physical", only)
        self.assertNotIn("ctx:witness+physical", only)
        sister = context_features("Chị bị đánh")
        self.assertIn("ctx:other_affected+physical", sister)
        picture = context_features("Hình ảnh bị đập")
        self.assertNotIn("ctx:other_affected+physical", picture)

    def test_academic_and_mixed_assault_and_witness_remain_distinct(self):
        self.assertNotIn("ctx:physical", context_features("Mình đánh giá việc học"))
        mixed = context_features("Mình đánh giá việc học; một bạn đánh mình")
        self.assertIn("ctx:self_affected+physical", mixed)
        witness = context_features("Mình chứng kiến một bạn bị đánh")
        self.assertIn("ctx:other_affected+physical", witness)
        self.assertNotIn("ctx:self_reference+physical", witness)

    def test_request_and_coercion_keep_separate_wording_and_stated_consequences(self):
        request = context_features("Em bị yêu cầu đưa mật khẩu trò chơi")
        self.assertIn("ctx:pressure_mode:request+consequence:unspecified", request)
        self.assertIn("ctx:pressure_mode:request+topic:credential", request)
        self.assertNotIn("ctx:self_affected+pressure", request)
        urge = context_features("Em bị thúc ép thử thách")
        self.assertIn("ctx:pressure_mode:request", urge)
        self.assertNotIn("ctx:pressure_mode:coercion", urge)
        danger = context_features("Em bị yêu cầu đưa mật khẩu rồi bị dọa đánh")
        self.assertIn("ctx:pressure_mode:request+consequence:threat", danger)
        self.assertIn("ctx:threat", danger)
        force = context_features("Em bị ép giao điện thoại sau khi bị khóa cửa")
        self.assertIn("ctx:pressure_mode:coercion+consequence:movement", force)
        self.assertIn("ctx:pressure_mode:coercion+consequence:property", force)

    def test_verbal_exclusion_support_is_retained_without_global_physical_linkage(self):
        mild = context_features("Mình lo khi các bạn trêu chọc một người")
        self.assertIn("ctx:self_reference+verbal", mild)
        witnessed = context_features("Mình chứng kiến một người bị đánh")
        self.assertNotIn("ctx:self_reference+physical", witnessed)

    def test_no_context_feature_forces_a_label(self):
        model = dict(algorithm=ALGORITHM, labels=list(LABELS), head=dict(labels=list(LABELS),
            features={}, bias=[0, 0, 0], fallback_prior=dict(zip(LABELS, (0.8, 0.1, 0.1)))))
        self.assertEqual(select_label(model, predict_scores(model, "Em bị siết cổ")), "SAFE")

    def test_generic_math_and_serialized_runtime_match(self):
        model, original = fit(rows()), fit_v11(rows())
        self.assertEqual(model["head"], original["head"])
        model["model_version"] = "functional-typed-context-fixture"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for row in rows():
                expected = predict_scores(model, row["text"])
                actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                self.assertEqual(actual["scores"], expected)
                self.assertEqual(actual["label"], max(LABELS, key=expected.get))
                self.assertAlmostEqual(sum(expected.values()), 1)

    def test_authorization_and_output_guards_precede_training(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                run(path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                run(path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
