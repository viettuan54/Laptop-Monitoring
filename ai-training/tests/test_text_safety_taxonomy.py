import json
import sys
import unittest
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from text_safety.taxonomy import TAXONOMY_PATH, load_taxonomy


class TextSafetyTaxonomyTest(unittest.TestCase):
    def test_taxonomy_matches_migration_v21_risk_groups(self):
        taxonomy = load_taxonomy()

        self.assertEqual(
            taxonomy.risk_types,
            frozenset({"none", "self_harm", "harassment", "violence"}),
        )
        self.assertEqual(taxonomy.version, "1.0.0")
        self.assertIn("self-harm/intent", taxonomy.categories)
        self.assertIn("violence/inciting", taxonomy.categories)

    def test_taxonomy_privacy_limits_are_explicit(self):
        payload = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))

        self.assertFalse(payload["privacy"]["persist_raw_text"])
        self.assertFalse(payload["privacy"]["log_raw_text"])
        self.assertEqual(payload["privacy"]["maximum_text_characters"], 4000)
        self.assertEqual(payload["privacy"]["maximum_context_items"], 5)


if __name__ == "__main__":
    unittest.main()
