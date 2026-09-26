"""Prepare a leakage-checked three-class corpus and train a local n-gram baseline.

This is an experiment on synthetic sentences, not a production child-safety model.
No third-party ML package or network download is required.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from text_safety.normalization import normalize_text


LABELS = ("SAFE", "RISK", "HIGH_RISK")
SPLITS = ("train", "validation", "test")
RATIOS = {"train": .7, "validation": .15, "test": .15}
SEED = "school-violence-three-class-v1"
MODEL_VERSION = "vi-school-violence-char-nb-v2"
DATASET_VERSION = "school-violence-synthetic-dedup-v2"
WS = re.compile(r"\s+")
SENSITIVE_PATTERNS = (
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    re.compile(r"\b(?:\+?84|0)(?:[ .-]?\d){8,10}\b"),
    re.compile(r"\b(?:bearer|api[_ -]?key|password)\s*[:=]", re.IGNORECASE),
    re.compile(r"https?://\S+\?\S+", re.IGNORECASE),
)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _dedup_key(text: str) -> str:
    return WS.sub(" ", unicodedata.normalize("NFC", text).casefold()).strip()


def load_source(path: Path) -> tuple[list[dict], dict]:
    """Read source CSV; retain one representative of exact/case/space duplicates."""
    raw = path.read_bytes()
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
        required = {"id", "text", "label", "split", "source", "review_status"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"Missing columns: {sorted(required - set(reader.fieldnames or []))}")
        rows = list(reader)
    except UnicodeDecodeError as error:
        raise ValueError("Source must be UTF-8 CSV") from error
    if not rows:
        raise ValueError("Empty corpus")
    by_key: dict[str, dict] = {}
    original_split_by_group: dict[str, set[str]] = defaultdict(set)
    sources = Counter()
    statuses = Counter()
    for row_number, row in enumerate(rows, start=2):
        label = row["label"].strip()
        text = row["text"].strip()
        if label not in LABELS or not text or not row["id"].strip():
            raise ValueError(f"Invalid label, text or ID at source row {row_number}")
        if row["split"] not in SPLITS:
            raise ValueError(f"Invalid source split for ID {row['id']}")
        if row["source"].strip() != "synthetic" or row["review_status"].strip() not in ("", "unreviewed", "reviewed"):
            raise ValueError("This experimental trainer only accepts synthetic source rows")
        if any(pattern.search(text) for pattern in SENSITIVE_PATTERNS):
            raise ValueError(f"Potential private identifier in source row {row_number}")
        sources[row["source"].strip()] += 1
        statuses[row["review_status"].strip() or "unreviewed"] += 1
        key = _dedup_key(text)
        group = normalize_text(text).folded
        original_split_by_group[group].add(row["split"])
        if key in by_key:
            if by_key[key]["label"] != label:
                raise ValueError(f"Conflicting labels for normalized duplicate at ID {row['id']}")
            by_key[key]["source_ids"].append(row["id"].strip())
            if row["review_status"].strip() != "reviewed":
                by_key[key]["review_status"] = "unreviewed"
            continue
        by_key[key] = {
            "id": row["id"].strip(),
            "text": unicodedata.normalize("NFC", text),
            "label": label,
            "source_ids": [row["id"].strip()],
            "source": row["source"].strip(),
            "review_status": row["review_status"].strip() or "unreviewed",
            "group_hash": _hash(group),
        }
    records = list(by_key.values())
    groups: dict[str, str] = {}
    for record in records:
        key = record["group_hash"]
        if key in groups and groups[key] != record["label"]:
            raise ValueError("Conflicting labels within a normalized-text group")
        groups[key] = record["label"]
    audit = {
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source_rows": len(rows),
        "deduplicated_rows": len(records),
        "removed_duplicate_rows": len(rows) - len(records),
        "normalized_groups": len(groups),
        "original_cross_split_groups": sum(len(v) > 1 for v in original_split_by_group.values()),
        "source_values": dict(sources),
        "review_status_values": dict(statuses),
        "has_user_or_conversation_ids": False,
    }
    return records, audit


def split_records(records: list[dict]) -> tuple[dict[str, list[dict]], dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        grouped[record["group_hash"]].append(record)
    by_label: dict[str, list[tuple[str, list[dict]]]] = defaultdict(list)
    for group_hash, members in grouped.items():
        if len({member["label"] for member in members}) != 1:
            raise ValueError("Conflicting labels within group")
        by_label[members[0]["label"]].append((group_hash, members))
    result: dict[str, list[dict]] = {name: [] for name in SPLITS}
    for label in LABELS:
        groups = sorted(by_label[label], key=lambda item: _hash(SEED + item[0]))
        if len(groups) < 3:
            raise ValueError(f"At least three independent groups required for {label}")
        total = sum(len(members) for _, members in groups)
        assigned = Counter()
        for index, (_, members) in enumerate(groups):
            remaining = len(groups) - index
            empty = [name for name in SPLITS if assigned[name] == 0]
            if remaining == len(empty) and empty:
                chosen = empty[0]
            else:
                chosen = max(SPLITS, key=lambda name: (RATIOS[name] * total - assigned[name], -SPLITS.index(name)))
            result[chosen].extend(members)
            assigned[chosen] += len(members)
    seen: set[str] = set()
    for split in SPLITS:
        hashes = {record["group_hash"] for record in result[split]}
        if seen.intersection(hashes):
            raise AssertionError("Normalized-text leakage between splits")
        seen.update(hashes)
        result[split].sort(key=lambda item: item["id"])
    report = {
        "strategy": "label_stratified_normalized_text_groups_deterministic_v1",
        "seed": SEED,
        "counts": {name: dict(Counter(row["label"] for row in result[name])) for name in SPLITS},
        "cross_split_normalized_groups": 0,
    }
    return result, report


def features(text: str) -> Counter[str]:
    cleaned = normalize_text(text).unicode
    counts: Counter[str] = Counter()
    for n in (3, 4, 5):
        counts.update(cleaned[i:i + n] for i in range(max(0, len(cleaned) - n + 1)))
    return counts


def fit(records: list[dict], alpha: float) -> dict:
    class_docs = Counter()
    class_features: dict[str, Counter[str]] = {label: Counter() for label in LABELS}
    for record in records:
        label = record["label"]
        class_docs[label] += 1
        class_features[label].update(features(record["text"]))
    vocabulary = set().union(*(set(value) for value in class_features.values()))
    if any(class_docs[label] == 0 for label in LABELS):
        raise ValueError("Every class must appear in training")
    return {
        "model_version": MODEL_VERSION,
        "labels": LABELS,
        "alpha": alpha,
        "class_docs": dict(class_docs),
        "class_totals": {label: sum(class_features[label].values()) for label in LABELS},
        "vocabulary_size": len(vocabulary),
        "feature_counts": {label: dict(class_features[label]) for label in LABELS},
    }


def predict_scores(model: dict, text: str) -> dict[str, float]:
    counts = features(text)
    total_docs = sum(model["class_docs"].values())
    vocabulary_size = model["vocabulary_size"]
    alpha = model["alpha"]
    scores = {}
    for label in LABELS:
        denominator = model["class_totals"][label] + alpha * vocabulary_size
        score = math.log(model["class_docs"][label] / total_docs)
        feature_counts = model["feature_counts"][label]
        for feature, count in counts.items():
            if feature in feature_counts:
                score += count * math.log((feature_counts[feature] + alpha) / denominator)
            elif any(feature in model["feature_counts"][other] for other in LABELS):
                score += count * math.log(alpha / denominator)
        scores[label] = score
    peak = max(scores.values())
    weights = {label: math.exp(scores[label] - peak) for label in LABELS}
    total = sum(weights.values())
    return {label: weights[label] / total for label in LABELS}


def predict(model: dict, text: str) -> str:
    scores = predict_scores(model, text)
    return max(LABELS, key=lambda label: scores[label])


def evaluate(model: dict, records: list[dict]) -> dict:
    matrix = {actual: {predicted: 0 for predicted in LABELS} for actual in LABELS}
    for record in records:
        matrix[record["label"]][predict(model, record["text"])] += 1
    per_label = {}
    for label in LABELS:
        tp = matrix[label][label]
        fn = sum(matrix[label].values()) - tp
        fp = sum(matrix[other][label] for other in LABELS if other != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        per_label[label] = {
            "support": tp + fn, "precision": precision, "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
            "false_positive": fp, "false_negative": fn,
        }
    return {
        "labels": LABELS,
        "confusion_matrix": matrix,
        "per_label": per_label,
        "macro_f1": sum(per_label[label]["f1"] for label in LABELS) / len(LABELS),
        "high_risk_recall": per_label["HIGH_RISK"]["recall"],
    }


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(source: Path, output: Path, *, validate_only: bool = False) -> dict:
    records, audit = load_source(source)
    splits, split_report = split_records(records)
    report = {
        "dataset_version": DATASET_VERSION,
        "model_version": MODEL_VERSION,
        "source_audit": audit,
        "split": split_report,
        "training_scope": "experimental_synthetic_only",
        "deployment_eligible": False,
        "limitations": [
            "The supplied synthetic corpus has no completed human review.",
            "No user or conversation IDs; split is grouped only by normalized text.",
            "No independently collected real-world test set.",
            "Perfect scores on repetitive synthetic templates do not establish real-world performance.",
            "The three severity tiers do not detect self-harm or other legacy safety categories.",
        ],
    }
    if validate_only:
        return report
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    for split in SPLITS:
        with (output / f"{split}.jsonl").open("w", encoding="utf-8") as handle:
            for record in splits[split]:
                payload = {"id": record["id"], "text": record["text"], "label": record["label"],
                           "split": split, "source_ids": record["source_ids"],
                           "review_status": record["review_status"], "source": record["source"]}
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    candidates = (0.5, 1.0, 2.0)
    best = None
    for alpha in candidates:
        model = fit(splits["train"], alpha)
        validation = evaluate(model, splits["validation"])
        if best is None or validation["macro_f1"] > best[1]["macro_f1"]:
            best = (model, validation)
    model, validation = best
    test = evaluate(model, splits["test"])
    report["trained_at_utc"] = datetime.now(timezone.utc).isoformat()
    report["configuration"] = {"algorithm": "multinomial_character_ngram_naive_bayes",
                               "ngram_range": [3, 5], "alpha_candidates": candidates,
                               "selected_alpha": model["alpha"], "split_ratios": RATIOS}
    report["validation"] = validation
    report["test"] = test
    with gzip.open(output / "model.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, separators=(",", ":"))
    _write_json(output / "evaluation_report.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--validate-only", action="store_true")
    arguments = parser.parse_args()
    report = run(arguments.input, arguments.output_dir, validate_only=arguments.validate_only)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
