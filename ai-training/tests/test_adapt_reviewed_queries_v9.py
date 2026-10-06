"""Functional fixtures for v9 math, runtime parity and fold exclusion, not a holdout."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import adapt_reviewed_queries_v9 as adaptation
from school_violence.adapt_reviewed_queries_v8 import fit_linear
from school_violence.training import predict_scores
from text_safety.engine import ModerationInput, ThreeLabelEngine


def fixtures():
    return [{"id": str(i), "text": text, "label": label}
            for i, (label, text) in enumerate([
                ("SAFE", "ordinary shared homework reading"),
                ("RISK", "classmate shared teasing words"),
                ("HIGH_RISK", "classmate shared threatened hit me"),
                ("SAFE", "ordinary shared homework lessons"),
                ("RISK", "classmate shared teasing jokes"),
                ("HIGH_RISK", "classmate shared threatened hurt me"),
            ])]


class ReviewedQueryV9Tests(unittest.TestCase):
    def test_sparse_baseline_matches_existing_v8_training_math(self):
        old, new = fit_linear(fixtures()), adaptation.fit(fixtures(), adaptation.BASE)
        self.assertEqual(set(old["features"]), set(new["features"]))
        for text in ("ordinary homework", "classmate threatened hit", "unseen qwerty"):
            a, b = predict_scores(old, text), predict_scores(new, text)
            for label in adaptation.LABELS:
                self.assertAlmostEqual(a[label], b[label], places=12)

    def test_rare_features_and_hybrid_round_trip_keep_runtime_contract(self):
        baseline = adaptation.fit(fixtures(), adaptation.BASE)
        rare = adaptation.fit(fixtures(), "word_df1")
        self.assertNotIn("w:reading", baseline["features"])
        self.assertIn("w:reading", rare["features"])
        model = adaptation.fit(fixtures(), "hybrid_df1")
        model["model_version"] = "functional-hybrid-fixture"
        self.assertTrue(any(key.startswith("c:") for key in model["features"]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            engine = ThreeLabelEngine(path)
            for text in ("ordinary homework", "classmate threatened hit", "xyz123"):
                expected = predict_scores(model, text)
                response = engine.moderate(ModerationInput("fixture", text, "search_query"))
                self.assertEqual(response["label"], max(expected, key=expected.get))
                self.assertAlmostEqual(sum(response["scores"].values()), 1.0)
                for label in adaptation.LABELS:
                    self.assertAlmostEqual(response["scores"][label], expected[label], places=12)
            self.assertEqual(predict_scores(model, ""), model["fallback_prior"])

    def test_inner_and_outer_held_queries_never_reach_fitting_or_selection(self):
        rows = fixtures()
        seen_fits, seen_selections = [], []
        original_fit = adaptation.fit

        def fit(train, name):
            seen_fits.append({row["id"] for row in train})
            return original_fit(train, name)

        def select(train, *, seed):
            seen_selections.append({row["id"] for row in train})
            return {"selected_configuration": adaptation.BASE}

        with patch.object(adaptation, "make_cv_folds", return_value=([[0, 1, 2], [3, 4, 5]], 6)), \
             patch.object(adaptation, "fit", side_effect=fit):
            inner = adaptation.choose_inner(rows, seed=1)
            self.assertEqual(len(inner["options"]), 6)
            self.assertEqual(seen_fits, [{"3", "4", "5"}, {"0", "1", "2"}] * 6)
            seen_fits.clear()
            with patch.object(adaptation, "choose_inner", side_effect=select):
                outer = adaptation.nested_compare(rows, seed=1)
        self.assertEqual(seen_selections, [{"3", "4", "5"}, {"0", "1", "2"}])
        self.assertEqual(seen_fits, seen_selections)
        self.assertEqual(len(outer["selected"]["predictions_by_id"]), len(rows))

    def test_better_total_score_cannot_offset_a_safety_regression(self):
        baseline = dict(macro_f1=0.7, high_risk_correct=80, high_risk_to_safe=0,
                        safe_alerts=12, risk_to_high=20, risk_to_safe=4)
        self.assertFalse(adaptation.qualifies(baseline, baseline))
        for bad_change in ({"high_risk_correct": 79}, {"high_risk_to_safe": 1},
                           {"safe_alerts": 13}, {"risk_to_high": 21}, {"risk_to_safe": 5}):
            self.assertFalse(adaptation.qualifies(baseline | {"macro_f1": 0.9} | bad_change, baseline))
        self.assertTrue(adaptation.qualifies(baseline | {"safe_alerts": 11}, baseline))

    def test_training_requires_authorization_and_ignored_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                adaptation.run(*([path] * 8), authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact directory"):
                adaptation.run(*([path] * 8), authorized=True)


if __name__ == "__main__":
    unittest.main()
