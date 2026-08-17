import os
import sys
import unittest
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

import main_service


class ServiceEntrypointTest(unittest.TestCase):
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
