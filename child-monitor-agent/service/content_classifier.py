"""Auditable local inference for packaged app and website content models."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
from collections import Counter
from typing import Optional

from runtime_paths import agent_root


WEB_LABELS = ("education", "entertainment", "social", "unsafe", "unknown")
MODEL_VERSION = "1.2.0"
MODEL_TYPE = "char_ngram_multinomial_nb"
TOKEN_RE = re.compile(r"[a-z0-9]+")
ALPHA_NUMERIC_PART_RE = re.compile(r"[a-z]+|[0-9]+")
DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


class ContentModelError(RuntimeError):
    """Raised when a packaged content model is missing or invalid."""


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


def _validate_web_model(model: dict) -> dict:
    if model.get("model_version") != MODEL_VERSION:
        raise ContentModelError("Unsupported web model version")
    if model.get("model_type") != MODEL_TYPE or model.get("resource_type") != "websites":
        raise ContentModelError("Packaged model is not a website classifier")
    if model.get("key_field") != "domain" or model.get("classes") != list(WEB_LABELS):
        raise ContentModelError("Web model taxonomy is incompatible")
    if model.get("confidence_threshold") != 0.7:
        raise ContentModelError("Web model confidence threshold must be 0.7")
    if model.get("deployment_approved") is not True:
        raise ContentModelError("Web model did not pass its deployment gate")
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
        raise ContentModelError("Web model temperature is invalid")
    return model


def _extract_features(domain: str, config: dict) -> Counter:
    minimum_n = int(config["minimum_n"])
    maximum_n = int(config["maximum_n"])
    wrapped = f"^{domain}$"
    features = Counter()
    for size in range(minimum_n, maximum_n + 1):
        for index in range(len(wrapped) - size + 1):
            features[f"c{size}:{wrapped[index:index + size]}"] += 1
    tokens = TOKEN_RE.findall(domain)
    for token in tokens:
        if len(token) >= 2:
            features[f"token:{token}"] += 1
        for part in ALPHA_NUMERIC_PART_RE.findall(token):
            if len(part) >= 2:
                features[f"part:{part}"] += 1
    features[f"length:{min(12, len(domain) // 5)}"] = 1
    digit_count = sum(character.isdigit() for character in domain)
    alpha_count = sum(character.isalpha() for character in domain)
    features[f"digits:{min(5, digit_count // 2)}"] = 1
    ratio_bucket = min(5, round(5 * digit_count / max(1, digit_count + alpha_count)))
    features[f"digit-ratio:{ratio_bucket}"] = 1
    features[f"hyphens:{min(5, domain.count('-'))}"] = 1
    features[f"token-count:{min(8, len(tokens))}"] = 1
    labels = domain.split(".")
    features[f"tld:{labels[-1]}"] = 1
    features[f"depth:{min(6, len(labels))}"] = 1
    primary_label = labels[-2]
    features[f"primary-length:{min(12, len(primary_label) // 3)}"] = 1
    features[f"primary-hyphens:{min(5, primary_label.count('-'))}"] = 1
    features[f"suffix:{'.'.join(labels[-2:])}"] = 1
    return features


def predict_web_model(model: dict, domain: str) -> dict:
    domain = normalize_domain(domain)
    logits = dict(model["class_log_prior"])
    defaults = model["default_log_likelihood"]
    likelihoods = model["feature_log_likelihood"]
    for feature, count in _extract_features(domain, model["feature_config"]).items():
        observed = likelihoods.get(feature)
        if observed is None:
            continue
        for label in WEB_LABELS:
            logits[label] += count * observed.get(label, defaults[label])
    temperature = float(model["temperature"])
    scaled = {label: value / temperature for label, value in logits.items()}
    maximum = max(scaled.values())
    exponentials = {label: math.exp(value - maximum) for label, value in scaled.items()}
    denominator = sum(exponentials.values())
    probabilities = {label: value / denominator for label, value in exponentials.items()}
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


class ContentClassifier:
    """Load the approved website model once and cache final domain decisions."""

    def __init__(self, models_dir: Optional[str] = None):
        models_dir = models_dir or os.path.join(agent_root(), "models")
        model_path = os.path.join(models_dir, "web_content_model_v1.json")
        self.web_model = _validate_web_model(_load_verified_json(model_path))
        self._web_cache = {}
        self._lock = threading.Lock()

    def classify_web(self, domain: str) -> dict:
        domain = normalize_domain(domain)
        with self._lock:
            cached = self._web_cache.get(domain)
        if cached is not None:
            return dict(cached)
        result = predict_web_model(self.web_model, domain)
        if result["label"] is not None:
            with self._lock:
                self._web_cache[domain] = dict(result)
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
    app_model = _load_verified_json(
        os.path.join(models_dir, "app_content_model_v1.json")
    )
    if (
        app_model.get("model_version") != MODEL_VERSION
        or app_model.get("resource_type") != "apps"
        or app_model.get("deployment_approved") is not True
        or app_model.get("confidence_threshold") != 0.7
    ):
        raise ContentModelError("Packaged app content model is incompatible")
    lookup = _load_verified_json(
        os.path.join(models_dir, "app_exact_lookup_v1.json")
    )
    if lookup.get("lookup_version") != "1.0.0" or lookup.get("resource_type") != "apps":
        raise ContentModelError("Packaged app exact lookup is incompatible")
    return {
        "web_model_version": web_model["model_version"],
        "app_model_version": app_model["model_version"],
        "app_lookup_version": lookup["lookup_version"],
    }
