import gzip
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from school_violence.training import fit
    from text_safety.config import get_settings, reset_settings_cache
    from text_safety.main import app, get_engine
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


@unittest.skipUnless(FASTAPI_AVAILABLE, "text-safety service dependencies are not installed")
class ThreeLabelApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.model_path = Path(self.temp.name) / "model.json.gz"
        records = [
            {"text": "Cùng nhau học bài", "label": "SAFE"},
            {"text": "Bạn ấy trêu em", "label": "RISK"},
            {"text": "Họ dọa đánh em", "label": "HIGH_RISK"},
        ]
        with gzip.open(self.model_path, "wt", encoding="utf-8") as handle:
            json.dump(fit(records, 1.0), handle, ensure_ascii=False)
        self.environment = patch.dict(os.environ, {
            "TEXT_SAFETY_ENV": "development",
            "TEXT_SAFETY_API_KEY": "local-test-secret-1234",
            "TEXT_SAFETY_MODEL_PATH": str(self.model_path),
        })
        self.environment.start()
        reset_settings_cache()
        get_engine.cache_clear()
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        get_engine.cache_clear()
        reset_settings_cache()
        self.environment.stop()
        self.temp.cleanup()

    def test_health_and_batch_use_three_labels(self):
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["labelVersion"], "2.0.0")
        self.assertFalse(health.json()["deploymentEligible"])
        response = self.client.post("/v1/moderate",
            headers={"X-Local-Moderation-Key": "local-test-secret-1234"},
            json={"items": [{"id": "one", "text": "Họ dọa đánh em", "sourceType": "chat_received"}]})
        self.assertEqual(response.status_code, 200)
        result = response.json()["results"][0]
        self.assertIn(result["label"], ("SAFE", "RISK", "HIGH_RISK"))
        self.assertEqual(set(result["scores"]), {"SAFE", "RISK", "HIGH_RISK"})
        self.assertFalse(response.json()["deploymentEligible"])
        self.assertNotIn("categoryScores", result)

    def test_auth_and_validation_do_not_echo_text(self):
        payload = {"items": [{"id": "one", "text": "private-child-text", "sourceType": "bad"}]}
        self.assertEqual(self.client.post("/v1/moderate", json=payload).status_code, 401)
        response = self.client.post("/v1/moderate",
            headers={"X-Local-Moderation-Key": "local-test-secret-1234"}, json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("private-child-text", response.text)

    def test_unapproved_artifact_cannot_start_in_production(self):
        (self.model_path.parent / "evaluation_report.json").write_text(
            json.dumps({"deployment_eligible": False}), encoding="utf-8")
        with patch.dict(os.environ, {"TEXT_SAFETY_ENV": "production"}):
            reset_settings_cache()
            with self.assertRaisesRegex(RuntimeError, "Unapproved"):
                get_settings()
        reset_settings_cache()


if __name__ == "__main__":
    unittest.main()
