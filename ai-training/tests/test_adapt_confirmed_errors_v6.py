import csv
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence import adapt_confirmed_errors_v6 as adaptation
from school_violence.predict import load_model
from school_violence.training import LABELS, fit, predict


class ConfirmedErrorAdaptationTests(unittest.TestCase):
    def test_weighted_update_does_not_mutate_baseline(self):
        base = fit([{"text": f"fixture baseline {label}", "label": label} for label in LABELS],
                   0.5, model_version="vi-school-violence-char-nb-v5-query")
        before = json.dumps(base, sort_keys=True)
        row = {"id": "correction", "text": "new fixture correction", "label": "HIGH_RISK"}
        candidate = adaptation.augment(base, [row], weight=2)
        self.assertEqual(json.dumps(base, sort_keys=True), before)
        self.assertEqual(candidate["class_docs"]["HIGH_RISK"], base["class_docs"]["HIGH_RISK"] + 2)
        self.assertGreater(candidate["class_totals"]["HIGH_RISK"], base["class_totals"]["HIGH_RISK"])

    def test_builds_local_candidate_from_explicit_correction_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base_dir = root / "base"
            base_dir.mkdir()
            training = [{"text": f"baseline training {label}", "label": label} for label in LABELS]
            base = fit(training, 0.5, model_version="vi-school-violence-char-nb-v5-query")
            with gzip.open(base_dir / "model.json.gz", "wt", encoding="utf-8") as handle:
                json.dump(base, handle)
            for split in ("train", "validation", "test"):
                with (base_dir / f"{split}.jsonl").open("w", encoding="utf-8") as handle:
                    for label in LABELS:
                        handle.write(json.dumps({
                            "id": f"reference-{split}-{label}",
                            "text": f"reference {split} {label}",
                            "label": label, "split": split, "group_id": f"group-{split}-{label}",
                        }) + "\n")
            correction_text = "fixture query for correction"
            base_prediction = predict(base, correction_text)
            correction_label = next(label for label in LABELS if label != base_prediction)
            review = root / "review.csv"
            provenance = root / "provenance.csv"
            with review.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["id", "text", "label"])
                writer.writeheader()
                writer.writerow({"id": "1", "text": correction_text, "label": correction_label})
                for number in range(2, 95):
                    writer.writerow({"id": str(number), "text": f"fixture query {number}",
                                     "label": "SAFE"})
            with provenance.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["id", "label_origin"])
                writer.writeheader()
                writer.writerow({"id": "1", "label_origin": "user_explicit_correction"})
                for number in range(2, 95):
                    writer.writerow({"id": str(number),
                                     "label_origin": "user_confirmed_model_prediction"})
            output = root / "candidate"
            with patch.object(adaptation, "BASE_MODEL_SEMANTIC_SHA256", adaptation.semantic_sha256(base)), \
                 patch.object(adaptation, "REVIEW_SHA256", adaptation.sha256(review)), \
                 patch.object(adaptation, "PROVENANCE_SHA256", adaptation.sha256(provenance)), \
                 patch.object(adaptation, "CORRECTED_LABELS", {"1": correction_label}), \
                 patch.object(adaptation, "ARTIFACT_ROOT", root):
                with self.assertRaisesRegex(ValueError, "authorization"):
                    adaptation.build_candidate(base_dir, review, provenance, output, authorized=False)
                report = adaptation.build_candidate(base_dir, review, provenance, output,
                                                    authorized=True)
            self.assertFalse(report["deployment_eligible"])
            self.assertFalse(report["independent_real_holdout_evaluated"])
            self.assertEqual(report["correction_ids"], ["1"])
            self.assertNotIn(correction_text, json.dumps(report))
            self.assertEqual(load_model(output / "model.json.gz")["model_version"],
                             adaptation.MODEL_VERSION)
            with (output / "train.jsonl").open(encoding="utf-8") as handle:
                exported = [json.loads(line) for line in handle]
            self.assertEqual(exported[-1]["text"], correction_text)
            self.assertEqual(exported[-1]["group_ids"], [])
            self.assertEqual(len(exported), 4)


if __name__ == "__main__":
    unittest.main()
