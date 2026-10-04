import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence import experiment_semantic_queries as experiment
from school_violence.predict import load_model
from school_violence.prepare_semantic_encoder import prepare
from school_violence.semantic_query_model import (
    ALGORITHM, FrozenSentenceEncoder, load_encoder, masked_mean_pool, predict_scores_semantic,
)
from school_violence.training import predict
from text_safety.engine import ModerationInput, ThreeLabelEngine


class SemanticQueryTests(unittest.TestCase):
    def test_masked_pooling_ignores_padding_and_normalizes(self):
        tokens = np.array([[[1, 0], [0, 1], [1000, -1000]]], dtype=np.float32)
        scores = masked_mean_pool(tokens, np.array([[1, 1, 0]]))
        np.testing.assert_allclose(scores, [[2 ** -0.5, 2 ** -0.5]], rtol=1e-6)
        self.assertAlmostEqual(float(np.linalg.norm(scores)), 1, places=6)

    def test_folds_fit_transforms_only_on_training_rows(self):
        rows = [{"id": str(i), "label": ("SAFE", "RISK", "HIGH_RISK")[i % 3]}
                for i in range(6)]
        vectors = np.array([[1, 0], [0, 1], [-1, 0], [10, 20], [30, 40], [50, 60]], dtype=float)
        means = []
        fit = experiment.fit_head

        def capture(embeddings, labels, configuration):
            model = fit(embeddings, labels, configuration)
            means.append(model["head"]["mean"])
            return model

        with patch.object(experiment, "fit_head", side_effect=capture):
            result = experiment.compare_folds(rows, vectors, [[0, 1, 2], [3, 4, 5]],
                                             6, 1, (0.001, 1, 2))
        np.testing.assert_allclose(means, [vectors[3:].mean(axis=0), vectors[:3].mean(axis=0)])
        self.assertCountEqual([row["id"] for row in result["predictions_by_id"]], [str(i) for i in range(6)])
        self.assertEqual(sum(sum(row.values()) for row in result["confusion_matrix"].values()), 6)

    def test_quantized_encoder_keeps_singleton_batches_even_for_multiple_texts(self):
        encoder = FrozenSentenceEncoder.__new__(FrozenSentenceEncoder)
        encoder.manifest = {"embedding_dimension": 2}
        encoder.input_names = {"input_ids", "attention_mask"}
        batches = []

        class FakeTokenizer:
            def encode_batch(self, texts):
                from types import SimpleNamespace
                batches.append(list(texts))
                return [SimpleNamespace(ids=[1], attention_mask=[1], type_ids=[0]) for _ in texts]

        class FakeSession:
            def run(self, _, inputs):
                self.asserted_batch_size = inputs["input_ids"].shape[0]
                return [np.ones((self.asserted_batch_size, 1, 2))]

        encoder.tokenizer, encoder.session = FakeTokenizer(), FakeSession()
        encoded = encoder.encode(["one", "two"])
        self.assertEqual(batches, [["one"], ["two"]])
        self.assertEqual(encoded.shape, (2, 2))
        with self.assertRaisesRegex(ValueError, "singleton"):
            encoder.encode(["one", "two"], batch_size=2)

    def test_runtime_resolves_local_encoder_and_preserves_actions(self):
        model = {"algorithm": ALGORITHM, "labels": ["SAFE", "RISK", "HIGH_RISK"],
                 "model_version": "test-semantic", "deployment_eligible": False,
                 "encoder": {"directory": "encoder", "manifest_sha256": "test"},
                 "head": {"mean": [0, 0], "scale": [1, 1],
                          "weights": [[0, 0, 5], [0, 0, 0]], "bias": [0, 0, 0]}}

        class FakeEncoder:
            def encode(self, texts):
                return np.array([[1.0, 0.0]])

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                json.dump(model, handle)
            with patch("school_violence.semantic_query_model.load_encoder", return_value=FakeEncoder()) as loader:
                result = ThreeLabelEngine(path).moderate(ModerationInput(
                    item_id="one", text="example", source_type="search_query"))
                self.assertEqual(result["label"], predict(load_model(path), "example"))
                self.assertEqual(result["label"], "HIGH_RISK")
                self.assertEqual(result["action"], "alert")
                self.assertAlmostEqual(sum(result["scores"].values()), 1)
                self.assertEqual(loader.call_args.args[0], str((Path(directory) / "encoder").resolve()))

    def test_acceptance_requires_preserving_high_risk_and_reducing_false_alerts(self):
        baseline = {"macro_f1": 0.75, "high_risk_correct": 60, "high_risk_to_safe": 0,
                    "safe_alerts": 14, "risk_to_high": 28}
        self.assertFalse(experiment.qualifies(baseline, baseline))
        candidate = {**baseline, "macro_f1": 0.8, "safe_alerts": 12}
        self.assertTrue(experiment.qualifies(candidate, baseline))
        self.assertFalse(experiment.qualifies({**candidate, "high_risk_correct": 59}, baseline))
        self.assertFalse(experiment.qualifies({**candidate, "high_risk_to_safe": 1}, baseline))
        self.assertFalse(experiment.qualifies({**candidate, "risk_to_high": 29}, baseline))

    def test_encoder_path_escape_and_manifest_tampering_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "within the artifact"):
                predict_scores_semantic({"algorithm": ALGORITHM, "_artifact_dir": directory,
                                         "encoder": {"directory": "../other"}}, "example")
            manifest = Path(directory) / "encoder_manifest.json"
            manifest.write_text("{}", encoding="utf-8")
            expected = hashlib.sha256(manifest.read_bytes()).hexdigest()
            manifest.write_text('{"modified":true}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "manifest checksum"):
                load_encoder(directory, expected)

    def test_authorization_and_download_scope_checked_before_work(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                experiment.run_experiment(path, path, path, path, path, path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                experiment.run_experiment(path, path, path, path, path, path, path, authorized=True)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                prepare(path)


if __name__ == "__main__":
    unittest.main()
