"""Train and independently evaluate app and website identifier classifiers."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.content_model import (
    calibrate_temperature,
    evaluate_model,
    fit_model,
    stratified_group_split,
    validate_model,
)
from content_classification.validate_dataset import (
    DatasetContractError,
    load_taxonomy,
    validate_csv_dataset,
)


DEFAULT_DATASET_DIR = TRAINING_ROOT / "datasets" / "content"
DEFAULT_CONFIG_PATH = (
    TRAINING_ROOT
    / "content_classification"
    / "content_model_training_config.json"
)
DEFAULT_OUTPUT_DIR = TRAINING_ROOT / "artifacts" / "content_classification"


class ContentTrainingError(RuntimeError):
    """Raised when model training inputs or configuration are unsafe."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ContentTrainingError(f"Missing JSON file: {path}") from error
    except json.JSONDecodeError as error:
        raise ContentTrainingError(
            f"Invalid JSON {path}: line {error.lineno}: {error.msg}"
        ) from error


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def load_training_config(path: Path | str = DEFAULT_CONFIG_PATH) -> dict:
    config = _load_json(Path(path))
    if config.get("config_version") != "1.0.0":
        raise ContentTrainingError("Training config_version must be 1.0.0")
    if not isinstance(config.get("random_seed"), str) or not config["random_seed"]:
        raise ContentTrainingError("Training config requires random_seed")
    ratios = config.get("split_ratios")
    if not isinstance(ratios, dict) or set(ratios) != {"train", "validation", "test"}:
        raise ContentTrainingError("Training config has invalid split_ratios")
    ratio_values = tuple(float(ratios[name]) for name in ("train", "validation", "test"))
    if any(value <= 0 for value in ratio_values) or not math.isclose(
        sum(ratio_values), 1.0, abs_tol=1e-9
    ):
        raise ContentTrainingError("Training split ratios must be positive and sum to 1")
    resources = config.get("resources")
    if not isinstance(resources, dict) or set(resources) != {"apps", "websites"}:
        raise ContentTrainingError("Training config must define apps and websites")
    required_gates = {
        "minimum_total_samples_per_class",
        "minimum_test_samples_per_class",
        "minimum_macro_f1",
        "minimum_conclusive_accuracy",
        "minimum_conclusive_coverage",
        "maximum_high_confidence_error_rate",
    }
    for resource_type, resource in resources.items():
        features = resource.get("feature_config")
        if not isinstance(features, dict):
            raise ContentTrainingError(f"{resource_type} feature_config is missing")
        minimum_n = features.get("minimum_n")
        maximum_n = features.get("maximum_n")
        if not isinstance(minimum_n, int) or not isinstance(maximum_n, int):
            raise ContentTrainingError(f"{resource_type} n-gram range is invalid")
        if not 1 <= minimum_n <= maximum_n <= 8:
            raise ContentTrainingError(f"{resource_type} n-gram range is invalid")
        if not isinstance(resource.get("alpha"), (int, float)) or resource["alpha"] <= 0:
            raise ContentTrainingError(f"{resource_type} alpha must be positive")
        search_grid = resource.get("search_grid")
        if not isinstance(search_grid, dict):
            raise ContentTrainingError(f"{resource_type} search_grid is missing")
        ranges = search_grid.get("ngram_ranges")
        alphas = search_grid.get("alphas")
        if not isinstance(ranges, list) or not ranges or not isinstance(alphas, list) or not alphas:
            raise ContentTrainingError(f"{resource_type} search_grid is invalid")
        for item in ranges:
            if (
                not isinstance(item, list)
                or len(item) != 2
                or not all(isinstance(value, int) for value in item)
                or not 1 <= item[0] <= item[1] <= 8
            ):
                raise ContentTrainingError(f"{resource_type} search n-gram range is invalid")
        if any(not isinstance(value, (int, float)) or value <= 0 for value in alphas):
            raise ContentTrainingError(f"{resource_type} search alpha is invalid")
        acceptance = resource.get("acceptance")
        if not isinstance(acceptance, dict) or set(acceptance) != required_gates:
            raise ContentTrainingError(f"{resource_type} acceptance gates are incomplete")
    config["_ratio_values"] = ratio_values
    return config


def load_records(path: Path, expected_headers: tuple[str, ...]) -> list[dict]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != expected_headers:
                raise ContentTrainingError(
                    f"CSV header must be exactly {','.join(expected_headers)}: {path}"
                )
            return [
                {field: (row.get(field) or "").strip() for field in expected_headers}
                for row in reader
            ]
    except UnicodeError as error:
        raise ContentTrainingError(f"Dataset must be UTF-8: {path}") from error


def _gate(name: str, actual, requirement: str, passed: bool) -> dict:
    return {
        "name": name,
        "actual": actual,
        "requirement": requirement,
        "passed": bool(passed),
    }


def evaluate_acceptance(
    all_records: list[dict],
    test_metrics: dict,
    classes: list[str],
    acceptance: dict,
) -> dict:
    total_counts = Counter(record["label"] for record in all_records)
    minimum_total = int(acceptance["minimum_total_samples_per_class"])
    minimum_test = int(acceptance["minimum_test_samples_per_class"])
    minimum_conclusive_accuracy = float(acceptance["minimum_conclusive_accuracy"])
    conclusive_accuracy = test_metrics["conclusive_accuracy"]
    gates = [
        _gate(
            "minimum_total_samples_per_class",
            min(total_counts[label] for label in classes),
            f">= {minimum_total}",
            all(total_counts[label] >= minimum_total for label in classes),
        ),
        _gate(
            "minimum_test_samples_per_class",
            min(test_metrics["per_class"][label]["support"] for label in classes),
            f">= {minimum_test}",
            all(
                test_metrics["per_class"][label]["support"] >= minimum_test
                for label in classes
            ),
        ),
        _gate(
            "minimum_macro_f1",
            test_metrics["macro_f1"],
            f">= {acceptance['minimum_macro_f1']}",
            test_metrics["macro_f1"] >= float(acceptance["minimum_macro_f1"]),
        ),
        _gate(
            "minimum_conclusive_accuracy",
            conclusive_accuracy,
            f">= {minimum_conclusive_accuracy}",
            conclusive_accuracy is not None
            and conclusive_accuracy >= minimum_conclusive_accuracy,
        ),
        _gate(
            "minimum_conclusive_coverage",
            test_metrics["conclusive_coverage"],
            f">= {acceptance['minimum_conclusive_coverage']}",
            test_metrics["conclusive_coverage"]
            >= float(acceptance["minimum_conclusive_coverage"]),
        ),
        _gate(
            "maximum_high_confidence_error_rate",
            test_metrics["high_confidence_error_rate"],
            f"<= {acceptance['maximum_high_confidence_error_rate']}",
            test_metrics["high_confidence_error_rate"]
            <= float(acceptance["maximum_high_confidence_error_rate"]),
        ),
    ]
    return {
        "passed": all(gate["passed"] for gate in gates),
        "gates": gates,
    }


def _dataset_spec(resource_type: str):
    if resource_type == "apps":
        return "app", ("app_name", "display_name", "label"), "app_content_model_v1.json"
    return "web", ("domain", "title", "label"), "web_content_model_v1.json"


def _validation_selection_score(metrics: dict, acceptance: dict) -> tuple:
    conclusive_accuracy = metrics["conclusive_accuracy"] or 0.0
    checks = (
        metrics["macro_f1"] >= float(acceptance["minimum_macro_f1"]),
        conclusive_accuracy >= float(acceptance["minimum_conclusive_accuracy"]),
        metrics["conclusive_coverage"]
        >= float(acceptance["minimum_conclusive_coverage"]),
        metrics["high_confidence_error_rate"]
        <= float(acceptance["maximum_high_confidence_error_rate"]),
    )
    return (
        sum(checks),
        metrics["macro_f1"],
        metrics["accuracy"],
        conclusive_accuracy,
        metrics["conclusive_coverage"],
        -metrics["expected_calibration_error"],
    )


def select_hyperparameters(
    resource_type: str,
    train_records: list[dict],
    validation_records: list[dict],
    classes: list[str],
    taxonomy: dict,
    resource_config: dict,
    training_metadata: dict,
) -> tuple[dict, dict, dict]:
    candidates = []
    for minimum_n, maximum_n in resource_config["search_grid"]["ngram_ranges"]:
        for alpha in resource_config["search_grid"]["alphas"]:
            feature_config = {"minimum_n": minimum_n, "maximum_n": maximum_n}
            model = fit_model(
                train_records,
                resource_type,
                classes,
                feature_config,
                alpha=float(alpha),
                confidence_threshold=taxonomy["confidence_threshold"],
                training_metadata=training_metadata,
            )
            temperature, calibration = calibrate_temperature(
                model, validation_records, maximum=12.0
            )
            model["temperature"] = temperature
            metrics = evaluate_model(model, validation_records)
            candidates.append(
                {
                    "model": model,
                    "feature_config": feature_config,
                    "alpha": float(alpha),
                    "calibration": calibration,
                    "metrics": metrics,
                    "score": _validation_selection_score(
                        metrics, resource_config["acceptance"]
                    ),
                }
            )
    selected = max(
        candidates,
        key=lambda item: (
            item["score"],
            -item["feature_config"]["maximum_n"],
            -item["feature_config"]["minimum_n"],
            -item["alpha"],
        ),
    )
    search_report = {
        "selection_dataset": "validation",
        "selection_rule": (
            "maximize passed validation performance gates, then macro_f1, accuracy, "
            "conclusive accuracy, coverage, and calibration"
        ),
        "candidate_count": len(candidates),
        "selected": {
            "feature_config": selected["feature_config"],
            "alpha": selected["alpha"],
            "temperature": selected["model"]["temperature"],
            "validation_metrics": selected["metrics"],
        },
        "candidates": [
            {
                "feature_config": item["feature_config"],
                "alpha": item["alpha"],
                "temperature": item["model"]["temperature"],
                "selection_score": list(item["score"]),
                "validation_metrics": item["metrics"],
            }
            for item in candidates
        ],
    }
    return selected["model"], selected["calibration"], search_report


def train_resource_model(
    resource_type: str,
    dataset_path: Path,
    taxonomy: dict,
    config: dict,
) -> tuple[dict, dict]:
    taxonomy_key, headers, _ = _dataset_spec(resource_type)
    classes = taxonomy["resources"][taxonomy_key]["labels"]
    validation = validate_csv_dataset(resource_type, dataset_path)
    if validation["status"] == "failed":
        messages = "; ".join(issue["message"] for issue in validation["errors"][:5])
        raise ContentTrainingError(f"{resource_type} dataset validation failed: {messages}")
    records = load_records(dataset_path, headers)
    resource_config = config["resources"][resource_type]
    splits, split_metadata = stratified_group_split(
        records,
        resource_type,
        classes,
        ratios=config["_ratio_values"],
        seed=f"{config['random_seed']}:{resource_type}",
    )
    training_metadata = {
        "dataset_sha256": validation["sha256"],
        "taxonomy_version": taxonomy["taxonomy_version"],
        "split_strategy": split_metadata["strategy"],
        "train_key_sha256": split_metadata["counts"]["train"]["key_sha256"],
    }
    model, calibration, hyperparameter_selection = select_hyperparameters(
        resource_type,
        splits["train"],
        splits["validation"],
        classes,
        taxonomy,
        resource_config,
        training_metadata,
    )
    validation_metrics = evaluate_model(model, splits["validation"])
    test_metrics = evaluate_model(model, splits["test"])
    acceptance = evaluate_acceptance(
        records,
        test_metrics,
        classes,
        resource_config["acceptance"],
    )
    limitations = [
        "Evaluation covers identifier text only; display_name/title are intentionally excluded.",
        "A held-out identifier-family split reduces leakage but does not prove cross-source generalization.",
    ]
    if not acceptance["gates"][0]["passed"]:
        limitations.append(
            "At least one class has too few independently labelled samples for deployment."
        )
    model.update(
        {
            "trained_at": _now_iso(),
            "calibration": calibration,
            "hyperparameter_selection": {
                "candidate_count": hyperparameter_selection["candidate_count"],
                "selection_dataset": "validation",
                "selected_feature_config": model["feature_config"],
                "selected_alpha": model["alpha"],
            },
            "held_out_evaluation": {
                "test_key_sha256": split_metadata["counts"]["test"]["key_sha256"],
                "sample_count": test_metrics["sample_count"],
                "accuracy": test_metrics["accuracy"],
                "macro_f1": test_metrics["macro_f1"],
                "conclusive_accuracy": test_metrics["conclusive_accuracy"],
                "conclusive_coverage": test_metrics["conclusive_coverage"],
            },
            "acceptance": acceptance,
            "known_limitations": limitations,
            "deployment_approved": acceptance["passed"],
        }
    )
    validate_model(model)
    report = {
        "resource_type": resource_type,
        "dataset": {
            "path": str(dataset_path.resolve()),
            "sha256": validation["sha256"],
            "record_count": len(records),
            "label_counts": validation["label_counts"],
            "validation_status": validation["status"],
        },
        "split": split_metadata,
        "feature_config": model["feature_config"],
        "alpha": model["alpha"],
        "vocabulary_size": model["training_summary"]["vocabulary_size"],
        "calibration": calibration,
        "hyperparameter_selection": hyperparameter_selection,
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "acceptance": acceptance,
        "known_limitations": limitations,
    }
    return model, report


def _round_metrics(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: _round_metrics(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round_metrics(item) for item in value]
    return value


def train_all(
    *,
    dataset_dir: Path | str = DEFAULT_DATASET_DIR,
    config_path: Path | str = DEFAULT_CONFIG_PATH,
    output_dir: Path | str = DEFAULT_OUTPUT_DIR,
) -> dict:
    dataset_dir = Path(dataset_dir).resolve()
    output_dir = Path(output_dir).resolve()
    config_path = Path(config_path).resolve()
    config = load_training_config(config_path)
    taxonomy = load_taxonomy()
    resources = {}
    output_models = {}
    for resource_type, dataset_name in (("apps", "apps.csv"), ("websites", "websites.csv")):
        model, report = train_resource_model(
            resource_type,
            dataset_dir / dataset_name,
            taxonomy,
            config,
        )
        _, _, output_name = _dataset_spec(resource_type)
        output_path = output_dir / output_name
        _write_json_atomic(output_path, model)
        report["artifact"] = {
            "path": str(output_path),
            "sha256": _sha256(output_path),
            "size_bytes": output_path.stat().st_size,
        }
        resources[resource_type] = report
        output_models[resource_type] = str(output_path)

    overall_approved = all(
        report["acceptance"]["passed"] for report in resources.values()
    )
    combined = _round_metrics(
        {
            "report_version": "1.0.0",
            "generated_at": _now_iso(),
            "taxonomy_version": taxonomy["taxonomy_version"],
            "confidence_threshold": taxonomy["confidence_threshold"],
            "training_config": {
                "path": str(config_path),
                "sha256": _sha256(config_path),
            },
            "status": "approved" if overall_approved else "candidate_rejected",
            "deployment_approved": overall_approved,
            "models": output_models,
            "resources": resources,
        }
    )
    _write_json_atomic(output_dir / "evaluation_report.json", combined)
    return combined


def _render_console(report: dict) -> str:
    lines = [
        f"Content model training: {report['status']}",
        f"Confidence threshold: {report['confidence_threshold']:.2f}",
    ]
    for resource_type, resource in report["resources"].items():
        metrics = resource["test_metrics"]
        lines.append(
            f"- {resource_type}: test={metrics['sample_count']} "
            f"accuracy={metrics['accuracy']:.2%} macro_f1={metrics['macro_f1']:.2%} "
            f"conclusive_accuracy="
            f"{metrics['conclusive_accuracy'] if metrics['conclusive_accuracy'] is not None else 0:.2%} "
            f"coverage={metrics['conclusive_coverage']:.2%} "
            f"gate={'PASS' if resource['acceptance']['passed'] else 'FAIL'}"
        )
        for gate in resource["acceptance"]["gates"]:
            if not gate["passed"]:
                lines.append(
                    f"  FAIL {gate['name']}: actual={gate['actual']} "
                    f"required={gate['requirement']}"
                )
    lines.append(f"Report: {Path(report['models']['apps']).parent / 'evaluation_report.json'}")
    return "\n".join(lines)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Train and evaluate app/domain content classifiers."
    )
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        report = train_all(
            dataset_dir=args.dataset_dir,
            config_path=args.config,
            output_dir=args.output_dir,
        )
    except (ContentTrainingError, DatasetContractError, OSError, ValueError) as error:
        print(f"Content model training failed: {error}", file=sys.stderr)
        return 2
    print(_render_console(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
