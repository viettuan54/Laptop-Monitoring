import os
import sys
import unittest
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from pipe_server import PipeServer
from watchdog import Watchdog, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK


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
        self.assertTrue(watchdog.session_available.is_set())

    def test_session_lock_stops_companion_and_prevents_respawn(self):
        pipe_server = Mock()
        watchdog = Watchdog(pipe_server=pipe_server)
        watchdog.session_available.set()
        watchdog.terminate_companion_process = Mock()
        watchdog.spawn_companion_process = Mock()

        watchdog.on_session_change(WTS_SESSION_LOCK, 1)

        self.assertFalse(watchdog.session_available.is_set())
        pipe_server.recreate_pipe.assert_called_once_with(new_user_sid=None)
        watchdog.terminate_companion_process.assert_called_once_with()
        watchdog.spawn_companion_process.assert_not_called()

    def test_session_unlock_rebinds_pipe_and_starts_companion(self):
        pipe_server = Mock()
        watchdog = Watchdog(pipe_server=pipe_server)
        user_token = Mock()
        watchdog.get_active_session_user_sid = Mock(
            return_value=(user_token, "S-1-test-user")
        )
        watchdog.terminate_companion_process = Mock()
        watchdog.spawn_companion_process = Mock(return_value=True)

        watchdog.on_session_change(WTS_SESSION_UNLOCK, 1)

        self.assertTrue(watchdog.session_available.is_set())
        pipe_server.recreate_pipe.assert_called_once_with(
            new_user_sid="S-1-test-user"
        )
        watchdog.terminate_companion_process.assert_called_once_with()
        watchdog.spawn_companion_process.assert_called_once_with()
        user_token.Close.assert_called_once_with()

    @patch("watchdog.win32ts.WTSGetActiveConsoleSessionId")
    def test_spawn_is_gated_while_session_is_locked(self, active_session):
        watchdog = Watchdog()

        spawned = watchdog.spawn_companion_process()

        self.assertFalse(spawned)
        active_session.assert_not_called()

    def test_spawn_discards_process_when_lock_races_with_process_creation(self):
        watchdog = Watchdog()
        watchdog.session_available.set()
        user_token = Mock()
        primary_token = Mock()
        process_handle = Mock()
        thread_handle = Mock()
        watchdog.get_active_session_user_sid = Mock(
            return_value=(user_token, "S-1-test-user")
        )
        watchdog.resolve_companion_command = Mock(
            return_value=("companion.exe", "companion.exe", "C:\\agent")
        )

        def create_during_lock(*_args):
            watchdog.session_available.clear()
            return process_handle, thread_handle, 1234, 1

        with patch(
            "watchdog.win32ts.WTSGetActiveConsoleSessionId",
            return_value=1,
        ), patch(
            "watchdog.win32profile.CreateEnvironmentBlock",
            return_value={},
        ), patch(
            "watchdog.win32process.STARTUPINFO",
            return_value=Mock(),
        ), patch(
            "watchdog.win32security.DuplicateTokenEx",
            return_value=primary_token,
        ), patch(
            "watchdog.win32process.CreateProcessAsUser",
            side_effect=create_during_lock,
        ), patch("watchdog.win32api.TerminateProcess") as terminate, patch(
            "watchdog.win32event.WaitForSingleObject"
        ) as wait:
            spawned = watchdog.spawn_companion_process()

        self.assertFalse(spawned)
        self.assertIsNone(watchdog.companion_process_handle)
        terminate.assert_called_once_with(process_handle, 0)
        wait.assert_called_once_with(process_handle, 5000)
        process_handle.Close.assert_called_once_with()
        thread_handle.Close.assert_called_once_with()
        primary_token.Close.assert_called_once_with()
        user_token.Close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
