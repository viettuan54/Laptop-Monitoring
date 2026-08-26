import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

try:
    from fastapi.testclient import TestClient

    from text_safety.config import get_settings, reset_settings_cache
    from text_safety.main import app, get_engine

    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False


@unittest.skipUnless(FASTAPI_AVAILABLE, "text-safety service dependencies are not installed")
class TextSafetyApiTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "TEXT_SAFETY_ENV": "development",
                "TEXT_SAFETY_API_KEY": "local-test-secret-1234",
                "TEXT_SAFETY_MODEL_VERSION": "vi-context-rules-test",
            },
            clear=False,
        )
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

    def test_health_does_not_require_credentials(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["model"], "vi-context-rules-test")

    def test_moderation_requires_local_api_key(self):
        response = self.client.post(
            "/v1/moderate",
            json={
                "items": [
                    {
                        "id": "one",
                        "text": "Xin chào",
                        "sourceType": "chat_received",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 401)

    def test_moderates_a_batch_with_backend_compatible_fields(self):
        response = self.client.post(
            "/v1/moderate",
            headers={"X-Local-Moderation-Key": "local-test-secret-1234"},
            json={
                "items": [
                    {
                        "id": "one",
                        "text": "Tao sẽ đánh mày",
                        "sourceType": "chat_received",
                        "direction": "received",
                        "context": [],
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["provider"], "local")
        self.assertEqual(payload["model"], "vi-context-rules-test")
        self.assertEqual(payload["results"][0]["riskType"], "harassment")
        self.assertTrue(payload["results"][0]["flagged"])

    def test_validation_error_does_not_echo_raw_text(self):
        sensitive_text = "private-content-that-must-not-be-echoed"
        response = self.client.post(
            "/v1/moderate",
            headers={"X-Local-Moderation-Key": "local-test-secret-1234"},
            json={
                "items": [
                    {
                        "id": "one",
                        "text": sensitive_text,
                        "sourceType": "invalid_source",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertNotIn(sensitive_text, response.text)

    def test_duplicate_ids_are_rejected(self):
        response = self.client.post(
            "/v1/moderate",
            headers={"X-Local-Moderation-Key": "local-test-secret-1234"},
            json={
                "items": [
                    {"id": "same", "text": "Một", "sourceType": "page_content"},
                    {"id": "same", "text": "Hai", "sourceType": "page_content"},
                ]
            },
        )

        self.assertEqual(response.status_code, 422)


class TextSafetyProductionConfigTest(unittest.TestCase):
    def test_production_requires_a_long_api_key(self):
        if not FASTAPI_AVAILABLE:
            self.skipTest("text-safety service dependencies are not installed")
        with patch.dict(
            os.environ,
            {"TEXT_SAFETY_ENV": "production", "TEXT_SAFETY_API_KEY": "short"},
            clear=False,
        ):
            reset_settings_cache()
            with self.assertRaisesRegex(RuntimeError, "at least 16 characters"):
                get_settings()
        reset_settings_cache()


if __name__ == "__main__":
    unittest.main()
