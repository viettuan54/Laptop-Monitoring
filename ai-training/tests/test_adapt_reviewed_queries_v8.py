import csv
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence import adapt_reviewed_queries_v8 as adaptation
from school_violence.linear_query_model import ALGORITHM, predict_scores_linear
from school_violence.predict import load_model
from school_violence.training import predict_scores
from text_safety.engine import ModerationInput, ThreeLabelEngine


class LinearQueryCandidateTests(unittest.TestCase):
    def test_unknown_words_use_unweighted_prior_instead_of_high_risk_bias(self):
        model = {
            "algorithm": ALGORITHM,
            "labels": ["SAFE", "RISK", "HIGH_RISK"],
            "features": {},
            "bias": [0.0, 0.0, 10.0],
            "fallback_prior": {"SAFE": 0.2, "RISK": 0.6, "HIGH_RISK": 0.2},
        }
        scores = predict_scores_linear(model, "unseen vocabulary")
        self.assertEqual(max(scores, key=scores.get), "RISK")

    def test_training_artifact_round_trips_through_runtime(self):
        rows = [
            {"text": "ordinary school homework", "label": "SAFE"},
            {"text": "ordinary school reading", "label": "SAFE"},
            {"text": "ordinary school lessons", "label": "SAFE"},
            {"text": "classmate teasing at school", "label": "RISK"},
            {"text": "classmate teasing in class", "label": "RISK"},
            {"text": "classmate teasing a friend", "label": "RISK"},
            {"text": "classmate threatened to hit me", "label": "HIGH_RISK"},
            {"text": "classmate threatened to hurt me", "label": "HIGH_RISK"},
            {"text": "classmate threatened my friend", "label": "HIGH_RISK"},
        ]
        model = adaptation.fit_linear(rows)
        model["model_version"] = "test-linear-candidate"
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "model.json.gz"
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            loaded = load_model(artifact)
            engine = ThreeLabelEngine(artifact)
            for text in ("ordinary school homework", "classmate threatened to hit me"):
                scores = predict_scores(loaded, text)
                result = engine.moderate(ModerationInput(
                    item_id="test", text=text, source_type="search_query"
                ))
                self.assertEqual(result["label"], max(scores, key=scores.get))
                self.assertAlmostEqual(sum(result["scores"].values()), 1.0)
            unknown = engine.moderate(ModerationInput(
                item_id="unknown", text="xylophone qwerty", source_type="search_query"
            ))
            self.assertEqual(unknown["scores"], loaded["fallback_prior"])

    def test_changed_review_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            review = Path(directory) / "review.csv"
            with review.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["id", "text", "label"])
                writer.writeheader()
                writer.writerow({"id": "1", "text": "fixture", "label": "SAFE"})
            with self.assertRaisesRegex(ValueError, "changed"):
                adaptation.load_review3(review)

    def test_training_requires_authorization_and_ignored_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                adaptation.build_candidate(path, path, path, path, path, path,
                                           authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact directory"):
                adaptation.build_candidate(path, path, path, path, path, path,
                                           authorized=True)


if __name__ == "__main__":
    unittest.main()
