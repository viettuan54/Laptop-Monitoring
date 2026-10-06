"""Local acceptance-test worker using the real Windows Agent queue and HTTP client.

Fixture credentials and text arrive over stdin, never command arguments/output.
This worker only permits loopback test servers and a temporary SQLite queue.
"""

from __future__ import annotations

import json
import logging
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


AGENT_ROOT = Path(__file__).resolve().parents[2] / "child-monitor-agent"
sys.path[:0] = [str(AGENT_ROOT / "service"), str(AGENT_ROOT)]
from api_client import APIClient
from offline_queue import OfflineQueue

logging.getLogger().setLevel(logging.CRITICAL)


def emit(value):
    print(json.dumps(value), flush=True)


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
        queue.set_text_policy_provider(lambda: {"enabled": True, "issued_at": now,
            "expires_at": now + 180, "enabled_since": now - 10})
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
