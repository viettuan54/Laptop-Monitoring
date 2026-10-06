"""Guard the selection decision against trading missed danger for accuracy."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from school_violence.experiment_recipient_context_v13 import selection_checks


class RecipientSelectionTests(unittest.TestCase):
    def setUp(self):
        self.old = dict(macro_f1=.84, high_risk_correct=94.2, high_risk_to_safe=0,
                        safe_alerts=10.2, risk_to_high=32, risk_to_safe=3.6)
        self.d4 = dict(macro_f1=.88, high_risk_correct=29, high_risk_to_safe=0,
                       safe_alerts=4.4, risk_to_high=5.4, risk_to_safe=.4)
        self.d5 = dict(macro_f1=.834051724137931, high_risk_correct=26, high_risk_to_safe=0,
                       safe_alerts=4, risk_to_high=9, risk_to_safe=2)

    def test_higher_accuracy_cannot_compensate_for_new_high_miss(self):
        candidate = self.d5 | dict(macro_f1=.95, high_risk_correct=25, safe_alerts=0, risk_to_high=0)
        checks = selection_checks(self.old, self.old, self.d4, self.d4, candidate, self.d5)
        self.assertFalse(checks["dulieu5_noninferior"])

    def test_new_set_improvement_cannot_hide_regression_on_old_queries(self):
        candidate = self.old | dict(macro_f1=.85, risk_to_safe=3.8)
        improved_d5 = self.d5 | dict(macro_f1=.9, safe_alerts=1)
        checks = selection_checks(candidate, self.old, self.d4, self.d4, improved_d5, self.d5)
        self.assertFalse(checks["old_grouped_cv_noninferior"])

    def test_identical_candidate_is_not_selected_without_reducing_false_alerts(self):
        checks = selection_checks(self.old, self.old, self.d4, self.d4, self.d5, self.d5)
        self.assertFalse(checks["dulieu5_false_alerts_strictly_reduced"])
        checks = selection_checks(self.old, self.old, self.d4, self.d4,
                                  self.d5 | dict(macro_f1=.85, risk_to_high=8), self.d5)
        self.assertTrue(all(checks.values()))


if __name__ == "__main__":
    unittest.main()
