"""Poll session reminders without reading input content or installing hooks."""
import ctypes
from ctypes import wintypes
import logging
import queue
import threading
import time

from screen_monitor import desktop_available


def idle_seconds():
    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [('cbSize', wintypes.UINT), ('dwTime', wintypes.DWORD)]
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        raise ctypes.WinError()
    # Both values wrap at 2**32 milliseconds, independently of Python's int.
    ticks = ctypes.windll.kernel32.GetTickCount() & 0xffffffff
    return ((ticks - info.dwTime) & 0xffffffff) / 1000.0


class BreakReminderMonitor:
    def __init__(self, pipe_client, notice_callback, activity_reader=idle_seconds, desktop_reader=desktop_available):
        self.pipe = pipe_client
        self.notice = notice_callback
        self.activity_reader = activity_reader
        self.desktop_reader = desktop_reader
        self.stop_event = threading.Event()
        self.cancel_notice = threading.Event()
        self.events = queue.Queue()
        self.pending_event = None
        self.current_id = None
        self.notice_worker = None
        self.completed_id = None
        self.last_response = time.monotonic()

    def _cancel_notice(self):
        self.cancel_notice.set()
        self.current_id = None
        self.notice_worker = None

    def poll(self):
        # FIFO and stable IDs preserve shown-before-response, even after an IPC retry.
        for _ in range(10):
            if self.pending_event is None:
                try:
                    self.pending_event = self.events.get_nowait()
                except queue.Empty:
                    break
            reply = self.pipe.send_break_response(*self.pending_event)
            if not reply or reply.get('break_response_accepted') is not True:
                break
            self.pending_event = None
        response = self.pipe.send_break_tick(self.activity_reader(), self.desktop_reader())
        if not isinstance(response, dict) or 'break_reminder' not in response:
            if time.monotonic() - self.last_response > 15:
                self._cancel_notice()
            return
        self.last_response = time.monotonic()
        policy = response['break_reminder']
        reminder = policy.get('reminder') if policy.get('enabled') and not response.get('should_lock') else None
        reminder_id = reminder.get('reminder_id') if reminder else None
        if reminder_id == self.current_id:
            if (self.notice_worker is None or self.notice_worker.is_alive()
                    or reminder_id == self.completed_id):
                return
            logging.warning('Break reminder window closed before a response; retrying')
        self._cancel_notice()
        if reminder_id is None or reminder_id == self.completed_id:
            return
        self.current_id = reminder_id
        if reminder:
            self.cancel_notice = threading.Event()
            cancel = self.cancel_notice
            def receive(event):
                if cancel.is_set():
                    return
                if event in {'acknowledged', 'snoozed'}:
                    self.completed_id = reminder_id
                self.events.put((reminder_id, event))
            try:
                self.notice_worker = self.notice(reminder, receive, cancel)
            except Exception:
                self._cancel_notice()
                raise

    def start(self):
        def run():
            while not self.stop_event.is_set():
                try:
                    self.poll()
                except Exception:
                    self._cancel_notice()
                    logging.exception('Break reminder update failed')
                self.stop_event.wait(5)
        self.thread = threading.Thread(target=run, daemon=True, name='BreakReminders')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self._cancel_notice()
