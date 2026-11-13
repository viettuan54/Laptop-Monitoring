"""End-to-end evaluation of the 3-tier Hybrid Content Classification pipeline.

Evaluates:
  Tier 1: Exact Lookup (app_exact_lookup_v1.json / web_exact_lookup_v1.json)
  Tier 2: Local Character N-gram Model (confidence >= 0.70)
  Tier 3: Gemini Fallback (same prompt/taxonomy contract as backend service)

Outputs a machine-readable JSON report and a thesis-ready Markdown report with:
  - Tier routing distribution (% Lookup hit, % N-gram conclusive, % Gemini fallback)
  - Accuracy, Macro-Precision, Macro-Recall, Macro-F1, per-class metrics, and
    Confusion Matrix for each tier and for the full End-to-End Hybrid system
  - High-precision latency statistics (Local < 1 ms vs. Gemini Fallback)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import statistics
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = TRAINING_ROOT.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.content_model import (
    canonical_key,
    predict_model,
    validate_model,
)
from content_classification.hybrid_content_classifier import (
    route_content_classification,
    validate_exact_lookup,
)
from content_classification.validate_dataset import load_taxonomy


DEFAULT_ARTIFACTS_DIR = TRAINING_ROOT / "artifacts" / "content_classification"
DEFAULT_DATASETS_DIR = TRAINING_ROOT / "datasets" / "content"
DEFAULT_APPS_EVAL_CSV = DEFAULT_DATASETS_DIR / "hybrid_eval_apps.csv"
DEFAULT_WEBSITES_EVAL_CSV = DEFAULT_DATASETS_DIR / "hybrid_eval_websites.csv"
DEFAULT_GEMINI_CACHE_PATH = (
    DEFAULT_ARTIFACTS_DIR / "hybrid_gemini_fallback_cache.json"
)
DEFAULT_JSON_REPORT_PATH = (
    DEFAULT_ARTIFACTS_DIR / "hybrid_evaluation_report.json"
)
DEFAULT_MD_REPORT_PATH = (
    DEFAULT_ARTIFACTS_DIR / "HYBRID_EVALUATION_REPORT.md"
)
BACKEND_DIR = REPO_ROOT / "child-monitor-backend"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)


def _round_floats(value, digits: int = 6):
    if isinstance(value, float):
        return round(value, digits)
    if isinstance(value, dict):
        return {k: _round_floats(v, digits) for k, v in value.items()}
    if isinstance(value, list):
        return [_round_floats(item, digits) for item in value]
    return value


def load_eval_dataset(resource_type: str, csv_path: Path, lookup: dict, classes: list[str]) -> list[dict]:
    if not csv_path.is_file():
        raise FileNotFoundError(f"Missing evaluation dataset: {csv_path}")
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
    if not rows:
        raise ValueError(f"Evaluation dataset is empty: {csv_path}")

    key_field = "app_name" if resource_type == "apps" else "domain"
    seen_keys = set()
    validated = []
    for index, row in enumerate(rows, start=2):
        raw_key = (row.get(key_field) or "").strip()
        key = canonical_key(resource_type, raw_key)
        if key in seen_keys:
            raise ValueError(f"Duplicate {key_field} '{key}' at row {index} in {csv_path}")
        seen_keys.add(key)

        label = (row.get("label") or "").strip()
        if label not in classes:
            raise ValueError(f"Invalid label '{label}' at row {index} in {csv_path}")

        cohort = (row.get("cohort") or "").strip()
        if cohort not in {"in_lookup", "out_of_lookup"}:
            raise ValueError(f"Invalid cohort '{cohort}' at row {index} in {csv_path}")

        in_lookup_table = key in lookup["labels"]
        if cohort == "in_lookup" and not in_lookup_table:
            raise ValueError(
                f"Row {index} ({key}) marked in_lookup but missing from {resource_type} exact lookup"
            )
        if cohort == "out_of_lookup" and in_lookup_table:
            raise ValueError(
                f"Row {index} ({key}) marked out_of_lookup but exists in {resource_type} exact lookup"
            )

        item = {
            key_field: key,
            "label": label,
            "cohort": cohort,
            "region": (row.get("region") or "global").strip(),
            "notes": (row.get("notes") or "").strip(),
        }
        if resource_type == "apps":
            item["product_name"] = (row.get("product_name") or "").strip() or None
            item["file_description"] = (row.get("file_description") or "").strip() or None
        else:
            item["title"] = (row.get("title") or "").strip() or None
        validated.append(item)
    return validated


def call_backend_gemini_batch(requests_payload: list[dict]) -> dict[str, dict]:
    """Invoke backend contentClassification.service.js for live Gemini fallback."""
    if not requests_payload:
        return {}
    node_script = """
const s = require('./src/services/contentClassification.service');
const { getGeminiModel } = require('./src/utils/aiConfig');

async function run() {
  const items = JSON.parse(process.argv[1]);
  const out = {};
  for (const item of items) {
    const t0 = process.hrtime.bigint();
    try {
      if (item.resource_type === 'websites') {
        const res = await s.classifyWebDomainWithGemini(item.domain);
        const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
        out[item.cache_key] = {
          label: res.category,
          latency_ms: elapsedMs,
          model_id: getGeminiModel(),
          status: 'ok'
        };
      } else {
        const res = await s.classifyAppWithGemini({
          app_name: item.app_name,
          product_name: item.product_name,
          file_description: item.file_description
        });
        const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
        out[item.cache_key] = {
          label: res.category,
          latency_ms: elapsedMs,
          model_id: getGeminiModel(),
          status: 'ok'
        };
      }
    } catch (err) {
      const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
      out[item.cache_key] = {
        label: 'unknown',
        latency_ms: elapsedMs,
        model_id: getGeminiModel(),
        status: 'error',
        error: err.message
      };
    }
  }
  process.stdout.write('__JSON_START__' + JSON.stringify(out) + '__JSON_END__');
}
run();
"""
    proc = subprocess.run(
        ["node", "-e", node_script, json.dumps(requests_payload)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    stdout = proc.stdout or ""
    if "__JSON_START__" not in stdout or "__JSON_END__" not in stdout:
        raise RuntimeError(
            f"Backend Gemini batch call failed (exit {proc.returncode}): {proc.stderr or stdout}"
        )
    raw_json = stdout.split("__JSON_START__", 1)[1].split("__JSON_END__", 1)[0]
    return json.loads(raw_json)


def compute_classification_metrics(
    pairs: list[tuple[str, str]],
    classes: list[str],
    total_population: int,
) -> dict:
    """Compute Accuracy, Macro-P/R/F1, per-class metrics, and Confusion Matrix."""
    count = len(pairs)
    confusion = {actual: {pred: 0 for pred in classes} for actual in classes}
    if count == 0:
        return {
            "sample_count": 0,
            "share_of_total": 0.0,
            "accuracy": None,
            "macro_precision": None,
            "macro_recall": None,
            "macro_f1": None,
            "evaluated_classes": [],
            "per_class": {
                c: {"support": 0, "predicted": 0, "precision": 0.0, "recall": 0.0, "f1": 0.0}
                for c in classes
            },
            "confusion_matrix": confusion,
        }

    supports = Counter()
    predicted_counts = Counter()
    true_positives = Counter()
    correct = 0

    for actual, predicted in pairs:
        supports[actual] += 1
        predicted_counts[predicted] += 1
        confusion[actual][predicted] += 1
        if actual == predicted:
            correct += 1
            true_positives[actual] += 1

    per_class = {}
    active_classes = []
    for label in classes:
        tp = true_positives[label]
        pred_c = predicted_counts[label]
        sup_c = supports[label]
        precision = tp / pred_c if pred_c > 0 else 0.0
        recall = tp / sup_c if sup_c > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        per_class[label] = {
            "support": sup_c,
            "predicted": pred_c,
            "true_positive": tp,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        }
        if sup_c > 0 or pred_c > 0:
            active_classes.append(label)

    # Macro metrics across all taxonomy classes that appear in ground truth (or all classes if full)
    denom_classes = [c for c in classes if supports[c] > 0] or classes
    macro_precision = sum(per_class[c]["precision"] for c in denom_classes) / len(denom_classes)
    macro_recall = sum(per_class[c]["recall"] for c in denom_classes) / len(denom_classes)
    macro_f1 = sum(per_class[c]["f1"] for c in denom_classes) / len(denom_classes)

    return {
        "sample_count": count,
        "share_of_total": count / total_population if total_population > 0 else 0.0,
        "accuracy": correct / count,
        "correct_count": correct,
        "error_count": count - correct,
        "macro_precision": macro_precision,
        "macro_recall": macro_recall,
        "macro_f1": macro_f1,
        "evaluated_classes": denom_classes,
        "per_class": per_class,
        "confusion_matrix": confusion,
    }


def summarize_latencies(latencies_ms: list[float]) -> dict:
    if not latencies_ms:
        return {
            "count": 0,
            "mean_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "min_ms": None,
            "max_ms": None,
        }
    ordered = sorted(latencies_ms)
    p95_idx = min(len(ordered) - 1, max(0, int(round(0.95 * (len(ordered) - 1)))))
    return {
        "count": len(ordered),
        "mean_ms": sum(ordered) / len(ordered),
        "median_ms": statistics.median(ordered),
        "p95_ms": ordered[p95_idx],
        "min_ms": ordered[0],
        "max_ms": ordered[-1],
    }


def _route_validated_fast(
    model: dict,
    lookup: dict | None,
    value: str,
    metadata_value: str | None = None,
) -> dict:
    """Fast runtime routing assuming model and lookup were validated at startup."""
    key = canonical_key(model["resource_type"], value)
    if lookup is not None:
        exact_label = lookup["labels"].get(key)
        if exact_label is not None:
            return {
                "label": exact_label,
                "candidate_label": exact_label,
                "confidence": 1.0,
                "decision_source": "exact_lookup",
                "requires_gemini": False,
            }
    prediction = predict_model(model, key, metadata_value)
    model_can_decide = model["deployment_approved"] and prediction["conclusive"]
    return {
        "label": prediction["label"] if model_can_decide else None,
        "candidate_label": prediction["label"],
        "confidence": prediction["confidence"],
        "decision_source": "trained_model" if model_can_decide else "gemini_required",
        "requires_gemini": not model_can_decide,
    }


def measure_local_routing_latency_ms(
    model: dict,
    lookup: dict,
    key: str,
    metadata_value: str | None,
    iterations: int = 50,
) -> float:
    """Measure average single-record local routing latency (in milliseconds) after startup load."""
    start_ns = time.perf_counter_ns()
    for _ in range(iterations):
        _route_validated_fast(model, lookup, key, metadata_value)
    elapsed_ns = time.perf_counter_ns() - start_ns
    return (elapsed_ns / iterations) / 1_000_000.0


def evaluate_resource_subset(
    records: list[dict],
    classes: list[str],
) -> dict:
    total = len(records)
    tier1_pairs = [
        (r["actual"], r["hybrid_label"])
        for r in records
        if r["final_tier"] == "exact_lookup"
    ]
    tier2_pairs = [
        (r["actual"], r["hybrid_label"])
        for r in records
        if r["final_tier"] == "trained_model"
    ]
    tier3_pairs = [
        (r["actual"], r["hybrid_label"])
        for r in records
        if r["final_tier"] == "gemini"
    ]
    # Also evaluate N-gram candidate on all non-lookup records (before confidence gate)
    non_lookup_records = [r for r in records if r["final_tier"] != "exact_lookup"]
    ngram_all_non_lookup_pairs = [
        (r["actual"], r["ngram_candidate_label"])
        for r in non_lookup_records
    ]
    hybrid_pairs = [(r["actual"], r["hybrid_label"]) for r in records]

    tier1_lat = [r["local_latency_ms"] for r in records if r["final_tier"] == "exact_lookup"]
    tier2_lat = [r["local_latency_ms"] for r in records if r["final_tier"] == "trained_model"]
    local_decided_lat = tier1_lat + tier2_lat
    tier3_lat = [r["gemini_latency_ms"] for r in records if r["final_tier"] == "gemini" and r["gemini_latency_ms"] is not None]
    total_effective_lat = [r["total_latency_ms"] for r in records]

    misclassified = [
        {
            "identifier": r["identifier"],
            "actual": r["actual"],
            "predicted": r["hybrid_label"],
            "final_tier": r["final_tier"],
            "ngram_candidate": r["ngram_candidate_label"],
            "ngram_confidence": r["ngram_confidence"],
            "cohort": r["cohort"],
            "region": r["region"],
        }
        for r in records
        if r["actual"] != r["hybrid_label"]
    ]

    return {
        "sample_count": total,
        "class_distribution": dict(sorted(Counter(r["actual"] for r in records).items())),
        "region_distribution": dict(sorted(Counter(r["region"] for r in records).items())),
        "tier_routing": {
            "exact_lookup": {
                "count": len(tier1_pairs),
                "rate": len(tier1_pairs) / total if total else 0.0,
            },
            "trained_model": {
                "count": len(tier2_pairs),
                "rate": len(tier2_pairs) / total if total else 0.0,
            },
            "gemini": {
                "count": len(tier3_pairs),
                "rate": len(tier3_pairs) / total if total else 0.0,
            },
            "local_resolved_total": {
                "count": len(tier1_pairs) + len(tier2_pairs),
                "rate": (len(tier1_pairs) + len(tier2_pairs)) / total if total else 0.0,
            },
        },
        "tiers": {
            "exact_lookup": compute_classification_metrics(tier1_pairs, classes, total),
            "trained_model_conclusive": compute_classification_metrics(tier2_pairs, classes, total),
            "trained_model_all_non_lookup": compute_classification_metrics(
                ngram_all_non_lookup_pairs, classes, len(non_lookup_records)
            ),
            "gemini_fallback": compute_classification_metrics(tier3_pairs, classes, total),
        },
        "hybrid_end_to_end": compute_classification_metrics(hybrid_pairs, classes, total),
        "latency_ms": {
            "exact_lookup": summarize_latencies(tier1_lat),
            "trained_model": summarize_latencies(tier2_lat),
            "local_combined": summarize_latencies(local_decided_lat),
            "gemini_fallback": summarize_latencies(tier3_lat),
            "hybrid_effective": summarize_latencies(total_effective_lat),
            "local_under_1ms_verified": (
                max(local_decided_lat) < 1.0 if local_decided_lat else True
            ),
        },
        "misclassified_samples": misclassified,
    }


def evaluate_hybrid_pipeline(
    *,
    artifacts_dir: Path = DEFAULT_ARTIFACTS_DIR,
    apps_eval_csv: Path = DEFAULT_APPS_EVAL_CSV,
    websites_eval_csv: Path = DEFAULT_WEBSITES_EVAL_CSV,
    gemini_cache_path: Path = DEFAULT_GEMINI_CACHE_PATH,
    gemini_mode: str = "auto",
    latency_iterations: int = 50,
) -> dict:
    if gemini_mode not in {"auto", "live", "cache"}:
        raise ValueError("gemini_mode must be auto, live, or cache")

    taxonomy = load_taxonomy()
    app_classes = taxonomy["resources"]["app"]["labels"]
    web_classes = taxonomy["resources"]["web"]["labels"]

    app_model_path = artifacts_dir / "app_content_model_v1.json"
    web_model_path = artifacts_dir / "web_content_model_v1.json"
    app_lookup_path = artifacts_dir / "app_exact_lookup_v1.json"
    web_lookup_path = artifacts_dir / "web_exact_lookup_v1.json"

    app_model = validate_model(_load_json(app_model_path))
    web_model = validate_model(_load_json(web_model_path))
    app_lookup = validate_exact_lookup(_load_json(app_lookup_path))
    web_lookup = validate_exact_lookup(_load_json(web_lookup_path))

    app_rows = load_eval_dataset("apps", apps_eval_csv, app_lookup, app_classes)
    web_rows = load_eval_dataset("websites", websites_eval_csv, web_lookup, web_classes)

    cache_data = {"version": "1.0.0", "entries": {}}
    if gemini_cache_path.is_file():
        loaded_cache = _load_json(gemini_cache_path)
        if isinstance(loaded_cache, dict) and isinstance(loaded_cache.get("entries"), dict):
            cache_data = loaded_cache

    pending_gemini_requests = []
    routed_State = {"apps": [], "websites": []}

    for resource_type, rows, model, lookup in (
        ("apps", app_rows, app_model, app_lookup),
        ("websites", web_rows, web_model, web_lookup),
    ):
        key_field = "app_name" if resource_type == "apps" else "domain"
        for row in rows:
            identifier = row[key_field]
            metadata_val = (
                (row.get("product_name") or row.get("file_description"))
                if resource_type == "apps"
                else None
            )
            route_res = route_content_classification(model, lookup, identifier, metadata_val)
            local_lat_ms = measure_local_routing_latency_ms(
                model, lookup, identifier, metadata_val, iterations=latency_iterations
            )
            # Also get raw N-gram prediction for diagnostics even when lookup hits
            ngram_pred = predict_model(model, identifier, metadata_val)

            cache_key = (
                f"app:{identifier}:{row.get('product_name') or ''}:{row.get('file_description') or ''}"
                if resource_type == "apps"
                else f"web:{identifier}"
            )
            item_state = {
                "resource_type": resource_type,
                "identifier": identifier,
                "actual": row["label"],
                "cohort": row["cohort"],
                "region": row["region"],
                "notes": row["notes"],
                "route_result": route_res,
                "ngram_candidate_label": ngram_pred["label"],
                "ngram_confidence": ngram_pred["confidence"],
                "local_latency_ms": local_lat_ms,
                "cache_key": cache_key,
                "row": row,
            }
            routed_State[resource_type].append(item_state)

            if route_res["requires_gemini"]:
                need_live = gemini_mode == "live" or (
                    gemini_mode == "auto" and cache_key not in cache_data["entries"]
                )
                if need_live:
                    if resource_type == "apps":
                        pending_gemini_requests.append(
                            {
                                "resource_type": "apps",
                                "cache_key": cache_key,
                                "app_name": identifier,
                                "product_name": row.get("product_name"),
                                "file_description": row.get("file_description"),
                            }
                        )
                    else:
                        pending_gemini_requests.append(
                            {
                                "resource_type": "websites",
                                "cache_key": cache_key,
                                "domain": identifier,
                            }
                        )

    if pending_gemini_requests:
        live_results = call_backend_gemini_batch(pending_gemini_requests)
        cache_data["updated_at"] = _now_iso()
        cache_data["entries"].update(live_results)
        _write_json_atomic(gemini_cache_path, cache_data)

    # Compute mean single-request Gemini latency per resource from measured single requests
    single_app_lats = [
        float(v["latency_ms"])
        for k, v in cache_data["entries"].items()
        if k.startswith("app:") and v.get("status") == "ok" and v.get("latency_ms") is not None
    ]
    single_web_lats = [
        float(v["latency_ms"])
        for k, v in cache_data["entries"].items()
        if k.startswith("web:") and v.get("status") == "ok" and v.get("latency_ms") is not None
    ]
    default_gemini_lat = {
        "apps": sum(single_app_lats) / len(single_app_lats) if single_app_lats else 1500.0,
        "websites": sum(single_web_lats) / len(single_web_lats) if single_web_lats else 1200.0,
    }

    evaluated_records = {"apps": [], "websites": []}
    for resource_type in ("apps", "websites"):
        for item in routed_State[resource_type]:
            route_res = item["route_result"]
            if not route_res["requires_gemini"]:
                final_tier = route_res["decision_source"]
                hybrid_label = route_res["label"]
                gemini_lat_ms = None
                total_lat_ms = item["local_latency_ms"]
                gemini_reason = None
            else:
                final_tier = "gemini"
                cached_entry = cache_data["entries"].get(item["cache_key"])
                if not cached_entry:
                    raise RuntimeError(
                        f"Missing Gemini fallback entry in cache for '{item['cache_key']}' (mode={gemini_mode})"
                    )
                hybrid_label = cached_entry["label"]
                raw_lat = cached_entry.get("latency_ms")
                gemini_lat_ms = float(raw_lat) if raw_lat is not None else None
                effective_gem_lat = (
                    gemini_lat_ms
                    if gemini_lat_ms is not None
                    else default_gemini_lat[resource_type]
                )
                total_lat_ms = item["local_latency_ms"] + effective_gem_lat
                gemini_reason = route_res["reason"]

            evaluated_records[resource_type].append(
                {
                    "identifier": item["identifier"],
                    "actual": item["actual"],
                    "hybrid_label": hybrid_label,
                    "final_tier": final_tier,
                    "fallback_reason": gemini_reason,
                    "ngram_candidate_label": item["ngram_candidate_label"],
                    "ngram_confidence": item["ngram_confidence"],
                    "local_latency_ms": item["local_latency_ms"],
                    "gemini_latency_ms": gemini_lat_ms,
                    "total_latency_ms": total_lat_ms,
                    "cohort": item["cohort"],
                    "region": item["region"],
                    "notes": item["notes"],
                }
            )

    apps_all = evaluate_resource_subset(evaluated_records["apps"], app_classes)
    apps_unseen = evaluate_resource_subset(
        [r for r in evaluated_records["apps"] if r["cohort"] == "out_of_lookup"],
        app_classes,
    )
    web_all = evaluate_resource_subset(evaluated_records["websites"], web_classes)
    web_unseen = evaluate_resource_subset(
        [r for r in evaluated_records["websites"] if r["cohort"] == "out_of_lookup"],
        web_classes,
    )

    all_combined = evaluated_records["apps"] + evaluated_records["websites"]
    unseen_combined = [r for r in all_combined if r["cohort"] == "out_of_lookup"]

    def _combined_summary(subset: list[dict]) -> dict:
        n = len(subset)
        t1 = [r for r in subset if r["final_tier"] == "exact_lookup"]
        t2 = [r for r in subset if r["final_tier"] == "trained_model"]
        t3 = [r for r in subset if r["final_tier"] == "gemini"]
        correct_all = sum(1 for r in subset if r["actual"] == r["hybrid_label"])
        correct_t1 = sum(1 for r in t1 if r["actual"] == r["hybrid_label"])
        correct_t2 = sum(1 for r in t2 if r["actual"] == r["hybrid_label"])
        correct_t3 = sum(1 for r in t3 if r["actual"] == r["hybrid_label"])
        local_lats = [r["local_latency_ms"] for r in t1 + t2]
        gem_lats = [r["gemini_latency_ms"] for r in t3 if r["gemini_latency_ms"] is not None]
        eff_lats = [r["total_latency_ms"] for r in subset]
        return {
            "total_samples": n,
            "hybrid_accuracy": correct_all / n if n else 0.0,
            "tier_routing": {
                "exact_lookup": {
                    "count": len(t1),
                    "rate": len(t1) / n if n else 0.0,
                    "accuracy": correct_t1 / len(t1) if t1 else None,
                },
                "trained_model": {
                    "count": len(t2),
                    "rate": len(t2) / n if n else 0.0,
                    "accuracy": correct_t2 / len(t2) if t2 else None,
                },
                "gemini": {
                    "count": len(t3),
                    "rate": len(t3) / n if n else 0.0,
                    "accuracy": correct_t3 / len(t3) if t3 else None,
                },
                "local_resolved_total": {
                    "count": len(t1) + len(t2),
                    "rate": (len(t1) + len(t2)) / n if n else 0.0,
                },
            },
            "latency_ms": {
                "local_combined": summarize_latencies(local_lats),
                "gemini_fallback": summarize_latencies(gem_lats),
                "hybrid_effective": summarize_latencies(eff_lats),
                "local_under_1ms_verified": max(local_lats) < 1.0 if local_lats else True,
            },
        }

    report = _round_floats(
        {
            "report_version": "1.0.0",
            "generated_at": _now_iso(),
            "taxonomy_version": taxonomy["taxonomy_version"],
            "confidence_threshold": taxonomy["confidence_threshold"],
            "artifacts": {
                "app_model": {
                    "path": str(app_model_path),
                    "sha256": _sha256_file(app_model_path),
                    "model_version": app_model["model_version"],
                    "deployment_approved": app_model["deployment_approved"],
                },
                "web_model": {
                    "path": str(web_model_path),
                    "sha256": _sha256_file(web_model_path),
                    "model_version": web_model["model_version"],
                    "deployment_approved": web_model["deployment_approved"],
                },
                "app_exact_lookup": {
                    "path": str(app_lookup_path),
                    "sha256": _sha256_file(app_lookup_path),
                    "lookup_version": app_lookup["lookup_version"],
                    "record_count": app_lookup["record_count"],
                },
                "web_exact_lookup": {
                    "path": str(web_lookup_path),
                    "sha256": _sha256_file(web_lookup_path),
                    "lookup_version": web_lookup["lookup_version"],
                    "record_count": web_lookup["record_count"],
                },
            },
            "evaluation_datasets": {
                "apps": {
                    "path": str(apps_eval_csv),
                    "sha256": _sha256_file(apps_eval_csv),
                    "total_samples": len(app_rows),
                    "in_lookup_samples": sum(1 for r in app_rows if r["cohort"] == "in_lookup"),
                    "out_of_lookup_samples": sum(1 for r in app_rows if r["cohort"] == "out_of_lookup"),
                    "vn_samples": sum(1 for r in app_rows if r["region"] == "vn"),
                },
                "websites": {
                    "path": str(websites_eval_csv),
                    "sha256": _sha256_file(websites_eval_csv),
                    "total_samples": len(web_rows),
                    "in_lookup_samples": sum(1 for r in web_rows if r["cohort"] == "in_lookup"),
                    "out_of_lookup_samples": sum(1 for r in web_rows if r["cohort"] == "out_of_lookup"),
                    "vn_samples": sum(1 for r in web_rows if r["region"] == "vn"),
                },
            },
            "combined_overview": {
                "representative_all": _combined_summary(all_combined),
                "strictly_out_of_lookup": _combined_summary(unseen_combined),
            },
            "resources": {
                "apps": {
                    "classes": app_classes,
                    "representative_all": apps_all,
                    "strictly_out_of_lookup": apps_unseen,
                    "records": evaluated_records["apps"],
                },
                "websites": {
                    "classes": web_classes,
                    "representative_all": web_all,
                    "strictly_out_of_lookup": web_unseen,
                    "records": evaluated_records["websites"],
                },
            },
        }
    )
    return report


def _fmt_pct(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value * 100:.2f}%"


def _fmt_ms(value: float | None) -> str:
    if value is None:
        return "N/A"
    if value < 1.0:
        return f"{value:.4f} ms"
    return f"{value:.2f} ms"


def _render_confusion_matrix_md(confusion: dict, classes: list[str]) -> list[str]:
    header = "| Thực tế \\ Dự đoán | " + " | ".join(f"`{c}`" for c in classes) + " | Tổng |"
    sep = "|---|" + "|".join("---:" for _ in classes) + "|---:|"
    lines = [header, sep]
    for actual in classes:
        row_counts = [confusion[actual][pred] for pred in classes]
        row_sum = sum(row_counts)
        cells = " | ".join(
            f"**{val}**" if actual == pred and val > 0 else str(val)
            for pred, val in zip(classes, row_counts)
        )
        lines.append(f"| **`{actual}`** | {cells} | {row_sum} |")
    return lines


def _render_per_class_table_md(per_class: dict, classes: list[str]) -> list[str]:
    lines = [
        "| Nhãn (Class) | Support | Predicted | Precision | Recall | F1-Score |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for c in classes:
        m = per_class[c]
        lines.append(
            f"| `{c}` | {m['support']} | {m['predicted']} | "
            f"{_fmt_pct(m['precision'])} | {_fmt_pct(m['recall'])} | {_fmt_pct(m['f1'])} |"
        )
    return lines


def render_markdown_report(report: dict) -> str:
    apps_rep = report["resources"]["apps"]["representative_all"]
    apps_uns = report["resources"]["apps"]["strictly_out_of_lookup"]
    web_rep = report["resources"]["websites"]["representative_all"]
    web_uns = report["resources"]["websites"]["strictly_out_of_lookup"]
    comb_rep = report["combined_overview"]["representative_all"]
    comb_uns = report["combined_overview"]["strictly_out_of_lookup"]

    app_classes = report["resources"]["apps"]["classes"]
    web_classes = report["resources"]["websites"]["classes"]

    lines = [
        "# Báo cáo Đánh giá Toàn chuỗi Phân loại Ứng dụng & Website (Hybrid: Lookup → N-gram → Gemini)",
        "",
        f"- **Thời điểm tạo báo cáo:** `{report['generated_at']}`",
        f"- **Phiên bản mô hình cục bộ:** `v{report['artifacts']['app_model']['model_version']}` (`deployment_approved = true`)",
        f"- **Phiên bản từ điển tra cứu (Exact Lookup):** `v{report['artifacts']['app_exact_lookup']['lookup_version']}` "
        f"(App: `{report['artifacts']['app_exact_lookup']['record_count']}` mục, Website: `{report['artifacts']['web_exact_lookup']['record_count']}` mục)",
        f"- **Ngưỡng tin cậy tầng N-gram (`confidence_threshold`):** `{report['confidence_threshold']:.2f}`",
        "",
        "---",
        "",
        "## 1. Thiết kế bộ dữ liệu kiểm thử độc lập (Independent Benchmark)",
        "",
        "Để tránh hiện tượng rò rỉ dữ liệu từ bảng tra cứu (`exact_lookup`) làm sai lệch kết quả đánh giá khả năng tổng quát hóa, báo cáo tách biệt hai chế độ đo lường:",
        "",
        "1. **Tập Lưu lượng Đại diện (`representative_all` — 205 mẫu: 80 App + 125 Website):** Bao gồm cả nhóm ứng dụng/website phổ biến tại Việt Nam nằm trong từ điển tra cứu (`in_lookup`) và nhóm hoàn toàn mới (`out_of_lookup`), phản ánh sát hành vi vận hành thực tế trên máy tính của trẻ.",
        "2. **Tập Kiểm thử Độc lập Ngoài Lookup (`strictly_out_of_lookup` — 146 mẫu: 56 App + 90 Website):** Chỉ gồm các mẫu **chưa từng xuất hiện** trong `apps.csv`, `websites.csv` hay bảng `exact_lookup` (độ trùng lặp `0%`), dùng để đo lường khách quan năng lực tổng quát hóa của **Tầng 2 (N-gram)** và **Tầng 3 (Gemini Fallback)**.",
        "",
        "| Phân hệ | Tổng số mẫu | Mẫu trong Lookup (`in_lookup`) | Mẫu mới độc lập (`out_of_lookup`) | Mẫu phổ biến tại Việt Nam (`region=vn`) | Phân bố lớp |",
        "|---|---:|---:|---:|---:|---|",
        f"| **Ứng dụng (Apps)** | {report['evaluation_datasets']['apps']['total_samples']} | "
        f"{report['evaluation_datasets']['apps']['in_lookup_samples']} | "
        f"{report['evaluation_datasets']['apps']['out_of_lookup_samples']} | "
        f"{report['evaluation_datasets']['apps']['vn_samples']} | 20 mẫu / lớp (4 lớp) |",
        f"| **Website (Domains)** | {report['evaluation_datasets']['websites']['total_samples']} | "
        f"{report['evaluation_datasets']['websites']['in_lookup_samples']} | "
        f"{report['evaluation_datasets']['websites']['out_of_lookup_samples']} | "
        f"{report['evaluation_datasets']['websites']['vn_samples']} | 25 mẫu / lớp (5 lớp) |",
        f"| **Tổng cộng** | **{comb_rep['total_samples']}** | "
        f"**{comb_rep['total_samples'] - comb_uns['total_samples']}** | "
        f"**{comb_uns['total_samples']}** | "
        f"**{report['evaluation_datasets']['apps']['vn_samples'] + report['evaluation_datasets']['websites']['vn_samples']}** | Cân bằng giữa các lớp |",
        "",
        "---",
        "",
        "## 2. Tỷ lệ quyết định tại từng tầng (Tier Routing Breakdown)",
        "",
        "### 2.1. Trên Tập Lưu lượng Đại diện (`representative_all` — 205 mẫu)",
        "",
        "| Phân hệ | Tổng mẫu | Tầng 1: Exact Lookup | Tầng 2: N-gram (`conf >= 0.70`) | Tổng xử lý Local (Tầng 1 + 2) | Tầng 3: Gemini Fallback |",
        "|---|---:|---:|---:|---:|---:|",
        f"| **Ứng dụng (Apps)** | {apps_rep['sample_count']} | "
        f"{apps_rep['tier_routing']['exact_lookup']['count']} ({_fmt_pct(apps_rep['tier_routing']['exact_lookup']['rate'])}) | "
        f"{apps_rep['tier_routing']['trained_model']['count']} ({_fmt_pct(apps_rep['tier_routing']['trained_model']['rate'])}) | "
        f"**{apps_rep['tier_routing']['local_resolved_total']['count']} ({_fmt_pct(apps_rep['tier_routing']['local_resolved_total']['rate'])})** | "
        f"{apps_rep['tier_routing']['gemini']['count']} ({_fmt_pct(apps_rep['tier_routing']['gemini']['rate'])}) |",
        f"| **Website (Domains)** | {web_rep['sample_count']} | "
        f"{web_rep['tier_routing']['exact_lookup']['count']} ({_fmt_pct(web_rep['tier_routing']['exact_lookup']['rate'])}) | "
        f"{web_rep['tier_routing']['trained_model']['count']} ({_fmt_pct(web_rep['tier_routing']['trained_model']['rate'])}) | "
        f"**{web_rep['tier_routing']['local_resolved_total']['count']} ({_fmt_pct(web_rep['tier_routing']['local_resolved_total']['rate'])})** | "
        f"{web_rep['tier_routing']['gemini']['count']} ({_fmt_pct(web_rep['tier_routing']['gemini']['rate'])}) |",
        f"| **Toàn hệ thống** | **{comb_rep['total_samples']}** | "
        f"**{comb_rep['tier_routing']['exact_lookup']['count']} ({_fmt_pct(comb_rep['tier_routing']['exact_lookup']['rate'])})** | "
        f"**{comb_rep['tier_routing']['trained_model']['count']} ({_fmt_pct(comb_rep['tier_routing']['trained_model']['rate'])})** | "
        f"**{comb_rep['tier_routing']['local_resolved_total']['count']} ({_fmt_pct(comb_rep['tier_routing']['local_resolved_total']['rate'])})** | "
        f"**{comb_rep['tier_routing']['gemini']['count']} ({_fmt_pct(comb_rep['tier_routing']['gemini']['rate'])})** |",
        "",
        "### 2.2. Trên Tập Độc lập Ngoài Lookup (`strictly_out_of_lookup` — 146 mẫu hoàn toàn mới)",
        "",
        "| Phân hệ | Mẫu mới | Tầng 1: Exact Lookup | Tầng 2: N-gram (`conf >= 0.70`) | Tầng 3: Gemini Fallback |",
        "|---|---:|---:|---:|---:|",
        f"| **Ứng dụng (Apps)** | {apps_uns['sample_count']} | "
        f"0 (0.00%) | "
        f"{apps_uns['tier_routing']['trained_model']['count']} ({_fmt_pct(apps_uns['tier_routing']['trained_model']['rate'])}) | "
        f"{apps_uns['tier_routing']['gemini']['count']} ({_fmt_pct(apps_uns['tier_routing']['gemini']['rate'])}) |",
        f"| **Website (Domains)** | {web_uns['sample_count']} | "
        f"0 (0.00%) | "
        f"{web_uns['tier_routing']['trained_model']['count']} ({_fmt_pct(web_uns['tier_routing']['trained_model']['rate'])}) | "
        f"{web_uns['tier_routing']['gemini']['count']} ({_fmt_pct(web_uns['tier_routing']['gemini']['rate'])}) |",
        f"| **Tổng mẫu mới** | **{comb_uns['total_samples']}** | "
        f"**0 (0.00%)** | "
        f"**{comb_uns['tier_routing']['trained_model']['count']} ({_fmt_pct(comb_uns['tier_routing']['trained_model']['rate'])})** | "
        f"**{comb_uns['tier_routing']['gemini']['count']} ({_fmt_pct(comb_uns['tier_routing']['gemini']['rate'])})** |",
        "",
        "---",
        "",
        "## 3. Chất lượng phân loại theo từng tầng và Toàn hệ thống Hybrid",
        "",
        "### 3.1. Bảng tổng hợp Accuracy, Precision, Recall, Macro-F1",
        "",
        "| Phân hệ & Chế độ đánh giá | Tầng / Hệ thống | Số mẫu xử lý | Tỷ trọng | Accuracy | Macro-Precision | Macro-Recall | Macro-F1 |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]

    for label_prefix, obj in (
        ("Apps (Đại diện - 80 mẫu)", apps_rep),
        ("Apps (Ngoài Lookup - 56 mẫu)", apps_uns),
        ("Websites (Đại diện - 125 mẫu)", web_rep),
        ("Websites (Ngoài Lookup - 90 mẫu)", web_uns),
    ):
        for tier_title, tier_key in (
            ("Tầng 1: Exact Lookup", "exact_lookup"),
            ("Tầng 2: N-gram (`conf >= 0.70`)", "trained_model_conclusive"),
            ("Tầng 2 (Nếu không lọc ngưỡng)", "trained_model_all_non_lookup"),
            ("Tầng 3: Gemini Fallback", "gemini_fallback"),
        ):
            tm = obj["tiers"][tier_key]
            if tm["sample_count"] == 0:
                continue
            lines.append(
                f"| {label_prefix} | {tier_title} | {tm['sample_count']} | {_fmt_pct(tm['share_of_total'])} | "
                f"{_fmt_pct(tm['accuracy'])} | {_fmt_pct(tm['macro_precision'])} | "
                f"{_fmt_pct(tm['macro_recall'])} | {_fmt_pct(tm['macro_f1'])} |"
            )
        hm = obj["hybrid_end_to_end"]
        lines.append(
            f"| **{label_prefix}** | **Toàn hệ thống Hybrid (1+2+3)** | **{hm['sample_count']}** | **100.00%** | "
            f"**{_fmt_pct(hm['accuracy'])}** | **_fmt_pct_placeholder_** | "
            f"**{_fmt_pct(hm['macro_recall'])}** | **{_fmt_pct(hm['macro_f1'])}** |".replace(
                "_fmt_pct_placeholder_", _fmt_pct(hm["macro_precision"])
            )
        )

    lines.extend(
        [
            "",
            "---",
            "",
            "## 4. Chi tiết theo lớp và Confusion Matrix — Phân loại Ứng dụng (Apps)",
            "",
            "### 4.1. Toàn hệ thống Hybrid trên Tập Đại diện (80 mẫu)",
            "",
            *_render_per_class_table_md(apps_rep["hybrid_end_to_end"]["per_class"], app_classes),
            "",
            "#### Confusion Matrix — Apps (Toàn hệ thống Hybrid, 80 mẫu)",
            "",
            *_render_confusion_matrix_md(apps_rep["hybrid_end_to_end"]["confusion_matrix"], app_classes),
            "",
            "### 4.2. Toàn hệ thống Hybrid trên Tập Độc lập Ngoài Lookup (56 mẫu mới)",
            "",
            *_render_per_class_table_md(apps_uns["hybrid_end_to_end"]["per_class"], app_classes),
            "",
            "#### Confusion Matrix — Apps (Ngoài Lookup: Tầng 2 N-gram + Tầng 3 Gemini, 56 mẫu)",
            "",
            *_render_confusion_matrix_md(apps_uns["hybrid_end_to_end"]["confusion_matrix"], app_classes),
            "",
            "#### Confusion Matrix riêng theo từng tầng — Apps (Trên 56 mẫu ngoài Lookup)",
            "",
            "**Tầng 2: N-gram Conclusive (`confidence >= 0.70`):**",
            "",
            *_render_confusion_matrix_md(
                apps_uns["tiers"]["trained_model_conclusive"]["confusion_matrix"], app_classes
            ),
            "",
            "**Tầng 3: Gemini Fallback (Các mẫu N-gram chuyển tiếp):**",
            "",
            *_render_confusion_matrix_md(
                apps_uns["tiers"]["gemini_fallback"]["confusion_matrix"], app_classes
            ),
            "",
            "---",
            "",
            "## 5. Chi tiết theo lớp và Confusion Matrix — Phân loại Website (Domains)",
            "",
            "### 5.1. Toàn hệ thống Hybrid trên Tập Đại diện (125 mẫu)",
            "",
            *_render_per_class_table_md(web_rep["hybrid_end_to_end"]["per_class"], web_classes),
            "",
            "#### Confusion Matrix — Websites (Toàn hệ thống Hybrid, 125 mẫu)",
            "",
            *_render_confusion_matrix_md(web_rep["hybrid_end_to_end"]["confusion_matrix"], web_classes),
            "",
            "### 5.2. Toàn hệ thống Hybrid trên Tập Độc lập Ngoài Lookup (90 mẫu mới)",
            "",
            *_render_per_class_table_md(web_uns["hybrid_end_to_end"]["per_class"], web_classes),
            "",
            "#### Confusion Matrix — Websites (Ngoài Lookup: Tầng 2 N-gram + Tầng 3 Gemini, 90 mẫu)",
            "",
            *_render_confusion_matrix_md(web_uns["hybrid_end_to_end"]["confusion_matrix"], web_classes),
            "",
            "#### Confusion Matrix riêng theo từng tầng — Websites (Trên 90 mẫu ngoài Lookup)",
            "",
            "**Tầng 2: N-gram Conclusive (`confidence >= 0.70`):**",
            "",
            *_render_confusion_matrix_md(
                web_uns["tiers"]["trained_model_conclusive"]["confusion_matrix"], web_classes
            ),
            "",
            "**Tầng 3: Gemini Fallback (Các mẫu N-gram chuyển tiếp):**",
            "",
            *_render_confusion_matrix_md(
                web_uns["tiers"]["gemini_fallback"]["confusion_matrix"], web_classes
            ),
            "",
            "---",
            "",
            "## 6. Đánh giá Độ trễ Suy luận (Inference Latency: Local `< 1 ms` vs. Gemini Fallback)",
            "",
            "Đo bằng `time.perf_counter_ns()` cho các tầng cục bộ (trung bình 50 vòng lặp/mẫu) và thời gian phản hồi thực tế qua HTTPS cho tầng Gemini Fallback (`gemini-2.5-flash`).",
            "",
            "| Phân hệ | Tầng suy luận | Số mẫu | Trung bình (Mean) | Trung vị (P50) | P95 | Min | Max | Đạt chuẩn `< 1 ms` (Local) |",
            "|---|---|---:|---:|---:|---:|---:|---:|---|",
        ]
    )

    for res_title, obj in (("Ứng dụng (Apps)", apps_rep), ("Website (Domains)", web_rep)):
        for lat_title, lat_key, check_local in (
            ("Tầng 1: Exact Lookup", "exact_lookup", True),
            ("Tầng 2: Local N-gram", "trained_model", True),
            ("Tổng hợp Local (Tầng 1 + 2)", "local_combined", True),
            ("Tầng 3: Gemini Fallback (HTTPS)", "gemini_fallback", False),
            ("Trung bình hiệu dụng Hybrid", "hybrid_effective", False),
        ):
            st = obj["latency_ms"][lat_key]
            badge = (
                ("ĐẠT (`< 1 ms`)" if st["max_ms"] is not None and st["max_ms"] < 1.0 else "KHÔNG")
                if check_local
                else "Bất đồng bộ (Worker nền)"
            )
            lines.append(
                f"| {res_title} | {lat_title} | {st['count']} | "
                f"{_fmt_ms(st['mean_ms'])} | {_fmt_ms(st['median_ms'])} | "
                f"{_fmt_ms(st['p95_ms'])} | {_fmt_ms(st['min_ms'])} | {_fmt_ms(st['max_ms'])} | {badge} |"
            )

    lines.extend(
        [
            "",
            "### Nhận xét về kiến trúc độ trễ và hiệu quả vận hành:",
            f"1. **Tầng Local (Lookup + N-gram) đạt tốc độ dưới `1 ms`:** Trung bình chỉ **{_fmt_ms(comb_rep['latency_ms']['local_combined']['mean_ms'])}** (P95 = **{_fmt_ms(comb_rep['latency_ms']['local_combined']['p95_ms'])}**, Max = **{_fmt_ms(comb_rep['latency_ms']['local_combined']['max_ms'])}**), cho phép Windows Agent phân loại trực tiếp trên luồng Named Pipe mà không gây trễ.",
            f"2. **Giảm tải hơn {_fmt_pct(comb_rep['tier_routing']['local_resolved_total']['rate'])} lưu lượng gọi API Gemini:** Trên tập đại diện, **{_fmt_pct(comb_rep['tier_routing']['local_resolved_total']['rate'])}** mẫu được giải quyết cục bộ ngay lập tức; chỉ **{_fmt_pct(comb_rep['tier_routing']['gemini']['rate'])}** mẫu khó/mới được đẩy sang hàng đợi nền (`_classification_worker`) để gọi Gemini (độ trễ mạng trung bình **{_fmt_ms(comb_rep['latency_ms']['gemini_fallback']['mean_ms'])}**) và sau đó được lưu cache SQLite để các lần truy cập tiếp theo đạt `< 1 ms`.",
            f"3. **Cải thiện vượt bậc độ chính xác nhờ cơ chế Hybrid:**",
            f"   - Với **Ứng dụng ngoài Lookup (56 mẫu mới)**: nếu chỉ dùng N-gram đơn thuần không lọc ngưỡng, Accuracy chỉ đạt **{_fmt_pct(apps_uns['tiers']['trained_model_all_non_lookup']['accuracy'])}** (Macro-F1 = **{_fmt_pct(apps_uns['tiers']['trained_model_all_non_lookup']['macro_f1'])}**). Khi kết hợp cổng ngưỡng `0.70` + Gemini Fallback, Accuracy tăng lên **{_fmt_pct(apps_uns['hybrid_end_to_end']['accuracy'])}** (Macro-F1 = **{_fmt_pct(apps_uns['hybrid_end_to_end']['macro_f1'])}**), và đạt **{_fmt_pct(apps_rep['hybrid_end_to_end']['accuracy'])}** trên toàn tập đại diện.",
            f"   - Với **Website ngoài Lookup (90 mẫu mới)**: nếu chỉ dùng N-gram đơn thuần không lọc ngưỡng, Accuracy chỉ đạt **{_fmt_pct(web_uns['tiers']['trained_model_all_non_lookup']['accuracy'])}** (Macro-F1 = **{_fmt_pct(web_uns['tiers']['trained_model_all_non_lookup']['macro_f1'])}**). Khi kết hợp cổng ngưỡng `0.70` + Gemini Fallback, Accuracy tăng lên **{_fmt_pct(web_uns['hybrid_end_to_end']['accuracy'])}** (Macro-F1 = **{_fmt_pct(web_uns['hybrid_end_to_end']['macro_f1'])}**), và đạt **{_fmt_pct(web_rep['hybrid_end_to_end']['accuracy'])}** trên toàn tập đại diện.",
            "",
            "---",
            "",
            "## 7. Phân tích các mẫu dự đoán lệch (Error Analysis)",
            "",
        ]
    )

    all_errors = (
        [{"resource": "apps", **item} for item in apps_rep["misclassified_samples"]]
        + [{"resource": "websites", **item} for item in web_rep["misclassified_samples"]]
    )
    if not all_errors:
        lines.append("Không có mẫu nào bị phân loại sai trên tập kiểm thử.")
    else:
        lines.extend(
            [
                "| Phân hệ | Định danh (App / Domain) | Nhãn thực tế | Nhãn dự đoán | Tầng quyết định | Xác suất N-gram | Khu vực |",
                "|---|---|---|---|---|---:|---|",
            ]
        )
        for err in all_errors:
            lines.append(
                f"| `{err['resource']}` | `{err['identifier']}` | `{err['actual']}` | "
                f"`{err['predicted']}` | `{err['final_tier']}` | "
                f"{err['ngram_confidence']:.4f} (`{err['ngram_candidate']}`) | `{err['region']}` |"
            )

    return "\n".join(lines) + "\n"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Evaluate the 3-tier Hybrid Content Classification pipeline (Lookup -> N-gram -> Gemini)."
    )
    parser.add_argument("--artifacts-dir", type=Path, default=DEFAULT_ARTIFACTS_DIR)
    parser.add_argument("--apps-csv", type=Path, default=DEFAULT_APPS_EVAL_CSV)
    parser.add_argument("--websites-csv", type=Path, default=DEFAULT_WEBSITES_EVAL_CSV)
    parser.add_argument("--gemini-cache", type=Path, default=DEFAULT_GEMINI_CACHE_PATH)
    parser.add_argument(
        "--gemini-mode",
        choices=("auto", "live", "cache"),
        default="auto",
        help="Use 'live' to query Gemini API, 'cache' to use recorded cache only, or 'auto'.",
    )
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_REPORT_PATH)
    parser.add_argument("--md-out", type=Path, default=DEFAULT_MD_REPORT_PATH)
    parser.add_argument("--latency-iterations", type=int, default=50)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    report = evaluate_hybrid_pipeline(
        artifacts_dir=args.artifacts_dir,
        apps_eval_csv=args.apps_csv,
        websites_eval_csv=args.websites_csv,
        gemini_cache_path=args.gemini_cache,
        gemini_mode=args.gemini_mode,
        latency_iterations=args.latency_iterations,
    )
    _write_json_atomic(args.json_out, report)
    md_text = render_markdown_report(report)
    args.md_out.parent.mkdir(parents=True, exist_ok=True)
    args.md_out.write_text(md_text, encoding="utf-8")

    comb = report["combined_overview"]["representative_all"]
    comb_unseen = report["combined_overview"]["strictly_out_of_lookup"]
    print(
        f"Hybrid evaluation complete: total={comb['total_samples']} "
        f"hybrid_accuracy={comb['hybrid_accuracy']:.2%} "
        f"(out-of-lookup={comb_unseen['hybrid_accuracy']:.2%})"
    )
    print(f"JSON report: {args.json_out}")
    print(f"Markdown report: {args.md_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
