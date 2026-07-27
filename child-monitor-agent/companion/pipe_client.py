import time
import json
import logging
import win32file
import win32pipe
import pywintypes

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class PipeClient:
    PIPE_NAME = r"\\.\pipe\ChildMonitorAgentPipe"

    def __init__(self):
        pass

    def send_app_tracking(self, app_name, start_time, end_time, duration_seconds, client_record_id=None):
        """Gửi log theo dõi ứng dụng lên Service và nhận về phản hồi chính sách khóa máy."""
        payload = {
            "action": "TRACK_APP",
            "app_name": app_name,
            "start_time": start_time,
            "end_time": end_time,
            "duration_seconds": duration_seconds
        }
        if client_record_id:
            payload["client_record_id"] = client_record_id
        return self._send_and_receive(payload)

    def send_ping(self):
        """Gửi định kỳ PING lên Service để kiểm tra chính sách mà không làm ghi log app mới."""
        payload = {
            "action": "PING"
        }
        return self._send_and_receive(payload)

    def send_vision_alert(self, alert_type, message, metrics=None):
        """Gửi metadata Edge AI tới Service; tuyệt đối không nhận dữ liệu ảnh."""
        payload = {
            "action": "VISION_ALERT",
            "alert_type": alert_type,
            "message": message,
            "metrics": metrics or {},
        }
        return self._send_and_receive(payload)

    def _send_and_receive(self, payload_dict, max_retries=3):
        """Mở kết nối pipe có hỗ trợ retry ngắn (100-300ms) để tránh xung đột tranh chấp."""
        for attempt in range(1, max_retries + 1):
            try:
                # Mở kết nối tới Named Pipe
                handle = win32file.CreateFile(
                    self.PIPE_NAME,
                    win32file.GENERIC_READ | win32file.GENERIC_WRITE,
                    0, None,
                    win32file.OPEN_EXISTING,
                    0, None
                )

                # Gửi dữ liệu JSON
                message_bytes = json.dumps(payload_dict).encode('utf-8')
                win32file.WriteFile(handle, message_bytes)

                # Đọc dữ liệu phản hồi từ Service
                result, data = win32file.ReadFile(handle, 65536)
                win32file.CloseHandle(handle)

                if result == 0 and data:
                    return json.loads(data.decode('utf-8'))

            except pywintypes.error as e:
                # Nếu pipe đang bận (ERROR_PIPE_BUSY = 231), thử WaitNamedPipe
                if attempt < max_retries:
                    try:
                        win32pipe.WaitNamedPipe(self.PIPE_NAME, 300)
                    except Exception:
                        time.sleep(0.15)
            except Exception as e:
                if attempt < max_retries:
                    time.sleep(0.15)

        return None
