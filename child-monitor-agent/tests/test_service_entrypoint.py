import os
import sys
import unittest
import threading
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import main_service


class ServiceEntrypointTest(unittest.TestCase):
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
