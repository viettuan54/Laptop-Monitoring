import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

SERVICE_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import enforcement_core
import offline_queue
from enforcement_core import EnforcementCore
from offline_queue import OfflineQueue


def clock_at(instant, windows_offset):
    """Emulate Windows local time while honoring explicitly requested zones."""
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return instant.astimezone(tz)
            return instant.astimezone(timezone(timedelta(hours=windows_offset))).replace(tzinfo=None)
    return Clock


class PolicyTimezoneTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.db_path = os.path.join(self.temp_dir.name, "queue.db")
        self.queue = OfflineQueue(db_path=self.db_path, secure_file=False)
        self.core = EnforcementCore(self.queue, config_dir=self.temp_dir.name)
        self.core.update_hosts_file = Mock()

    def test_allowed_hours_use_vietnam_time_on_every_windows_timezone(self):
        self.core.save_settings_cache({
            "allowed_start_time": "07:00:00", "allowed_end_time": "21:00:00",
            "daily_limit_minutes": 120, "is_locked": False,
        })
        for windows_offset in (-8, 0, 7, 14):
            for utc_hour, second, should_lock in ((3, 0, False), (0, 0, False),
                                                 (14, 0, False), (14, 1, True), (23, 0, True)):
                with self.subTest(offset=windows_offset, utc_hour=utc_hour, second=second):
                    clock = clock_at(datetime(2026, 11, 26, utc_hour, 0, second, tzinfo=timezone.utc), windows_offset)
                    with patch.object(enforcement_core, "datetime", clock), patch.object(offline_queue, "datetime", clock):
                        self.assertEqual(self.core.check_policy_status()[0], should_lock)

    def test_overnight_window_and_quota_roll_over_at_vietnam_midnight(self):
        self.core.save_settings_cache({
            "allowed_start_time": "22:00:00", "allowed_end_time": "06:00:00",
            "daily_limit_minutes": 1, "is_locked": False,
        })
        self.queue.add_daily_usage(60, "2026-12-31")
        self.queue.add_daily_usage(20, "2027-01-01")
        for windows_offset in (-8, 0, 7, 14):
            for instant, expected in (
                (datetime(2026, 12, 31, 16, 59, 59, tzinfo=timezone.utc),
                 (True, "Daily limit of 1 minutes has been exceeded.", 0)),
                (datetime(2026, 12, 31, 17, 0, 0, tzinfo=timezone.utc), (False, "OK", 40)),
                (datetime(2026, 12, 31, 23, 0, 0, tzinfo=timezone.utc), (False, "OK", 40)),
            ):
                with self.subTest(offset=windows_offset, instant=instant):
                    clock = clock_at(instant, windows_offset)
                    with patch.object(enforcement_core, "datetime", clock), patch.object(offline_queue, "datetime", clock):
                        self.assertEqual(self.core.check_policy_status(), expected)

    def test_quota_read_uses_the_same_day_as_the_schedule_check(self):
        self.core.save_settings_cache({
            "allowed_start_time": "22:00:00", "allowed_end_time": "06:00:00",
            "daily_limit_minutes": 1,
        })
        # If midnight passes between the schedule check and SQLite read, both
        # decisions must still use the instant captured by check_policy_status.
        self.queue.add_daily_usage(60, "2026-12-31")
        before = clock_at(datetime(2026, 12, 31, 16, 59, 59, tzinfo=timezone.utc), 0)
        after = clock_at(datetime(2026, 12, 31, 17, 0, 0, tzinfo=timezone.utc), 0)
        with patch.object(enforcement_core, "datetime", before), patch.object(offline_queue, "datetime", after):
            self.assertEqual(self.core.check_policy_status(),
                             (True, "Daily limit of 1 minutes has been exceeded.", 0))

    def test_default_counter_date_is_vietnam_date(self):
        instant = datetime(2026, 12, 31, 17, 0, 0, tzinfo=timezone.utc)
        for windows_offset in (-8, 0, 7, 14):
            with self.subTest(offset=windows_offset):
                with self.queue.get_connection() as conn:
                    conn.execute("DELETE FROM daily_usage")
                with patch.object(offline_queue, "datetime", clock_at(instant, windows_offset)):
                    self.queue.add_daily_usage(30)
                    self.assertEqual(self.queue.get_daily_usage(), 30)
                self.assertEqual(self.queue.get_daily_usage("2027-01-01"), 30)
                self.assertEqual(self.queue.get_daily_usage("2026-12-31"), 0)

    def test_segments_with_any_offset_split_at_vietnam_midnight_and_survive_restart(self):
        start = datetime(2026, 12, 31, 16, 59, 50, tzinfo=timezone.utc)
        end = start + timedelta(seconds=30)
        for offset in (-8, 0, 7, 14):
            with self.subTest(offset=offset):
                with self.queue.get_connection() as conn:
                    conn.execute("DELETE FROM daily_usage")
                    conn.execute("DELETE FROM app_logs")
                zone = timezone(timedelta(hours=offset))
                self.queue.record_app_usage("study.exe", start.astimezone(zone).isoformat(),
                                            end.astimezone(zone).isoformat(), 30)
                restarted = OfflineQueue(db_path=self.db_path, secure_file=False)
                self.assertEqual(restarted.get_daily_usage("2026-12-31"), 10)
                self.assertEqual(restarted.get_daily_usage("2027-01-01"), 20)

    def test_windows_midnight_does_not_split_a_single_vietnam_day(self):
        self.queue.record_app_usage("study.exe", "2026-12-31T23:59:50Z", "2027-01-01T00:00:20Z", 30)
        self.assertEqual(self.queue.get_daily_usage("2026-12-31"), 0)
        self.assertEqual(self.queue.get_daily_usage("2027-01-01"), 30)

    def test_upgrade_rebuilds_version_two_counters_once_from_synced_and_pending_logs(self):
        with self.queue.get_connection() as conn:
            conn.execute("UPDATE agent_metadata SET value = '2' WHERE key = 'usage_accounting_version'")
            conn.execute("INSERT INTO daily_usage(date, seconds_used) VALUES ('2026-12-31', 9999)")
            conn.execute("INSERT INTO daily_usage(date, seconds_used) VALUES ('2027-01-02', 30)")
            conn.executemany(
                """INSERT INTO app_logs(client_record_id, app_name, start_time, end_time, duration_seconds, synced)
                   VALUES (?, 'study.exe', ?, ?, 30, ?)""",
                [("synced", "2026-12-31T16:59:50Z", "2026-12-31T17:00:20Z", 1),
                 ("pending", "2026-12-31T18:00:00Z", "2026-12-31T18:00:30Z", 0),
                 ("ahead", "2027-01-02T00:00:00+14:00", "2027-01-02T00:00:30+14:00", 0)],
            )
        clock = clock_at(datetime(2027, 1, 1, 13, 0, tzinfo=timezone.utc), 14)
        with patch.object(offline_queue, "datetime", clock):
            upgraded = OfflineQueue(db_path=self.db_path, secure_file=False)
            self.assertEqual(upgraded.get_daily_usage("2026-12-31"), 10)
            self.assertEqual(upgraded.get_daily_usage(), 80)
            self.assertEqual(upgraded.get_daily_usage("2027-01-02"), 0)
            with upgraded.get_connection() as conn:
                self.assertEqual(conn.execute(
                    "SELECT value FROM agent_metadata WHERE key = 'usage_accounting_version'"
                ).fetchone()[0], "3")
                self.assertEqual(dict(conn.execute("SELECT client_record_id, synced FROM app_logs")),
                                 {"synced": 1, "pending": 0, "ahead": 0})
            with patch.object(OfflineQueue, "_rebuild_recent_daily_usage", side_effect=AssertionError("Rebuilt twice")):
                restarted = OfflineQueue(db_path=self.db_path, secure_file=False)
                self.assertEqual(restarted.get_daily_usage(), 80)


if __name__ == "__main__":
    unittest.main()
