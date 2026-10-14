"""Explicit Windows smoke test: real IPC/auth/dialog, simulated ten-minute clock.

Run with the Agent venv in an unlocked console session. Uses an isolated pipe
and temporary SQLite database; never contacts the backend or installed Agent.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import uuid
from unittest.mock import Mock

import win32api
import win32con
import win32gui
import win32process
import win32security

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'service'), str(ROOT / 'companion')]
from break_monitor import BreakReminderMonitor
from break_notice import show_break_notice
from break_reminders import BreakReminderEngine
from offline_queue import OfflineQueue
from pipe_client import PipeClient
from pipe_server import PipeServer
from screen_monitor import desktop_available
from windows_app_process import WindowsAppProcesses


def main():
    if not desktop_available():
        raise RuntimeError('Smoke test requires an unlocked console desktop')
    elapsed = [0]
    settings = dict(enable_break_reminders=True, break_interval_minutes=10, break_duration_minutes=2)
    enforcement = Mock()
    enforcement.load_cached_settings.return_value = settings
    enforcement.check_policy_status.return_value = (False, 'OK', -1)
    enforcement.get_text_moderation_policy.return_value = {'enabled': False}
    enforcement.get_screenshot_policy.return_value = {'enabled': False}
    shown = threading.Event()
    workers = []
    notices = []

    def notice(reminder, receive, cancel):
        notices.append(reminder)
        def callback(event):
            receive(event)
            if event == 'shown':
                shown.set()
        worker = show_break_notice(reminder, callback, cancel)
        workers.append(worker)
        return worker

    with tempfile.TemporaryDirectory(prefix='break-smoke-') as directory:
        queue = OfflineQueue(str(Path(directory) / 'queue.db'), secure_file=False)
        server = PipeServer(queue, enforcement)
        server.PIPE_NAME = r'\\.\pipe\ChildMonitorBreakSmoke-' + uuid.uuid4().hex
        token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
        try:
            server.current_user_sid = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
        finally:
            token.Close()
        server.app_processes = WindowsAppProcesses(lambda: server.current_user_sid)
        server.break_reminders = BreakReminderEngine(queue, lambda: elapsed[0], lambda: 1000000 + elapsed[0])
        client = PipeClient()
        client.PIPE_NAME = server.PIPE_NAME
        monitor = BreakReminderMonitor(client, notice, lambda: 3600 + elapsed[0], desktop_available)
        server.running = True
        server_thread = threading.Thread(target=server._server_loop, daemon=True)
        server_thread.start()
        try:
            for second in range(0, 600, 5):
                elapsed[0] = second
                monitor.poll()
                assert not notices, 'Reminder appeared before ten minutes'
            elapsed[0] = 600
            monitor.poll()
            assert shown.wait(5), 'No native reminder at ten minutes'
            assert len(notices) == 1, 'Duplicate reminder windows'
            assert notices[0]['interval_minutes'] == 10
            assert notices[0]['duration_minutes'] == 2
            handles = []
            def visit(hwnd, _):
                if (win32process.GetWindowThreadProcessId(hwnd)[1] == os.getpid()
                        and win32gui.GetWindowText(hwnd) == 'LaptopChildren · Nghỉ giải lao'):
                    handles.append(hwnd)
            win32gui.EnumWindows(visit, None)
            assert len(handles) == 1, 'Expected one own native dialog'
            win32gui.SendMessage(handles[0], win32con.WM_COMMAND, 2, 0)
            workers[0].join(5)
            assert not workers[0].is_alive(), 'Dialog did not close after snooze'
            monitor.poll()
            with queue.get_connection() as connection:
                records = [json.loads(row[0]) for row in connection.execute('SELECT payload FROM break_reminder_events')]
            assert [row['event_type'] for row in records] == ['shown', 'snoozed'], records
            settings['enable_break_reminders'] = False
            monitor.poll()
            assert monitor.current_id is None
            print(json.dumps({'passed': True, 'clock': 'simulated', 'elapsed_seconds': 600,
                              'input_idle_seconds': 4200, 'real_named_pipe': True,
                              'real_session_authentication': True, 'real_native_dialog': True,
                              'persisted_events': [row['event_type'] for row in records]}))
        finally:
            monitor.stop()
            for worker in workers:
                worker.join(5)
            server.stop()
            server_thread.join(5)
            assert not server_thread.is_alive(), 'Test pipe server did not stop'


if __name__ == '__main__':
    main()
