"""Observe real browser connections redirected by the Agent hosts policy.

The listener is loopback-only. HTTP Host and TLS SNI reveal the blocked hostname
without decrypting traffic, installing a certificate, or collecting page content.
"""

from __future__ import annotations

import logging
import socket
import threading
import time


class BlockedWebAttemptMonitor:
    """Log attempted connections to domains already blocked by the Agent."""

    MAX_INITIAL_BYTES = 16 * 1024
    HTTP_RESPONSE = (
        b"HTTP/1.1 451 Unavailable For Legal Reasons\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n"
        b"Cache-Control: no-store\r\n"
        b"Connection: close\r\n"
        b"Content-Length: 39\r\n\r\n"
        b"Website blocked by Child Monitor Agent."
    )

    def __init__(
        self,
        attempt_callback,
        is_blocked_callback,
        listen_address="127.0.0.2",
        dedupe_seconds=15,
    ):
        self.attempt_callback = attempt_callback
        self.is_blocked_callback = is_blocked_callback
        self.listen_address = listen_address
        self.dedupe_seconds = max(1, int(dedupe_seconds))
        self.running = False
        self._listeners = []
        self._listener_lock = threading.Lock()
        self._recent_attempts = {}
        self._recent_lock = threading.Lock()

    def start(self):
        if self.running:
            return
        self.running = True
        for port, scheme in ((80, "http"), (443, "https")):
            threading.Thread(
                target=self._serve,
                args=(port, scheme),
                daemon=True,
                name=f"BlockedWebMonitor-{port}",
            ).start()

    def stop(self):
        self.running = False
        with self._listener_lock:
            listeners = list(self._listeners)
            self._listeners.clear()
        for listener in listeners:
            try:
                listener.close()
            except OSError:
                pass

    def _serve(self, port, scheme):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((self.listen_address, port))
            listener.listen(32)
            listener.settimeout(1.0)
            with self._listener_lock:
                if not self.running:
                    return
                self._listeners.append(listener)
            logging.info(
                "Blocked website attempt monitor listening on %s:%s",
                self.listen_address,
                port,
            )
            while self.running:
                try:
                    connection, _address = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                with connection:
                    self._handle_connection(connection, scheme)
        except OSError as error:
            logging.error(
                "Could not start blocked website monitor on %s:%s: %s",
                self.listen_address,
                port,
                error,
            )
        finally:
            with self._listener_lock:
                if listener in self._listeners:
                    self._listeners.remove(listener)
            try:
                listener.close()
            except OSError:
                pass

    def _handle_connection(self, connection, scheme):
        try:
            connection.settimeout(1.0)
            payload = self._receive_initial_payload(connection, scheme)
            domain = (
                self.extract_http_host(payload)
                if scheme == "http"
                else self.extract_tls_sni(payload)
            )
            if domain and self.is_blocked_callback(domain):
                self._record_attempt(domain, scheme)
            if scheme == "http":
                try:
                    connection.sendall(self.HTTP_RESPONSE)
                except OSError:
                    pass
        except Exception as error:
            logging.debug("Blocked website connection inspection failed: %s", error)

    def _receive_initial_payload(self, connection, scheme):
        payload = bytearray()
        while len(payload) < self.MAX_INITIAL_BYTES:
            try:
                chunk = connection.recv(min(4096, self.MAX_INITIAL_BYTES - len(payload)))
            except socket.timeout:
                break
            if not chunk:
                break
            payload.extend(chunk)
            if scheme == "http" and b"\r\n\r\n" in payload:
                break
            if scheme == "https" and len(payload) >= 5:
                record_size = 5 + int.from_bytes(payload[3:5], "big")
                if len(payload) >= record_size:
                    break
        return bytes(payload)

    def _record_attempt(self, domain, scheme):
        now = time.monotonic()
        key = domain.casefold().rstrip(".")
        if key.startswith("www."):
            key = key[4:]
        with self._recent_lock:
            previous = self._recent_attempts.get(key)
            if previous is not None and now - previous < self.dedupe_seconds:
                return False
        recorded = bool(self.attempt_callback(domain, scheme))
        if recorded:
            with self._recent_lock:
                self._recent_attempts[key] = now
                cutoff = now - (self.dedupe_seconds * 4)
                self._recent_attempts = {
                    item: observed
                    for item, observed in self._recent_attempts.items()
                    if observed >= cutoff
                }
        return recorded

    @staticmethod
    def extract_http_host(payload):
        if not isinstance(payload, (bytes, bytearray)) or not payload:
            return None
        try:
            text = bytes(payload).decode("iso-8859-1")
        except UnicodeError:
            return None
        lines = text.split("\r\n")
        if not lines or not any(
            lines[0].startswith(method + " ")
            for method in ("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
        ):
            return None
        for line in lines[1:]:
            if not line:
                break
            name, separator, value = line.partition(":")
            if separator and name.strip().casefold() == "host":
                host = value.strip()
                if host.startswith("["):
                    return None
                candidate, separator, port = host.rpartition(":")
                if separator and port.isdigit():
                    host = candidate
                return host or None
        return None

    @staticmethod
    def extract_tls_sni(payload):
        """Return the first DNS SNI from one bounded TLS ClientHello record."""
        if not isinstance(payload, (bytes, bytearray)):
            return None
        data = bytes(payload)
        if len(data) < 9 or data[0] != 22 or data[5] != 1:
            return None
        record_end = 5 + int.from_bytes(data[3:5], "big")
        handshake_end = 9 + int.from_bytes(data[6:9], "big")
        end = min(len(data), record_end, handshake_end)
        offset = 9
        if offset + 35 > end:
            return None
        offset += 34
        session_length = data[offset]
        offset += 1 + session_length
        if offset + 2 > end:
            return None
        cipher_length = int.from_bytes(data[offset:offset + 2], "big")
        offset += 2 + cipher_length
        if offset + 1 > end:
            return None
        compression_length = data[offset]
        offset += 1 + compression_length
        if offset + 2 > end:
            return None
        extensions_end = min(
            end,
            offset + 2 + int.from_bytes(data[offset:offset + 2], "big"),
        )
        offset += 2
        while offset + 4 <= extensions_end:
            extension_type = int.from_bytes(data[offset:offset + 2], "big")
            extension_length = int.from_bytes(data[offset + 2:offset + 4], "big")
            offset += 4
            extension_end = offset + extension_length
            if extension_end > extensions_end:
                return None
            if extension_type == 0 and extension_length >= 5:
                name_offset = offset + 2
                while name_offset + 3 <= extension_end:
                    name_type = data[name_offset]
                    name_length = int.from_bytes(
                        data[name_offset + 1:name_offset + 3], "big"
                    )
                    name_offset += 3
                    name_end = name_offset + name_length
                    if name_end > extension_end:
                        return None
                    if name_type == 0:
                        try:
                            return data[name_offset:name_end].decode("ascii")
                        except UnicodeError:
                            return None
                    name_offset = name_end
            offset = extension_end
        return None
