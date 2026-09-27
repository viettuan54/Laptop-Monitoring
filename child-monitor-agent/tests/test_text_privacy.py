import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "service"))

from text_privacy import clean_text, eligible_timestamp, policy_enabled, protect_text, safe_web_metadata, unprotect_text
from api_client import APIClient


class TextPrivacyTest(unittest.TestCase):
    def test_missing_expired_forged_or_legacy_policy_fails_closed(self):
        now = time.time()
        valid = {"enabled": True, "issued_at": now, "expires_at": now + 180,
                 "enabled_since": now - 1}
        self.assertTrue(policy_enabled(valid, now))
        for policy in (None, {}, {"enabled": True}, {**valid, "enabled": 1},
                       {**valid, "expires_at": now}, {**valid, "expires_at": now + 181},
                       {**valid, "issued_at": float("nan")}, {**valid, "enabled_since": now + 2}):
            self.assertFalse(policy_enabled(policy, now))

    def test_only_timestamps_in_current_consent_window_are_eligible(self):
        now = time.time()
        policy = {"enabled": True, "issued_at": now, "expires_at": now + 180,
                  "enabled_since": now - 10}
        timestamp = lambda seconds: datetime.fromtimestamp(seconds, timezone.utc).isoformat()
        self.assertTrue(eligible_timestamp(timestamp(now), policy, now))
        for value in (timestamp(now - 11), timestamp(now + 31), "2026-09-26T08:00:00", "invalid"):
            self.assertFalse(eligible_timestamp(value, policy, now))

    def test_private_queries_are_rejected_without_echoing_contents(self):
        self.assertEqual(clean_text("  tôi\u200b không\nmuốn chết  "), "tôi không muốn chết")
        for value in ("liên hệ abc@example.com", "gọi 0901234567", "token: secret-value",
                      "mật khẩu=private", "Bearer credential", "https://example.com/?token=private",
                      "abc\x00private", "ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ", "x" * 1001):
            with self.assertRaises(ValueError) as error:
                clean_text(value)
            self.assertNotIn(value, str(error.exception))

    def test_web_metadata_never_contains_path_query_credentials_or_title(self):
        url, title = safe_web_metadata("https://user:pass@example.com/private?q=secret#token", "private title")
        self.assertEqual((url, title), ("https://example.com/", "example.com"))
        self.assertEqual(safe_web_metadata("http://[::1]:1234/a?q=x", "x")[0], "http://[::1]/")

    def test_dpapi_round_trip_and_plaintext_rejection(self):
        value = "tôi cần giúp đỡ"
        encrypted = protect_text(value)
        self.assertTrue(encrypted.startswith("dpapi:v1:"))
        self.assertNotIn(value, encrypted)
        self.assertEqual(unprotect_text(encrypted), value)
        with self.assertRaises(ValueError):
            unprotect_text(value)

    def test_api_retry_rechecks_policy_without_logging_exception_payload(self):
        client = APIClient.__new__(APIClient)
        client.server_url = "https://example.com"
        client.suspended = False
        client.device_secret = "test-secret"
        client.check_config_reload = Mock()
        before_send = Mock(side_effect=[True, False])
        import api_client
        private = "private-request-body"
        with patch.object(api_client.requests, "request", side_effect=api_client.requests.RequestException(private)) as request, \
             patch.object(api_client.time, "sleep"), self.assertLogs(level="WARNING") as logs:
            self.assertIsNone(client.post_text_moderation([{"text": private}], before_send))
        self.assertEqual(request.call_count, 1)
        self.assertEqual(before_send.call_count, 2)
        self.assertNotIn(private, " ".join(logs.output))


if __name__ == "__main__":
    unittest.main()
