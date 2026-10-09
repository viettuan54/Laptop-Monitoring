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


class _BitmapInfoHeader(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("width", wintypes.LONG),
                ("height", wintypes.LONG), ("planes", wintypes.WORD),
                ("bit_count", wintypes.WORD), ("compression", wintypes.DWORD),
                ("image_size", wintypes.DWORD), ("x_pixels", wintypes.LONG),
                ("y_pixels", wintypes.LONG), ("colors_used", wintypes.DWORD),
                ("colors_important", wintypes.DWORD)]


def _capture_bitmap(width, height, draw):
    """Read a top-down 32-bit bitmap without win32ui's external MFC runtime."""
    import numpy as np
    import win32gui

    source = memory = bitmap = previous = None
    try:
        source = win32gui.CreateDC("DISPLAY", None, None)
        memory = win32gui.CreateCompatibleDC(source)
        bitmap = win32gui.CreateCompatibleBitmap(source, width, height)
        previous = win32gui.SelectObject(memory, bitmap)
        draw(memory, source)
        # GetDIBits requires the bitmap to be deselected from every DC.
        win32gui.SelectObject(memory, previous)
        previous = None
        info = _BitmapInfoHeader(size=ctypes.sizeof(_BitmapInfoHeader), width=width,
                                 height=-height, planes=1, bit_count=32)
        pixels = np.empty((height, width, 4), dtype=np.uint8)
        get_bits = ctypes.windll.gdi32.GetDIBits
        get_bits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT,
                            ctypes.c_void_p, ctypes.POINTER(_BitmapInfoHeader), wintypes.UINT]
        get_bits.restype = ctypes.c_int
        if get_bits(int(source), int(bitmap), 0, height, pixels.ctypes.data, ctypes.byref(info), 0) != height:
            raise OSError("GetDIBits could not read the complete screenshot")
        return pixels[:, :, :3]
    finally:
        if memory is not None:
            if previous is not None:
                win32gui.SelectObject(memory, previous)
            win32gui.DeleteDC(memory)
        if bitmap is not None:
            win32gui.DeleteObject(bitmap)
        if source is not None:
            win32gui.DeleteDC(source)


def _encode_frame(frame):
    import cv2

    height, width = frame.shape[:2]

    def jpeg(max_side, max_bytes):
        scale = min(1.0, max_side / max(width, height))
        resized = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
        for quality in (75, 60, 45, 30):
            ok, encoded = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if ok and encoded.nbytes <= max_bytes:
                return base64.b64encode(encoded).decode('ascii')
        raise ValueError("Screenshot cannot be encoded within upload limit")

    return {"image_base64": jpeg(1920, 400 * 1024), "thumbnail_base64": jpeg(480, 40 * 1024)}


def check_capture_support():
    """Exercise native GDI and JPEGs with offscreen colors; never read the desktop."""
    import win32gui

    def draw(memory, source):
        for color, rect in ((0x0000ff, (0, 0, 64, 24)), (0xff0000, (0, 24, 64, 48))):
            brush = win32gui.CreateSolidBrush(color)
            try:
                win32gui.FillRect(memory, rect, brush)
            finally:
                win32gui.DeleteObject(brush)

    frame = _capture_bitmap(64, 48, draw)
    if tuple(frame[12, 32]) != (0, 0, 255) or tuple(frame[36, 32]) != (255, 0, 0):
        raise RuntimeError("Screenshot bitmap orientation or color format is invalid")
    return _encode_frame(frame)


def capture_desktop():
    """Capture the primary guest display with GDI, encode bounded JPEGs in RAM."""
    import win32con
    import win32gui

    if not desktop_available():
        return None
    user32 = ctypes.windll.user32
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    old_dpi = user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    try:
        width, height = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        if not (0 < width <= 16384 and 0 < height <= 16384 and width * height <= 40_000_000):
            return None
        frame = _capture_bitmap(width, height, lambda memory, source: win32gui.BitBlt(
            memory, 0, 0, width, height, source, 0, 0, win32con.SRCCOPY | 0x40000000))
        if not desktop_available():
            return None
        return _encode_frame(frame)
    finally:
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
        self.pending_record = None
        self.pending_request_id = None
        self.pending_deadline = 0
        self.next_delivery_attempt = 0
        self.stop_event = threading.Event()

    def update_config(self, response):
        # A busy pipe is not a policy revocation. Keep only the unexpired lease;
        # an explicit disabled policy still takes effect immediately.
        if response is None:
            return
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
        if not self._allowed():
            self.pending_record = None
            return False
        if self.pending_record is not None:
            current_request = policy.get("request") or {}
            same_request = (isinstance(current_request, dict)
                            and current_request.get("id") == self.pending_request_id)
            if (not self._allowed(self.pending_record["policy_revision"])
                    or time.monotonic() >= self.pending_deadline
                    or (self.pending_request_id and not same_request)):
                self.pending_record = None
            elif time.monotonic() < self.next_delivery_attempt:
                return False
            else:
                return self._deliver_pending()
        if not self.available():
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
        logging.info("Screenshot capture starting (%s).", "requested" if request_id else "periodic")
        self.notice()
        if not self._allowed(policy["revision"]):
            logging.info("Screenshot skipped: permission changed or expired during the notice.")
            return False
        captured_at = datetime.now(timezone.utc).isoformat()
        image = self.capture()
        if not image:
            logging.warning("Screenshot skipped: interactive desktop is unavailable.")
            return False
        if not self._allowed(policy["revision"]):
            logging.info("Screenshot discarded: permission changed or expired during capture.")
            return False
        record = {**image, "client_record_id": request_id or str(uuid.uuid4()), "captured_at": captured_at,
                  "policy_revision": policy["revision"]}
        self.pending_record = record
        self.pending_request_id = request_id
        self.pending_deadline = min(self.deadline, time.monotonic() + 120)
        return self._deliver_pending()

    def _deliver_pending(self):
        # Retry the same in-memory image/UUID when the shared pipe is busy.
        # No additional capture notice, offline file or duplicated photo is needed.
        response = self.pipe_client.send_screenshot(self.pending_record)
        self.update_config(response)
        queued = isinstance(response, dict) and response.get("screenshot_queued") is True
        if not queued:
            self.next_delivery_attempt = time.monotonic() + 5
            logging.warning("Screenshot was not accepted by the Service; check pipe connection and current policy.")
        else:
            self.pending_record = None
            logging.info("Screenshot queued by Service; awaiting backend delivery.")
        return queued

    def start(self):
        def worker():
            while not self.stop_event.is_set():
                try:
                    self.step()
                except Exception as error:
                    logging.warning("Screen monitoring unavailable: %s: %s", type(error).__name__, error, exc_info=True)
                self.stop_event.wait(1)
        threading.Thread(target=worker, daemon=True, name="ScreenMonitor").start()

    def stop(self):
        self.stop_event.set()
        self.pending_record = None
        self.update_config({'screenshot_config': {'enabled': False}})
