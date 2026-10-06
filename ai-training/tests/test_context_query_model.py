"""Synthetic math/transport fixtures only; these are not a real accuracy holdout."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import experiment_context_queries_v10 as experiment
from school_violence.context_query_model import (
    FLAT_ALGORITHM, HIGH_FIRST_ALGORITHM, context_features, head_scores,
)
from school_violence.adapt_reviewed_queries_v9 import BASE as V9_BASE, fit as fit_v9
from school_violence.training import LABELS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


def rows():
    return [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
        ("SAFE", "ordinary shared homework reading"), ("RISK", "classmate shared teasing words"),
        ("HIGH_RISK", "classmate shared threatened hit me"),
        ("SAFE", "ordinary shared homework lessons"), ("RISK", "classmate shared teasing jokes"),
        ("HIGH_RISK", "classmate shared threatened hurt me"),
    ])]


def empty_head(labels, priors):
    return dict(labels=labels, fallback_prior=dict(zip(labels, priors)), features={},
                bias=[0.0] * len(labels), context_features=True)


class ContextQueryTests(unittest.TestCase):
    def test_features_generalize_wording_but_never_force_a_label(self):
        a = context_features("Em bị siết cổ")
        b = context_features("Tôi bị đấm")
        self.assertIn("ctx:physical", a & b)
        self.assertIn("ctx:affected+physical", a & b)
        witnessed = context_features("Thấy bạn bị đánh")
        self.assertIn("ctx:witness+physical", witnessed)
        self.assertNotIn("ctx:self_reference", witnessed)
        model = dict(algorithm=FLAT_ALGORITHM, labels=list(LABELS),
                     head=empty_head(list(LABELS), (0.8, 0.1, 0.1)))
        scores = predict_scores(model, "Em bị siết cổ")
        self.assertEqual(select_label(model, scores), "SAFE")  # no keyword override

    def test_generic_head_matches_existing_baseline_training_math(self):
        baseline = fit_v9(rows(), V9_BASE)
        head = experiment.fit_head(rows(), LABELS, (1.5, 1, 3), context=False, min_df=2)
        self.assertEqual(set(head["features"]), set(baseline["features"]))
        for text in ("ordinary homework", "classmate threatened hit", "unknown xzqw"):
            expected, actual = predict_scores(baseline, text), head_scores(head, text)
            for label in LABELS:
                self.assertAlmostEqual(actual[label], expected[label], places=12)

    def test_high_first_scores_and_routing_follow_the_serialized_threshold(self):
        model = dict(algorithm=HIGH_FIRST_ALGORITHM, labels=list(LABELS), high_threshold=0.5,
                     heads={"high": empty_head(["OTHER", "HIGH_RISK"], (0.55, 0.45)),
                            "rest": empty_head(["SAFE", "RISK"], (0.6, 0.4))})
        scores = predict_scores(model, "unknown xzqw")
        self.assertAlmostEqual(sum(scores.values()), 1)
        self.assertEqual(max(scores, key=scores.get), "HIGH_RISK")
        self.assertEqual(select_label(model, scores), "SAFE")
        model["high_threshold"] = 0.4
        self.assertEqual(select_label(model, scores), "HIGH_RISK")
        for threshold in (0, 1, float('nan')):
            model["high_threshold"] = threshold
            with self.assertRaises(ValueError):
                select_label(model, scores)

    def test_both_architectures_round_trip_through_real_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ("flat_context_high2", "high_context_1.5_050"):
                model = experiment.fit_model(rows(), name)
                model["model_version"] = "functional-context-fixture"
                path = Path(directory) / (name + ".json.gz")
                with gzip.open(path, "wt", encoding="utf-8") as handle:
                    json.dump(model, handle)
                engine = ThreeLabelEngine(path)
                for row in rows():
                    scores = predict_scores(model, row["text"])
                    expected = select_label(model, scores)
                    actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                    self.assertEqual(actual["label"], expected)
                    self.assertAlmostEqual(sum(actual["scores"].values()), 1)
                    self.assertEqual(actual["flagged"], expected != "SAFE")
                    self.assertAlmostEqual(actual["confidence"], actual["scores"][expected])

    def test_inner_and_outer_selection_exclude_held_queries(self):
        fits, selections = [], []
        original_fit = experiment.fit_model

        def fit(train, name):
            fits.append({row["id"] for row in train})
            return original_fit(train, name)

        def select(train, *, seed):
            selections.append({row["id"] for row in train})
            return {"selected_configuration": experiment.BASE}

        with patch.object(experiment, "make_cv_folds", return_value=([[0, 1, 2], [3, 4, 5]], 6)), \
             patch.object(experiment, "fit_model", side_effect=fit):
            selection = experiment.choose_inner(rows(), seed=1)
            self.assertEqual(len(selection["options"]), 9)
            self.assertTrue(all(ids in ({"0", "1", "2"}, {"3", "4", "5"}) for ids in fits))
            self.assertEqual(len(fits), 12)  # six distinct fits per fold; thresholds share heads
            fits.clear()
            with patch.object(experiment, "choose_inner", side_effect=select):
                result = experiment.nested_compare(rows(), [[0, 1, 2], [3, 4, 5]], seed=1)
        self.assertEqual(selections, [{"3", "4", "5"}, {"0", "1", "2"}])
        self.assertEqual(fits, selections)
        self.assertEqual(len(result["selected"]["predictions_by_id"]), 6)

    def test_selection_requires_both_target_improvements_without_safety_regression(self):
        baseline = dict(macro_f1=0.7, high_risk_correct=90, high_risk_to_safe=1,
                        safe_alerts=10, risk_to_high=40, risk_to_safe=5)
        improved = baseline | {"high_risk_to_safe": 0, "risk_to_high": 30}
        self.assertTrue(experiment.qualifies_outer(improved, baseline))
        self.assertFalse(experiment.qualifies_outer(baseline | {"risk_to_high": 30}, baseline))
        for change in ({"high_risk_correct": 89}, {"safe_alerts": 11}, {"risk_to_safe": 6}, {"macro_f1": 0.6}):
            self.assertFalse(experiment.qualifies_outer(improved | change, baseline))

    def test_authorization_and_output_guard_run_before_fitting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                experiment.run(path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact directory"):
                experiment.run(path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
