import os
import sys
import unittest
import json
import tempfile
import requests
from unittest.mock import Mock, patch


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


class APIClientRecoveryTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.config_path = os.path.join(temp.name, 'config.json')
        self.version = 1000000000
        self.write_config('old-secret')
        decrypt = patch.object(APIClient, 'decrypt_secret', side_effect=lambda value: value)
        decrypt.start()
        self.addCleanup(decrypt.stop)
        self.client = APIClient(self.config_path)
        network = patch('api_client.requests.request')
        self.send = network.start()
        self.addCleanup(network.stop)
        clock = patch('api_client.time.monotonic', return_value=100)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.send.return_value = self.response(401)
        self.client.post('/api/agent/heartbeat', data={})
        self.assertTrue(self.client.suspended)
        self.send.reset_mock()

    @staticmethod
    def response(status):
        response = requests.Response()
        response.status_code = status
        return response

    def write_config(self, secret):
        with open(self.config_path, 'w', encoding='utf-8') as output:
            json.dump({'server_url': 'https://example.test', 'device_secret': secret,
                       'is_encrypted': True}, output)
        self.version += 1
        os.utime(self.config_path, (self.version, self.version))

    def test_new_secret_recovers_and_sends_original_request(self):
        self.write_config('new-secret')
        self.send.return_value = self.response(200)
        response = self.client.post('/api/logs/batch', data={'records': []})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.client.suspended)
        self.assertEqual([call.kwargs['url'] for call in self.send.call_args_list],
                         ['https://example.test/api/agent/heartbeat', 'https://example.test/api/logs/batch'])
        for call in self.send.call_args_list:
            self.assertEqual(call.kwargs['headers']['X-Device-Secret'], 'new-secret')
            self.assertFalse(call.kwargs['allow_redirects'])

    def test_unchanged_rejected_secret_does_not_send(self):
        self.assertIsNone(self.client.get('/api/agent/config'))
        self.send.assert_not_called()

    def test_rejected_new_secret_stays_suspended_until_next_change(self):
        self.write_config('invalid-secret')
        self.send.return_value = self.response(401)
        self.assertIsNone(self.client.get('/api/agent/config'))
        self.clock.return_value = 200
        self.assertIsNone(self.client.get('/api/agent/config'))
        self.assertTrue(self.client.suspended)
        self.assertEqual(self.send.call_count, 1)
        self.write_config('valid-secret')
        self.send.return_value = self.response(200)
        self.assertEqual(self.client.get('/api/agent/config').status_code, 200)
        self.assertFalse(self.client.suspended)

    def test_transient_failures_retry_without_another_config_edit(self):
        for failure in [requests.ConnectionError('offline'), self.response(503), self.response(429)]:
            with self.subTest(failure=type(failure).__name__):
                self.write_config('new-secret')
                self.clock.return_value = 100
                self.send.reset_mock()
                self.send.side_effect = [failure, self.response(200), self.response(200)]
                self.assertIsNone(self.client.get('/api/agent/config'))
                self.assertTrue(self.client.suspended)
                self.clock.return_value = 129
                self.assertIsNone(self.client.get('/api/agent/config'))
                self.assertEqual(self.send.call_count, 1)
                self.clock.return_value = 130
                self.assertEqual(self.client.get('/api/agent/config').status_code, 200)
                self.assertFalse(self.client.suspended)
                self.assertEqual(self.send.call_count, 3)

    def test_partial_config_write_can_be_retried_with_same_mtime(self):
        with open(self.config_path, 'w', encoding='utf-8') as output:
            output.write('{')
        self.version += 1
        os.utime(self.config_path, (self.version, self.version))
        self.assertIsNone(self.client.get('/api/agent/config'))
        self.send.assert_not_called()
        self.assertEqual(self.client.device_secret, 'old-secret')
        self.version -= 1
        self.write_config('new-secret')
        self.send.return_value = self.response(200)
        self.assertEqual(self.client.get('/api/agent/config').status_code, 200)

    def test_empty_decrypted_secret_does_not_replace_credentials(self):
        self.write_config('')
        self.assertIsNone(self.client.get('/api/agent/config'))
        self.assertEqual(self.client.device_secret, 'old-secret')
        self.assertTrue(self.client.suspended)
        self.send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
