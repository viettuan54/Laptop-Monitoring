"""Start the pinned local text API using the backend's existing secret.

Configuration contains paths and hashes only. No secret or query is logged.
The Windows scheduled task restarts this process after a nonzero exit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from dotenv import dotenv_values


class RuntimeConfigurationError(RuntimeError):
    pass


def load_runtime(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    root = Path(__file__).resolve().parents[1]
    lock_path = Path(config["lock_path"]).resolve()
    lock_bytes = lock_path.read_bytes()
    if hashlib.sha256(lock_bytes).hexdigest() != config["lock_sha256"]:
        raise RuntimeConfigurationError("Candidate lock changed; review configuration before restart")
    lock = json.loads(lock_bytes)
    model_path = (root / lock["artifact_relative_to_ai_training"]).resolve()
    if not model_path.is_relative_to(root / "artifacts"):
        raise RuntimeConfigurationError("Candidate is outside the artifact directory")
    if (lock["model_sha256"] != config["model_sha256"]
            or lock["model_version"] != config["model_version"]):
        raise RuntimeConfigurationError("Candidate pins do not match the lock")
    if hashlib.sha256(model_path.read_bytes()).hexdigest() != lock["model_sha256"]:
        raise RuntimeConfigurationError("Model artifact changed; refusing to load another model")
    backend = dotenv_values(config["backend_env_path"], interpolate=False)
    key = str(backend.get("LOCAL_MODERATION_API_KEY") or "").strip()
    if len(key) < 16:
        raise RuntimeConfigurationError("Backend local moderation key must contain at least 16 characters")
    endpoint = urlparse(backend.get("LOCAL_MODERATION_URL") or "http://127.0.0.1:8100")
    port = config["port"]
    if isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535:
        raise RuntimeConfigurationError("Invalid local service port")
    if (endpoint.scheme != "http" or endpoint.hostname not in {"127.0.0.1", "localhost"}
            or (endpoint.port or 80) != port or endpoint.path not in {"", "/"}
            or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment):
        raise RuntimeConfigurationError("Backend URL must match this loopback service")
    for field, expected in (("LOCAL_MODERATION_EXPECTED_MODEL", lock["model_version"]),
                            ("LOCAL_MODERATION_EXPECTED_SHA256", lock["model_sha256"])):
        if backend.get(field) and backend[field].strip() != expected:
            raise RuntimeConfigurationError("Backend model pin does not match the scheduled service")
    environment = str(backend.get("NODE_ENV") or "development").strip().lower()
    if environment not in {"development", "test", "production"}:
        raise RuntimeConfigurationError("Unsupported backend environment")
    return {"config": config, "model_path": model_path, "key": key,
            "environment": environment, "lock": lock}


def prepare_engine(runtime):
    os.environ["TEXT_SAFETY_ENV"] = runtime["environment"]
    os.environ["TEXT_SAFETY_API_KEY"] = runtime["key"]
    os.environ["TEXT_SAFETY_MODEL_PATH"] = str(runtime["model_path"])
    from .config import reset_settings_cache
    from .main import get_engine
    reset_settings_cache()
    get_engine.cache_clear()
    engine = get_engine()  # Keeps the production approval guard.
    if (engine.model_version != runtime["lock"]["model_version"]
            or engine.model_sha256 != runtime["lock"]["model_sha256"]):
        raise RuntimeConfigurationError("Loaded model does not match the pinned artifact")
    return engine


def probe(runtime):
    request = Request(f"http://127.0.0.1:{runtime['config']['port']}/model-info",
                      headers={"X-Local-Moderation-Key": runtime["key"]})
    with urlopen(request, timeout=3) as response:
        health = json.load(response)
    if (health.get("status") != "ok" or health.get("model") != runtime["lock"]["model_version"]
            or health.get("modelSha256") != runtime["lock"]["model_sha256"]):
        raise RuntimeConfigurationError("Running service does not match pinned model")
    return health


def serve(runtime):
    import uvicorn
    from .main import app
    log_dir = Path(runtime["config"]["log_dir"])
    log_dir.mkdir(parents=True, exist_ok=True)
    logging_config = {
        "version": 1, "disable_existing_loggers": False,
        "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(message)s"}},
        "handlers": {"file": {"class": "logging.handlers.RotatingFileHandler",
            "filename": str(log_dir / "service.log"), "maxBytes": 2 * 1024 * 1024,
            "backupCount": 3, "encoding": "utf-8", "formatter": "plain"}},
        "loggers": {"uvicorn": {"handlers": ["file"], "level": "INFO", "propagate": False},
                    "uvicorn.error": {"level": "INFO"},
                    "uvicorn.access": {"handlers": [], "level": "CRITICAL", "propagate": False}},
    }
    uvicorn.run(app, host="127.0.0.1", port=runtime["config"]["port"],
                access_log=False, log_config=logging_config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    try:
        runtime = load_runtime(args.config)
        if args.probe:
            print(json.dumps(probe(runtime)))
            return 0
        engine = prepare_engine(runtime)
        if args.check:
            print(json.dumps({"configuration_valid": True, "model": engine.model_version,
                "modelSha256": engine.model_sha256, "port": runtime["config"]["port"],
                "environment": runtime["environment"]}))
            return 0
        serve(runtime)
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, RuntimeConfigurationError) else type(error).__name__
        print("Pinned text service failed: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
