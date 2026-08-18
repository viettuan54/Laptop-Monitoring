import os
import sqlite3
import sys
import tempfile
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from offline_queue import OfflineQueue


class FakeResponse:
    def __init__(self, accepted_ids, status_code=201):
        self.status_code = status_code
        self._accepted_ids = accepted_ids

    def __bool__(self):
        return True

    def json(self):
        return {"accepted_client_record_ids": self._accepted_ids}


class FakeApiClient:
    suspended = False

    def __init__(self, accepted_ids):
        self.accepted_ids = accepted_ids
        self.calls = []

    def post(self, endpoint, data=None, timeout=10):
        self.calls.append((endpoint, data))
        return FakeResponse(self.accepted_ids)


class FakeVisionApi:
    suspended = False

    def __init__(self, status_code=201):
        self.status_code = status_code
        self.calls = []

    def post(self, endpoint, data=None, timeout=10):
        self.calls.append((endpoint, data))
        return FakeResponse([], self.status_code)


class OfflineQueueIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "queue.db")
        self.queue = OfflineQueue(db_path=self.db_path, secure_file=False)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _synced_state(self):
        with self.queue.get_connection() as conn:
            return dict(conn.execute(
                "SELECT client_record_id, synced FROM app_logs ORDER BY client_record_id"
            ).fetchall())

    def test_only_backend_acknowledged_records_are_marked_synced(self):
        first_id, inserted = self.queue.enqueue_app_log(
            "one.exe", "2026-01-01T00:00:00Z", duration_seconds=10,
            client_record_id="record-one"
        )
        self.assertTrue(inserted)
        second_id, inserted = self.queue.enqueue_app_log(
            "two.exe", "2026-01-01T00:00:10Z", duration_seconds=10,
            client_record_id="record-two"
        )
        self.assertTrue(inserted)

        api = FakeApiClient([first_id])
        self.queue._sync_apps(api)

        self.assertEqual(self._synced_state(), {first_id: 1, second_id: 0})
        self.assertEqual(len(api.calls), 1)

    def test_missing_acknowledgement_keeps_the_local_queue_unchanged(self):
        record_id, inserted = self.queue.enqueue_app_log(
            "safe.exe", "2026-01-01T00:00:00Z", duration_seconds=10,
            client_record_id="record-safe"
        )
        self.assertTrue(inserted)

        self.queue._sync_apps(FakeApiClient([]))
        self.assertEqual(self._synced_state(), {record_id: 0})

    def test_duplicate_web_record_id_is_idempotent(self):
        record_id = "f0b43af8-7318-4d73-8a46-3d8452937f93"
        first_id, inserted = self.queue.enqueue_web_log(
            "https://www.youtube.com/watch?v=test",
            "www.youtube.com",
            "2026-01-01T00:00:00+00:00",
            duration_seconds=12,
            page_title="YouTube",
            client_record_id=record_id,
        )
        self.assertTrue(inserted)
        second_id, inserted = self.queue.enqueue_web_log(
            "https://www.youtube.com/watch?v=test",
            "www.youtube.com",
            "2026-01-01T00:00:00+00:00",
            duration_seconds=12,
            page_title="YouTube",
            client_record_id=record_id,
        )
        self.assertFalse(inserted)
        self.assertEqual(second_id, first_id)

        with self.queue.get_connection() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM web_logs WHERE client_record_id = ?",
                (record_id,),
            ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_unknown_web_rows_are_backfilled_once_with_classification_provenance(self):
        self.queue.enqueue_web_log(
            "https://www.youtube.com/watch?v=test",
            "www.youtube.com",
            "2026-01-01T00:00:00+00:00",
            duration_seconds=12,
            category="unknown",
            classification_source="disabled",
        )

        self.assertEqual(
            self.queue.get_unknown_web_domains(),
            ["www.youtube.com"],
        )
        updated = self.queue.update_unknown_web_category(
            "www.youtube.com",
            "entertainment",
            "gemini",
            None,
        )
        self.assertEqual(updated, 1)
        self.assertEqual(self.queue.get_unknown_web_domains(), [])
        with self.queue.get_connection() as connection:
            row = connection.execute(
                """SELECT category, classification_source, classification_confidence
                   FROM web_logs"""
            ).fetchone()
        self.assertEqual(row, ("entertainment", "gemini", None))

    def test_existing_known_web_rows_are_marked_as_legacy_during_schema_upgrade(self):
        legacy_path = os.path.join(self.temp_dir.name, "legacy-queue.db")
        connection = sqlite3.connect(legacy_path)
        try:
            connection.execute(
                """CREATE TABLE web_logs (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       client_record_id TEXT UNIQUE,
                       url TEXT NOT NULL,
                       domain TEXT,
                       category TEXT DEFAULT 'unknown',
                       visit_time TEXT NOT NULL,
                       duration_seconds INTEGER,
                       page_title TEXT,
                       synced INTEGER DEFAULT 0
                   )"""
            )
            connection.execute(
                """INSERT INTO web_logs(
                       client_record_id, url, domain, category, visit_time
                   ) VALUES (?, ?, ?, ?, ?)""",
                (
                    "legacy-known",
                    "https://school.example/",
                    "school.example",
                    "education",
                    "2026-01-01T00:00:00+00:00",
                ),
            )
            connection.commit()
        finally:
            connection.close()
        upgraded = OfflineQueue(db_path=legacy_path, secure_file=False)
        with upgraded.get_connection() as connection:
            row = connection.execute(
                """SELECT category, classification_source
                   FROM web_logs WHERE client_record_id = 'legacy-known'"""
            ).fetchone()
        self.assertEqual(row, ("education", "legacy_agent"))

    def test_vision_alert_is_queued_and_synced_without_images(self):
        record_id, inserted = self.queue.enqueue_vision_alert(
            "posture_warning",
            "Góc cổ 31.0°.",
        )
        self.assertTrue(inserted)

        api = FakeVisionApi()
        self.queue._sync_vision_alerts(api)
        with self.queue.get_connection() as conn:
            row = conn.execute(
                "SELECT alert_type, message, synced FROM vision_alerts WHERE client_record_id = ?",
                (record_id,),
            ).fetchone()

        self.assertEqual(row, ("posture_warning", "Góc cổ 31.0°.", 1))
        self.assertEqual(api.calls[0][0], "/api/agent/vision-alert")
        self.assertNotIn("image", api.calls[0][1])

    def test_duplicate_vision_alert_is_suppressed_locally(self):
        first_id, inserted = self.queue.enqueue_vision_alert(
            "eye_distance_warning",
            "Khoảng cách mắt 30 cm.",
        )
        self.assertTrue(inserted)
        second_id, inserted = self.queue.enqueue_vision_alert(
            "eye_distance_warning",
            "Khoảng cách mắt 29 cm.",
        )
        self.assertFalse(inserted)
        self.assertEqual(second_id, first_id)

        with self.queue.get_connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM vision_alerts").fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
