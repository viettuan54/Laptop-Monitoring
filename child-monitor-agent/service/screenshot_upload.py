"""Bounded, memory-only screenshot delivery; never replay images after consent expires."""
import base64
import logging
import queue
import threading
import time
import uuid
from datetime import datetime


class ScreenshotUploader:
    def __init__(self, api_client, policy_provider):
        self.api_client = api_client
        self.policy_provider = policy_provider
        self.pending = queue.Queue(maxsize=1)
        self.stop_event = threading.Event()
        self.last_accepted_at = None
        self.accept_lock = threading.Lock()

    def allowed(self, record):
        policy = self.policy_provider()
        try:
            captured = datetime.fromisoformat(record["captured_at"].replace("Z", "+00:00"))
            return (policy.get("enabled") is True
                    and policy.get("revision") == record.get("policy_revision")
                    and captured.tzinfo is not None
                    and -30 <= time.time() - captured.timestamp() <= 180)
        except (KeyError, ValueError, TypeError, AttributeError):
            return False

    def enqueue(self, record):
        if self.stop_event.is_set() or not isinstance(record, dict) or not self.allowed(record):
            return False
        try:
            uuid.UUID(record["client_record_id"])
            for key, maximum in (("image_base64", 400 * 1024), ("thumbnail_base64", 40 * 1024)):
                value = record[key]
                if not isinstance(value, str) or len(value) > ((maximum + 2) // 3) * 4:
                    return False
                image = base64.b64decode(value, validate=True)
                if len(image) > maximum or not image.startswith(b"\xff\xd8") or not image.endswith(b"\xff\xd9"):
                    return False
            payload = {key: record[key] for key in (
                "client_record_id", "captured_at", "policy_revision", "image_base64", "thumbnail_base64"
            )}
            with self.accept_lock:
                now = time.monotonic()
                current = self.policy_provider()
                interval = current.get("interval_seconds", 300)
                request = current.get("request") or {}
                if not isinstance(request, dict):
                    request = {}
                requested = (request.get("id") == record["client_record_id"]
                             and datetime.fromisoformat(request["expires_at"].replace("Z", "+00:00")).timestamp() > time.time())
                if not requested and self.last_accepted_at is not None and now - self.last_accepted_at < interval:
                    return False
                self.pending.put_nowait(payload)
                self.last_accepted_at = now
            return True
        except (ValueError, TypeError, KeyError, queue.Full):
            return False

    def upload(self, record):
        if not self.allowed(record) or self.stop_event.is_set():
            return False
        response = self.api_client.request(
            "POST", "/api/logs/screenshots", payload=record, timeout=15, max_retries=2,
            before_send=lambda: not self.stop_event.is_set() and self.allowed(record),
        )
        if response is not None and response.status_code in (200, 201):
            try:
                return response.json().get("accepted_client_record_id") == record["client_record_id"]
            except (ValueError, AttributeError):
                pass
        return False

    def start(self):
        def worker():
            while not self.stop_event.is_set():
                try:
                    record = self.pending.get(timeout=1)
                except queue.Empty:
                    continue
                try:
                    if self.upload(record):
                        logging.info("Screenshot delivered to parent activity history.")
                    else:
                        logging.info("Screenshot discarded: unavailable backend or expired permission.")
                except Exception as error:
                    logging.warning("Screenshot upload failed: %s", type(error).__name__)
                finally:
                    # No image file or offline SQLite record is created.
                    self.pending.task_done()
                    record = None
        threading.Thread(target=worker, daemon=True, name="ScreenshotUpload").start()

    def stop(self):
        self.stop_event.set()
        while True:
            try:
                self.pending.get_nowait()
                self.pending.task_done()
            except queue.Empty:
                return
