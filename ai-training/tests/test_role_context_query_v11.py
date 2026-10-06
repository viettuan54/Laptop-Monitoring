"""Behavior/math fixtures, not additional examples for the real dataset."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import experiment_role_context_v11 as experiment
from school_violence.context_query_model import context_features as v10_features
from school_violence.context_query_model_v11 import ALGORITHM, context_features
from school_violence.experiment_context_queries_v10 import fit_model as fit_v10
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


def rows():
    return [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
        ("SAFE", "ordinary shared homework reading"), ("RISK", "classmate shared teasing words"),
        ("HIGH_RISK", "classmate shared threatened hit me"),
        ("SAFE", "ordinary shared homework lessons"), ("RISK", "classmate shared teasing jokes"),
        ("HIGH_RISK", "classmate shared threatened hurt me"),
    ])]


class RoleContextTests(unittest.TestCase):
    def test_academic_phrase_is_not_physical_but_mixed_assault_remains(self):
        for text in ("Em tự đánh giá việc học", "em tu danh gia viec hoc", "Mình đánh dấu bài tập"):
            with self.subTest(text=text):
                features = context_features(text)
                self.assertIn("ctx:academic_action", features)
                self.assertNotIn("ctx:physical", features)
                self.assertNotIn("ctx:self_reference+physical", features)
        mixed = context_features("Em đang đánh giá việc học nhưng một bạn đánh em")
        self.assertIn("ctx:physical", mixed)
        self.assertIn("ctx:self_affected+physical", mixed)

    def test_witness_pronoun_does_not_make_observer_the_victim(self):
        for text in ("Mình chứng kiến một bạn bị nhiều người đá",
                     "em thay mot ban bi danh", "Bạn của mình bị đánh"):
            with self.subTest(text=text):
                features = context_features(text)
                self.assertIn("ctx:other_affected+physical", features)
                self.assertIn("ctx:witness+physical", features)
                self.assertNotIn("ctx:self_reference+physical", features)
                self.assertNotIn("ctx:self_affected+physical", features)

    def test_passive_direct_object_actor_and_multiple_victims(self):
        for text in ("Em bị một bạn đánh", "Một bạn bóp cổ mình", "toi bi dam"):
            self.assertIn("ctx:self_affected+physical", context_features(text))
        actor = context_features("Mình đánh một bạn")
        self.assertIn("ctx:other_affected+physical", actor)
        self.assertNotIn("ctx:self_affected+physical", actor)
        both = context_features("Mình và bạn bị đánh")
        self.assertIn("ctx:self_affected+physical", both)
        self.assertIn("ctx:other_affected+physical", both)

    def test_roles_do_not_cross_clause_and_danger_is_preserved(self):
        features = context_features("Em thấy bạn bị đánh; sau đó mình bị đe dọa")
        self.assertIn("ctx:witness+physical", features)
        self.assertNotIn("ctx:self_affected+physical", features)
        self.assertIn("ctx:self_affected+threat", features)
        features = context_features("Một người mang dao để tìm mình")
        self.assertIn("ctx:self_affected+weapon", features)

    def test_pressure_features_distinguish_stated_consequences_without_label_rule(self):
        mild = context_features("Em bị yêu cầu đưa mật khẩu trò chơi")
        self.assertIn("ctx:pressure+credential", mild)
        self.assertIn("ctx:pressure+unspecified_consequence", mild)
        self.assertNotIn("ctx:witness", context_features("Em bị thúc ép thử thách mà em thấy lo"))
        severe = context_features("Em bị yêu cầu đưa mật khẩu và bị dọa đánh")
        self.assertIn("ctx:pressure+direct_danger", severe)
        self.assertIn("ctx:threat", severe)
        model = dict(algorithm=ALGORITHM, labels=list(LABELS), head=dict(labels=list(LABELS),
            features={}, bias=[0, 0, 0], fallback_prior=dict(zip(LABELS, (0.8, 0.1, 0.1)))))
        scores = predict_scores(model, "Em bị siết cổ")
        self.assertEqual(select_label(model, scores), "SAFE")  # wording never overrides weights

    def test_v10_semantics_remain_versioned(self):
        text = "Mình đánh giá việc học"
        self.assertIn("ctx:physical", v10_features(text))
        self.assertNotIn("ctx:physical", context_features(text))
        self.assertNotIn("ctx:self_reference", context_features("Chứng minh bài toán"))

    def test_same_training_math_without_context_and_runtime_round_trip(self):
        baseline, model = fit_v10(rows(), "flat_context_high3"), experiment.fit(rows())
        for text in ("ordinary homework", "classmate threatened hit", "unknown xzqw"):
            old, new = predict_scores(baseline, text), predict_scores(model, text)
            for label in LABELS:
                self.assertAlmostEqual(old[label], new[label], places=12)
        model["model_version"] = "functional-role-context-fixture"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for row in rows():
                expected = predict_scores(model, row["text"])
                actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                self.assertEqual(actual["label"], max(LABELS, key=expected.get))
                self.assertEqual(actual["scores"], expected)
                self.assertAlmostEqual(sum(actual["scores"].values()), 1)

    def test_each_fold_excludes_held_rows_from_both_models(self):
        fits = []
        original = experiment.fit

        def fitted(train, *args):
            fits.append({row["id"] for row in train})
            return original(train)

        with patch.object(experiment, "fit_v10", side_effect=fitted), patch.object(experiment, "fit", side_effect=fitted):
            result = experiment.compare(rows(), [[0, 1, 2], [3, 4, 5]])
        self.assertEqual(fits, [{"3", "4", "5"}] * 2 + [{"0", "1", "2"}] * 2)
        self.assertEqual(len(result["candidate"]["predictions_by_id"]), 6)
        with self.assertRaisesRegex(ValueError, "exactly once"):
            experiment.compare(rows(), [[0, 1, 2], [2, 3, 4, 5]])

    def test_selection_rejects_recall_loss_and_source_specific_regression(self):
        baseline = dict(macro_f1=0.8, high_risk_correct=93, high_risk_to_safe=0,
                        safe_alerts=12, risk_to_high=36, risk_to_safe=4)
        improved = baseline | {"risk_to_high": 30}
        self.assertTrue(experiment.qualifies(improved, baseline, improved, baseline))
        self.assertFalse(experiment.qualifies(baseline, baseline, baseline, baseline))
        for change in ({"high_risk_correct": 92}, {"safe_alerts": 13}, {"risk_to_safe": 5},
                       {"high_risk_to_safe": 1}, {"macro_f1": 0.7}):
            self.assertFalse(experiment.qualifies(improved | change, baseline, improved, baseline))
        self.assertFalse(experiment.qualifies(improved, baseline, improved | {"safe_alerts": 13}, baseline))

    def test_training_authorization_and_artifact_root_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                experiment.run(path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact directory"):
                experiment.run(path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
