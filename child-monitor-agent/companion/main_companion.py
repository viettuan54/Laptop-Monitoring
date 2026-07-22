import time
import ctypes
import logging
import threading
from pipe_client import PipeClient
from app_tracker import AppTracker
from ui_alerts import UIAlerts

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def lock_windows_session():
    """Khóa màn hình Windows."""
    try:
        logging.info("Executing LockWorkStation...")
        ctypes.windll.user32.LockWorkStation()
    except Exception as e:
        logging.error(f"Failed to lock workstation: {e}")

def handle_policy_response(policy_response):
    """Xử lý kết quả phản hồi policy từ Service (chặn hoặc đếm ngược khóa máy)."""
    if not policy_response or not isinstance(policy_response, dict):
        return

    should_lock = policy_response.get("should_lock", False)
    reason = policy_response.get("reason", "")
    countdown_minutes = policy_response.get("countdown_minutes", 0)

    if countdown_minutes > 0 and not should_lock:
        logging.warning(f"Approaching time limit warning: {countdown_minutes}m remaining")
        UIAlerts.show_countdown_warning(minutes=countdown_minutes, reason="Sắp hết thời gian sử dụng máy tính cho phép trong ngày!")
    elif should_lock:
        logging.warning(f"Lock policy triggered: {reason}")
        lock_windows_session()

def start_ping_timer(pipe_client, interval=30):
    """
    Worker thread gửi PING định kỳ mỗi 30 giây để kiểm tra policy
    bất kể người dùng có chuyển ứng dụng hay không.
    """
    def _ping_loop():
        logging.info("Companion PING timer loop started (30s interval)")
        while True:
            try:
                policy_response = pipe_client.send_ping()
                handle_policy_response(policy_response)
            except Exception as e:
                logging.error(f"PING timer loop error: {e}")
            time.sleep(interval)

    t = threading.Thread(target=_ping_loop, daemon=True)
    t.start()

def main():
    logging.info("UI Companion started in User Session.")
    pipe_client = PipeClient()
    tracker = AppTracker(pipe_client)

    # Khởi chạy luồng timer 30s PING kiểm tra policy
    start_ping_timer(pipe_client, interval=30)

    while True:
        try:
            policy_response = tracker.poll()
            handle_policy_response(policy_response)
        except Exception as e:
            logging.error(f"Companion loop error: {e}")

        time.sleep(3)

if __name__ == "__main__":
    main()

