"""Opt-in desktop capture in the interactive session (including VMware guests)."""
import base64
import ctypes
from ctypes import wintypes
import logging
import threading
import time
import uuid
from datetime import datetime, timezone


def desktop_available():
    """Do not capture the lock screen, UAC desktop, or an inaccessible session."""
    user32 = ctypes.windll.user32
    user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user32.OpenInputDesktop.restype = wintypes.HANDLE
    user32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
                                                wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    user32.CloseDesktop.argtypes = [wintypes.HANDLE]
    desktop = user32.OpenInputDesktop(0, False, 1)
    if not desktop:
        return False
    try:
        name = ctypes.create_unicode_buffer(256)
        needed = wintypes.DWORD()
        return bool(user32.GetUserObjectInformationW(desktop, 2, name, ctypes.sizeof(name), ctypes.byref(needed))) and name.value == "Default"
    finally:
        user32.CloseDesktop(desktop)


def capture_desktop():
    """Capture the primary guest display with GDI, encode bounded JPEGs in RAM."""
    import cv2
    import numpy as np
    import win32con
    import win32gui
    import win32ui

    if not desktop_available():
        return None
    user32 = ctypes.windll.user32
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    old_dpi = user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    screen_dc = source = memory = bitmap = previous = None
    try:
        width, height = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        if not (0 < width <= 16384 and 0 < height <= 16384 and width * height <= 40_000_000):
            return None
        screen_dc = win32gui.CreateDC("DISPLAY", None, None)
        source = win32ui.CreateDCFromHandle(screen_dc)
        memory = source.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(source, width, height)
        previous = memory.SelectObject(bitmap)
        memory.BitBlt((0, 0), (width, height), source, (0, 0), win32con.SRCCOPY | 0x40000000)
        frame = np.frombuffer(bitmap.GetBitmapBits(True), dtype=np.uint8).reshape(height, width, 4)[:, :, :3]
        if not desktop_available():
            return None

        def jpeg(max_side, max_bytes):
            scale = min(1.0, max_side / max(width, height))
            resized = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
            for quality in (75, 60, 45, 30):
                ok, encoded = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok and encoded.nbytes <= max_bytes:
                    return base64.b64encode(encoded).decode('ascii')
            raise ValueError("Screenshot cannot be encoded within upload limit")

        return {"image_base64": jpeg(1920, 400 * 1024), "thumbnail_base64": jpeg(480, 40 * 1024)}
    finally:
        if memory is not None:
            if previous is not None:
                memory.SelectObject(previous)
            memory.DeleteDC()
        if bitmap is not None:
            win32gui.DeleteObject(bitmap.GetHandle())
        # This DC was created by CreateDC, so it is owned by the capture worker.
        if source is not None:
            source.DeleteDC()
        elif screen_dc:
            win32gui.DeleteDC(screen_dc)
        if old_dpi:
            user32.SetThreadDpiAwarenessContext(old_dpi)


class ScreenMonitor:
    def __init__(self, pipe_client, notice, capture=capture_desktop, available=desktop_available):
        self.pipe_client = pipe_client
        self.notice = notice
        self.capture = capture
        self.available = available
        self.lock = threading.Lock()
        self.policy = {"enabled": False}
        self.deadline = 0
        self.last_capture = None
        self.last_request_expires_at = 0
        self.stop_event = threading.Event()

    def update_config(self, response):
        config = response.get("screenshot_config") if isinstance(response, dict) else None
        with self.lock:
            if not isinstance(config, dict) or config.get("enabled") is not True:
                self.policy = {"enabled": False}
                self.deadline = 0
                return
            lease = config.get("valid_for_seconds", 0)
            interval = config.get("interval_seconds", 300)
            if (not isinstance(lease, (int, float)) or not 0 < lease <= 180
                    or not isinstance(interval, int) or isinstance(interval, bool) or not 60 <= interval <= 3600
                    or not isinstance(config.get("revision"), str)):
                self.policy = {"enabled": False}
                self.deadline = 0
                return
            self.policy = dict(config)
            self.deadline = time.monotonic() + lease

    def _allowed(self, revision=None):
        with self.lock:
            return (not self.stop_event.is_set() and self.policy.get("enabled") is True
                    and time.monotonic() < self.deadline
                    and (revision is None or revision == self.policy.get("revision")))

    def step(self):
        # Ask the Service immediately before capture, never authorize from stale UI state.
        self.update_config(self.pipe_client.send_ping())
        with self.lock:
            policy = dict(self.policy)
        if not self._allowed() or not self.available():
            return False
        request_id = None
        request_expires_at = 0
        request = policy.get("request")
        if isinstance(request, dict):
            try:
                request_expires_at = datetime.fromisoformat(request["expires_at"].replace("Z", "+00:00")).timestamp()
                if time.time() < request_expires_at and request_expires_at > self.last_request_expires_at:
                    request_id = str(uuid.UUID(request["id"]))
            except (ValueError, TypeError, KeyError, AttributeError):
                pass
        now = time.monotonic()
        if not request_id and self.last_capture is not None and now - self.last_capture < policy["interval_seconds"]:
            return False
        self.last_capture = now
        if request_id:
            # Repeated heartbeat replies must never recapture the same command.
            self.last_request_expires_at = request_expires_at
        self.notice()
        if not self._allowed(policy["revision"]):
            return False
        captured_at = datetime.now(timezone.utc).isoformat()
        image = self.capture()
        if not image or not self._allowed(policy["revision"]):
            return False
        record = {**image, "client_record_id": request_id or str(uuid.uuid4()), "captured_at": captured_at,
                  "policy_revision": policy["revision"]}
        response = self.pipe_client.send_screenshot(record)
        self.update_config(response)
        return isinstance(response, dict) and response.get("screenshot_queued") is True

    def start(self):
        def worker():
            while not self.stop_event.is_set():
                try:
                    self.step()
                except Exception as error:
                    logging.warning("Screen monitoring unavailable: %s", type(error).__name__)
                self.stop_event.wait(10)
        threading.Thread(target=worker, daemon=True, name="ScreenMonitor").start()

    def stop(self):
        self.stop_event.set()
        self.update_config(None)
