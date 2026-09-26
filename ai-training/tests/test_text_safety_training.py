import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.training import run as three_label_run
from text_safety.training import LABELS, run


class ThreeLabelTrainingAliasTest(unittest.TestCase):
    def test_old_entrypoint_uses_three_class_trainer(self):
        self.assertIs(run, three_label_run)
        self.assertEqual(LABELS, ("SAFE", "RISK", "HIGH_RISK"))


if __name__ == "__main__":
    unittest.main()
