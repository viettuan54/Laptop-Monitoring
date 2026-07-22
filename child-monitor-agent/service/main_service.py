import os
import sys
import time
import logging
import threading

try:
    import servicemanager
    import win32service
    import win32serviceutil
    ServiceBaseClass = win32serviceutil.ServiceFramework
except ImportError:
    servicemanager = None
    win32service = None
    win32serviceutil = None
    ServiceBaseClass = object

# Thêm thư mục hiện tại vào sys.path để import các module con
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from api_client import APIClient
from offline_queue import OfflineQueue
from enforcement_core import EnforcementCore
from web_tracker import WebTracker
from pipe_server import PipeServer
from watchdog import Watchdog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)

def run_forever(name, target_func, interval_seconds, *args):
    """
    Wrapper chạy vòng lặp vô tận cho một worker thread.
    Bắt toàn bộ exception để log và tự động tái khởi động sau `interval_seconds` giây,
    đảm bảo thread không bị chết âm thầm.
    """
    threading.current_thread().name = name
    logging.info(f"Worker thread [{name}] started.")
    while True:
        try:
            target_func(*args)
        except Exception as e:
            logging.error(f"Worker thread [{name}] crashed with error: {e}", exc_info=True)
        time.sleep(interval_seconds)

class ChildMonitorService(ServiceBaseClass):
    _svc_name_ = "ChildMonitorService"
    _svc_display_name_ = "Child Monitoring Agent Service"
    _svc_description_ = "Dịch vụ giám sát và thực thi chính sách an toàn cho laptop trẻ em."

    def __init__(self, args=None):
        if not args:
            args = [self._svc_name_]
        if win32serviceutil and ServiceBaseClass != object:
            try:
                super().__init__(args)
            except Exception as e:
                logging.debug(f"ServiceFramework init skipped: {e}")
        self.stop_event = threading.Event()
        self.api_client = None
        self.offline_queue = None
        self.enforcement_core = None
        self.web_tracker = None
        self.pipe_server = None
        self.watchdog = None

    def SvcStop(self):
        if win32service:
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        logging.info("Service stopping signal received...")
        self.stop_event.set()
        if self.pipe_server:
            self.pipe_server.stop()
        if self.watchdog:
            self.watchdog.stop()

    def SvcDoRun(self):
        if servicemanager:
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.SIC_GENERIC_MESSAGE,
                (self._svc_name_, "Service started successfully.")
            )
        self.main()

    def main(self):
        logging.info("Initializing ChildMonitorService modules...")
        
        # Khởi tạo các module lõi
        self.api_client = APIClient()
        self.offline_queue = OfflineQueue(api_client=self.api_client)
        self.enforcement_core = EnforcementCore(offline_queue=self.offline_queue)
        self.web_tracker = WebTracker(offline_queue=self.offline_queue)
        self.pipe_server = PipeServer(offline_queue=self.offline_queue, enforcement_core=self.enforcement_core)
        
        # Truyền reference của pipe_server vào Watchdog để tái tạo DACL khi đổi session
        self.watchdog = Watchdog(pipe_server=self.pipe_server)

        # 1. Khởi chạy Named Pipe Server
        self.pipe_server.start()

        # 2. Khởi chạy Watchdog (spawn Companion & theo dõi session)
        self.watchdog.start()

        # 3. Khởi tạo các Worker Thread tự phục hồi (run_forever)
        threads = [
            threading.Thread(
                target=run_forever,
                args=("HeartbeatLoop", self._heartbeat_loop_step, 60),
                daemon=True
            ),
            threading.Thread(
                target=run_forever,
                args=("ConfigBlacklistLoop", self._config_blacklist_loop_step, 600),
                daemon=True
            ),
            threading.Thread(
                target=run_forever,
                args=("WebTrackerLoop", self._web_tracker_loop_step, 15),
                daemon=True
            ),
            threading.Thread(
                target=run_forever,
                args=("OfflineSyncLoop", self._offline_sync_loop_step, 60),
                daemon=True
            )
        ]

        for t in threads:
            t.start()

        # Thực hiện 1 lần nạp config ban đầu ngay khi start
        try:
            self._config_blacklist_loop_step()
        except Exception as e:
            logging.warning(f"Initial config fetch failed: {e}")

        logging.info("All ChildMonitorService background worker threads initialized.")

        # Giữ luồng chính chạy cho đến khi nhận lệnh dừng
        while not self.stop_event.is_set():
            time.sleep(1)

        logging.info("ChildMonitorService terminated cleanly.")

    def _heartbeat_loop_step(self):
        """Heartbeat Loop (60s): Báo cáo trạng thái hoạt động của Agent lên Backend."""
        logging.info("Sending heartbeat to backend...")
        res = self.api_client.post("/api/agent/heartbeat", data={})
        if res and res.status_code == 200:
            logging.info("Heartbeat acknowledged by backend.")
        else:
            status = res.status_code if res else "No Response"
            logging.warning(f"Heartbeat response status: {status}")

    def _config_blacklist_loop_step(self):
        """
        Config & Blacklist Loop (10 phút): Lấy cài đặt + tên miền bị chặn từ Backend
        và gọi enforcement_core.save_settings_cache để cập nhật file hosts & local policy cache.
        """
        logging.info("Fetching latest config and blacklisted domains from backend...")
        data = self.api_client.get_config()
        if data and isinstance(data, dict):
            config = data.get("config") or data.get("settings") or {}
            blacklisted_domains = data.get("blacklisted_domains") or data.get("blacklist") or []
            logging.info(f"Received config update. Blacklisted domains count: {len(blacklisted_domains)}")
            self.enforcement_core.save_settings_cache(config, blacklisted_domains)
        else:
            logging.warning("Failed to retrieve valid config from backend.")

    def _web_tracker_loop_step(self):
        """Web Tracker Loop (15s): Đọc lịch sử trình duyệt mới và đẩy vào offline queue."""
        self.web_tracker.track()

    def _offline_sync_loop_step(self):
        """Offline Log Sync Loop (60s): Đồng bộ log trong SQLite queue lên backend."""
        self.offline_queue.sync_offline_data(self.api_client)

if __name__ == "__main__":
    if len(sys.argv) > 1 and win32serviceutil:
        win32serviceutil.HandleCommandLine(ChildMonitorService)
    else:
        # Chạy ở dạng Standalone Script (Dev Mode) khi không truyền tham số CLI
        logging.info("Starting ChildMonitorService in Standalone / Dev mode...")
        service_inst = ChildMonitorService(["ChildMonitorService"])
        try:
            service_inst.main()
        except KeyboardInterrupt:
            logging.info("Standalone service stopped by KeyboardInterrupt.")
            service_inst.SvcStop()
