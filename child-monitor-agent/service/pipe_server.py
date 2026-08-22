import os
import time
import json
import logging
import queue
import re
import threading
import uuid
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
from urllib.parse import urlparse

import win32pipe
import win32file
import win32security
import win32con

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


MAX_APP_SEGMENT_SECONDS = 120
NON_USAGE_APPS = frozenset({"lockapp.exe", "logonui.exe"})

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
        self.classification_queue = queue.Queue()
        self.classification_pending = set()
        self.classification_lock = threading.Lock()

    @staticmethod
    def validate_app_tracking_payload(message):
        """Validate the untrusted Companion payload before it affects limits."""
        app_name = message.get("app_name")
        start_time = message.get("start_time")
        end_time = message.get("end_time")
        duration_seconds = message.get("duration_seconds")
        client_record_id = message.get("client_record_id")
        product_name = message.get("product_name")
        file_description = message.get("file_description")

        if not isinstance(app_name, str):
            raise ValueError("Invalid app tracking name")
        app_name = app_name.strip()
        if (
            not app_name
            or len(app_name) > 150
            or any(ord(char) < 32 or ord(char) == 127 for char in app_name)
            or "/" in app_name
            or "\\" in app_name
        ):
            raise ValueError("Invalid app tracking name")
        if app_name.casefold() in NON_USAGE_APPS:
            raise ValueError("Locked-session processes are not active usage")

        if (
            isinstance(duration_seconds, bool)
            or not isinstance(duration_seconds, int)
            or duration_seconds <= 0
            or duration_seconds > MAX_APP_SEGMENT_SECONDS
        ):
            raise ValueError("Invalid app tracking duration")

        parsed_times = []
        for label, value in (("start", start_time), ("end", end_time)):
            if not isinstance(value, str) or not value or len(value) > 64:
                raise ValueError(f"Invalid app tracking {label} time")
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError(f"App tracking {label} time must include a UTC offset")
            parsed_times.append(parsed)

        elapsed_seconds = (parsed_times[1] - parsed_times[0]).total_seconds()
        if elapsed_seconds <= 0 or elapsed_seconds > MAX_APP_SEGMENT_SECONDS:
            raise ValueError("Invalid app tracking timestamp interval")

        try:
            canonical_record_id = str(uuid.UUID(str(client_record_id)))
        except (ValueError, TypeError, AttributeError):
            raise ValueError("Invalid app tracking client record ID") from None
        if canonical_record_id != client_record_id:
            raise ValueError("App tracking client record ID must be canonical")

        metadata = {}
        for field, value in (
            ("product_name", product_name),
            ("file_description", file_description),
        ):
            if value is None:
                metadata[field] = None
                continue
            if (
                not isinstance(value, str)
                or not value.strip()
                or len(value.strip()) > 150
                or any(ord(char) < 32 or ord(char) == 127 for char in value)
                or "\\" in value
                or re.search(r"(?:^|[^\s])/|/(?:$|[^\s])", value)
            ):
                raise ValueError(f"Invalid app tracking {field}")
            metadata[field] = " ".join(value.strip().split())

        return {
            "app_name": app_name,
            "start_time": start_time,
            "end_time": end_time,
            "duration_seconds": duration_seconds,
            "client_record_id": canonical_record_id,
            **metadata,
        }

    def _app_classification_enabled(self):
        settings = self.enforcement_core.load_cached_settings()
        return settings.get("enable_app_classification") is True

    def classify_app(
        self,
        app_name,
        product_name=None,
        file_description=None,
        allow_remote_fallback=True,
    ):
        """Classify executable identity without blocking the Named Pipe on Gemini."""
        if not self._app_classification_enabled():
            return {"category": "unknown", "source": "disabled", "confidence": None}

        if self.content_classifier is not None:
            try:
                local_result = self.content_classifier.classify_app(
                    app_name,
                    product_name=product_name,
                    file_description=file_description,
                )
                if local_result["label"] is not None:
                    decision_source = local_result.get("decision_source")
                    source = (
                        decision_source
                        if decision_source in {"exact_lookup", "trained_model", "gemini"}
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
                logging.error("Local app classification failed: %s", error)

        if allow_remote_fallback and self.api_client is not None:
            category = self.api_client.classify_app(
                app_name,
                product_name=product_name,
                file_description=file_description,
            )
            if category is not None:
                if self.content_classifier is not None:
                    try:
                        self.content_classifier.remember_app_label(
                            app_name, category, source="gemini"
                        )
                    except Exception as error:
                        logging.warning("Could not cache Gemini app label: %s", error)
                return {"category": category, "source": "gemini", "confidence": None}

        return {"category": "unknown", "source": "pending", "confidence": None}

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

    def record_blocked_web_attempt(self, domain, scheme="https"):
        """Persist a real connection redirected to the local block sink."""
        if scheme not in {"http", "https"}:
            return False
        policy = self.enforcement_core.get_web_domain_policy(domain)
        normalized = policy.get("domain")
        if not normalized or policy.get("blocked") is not True:
            return False

        cached_category = policy.get("category")
        if (
            self._web_classification_enabled()
            and cached_category in {"education", "entertainment", "social", "unsafe"}
        ):
            classification = {
                "category": cached_category,
                "source": "legacy_agent",
                "confidence": None,
            }
        else:
            classification = self.classify_web_domain(
                normalized,
                allow_remote_fallback=False,
            )

        client_record_id = str(uuid.uuid4())
        persisted_id, _inserted = self.offline_queue.enqueue_web_log(
            url=f"{scheme}://{normalized}/",
            domain=normalized,
            visit_time=datetime.now(timezone.utc).isoformat(),
            duration_seconds=0,
            page_title="Truy cập bị Agent chặn",
            category=classification["category"],
            classification_source=classification["source"],
            classification_confidence=classification["confidence"],
            client_record_id=client_record_id,
        )
        if not persisted_id:
            return False

        self.enforcement_core.remember_web_classification(
            normalized,
            classification["category"],
            classification["source"],
        )
        if classification["source"] == "pending":
            self._schedule_web_classification(normalized)
        logging.info(
            "Recorded blocked website attempt: domain=%s scheme=%s category=%s",
            normalized,
            scheme,
            classification["category"],
        )
        return True

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
            self.enforcement_core.remember_web_classification(
                domain,
                result["category"],
                result["source"],
            )
            if self.api_client.backfill_web_domain(
                domain,
                result["category"],
                result["source"],
                result["confidence"],
            ):
                updated += 1
        return updated

    def reclassify_unknown_app_logs(self, limit=25):
        """Backfill local and server-side unknown executable rows while enabled."""
        if not self._app_classification_enabled() or self.api_client is None:
            return 0
        by_name = {}
        for item in self.offline_queue.get_unknown_apps(limit=limit):
            if isinstance(item, dict) and item.get("app_name"):
                by_name[item["app_name"].casefold()] = item
        for item in self.api_client.get_unknown_apps(limit=limit):
            if not isinstance(item, dict) or not item.get("app_name"):
                continue
            key = item["app_name"].casefold()
            previous = by_name.get(key, {})
            by_name[key] = {
                "app_name": item["app_name"],
                "product_name": item.get("product_name") or previous.get("product_name"),
                "file_description": (
                    item.get("file_description") or previous.get("file_description")
                ),
            }
        updated = 0
        for item in list(by_name.values())[:limit]:
            result = self.classify_app(
                item["app_name"],
                product_name=item.get("product_name"),
                file_description=item.get("file_description"),
            )
            if result["source"] not in {"exact_lookup", "trained_model", "gemini"}:
                continue
            self.offline_queue.update_unknown_app_category(
                item["app_name"],
                result["category"],
                result["source"],
                result["confidence"],
            )
            if self.api_client.backfill_app(
                item["app_name"],
                result["category"],
                result["source"],
                result["confidence"],
            ):
                updated += 1
        return updated

    def _schedule_web_classification(self, domain):
        """Đánh thức worker nền cho một domain vừa có kết quả pending."""
        if not self.running or not self._web_classification_enabled():
            return False
        normalized = domain.lower()
        with self.classification_lock:
            if normalized in self.classification_pending:
                return False
            self.classification_pending.add(normalized)
        self.classification_queue.put(normalized)
        return True

    def _schedule_app_classification(
        self, app_name, product_name=None, file_description=None
    ):
        """Wake the background worker for one unresolved executable identity."""
        if not self.running or not self._app_classification_enabled():
            return False
        key = ("app", app_name.casefold())
        with self.classification_lock:
            if key in self.classification_pending:
                return False
            self.classification_pending.add(key)
        self.classification_queue.put({
            "kind": "app",
            "app_name": app_name,
            "product_name": product_name,
            "file_description": file_description,
            "pending_key": key,
        })
        return True

    def _classification_worker(self):
        """Chạy Gemini fallback ngoài luồng Named Pipe để ACK không bị chậm."""
        while self.running:
            try:
                item = self.classification_queue.get(timeout=1)
            except queue.Empty:
                continue
            if item is None:
                self.classification_queue.task_done()
                break
            pending_key = item
            try:
                if isinstance(item, dict) and item.get("kind") == "app":
                    pending_key = item["pending_key"]
                    result = self.classify_app(
                        item["app_name"],
                        product_name=item.get("product_name"),
                        file_description=item.get("file_description"),
                        allow_remote_fallback=True,
                    )
                    if result["source"] not in {"exact_lookup", "trained_model", "gemini"}:
                        continue
                    self.offline_queue.update_unknown_app_category(
                        item["app_name"],
                        result["category"],
                        result["source"],
                        result["confidence"],
                    )
                    if self.api_client is not None:
                        self.api_client.backfill_app(
                            item["app_name"],
                            result["category"],
                            result["source"],
                            result["confidence"],
                        )
                    logging.info(
                        "Completed app classification: app=%s category=%s source=%s",
                        item["app_name"], result["category"], result["source"],
                    )
                else:
                    domain = item
                    result = self.classify_web_domain(domain, allow_remote_fallback=True)
                    if result["source"] not in {"trained_model", "gemini"}:
                        continue
                    self.offline_queue.update_unknown_web_category(
                        domain,
                        result["category"],
                        result["source"],
                        result["confidence"],
                    )
                    self.enforcement_core.remember_web_classification(
                        domain,
                        result["category"],
                        result["source"],
                    )
                    if self.api_client is not None:
                        self.api_client.backfill_web_domain(
                            domain,
                            result["category"],
                            result["source"],
                            result["confidence"],
                        )
                    logging.info(
                        "Completed web classification: domain=%s category=%s source=%s",
                        domain, result["category"], result["source"],
                    )
            except Exception as error:
                logging.error(
                    "Immediate content classification failed for %s: %s",
                    item,
                    error,
                )
            finally:
                with self.classification_lock:
                    self.classification_pending.discard(pending_key)
                self.classification_queue.task_done()

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

    def set_user_sid(self, user_sid):
        """Set the DACL identity before the first listening pipe is created."""
        with self.lock:
            self.current_user_sid = user_sid

    @staticmethod
    def _interrupt_pipe_handle(pipe_handle):
        """Wake blocking ConnectNamedPipe/ReadFile without a cross-thread close.

        Closing a synchronous pipe handle from a different thread can wait for
        pending I/O forever. CancelIoEx lets the server thread leave the call
        and close its own handle before creating a pipe with the new DACL.
        """
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        cancel_io_ex = kernel32.CancelIoEx
        cancel_io_ex.argtypes = [wintypes.HANDLE, wintypes.LPVOID]
        cancel_io_ex.restype = wintypes.BOOL

        if cancel_io_ex(wintypes.HANDLE(int(pipe_handle)), None):
            return True

        error_code = ctypes.get_last_error()
        # ERROR_NOT_FOUND means there was no pending I/O in this small race
        # window. Disconnect a connected instance so the server can still
        # cycle; any failure means it already moved on by itself.
        if error_code == 1168:
            try:
                win32pipe.DisconnectNamedPipe(pipe_handle)
                return True
            except Exception:
                return False
        raise ctypes.WinError(error_code)

    def recreate_pipe(self, new_user_sid=None):
        """Recreate the next Pipe instance when the interactive user changes."""
        pipe_handle = None
        with self.lock:
            if self.current_user_sid == new_user_sid:
                return False
            self.current_user_sid = new_user_sid
            pipe_handle = self.client_handle

        logging.info("Recreating Pipe Server DACL for User SID: %s", new_user_sid)
        if pipe_handle:
            try:
                self._interrupt_pipe_handle(pipe_handle)
            except Exception as error:
                logging.warning("Could not interrupt Pipe Server I/O: %s", error)
        return True

    def start(self):
        """Khởi chạy luồng Named Pipe Server."""
        self.running = True
        thread = threading.Thread(target=self._server_loop, daemon=True)
        thread.start()
        classification_thread = threading.Thread(
            target=self._classification_worker,
            daemon=True,
            name="ContentClassificationWorker",
        )
        classification_thread.start()
        logging.info("Named Pipe Server thread started.")

    def stop(self):
        self.running = False
        self.classification_queue.put(None)
        # ConnectNamedPipe/ReadFile are blocking. Cancel their pending I/O and
        # let the server thread close its own handle; a cross-thread CloseHandle
        # can otherwise hang Service shutdown indefinitely.
        pipe_handle = None
        with self.lock:
            pipe_handle = self.client_handle
        if pipe_handle:
            try:
                self._interrupt_pipe_handle(pipe_handle)
            except Exception as error:
                logging.warning("Could not interrupt Pipe Server during stop: %s", error)

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
                app_payload = self.validate_app_tracking_payload(msg)
                classification = self.classify_app(
                    app_payload["app_name"],
                    product_name=app_payload.get("product_name"),
                    file_description=app_payload.get("file_description"),
                    allow_remote_fallback=False,
                )
                # Log + per-day counters commit atomically. A UUID retry cannot
                # insert the row or add its duration a second time.
                persisted_id, _ = self.offline_queue.record_app_usage(
                    category=classification["category"],
                    classification_source=classification["source"],
                    classification_confidence=classification["confidence"],
                    **app_payload,
                )
                if not persisted_id:
                    raise RuntimeError("Failed to persist app tracking segment")
                tracking_ack = persisted_id
                if classification["source"] == "pending":
                    self._schedule_app_classification(
                        app_payload["app_name"],
                        product_name=app_payload.get("product_name"),
                        file_description=app_payload.get("file_description"),
                    )

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
                self.enforcement_core.remember_web_classification(
                    domain,
                    classification["category"],
                    classification["source"],
                )
                if classification["source"] == "pending":
                    self._schedule_web_classification(domain)

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
