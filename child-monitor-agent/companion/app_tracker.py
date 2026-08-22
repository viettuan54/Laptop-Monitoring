import time
import logging
import re
import uuid
from datetime import datetime
import win32gui
import win32process
import win32api
import psutil

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


IGNORED_FOREGROUND_APPS = frozenset({"lockapp.exe", "logonui.exe"})
MAX_APP_SEGMENT_SECONDS = 120

class AppTracker:
    def __init__(self, pipe_client):
        self.pipe_client = pipe_client
        self.current_app = None
        self.current_app_metadata = {}
        self.app_start_time = None
        self.app_start_monotonic = None
        self.min_duration_seconds = 3 # Ngưỡng lọc nhiễu 3 giây
        self.flush_interval_seconds = 30
        self.max_poll_gap_seconds = 15
        self.pending_segments = []
        self.last_poll_time = None
        self.last_poll_monotonic = None

    def _queue_current_segment(self, end_time, end_monotonic):
        """Đóng lát thời gian hiện tại và đưa vào hàng đợi gửi IPC."""
        if not self.current_app or self.app_start_monotonic is None:
            return

        duration = int(end_monotonic - self.app_start_monotonic)
        if duration > MAX_APP_SEGMENT_SECONDS:
            logging.warning(
                "Discarding an implausible app segment (%ss) after lock/sleep.",
                duration,
            )
            return
        if duration >= self.min_duration_seconds:
            self.pending_segments.append({
                "client_record_id": str(uuid.uuid4()),
                "app_name": self.current_app,
                # datetime.now() is local time. Include its real UTC offset instead
                # of appending "Z" (which would incorrectly claim the value is UTC).
                "start_time": self.app_start_time.astimezone().isoformat(),
                "end_time": end_time.astimezone().isoformat(),
                "duration_seconds": duration,
                **self.current_app_metadata,
            })

    def _reset_current_segment(self):
        self.current_app = None
        self.current_app_metadata = {}
        self.app_start_time = None
        self.app_start_monotonic = None

    def _finish_current_segment(self, end_time, end_monotonic):
        self._queue_current_segment(end_time, end_monotonic)
        self._reset_current_segment()

    @staticmethod
    def _is_trackable_app(app_name):
        return bool(
            isinstance(app_name, str)
            and app_name
            and app_name.casefold() not in IGNORED_FOREGROUND_APPS
        )

    def _send_pending_segments(self):
        """Gửi theo thứ tự; giữ nguyên segment đầu tiên nếu Service chưa ACK."""
        last_response = None
        while self.pending_segments:
            segment = self.pending_segments[0]
            response = self.pipe_client.send_app_tracking(**segment)
            if (
                not isinstance(response, dict)
                or response.get("tracking_ack") != segment["client_record_id"]
            ):
                break
            self.pending_segments.pop(0)
            last_response = response
        return last_response

    def flush(self):
        """Flush lát hiện tại, dùng khi companion chuẩn bị thoát."""
        now = datetime.now()
        now_monotonic = time.monotonic()
        if (
            self.last_poll_monotonic is not None
            and now_monotonic - self.last_poll_monotonic > self.max_poll_gap_seconds
        ):
            # Preserve only the interval observed before a lock/sleep gap.
            self._finish_current_segment(
                self.last_poll_time,
                self.last_poll_monotonic,
            )
        else:
            self._finish_current_segment(now, now_monotonic)
        return self._send_pending_segments()

    @staticmethod
    def get_foreground_app_name():
        """Lấy tên file thực thi (.exe) của cửa sổ đang active."""
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return None

            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid <= 0:
                return None

            process = psutil.Process(pid)
            return process.name()
        except Exception:
            return None

    @staticmethod
    def get_foreground_app_metadata(expected_app_name=None):
        """Read non-sensitive executable version metadata for model inference.

        Window titles and executable paths are deliberately not returned or sent.
        """
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return {}
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid <= 0:
                return {}
            process = psutil.Process(pid)
            if (
                expected_app_name
                and process.name().casefold() != expected_app_name.casefold()
            ):
                return {}
            executable_path = process.exe()
            translations = win32api.GetFileVersionInfo(
                executable_path, r"\VarFileInfo\Translation"
            )
            language_pairs = translations or [(0x0409, 0x04B0)]
            metadata = {}
            for field, payload_key in (
                ("ProductName", "product_name"),
                ("FileDescription", "file_description"),
            ):
                value = None
                for language, codepage in language_pairs:
                    try:
                        value = win32api.GetFileVersionInfo(
                            executable_path,
                            rf"\StringFileInfo\{language:04X}{codepage:04X}\{field}",
                        )
                    except Exception:
                        continue
                    if isinstance(value, str) and value.strip():
                        break
                if isinstance(value, str):
                    raw_value = value.strip()
                    if any(
                        ord(character) < 32 or ord(character) == 127
                        for character in raw_value
                    ) or "\\" in raw_value or re.search(
                        r"(?:^|[^\s])/|/(?:$|[^\s])", raw_value
                    ):
                        continue
                    value = " ".join(raw_value.split())[:150]
                    if value:
                        metadata[payload_key] = value
            return metadata
        except Exception:
            return {}

    def poll(self):
        """Hàm kiểm tra cửa sổ active định kỳ."""
        app_name = self.get_foreground_app_name()
        now = datetime.now()
        now_monotonic = time.monotonic()

        poll_gap = (
            None
            if self.last_poll_monotonic is None
            else now_monotonic - self.last_poll_monotonic
        )
        if poll_gap is not None and (
            poll_gap < 0 or poll_gap > self.max_poll_gap_seconds
        ):
            # Do not bridge sleep, hibernation, a secure desktop, or a long stall.
            if self.last_poll_time is not None:
                self._finish_current_segment(
                    self.last_poll_time,
                    self.last_poll_monotonic,
                )
            else:
                self._reset_current_segment()

        if not self._is_trackable_app(app_name):
            # GetForegroundWindow often returns no handle on the lock screen.
            # Close the preceding app now so it cannot continue into unlock.
            if self.current_app is not None:
                self._finish_current_segment(now, now_monotonic)
            self.last_poll_time = now
            self.last_poll_monotonic = now_monotonic
            return self._send_pending_segments()

        if self.current_app is None:
            self.current_app = app_name
            self.current_app_metadata = self.get_foreground_app_metadata(app_name)
            self.app_start_time = now
            self.app_start_monotonic = now_monotonic
            self.last_poll_time = now
            self.last_poll_monotonic = now_monotonic
            return self._send_pending_segments()

        elapsed = now_monotonic - self.app_start_monotonic
        # Đóng lát khi đổi app hoặc sau mỗi khoảng flush. Nhờ vậy một app chạy
        # liên tục nhiều giờ vẫn được cộng daily_usage đều đặn.
        if app_name != self.current_app or elapsed >= self.flush_interval_seconds:
            self._queue_current_segment(now, now_monotonic)
            self.current_app = app_name
            self.current_app_metadata = self.get_foreground_app_metadata(app_name)
            self.app_start_time = now
            self.app_start_monotonic = now_monotonic

        self.last_poll_time = now
        self.last_poll_monotonic = now_monotonic
        return self._send_pending_segments()
