"""Discover interactive applications independently of usage-log flushing."""

import logging
import threading
import time

import psutil
import pywintypes
import win32con
import win32gui
import win32process


def application_windows():
    windows = {}
    def collect(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and not win32gui.GetWindow(hwnd, win32con.GW_OWNER):
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid > 4:
                windows.setdefault(pid, []).append(hwnd)
    win32gui.EnumWindows(collect, None)
    return windows


class AppMonitor:
    def __init__(self, pipe_client, notice_callback):
        self.pipe_client = pipe_client
        self.notice_callback = notice_callback
        self.stopped = threading.Event()
        self.thread = None
        self.requests = {}

    def poll(self):
        windows = application_windows()
        candidates = []
        for pid in windows:
            try:
                candidates.append({"pid": pid, "created_at": psutil.Process(pid).create_time()})
            except (psutil.Error, OSError):
                continue
        # An empty check still lets the Service cancel old requests after a policy change.
        for offset in range(0, max(1, len(candidates)), 64):
            batch = candidates[offset:offset + 64]
            response = self.pipe_client.check_applications(batch)
            if not isinstance(response, dict):
                continue
            allowed_identities = {(item["pid"], item["created_at"]) for item in batch}
            now = time.monotonic()
            self.requests = {k: v for k, v in self.requests.items() if now - v < 120}
            for request in response.get("app_close_requests", []):
                identity = (request.get("pid"), request.get("created_at"))
                request_id = request.get("request_id")
                if identity not in allowed_identities or not request_id or request_id in self.requests:
                    continue
                try:
                    process = psutil.Process(identity[0])
                    if abs(process.create_time() - identity[1]) > 0.001:
                        continue
                    self.notice_callback(request.get("app_name", "Ứng dụng"), request.get("grace_seconds", 8))
                    for hwnd in windows.get(identity[0], []):
                        _, current_pid = win32process.GetWindowThreadProcessId(hwnd)
                        if current_pid == identity[0] and process.is_running():
                            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                    self.requests[request_id] = now
                except (psutil.Error, OSError, pywintypes.error):
                    # Service will verify exit or perform privileged termination.
                    continue

    def start(self):
        self.stopped.clear()
        def run():
            while not self.stopped.is_set():
                try:
                    self.poll()
                except Exception:
                    logging.exception("Application monitoring iteration failed")
                self.stopped.wait(2)
        self.thread = threading.Thread(target=run, daemon=True, name="AppMonitor")
        self.thread.start()

    def stop(self):
        self.stopped.set()
        if self.thread:
            self.thread.join(timeout=3)
