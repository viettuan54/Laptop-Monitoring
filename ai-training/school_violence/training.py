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
MODEL_VERSION = "vi-school-violence-char-nb-v3"
SPLIT_STRATEGY = "preserve_csv_groups_and_splits_v1"
NGRAM_RANGE = (3, 5)
ALPHA_CANDIDATES = (0.5, 1.0, 2.0)
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
    """Compatibility API for one CSV; follows the same strict split contract."""
    return load_sources([path])


def load_sources(paths: list[Path]) -> tuple[list[dict], dict]:
    """Validate the combined corpus BEFORE deduplication; never resplit rows.

    Metadata is allowed only for leakage checks and provenance, not features.
    A supplied group may contain different labels (e.g. different contextual
    versions), but the group must remain wholly in one split.
    """
    paths = [Path(path) for path in paths]
    if not paths or len({path.resolve() for path in paths}) != len(paths):
        raise ValueError("Provide distinct non-empty input paths")
    required = {"id", "text", "label", "group_id", "split", "source", "review_status", "dataset_version"}
    by_key: dict[str, dict] = {}
    seen_ids = set()
    key_splits: dict[tuple[str, str], set[str]] = defaultdict(set)
    text_labels: dict[tuple[str, str], set[str]] = defaultdict(set)
    key_counts = Counter()
    manifests = []
    source_values, statuses, versions = Counter(), Counter(), Counter()
    total_rows = 0

    for path in paths:
        raw = path.read_bytes()
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
            columns = reader.fieldnames or []
            if len(columns) != len(set(columns)) or not required.issubset(columns):
                raise ValueError(f"Missing or duplicate CSV columns in {path.name}: {sorted(required - set(columns))}")
            rows = list(reader)
        except UnicodeDecodeError as error:
            raise ValueError("Source must be UTF-8 CSV") from error
        if not rows:
            raise ValueError(f"Empty corpus: {path.name}")
        file_versions, file_labels, file_splits = Counter(), Counter(), Counter()
        for row_number, row in enumerate(rows, start=2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Malformed CSV record in {path.name} at record {row_number}")
            label, text = row["label"].strip(), row["text"].strip()
            identifier, group_id = row["id"].strip(), row["group_id"].strip()
            split, version = row["split"].strip(), row["dataset_version"].strip()
            if label not in LABELS or not text or not identifier or not group_id or not version:
                raise ValueError(f"Invalid label, text, ID, group_id or dataset_version in {path.name} at record {row_number}")
            if split not in SPLITS:
                raise ValueError(f"Invalid source split in {path.name} at record {row_number}")
            if identifier in seen_ids:
                raise ValueError(f"Duplicate ID in combined corpus at {path.name} record {row_number}")
            seen_ids.add(identifier)
            if row["source"].strip() != "synthetic" or row["review_status"].strip() not in ("", "unreviewed", "reviewed"):
                raise ValueError("This experimental trainer only accepts synthetic source rows")
            if any(pattern.search(text) for pattern in SENSITIVE_PATTERNS):
                raise ValueError(f"Potential private identifier in {path.name} at record {row_number}")
            normalized = normalize_text(text)
            if not normalized.unicode:
                raise ValueError(f"Empty runtime-normalized text in {path.name} at record {row_number}")
            if row.get("text_runtime_normalized") and row["text_runtime_normalized"] != normalized.unicode:
                raise ValueError(f"Stale runtime-normalization metadata in {path.name} at record {row_number}")
            keys = [("csv_group", group_id), ("exact_text", _dedup_key(text)),
                    ("runtime_text", normalized.folded), ("equivalent_text", normalized.folded)]
            canonical = row.get("text_normalized", "").strip()
            if canonical:
                # Share a namespace with raw runtime text to catch canonical vs
                # raw duplicate forms across query/webpage files as well.
                keys.append(("equivalent_text", normalize_text(canonical).folded))
            if row.get("page_id", "").strip():
                keys.append(("page_id", row["page_id"].strip()))
            if "content" in row or "title" in row:
                if "content" not in row or "title" not in row or text != row["title"] + "\n" + row["content"]:
                    raise ValueError(f"Page text must contain title and full content in {path.name} at record {row_number}")
                if not row["content"].strip():
                    raise ValueError(f"Empty page content in {path.name} at record {row_number}")
                keys.append(("page_body", normalize_text(row["content"]).folded))
                keys.append(("equivalent_text", normalize_text(row["content"]).folded))
            for key in set(keys):
                if not key[1]:
                    raise ValueError(f"Empty leakage key in {path.name} at record {row_number}")
                key_splits[key].add(split)
                key_counts[key] += 1
                if key[0] in ("exact_text", "runtime_text", "equivalent_text", "page_body"):
                    text_labels[key].add(label)
            status = row["review_status"].strip() or "unreviewed"
            source_values["synthetic"] += 1
            statuses[status] += 1
            versions[version] += 1
            file_versions[version] += 1
            file_labels[label] += 1
            file_splits[split] += 1
            total_rows += 1
            reference = {"file": path.name, "record_number": row_number, "id": identifier,
                         "group_id": group_id, "split": split, "dataset_version": version}
            dedup = _dedup_key(text)
            if dedup in by_key:
                existing = by_key[dedup]
                # Do not hide conflicting labels/splits by keeping the first row.
                if existing["label"] != label or existing["split"] != split:
                    raise ValueError(f"Conflicting labels or cross-split exact duplicate in {path.name} at record {row_number}")
                existing["source_ids"].append(identifier)
                existing["source_refs"].append(reference)
                existing["group_ids"] = sorted(set(existing["group_ids"]) | {group_id})
                if status != "reviewed":
                    existing["review_status"] = "unreviewed"
            else:
                by_key[dedup] = {
                    "id": identifier, "text": unicodedata.normalize("NFC", text), "label": label,
                    "group_id": group_id, "group_ids": [group_id], "split": split,
                    "source_ids": [identifier], "source_refs": [reference],
                    "source": "synthetic", "review_status": status,
                    "dataset_version": version, "group_hash": _hash(normalized.folded),
                }
        manifests.append({"file": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
                          "rows": len(rows), "columns": columns,
                          "dataset_versions": dict(file_versions), "label_counts": dict(file_labels),
                          "split_counts": dict(file_splits)})

    conflicts = Counter(kind for (kind, _), labels in text_labels.items() if len(labels) > 1)
    if conflicts:
        raise ValueError(f"Conflicting labels for equivalent text in combined corpus: {dict(conflicts)}")
    leakage = Counter(kind for (kind, _), splits in key_splits.items() if len(splits) > 1)
    if leakage:
        raise ValueError(f"Cross-split leakage in combined corpus: {dict(leakage)}; fix CSVs, no automatic resplit")
    records = list(by_key.values())
    checks = {
        kind: {"unique_keys": sum(k == kind for k, _ in key_splits),
               "duplicate_keys": sum(k == kind and count > 1 for (k, _), count in key_counts.items()),
               "cross_split_keys": 0}
        for kind in sorted({kind for kind, _ in key_splits})
    }
    fingerprint = _hash(json.dumps(manifests, sort_keys=True, separators=(",", ":")))
    audit = {
        "inputs": manifests, "combined_dataset_sha256": fingerprint,
        "source_rows": total_rows, "deduplicated_rows": len(records),
        "removed_duplicate_rows": total_rows - len(records),
        "normalized_groups": checks["runtime_text"]["unique_keys"],
        "csv_groups": checks["csv_group"]["unique_keys"], "original_cross_split_groups": 0,
        "leakage_checks": checks, "source_values": dict(source_values),
        "review_status_values": dict(statuses), "dataset_version_values": dict(versions),
        "has_user_or_conversation_ids": False,
    }
    if len(manifests) == 1:
        audit["source_sha256"] = manifests[0]["sha256"]
    return records, audit


def split_records(records: list[dict]) -> tuple[dict[str, list[dict]], dict]:
    """Preserve the supplied split; validate even direct callers of this API."""
    result: dict[str, list[dict]] = {name: [] for name in SPLITS}
    key_splits: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in records:
        split = record.get("split")
        if split not in SPLITS or not record.get("group_id"):
            raise ValueError("Every record requires a CSV split and group_id")
        for group in record.get("group_ids", [record["group_id"]]):
            key_splits[("csv_group", group)].add(split)
        key_splits[("runtime_text", normalize_text(record["text"]).folded)].add(split)
        result[split].append(record)
    if any(len(values) > 1 for values in key_splits.values()):
        raise ValueError("Cross-split leakage; fix CSVs, no automatic resplit")
    for split in SPLITS:
        missing = set(LABELS) - {row["label"] for row in result[split]}
        if missing:
            raise ValueError(f"CSV split {split} must contain every label; missing {sorted(missing)}")
        result[split].sort(key=lambda item: item["id"])
    report = {
        "strategy": SPLIT_STRATEGY,
        "csv_split_preserved": True,
        "counts": {name: dict(Counter(row["label"] for row in result[name])) for name in SPLITS},
        "group_counts": {name: len({g for row in result[name] for g in row.get("group_ids", [row["group_id"]])}) for name in SPLITS},
        "cross_split_csv_groups": 0,
        "cross_split_normalized_groups": 0,
    }
    return result, report


def features(text: str) -> Counter[str]:
    cleaned = normalize_text(text).unicode
    counts: Counter[str] = Counter()
    for n in range(NGRAM_RANGE[0], NGRAM_RANGE[1] + 1):
        counts.update(cleaned[i:i + n] for i in range(max(0, len(cleaned) - n + 1)))
    return counts


def fit(records: list[dict], alpha: float, *, model_version: str = MODEL_VERSION) -> dict:
    if not math.isfinite(alpha) or alpha <= 0:
        raise ValueError("Alpha must be finite and positive")
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
        "model_version": model_version,
        "labels": LABELS,
        "alpha": alpha,
        "class_docs": dict(class_docs),
        "class_totals": {label: sum(class_features[label].values()) for label in LABELS},
        "vocabulary_size": len(vocabulary),
        "feature_counts": {label: dict(class_features[label]) for label in LABELS},
    }


def predict_scores(model: dict, text: str) -> dict[str, float]:
    if model.get("algorithm") == "partial_minilm_finetuned_query_v1":
        from .finetuned_query_model import predict_scores_finetuned

        return predict_scores_finetuned(model, text)
    if model.get("algorithm") == "frozen_sentence_encoder_softmax_v1":
        from .semantic_query_model import predict_scores_semantic

        return predict_scores_semantic(model, text)
    if model.get("algorithm") == "tfidf_two_stage_query_v1":
        from .two_stage_query_model import predict_scores_two_stage

        return predict_scores_two_stage(model, text)
    if model.get("algorithm") == "tfidf_word_softmax_v1":
        from .linear_query_model import predict_scores_linear

        return predict_scores_linear(model, text)
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


def select_label(model: dict, scores: dict[str, float]) -> str:
    if model.get("algorithm") == "tfidf_two_stage_query_v1":
        from .two_stage_query_model import select_two_stage_label

        return select_two_stage_label(model, scores)
    return max(LABELS, key=lambda label: scores[label])


def predict(model: dict, text: str) -> str:
    return select_label(model, predict_scores(model, text))


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


def evaluate_by_input_file(model: dict, records: list[dict]) -> dict[str, dict]:
    """Report query/page performance separately without using provenance as a feature."""
    subsets: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        for file_name in {reference["file"] for reference in record["source_refs"]}:
            subsets[file_name].append(record)
    return {file_name: {"rows": len(rows), **evaluate(model, rows)}
            for file_name, rows in sorted(subsets.items())}


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(source: Path | list[Path], output: Path, *, validate_only: bool = False,
        model_version: str = MODEL_VERSION, dataset_version: str | None = None,
        alpha_candidates: tuple[float, ...] = ALPHA_CANDIDATES) -> dict:
    if not model_version.strip() or (dataset_version is not None and not dataset_version.strip()):
        raise ValueError("Model and dataset versions must be non-empty")
    if not alpha_candidates or any(not math.isfinite(value) or value <= 0 for value in alpha_candidates):
        raise ValueError("Alpha candidates must be finite and positive")
    records, audit = load_sources(source if isinstance(source, (list, tuple)) else [source])
    splits, split_report = split_records(records)
    source_versions = sorted(audit["dataset_version_values"])
    dataset_version = dataset_version or (
        "school-violence-combined-" + (source_versions[0] if len(source_versions) == 1
                                      else _hash(json.dumps(source_versions))[:12])
    )
    # Bind the exact preprocessing implementation and input files to this run.
    normalization_path = Path(__file__).resolve().parents[1] / "text_safety" / "normalization.py"
    configuration = {
        "algorithm": "multinomial_character_ngram_naive_bayes",
        "input_columns": ["text"], "ngram_range": list(NGRAM_RANGE),
        "alpha_candidates": list(alpha_candidates), "selected_alpha": None,
        "selection_metric": "validation.macro_f1", "selection_tie_break": "first_candidate_order",
        "test_used_for_selection": False,
        "split_strategy": SPLIT_STRATEGY, "resplit": False,
        "model_version": model_version, "dataset_version": dataset_version,
        "source_dataset_versions": source_versions,
        "combined_dataset_sha256": audit["combined_dataset_sha256"],
        "preprocessing": {"function": "text_safety.normalization.normalize_text",
                          "sha256": hashlib.sha256(normalization_path.read_bytes()).hexdigest()},
        "trainer_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    manifest = {
        "dataset_version": dataset_version, "combined_dataset_sha256": audit["combined_dataset_sha256"],
        "inputs": audit["inputs"], "source_audit": audit, "split": split_report,
        "human_review_complete": audit["review_status_values"].get("unreviewed", 0) == 0,
        "deployment_eligible": False,
    }
    report = {
        "dataset_version": dataset_version,
        "model_version": model_version,
        "source_audit": audit,
        "split": split_report,
        "configuration": configuration,
        "dataset_manifest": manifest,
        "training_performed": False,
        "training_scope": "experimental_synthetic_only",
        "deployment_eligible": False,
        "limitations": [
            "Human review status is recorded, not inferred from automated policy alignment.",
            "CSV groups are synthetic provenance groups, not verified user or conversation IDs.",
            "Exact/runtime/canonical/body checks do not detect every semantic near-duplicate.",
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
                           "group_id": record["group_id"], "group_ids": record["group_ids"],
                           "source_refs": record["source_refs"], "dataset_version": record["dataset_version"],
                           "review_status": record["review_status"], "source": record["source"]}
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    best = None
    validation_candidates = []
    for alpha in alpha_candidates:
        model = fit(splits["train"], alpha, model_version=model_version)
        validation = evaluate(model, splits["validation"])
        validation_candidates.append({"alpha": alpha, "metrics": validation})
        if best is None or validation["macro_f1"] > best[1]["macro_f1"]:
            best = (model, validation)
    model, validation = best
    report["validation_candidates"] = validation_candidates
    report["validation"] = validation
    report["validation_by_input_file"] = evaluate_by_input_file(model, splits["validation"])
    # The held-out test is touched only after the alpha has been selected.
    test = evaluate(model, splits["test"])
    report["test_by_input_file"] = evaluate_by_input_file(model, splits["test"])
    report["trained_at_utc"] = datetime.now(timezone.utc).isoformat()
    report["training_performed"] = True
    configuration["selected_alpha"] = model["alpha"]
    model.update(dataset_version=dataset_version,
                 combined_dataset_sha256=audit["combined_dataset_sha256"],
                 training_configuration=configuration, deployment_eligible=False)
    report["test"] = test
    with gzip.open(output / "model.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(model, handle, ensure_ascii=False, separators=(",", ":"))
    _write_json(output / "evaluation_report.json", report)
    _write_json(output / "dataset_manifest.json", manifest)
    _write_json(output / "training_config.json", configuration)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, nargs="+", action="extend", required=True,
                        help="One or more CSVs; --input may also be repeated")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--model-version", default=MODEL_VERSION)
    parser.add_argument("--dataset-version", default=None,
                        help="Optional combined-corpus version; source versions remain in manifest")
    parser.add_argument("--alpha-candidates", type=float, nargs="+", default=ALPHA_CANDIDATES)
    arguments = parser.parse_args()
    report = run(arguments.input, arguments.output_dir, validate_only=arguments.validate_only,
                 model_version=arguments.model_version, dataset_version=arguments.dataset_version,
                 alpha_candidates=tuple(arguments.alpha_candidates))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
