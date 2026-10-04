import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.experiment_two_stage_queries import fit_two_stage, is_noninferior, run_experiment
from school_violence.training import predict, predict_scores
from school_violence.two_stage_query_model import ALGORITHM, select_two_stage_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


def prior_model(safe=0.4, high=0.6):
    return {
        "algorithm": ALGORITHM, "labels": ["SAFE", "RISK", "HIGH_RISK"],
        "model_version": "test-two-stage", "deployment_eligible": False,
        "decision_rule": "hard_route", "gate_threshold": 0.5, "severity_threshold": 0.5,
        "heads": {
            "gate": {"labels": ["SAFE", "ALERT"], "features": {}, "bias": [0, 0],
                     "fallback_prior": {"SAFE": safe, "ALERT": 1 - safe}},
            "severity": {"labels": ["RISK", "HIGH_RISK"], "features": {}, "bias": [0, 0],
                         "fallback_prior": {"RISK": 1 - high, "HIGH_RISK": high}},
        },
    }


class TwoStageQueryTests(unittest.TestCase):
    def test_runtime_uses_cascade_decision_and_normalized_joint_scores(self):
        model = prior_model()
        scores = predict_scores(model, "unknown terms")
        self.assertAlmostEqual(sum(scores.values()), 1.0)
        self.assertEqual(max(scores, key=scores.get), "SAFE")
        self.assertEqual(predict(model, "unknown terms"), "HIGH_RISK")
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "model.json.gz"
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            result = ThreeLabelEngine(artifact).moderate(ModerationInput(
                item_id="test", text="unknown terms", source_type="search_query"))
            self.assertEqual(result["label"], "HIGH_RISK")
            self.assertEqual(result["action"], "alert")
            self.assertEqual(result["scores"], scores)

    def test_safe_gate_can_override_high_severity(self):
        model = prior_model(safe=0.8, high=0.99)
        self.assertEqual(predict(model, "unknown terms"), "SAFE")
        model["decision_rule"] = "joint_argmax"
        self.assertEqual(predict(model, "unknown terms"), "SAFE")

    def test_severity_vocabulary_is_fitted_only_on_risk_and_high_rows(self):
        rows = [
            {"text": "calculus normal lesson", "label": "SAFE"},
            {"text": "calculus ordinary homework", "label": "SAFE"},
            {"text": "teasing worry event", "label": "RISK"},
            {"text": "teasing worry incident", "label": "RISK"},
            {"text": "hitting danger event", "label": "HIGH_RISK"},
            {"text": "hitting danger incident", "label": "HIGH_RISK"},
        ]
        model = fit_two_stage(rows, (1.5, 1.0, 3.0))
        self.assertIn("w:calculus", model["heads"]["gate"]["features"])
        self.assertNotIn("w:calculus", model["heads"]["severity"]["features"])
        self.assertEqual(model["heads"]["severity"]["fallback_prior"],
                         {"RISK": 0.5, "HIGH_RISK": 0.5})

    def test_improved_macro_score_does_not_hide_high_risk_regression(self):
        baseline = {"macro_f1": 0.75, "high_risk_correct": 60, "high_risk_to_safe": 0,
                    "safe_alerts": 14, "risk_to_high": 28}
        candidate = {**baseline, "macro_f1": 0.8, "high_risk_correct": 59}
        self.assertFalse(is_noninferior(candidate, baseline))
        candidate = {**baseline, "macro_f1": 0.8, "high_risk_to_safe": 1}
        self.assertFalse(is_noninferior(candidate, baseline))

    def test_authorization_and_output_scope_are_checked_before_reading_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                run_experiment(path, path, path, path, path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                run_experiment(path, path, path, path, path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
