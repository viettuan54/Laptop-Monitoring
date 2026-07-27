import time
import logging
import threading
import ctypes

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class UIAlerts:
    """
    Module quản lý cảnh báo UI (Toast Notification / Popup đếm ngược)
    chạy trong luồng non-blocking để không gây đơ Companion loop.
    """
    
    @staticmethod
    def _display_toast(title, message):
        """Hiển thị thông báo Toast / Message Box đơn giản của Windows."""
        try:
            # Dùng win32gui / MessageBoxTimeoutW hoặc MessageBoxW trong luồng phụ
            MB_ICONWARNING = 0x30
            MB_SYSTEMMODAL = 0x1000
            ctypes.windll.user32.MessageBoxW(0, message, title, MB_ICONWARNING | MB_SYSTEMMODAL)
        except Exception as e:
            logging.error(f"Error displaying alert dialog: {e}")

    @classmethod
    def show_countdown_warning(cls, minutes=5, reason=""):
        """
        Khởi chạy cảnh báo đếm ngược trước khi khóa máy trong một daemon thread riêng biệt.
        """
        def _warning_thread():
            msg = f"CẢNH BÁO: Máy tính sẽ tự động khóa sau {minutes} phút!"
            if reason:
                msg += f"\nLý do: {reason}"
            logging.warning(f"Displaying countdown alert to user ({minutes}m remaining)")
            cls._display_toast("Child Monitor Warning", msg)

        # Chạy trong thread non-blocking
        t = threading.Thread(target=_warning_thread, daemon=True)
        t.start()

    @classmethod
    def show_vision_warning(cls, alert_type, message):
        """Hiển thị nhắc nhở sức khỏe cục bộ sau khi Service đã lưu cảnh báo."""
        titles = {
            "eye_distance_warning": "Hãy ngồi xa màn hình hơn",
            "posture_warning": "Hãy điều chỉnh tư thế",
        }

        def _warning_thread():
            cls._display_toast(
                titles.get(alert_type, "Nhắc nhở tư thế"),
                message,
            )

        threading.Thread(target=_warning_thread, daemon=True).start()
