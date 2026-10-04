"""Download a pinned public encoder without sending query data anywhere."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT


REPOSITORY = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
# SHA256 for LFS objects, Git blob SHA1 for the small configuration files.
FILES = {
    "onnx/model_quint8_avx2.onnx": ("sha256", "98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f"),
    "tokenizer.json": ("sha256", "2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8"),
    "config.json": ("git_blob", "c06d5b49495f044e6380e68a60538be17a6bd5d1"),
    "tokenizer_config.json": ("git_blob", "3c1b565ae10a15a1d0c31096f834af2fd9359e91"),
    "sentence_bert_config.json": ("git_blob", "5fd10429389515d3e5cccdeda08cae5fea1ae82e"),
    "1_Pooling/config.json": ("git_blob", "d1514c3162bbe87b343f565fadc62e6c06f04f03"),
    "README.md": ("git_blob", "6bedb7f3622d56b7020f33ab93f6996d33242043"),
}


def digest(data: bytes, kind: str) -> str:
    if kind == "sha256":
        return hashlib.sha256(data).hexdigest()
    if kind == "git_blob":
        return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
    raise ValueError("Unknown digest kind")


def prepare(output: Path) -> dict:
    output = output.resolve()
    if not output.is_relative_to(ARTIFACT_ROOT.resolve()) or output == ARTIFACT_ROOT.resolve():
        raise ValueError("Encoder output must be inside the ignored artifact directory")
    output.mkdir(parents=True, exist_ok=True)
    verified = {}
    for name, (kind, expected) in FILES.items():
        path = output / name
        if not path.is_file() or digest(path.read_bytes(), kind) != expected:
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(path.suffix + ".download")
            if not partial.is_file() or digest(partial.read_bytes(), kind) != expected:
                subprocess.run([
                    "curl.exe" if os.name == "nt" else "curl",
                    "--silent", "--show-error", "--fail", "--location",
                    "--retry", "2", "--retry-all-errors",
                    "--connect-timeout", "30", "--max-time", "300",
                    "--output", str(partial),
                    f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}",
                ], check=True)
            if digest(partial.read_bytes(), kind) != expected:
                raise ValueError(f"Downloaded encoder checksum mismatch: {name}")
            partial.replace(path)
        verified[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        print(json.dumps({"verified": name, "bytes": path.stat().st_size}), flush=True)
    manifest = {
        "repository": REPOSITORY, "revision": REVISION, "license": "apache-2.0",
        "files_sha256": verified, "onnx_file": "onnx/model_quint8_avx2.onnx",
        "max_sequence_length": 128, "embedding_dimension": 384,
        "pooling": "attention_mask_mean", "normalize_embeddings": True,
        "inference_batch_size": 1,
        "frozen": True, "provider": "CPUExecutionProvider", "query_uploads": False,
    }
    (output / "encoder_manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    prepare(parser.parse_args().output_dir)


if __name__ == "__main__":
    main()
