import time
import ctypes
import logging
import threading
import os
import sys
import win32api
import win32event
from logging.handlers import RotatingFileHandler
from pipe_client import PipeClient
from app_tracker import AppTracker
from web_tracker import WebTracker
from ui_alerts import UIAlerts
from edge_vision import EdgeVisionMonitor
from runtime_paths import agent_root

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

INSTANCE_MUTEX_NAME = r"Local\ChildMonitorCompanion"
ERROR_ALREADY_EXISTS = 183
_instance_mutex = None


def configure_file_logging():
    """Persist diagnostics because the packaged Companion has no console window."""
    local_app_data = os.environ.get("LOCALAPPDATA") or os.path.join(
        os.path.expanduser("~"), "AppData", "Local"
    )
    log_dir = os.path.join(local_app_data, "ChildMonitorAgent", "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "companion.log")
    root_logger = logging.getLogger()
    if not any(
        isinstance(handler, RotatingFileHandler)
        and os.path.abspath(getattr(handler, "baseFilename", "")) == os.path.abspath(log_path)
        for handler in root_logger.handlers
    ):
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=1024 * 1024,
            backupCount=2,
            encoding="utf-8",
        )
        file_handler.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s")
        )
        root_logger.addHandler(file_handler)


def acquire_single_instance():
    """Allow exactly one Companion in each interactive Windows session."""
    global _instance_mutex
    mutex = win32event.CreateMutex(None, False, INSTANCE_MUTEX_NAME)
    if win32api.GetLastError() == ERROR_ALREADY_EXISTS:
        mutex.Close()
        return False
    _instance_mutex = mutex
    return True

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

def start_ping_timer(pipe_client, response_callback=None, interval=30):
    """
    Worker thread gửi PING định kỳ mỗi 30 giây để kiểm tra policy
    bất kể người dùng có chuyển ứng dụng hay không.
    """
    def _ping_loop():
        logging.info("Companion PING timer loop started (30s interval)")
        while True:
            try:
                policy_response = pipe_client.send_ping()
                if response_callback:
                    response_callback(policy_response)
                handle_policy_response(policy_response)
            except Exception as e:
                logging.error(f"PING timer loop error: {e}")
            time.sleep(interval)

    t = threading.Thread(target=_ping_loop, daemon=True)
    t.start()


def start_web_tracker(web_tracker, interval=3):
    """Keep Chromium SQLite work away from foreground app tracking."""
    def _web_loop():
        logging.info("Browser history tracker loop started")
        while True:
            try:
                web_tracker.poll()
            except Exception as error:
                logging.error("Browser history tracker loop error: %s", error, exc_info=True)
            time.sleep(interval)

    thread = threading.Thread(target=_web_loop, daemon=True, name="WebTracker")
    thread.start()
    return thread

def main():
    configure_file_logging()
    logging.info("UI Companion started in User Session.")
    pipe_client = PipeClient()
    tracker = AppTracker(pipe_client)
    web_tracker = WebTracker(pipe_client)
    vision_monitor = EdgeVisionMonitor(
        pipe_client,
        warning_callback=UIAlerts.show_vision_warning,
    )
    vision_monitor.start()
    start_web_tracker(web_tracker)

    # Khởi chạy luồng timer 30s PING kiểm tra policy
    start_ping_timer(
        pipe_client,
        response_callback=vision_monitor.update_config,
        interval=30,
    )

    try:
        while True:
            try:
                policy_response = tracker.poll()
                vision_monitor.update_config(policy_response)
                handle_policy_response(policy_response)

            except Exception as e:
                logging.error(f"Companion loop error: {e}")

            time.sleep(3)
    finally:
        vision_monitor.stop()
        try:
            handle_policy_response(tracker.flush())
        except Exception as e:
            logging.error(f"Failed to flush app usage during shutdown: {e}")


def run_self_test():
    """Verify native Edge AI imports and external model deployment."""
    import cv2

    from mediapipe_runtime import load_mediapipe

    mediapipe = load_mediapipe()
    models_dir = os.path.join(agent_root(), "models")
    missing = [
        name
        for name in ("face_landmarker.task", "pose_landmarker_lite.task")
        if not os.path.isfile(os.path.join(models_dir, name))
    ]
    if missing:
        raise FileNotFoundError("Missing Edge AI models: " + ", ".join(missing))

    face_landmarker = mediapipe.tasks.vision.FaceLandmarker.create_from_options(
        mediapipe.tasks.vision.FaceLandmarkerOptions(
            base_options=mediapipe.tasks.BaseOptions(
                model_asset_path=os.path.join(models_dir, "face_landmarker.task")
            )
        )
    )
    face_landmarker.close()
    pose_landmarker = mediapipe.tasks.vision.PoseLandmarker.create_from_options(
        mediapipe.tasks.vision.PoseLandmarkerOptions(
            base_options=mediapipe.tasks.BaseOptions(
                model_asset_path=os.path.join(models_dir, "pose_landmarker_lite.task")
            )
        )
    )
    pose_landmarker.close()
    print(
        "ChildMonitorCompanion self-test passed. "
        f"MediaPipe={mediapipe.__version__}, OpenCV={cv2.__version__}"
    )
    return 0

if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(run_self_test())
    configure_file_logging()
    if not acquire_single_instance():
        logging.info("Another Companion instance already owns this user session; exiting.")
        sys.exit(0)
    try:
        main()
    finally:
        if _instance_mutex:
            _instance_mutex.Close()
