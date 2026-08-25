import os
import sqlite3
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone

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

    def test_atomic_app_record_splits_duration_at_local_midnight(self):
        record_id = str(uuid.uuid4())
        persisted_id, inserted = self.queue.record_app_usage(
            "browser.exe",
            "2026-08-18T23:59:50+07:00",
            "2026-08-19T00:00:20+07:00",
            30,
            client_record_id=record_id,
        )

        self.assertTrue(inserted)
        self.assertEqual(persisted_id, record_id)
        self.assertEqual(self.queue.get_daily_usage("2026-08-18"), 10)
        self.assertEqual(self.queue.get_daily_usage("2026-08-19"), 20)

    def test_delayed_app_record_stays_on_its_captured_date(self):
        self.queue.record_app_usage(
            "lesson.exe",
            "2026-01-10T18:00:00+07:00",
            "2026-01-10T18:00:30+07:00",
            30,
            client_record_id=str(uuid.uuid4()),
        )

        self.assertEqual(self.queue.get_daily_usage("2026-01-10"), 30)
        self.assertEqual(self.queue.get_daily_usage("2026-01-11"), 0)

    def test_duplicate_app_record_does_not_double_count_daily_usage(self):
        record_id = str(uuid.uuid4())
        payload = {
            "app_name": "school.exe",
            "start_time": "2026-08-19T08:00:00+07:00",
            "end_time": "2026-08-19T08:00:30+07:00",
            "duration_seconds": 30,
            "client_record_id": record_id,
        }

        _, first_inserted = self.queue.record_app_usage(**payload)
        _, second_inserted = self.queue.record_app_usage(**payload)

        self.assertTrue(first_inserted)
        self.assertFalse(second_inserted)
        self.assertEqual(self.queue.get_daily_usage("2026-08-19"), 30)

    def test_unknown_app_rows_are_backfilled_with_metadata_and_provenance(self):
        record_id = str(uuid.uuid4())
        self.queue.record_app_usage(
            "study.exe",
            "2026-08-19T08:00:00+07:00",
            "2026-08-19T08:00:30+07:00",
            30,
            product_name="Study Classroom",
            file_description="Learning utility",
            classification_source="pending",
            client_record_id=record_id,
        )

        unknown = self.queue.get_unknown_apps()
        self.assertEqual(unknown, [{
            "app_name": "study.exe",
            "product_name": "Study Classroom",
            "file_description": "Learning utility",
        }])
        updated = self.queue.update_unknown_app_category(
            "study.exe", "learning", "trained_model", 0.91
        )
        self.assertEqual(updated, 1)
        self.assertEqual(self.queue.get_unknown_apps(), [])
        with self.queue.get_connection() as connection:
            row = connection.execute(
                """SELECT category, classification_source, classification_confidence
                   FROM app_logs WHERE client_record_id = ?""",
                (record_id,),
            ).fetchone()
        self.assertEqual(row[0], "learning")
        self.assertEqual(row[1], "trained_model")
        self.assertAlmostEqual(row[2], 0.91)

    def test_rebuild_recent_usage_removes_overnight_and_lock_screen_corruption(self):
        local_tz = datetime.now().astimezone().tzinfo
        today = datetime.now().date()
        valid_start = datetime.combine(
            today,
            datetime.min.time(),
            tzinfo=local_tz,
        ) + timedelta(hours=8)

        with self.queue.get_connection() as connection:
            rows = [
                (
                    str(uuid.uuid4()),
                    "school.exe",
                    valid_start.isoformat(),
                    (valid_start + timedelta(seconds=30)).isoformat(),
                    30,
                ),
                (
                    str(uuid.uuid4()),
                    "browser.exe",
                    valid_start.isoformat(),
                    (valid_start + timedelta(hours=8)).isoformat(),
                    8 * 60 * 60,
                ),
                (
                    str(uuid.uuid4()),
                    "LockApp.exe",
                    (valid_start + timedelta(minutes=1)).isoformat(),
                    (valid_start + timedelta(minutes=1, seconds=30)).isoformat(),
                    30,
                ),
            ]
            connection.executemany(
                """INSERT INTO app_logs(
                       client_record_id, app_name, category, start_time, end_time,
                       duration_seconds, synced
                   ) VALUES (?, ?, 'unknown', ?, ?, ?, 0)""",
                rows,
            )
            connection.execute(
                "INSERT OR REPLACE INTO daily_usage(date, seconds_used) VALUES(?, ?)",
                (today.isoformat(), 99999),
            )
            connection.commit()

        repaired, skipped = self.queue.rebuild_recent_daily_usage(days=2)

        self.assertEqual(repaired, 1)
        self.assertEqual(skipped, 2)
        self.assertEqual(self.queue.get_daily_usage(today.isoformat()), 30)
        with self.queue.get_connection() as connection:
            sync_states = dict(connection.execute(
                "SELECT app_name, synced FROM app_logs"
            ).fetchall())
        self.assertEqual(sync_states["school.exe"], 0)
        self.assertEqual(sync_states["browser.exe"], 1)
        self.assertEqual(sync_states["LockApp.exe"], 1)

    def test_schema_upgrade_repairs_recent_usage_once(self):
        legacy_path = os.path.join(self.temp_dir.name, "legacy-usage.db")
        local_tz = datetime.now().astimezone().tzinfo
        today = datetime.now().date()
        start = datetime.combine(today, datetime.min.time(), tzinfo=local_tz)
        connection = sqlite3.connect(legacy_path)
        try:
            connection.execute(
                """CREATE TABLE app_logs (
                       client_record_id TEXT PRIMARY KEY,
                       app_name TEXT NOT NULL,
                       category TEXT DEFAULT 'unknown',
                       start_time TEXT NOT NULL,
                       end_time TEXT,
                       duration_seconds INTEGER,
                       synced INTEGER DEFAULT 0
                   )"""
            )
            connection.execute(
                """CREATE TABLE daily_usage (
                       date TEXT PRIMARY KEY,
                       seconds_used INTEGER DEFAULT 0
                   )"""
            )
            connection.executemany(
                """INSERT INTO app_logs(
                       client_record_id, app_name, start_time, end_time,
                       duration_seconds, synced
                   ) VALUES (?, ?, ?, ?, ?, 0)""",
                [
                    (
                        str(uuid.uuid4()),
                        "school.exe",
                        start.isoformat(),
                        (start + timedelta(seconds=30)).isoformat(),
                        30,
                    ),
                    (
                        str(uuid.uuid4()),
                        "LogonUI.exe",
                        (start + timedelta(minutes=1)).isoformat(),
                        (start + timedelta(minutes=1, seconds=30)).isoformat(),
                        30,
                    ),
                ],
            )
            connection.execute(
                "INSERT INTO daily_usage(date, seconds_used) VALUES(?, 50000)",
                (today.isoformat(),),
            )
            connection.commit()
        finally:
            connection.close()

        upgraded = OfflineQueue(db_path=legacy_path, secure_file=False)

        self.assertEqual(upgraded.get_daily_usage(today.isoformat()), 30)
        with upgraded.get_connection() as connection:
            version = connection.execute(
                """SELECT value FROM agent_metadata
                   WHERE key = 'usage_accounting_version'"""
            ).fetchone()[0]
            logon_synced = connection.execute(
                "SELECT synced FROM app_logs WHERE app_name = 'LogonUI.exe'"
            ).fetchone()[0]
        self.assertEqual(version, "2")
        self.assertEqual(logon_synced, 1)

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

    def test_app_sync_includes_classifier_inputs_and_provenance(self):
        record_id, inserted = self.queue.enqueue_app_log(
            "study.exe",
            "2026-01-01T00:00:00Z",
            duration_seconds=10,
            category="learning",
            product_name="Study Classroom",
            file_description="Learning utility",
            classification_source="trained_model",
            classification_confidence=0.93,
            client_record_id="classified-app",
        )
        self.assertTrue(inserted)
        api = FakeApiClient([record_id])

        self.queue._sync_apps(api)

        record = api.calls[0][1]["records"][0]
        self.assertEqual(record["product_name"], "Study Classroom")
        self.assertEqual(record["classification_source"], "trained_model")
        self.assertAlmostEqual(record["classification_confidence"], 0.93)

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

    def test_text_moderation_raw_content_is_deleted_after_backend_acknowledgement(self):
        record_id = str(uuid.uuid4())
        persisted_id, inserted = self.queue.enqueue_text_moderation(
            client_record_id=record_id,
            source_type="search_query",
            content_text="mình cần được giúp đỡ",
            occurred_at="2026-08-25T12:00:00+07:00",
            domain="www.google.com",
        )
        self.assertTrue(inserted)
        self.assertEqual(persisted_id, record_id)

        api = FakeApiClient([record_id])
        self.queue._sync_text_moderation(api)

        with self.queue.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM text_moderation_queue"
            ).fetchone()[0]
        self.assertEqual(count, 0)
        self.assertEqual(api.calls[0][0], "/api/agent/text-moderation/batch")
        self.assertEqual(
            api.calls[0][1]["records"][0]["text"],
            "mình cần được giúp đỡ",
        )

    def test_text_moderation_raw_content_is_retained_for_retry_on_provider_failure(self):
        record_id = str(uuid.uuid4())
        self.queue.enqueue_text_moderation(
            client_record_id=record_id,
            source_type="search_query",
            content_text="retry me",
            occurred_at="2026-08-25T12:00:00+07:00",
            domain="www.google.com",
        )

        self.queue._sync_text_moderation(FakeVisionApi(status_code=502))

        with self.queue.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM text_moderation_queue"
            ).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
