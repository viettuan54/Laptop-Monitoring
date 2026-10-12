import os
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'companion'))
from app_monitor import AppMonitor


class AppMonitorTest(unittest.TestCase):
    def test_verified_window_receives_close_only_once_and_pid_reuse_is_rejected(self):
        pipe = Mock()
        notice = Mock()
        monitor = AppMonitor(pipe, notice)
        command = {'pid': 200, 'created_at': 1000, 'request_id': 'one', 'app_name': 'game.exe', 'grace_seconds': 8}
        pipe.check_applications.return_value = {'app_close_requests': [command]}
        process = Mock()
        process.create_time.return_value = 1000
        process.is_running.return_value = True
        with patch('app_monitor.application_windows', return_value={200: [5]}), \
                patch('app_monitor.psutil.Process', return_value=process), \
                patch('app_monitor.win32process.GetWindowThreadProcessId', return_value=(1, 200)), \
                patch('app_monitor.win32gui.PostMessage') as close:
            monitor.poll()
            monitor.poll()
            close.assert_called_once()
            notice.assert_called_once_with('game.exe', 8)
            pipe.check_applications.assert_called_with([{'pid': 200, 'created_at': 1000}])
            command['request_id'] = 'two'
            process.create_time.side_effect = [1000, 2000]
            monitor.poll()
            close.assert_called_once()

    def test_foreign_identity_in_response_is_ignored(self):
        pipe = Mock()
        pipe.check_applications.return_value = {'app_close_requests': [{'pid': 900, 'created_at': 1, 'request_id': 'foreign'}]}
        with patch('app_monitor.application_windows', return_value={}), \
                patch('app_monitor.win32gui.PostMessage') as close:
            AppMonitor(pipe, Mock()).poll()
            close.assert_not_called()

