import time
import ctypes
import logging
from pipe_client import PipeClient
from app_tracker import AppTracker

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def lock_windows_session():
    """Khóa màn hình Windows."""
    try:
        logging.info("Executing LockWorkStation...")
        ctypes.windll.user32.LockWorkStation()
    except Exception as e:
        logging.error(f"Failed to lock workstation: {e}")

def main():
    logging.info("UI Companion started in User Session.")
    pipe_client = PipeClient()
    tracker = AppTracker(pipe_client)

    while True:
        try:
            policy_response = tracker.poll()
            
            # Nếu nhận được phản hồi chính sách yêu cầu khóa máy
            if policy_response and isinstance(policy_response, dict):
                should_lock = policy_response.get("should_lock", False)
                reason = policy_response.get("reason", "")
                
                if should_lock:
                    logging.warning(f"Lock policy triggered: {reason}")
                    lock_windows_session()

        except Exception as e:
            logging.error(f"Companion loop error: {e}")

        time.sleep(3)

if __name__ == "__main__":
    main()
