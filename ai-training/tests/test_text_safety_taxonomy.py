import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from text_safety.taxonomy import TAXONOMY_PATH, load_taxonomy


class ThreeLabelTaxonomyTest(unittest.TestCase):
    def test_only_safe_risk_high_risk_are_supported(self):
        self.assertEqual(load_taxonomy()["labels"], ["SAFE", "RISK", "HIGH_RISK"])
        self.assertEqual(load_taxonomy()["problem_type"], "single_label_classification")
        schema = json.loads((ROOT / "datasets/schema/text_safety_record.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["properties"]["label"]["enum"], load_taxonomy()["labels"])
        self.assertTrue(TAXONOMY_PATH.is_file())

    def test_annotation_policy_and_contrast_examples_keep_three_labels(self):
        policy = load_taxonomy()
        self.assertEqual(set(policy["definitions"]), {"SAFE", "RISK", "HIGH_RISK"})
        examples = [json.loads(line) for line in
                    (ROOT / "school_violence/policy_examples.example.jsonl").read_text(encoding="utf-8").splitlines()
                    if line.strip()]
        self.assertEqual(len({item["id"] for item in examples}), len(examples))
        self.assertTrue(all(item["label"] in policy["labels"] for item in examples))
        by_id = {item["id"]: item for item in examples}
        self.assertEqual(by_id["policy-03"]["label"], "RISK")
        self.assertEqual(by_id["policy-05"]["label"], "RISK")
        self.assertEqual(by_id["policy-08"]["label"], "HIGH_RISK")
        self.assertEqual(by_id["policy-09"]["label"], "HIGH_RISK")


if __name__ == "__main__":
    unittest.main()
