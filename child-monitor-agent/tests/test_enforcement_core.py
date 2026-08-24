import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import enforcement_core
from enforcement_core import EnforcementCore


class FakeQueue:
    def get_daily_usage(self):
        return 0


class EnforcementCoreTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.core = EnforcementCore(FakeQueue(), config_dir=self.temp_dir.name)
        self.core.hosts_path = os.path.join(self.temp_dir.name, "hosts")
        with open(self.core.hosts_path, "w", encoding="utf-8") as hosts_file:
            hosts_file.write("127.0.0.1 localhost\n")
        self.core.update_hosts_file = lambda domains: None

    def tearDown(self):
        self.temp_dir.cleanup()

    def _save_overnight_settings(self):
        self.core.save_settings_cache({
            "allowed_start_time": "22:00:00",
            "allowed_end_time": "06:00:00",
            "daily_limit_minutes": 120,
            "is_locked": False,
        }, [])

    def test_overnight_window_allows_time_after_start(self):
        self._save_overnight_settings()

        class FakeDateTime(enforcement_core.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 7, 24, 23, 30, 0)

        with patch.object(enforcement_core, "datetime", FakeDateTime):
            should_lock, _, _ = self.core.check_policy_status()

        self.assertFalse(should_lock)

    def test_overnight_window_rejects_midday(self):
        self._save_overnight_settings()

        class FakeDateTime(enforcement_core.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 7, 24, 12, 0, 0)

        with patch.object(enforcement_core, "datetime", FakeDateTime):
            should_lock, _, _ = self.core.check_policy_status()

        self.assertTrue(should_lock)

    def test_classified_domain_is_blocked_and_unblocked_by_dashboard_policy(self):
        self.core.update_hosts_file = Mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["entertainment", "unsafe"],
        }, ["admin-blocked.test"])
        self.core.update_hosts_file.reset_mock()

        blocked = self.core.remember_web_classification(
            "www.gamevui.vn",
            "entertainment",
        )

        self.assertTrue(blocked)
        self.core.update_hosts_file.assert_called_once_with([
            "admin-blocked.test",
            "gamevui.vn",
        ])

        self.core.update_hosts_file.reset_mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["unsafe"],
        })
        self.core.update_hosts_file.assert_called_once_with(["admin-blocked.test"])

    def test_unblocked_classification_is_cached_without_rewriting_hosts(self):
        self.core.update_hosts_file = Mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["entertainment"],
        }, [])
        self.core.update_hosts_file.reset_mock()

        blocked = self.core.remember_web_classification(
            "school.example",
            "education",
        )

        self.assertFalse(blocked)
        self.core.update_hosts_file.assert_not_called()
        self.assertEqual(
            self.core.load_web_classification_cache()["school.example"],
            "education",
        )

    def test_cached_classification_is_applied_after_service_restart(self):
        self.core.update_hosts_file = Mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["social"],
        }, [])
        self.core.remember_web_classification("social.example", "social")

        restarted = EnforcementCore(FakeQueue(), config_dir=self.temp_dir.name)
        restarted.update_hosts_file = Mock()

        domains = restarted.apply_cached_web_policy()

        self.assertEqual(domains, ["social.example"])
        restarted.update_hosts_file.assert_called_once_with(["social.example"])

    def test_previously_classified_backend_domain_is_applied_from_heartbeat(self):
        self.core.update_hosts_file = Mock()

        self.core.save_settings_cache(
            {
                "enable_web_classification": True,
                "blocked_web_categories": ["entertainment"],
            },
            [],
            ["gamevui.vn"],
        )

        self.core.update_hosts_file.assert_called_once_with(["gamevui.vn"])

        self.core.update_hosts_file.reset_mock()
        self.core.save_settings_cache(
            {
                "enable_web_classification": True,
                "blocked_web_categories": [],
            },
            policy_blocked_domains=[],
        )
        self.core.update_hosts_file.assert_called_once_with([])

    def test_pending_unknown_does_not_replace_a_confirmed_blocked_label(self):
        self.core.update_hosts_file = Mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["entertainment"],
        }, [])
        self.core.remember_web_classification(
            "gamevui.vn",
            "entertainment",
            "trained_model",
        )
        self.core.update_hosts_file.reset_mock()

        still_blocked = self.core.remember_web_classification(
            "gamevui.vn",
            "unknown",
            "pending",
        )

        self.assertTrue(still_blocked)
        self.assertEqual(
            self.core.load_web_classification_cache()["gamevui.vn"],
            "entertainment",
        )
        self.core.update_hosts_file.assert_not_called()

    def test_block_policy_exposes_cached_category_for_attempt_logging(self):
        self.core.update_hosts_file = Mock()
        self.core.save_settings_cache({
            "enable_web_classification": True,
            "blocked_web_categories": ["entertainment"],
        }, [])
        self.core.remember_web_classification(
            "gamevui.vn",
            "entertainment",
            "trained_model",
        )

        policy = self.core.get_web_domain_policy("www.gamevui.vn")

        self.assertEqual(policy, {
            "domain": "gamevui.vn",
            "category": "entertainment",
            "blocked": True,
        })

    def test_hosts_policy_redirects_to_the_dedicated_block_sink(self):
        self.core.update_hosts_file = EnforcementCore.update_hosts_file.__get__(
            self.core,
            EnforcementCore,
        )

        with patch.object(enforcement_core.os, "system", return_value=0):
            self.core.update_hosts_file(["gamevui.vn"])

        with open(self.core.hosts_path, "r", encoding="utf-8") as hosts_file:
            hosts = hosts_file.read()
        self.assertIn("127.0.0.2 gamevui.vn", hosts)
        self.assertIn("127.0.0.2 www.gamevui.vn", hosts)


if __name__ == "__main__":
    unittest.main()
