"""Offline frozen sentence encoder and a three-label softmax head."""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from functools import lru_cache
from pathlib import Path

import numpy as np

from .training import LABELS


ALGORITHM = "frozen_sentence_encoder_softmax_v1"


def masked_mean_pool(token_embeddings: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    mask = attention_mask.astype(np.float32)[..., None]
    pooled = (token_embeddings * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
    return pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)


class FrozenSentenceEncoder:
    """Load only checksum-verified local files; never contact a model hub."""

    def __init__(self, directory: Path):
        from tokenizers import Tokenizer
        import onnxruntime as ort

        self.directory = directory.resolve()
        self.manifest_path = self.directory / "encoder_manifest.json"
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if (self.manifest["frozen"] is not True
                or self.manifest["pooling"] != "attention_mask_mean"
                or self.manifest["normalize_embeddings"] is not True
                or self.manifest.get("inference_batch_size") != 1):
            raise ValueError("Unsupported encoder preprocessing")
        for name, expected in self.manifest["files_sha256"].items():
            path = (self.directory / name).resolve()
            if not path.is_relative_to(self.directory):
                raise ValueError("Encoder manifest path escapes its directory")
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Encoder checksum mismatch: {name}")
        self.tokenizer = Tokenizer.from_file(str(self.directory / "tokenizer.json"))
        config = json.loads((self.directory / "tokenizer_config.json").read_text(encoding="utf-8"))
        pad_token = config["pad_token"]
        if isinstance(pad_token, dict):
            pad_token = pad_token["content"]
        pad_id = self.tokenizer.token_to_id(pad_token)
        if pad_id is None:
            raise ValueError("Encoder has no padding token")
        self.tokenizer.enable_truncation(max_length=self.manifest["max_sequence_length"])
        self.tokenizer.enable_padding(pad_id=pad_id, pad_token=pad_token)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(self.directory / self.manifest["onnx_file"]), sess_options=options,
            providers=["CPUExecutionProvider"])
        self.input_names = {item.name for item in self.session.get_inputs()}

    @staticmethod
    def normalize(text: str) -> str:
        return " ".join(unicodedata.normalize("NFKC", text).split())

    def token_lengths(self, texts: list[str]) -> list[int]:
        # Separate tokenizer keeps the inference tokenizer immutable here.
        from tokenizers import Tokenizer
        tokenizer = Tokenizer.from_file(str(self.directory / "tokenizer.json"))
        tokenizer.no_truncation()
        tokenizer.no_padding()
        return [len(tokenizer.encode(self.normalize(text)).ids) for text in texts]

    def encode(self, texts: list[str], *, batch_size: int = 1) -> np.ndarray:
        if not texts:
            raise ValueError("Encoding needs texts")
        if batch_size != 1:
            raise ValueError("Quantized encoder requires singleton batches to match runtime")
        batches = []
        for start in range(0, len(texts), batch_size):
            tokens = self.tokenizer.encode_batch([self.normalize(text)
                                                 for text in texts[start:start + batch_size]])
            inputs = {
                "input_ids": np.asarray([item.ids for item in tokens], dtype=np.int64),
                "attention_mask": np.asarray([item.attention_mask for item in tokens], dtype=np.int64),
                "token_type_ids": np.asarray([item.type_ids for item in tokens], dtype=np.int64),
            }
            output = self.session.run(None, {name: inputs[name] for name in self.input_names})[0]
            pooled = masked_mean_pool(output, inputs["attention_mask"])
            if pooled.shape[1] != self.manifest["embedding_dimension"] or not np.isfinite(pooled).all():
                raise ValueError("Invalid encoder output")
            batches.append(pooled)
        return np.vstack(batches)


def scores_from_embeddings(model: dict, embeddings: np.ndarray) -> np.ndarray:
    head = model["head"]
    standardized = ((np.asarray(embeddings, dtype=np.float64) - np.asarray(head["mean"]))
                    / np.asarray(head["scale"]) / math.sqrt(len(head["mean"])))
    logits = standardized @ np.asarray(head["weights"]) + np.asarray(head["bias"])
    logits -= logits.max(axis=1, keepdims=True)
    scores = np.exp(logits)
    return scores / scores.sum(axis=1, keepdims=True)


@lru_cache(maxsize=2)
def load_encoder(directory: str, manifest_sha256: str) -> FrozenSentenceEncoder:
    path = Path(directory)
    if hashlib.sha256((path / "encoder_manifest.json").read_bytes()).hexdigest() != manifest_sha256:
        raise ValueError("Encoder manifest checksum mismatch")
    return FrozenSentenceEncoder(path)


def predict_scores_semantic(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") != ALGORITHM:
        raise ValueError("Unsupported semantic artifact")
    if "_artifact_dir" not in model:
        raise ValueError("Load semantic artifacts with load_model to resolve the local encoder")
    root = Path(model["_artifact_dir"]).resolve()
    directory = (root / model["encoder"]["directory"]).resolve()
    if directory == root or not directory.is_relative_to(root):
        raise ValueError("Encoder path must stay within the artifact directory")
    encoder = load_encoder(str(directory), model["encoder"]["manifest_sha256"])
    scores = scores_from_embeddings(model, encoder.encode([text]))[0]
    return dict(zip(LABELS, map(float, scores)))
