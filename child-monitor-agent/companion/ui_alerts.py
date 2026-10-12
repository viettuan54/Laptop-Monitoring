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
    def show_app_block_notice(app_name, grace_seconds=8):
        def show():
            try:
                ctypes.windll.user32.MessageBoxTimeoutW(
                    0,
                    f"{app_name} thuộc nhóm bị phụ huynh chặn. Ứng dụng đang được đóng; "
                    f"nếu còn mở, Agent sẽ buộc thoát sau {grace_seconds} giây.",
                    "LaptopChildren · Chặn ứng dụng", 0x30, 0, 4000,
                )
            except Exception:
                logging.warning("Could not display application block notice")
        threading.Thread(target=show, daemon=True, name="AppBlockNotice").start()

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

    @classmethod
    def show_screenshot_notice(cls):
        """Visible notice before each capture; called only by the capture worker."""
        title = "LaptopChildren · Giám sát màn hình"
        message = "Phụ huynh đã bật giám sát màn hình. Agent sắp chụp và gửi ảnh màn hình cho phụ huynh."
        try:
            # Auto-dismiss before capture so the notice does not obscure the image.
            ctypes.windll.user32.MessageBoxTimeoutW(0, message, title, 0x40 | 0x1000, 0, 3000)
        except AttributeError:
            # Older Windows must still show a notice, even if acknowledgement is needed.
            cls._display_toast(title, message)
