"""Auditable local inference for packaged app and website content models."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import unicodedata
from collections import Counter
from typing import Optional

from runtime_paths import agent_root


WEB_LABELS = ("education", "entertainment", "social", "unsafe", "unknown")
APP_LABELS = ("learning", "entertainment", "browsers", "unknown")
MODEL_VERSION = "1.2.0"
MODEL_TYPE = "char_ngram_multinomial_nb"
APP_ENSEMBLE_MODEL_TYPE = "app_metadata_char_ngram_ensemble"
LOOKUP_VERSION = "1.0.0"
TOKEN_RE = re.compile(r"[a-z0-9]+")
ALPHA_NUMERIC_PART_RE = re.compile(r"[a-z]+|[0-9]+")
DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


class ContentModelError(RuntimeError):
    """Raised when a packaged content model is missing or invalid."""


def normalize_app_name(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("app_name must be text")
    candidate = unicodedata.normalize("NFKC", value).strip().casefold()
    if not candidate or len(candidate) > 150:
        raise ValueError("app_name must contain 1 to 150 characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        raise ValueError("app_name contains control characters")
    if "/" in candidate or "\\" in candidate:
        raise ValueError("app_name must be a file name, not a path")
    return candidate


def normalize_app_metadata(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("app metadata must be text")
    candidate = unicodedata.normalize("NFKC", value).strip().casefold()
    if not candidate:
        return None
    if len(candidate) > 150:
        raise ValueError("app metadata cannot exceed 150 characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        raise ValueError("app metadata contains control characters")
    if "\\" in candidate or re.search(r"(?:^|[^\s])/|/(?:$|[^\s])", candidate):
        raise ValueError("app metadata must not contain a path")
    return " ".join(candidate.replace("/", " ").split())


def normalize_domain(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("domain must be text")
    candidate = value.strip().casefold()
    if not candidate or any(ord(character) <= 32 or ord(character) == 127 for character in candidate):
        raise ValueError("domain is empty or contains control characters")
    if "://" in candidate or any(marker in candidate for marker in "/?#@\\"):
        raise ValueError("domain must not contain URL components")
    candidate = candidate[:-1] if candidate.endswith(".") else candidate
    if candidate.startswith("www."):
        candidate = candidate[4:]
    try:
        ascii_domain = candidate.encode("idna").decode("ascii")
    except (UnicodeError, ValueError) as error:
        raise ValueError("domain is not valid IDNA") from error
    labels = ascii_domain.split(".")
    if (
        len(ascii_domain) > 253
        or len(labels) < 2
        or any(not DOMAIN_LABEL_RE.fullmatch(label) for label in labels)
    ):
        raise ValueError("domain is invalid")
    return ascii_domain


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_verified_json(path: str) -> dict:
    checksum_path = path + ".sha256"
    if not os.path.isfile(path) or not os.path.isfile(checksum_path):
        raise ContentModelError(f"Missing model or checksum: {os.path.basename(path)}")
    with open(checksum_path, "r", encoding="ascii") as stream:
        expected = stream.read().strip().split()[0].casefold()
    actual = _sha256(path)
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or actual != expected:
        raise ContentModelError(f"Checksum mismatch: {os.path.basename(path)}")
    try:
        with open(path, "r", encoding="utf-8") as stream:
            payload = json.load(stream)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContentModelError(f"Invalid model JSON: {os.path.basename(path)}") from error
    return payload


def _validate_base_model(model: dict, resource_type: str, labels: tuple[str, ...]) -> dict:
    if model.get("model_version") != MODEL_VERSION or model.get("model_type") != MODEL_TYPE:
        raise ContentModelError("Unsupported content model contract")
    if model.get("resource_type") != resource_type or model.get("classes") != list(labels):
        raise ContentModelError("Content model taxonomy is incompatible")
    expected_key = "app_name" if resource_type == "apps" else "domain"
    if model.get("key_field") != expected_key or model.get("confidence_threshold") != 0.7:
        raise ContentModelError("Content model identifier contract is incompatible")
    feature_config = model.get("feature_config") or {}
    minimum_n = feature_config.get("minimum_n")
    maximum_n = feature_config.get("maximum_n")
    if not isinstance(minimum_n, int) or not isinstance(maximum_n, int):
        raise ContentModelError("Web model feature configuration is invalid")
    for field in ("class_log_prior", "default_log_likelihood", "feature_log_likelihood"):
        if not isinstance(model.get(field), dict) or not model[field]:
            raise ContentModelError(f"Web model field is invalid: {field}")
    temperature = model.get("temperature")
    if not isinstance(temperature, (int, float)) or temperature <= 0:
        raise ContentModelError("Content model temperature is invalid")
    return model


def _validate_web_model(model: dict) -> dict:
    model = _validate_base_model(model, "websites", WEB_LABELS)
    if model.get("deployment_approved") is not True:
        raise ContentModelError("Web model did not pass its deployment gate")
    return model


def _validate_app_model(model: dict) -> dict:
    if (
        model.get("model_version") != MODEL_VERSION
        or model.get("model_type") != APP_ENSEMBLE_MODEL_TYPE
        or model.get("resource_type") != "apps"
        or model.get("classes") != list(APP_LABELS)
        or model.get("key_field") != "app_name"
        or model.get("metadata_field") != "display_name"
        or model.get("runtime_metadata_fields") != ["product_name", "file_description"]
        or model.get("confidence_threshold") != 0.7
        or model.get("deployment_approved") is not True
    ):
        raise ContentModelError("Packaged app model is incompatible or unapproved")
    weight = model.get("app_name_weight")
    temperature = model.get("ensemble_temperature")
    if not isinstance(weight, (int, float)) or not 0 <= weight <= 1:
        raise ContentModelError("App ensemble weight is invalid")
    if not isinstance(temperature, (int, float)) or temperature <= 0:
        raise ContentModelError("App ensemble temperature is invalid")
    _validate_base_model(model.get("name_model") or {}, "apps", APP_LABELS)
    _validate_base_model(model.get("metadata_model") or {}, "apps", APP_LABELS)
    return model


def _validate_app_lookup(lookup: dict) -> dict:
    if (
        lookup.get("lookup_version") != LOOKUP_VERSION
        or lookup.get("resource_type") != "apps"
        or lookup.get("key_field") != "app_name"
        or lookup.get("classes") != list(APP_LABELS)
    ):
        raise ContentModelError("Packaged app exact lookup is incompatible")
    labels = lookup.get("labels")
    if not isinstance(labels, dict) or not labels or lookup.get("record_count") != len(labels):
        raise ContentModelError("Packaged app exact lookup is empty or inconsistent")
    if any(
        not isinstance(key, str)
        or normalize_app_name(key) != key
        or label not in APP_LABELS
        for key, label in labels.items()
    ):
        raise ContentModelError("Packaged app exact lookup contains invalid entries")
    return lookup


def _validate_web_lookup(lookup: dict) -> dict:
    if (
        lookup.get("lookup_version") != LOOKUP_VERSION
        or lookup.get("resource_type") != "websites"
        or lookup.get("key_field") != "domain"
        or lookup.get("classes") != list(WEB_LABELS)
    ):
        raise ContentModelError("Packaged web exact lookup is incompatible")
    labels = lookup.get("labels")
    if not isinstance(labels, dict) or not labels or lookup.get("record_count") != len(labels):
        raise ContentModelError("Packaged web exact lookup is empty or inconsistent")
    if any(
        not isinstance(key, str)
        or normalize_domain(key) != key
        or label not in WEB_LABELS
        for key, label in labels.items()
    ):
        raise ContentModelError("Packaged web exact lookup contains invalid entries")
    return lookup


def _extract_features(value: str, config: dict, resource_type: str) -> Counter:
    minimum_n = int(config["minimum_n"])
    maximum_n = int(config["maximum_n"])
    wrapped = f"^{value}$"
    features = Counter()
    for size in range(minimum_n, maximum_n + 1):
        for index in range(len(wrapped) - size + 1):
            features[f"c{size}:{wrapped[index:index + size]}"] += 1
    tokens = TOKEN_RE.findall(value)
    for token in tokens:
        if len(token) >= 2:
            features[f"token:{token}"] += 1
        for part in ALPHA_NUMERIC_PART_RE.findall(token):
            if len(part) >= 2:
                features[f"part:{part}"] += 1
    features[f"length:{min(12, len(value) // 5)}"] = 1
    digit_count = sum(character.isdigit() for character in value)
    alpha_count = sum(character.isalpha() for character in value)
    features[f"digits:{min(5, digit_count // 2)}"] = 1
    ratio_bucket = min(5, round(5 * digit_count / max(1, digit_count + alpha_count)))
    features[f"digit-ratio:{ratio_bucket}"] = 1
    features[f"hyphens:{min(5, value.count('-'))}"] = 1
    features[f"token-count:{min(8, len(tokens))}"] = 1
    if resource_type == "websites":
        labels = value.split(".")
        features[f"tld:{labels[-1]}"] = 1
        features[f"depth:{min(6, len(labels))}"] = 1
        primary_label = labels[-2]
        features[f"primary-length:{min(12, len(primary_label) // 3)}"] = 1
        features[f"primary-hyphens:{min(5, primary_label.count('-'))}"] = 1
        features[f"suffix:{'.'.join(labels[-2:])}"] = 1
    else:
        extension = value.rsplit(".", 1)[-1] if "." in value else "none"
        features[f"extension:{extension}"] = 1
        stem = value.rsplit(".", 1)[0]
        features[f"stem-length:{min(12, len(stem) // 3)}"] = 1
        for part in ALPHA_NUMERIC_PART_RE.findall(stem):
            if len(part) >= 2:
                features[f"stem-part:{part}"] += 1
    return features


def _predict_probabilities(model: dict, value: str, labels: tuple[str, ...]) -> dict:
    logits = dict(model["class_log_prior"])
    defaults = model["default_log_likelihood"]
    likelihoods = model["feature_log_likelihood"]
    for feature, count in _extract_features(
        value, model["feature_config"], model["resource_type"]
    ).items():
        observed = likelihoods.get(feature)
        if observed is None:
            continue
        for label in labels:
            logits[label] += count * observed.get(label, defaults[label])
    temperature = float(model["temperature"])
    scaled = {label: value / temperature for label, value in logits.items()}
    maximum = max(scaled.values())
    exponentials = {label: math.exp(value - maximum) for label, value in scaled.items()}
    denominator = sum(exponentials.values())
    probabilities = {label: value / denominator for label, value in exponentials.items()}
    return probabilities


def predict_web_model(model: dict, domain: str) -> dict:
    domain = normalize_domain(domain)
    probabilities = _predict_probabilities(model, domain, WEB_LABELS)
    label = max(WEB_LABELS, key=lambda item: probabilities[item])
    confidence = probabilities[label]
    return {
        "domain": domain,
        "candidate_label": label,
        "label": label if confidence >= model["confidence_threshold"] else None,
        "confidence": confidence,
        "requires_gemini": confidence < model["confidence_threshold"],
        "decision_source": (
            "trained_model"
            if confidence >= model["confidence_threshold"]
            else "gemini_required"
        ),
        "probabilities": probabilities,
    }


def predict_app_model(
    model: dict,
    app_name: str,
    product_name: str | None = None,
    file_description: str | None = None,
) -> dict:
    app_name = normalize_app_name(app_name)
    metadata = normalize_app_metadata(product_name) or normalize_app_metadata(file_description)
    name_probabilities = _predict_probabilities(model["name_model"], app_name, APP_LABELS)
    if metadata is None:
        candidate = max(APP_LABELS, key=lambda item: name_probabilities[item])
        return {
            "app_name": app_name,
            "candidate_label": candidate,
            "label": None,
            "confidence": name_probabilities[candidate],
            "requires_gemini": True,
            "decision_source": "gemini_required",
            "reason": "runtime_metadata_missing",
            "probabilities": name_probabilities,
        }
    metadata_probabilities = _predict_probabilities(
        model["metadata_model"], metadata, APP_LABELS
    )
    weight = float(model["app_name_weight"])
    mixed = {
        label: weight * name_probabilities[label]
        + (1.0 - weight) * metadata_probabilities[label]
        for label in APP_LABELS
    }
    temperature = float(model["ensemble_temperature"])
    powered = {
        label: max(probability, 1e-15) ** (1.0 / temperature)
        for label, probability in mixed.items()
    }
    denominator = sum(powered.values())
    probabilities = {label: value / denominator for label, value in powered.items()}
    candidate = max(APP_LABELS, key=lambda item: probabilities[item])
    confidence = probabilities[candidate]
    conclusive = model["deployment_approved"] and confidence >= model["confidence_threshold"]
    return {
        "app_name": app_name,
        "candidate_label": candidate,
        "label": candidate if conclusive else None,
        "confidence": confidence,
        "requires_gemini": not conclusive,
        "decision_source": "trained_model" if conclusive else "gemini_required",
        "reason": (
            "model_confidence_at_or_above_threshold"
            if conclusive
            else "model_confidence_below_threshold"
        ),
        "probabilities": probabilities,
    }


class ContentClassifier:
    """Load approved app/web assets once and cache final decisions."""

    def __init__(self, models_dir: Optional[str] = None):
        models_dir = models_dir or os.path.join(agent_root(), "models")
        self.web_model = _validate_web_model(_load_verified_json(
            os.path.join(models_dir, "web_content_model_v1.json")
        ))
        self.app_model = _validate_app_model(_load_verified_json(
            os.path.join(models_dir, "app_content_model_v1.json")
        ))
        self.app_lookup = _validate_app_lookup(_load_verified_json(
            os.path.join(models_dir, "app_exact_lookup_v1.json")
        ))
        self.web_lookup = _validate_web_lookup(_load_verified_json(
            os.path.join(models_dir, "web_exact_lookup_v1.json")
        ))
        self._web_cache = {}
        self._app_cache = {}
        self._lock = threading.Lock()

    def classify_web(self, domain: str) -> dict:
        domain = normalize_domain(domain)
        with self._lock:
            cached = self._web_cache.get(domain)
        if cached is not None:
            return dict(cached)
        exact_label = self.web_lookup["labels"].get(domain)
        if exact_label is not None:
            result = {
                "domain": domain,
                "candidate_label": exact_label,
                "label": exact_label,
                "confidence": 1.0,
                "requires_gemini": False,
                "decision_source": "exact_lookup",
                "reason": "reviewed_identifier_match",
                "probabilities": {},
            }
        else:
            result = predict_web_model(self.web_model, domain)
        if result["label"] is not None:
            with self._lock:
                self._web_cache[domain] = dict(result)
        return result

    def classify_app(
        self,
        app_name: str,
        product_name: str | None = None,
        file_description: str | None = None,
    ) -> dict:
        app_name = normalize_app_name(app_name)
        with self._lock:
            cached = self._app_cache.get(app_name)
        if cached is not None:
            return dict(cached)
        exact_label = self.app_lookup["labels"].get(app_name)
        if exact_label is not None:
            result = {
                "app_name": app_name,
                "candidate_label": exact_label,
                "label": exact_label,
                "confidence": 1.0,
                "requires_gemini": False,
                "decision_source": "exact_lookup",
                "reason": "reviewed_identifier_match",
                "probabilities": {},
            }
        else:
            result = predict_app_model(
                self.app_model,
                app_name,
                product_name=product_name,
                file_description=file_description,
            )
        if result["label"] is not None:
            with self._lock:
                self._app_cache[app_name] = dict(result)
        return result

    def remember_app_label(self, app_name: str, label: str, source: str = "gemini") -> dict:
        app_name = normalize_app_name(app_name)
        if label not in APP_LABELS:
            raise ValueError("app label is outside taxonomy")
        result = {
            "app_name": app_name,
            "candidate_label": label,
            "label": label,
            "confidence": 1.0,
            "requires_gemini": False,
            "decision_source": source,
            "reason": "remote_fallback",
            "probabilities": {},
        }
        with self._lock:
            self._app_cache[app_name] = dict(result)
        return result

    def remember_web_label(self, domain: str, label: str, source: str = "gemini") -> dict:
        domain = normalize_domain(domain)
        if label not in WEB_LABELS:
            raise ValueError("web label is outside taxonomy")
        result = {
            "domain": domain,
            "candidate_label": label,
            "label": label,
            "confidence": 1.0,
            "requires_gemini": False,
            "decision_source": source,
            "probabilities": {},
        }
        with self._lock:
            self._web_cache[domain] = dict(result)
        return result


def verify_packaged_content_assets(models_dir=None):
    """Verify checksums and minimum contracts for every shipped content asset."""
    models_dir = models_dir or os.path.join(agent_root(), "models")
    web_model = _validate_web_model(
        _load_verified_json(os.path.join(models_dir, "web_content_model_v1.json"))
    )
    app_model = _validate_app_model(_load_verified_json(
        os.path.join(models_dir, "app_content_model_v1.json")
    ))
    app_lookup = _validate_app_lookup(_load_verified_json(
        os.path.join(models_dir, "app_exact_lookup_v1.json")
    ))
    web_lookup = _validate_web_lookup(_load_verified_json(
        os.path.join(models_dir, "web_exact_lookup_v1.json")
    ))
    return {
        "web_model_version": web_model["model_version"],
        "app_model_version": app_model["model_version"],
        "app_lookup_version": app_lookup["lookup_version"],
        "web_lookup_version": web_lookup["lookup_version"],
    }
