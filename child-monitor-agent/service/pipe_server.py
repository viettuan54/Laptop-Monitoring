import os
import time
import json
import logging
import threading
import win32pipe
import win32file
import win32security
import win32con

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class PipeServer:
    PIPE_NAME = r"\\.\pipe\ChildMonitorAgentPipe"

    def __init__(self, offline_queue, enforcement_core):
        self.offline_queue = offline_queue
        self.enforcement_core = enforcement_core
        self.running = False
        self.client_handle = None
        self.current_user_sid = None
        self.lock = threading.Lock()

    def create_security_attributes(self, user_sid=None):
        """Tạo Security Attributes cho Named Pipe để bảo mật SYSTEM, Admins và User SID cụ thể."""
        sa = win32security.SECURITY_ATTRIBUTES()
        sa.bInheritHandle = False
        
        # Khởi tạo Security Descriptor
        sd = win32security.SECURITY_DESCRIPTOR()
        sd.Initialize()
        
        # Tạo DACL
        dacl = win32security.ACL()
        dacl.Initialize()

        # Add Full Control cho Local System & Admins
        sid_system = win32security.CreateWellKnownSid(win32security.WinLocalSystemSid)
        sid_admins = win32security.CreateWellKnownSid(win32security.WinBuiltinAdministratorsSid)

        dacl.AddAccessAllowedAce(win32security.ACL_REVISION, win32con.GENERIC_ALL, sid_system)
        dacl.AddAccessAllowedAce(win32security.ACL_REVISION, win32con.GENERIC_ALL, sid_admins)

        if user_sid:
            # Cho phép User SID cụ thể của Session đang đăng nhập kết nối
            dacl.AddAccessAllowedAce(win32security.ACL_REVISION, win32con.GENERIC_READ | win32con.GENERIC_WRITE, user_sid)
        else:
            # Fallback cho phép Everyone nếu chưa xác định được User SID
            sid_everyone = win32security.CreateWellKnownSid(win32security.WinWorldSid)
            dacl.AddAccessAllowedAce(win32security.ACL_REVISION, win32con.GENERIC_READ | win32con.GENERIC_WRITE, sid_everyone)

        sd.SetSecurityDescriptorDacl(1, dacl, 0)
        sa.SECURITY_DESCRIPTOR = sd
        return sa

    def recreate_pipe(self, new_user_sid=None):
        """Khởi tạo/Làm mới Pipe Instance khi có sự kiện đổi Session (Switch User)."""
        logging.info(f"Recreating Pipe Server DACL for User SID: {new_user_sid}")
        with self.lock:
            self.current_user_sid = new_user_sid
            if self.client_handle:
                try:
                    win32file.CloseHandle(self.client_handle)
                except Exception:
                    pass
                self.client_handle = None

    def start(self):
        """Khởi chạy luồng Named Pipe Server."""
        self.running = True
        thread = threading.Thread(target=self._server_loop, daemon=True)
        thread.start()
        logging.info("Named Pipe Server thread started.")

    def stop(self):
        self.running = False

    def _server_loop(self):
        while self.running:
            sa = self.create_security_attributes(user_sid=self.current_user_sid)
            try:
                # Tạo Named Pipe Server
                pipe_handle = win32pipe.CreateNamedPipe(
                    self.PIPE_NAME,
                    win32pipe.PIPE_ACCESS_DUPLEX,
                    win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                    win32pipe.PIPE_UNLIMITED_INSTANCES,
                    65536, 65536,
                    0,
                    sa
                )

                # Chờ kết nối từ Client (UI Companion)
                win32pipe.ConnectNamedPipe(pipe_handle, None)

                with self.lock:
                    self.client_handle = pipe_handle

                self._handle_client(pipe_handle)

            except Exception as e:
                if self.running:
                    logging.error(f"Pipe server error: {e}")
                    time.sleep(1)

    def _handle_client(self, pipe_handle):
        """Lắng nghe dữ liệu gửi từ UI Companion qua Pipe."""
        try:
            while self.running:
                result, data = win32file.ReadFile(pipe_handle, 65536)
                if result == 0 and data:
                    message_str = data.decode('utf-8')
                    self._process_client_message(message_str, pipe_handle)
        except Exception as e:
            logging.info(f"Companion client disconnected from Pipe: {e}")
        finally:
            with self.lock:
                self.client_handle = None
            try:
                win32file.CloseHandle(pipe_handle)
            except Exception:
                pass

    def _process_client_message(self, message_str, pipe_handle):
        """Xử lý thông điệp gửi lên từ UI Companion."""
        try:
            msg = json.loads(message_str)
            action = msg.get("action")

            if action == "TRACK_APP":
                app_name = msg.get("app_name")
                start_time = msg.get("start_time")
                end_time = msg.get("end_time")
                duration_seconds = msg.get("duration_seconds", 0)

                if app_name and start_time and duration_seconds > 0:
                    # Ghi vào SQLite offline queue
                    self.offline_queue.enqueue_app_log(
                        app_name=app_name,
                        start_time=start_time,
                        end_time=end_time,
                        duration_seconds=duration_seconds,
                        category="unknown"
                    )
                    # Cộng dồn thời gian dùng máy trong ngày
                    self.offline_queue.add_daily_usage(duration_seconds)

            elif action == "PING":
                # Action PING chỉ kiểm tra chính sách mà không ghi nhận sự kiện theo dõi ứng dụng mới
                pass

            # Kiểm tra trạng thái policy hiện tại để phản hồi cho Companion
            should_lock, reason, remaining_seconds = self.enforcement_core.check_policy_status()
            
            # Tính toán số phút đếm ngược cảnh báo nếu còn dưới 5 phút (300s)
            countdown_minutes = 0
            if not should_lock and 0 < remaining_seconds <= 300:
                countdown_minutes = max(1, int(remaining_seconds // 60))

            response_payload = {
                "should_lock": should_lock,
                "reason": reason,
                "remaining_seconds": remaining_seconds,
                "countdown_minutes": countdown_minutes
            }
            response_bytes = json.dumps(response_payload).encode('utf-8')
            win32file.WriteFile(pipe_handle, response_bytes)

        except Exception as e:
            logging.error(f"Error processing pipe message: {e}")

    def send_command_to_companion(self, command_dict):
        """Chủ động gửi lệnh (LOCK_NOW, WARNING...) tới Companion."""
        with self.lock:
            if not self.client_handle:
                return False
            try:
                payload_bytes = json.dumps(command_dict).encode('utf-8')
                win32file.WriteFile(self.client_handle, payload_bytes)
                return True
            except Exception as e:
                logging.error(f"Failed to send command to Companion via Pipe: {e}")
                return False
