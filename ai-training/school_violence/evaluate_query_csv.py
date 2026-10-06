"""Audit user-labelled CSV queries and evaluate the checksum-locked v8.

No fitting, threshold selection, row exclusion or source-label rewriting.
Unknown provenance is recorded explicitly; only a confirmed real holdout with
no outstanding audit issues is sent through the official real-world evaluator.
All outputs, including the source snapshot, stay in ignored local artifacts.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from .adapt_confirmed_errors_v6 import read_csv, sha256
from .adapt_reviewed_queries_v7 import metrics_from_matrix
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .evaluate_real_world import BACKEND_REJECTED_TEXT, _text_keys, evaluate_holdout
from .predict import load_model
from .training import LABELS, SENSITIVE_PATTERNS, predict_scores, select_label
from text_safety.engine import ModerationInput, ThreeLabelEngine


LOCK = Path(__file__).parent / "query_v8_candidate.lock.json"
NEAR_RATIO = 0.85


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def read_queries(path: Path) -> list[dict]:
    rows = read_csv(path, ["id", "text", "label"])
    seen = set()
    for row in rows:
        if row["label"] not in LABELS:
            raise ValueError(f"Invalid label at ID {row['id']}")
        value = " ".join(unicodedata.normalize("NFKC", row["text"]).split())
        if not value or len(value) > 1000 or any(
            ord(c) < 32 and c not in "\t\r\n" or ord(c) == 127 for c in row["text"]
        ):
            raise ValueError(f"Invalid query at ID {row['id']}")
        if any(pattern.search(value) for pattern in (*SENSITIVE_PATTERNS, *BACKEND_REJECTED_TEXT)):
            raise ValueError(f"Potential private identifier at ID {row['id']}")
        keys = _text_keys(row["text"])
        if keys & seen:
            raise ValueError(f"Duplicate query at ID {row['id']}")
        seen.update(keys)
    if {row["label"] for row in rows} != set(LABELS):
        raise ValueError("Evaluation needs all three labels")
    return rows


def overlap_audit(rows: list[dict], artifact: Path) -> dict:
    references = [json.loads(line) for split in ("train", "validation", "test")
                  for line in (artifact / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()]
    keys = defaultdict(list)
    for row in references:
        for key in _text_keys(row["text"]):
            keys[key].append({"id": row["id"], "label": row["label"], "split": row["split"]})
    exact, near = [], []
    comparisons = [(row, normalized(row["text"])) for row in references]
    for row in rows:
        for key in _text_keys(row["text"]):
            if key in keys:
                exact.append({"id": row["id"], "references": keys[key]})
        query = normalized(row["text"])
        closest = max(((SequenceMatcher(None, query, text).ratio(), old)
                       for old, text in comparisons), key=lambda item: item[0])
        if closest[0] >= NEAR_RATIO:
            near.append({"id": row["id"], "reference_id": closest[1]["id"],
                         "reference_label": closest[1]["label"], "split": closest[1]["split"],
                         "similarity": closest[0]})
    internal = []
    for i, first in enumerate(rows):
        for second in rows[i + 1:]:
            ratio = SequenceMatcher(None, normalized(first["text"]), normalized(second["text"])).ratio()
            if ratio >= NEAR_RATIO:
                internal.append({"ids": [first["id"], second["id"]], "similarity": ratio,
                                 "conflicting_labels": first["label"] != second["label"]})
    return {"reference_rows": len(references), "reference_splits": ["train", "validation", "test"],
            "exact_text_overlap": exact, "near_reference_overlap": near,
            "near_pairs_in_new_set": internal, "near_ratio": NEAR_RATIO,
            "semantic_independence_verified": False,
            "same_child_or_session_independence_verified": False}


def run(csv_path: Path, output: Path, *, origin: str = "unspecified",
        metadata_confirmed: bool = False, review_ids: tuple[str, ...] = ()) -> dict:
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    if origin not in ("unspecified", "real_world", "self_authored"):
        raise ValueError("Invalid origin declaration")
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    model_path = Path(__file__).resolve().parents[1] / lock["artifact_relative_to_ai_training"]
    if sha256(model_path) != lock["model_sha256"]:
        raise ValueError("V8 artifact no longer matches the candidate lock")
    model = load_model(model_path)
    if model["model_version"] != lock["model_version"]:
        raise ValueError("V8 version does not match the lock")
    initial_hash = sha256(csv_path)
    rows = read_queries(csv_path)
    if set(review_ids) - {row["id"] for row in rows}:
        raise ValueError("Label review ID is not in the supplied dataset")
    audit = overlap_audit(rows, model_path.parent)
    # Persist both audit and exact labels before the first v8 prediction.
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(csv_path, output / "source_snapshot.csv")
    preflight = {"source_csv_sha256": initial_hash, "candidate_sha256": lock["model_sha256"],
                 "rows": len(rows), "label_counts": dict(Counter(row["label"] for row in rows)),
                 "origin": origin, "metadata_confirmed_by_user": metadata_confirmed,
                 "pending_label_review_ids": list(review_ids), "overlap_audit": audit,
                 "permission_for_local_evaluation": "user_requested_evaluation_in_conversation",
                 "formal_acceptance_thresholds_predeclared": False}
    (output / "preflight_audit.json").write_text(json.dumps(preflight, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    matrix = {a: {b: 0 for b in LABELS} for a in LABELS}
    predictions = []
    engine = ThreeLabelEngine(model_path)
    for row in rows:
        scores = predict_scores(model, row["text"])
        label = select_label(model, scores)
        result = engine.moderate(ModerationInput(row["id"], row["text"], "search_query"))
        if result["label"] != label or any(abs(result["scores"][key] - scores[key]) > 1e-12 for key in LABELS):
            raise AssertionError("CLI and service engine predictions disagree")
        if not all(math.isfinite(value) and 0 <= value <= 1 for value in scores.values()) or abs(sum(scores.values()) - 1) > 1e-12:
            raise AssertionError("Invalid classifier scores")
        matrix[row["label"]][label] += 1
        predictions.append({"id": row["id"], "label": row["label"], "predicted": label,
                            "correct": label == row["label"], "scores": scores,
                            "confidence": scores[label], "pending_label_review": row["id"] in review_ids})
    metrics = metrics_from_matrix(matrix)
    exact_pass = not audit["exact_text_overlap"]
    near_pass = not audit["near_reference_overlap"] and not audit["near_pairs_in_new_set"]
    real_holdout = origin == "real_world" and metadata_confirmed and not review_ids and exact_pass and near_pass
    official = None
    if real_holdout:
        records = [{"id": f"{csv_path.stem}:{row['id']}", "text": row["text"], "label": row["label"],
            "source_type": "search_query", "split": "test", "source": "real_world",
            "review_status": "reviewed", "pii_removed": True,
            "permission_reference": "user_confirmed_source_permission_anonymization_and_blind_labels",
            "dataset_version": f"{csv_path.stem}-{initial_hash[:12]}-holdout"} for row in rows]
        holdout = output / "holdout.jsonl"
        holdout.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records), encoding="utf-8")
        official = evaluate_holdout(holdout, model_path.parent)
        if official["overall"]["confusion_matrix"] != matrix:
            raise AssertionError("Official evaluation disagrees with CSV evaluation")
    if sha256(csv_path) != initial_hash or sha256(model_path) != lock["model_sha256"]:
        raise RuntimeError("Dataset or model changed during evaluation")
    report = {"model_version": lock["model_version"], "model_sha256": lock["model_sha256"],
        "source_csv_sha256": initial_hash, "dataset_name": csv_path.stem,
        "rows": len(rows), "label_counts": preflight["label_counts"], "preflight": preflight,
        "overall": metrics, "accuracy": sum(matrix[label][label] for label in LABELS) / len(rows),
        "predictions_by_id": predictions,
        "errors_by_id": [row for row in predictions if not row["correct"]],
        "high_risk_to_safe": matrix["HIGH_RISK"]["SAFE"],
        "high_risk_to_risk": matrix["HIGH_RISK"]["RISK"],
        "safe_alerts": matrix["SAFE"]["RISK"] + matrix["SAFE"]["HIGH_RISK"],
        "risk_to_high": matrix["RISK"]["HIGH_RISK"],
        "all_rows_retained": True, "source_labels_unchanged": True,
        "service_engine_matches_on_all_rows": True,
        "test_only_no_refitting_or_threshold_selection": True,
        "official_real_world_evaluation": official,
        "independent_real_world_evaluation_completed": real_holdout,
        "deployment_eligible": False,
        "limitations": ["A balanced 90-row benchmark does not estimate live alert frequency.",
            "Provenance, permission, anonymization and blind labelling are operator claims, not code-verified facts.",
            "No formal numerical release thresholds were approved before this evaluation.",
            "Review-pending IDs retain their supplied labels and are not silently excluded."]}
    (output / "evaluation_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("rows", "accuracy", "high_risk_to_safe",
        "high_risk_to_risk", "safe_alerts", "risk_to_high", "independent_real_world_evaluation_completed")}
        | {"confusion_matrix": matrix, "macro_f1": metrics["macro_f1"],
           "error_ids": [row["id"] for row in report["errors_by_id"]]}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--origin", choices=("unspecified", "real_world", "self_authored"), default="unspecified")
    parser.add_argument("--metadata-confirmed", action="store_true")
    parser.add_argument("--review-id", action="append", default=[])
    args = parser.parse_args()
    run(args.csv, args.output_dir, origin=args.origin, metadata_confirmed=args.metadata_confirmed,
        review_ids=tuple(args.review_id))


if __name__ == "__main__":
    main()
