"""Read only the time since the last input; never read which keys were pressed."""
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
        self.last_response = time.monotonic()

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
                self.cancel_notice.set()
            return
        self.last_response = time.monotonic()
        policy = response['break_reminder']
        reminder = policy.get('reminder') if policy.get('enabled') and not response.get('should_lock') else None
        reminder_id = reminder.get('reminder_id') if reminder else None
        if reminder_id == self.current_id:
            return
        self.cancel_notice.set()
        self.current_id = reminder_id
        if reminder:
            self.cancel_notice = threading.Event()
            self.notice(reminder, lambda event: self.events.put((reminder_id, event)), self.cancel_notice)

    def start(self):
        def run():
            while not self.stop_event.is_set():
                try:
                    self.poll()
                except Exception:
                    self.cancel_notice.set()
                    logging.exception('Break reminder update failed')
                self.stop_event.wait(5)
        self.thread = threading.Thread(target=run, daemon=True, name='BreakReminders')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.cancel_notice.set()
