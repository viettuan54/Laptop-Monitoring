import gzip
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from school_violence.training import fit
from text_safety import run_pinned
from text_safety.config import reset_settings_cache
from text_safety.main import get_engine


class PinnedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.model = self.root / "artifacts/fixture/model.json.gz"
        self.model.parent.mkdir(parents=True)
        artifact = fit([{"text": "homework", "label": "SAFE"},
                        {"text": "teasing", "label": "RISK"},
                        {"text": "violence", "label": "HIGH_RISK"}], 1.0)
        with gzip.open(self.model, "wt", encoding="utf-8") as handle:
            json.dump(artifact, handle)
        self.lock = self.root / "candidate.lock.json"
        self.lock.write_text(json.dumps({
            "artifact_relative_to_ai_training": "artifacts/fixture/model.json.gz",
            "model_sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
            "model_version": artifact["model_version"]}), encoding="utf-8")
        self.env = self.root / "backend.env"
        self.env.write_text("NODE_ENV=development\nLOCAL_MODERATION_API_KEY=fixture-secret-at-least-16\n", encoding="utf-8")
        self.config = self.root / "runtime.json"
        self.config.write_text(json.dumps({"lock_path": str(self.lock),
            "lock_sha256": hashlib.sha256(self.lock.read_bytes()).hexdigest(),
            "model_version": artifact["model_version"],
            "model_sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
            "backend_env_path": str(self.env), "port": 8100, "log_dir": str(self.root / "logs")}), encoding="utf-8")
        self.module_path = patch.object(run_pinned, "__file__", str(self.root / "text_safety/run_pinned.py"))
        self.module_path.start()
        self.environment = patch.dict(os.environ, {})
        self.environment.start()
        get_engine.cache_clear()
        reset_settings_cache()

    def tearDown(self):
        get_engine.cache_clear()
        reset_settings_cache()
        self.environment.stop()
        self.module_path.stop()
        self.temp.cleanup()

    def test_preflight_loads_exact_bytes_and_ignores_inherited_model_path(self):
        os.environ["TEXT_SAFETY_MODEL_PATH"] = "wrong-default-model"
        runtime = run_pinned.load_runtime(self.config)
        engine = run_pinned.prepare_engine(runtime)
        self.assertEqual(engine.model_sha256, runtime["lock"]["model_sha256"])
        self.assertEqual(os.environ["TEXT_SAFETY_API_KEY"], "fixture-secret-at-least-16")

    def test_replaced_artifact_is_rejected_before_startup(self):
        self.model.write_bytes(b"changed")
        with self.assertRaisesRegex(run_pinned.RuntimeConfigurationError, "artifact changed"):
            run_pinned.load_runtime(self.config)

    def test_changed_lock_cannot_silently_select_another_model(self):
        self.lock.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(run_pinned.RuntimeConfigurationError, "lock changed"):
            run_pinned.load_runtime(self.config)

    def test_missing_key_never_starts_an_unauthenticated_service(self):
        self.env.write_text("NODE_ENV=development", encoding="utf-8")
        with self.assertRaisesRegex(run_pinned.RuntimeConfigurationError, "key must"):
            run_pinned.load_runtime(self.config)

    def test_remote_endpoint_or_wrong_port_is_rejected(self):
        for endpoint in ["http://remote:8100", "http://127.0.0.1:9999", "http://127.0.0.1:8100/other"]:
            self.env.write_text("LOCAL_MODERATION_API_KEY=fixture-secret-at-least-16\nLOCAL_MODERATION_URL=" + endpoint, encoding="utf-8")
            with self.assertRaisesRegex(run_pinned.RuntimeConfigurationError, "loopback"):
                run_pinned.load_runtime(self.config)

    def test_backend_pin_mismatch_is_rejected(self):
        self.env.write_text("LOCAL_MODERATION_API_KEY=fixture-secret-at-least-16\nLOCAL_MODERATION_EXPECTED_MODEL=wrong-model", encoding="utf-8")
        with self.assertRaisesRegex(run_pinned.RuntimeConfigurationError, "Backend model pin"):
            run_pinned.load_runtime(self.config)

    def test_runtime_cannot_bypass_production_approval(self):
        self.env.write_text("LOCAL_MODERATION_API_KEY=fixture-secret-at-least-16\nNODE_ENV=production", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "Unapproved"):
            run_pinned.prepare_engine(run_pinned.load_runtime(self.config))


if __name__ == "__main__":
    unittest.main()
