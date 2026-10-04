import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from school_violence import experiment_finetuned_queries as experiment
from school_violence.finetuned_query_model import build_tail_classifier, pad_records, tail_scores


CONFIG = {
    "hidden_size": 12, "intermediate_size": 24, "num_attention_heads": 3,
    "hidden_dropout_prob": 0.0, "attention_probs_dropout_prob": 0.0,
    "num_hidden_layers": 12, "max_position_embeddings": 32,
}


class PartialFineTuneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def make_data(self):
        torch.manual_seed(7)
        model = build_tail_classifier(CONFIG)
        initial = {name: value.clone() for name, value in model.state_dict().items()
                   if name.startswith("layers.")}
        rng = np.random.default_rng(3)
        records = [{"hidden": rng.normal(size=(3 + i % 2, 12)).astype(np.float32),
                    "mask": np.ones(3 + i % 2, dtype=np.int64), "tag": i} for i in range(6)]
        model.eval()
        with torch.inference_mode():
            embeddings = np.vstack([model.embeddings(*pad_records([record]))[0].numpy() for record in records])
        return initial, records, embeddings

    def test_tail_is_updated_without_mutating_pretrained_initial_state(self):
        initial, records, embeddings = self.make_data()
        before = copy.deepcopy(initial)
        trained = experiment.fit_tail(CONFIG, initial, records, embeddings,
                                      ["SAFE", "RISK", "HIGH_RISK"] * 2, (1e-5, 3), seed=4)
        self.assertTrue(any(not torch.equal(before[name], trained.state_dict()[name]) for name in before))
        self.assertTrue(all(torch.equal(initial[name], before[name]) for name in before))
        self.assertEqual(set(name for name, _ in trained.named_parameters()
                             if not name.startswith("layers.")), {"classifier.weight", "classifier.bias"})

    def test_outer_fold_rows_are_excluded_from_warm_head_and_tail_training(self):
        initial, records, embeddings = self.make_data()
        rows = [{"id": str(i), "label": ("SAFE", "RISK", "HIGH_RISK")[i % 3]} for i in range(6)]
        calls = []
        original = experiment.fit_tail

        def capture(config, state, training_records, training_embeddings, labels, configuration, *, seed):
            calls.append([record["tag"] for record in training_records])
            return original(config, state, training_records, training_embeddings, labels, configuration, seed=seed)

        with patch.object(experiment, "fit_tail", side_effect=capture):
            result = experiment.evaluate_seed(rows, records, embeddings, CONFIG, initial, (1e-5, 3),
                                              1, [[0, 1, 2], [3, 4, 5]], 6)
        self.assertEqual(calls, [[3, 4, 5], [0, 1, 2]])
        self.assertCountEqual([p["id"] for p in result["predictions_by_id"]], [str(i) for i in range(6)])

    def test_padding_does_not_change_valid_token_embeddings_or_scores(self):
        initial, records, embeddings = self.make_data()
        model = build_tail_classifier(CONFIG, initial)
        model.eval()
        record = records[0]
        padded = {"hidden": np.vstack([record["hidden"], np.full((2, 12), 1000, dtype=np.float32)]),
                  "mask": np.concatenate([record["mask"], np.zeros(2, dtype=np.int64)])}
        np.testing.assert_allclose(tail_scores(model, [record]), tail_scores(model, [padded]),
                                   atol=1e-7, rtol=1e-6)

    def test_safetensors_roundtrip_preserves_tail_and_classifier(self):
        from safetensors.torch import load_file, save_file
        initial, records, embeddings = self.make_data()
        model = experiment.fit_tail(CONFIG, initial, records, embeddings,
                                    ["SAFE", "RISK", "HIGH_RISK"] * 2, (1e-5, 3), seed=4)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tail.safetensors"
            save_file(model.state_dict(), str(path))
            restored = build_tail_classifier(CONFIG)
            restored.load_state_dict(load_file(str(path)))
            np.testing.assert_allclose(tail_scores(model, records), tail_scores(restored, records), atol=1e-12)

    def test_authorization_and_scope_checked_before_loading_torch_model(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(ValueError, "authorization"):
                experiment.run_experiment(path, path, path, path, path, path, path, authorized=False)
            with self.assertRaisesRegex(ValueError, "ignored artifact"):
                experiment.run_experiment(path, path, path, path, path, path, path, authorized=True)


if __name__ == "__main__":
    unittest.main()
