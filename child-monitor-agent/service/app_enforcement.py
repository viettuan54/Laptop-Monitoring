"""Policy-driven application closure. Process operations are supplied by Windows."""

import logging
import math
import threading
import time
import uuid
from datetime import datetime, timezone


APP_CATEGORIES = {"learning", "entertainment", "browsers", "unknown"}
CONFIRMED_SOURCES = {"exact_lookup", "trained_model", "gemini"}


class AppEnforcer:
    def __init__(self, processes, policy_provider, classify, schedule, event_sink,
                 clock=time.monotonic, grace_seconds=8):
        self.processes = processes
        self.policy_provider = policy_provider
        self.classify = classify
        self.schedule = schedule
        self.event_sink = event_sink
        self.clock = clock
        self.grace_seconds = grace_seconds
        self.pending = {}
        self.cooldowns = {}
        self.classification_retries = {}
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread = None

    @staticmethod
    def validate_candidates(candidates):
        if not isinstance(candidates, list) or len(candidates) > 64:
            raise ValueError("Expected at most 64 application processes")
        result = []
        for item in candidates:
            if not isinstance(item, dict):
                raise ValueError("Invalid application process")
            pid, created = item.get("pid"), item.get("created_at")
            if (type(pid) is not int or not 4 < pid <= 0xFFFFFFFF
                    or isinstance(created, bool) or not isinstance(created, (int, float))
                    or not math.isfinite(created) or created <= 0):
                raise ValueError("Invalid application identity")
            result.append((pid, float(created)))
        return list(dict.fromkeys(result))

    def _blocked(self, category):
        policy = self.policy_provider()
        return (policy.get("enable_app_classification") is True
                and category in APP_CATEGORIES
                and category in policy.get("blocked_app_categories", []))

    def check(self, candidates):
        identities = self.validate_candidates(candidates)
        with self.lock:
            self._tick()
            if self.policy_provider().get("enable_app_classification") is not True:
                return []
            now = self.clock()
            self.cooldowns = {k: v for k, v in self.cooldowns.items() if v > now}
            self.classification_retries = {
                k: v for k, v in self.classification_retries.items() if v > now
            }
            for identity in identities:
                if len(self.pending) >= 256:
                    break
                if identity in self.pending or identity in self.cooldowns:
                    continue
                target = None
                try:
                    # Inspect actual executable/token; never trust a Companion label/name.
                    target = self.processes.open(*identity)
                    if target is None:
                        continue
                    result = self.classify(target.app_name, target.product_name,
                                           target.file_description, allow_remote_fallback=False)
                    if result.get("source") not in CONFIRMED_SOURCES:
                        retry_key = (target.app_name, target.product_name, target.file_description)
                        if self.classification_retries.get(retry_key, 0) <= now:
                            self.schedule(*retry_key)
                            self.classification_retries[retry_key] = now + 30
                        continue
                    if not self._blocked(result.get("category")):
                        continue
                    self.pending[identity] = {
                        "target": target, "classification": result,
                        "client_record_id": str(uuid.uuid4()),
                        "requested_at": datetime.now(timezone.utc).isoformat(),
                        "deadline": now + self.grace_seconds, "terminating": False,
                    }
                    target = None  # Pending request owns the verified Windows handle.
                except (OSError, ValueError) as error:
                    logging.debug("Application inspection skipped: %s", type(error).__name__)
                finally:
                    if target is not None:
                        target.close()
            return [
                {"request_id": item["client_record_id"], "pid": identity[0],
                 "created_at": identity[1], "app_name": item["target"].app_name,
                 "category": item["classification"]["category"],
                 "grace_seconds": self.grace_seconds}
                for identity, item in self.pending.items()
                if identity in identities and not item["terminating"]
                and not item.get("event")
            ]

    def _finish(self, identity, item, outcome, reason):
        # Keep the same receipt in memory if SQLite is temporarily unavailable.
        if "event" not in item:
            item["event"] = {
                "client_record_id": item["client_record_id"],
                "app_name": item["target"].app_name,
                "category": item["classification"]["category"],
                "classification_source": item["classification"]["source"],
                "requested_at": item["requested_at"],
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "outcome": outcome, "reason": reason,
            }
        if self.event_sink(item["event"]):
            item["target"].close()
            self.pending.pop(identity, None)
            if outcome == "failed":
                self.cooldowns[identity] = self.clock() + 30

    def _tick(self):
        for identity, item in list(self.pending.items()):
            target = item["target"]
            try:
                if item.get("event"):
                    self._finish(identity, item, item["event"]["outcome"], item["event"]["reason"])
                elif not target.alive():
                    self._finish(identity, item, "closed",
                                 "terminated" if item["terminating"] else "graceful_exit")
                elif not target.context_valid():
                    self._finish(identity, item, "cancelled", "session_changed")
                elif not self._blocked(item["classification"]["category"]):
                    self._finish(identity, item, "cancelled", "policy_changed")
                elif self.clock() >= item["deadline"]:
                    if item["terminating"]:
                        self._finish(identity, item, "failed", "termination_timeout")
                    else:
                        # Uses the retained handle, so PID reuse cannot target another process.
                        target.terminate()
                        item["terminating"] = True
                        item["deadline"] = self.clock() + 3
            except OSError:
                self._finish(identity, item, "failed", "access_denied")

    def tick(self):
        with self.lock:
            self._tick()

    def start(self):
        self.stop_event.clear()
        def run():
            while not self.stop_event.wait(0.5):
                try:
                    self.tick()
                except Exception:
                    logging.exception("Application enforcement iteration failed")
        self.thread = threading.Thread(target=run, daemon=True, name="AppEnforcement")
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)
        with self.lock:
            for identity, item in list(self.pending.items()):
                self._finish(identity, item, "cancelled", "service_stopped")
                if identity in self.pending:
                    item["target"].close()
            self.pending.clear()
