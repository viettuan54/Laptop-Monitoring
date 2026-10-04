"""Download verified original MiniLM weights for local partial fine-tuning."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .prepare_semantic_encoder import FILES, REPOSITORY, REVISION, digest


WEIGHTS_SHA256 = "eaa086f0ffee582aeb45b36e34cdd1fe2d6de2bef61f8a559a1bbc9bd955917b"


def file_sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def prepare(output: Path) -> dict:
    output = output.resolve()
    if not output.is_relative_to(ARTIFACT_ROOT.resolve()) or output == ARTIFACT_ROOT.resolve():
        raise ValueError("Encoder output must stay inside the ignored artifact directory")
    output.mkdir(parents=True, exist_ok=True)
    files = {name: value for name, value in FILES.items() if not name.startswith("onnx/")}
    files["model.safetensors"] = ("sha256", WEIGHTS_SHA256)
    verified = {}
    for name, (kind, expected) in files.items():
        path = output / name

        def matches(candidate: Path) -> bool:
            return candidate.is_file() and (
                file_sha256(candidate) if kind == "sha256" else digest(candidate.read_bytes(), kind)) == expected

        if not matches(path):
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(path.suffix + ".download")
            if not matches(partial):
                subprocess.run([
                    "curl.exe" if os.name == "nt" else "curl", "--silent", "--show-error",
                    "--fail", "--location", "--retry", "3", "--retry-all-errors",
                    "--connect-timeout", "30", "--max-time", "600", "--output", str(partial),
                    f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}",
                ], check=True)
            if not matches(partial):
                raise ValueError(f"Original encoder checksum mismatch: {name}")
            partial.replace(path)
        verified[name] = file_sha256(path)
        print(json.dumps({"verified": name, "bytes": path.stat().st_size}), flush=True)
    manifest = {
        "repository": REPOSITORY, "revision": REVISION, "license": "apache-2.0",
        "files_sha256": verified, "weight_format": "safetensors", "precision": "float32",
        "max_sequence_length": 128, "embedding_dimension": 384,
        "prefix_layer_count": 10, "tail_layer_count": 2,
        "query_uploads": False, "inference_batch_size": 1,
    }
    (output / "base_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    prepare(parser.parse_args().output_dir)
