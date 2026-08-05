import os
import sys
import base64
import tempfile
import unittest
from unittest.mock import patch

import win32crypt

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER_ROOT = os.path.join(AGENT_ROOT, "installer")
if INSTALLER_ROOT not in sys.path:
    sys.path.insert(0, INSTALLER_ROOT)

from provision_agent import (
    encrypt_machine_scope,
    normalize_device_secret,
    normalize_server_url,
    normalize_vision_subject_id,
    write_config_atomic,
)


class ProvisioningValidationTest(unittest.TestCase):
    def test_accepts_secure_server_and_canonical_uuid(self):
        self.assertEqual(
            normalize_server_url("https://api.example.com/"),
            "https://api.example.com",
        )
        self.assertEqual(
            normalize_device_secret("550E8400-E29B-41D4-A716-446655440000"),
            "550e8400-e29b-41d4-a716-446655440000",
        )

    def test_allows_http_only_for_loopback(self):
        self.assertEqual(
            normalize_server_url("http://127.0.0.1:3000"),
            "http://127.0.0.1:3000",
        )
        with self.assertRaises(ValueError):
            normalize_server_url("http://api.example.com")

    def test_rejects_url_credentials_paths_and_invalid_secret(self):
        invalid_urls = [
            "https://user:pass@example.com",
            "https://example.com/api",
            "https://example.com?token=x",
        ]
        for value in invalid_urls:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_server_url(value)

        with self.assertRaises(ValueError):
            normalize_device_secret("not-a-device-secret")

        self.assertEqual(
            normalize_vision_subject_id("subject-child_001"),
            "subject-child_001",
        )
        with self.assertRaises(ValueError):
            normalize_vision_subject_id("../child")

    def test_machine_scope_encryption_and_atomic_config_write(self):
        secret = "550e8400-e29b-41d4-a716-446655440000"
        encrypted = encrypt_machine_scope(secret)
        _, plaintext = win32crypt.CryptUnprotectData(
            base64.b64decode(encrypted),
            None,
            None,
            None,
            0,
        )
        self.assertEqual(plaintext.decode("utf-8"), secret)

        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = os.path.join(temp_dir, "local_config.json")
            # ACL behavior is exercised by the elevated installer; do not remove
            # the test runner's access to its own temporary directory.
            with patch("provision_agent.secure_config_file"):
                write_config_atomic(config_path, {
                    "server_url": "https://api.example.com",
                    "device_secret": encrypted,
                    "is_encrypted": True,
                })
            self.assertTrue(os.path.exists(config_path))


if __name__ == "__main__":
    unittest.main()
