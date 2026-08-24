import os
import sys
import unittest
from unittest.mock import Mock


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from api_client import APIClient


class APIClientClassificationTest(unittest.TestCase):
    @staticmethod
    def _client_with_response(response):
        client = APIClient.__new__(APIClient)
        client.request = Mock(return_value=response)
        return client

    def test_web_fallback_returns_valid_category_from_backend_json(self):
        response = Mock(status_code=200)
        response.__bool__ = Mock(return_value=True)
        response.json.return_value = {"category": "entertainment"}
        client = self._client_with_response(response)

        category = client.classify_web_domain("gamevui.vn")

        self.assertEqual(category, "entertainment")
        client.request.assert_called_once_with(
            "POST",
            "/api/agent/classification/web/fallback",
            payload={"domain": "gamevui.vn"},
            timeout=20,
            max_retries=1,
        )

    def test_web_fallback_rejects_invalid_or_malformed_category_response(self):
        invalid_response = Mock(status_code=200)
        invalid_response.__bool__ = Mock(return_value=True)
        invalid_response.json.return_value = {"category": "games"}
        invalid_client = self._client_with_response(invalid_response)
        self.assertIsNone(invalid_client.classify_web_domain("gamevui.vn"))

        malformed_response = Mock(status_code=200)
        malformed_response.__bool__ = Mock(return_value=True)
        malformed_response.json.side_effect = ValueError("invalid json")
        malformed_client = self._client_with_response(malformed_response)
        self.assertIsNone(malformed_client.classify_web_domain("gamevui.vn"))


if __name__ == "__main__":
    unittest.main()
