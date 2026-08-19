import os
import time
import json
import logging
import threading
import uuid
from datetime import datetime
from urllib.parse import urlparse

import win32pipe
import win32file
import win32security
import win32con

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class PipeServer:
    PIPE_NAME = r"\\.\pipe\ChildMonitorAgentPipe"
    VISION_ALERT_TYPES = {"posture_warning", "eye_distance_warning"}

    def __init__(
        self,
        offline_queue,
        enforcement_core,
        api_client=None,
        content_classifier=None,
        vision_subject_id=None,
    ):
        self.offline_queue = offline_queue
        self.enforcement_core = enforcement_core
        self.api_client = api_client
        self.content_classifier = content_classifier
        self.running = False
        self.client_handle = None
        self.current_user_sid = None
        self.lock = threading.Lock()
        self.vision_subject_id = vision_subject_id

    def _web_classification_enabled(self):
        settings = self.enforcement_core.load_cached_settings()
        return settings.get("enable_web_classification") is True

    def classify_web_domain(self, domain, allow_remote_fallback=True):
        """Classify locally first; optional remote fallback is reserved for workers.

        The Named Pipe request path must never wait for Gemini. Browser visits are
        persisted and acknowledged immediately with ``pending`` provenance, then
        the background backfill worker may resolve low-confidence domains.
        """
        if not self._web_classification_enabled():
            return {
                "category": "unknown",
                "source": "disabled",
                "confidence": None,
            }

        if self.content_classifier is not None:
            try:
                local_result = self.content_classifier.classify_web(domain)
                if local_result["label"] is not None:
                    source = (
                        "gemini"
                        if local_result.get("decision_source") == "gemini"
                        else "trained_model"
                    )
                    return {
                        "category": local_result["label"],
                        "source": source,
                        "confidence": (
                            None if source == "gemini" else local_result["confidence"]
                        ),
                    }
            except Exception as error:
                logging.error("Local web classification failed: %s", error)

        if allow_remote_fallback and self.api_client is not None:
            category = self.api_client.classify_web_domain(domain)
            if category is not None:
                if self.content_classifier is not None:
                    try:
                        self.content_classifier.remember_web_label(
                            domain, category, source="gemini"
                        )
                    except Exception as error:
                        logging.warning("Could not cache Gemini web label: %s", error)
                return {
                    "category": category,
                    "source": "gemini",
                    "confidence": None,
                }

        return {"category": "unknown", "source": "pending", "confidence": None}

    def reclassify_unknown_web_logs(self, limit=25):
        """Backfill local and server-side legacy unknown rows while enabled."""
        if not self._web_classification_enabled() or self.api_client is None:
            return 0
        domains = set(self.offline_queue.get_unknown_web_domains(limit=limit))
        domains.update(self.api_client.get_unknown_web_domains(limit=limit))
        updated = 0
        for domain in sorted(domains)[:limit]:
            result = self.classify_web_domain(domain)
            if result["source"] not in {"trained_model", "gemini"}:
                continue
            self.offline_queue.update_unknown_web_category(
                domain,
                result["category"],
                result["source"],
                result["confidence"],
            )
            if self.api_client.backfill_web_domain(
                domain,
                result["category"],
                result["source"],
                result["confidence"],
            ):
                updated += 1
        return updated

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
        # Fail closed khi chưa có user_sid: chỉ SYSTEM và Administrators được phép.
        # Watchdog sẽ recreate pipe với đúng SID trước khi spawn Companion.

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
        # ConnectNamedPipe/ReadFile là blocking; đóng handle để đánh thức server loop.
        with self.lock:
            if self.client_handle:
                try:
                    win32file.CloseHandle(self.client_handle)
                except Exception:
                    pass
                self.client_handle = None

    def _server_loop(self):
        while self.running:
            sa = self.create_security_attributes(user_sid=self.current_user_sid)
            pipe_handle = None
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

                # Lưu cả listening handle trước ConnectNamedPipe. Nhờ vậy Watchdog
                # có thể đóng listener fail-closed ban đầu và recreate với đúng SID.
                with self.lock:
                    self.client_handle = pipe_handle

                # Chờ kết nối từ Client (UI Companion)
                win32pipe.ConnectNamedPipe(pipe_handle, None)

                self._handle_client(pipe_handle)

            except Exception as e:
                if self.running:
                    logging.error(f"Pipe server error: {e}")
                    time.sleep(1)
            finally:
                # Bao phủ cả lỗi xảy ra trước khi _handle_client được gọi.
                with self.lock:
                    if pipe_handle is not None and self.client_handle == pipe_handle:
                        self.client_handle = None
                if pipe_handle is not None:
                    try:
                        win32file.CloseHandle(pipe_handle)
                    except Exception:
                        pass

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
                if self.client_handle == pipe_handle:
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
            tracking_ack = None

            if action == "TRACK_APP":
                app_name = msg.get("app_name")
                start_time = msg.get("start_time")
                end_time = msg.get("end_time")
                duration_seconds = msg.get("duration_seconds", 0)
                client_record_id = msg.get("client_record_id")

                if app_name and start_time and duration_seconds > 0:
                    # Ghi vào SQLite offline queue
                    persisted_id, inserted = self.offline_queue.enqueue_app_log(
                        app_name=app_name,
                        start_time=start_time,
                        end_time=end_time,
                        duration_seconds=duration_seconds,
                        category="unknown",
                        client_record_id=client_record_id
                    )
                    if not persisted_id:
                        raise RuntimeError("Failed to persist app tracking segment")
                    tracking_ack = persisted_id
                    # Retry cùng client_record_id không được cộng thời gian lần hai.
                    if inserted:
                        self.offline_queue.add_daily_usage(duration_seconds)

            elif action == "TRACK_WEB":
                url = msg.get("url")
                domain = msg.get("domain")
                visit_time = msg.get("visit_time")
                duration_seconds = msg.get("duration_seconds", 0)
                page_title = msg.get("page_title")
                client_record_id = msg.get("client_record_id")

                if not isinstance(url, str) or not url or len(url) > 500:
                    raise ValueError("Invalid web tracking URL")
                parsed_url = urlparse(url)
                if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
                    raise ValueError("Web tracking URL must use HTTP(S)")
                if not isinstance(domain, str) or not domain or len(domain) > 200:
                    raise ValueError("Invalid web tracking domain")
                if parsed_url.hostname.lower() != domain.lower():
                    raise ValueError("Web tracking domain does not match URL")
                if not isinstance(visit_time, str) or len(visit_time) > 64:
                    raise ValueError("Invalid web tracking visit time")
                datetime.fromisoformat(visit_time.replace("Z", "+00:00"))
                if (
                    isinstance(duration_seconds, bool)
                    or not isinstance(duration_seconds, int)
                    or duration_seconds < 0
                    or duration_seconds > 86400
                ):
                    raise ValueError("Invalid web tracking duration")
                if page_title is not None and (
                    not isinstance(page_title, str) or len(page_title) > 500
                ):
                    raise ValueError("Invalid web tracking page title")
                try:
                    canonical_record_id = str(uuid.UUID(str(client_record_id)))
                except (ValueError, TypeError, AttributeError):
                    raise ValueError("Invalid web tracking client record ID")
                if canonical_record_id != client_record_id:
                    raise ValueError("Web tracking client record ID must be canonical")

                classification = self.classify_web_domain(
                    domain,
                    allow_remote_fallback=False,
                )
                persisted_id, _ = self.offline_queue.enqueue_web_log(
                    url=url,
                    domain=domain.lower(),
                    visit_time=visit_time,
                    duration_seconds=duration_seconds,
                    page_title=page_title,
                    category=classification["category"],
                    classification_source=classification["source"],
                    classification_confidence=classification["confidence"],
                    client_record_id=client_record_id,
                )
                if not persisted_id:
                    raise RuntimeError("Failed to persist browser visit")
                tracking_ack = persisted_id

            elif action == "PING":
                # Action PING chỉ kiểm tra chính sách mà không ghi nhận sự kiện theo dõi ứng dụng mới
                pass

            elif action == "VISION_ALERT":
                alert_type = msg.get("alert_type")
                message = msg.get("message")
                if alert_type not in self.VISION_ALERT_TYPES:
                    raise ValueError("Invalid Edge AI alert type")
                if not isinstance(message, str):
                    raise ValueError("Vision alert message must be text")
                message = message.strip()
                if not message or len(message) > 500:
                    raise ValueError("Vision alert message length is invalid")
                if any(ord(char) < 32 or ord(char) == 127 for char in message):
                    raise ValueError("Vision alert message contains control characters")
                persisted_id, _ = self.offline_queue.enqueue_vision_alert(
                    alert_type,
                    message,
                )
                if not persisted_id:
                    raise RuntimeError("Failed to persist vision alert")

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
                "countdown_minutes": countdown_minutes,
                "vision_config": self._get_vision_config(),
            }
            if tracking_ack:
                response_payload["tracking_ack"] = tracking_ack
            response_bytes = json.dumps(response_payload).encode('utf-8')
            win32file.WriteFile(pipe_handle, response_bytes)

        except Exception as e:
            # Never leave both ends blocked (server waiting for another message
            # while Companion waits forever for this response). Return a generic
            # retryable error, then let _handle_client close this pipe instance.
            logging.error("Error processing pipe message: %s", e, exc_info=True)
            try:
                error_payload = json.dumps({
                    "error": "processing_failed",
                    "retryable": True,
                }).encode("utf-8")
                win32file.WriteFile(pipe_handle, error_payload)
            except Exception:
                pass
            raise

    def _get_vision_config(self):
        """Chỉ bật camera khi cờ đồng thuận đã được cache từ backend."""
        settings = self.enforcement_core.load_cached_settings()
        return {
            "enabled": settings.get("enable_webcam_monitoring") is True,
            "subject_id": self.vision_subject_id,
            "camera_index": settings.get("vision_camera_index", 0),
            "sample_interval_seconds": settings.get("vision_sample_interval_seconds", 0.5),
            "alert_hold_seconds": settings.get("vision_alert_hold_seconds", 5.0),
            "alert_cooldown_seconds": settings.get("vision_alert_cooldown_seconds", 300.0),
            "min_eye_distance_cm": settings.get("vision_min_eye_distance_cm", 35.0),
            "camera_horizontal_fov_degrees": settings.get("vision_camera_horizontal_fov_degrees", 60.0),
            "assumed_ipd_cm": settings.get("vision_assumed_ipd_cm", 6.3),
            "eye_distance_calibration_scale_cm": settings.get("vision_eye_distance_calibration_scale_cm", 0.0),
            "max_neck_angle_degrees": settings.get("vision_max_neck_angle_degrees", 25.0),
            "max_torso_angle_degrees": settings.get("vision_max_torso_angle_degrees", 18.0),
            "max_shoulder_tilt_degrees": settings.get("vision_max_shoulder_tilt_degrees", 12.0),
        }

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
