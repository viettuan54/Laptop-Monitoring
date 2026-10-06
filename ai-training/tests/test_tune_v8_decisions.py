import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import tune_v8_decisions as tuning
from school_violence.adapt_reviewed_queries_v8 import fit_linear
from school_violence.linear_query_model import predict_scores_linear


def fixture_rows():
    return [{"id": str(i), "text": f"school shared words {i}", "label": label}
            for i, label in enumerate(tuning.LABELS * 2)]


class NestedDecisionTests(unittest.TestCase):
    def test_boundary_shift_matches_score_rule_including_unknown_text(self):
        model = fit_linear(fixture_rows())
        adjusted = tuning.adjust_boundaries(model, 1.3, 0.9)
        for text in ("school shared words", "unseen zyxw"):
            raw = predict_scores_linear(model, text)
            expected = {label: raw[label] * factor
                        for label, factor in zip(tuning.LABELS, (1.3, 1.0, 0.9))}
            total = sum(expected.values())
            actual = predict_scores_linear(adjusted, text)
            for label in tuning.LABELS:
                self.assertAlmostEqual(actual[label], expected[label] / total)
            self.assertAlmostEqual(sum(actual.values()), 1)
        self.assertNotEqual(model["bias"], adjusted["bias"])

    def test_invalid_weights_and_boundaries_are_rejected(self):
        for value in (0, -1, math.inf, math.nan):
            with self.assertRaises(ValueError):
                fit_linear(fixture_rows(), high_weight=value)
            with self.assertRaises(ValueError):
                tuning.adjust_boundaries(fit_linear(fixture_rows()), value, 1)

    def test_outer_queries_never_reach_inner_selection_or_training(self):
        rows = fixture_rows()
        selections, fits = [], []

        def select(train, *, seed):
            selections.append({row["id"] for row in train})
            return {"selected_configuration": list(tuning.BASE_CONFIGURATION)}

        def fit(train, **kwargs):
            fits.append({row["id"] for row in train})
            return fit_linear(train, **kwargs)

        with patch.object(tuning, "make_cv_folds", return_value=([[0, 1, 2], [3, 4, 5]], 6)), \
             patch.object(tuning, "choose_inner", side_effect=select), \
             patch.object(tuning, "fit_linear", side_effect=fit):
            result = tuning.nested_compare(rows, seed=1)
        self.assertEqual(selections, [{"3", "4", "5"}, {"0", "1", "2"}])
        self.assertEqual(fits, [selections[0]] * 2 + [selections[1]] * 2)
        self.assertEqual(len(result["tuned"]["predictions_by_id"]), 6)

    def test_inner_threshold_scores_exclude_their_held_queries(self):
        rows = fixture_rows()
        fits = []

        def fit(train, **kwargs):
            fits.append({row["id"] for row in train})
            return fit_linear(train, **kwargs)

        with patch.object(tuning, "make_cv_folds", return_value=([[0, 1, 2], [3, 4, 5]], 6)), \
             patch.object(tuning, "fit_linear", side_effect=fit):
            selection = tuning.choose_inner(rows, seed=1)
        self.assertEqual(fits, [{"3", "4", "5"}, {"0", "1", "2"}] * 3)
        self.assertEqual(len(selection["options"]), 27)

    def test_reduced_false_alerts_cannot_offset_high_risk_misses(self):
        baseline = dict(macro_f1=0.7, high_risk_correct=60, high_risk_to_safe=0,
                        safe_alerts=14, risk_to_high=28)
        candidate = baseline | {"macro_f1": 0.8, "safe_alerts": 10, "high_risk_correct": 59}
        self.assertFalse(tuning.qualifies(candidate, baseline))
        self.assertFalse(tuning.qualifies(baseline | {"safe_alerts": 10, "high_risk_to_safe": 1}, baseline))
        self.assertTrue(tuning.qualifies(baseline | {"safe_alerts": 10}, baseline))


if __name__ == "__main__":
    unittest.main()
