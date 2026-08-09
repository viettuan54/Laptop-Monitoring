"""Auditable character n-gram models for app/domain classification.

The artifact is plain JSON rather than pickle so the Agent can validate it
before loading. Training and inference use app_name plus non-sensitive
ProductName/FileDescription for applications, and domain for websites.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter, defaultdict

from content_classification.validate_dataset import normalize_app_name, normalize_domain


MODEL_VERSION = "1.2.0"
MODEL_TYPE = "char_ngram_multinomial_nb"
APP_ENSEMBLE_MODEL_TYPE = "app_metadata_char_ngram_ensemble"
SPLIT_NAMES = ("train", "validation", "test")
COMMON_SECOND_LEVEL_SUFFIXES = {"ac", "co", "com", "edu", "gov", "net", "org"}
TOKEN_RE = re.compile(r"[a-z0-9]+")
ALPHA_NUMERIC_PART_RE = re.compile(r"[a-z]+|[0-9]+")


def stable_digest(value: str, seed: str = "content-model-v1") -> str:
    return hashlib.sha256(f"{seed}\0{value}".encode("utf-8")).hexdigest()


def canonical_key(resource_type: str, value: str) -> str:
    if resource_type == "apps":
        return normalize_app_name(value)
    if resource_type == "websites":
        return normalize_domain(value)
    raise ValueError("resource_type must be apps or websites")


def normalize_app_metadata_value(value: str) -> str:
    """Normalize ProductName/FileDescription without treating it as a file path."""
    candidate = unicodedata.normalize("NFKC", value).strip().casefold()
    if not candidate or len(candidate) > 150:
        raise ValueError("app metadata must contain 1 to 150 characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        raise ValueError("app metadata cannot contain control characters")
    return " ".join(candidate.replace("/", " ").replace("\\", " ").split())


def leakage_group(resource_type: str, key: str) -> str:
    """Return a conservative group used to prevent train/test family leakage."""
    key = canonical_key(resource_type, key)
    if resource_type == "apps":
        return key
    parts = key.split(".")
    if (
        len(parts) >= 3
        and len(parts[-1]) == 2
        and parts[-2] in COMMON_SECOND_LEVEL_SUFFIXES
    ):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _label_targets(total: int, ratios: tuple[float, float, float]) -> dict[str, int]:
    raw = [total * ratio for ratio in ratios]
    counts = [math.floor(value) for value in raw]
    remainder = total - sum(counts)
    order = sorted(
        range(len(raw)),
        key=lambda index: (raw[index] - counts[index], -index),
        reverse=True,
    )
    for index in order[:remainder]:
        counts[index] += 1
    if total >= 3:
        for empty_index in [index for index, count in enumerate(counts) if count == 0]:
            donor = max(range(3), key=lambda index: counts[index])
            if counts[donor] > 1:
                counts[donor] -= 1
                counts[empty_index] += 1
    return dict(zip(SPLIT_NAMES, counts))


def stratified_group_split(
    records: list[dict],
    resource_type: str,
    classes: list[str] | tuple[str, ...],
    *,
    ratios: tuple[float, float, float] = (0.6, 0.2, 0.2),
    seed: str = "content-model-v1",
) -> tuple[dict[str, list[dict]], dict]:
    if len(ratios) != 3 or any(ratio <= 0 for ratio in ratios):
        raise ValueError("split ratios must contain three positive values")
    if not math.isclose(sum(ratios), 1.0, abs_tol=1e-9):
        raise ValueError("split ratios must sum to 1")
    if not records:
        raise ValueError("cannot split an empty dataset")

    key_field = "app_name" if resource_type == "apps" else "domain"
    groups = defaultdict(list)
    totals = Counter()
    for record in records:
        key = canonical_key(resource_type, record[key_field])
        label = record["label"]
        if label not in classes:
            raise ValueError(f"label outside model classes: {label}")
        normalized = dict(record, **{key_field: key})
        groups[leakage_group(resource_type, key)].append(normalized)
        totals[label] += 1

    targets = {
        label: _label_targets(totals[label], ratios) for label in classes
    }
    current = {split: Counter() for split in SPLIT_NAMES}
    splits = {split: [] for split in SPLIT_NAMES}
    group_assignment = {}
    ordered_groups = sorted(
        groups.items(),
        key=lambda item: (-len(item[1]), stable_digest(item[0], seed)),
    )
    total_targets = _label_targets(len(records), ratios)

    for group_key, group_records in ordered_groups:
        group_counts = Counter(record["label"] for record in group_records)
        candidates = []
        for split in SPLIT_NAMES:
            score = 0.0
            for label, addition in group_counts.items():
                target = targets[label][split]
                before = current[split][label] - target
                after = current[split][label] + addition - target
                score += (after * after - before * before) / max(1, target)
            current_total = sum(current[split].values())
            before_total = current_total - total_targets[split]
            after_total = current_total + len(group_records) - total_targets[split]
            score += 0.1 * (
                (after_total * after_total - before_total * before_total)
                / max(1, total_targets[split])
            )
            tie_break = stable_digest(f"{group_key}:{split}", seed)
            candidates.append((score, tie_break, split))
        selected = min(candidates)[2]
        splits[selected].extend(group_records)
        current[selected].update(group_counts)
        group_assignment[group_key] = selected

    for split in SPLIT_NAMES:
        splits[split].sort(key=lambda row: row[key_field])
    seen_groups = {}
    for split, split_records in splits.items():
        for record in split_records:
            group = leakage_group(resource_type, record[key_field])
            previous = seen_groups.setdefault(group, split)
            if previous != split:
                raise AssertionError("a leakage group was assigned to multiple splits")

    metadata = {
        "strategy": "deterministic_stratified_identifier_group_v1",
        "seed": seed,
        "ratios": dict(zip(SPLIT_NAMES, ratios)),
        "group_count": len(groups),
        "largest_group_size": max(len(group) for group in groups.values()),
        "counts": {
            split: {
                "total": len(splits[split]),
                "labels": dict(
                    sorted(Counter(row["label"] for row in splits[split]).items())
                ),
                "key_sha256": hashlib.sha256(
                    "\n".join(row[key_field] for row in splits[split]).encode("utf-8")
                ).hexdigest(),
            }
            for split in SPLIT_NAMES
        },
    }
    return splits, metadata


def extract_features(resource_type: str, key: str, config: dict) -> Counter:
    key = canonical_key(resource_type, key)
    minimum_n = int(config["minimum_n"])
    maximum_n = int(config["maximum_n"])
    if not 1 <= minimum_n <= maximum_n <= 8:
        raise ValueError("invalid n-gram range")
    wrapped = f"^{key}$"
    features = Counter()
    for size in range(minimum_n, maximum_n + 1):
        for index in range(len(wrapped) - size + 1):
            features[f"c{size}:{wrapped[index:index + size]}"] += 1

    tokens = TOKEN_RE.findall(key)
    for token in tokens:
        if len(token) >= 2:
            features[f"token:{token}"] += 1
        for part in ALPHA_NUMERIC_PART_RE.findall(token):
            if len(part) >= 2:
                features[f"part:{part}"] += 1
    features[f"length:{min(12, len(key) // 5)}"] = 1
    digit_count = sum(character.isdigit() for character in key)
    alpha_count = sum(character.isalpha() for character in key)
    features[f"digits:{min(5, digit_count // 2)}"] = 1
    digit_ratio_bucket = min(
        5, round(5 * digit_count / max(1, digit_count + alpha_count))
    )
    features[f"digit-ratio:{digit_ratio_bucket}"] = 1
    features[f"hyphens:{min(5, key.count('-'))}"] = 1
    features[f"token-count:{min(8, len(tokens))}"] = 1

    if resource_type == "websites":
        labels = key.split(".")
        features[f"tld:{labels[-1]}"] = 1
        features[f"depth:{min(6, len(labels))}"] = 1
        primary_label = labels[-2] if len(labels) >= 2 else labels[0]
        features[f"primary-length:{min(12, len(primary_label) // 3)}"] = 1
        features[f"primary-hyphens:{min(5, primary_label.count('-'))}"] = 1
        if len(labels) >= 2:
            features[f"suffix:{'.'.join(labels[-2:])}"] = 1
    else:
        extension = key.rsplit(".", 1)[-1] if "." in key else "none"
        features[f"extension:{extension}"] = 1
        stem = key.rsplit(".", 1)[0]
        features[f"stem-length:{min(12, len(stem) // 3)}"] = 1
        for part in ALPHA_NUMERIC_PART_RE.findall(stem):
            if len(part) >= 2:
                features[f"stem-part:{part}"] += 1
    return features


def fit_model(
    records: list[dict],
    resource_type: str,
    classes: list[str] | tuple[str, ...],
    feature_config: dict,
    *,
    alpha: float = 1.0,
    confidence_threshold: float = 0.7,
    temperature: float = 1.0,
    training_metadata: dict | None = None,
) -> dict:
    if alpha <= 0:
        raise ValueError("alpha must be positive")
    if not records:
        raise ValueError("training records cannot be empty")
    classes = list(classes)
    key_field = "app_name" if resource_type == "apps" else "domain"
    feature_counts = {label: Counter() for label in classes}
    class_documents = Counter()
    vocabulary = set()
    for record in records:
        label = record["label"]
        if label not in feature_counts:
            raise ValueError(f"label outside model classes: {label}")
        features = extract_features(resource_type, record[key_field], feature_config)
        feature_counts[label].update(features)
        vocabulary.update(features)
        class_documents[label] += 1
    missing = [label for label in classes if class_documents[label] == 0]
    if missing:
        raise ValueError(f"training split is missing classes: {', '.join(missing)}")

    vocabulary_size = len(vocabulary)
    default_log_likelihood = {}
    transposed = defaultdict(dict)
    for label in classes:
        denominator = sum(feature_counts[label].values()) + alpha * vocabulary_size
        default_log_likelihood[label] = math.log(alpha / denominator)
        for feature, count in feature_counts[label].items():
            transposed[feature][label] = math.log((count + alpha) / denominator)

    model = {
        "model_version": MODEL_VERSION,
        "model_type": MODEL_TYPE,
        "resource_type": resource_type,
        "classes": classes,
        "key_field": key_field,
        "confidence_threshold": float(confidence_threshold),
        "temperature": float(temperature),
        "alpha": float(alpha),
        "class_prior": "uniform",
        "class_log_prior": {label: math.log(1.0 / len(classes)) for label in classes},
        "default_log_likelihood": default_log_likelihood,
        "feature_log_likelihood": dict(sorted(transposed.items())),
        "feature_config": dict(feature_config),
        "training_summary": {
            "record_count": len(records),
            "class_counts": dict(sorted(class_documents.items())),
            "vocabulary_size": vocabulary_size,
            **(training_metadata or {}),
        },
        "deployment_approved": False,
    }
    return validate_model(model)


def fit_app_ensemble_model(
    name_model: dict,
    metadata_model: dict,
    *,
    app_name_weight: float,
    ensemble_temperature: float,
    training_metadata: dict | None = None,
) -> dict:
    """Combine independently trained process-name and product-metadata models."""
    validate_model(name_model)
    validate_model(metadata_model)
    if name_model["resource_type"] != "apps" or metadata_model["resource_type"] != "apps":
        raise ValueError("app ensemble branches must both classify apps")
    if name_model["classes"] != metadata_model["classes"]:
        raise ValueError("app ensemble branches must use identical classes")
    if not 0.0 <= app_name_weight <= 1.0:
        raise ValueError("app_name_weight must be between zero and one")
    if not math.isfinite(ensemble_temperature) or ensemble_temperature <= 0:
        raise ValueError("ensemble_temperature must be positive")
    model = {
        "model_version": MODEL_VERSION,
        "model_type": APP_ENSEMBLE_MODEL_TYPE,
        "resource_type": "apps",
        "classes": list(name_model["classes"]),
        "key_field": "app_name",
        "metadata_field": "display_name",
        "runtime_metadata_fields": ["product_name", "file_description"],
        "confidence_threshold": float(name_model["confidence_threshold"]),
        "app_name_weight": float(app_name_weight),
        "ensemble_temperature": float(ensemble_temperature),
        "name_model": name_model,
        "metadata_model": metadata_model,
        "training_summary": dict(training_metadata or {}),
        "deployment_approved": False,
    }
    return validate_model(model)


def _softmax(logits: dict[str, float], temperature: float) -> dict[str, float]:
    if not math.isfinite(temperature) or temperature <= 0:
        raise ValueError("temperature must be positive")
    scaled = {label: value / temperature for label, value in logits.items()}
    maximum = max(scaled.values())
    exponentials = {label: math.exp(value - maximum) for label, value in scaled.items()}
    denominator = sum(exponentials.values())
    return {label: value / denominator for label, value in exponentials.items()}


def predict_logits(model: dict, value: str) -> dict[str, float]:
    features = extract_features(model["resource_type"], value, model["feature_config"])
    logits = dict(model["class_log_prior"])
    likelihoods = model["feature_log_likelihood"]
    defaults = model["default_log_likelihood"]
    for feature, count in features.items():
        observed = likelihoods.get(feature)
        if observed is None:
            continue
        for label in model["classes"]:
            logits[label] += count * observed.get(label, defaults[label])
    return logits


def _power_calibrate(probabilities: dict[str, float], temperature: float) -> dict[str, float]:
    powered = {
        label: max(probability, 1e-15) ** (1.0 / temperature)
        for label, probability in probabilities.items()
    }
    denominator = sum(powered.values())
    return {label: probability / denominator for label, probability in powered.items()}


def predict_model(model: dict, value: str, metadata_value: str | None = None) -> dict:
    if model.get("model_type") == APP_ENSEMBLE_MODEL_TYPE:
        name_result = predict_model(model["name_model"], value)
        if not isinstance(metadata_value, str) or not metadata_value.strip():
            return {
                **name_result,
                "conclusive": False,
                "metadata_available": False,
            }
        metadata_result = predict_model(
            model["metadata_model"], normalize_app_metadata_value(metadata_value)
        )
        weight = model["app_name_weight"]
        mixed = {
            label: (
                weight * name_result["probabilities"][label]
                + (1.0 - weight) * metadata_result["probabilities"][label]
            )
            for label in model["classes"]
        }
        probabilities = _power_calibrate(mixed, model["ensemble_temperature"])
        predicted = max(model["classes"], key=lambda label: probabilities[label])
        confidence = probabilities[predicted]
        return {
            "label": predicted,
            "confidence": confidence,
            "conclusive": confidence >= model["confidence_threshold"],
            "probabilities": probabilities,
            "metadata_available": True,
        }
    probabilities = _softmax(predict_logits(model, value), model["temperature"])
    predicted = max(model["classes"], key=lambda label: probabilities[label])
    confidence = probabilities[predicted]
    return {
        "label": predicted,
        "confidence": confidence,
        "conclusive": confidence >= model["confidence_threshold"],
        "probabilities": probabilities,
    }


def calibrate_temperature(
    model: dict,
    records: list[dict],
    *,
    minimum: float = 0.5,
    maximum: float = 8.0,
    step: float = 0.05,
) -> tuple[float, dict]:
    if not records:
        raise ValueError("validation records cannot be empty")
    key_field = model["key_field"]
    logits = [(record["label"], predict_logits(model, record[key_field])) for record in records]
    candidates = []
    count = int(round((maximum - minimum) / step))
    for index in range(count + 1):
        temperature = round(minimum + index * step, 10)
        loss = 0.0
        for actual, item_logits in logits:
            probability = _softmax(item_logits, temperature)[actual]
            loss -= math.log(max(probability, 1e-15))
        candidates.append((loss / len(logits), temperature))
    validation_nll, temperature = min(candidates)
    baseline_nll = next(loss for loss, value in candidates if value == 1.0)
    return temperature, {
        "method": "validation_grid_search_negative_log_likelihood",
        "temperature": temperature,
        "validation_nll": validation_nll,
        "uncalibrated_validation_nll": baseline_nll,
        "sample_count": len(records),
        "search": {"minimum": minimum, "maximum": maximum, "step": step},
    }


def evaluate_model(model: dict, records: list[dict]) -> dict:
    if not records:
        raise ValueError("evaluation records cannot be empty")
    classes = model["classes"]
    key_field = model["key_field"]
    confusion = {actual: {predicted: 0 for predicted in classes} for actual in classes}
    supports = Counter()
    predicted_counts = Counter()
    true_positive = Counter()
    conclusive_by_class = Counter()
    conclusive_correct_by_class = Counter()
    correct = 0
    conclusive = 0
    conclusive_correct = 0
    brier_sum = 0.0
    calibration_bins = [dict(count=0, confidence=0.0, correct=0) for _ in range(10)]
    for record in records:
        actual = record["label"]
        metadata_value = record.get("display_name") if model["resource_type"] == "apps" else None
        result = predict_model(model, record[key_field], metadata_value)
        predicted = result["label"]
        confidence = result["confidence"]
        supports[actual] += 1
        predicted_counts[predicted] += 1
        confusion[actual][predicted] += 1
        is_correct = predicted == actual
        if is_correct:
            correct += 1
            true_positive[actual] += 1
        if result["conclusive"]:
            conclusive += 1
            conclusive_by_class[actual] += 1
            if is_correct:
                conclusive_correct += 1
                conclusive_correct_by_class[actual] += 1
        brier_sum += sum(
            (result["probabilities"][label] - (1.0 if label == actual else 0.0)) ** 2
            for label in classes
        )
        bin_index = min(9, int(confidence * 10))
        calibration_bins[bin_index]["count"] += 1
        calibration_bins[bin_index]["confidence"] += confidence
        calibration_bins[bin_index]["correct"] += int(is_correct)

    per_class = {}
    for label in classes:
        precision = true_positive[label] / predicted_counts[label] if predicted_counts[label] else 0.0
        recall = true_positive[label] / supports[label] if supports[label] else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        class_conclusive = conclusive_by_class[label]
        per_class[label] = {
            "support": supports[label],
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "conclusive_coverage": class_conclusive / supports[label] if supports[label] else 0.0,
            "conclusive_accuracy": (
                conclusive_correct_by_class[label] / class_conclusive
                if class_conclusive
                else None
            ),
        }

    ece = 0.0
    rendered_bins = []
    for index, item in enumerate(calibration_bins):
        if not item["count"]:
            continue
        average_confidence = item["confidence"] / item["count"]
        accuracy = item["correct"] / item["count"]
        ece += item["count"] / len(records) * abs(accuracy - average_confidence)
        rendered_bins.append(
            {
                "range": [index / 10, (index + 1) / 10],
                "count": item["count"],
                "average_confidence": average_confidence,
                "accuracy": accuracy,
            }
        )
    macro_f1 = sum(item["f1"] for item in per_class.values()) / len(classes)
    return {
        "sample_count": len(records),
        "accuracy": correct / len(records),
        "macro_f1": macro_f1,
        "conclusive_coverage": conclusive / len(records),
        "fallback_rate": 1.0 - conclusive / len(records),
        "conclusive_accuracy": conclusive_correct / conclusive if conclusive else None,
        "high_confidence_error_rate": (conclusive - conclusive_correct) / len(records),
        "brier_score": brier_sum / len(records),
        "expected_calibration_error": ece,
        "per_class": per_class,
        "confusion_matrix": confusion,
        "calibration_bins": rendered_bins,
    }


def validate_model(model: dict) -> dict:
    if not isinstance(model, dict):
        raise ValueError("content model must be an object")
    if model.get("model_version") != MODEL_VERSION:
        raise ValueError("unsupported content model version")
    model_type = model.get("model_type")
    if model_type not in {MODEL_TYPE, APP_ENSEMBLE_MODEL_TYPE}:
        raise ValueError("unsupported content model type")
    if model.get("resource_type") not in {"apps", "websites"}:
        raise ValueError("invalid content model resource_type")
    classes = model.get("classes")
    if not isinstance(classes, list) or len(classes) < 2 or len(classes) != len(set(classes)):
        raise ValueError("content model classes are invalid")
    expected_key = "app_name" if model["resource_type"] == "apps" else "domain"
    if model.get("key_field") != expected_key:
        raise ValueError("content model key_field is incompatible")
    threshold = model.get("confidence_threshold")
    if not isinstance(threshold, (int, float)) or threshold != 0.7:
        raise ValueError("content model confidence_threshold must be 0.7")
    if model_type == APP_ENSEMBLE_MODEL_TYPE:
        if model["resource_type"] != "apps":
            raise ValueError("metadata ensemble is only supported for apps")
        if model.get("metadata_field") != "display_name":
            raise ValueError("app ensemble metadata_field is incompatible")
        runtime_fields = model.get("runtime_metadata_fields")
        if runtime_fields != ["product_name", "file_description"]:
            raise ValueError("app ensemble runtime_metadata_fields are invalid")
        weight = model.get("app_name_weight")
        temperature = model.get("ensemble_temperature")
        if not isinstance(weight, (int, float)) or not 0 <= weight <= 1:
            raise ValueError("app ensemble weight is invalid")
        if not isinstance(temperature, (int, float)) or not math.isfinite(temperature) or temperature <= 0:
            raise ValueError("app ensemble temperature is invalid")
        for branch_name in ("name_model", "metadata_model"):
            branch = model.get(branch_name)
            validate_model(branch)
            if branch["resource_type"] != "apps" or branch["classes"] != classes:
                raise ValueError("app ensemble branch is incompatible")
        if not isinstance(model.get("deployment_approved"), bool):
            raise ValueError("content model deployment_approved must be boolean")
        return model

    for field in ("alpha", "temperature"):
        value = model.get(field)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"content model {field} is invalid")
    for field in ("class_log_prior", "default_log_likelihood"):
        values = model.get(field)
        if not isinstance(values, dict) or set(values) != set(classes):
            raise ValueError(f"content model {field} is incomplete")
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in values.values()):
            raise ValueError(f"content model {field} contains invalid values")
    likelihoods = model.get("feature_log_likelihood")
    if not isinstance(likelihoods, dict) or not likelihoods:
        raise ValueError("content model feature likelihoods are empty")
    for feature, values in likelihoods.items():
        if not isinstance(feature, str) or not isinstance(values, dict):
            raise ValueError("content model feature likelihood is malformed")
        if not set(values).issubset(classes) or any(
            not isinstance(value, (int, float)) or not math.isfinite(value)
            for value in values.values()
        ):
            raise ValueError("content model feature likelihood contains invalid values")
    if not isinstance(model.get("deployment_approved"), bool):
        raise ValueError("content model deployment_approved must be boolean")
    return model
