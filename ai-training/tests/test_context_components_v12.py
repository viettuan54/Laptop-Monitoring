"""Ablation isolation/transport fixtures; not data for estimating accuracy."""

import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from school_violence import analyze_context_components_v12 as experiment
from school_violence.component_context_query_model import PROFILES, family, query_features
from school_violence.context_query_model_v11 import query_features as full_features
from school_violence.experiment_role_context_v11 import fit as full_fit
from school_violence.training import LABELS, predict_scores
from text_safety.engine import ModerationInput, ThreeLabelEngine


def rows():
    return [{"id": str(i), "text": text, "label": label} for i, (label, text) in enumerate([
        ("SAFE", "Em đánh giá việc học"), ("RISK", "Em chứng kiến bạn bị đánh"),
        ("HIGH_RISK", "Em bị đánh và ép đưa tiền"),
        ("SAFE", "Mình đánh dấu bài tập"), ("RISK", "Em bị yêu cầu đưa mật khẩu"),
        ("HIGH_RISK", "Một bạn bóp cổ mình")])]


class ContextComponentTests(unittest.TestCase):
    def test_groups_are_disjoint_and_drop_exactly_the_declared_columns(self):
        self.assertEqual(family("ctx:self_affected+pressure"), "pressure")
        self.assertEqual(family("ctx:self_reference+academic_action"), "academic")
        self.assertEqual(family("ctx:witness+physical"), "roles")
        for row in rows():
            complete = full_features(row["text"])
            self.assertEqual(query_features(row["text"], "v11_full"), complete)
            for profile, excluded in PROFILES.items():
                self.assertEqual(query_features(row["text"], profile),
                                 {key for key in complete if family(key) != excluded})

    def test_full_profile_keeps_v11_training_and_scores_exactly(self):
        model, original = experiment.fit(rows(), "v11_full"), full_fit(rows())
        self.assertEqual(model["head"], original["head"])
        for row in rows():
            self.assertEqual(predict_scores(model, row["text"]), predict_scores(original, row["text"]))

    def test_saved_profiles_use_same_extraction_and_argmax_in_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            for profile in PROFILES:
                model = experiment.fit(rows(), profile)
                model["model_version"] = "functional-component-fixture"
                path = Path(directory) / (profile + ".json.gz")
                with gzip.open(path, "wt", encoding="utf-8") as handle:
                    json.dump(model, handle)
                engine = ThreeLabelEngine(path)
                for row in rows():
                    expected = predict_scores(model, row["text"])
                    actual = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
                    self.assertEqual(actual["scores"], expected)
                    self.assertEqual(actual["label"], max(LABELS, key=expected.get))
                    self.assertAlmostEqual(sum(expected.values()), 1)
        with self.assertRaisesRegex(ValueError, "Unknown"):
            query_features("fixture", "not-a-profile")

    def test_held_rows_are_excluded_from_every_profile_and_baseline(self):
        fits = []
        original = experiment.fit

        def fitted(train, name):
            fits.append({row["id"] for row in train})
            return original(train, "v11_full" if name == "flat_context_high3" else name)

        with patch.object(experiment, "fit", side_effect=fitted), patch.object(experiment, "fit_v10", side_effect=fitted):
            result = experiment.compare(rows(), [[0, 1, 2], [3, 4, 5]])
        self.assertEqual(fits, [{"3", "4", "5"}] * 5 + [{"0", "1", "2"}] * 5)
        self.assertEqual(len(result["omit_pressure"]["predictions_by_id"]), 6)

    def test_authorization_and_output_guards_precede_training(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                experiment.run(path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                experiment.run(path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
