import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch


AGENT_ROOT = Path(__file__).resolve().parent.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


companion_web_tracker = load_module(
    "companion_web_tracker",
    AGENT_ROOT / "companion" / "web_tracker.py",
)
service_pipe_server = load_module(
    "service_pipe_server",
    AGENT_ROOT / "service" / "pipe_server.py",
)

WebTracker = companion_web_tracker.WebTracker
PipeServer = service_pipe_server.PipeServer


class FakePipeClient:
    def __init__(self, acknowledge=True):
        self.acknowledge = acknowledge
        self.calls = []

    def send_web_tracking(self, **record):
        self.calls.append(record)
        if not self.acknowledge:
            return None
        return {"tracking_ack": record["client_record_id"]}


class FakeQueue:
    def __init__(self):
        self.web_calls = []

    def enqueue_web_log(self, **record):
        self.web_calls.append(record)
        return record["client_record_id"], True


class FakeEnforcementCore:
    @staticmethod
    def check_policy_status():
        return False, "OK", 3600

    @staticmethod
    def load_cached_settings():
        return {}

    @staticmethod
    def remember_web_classification(domain, category, classification_source=None):
        return False


class WebTrackingTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.local_app_data = self.root / "LocalAppData"
        self.state_dir = self.root / "State"
        self.history_path = (
            self.local_app_data
            / "Microsoft"
            / "Edge"
            / "User Data"
            / "Default"
            / "History"
        )
        self.history_path.parent.mkdir(parents=True)
        connection = sqlite3.connect(self.history_path)
        try:
            connection.execute(
                "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)"
            )
            connection.execute(
                """CREATE TABLE visits (
                       id INTEGER PRIMARY KEY,
                       url INTEGER,
                       visit_time INTEGER,
                       visit_duration INTEGER
                   )"""
            )
            connection.commit()
        finally:
            connection.close()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def _insert_visit(self, url="https://www.youtube.com/watch?v=test"):
        visit_time = WebTracker.current_chrome_time()
        connection = sqlite3.connect(self.history_path)
        try:
            connection.execute(
                "INSERT INTO urls(id, url, title) VALUES(1, ?, ?)",
                (url, "YouTube"),
            )
            connection.execute(
                """INSERT INTO visits(id, url, visit_time, visit_duration)
                   VALUES(1, 1, ?, ?)""",
                (visit_time, 12_000_000),
            )
            connection.commit()
        finally:
            connection.close()
        return visit_time

    def _tracker(self, pipe_client):
        tracker = WebTracker(
            pipe_client,
            local_app_data=str(self.local_app_data),
            state_dir=str(self.state_dir),
            scan_interval_seconds=1,
        )
        tracker.checkpoints["edge:Default"] = {"visit_time": 0, "visit_id": 0}
        tracker.save_checkpoints()
        return tracker

    def test_reads_edge_history_from_interactive_user_local_app_data(self):
        visit_time = self._insert_visit()
        pipe_client = FakePipeClient()
        tracker = self._tracker(pipe_client)

        tracker.poll(force=True)

        self.assertEqual(len(pipe_client.calls), 1)
        record = pipe_client.calls[0]
        self.assertEqual(record["domain"], "www.youtube.com")
        self.assertEqual(record["page_title"], "YouTube")
        self.assertEqual(record["duration_seconds"], 12)
        self.assertEqual(
            tracker.checkpoints["edge:Default"],
            {"visit_time": visit_time, "visit_id": 1},
        )
        with open(tracker.status_path, "r", encoding="utf-8") as stream:
            status = json.load(stream)
        self.assertEqual(status["agent_version"], "1.0.13")
        self.assertEqual(status["records_discovered"], 1)
        self.assertEqual(status["records_forwarded"], 1)

    def test_discovers_coccoc_history_profiles(self):
        coccoc_history = (
            self.local_app_data
            / "CocCoc"
            / "Browser"
            / "User Data"
            / "Default"
            / "History"
        )
        coccoc_history.parent.mkdir(parents=True)
        coccoc_history.touch()
        tracker = self._tracker(FakePipeClient())

        browser_paths = dict(tracker.get_browser_user_data_paths())
        self.assertEqual(
            browser_paths["coccoc"],
            str(coccoc_history.parent.parent),
        )
        self.assertEqual(
            tracker.get_profiles_for_browser(browser_paths["coccoc"]),
            [("Default", str(coccoc_history))],
        )

    def test_snapshot_fallback_copies_wal_family_when_backup_is_unavailable(self):
        pipe_client = FakePipeClient()
        tracker = self._tracker(pipe_client)
        wal_path = Path(str(self.history_path) + "-wal")
        shm_path = Path(str(self.history_path) + "-shm")
        wal_path.write_bytes(b"recent-wal")
        shm_path.write_bytes(b"shared-memory")
        snapshot_path = self.root / "snapshot.sqlite"
        original_connect = companion_web_tracker.sqlite3.connect

        class BrokenBackupConnection:
            @staticmethod
            def backup(_destination, **_kwargs):
                raise TimeoutError("simulated busy browser database")

            @staticmethod
            def close():
                pass

        def connect(path, *args, **kwargs):
            if kwargs.get("uri"):
                return BrokenBackupConnection()
            return original_connect(path, *args, **kwargs)

        with patch.object(companion_web_tracker.sqlite3, "connect", side_effect=connect):
            created = tracker._create_history_snapshot(
                str(self.history_path), str(snapshot_path)
            )

        self.assertTrue(created)
        self.assertTrue(snapshot_path.is_file())
        self.assertEqual(Path(str(snapshot_path) + "-wal").read_bytes(), b"recent-wal")
        self.assertEqual(Path(str(snapshot_path) + "-shm").read_bytes(), b"shared-memory")

    def test_retry_reuses_id_and_does_not_advance_without_service_ack(self):
        self._insert_visit()
        pipe_client = FakePipeClient(acknowledge=False)
        tracker = self._tracker(pipe_client)

        tracker.poll(force=True)
        first_record_id = pipe_client.calls[0]["client_record_id"]
        self.assertEqual(
            tracker.checkpoints["edge:Default"],
            {"visit_time": 0, "visit_id": 0},
        )

        pipe_client.acknowledge = True
        tracker.poll(force=True)
        self.assertEqual(
            pipe_client.calls[1]["client_record_id"], first_record_id
        )

    def test_service_validates_and_acknowledges_track_web(self):
        queue = FakeQueue()
        server = PipeServer(queue, FakeEnforcementCore())
        record_id = str(uuid.uuid4())
        message = json.dumps({
            "action": "TRACK_WEB",
            "url": "https://www.youtube.com/watch?v=test",
            "domain": "www.youtube.com",
            "visit_time": datetime.now(timezone.utc).isoformat(),
            "duration_seconds": 12,
            "page_title": "YouTube",
            "client_record_id": record_id,
        })

        with patch.object(service_pipe_server.win32file, "WriteFile") as write_file:
            server._process_client_message(message, 123)

        self.assertEqual(len(queue.web_calls), 1)
        self.assertEqual(queue.web_calls[0]["client_record_id"], record_id)
        response = json.loads(write_file.call_args.args[1].decode("utf-8"))
        self.assertEqual(response["tracking_ack"], record_id)

    def test_service_persists_a_blocked_https_attempt_from_loopback_sink(self):
        queue = FakeQueue()
        enforcement = Mock()
        enforcement.get_web_domain_policy.return_value = {
            "domain": "gamevui.vn",
            "category": "entertainment",
            "blocked": True,
        }
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True,
        }
        enforcement.remember_web_classification.return_value = True
        server = PipeServer(queue, enforcement)

        recorded = server.record_blocked_web_attempt("www.gamevui.vn", "https")

        self.assertTrue(recorded)
        self.assertEqual(len(queue.web_calls), 1)
        record = queue.web_calls[0]
        self.assertEqual(record["url"], "https://gamevui.vn/")
        self.assertEqual(record["domain"], "gamevui.vn")
        self.assertEqual(record["page_title"], "Truy cập bị Agent chặn")
        self.assertEqual(record["category"], "entertainment")
        self.assertEqual(record["classification_source"], "legacy_agent")
        self.assertEqual(record["duration_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
