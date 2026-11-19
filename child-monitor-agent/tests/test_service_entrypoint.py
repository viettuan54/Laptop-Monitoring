import os
import sys
import unittest
import threading
import tempfile
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import main_service
from enforcement_core import EnforcementCore


class ServiceEntrypointTest(unittest.TestCase):
    def test_heartbeat_applies_global_additions_and_removals_without_restart(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.api_client = Mock()
        with tempfile.TemporaryDirectory() as directory:
            core = EnforcementCore(object(), config_dir=directory)
            core.hosts_path = os.path.join(directory, 'hosts')
            with open(core.hosts_path, 'w') as stream:
                stream.write('127.0.0.1 localhost\n')
            service.enforcement_core = core
            with patch('enforcement_core.os.system', return_value=0):
                for domains in (['blocked.example'], [], ['blocked.example']):
                    service.api_client.post.return_value = Mock(status_code=200)
                    service.api_client.post.return_value.json.return_value = {
                        'config': {'enable_web_classification': False},
                        'blacklisted_domains': domains,
                        'policy_blocked_domains': [],
                    }
                    service._heartbeat_loop_step()
                    self.assertEqual(core.get_browser_web_policy()['blocked_domains'], domains)
                    with open(core.hosts_path) as stream:
                        self.assertEqual('127.0.0.2 blocked.example' in stream.read(), bool(domains))
                # Older backends and malformed snapshots must not clear protection.
                for payload in ({}, {'blacklisted_domains': None}, {'blacklisted_domains': 'invalid'}):
                    service.api_client.post.return_value.json.return_value = {'config': {}, **payload}
                    service._heartbeat_loop_step()
                    self.assertEqual(core.get_browser_web_policy()['blocked_domains'], ['blocked.example'])
                service.api_client.post.return_value = Mock(status_code=503)
                service._heartbeat_loop_step()
                self.assertEqual(core.get_browser_web_policy()['blocked_domains'], ['blocked.example'])

    def test_text_worker_wakes_on_query_and_stops_without_waiting_for_bulk_sync(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.stop_event = threading.Event()
        service.api_client = Mock()
        service.offline_queue = Mock(text_sync_requested=threading.Event())
        service.offline_queue.sync_text_moderation.side_effect = lambda client: service.stop_event.set()
        worker = threading.Thread(target=service._text_sync_loop, daemon=True)
        worker.start()
        service.offline_queue.text_sync_requested.set()
        worker.join(timeout=2)
        try:
            self.assertFalse(worker.is_alive(), "A query must not wait for the 60s telemetry cycle")
            service.offline_queue.sync_text_moderation.assert_called_once_with(service.api_client)
            service.offline_queue.sync_offline_data.assert_not_called()
        finally:
            service.stop_event.set()
            service.offline_queue.text_sync_requested.set()
            worker.join(timeout=2)

    def test_vision_worker_sends_without_waiting_for_usage_sync(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.stop_event = threading.Event()
        service.api_client = Mock()
        service.offline_queue = Mock(vision_sync_requested=threading.Event())
        service.offline_queue.sync_vision_alerts.side_effect = lambda client: service.stop_event.set()
        worker = threading.Thread(target=service._vision_sync_loop, daemon=True)
        worker.start()
        service.offline_queue.vision_sync_requested.set()
        worker.join(timeout=2)
        try:
            self.assertFalse(worker.is_alive())
            service.offline_queue.sync_vision_alerts.assert_called_once_with(service.api_client)
            service.offline_queue.sync_offline_data.assert_not_called()
        finally:
            service.stop_event.set()
            service.offline_queue.vision_sync_requested.set()
            worker.join(timeout=2)

    def test_vision_worker_retries_retained_records_without_a_new_alert(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.stop_event = threading.Event()
        service.api_client = Mock()
        service.offline_queue = Mock()
        service.offline_queue.sync_vision_alerts.side_effect = lambda client: service.stop_event.set()
        service._vision_sync_loop()
        service.offline_queue.vision_sync_requested.wait.assert_called_once_with(timeout=5)
        service.offline_queue.sync_vision_alerts.assert_called_once_with(service.api_client)

    def test_text_worker_retries_on_timeout_without_another_query(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.stop_event = threading.Event()
        service.api_client = Mock()
        service.offline_queue = Mock()
        service.offline_queue.text_sync_requested.wait.return_value = False
        service.offline_queue.sync_text_moderation.side_effect = lambda client: service.stop_event.set()
        service._text_sync_loop()
        service.offline_queue.text_sync_requested.wait.assert_called_once_with(timeout=5)
        service.offline_queue.sync_text_moderation.assert_called_once_with(service.api_client)

    def test_svc_do_run_uses_supported_pywin32_started_event(self):
        service = object.__new__(main_service.ChildMonitorService)
        service.main = Mock()

        with patch.object(main_service.servicemanager, "LogMsg") as log_message:
            service.SvcDoRun()

        log_message.assert_called_once_with(
            main_service.servicemanager.EVENTLOG_INFORMATION_TYPE,
            main_service.servicemanager.PYS_SERVICE_STARTED,
            ("ChildMonitorService", ""),
        )
        service.main.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
