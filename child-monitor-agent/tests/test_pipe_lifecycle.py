import os
import sys
import unittest
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from pipe_server import PipeServer
from watchdog import Watchdog


class PipeLifecycleTest(unittest.TestCase):
    def test_recreate_interrupts_listener_without_closing_foreign_thread_handle(self):
        server = PipeServer(Mock(), Mock())
        pipe_handle = Mock()
        server.client_handle = pipe_handle

        with patch.object(server, "_interrupt_pipe_handle") as interrupt:
            changed = server.recreate_pipe("S-1-test-user")

        self.assertTrue(changed)
        self.assertEqual(server.current_user_sid, "S-1-test-user")
        self.assertIs(server.client_handle, pipe_handle)
        interrupt.assert_called_once_with(pipe_handle)

    def test_recreate_preserves_listener_when_sid_is_unchanged(self):
        server = PipeServer(Mock(), Mock())
        server.current_user_sid = "S-1-test-user"
        server.client_handle = Mock()

        with patch.object(server, "_interrupt_pipe_handle") as interrupt:
            changed = server.recreate_pipe("S-1-test-user")

        self.assertFalse(changed)
        interrupt.assert_not_called()

    def test_stop_interrupts_listener_without_cross_thread_close(self):
        server = PipeServer(Mock(), Mock())
        pipe_handle = Mock()
        server.running = True
        server.client_handle = pipe_handle

        with patch.object(server, "_interrupt_pipe_handle") as interrupt:
            server.stop()

        self.assertFalse(server.running)
        self.assertIs(server.client_handle, pipe_handle)
        interrupt.assert_called_once_with(pipe_handle)

    @patch("watchdog.win32ts.WTSGetActiveConsoleSessionId", return_value=1)
    def test_watchdog_primes_pipe_sid_before_listener_start(self, _active_session):
        pipe_server = Mock()
        watchdog = Watchdog(pipe_server=pipe_server)
        user_token = Mock()
        watchdog.get_active_session_user_sid = Mock(
            return_value=(user_token, "S-1-test-user")
        )

        prepared = watchdog.prepare_pipe_for_active_session()

        self.assertTrue(prepared)
        pipe_server.set_user_sid.assert_called_once_with("S-1-test-user")
        user_token.Close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
