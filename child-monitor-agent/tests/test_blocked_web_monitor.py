import os
import sys
import unittest
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from blocked_web_monitor import BlockedWebAttemptMonitor


def tls_client_hello(server_name):
    encoded_name = server_name.encode("ascii")
    name_entry = b"\x00" + len(encoded_name).to_bytes(2, "big") + encoded_name
    sni_payload = len(name_entry).to_bytes(2, "big") + name_entry
    sni_extension = b"\x00\x00" + len(sni_payload).to_bytes(2, "big") + sni_payload
    extensions = len(sni_extension).to_bytes(2, "big") + sni_extension
    body = (
        b"\x03\x03"
        + (b"\x00" * 32)
        + b"\x00"
        + b"\x00\x02\x13\x01"
        + b"\x01\x00"
        + extensions
    )
    handshake = b"\x01" + len(body).to_bytes(3, "big") + body
    return b"\x16\x03\x01" + len(handshake).to_bytes(2, "big") + handshake


class FakeConnection:
    def __init__(self, payload):
        self.payload = payload
        self.sent = b""

    def settimeout(self, _timeout):
        pass

    def recv(self, _size):
        payload, self.payload = self.payload, b""
        return payload

    def sendall(self, payload):
        self.sent += payload


class BlockedWebAttemptMonitorTest(unittest.TestCase):
    def test_extracts_http_host_and_tls_sni_without_page_content(self):
        self.assertEqual(
            BlockedWebAttemptMonitor.extract_http_host(
                b"GET /private HTTP/1.1\r\nHost: www.gamevui.vn:80\r\n\r\n"
            ),
            "www.gamevui.vn",
        )
        self.assertEqual(
            BlockedWebAttemptMonitor.extract_tls_sni(
                tls_client_hello("gamevui.vn")
            ),
            "gamevui.vn",
        )

    def test_http_connection_records_only_a_blocked_domain(self):
        callback = Mock(return_value=True)
        monitor = BlockedWebAttemptMonitor(
            callback,
            lambda domain: domain.casefold() == "gamevui.vn",
        )
        connection = FakeConnection(
            b"GET / HTTP/1.1\r\nHost: gamevui.vn\r\nConnection: close\r\n\r\n"
        )

        monitor._handle_connection(connection, "http")

        callback.assert_called_once_with("gamevui.vn", "http")
        self.assertIn(b"451 Unavailable For Legal Reasons", connection.sent)

    def test_repeated_browser_connections_are_deduplicated(self):
        callback = Mock(return_value=True)
        monitor = BlockedWebAttemptMonitor(callback, lambda _domain: True)

        with patch("blocked_web_monitor.time.monotonic", side_effect=[10.0, 20.0, 26.0]):
            self.assertTrue(monitor._record_attempt("gamevui.vn", "https"))
            self.assertFalse(monitor._record_attempt("www.gamevui.vn", "https"))
            self.assertTrue(monitor._record_attempt("gamevui.vn", "https"))

        self.assertEqual(callback.call_count, 2)


if __name__ == "__main__":
    unittest.main()
