"""Offline MiniLM prefix plus a task-adapted two-layer encoder tail."""

from __future__ import annotations

import json
import math
import unicodedata
from functools import lru_cache
from pathlib import Path

import numpy as np

from .prepare_finetune_encoder import WEIGHTS_SHA256, file_sha256
from .training import LABELS


ALGORITHM = "partial_minilm_finetuned_query_v1"


def build_tail_classifier(config_dict: dict, initial_tail: dict | None = None):
    import torch
    from transformers import BertConfig
    from transformers.models.bert.modeling_bert import BertLayer

    config = BertConfig.from_dict(config_dict)
    config._attn_implementation = "eager"

    class TailClassifier(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.layers = torch.nn.ModuleList([BertLayer(config) for _ in range(2)])
            self.register_buffer("mean", torch.zeros(config.hidden_size))
            self.register_buffer("scale", torch.ones(config.hidden_size))
            self.classifier = torch.nn.Linear(config.hidden_size, len(LABELS))

        def embeddings(self, hidden, mask):
            extended = (1 - mask[:, None, None, :].to(hidden.dtype)) * torch.finfo(hidden.dtype).min
            for layer in self.layers:
                hidden = layer(hidden, attention_mask=extended)[0]
            pooling_mask = mask[..., None].to(hidden.dtype)
            pooled = (hidden * pooling_mask).sum(1) / pooling_mask.sum(1).clamp_min(1e-9)
            return torch.nn.functional.normalize(pooled, p=2, dim=1)

        def forward(self, hidden, mask):
            embeddings = self.embeddings(hidden, mask)
            standardized = (embeddings - self.mean) / self.scale / math.sqrt(config.hidden_size)
            return self.classifier(standardized)

    model = TailClassifier()
    if initial_tail is not None:
        missing, extra = model.load_state_dict(initial_tail, strict=False)
        if set(missing) != {"mean", "scale", "classifier.weight", "classifier.bias"} or extra:
            raise ValueError("Pretrained tail keys do not match the classifier")
    return model


def pad_records(records: list[dict]):
    import torch

    if not records:
        raise ValueError("Need prefix records")
    max_length = max(len(record["mask"]) for record in records)
    hidden_size = records[0]["hidden"].shape[1]
    hidden = torch.zeros(len(records), max_length, hidden_size, dtype=torch.float32)
    mask = torch.zeros(len(records), max_length, dtype=torch.long)
    for index, record in enumerate(records):
        size = len(record["mask"])
        hidden[index, :size] = torch.from_numpy(record["hidden"])
        mask[index, :size] = torch.from_numpy(record["mask"])
    return hidden, mask


class FrozenPrefix:
    """Checksum-verified original embeddings and first ten encoder layers."""

    def __init__(self, directory: Path):
        import torch
        from safetensors.torch import load_file
        from tokenizers import Tokenizer
        from transformers import BertConfig, BertModel

        self.directory = directory.resolve()
        self.manifest = json.loads((self.directory / "base_manifest.json").read_text(encoding="utf-8"))
        if (self.manifest["prefix_layer_count"] != 10 or self.manifest["tail_layer_count"] != 2
                or self.manifest["files_sha256"]["model.safetensors"] != WEIGHTS_SHA256):
            raise ValueError("Unexpected original MiniLM manifest")
        for name, expected in self.manifest["files_sha256"].items():
            path = (self.directory / name).resolve()
            if not path.is_relative_to(self.directory) or file_sha256(path) != expected:
                raise ValueError(f"Base encoder checksum mismatch: {name}")
        self.config_dict = json.loads((self.directory / "config.json").read_text(encoding="utf-8"))
        config = BertConfig.from_dict(self.config_dict)
        config._attn_implementation = "eager"
        # Avoid allocating a second 470 MB copy while loading safetensors.
        with torch.device("meta"):
            self.model = BertModel(config)
        weights = load_file(str(self.directory / "model.safetensors"))
        positions = weights.pop("embeddings.position_ids", None)
        self.model.load_state_dict(weights, assign=True)
        # Old checkpoints persisted this buffer; recent Transformers do not.
        self.model.embeddings.position_ids = (positions if positions is not None else
            torch.arange(config.max_position_embeddings).expand((1, -1)))
        self.model.embeddings.token_type_ids = torch.zeros_like(self.model.embeddings.position_ids)
        self.model.requires_grad_(False)
        self.model.eval()
        self.initial_tail = {
            f"layers.{index}.{name}": value.detach().clone()
            for index, layer in enumerate(self.model.encoder.layer[10:])
            for name, value in layer.state_dict().items()
        }
        self.model.encoder.layer = torch.nn.ModuleList(list(self.model.encoder.layer[:10]))
        self.tokenizer = Tokenizer.from_file(str(self.directory / "tokenizer.json"))
        token_config = json.loads((self.directory / "tokenizer_config.json").read_text(encoding="utf-8"))
        pad_token = token_config["pad_token"]
        pad_id = self.tokenizer.token_to_id(pad_token)
        if pad_id is None:
            raise ValueError("Missing padding token")
        self.tokenizer.enable_truncation(max_length=self.manifest["max_sequence_length"])
        self.tokenizer.enable_padding(pad_id=pad_id, pad_token=pad_token)

    def encode_prefix(self, text: str) -> dict:
        import torch

        normalized = " ".join(unicodedata.normalize("NFKC", text).split())
        tokens = self.tokenizer.encode(normalized)
        ids = torch.tensor([tokens.ids], dtype=torch.long)
        mask = torch.tensor([tokens.attention_mask], dtype=torch.long)
        types = torch.tensor([tokens.type_ids], dtype=torch.long)
        with torch.inference_mode():
            hidden = self.model.embeddings(input_ids=ids, token_type_ids=types)
            extended = (1 - mask[:, None, None, :].to(hidden.dtype)) * torch.finfo(hidden.dtype).min
            for layer in self.model.encoder.layer:
                hidden = layer(hidden, attention_mask=extended)[0]
        return {"hidden": hidden[0].numpy().copy(), "mask": mask[0].numpy().copy()}


def tail_scores(model, records: list[dict]) -> np.ndarray:
    import torch

    model.eval()
    scores = []
    with torch.inference_mode():
        # Canonical single-query evaluation agrees with the runtime adapter.
        for record in records:
            logits = model(*pad_records([record]))
            scores.append(torch.softmax(logits.to(torch.float64), dim=1)[0].numpy())
    return np.vstack(scores)


class FineTunedRuntime:
    def __init__(self, root: Path, metadata: dict):
        encoder_dir = (root / metadata["encoder"]["directory"]).resolve()
        tail_file = (root / metadata["tail_file"]).resolve()
        if encoder_dir == root or not encoder_dir.is_relative_to(root) or not tail_file.is_relative_to(root):
            raise ValueError("Fine-tuned files must stay inside their artifact directory")
        if file_sha256(encoder_dir / "base_manifest.json") != metadata["encoder"]["manifest_sha256"]:
            raise ValueError("Base manifest checksum mismatch")
        if file_sha256(tail_file) != metadata["tail_sha256"]:
            raise ValueError("Adapted tail checksum mismatch")
        import torch
        from safetensors.torch import load_file

        torch.set_num_threads(2)
        self.prefix = FrozenPrefix(encoder_dir)
        self.tail = build_tail_classifier(self.prefix.config_dict)
        self.tail.load_state_dict(load_file(str(tail_file)))
        self.tail.eval()

    def scores(self, text: str) -> dict[str, float]:
        scores = tail_scores(self.tail, [self.prefix.encode_prefix(text)])[0]
        return dict(zip(LABELS, map(float, scores)))


@lru_cache(maxsize=1)
def load_runtime(root: str, serialized_metadata: str) -> FineTunedRuntime:
    return FineTunedRuntime(Path(root), json.loads(serialized_metadata))


def predict_scores_finetuned(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") != ALGORITHM or "_artifact_dir" not in model:
        raise ValueError("Load a fine-tuned artifact with load_model")
    metadata = {key: model[key] for key in ("encoder", "tail_file", "tail_sha256")}
    return load_runtime(model["_artifact_dir"], json.dumps(metadata, sort_keys=True)).scores(text)
