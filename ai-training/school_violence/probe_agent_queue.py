"""Local acceptance-test worker using the real Windows Agent queue and HTTP client.

Fixture credentials and text arrive over stdin, never command arguments/output.
This worker only permits loopback test servers and a temporary SQLite queue.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse
from unittest.mock import patch


AGENT_ROOT = Path(__file__).resolve().parents[2] / "child-monitor-agent"
sys.path[:0] = [str(AGENT_ROOT / "service"), str(AGENT_ROOT)]
from api_client import APIClient
from offline_queue import OfflineQueue
from companion.web_tracker import WebTracker
import pipe_server

logging.getLogger().setLevel(logging.CRITICAL)


def emit(value):
    print(json.dumps(value), flush=True)


def collect_from_fixture_history(directory, queue, policy, fixtures):
    """Exercise real collector + service handler using only temporary history.

    Named-pipe I/O is an in-process adapter; no installed service is contacted.
    """
    local = Path(directory) / "LocalAppData"
    history = local / "Microsoft/Edge/User Data/Default/History"
    history.parent.mkdir(parents=True)
    with closing(sqlite3.connect(history)) as connection, connection:
        connection.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)")
        connection.execute("CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, visit_duration INTEGER)")
        for index, fixture in enumerate(fixtures, 1):
            url = "https://www.google.com/search?" + urlencode({"q": fixture["text"]})
            connection.execute("INSERT INTO urls VALUES (?, ?, ?)", (index, url, fixture["text"]))
            connection.execute("INSERT INTO visits VALUES (?, ?, ?, ?)",
                (index, index, WebTracker.current_chrome_time(), 1_000_000))

    class Enforcement:
        def get_text_moderation_policy(self): return policy
        def check_policy_status(self): return False, "OK", 3600
        def load_cached_settings(self): return {}
        def remember_web_classification(self, *args, **kwargs): return False

    service = pipe_server.PipeServer(queue, Enforcement())
    captured = []

    class PipeAdapter:
        def send_ping(self): return {"text_moderation_config": policy}
        def send_web_tracking(self, **record):
            assert "?" not in record["url"]
            assert all(item["text"] not in record["page_title"] for item in fixtures)
            with patch.object(pipe_server.win32file, "WriteFile") as write:
                service._process_client_message(json.dumps({"action": "TRACK_WEB", **record}), 123)
                response = json.loads(write.call_args.args[1].decode("utf-8"))
            assert response.get("tracking_ack") == record["client_record_id"]
            captured.append(record["text_record"])
            return response

    tracker = WebTracker(PipeAdapter(), local_app_data=str(local),
        state_dir=str(Path(directory) / "collector-state"), scan_interval_seconds=1)
    tracker.checkpoints["edge:Default"] = {"visit_time": 0, "visit_id": 0}
    tracker.poll(force=True)
    assert [row["text"] for row in captured] == [row["text"] for row in fixtures]
    tracker.poll(force=True)
    assert len(captured) == len(fixtures), "Checkpoint must prevent duplicate collection"
    return captured


def main():
    initial = json.loads(sys.stdin.readline())
    parsed = urlparse(initial["base_url"])
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
        raise ValueError("Only loopback acceptance servers are permitted")
    with tempfile.TemporaryDirectory(prefix="query-agent-acceptance-") as directory:
        client = APIClient.__new__(APIClient)
        client.server_url = initial["base_url"]
        client.device_secret = initial["device_secret"]
        client.suspended = False
        client.config_path = str(Path(directory) / "absent_config.json")
        client.last_config_mtime = 0
        queue = OfflineQueue(str(Path(directory) / "queue.db"), secure_file=False)
        now = time.time()
        policy = {"enabled": True, "issued_at": now,
            "expires_at": now + 180, "enabled_since": now - 10}
        queue.set_text_policy_provider(lambda: policy)
        original_request = client.request
        responses = []

        def request(*args, **kwargs):
            kwargs["max_retries"] = 1
            result = original_request(*args, **kwargs)
            responses.append(result.status_code if result is not None else None)
            return result

        client.request = request
        records = []
        emit({"ready": True})
        for line in sys.stdin:
            command = json.loads(line)
            action = command["command"]
            if action == "close":
                break
            responses.clear()
            if action == "enqueue":
                records = []
                for record in command["records"]:
                    row = record | {"occurred_at": datetime.now(timezone.utc).isoformat(),
                                    "source_type": "search_query", "domain": "search.example.test"}
                    _, inserted = queue.enqueue_text_moderation(row["client_record_id"],
                        row["source_type"], row["text"], row["occurred_at"], row["domain"])
                    assert inserted
                    records.append(row)
            elif action == "collect":
                records = collect_from_fixture_history(directory, queue, policy, command["records"])
            elif action == "offline_sync":
                # Closed loopback endpoint exercises Agent-to-backend transport failure.
                target = urlparse(command["base_url"])
                assert target.scheme == "http" and target.hostname == "127.0.0.1"
                original_url = client.server_url
                try:
                    client.server_url = command["base_url"]
                    queue._sync_text_moderation(client)
                finally:
                    client.server_url = original_url
            elif action == "restart_queue":
                # Startup has no validated consent: the existing Agent discards pending text.
                queue = OfflineQueue(str(Path(directory) / "queue.db"), secure_file=False)
                queue.set_text_policy_provider(lambda: policy)
            elif action == "local_policy":
                now = time.time()
                policy = ({"enabled": True, "issued_at": now, "expires_at": now + 180,
                           "enabled_since": now} if command["enabled"] else {"enabled": False})
                queue.refresh_text_policy()
            elif action == "sync":
                queue._sync_text_moderation(client)
            elif action == "resend":
                result = client.post_text_moderation(records, lambda: True)
                assert result is not None
                emit({"status": result.status_code, "response": result.json()})
                continue
            elif action == "credential":
                client.device_secret = command["device_secret"]
                client.suspended = False
            else:
                raise ValueError("Unknown acceptance command")
            with queue.get_connection() as connection:
                values = [row[0] for row in connection.execute(
                    "SELECT content_text FROM text_moderation_queue").fetchall()]
            emit({"queued": len(values), "all_dpapi_protected": all(
                value.startswith("dpapi:v1:") for value in values),
                "statuses": responses, "suspended": client.suspended})


if __name__ == "__main__":
    main()
