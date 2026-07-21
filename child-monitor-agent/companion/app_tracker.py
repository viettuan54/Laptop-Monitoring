import time
import logging
from datetime import datetime
import win32gui
import win32process
import psutil

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class AppTracker:
    def __init__(self, pipe_client):
        self.pipe_client = pipe_client
        self.current_app = None
        self.app_start_time = None
        self.min_duration_seconds = 3 # Ngưỡng lọc nhiễu 3 giây

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

    def poll(self):
        """Hàm kiểm tra cửa sổ active định kỳ."""
        app_name = self.get_foreground_app_name()
        now = datetime.now()

        if not app_name:
            return None

        if self.current_app is None:
            self.current_app = app_name
            self.app_start_time = now
            return None

        # Nếu chuyển sang ứng dụng khác
        if app_name != self.current_app:
            duration = int((now - self.app_start_time).total_seconds())

            prev_app = self.current_app
            start_iso = self.app_start_time.isoformat() + "Z"
            end_iso = now.isoformat() + "Z"

            # Đổi sang app mới
            self.current_app = app_name
            self.app_start_time = now

            # Nếu thời gian dùng app trước >= 3s -> gửi log lên Service qua Pipe
            if duration >= self.min_duration_seconds:
                response = self.pipe_client.send_app_tracking(
                    app_name=prev_app,
                    start_time=start_iso,
                    end_time=end_iso,
                    duration_seconds=duration
                )
                return response

        return None
