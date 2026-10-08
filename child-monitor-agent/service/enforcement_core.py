import os
import sys
import json
import logging
import threading
import re
import time
from datetime import datetime

from runtime_paths import agent_root
from text_privacy import POLICY_LEASE_SECONDS, policy_enabled

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class EnforcementCore:
    HOSTS_MARKER_START = "# === LAPTOP-MONITOR START ==="
    HOSTS_MARKER_END = "# === LAPTOP-MONITOR END ==="
    BLOCK_SINK_ADDRESS = "127.0.0.2"
    DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
    WEB_POLICY_CATEGORIES = {
        "education",
        "entertainment",
        "social",
        "unsafe",
        "unknown",
    }
    MAX_CLASSIFIED_DOMAINS = 5000

    def __init__(self, offline_queue, config_dir=None):
        self.offline_queue = offline_queue
        if config_dir is None:
            config_dir = os.path.join(agent_root(), "config")

        self.settings_cache_path = os.path.join(config_dir, "settings_cache.json")
        self.web_classification_cache_path = os.path.join(
            config_dir,
            "web_classification_cache.json",
        )
        self.hosts_path = r"C:\Windows\System32\drivers\etc\hosts"
        self.lock = threading.Lock()
        self.cache_lock = threading.RLock()
        self._screenshot_policy = {"enabled": False}
        self._screenshot_policy_deadline = 0
        if hasattr(self.offline_queue, "set_text_policy_provider"):
            self.offline_queue.set_text_policy_provider(self.get_text_moderation_policy)

    def load_cached_settings(self):
        """Đọc cài đặt settings và blacklist đã được cache từ file JSON."""
        with self.cache_lock:
            if os.path.exists(self.settings_cache_path):
                try:
                    with open(self.settings_cache_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        return data
                    logging.error("Settings cache must contain a JSON object.")
                except Exception as e:
                    logging.error(f"Failed to read settings cache: {e}")

        # Config mặc định an toàn nếu chưa có cache
        return {
            "daily_limit_minutes": 120,
            "allowed_start_time": "07:00:00",
            "allowed_end_time": "21:00:00",
            "is_locked": False,
            "enable_webcam_monitoring": False,
            "enable_text_moderation": False,
            "enable_app_classification": False,
            "enable_web_classification": False,
            "blocked_app_categories": [],
            "blocked_web_categories": [],
            "policy_blocked_domains": [],
            "blacklisted_domains": []
        }

    def get_text_moderation_policy(self):
        if getattr(self.offline_queue, "_text_storage_allowed", True) is False:
            return {"enabled": False}
        settings = self.load_cached_settings()
        policy = {
            "enabled": settings.get("enable_text_moderation") is True,
            "issued_at": settings.get("text_policy_issued_at"),
            "expires_at": settings.get("text_policy_expires_at"),
            "enabled_since": settings.get("text_policy_enabled_since"),
        }
        if not policy_enabled(policy):
            return {"enabled": False}
        return policy

    def get_screenshot_policy(self):
        """Screenshot consent is memory-only and must be renewed by the backend."""
        with self.cache_lock:
            remaining = self._screenshot_policy_deadline - time.monotonic()
            if remaining <= 0 or self._screenshot_policy.get("enabled") is not True:
                return {"enabled": False}
            return {**self._screenshot_policy, "valid_for_seconds": remaining}

    def load_web_classification_cache(self):
        """Đọc ánh xạ domain -> nhãn AI đã xác nhận trên thiết bị này."""
        with self.cache_lock:
            if not os.path.exists(self.web_classification_cache_path):
                return {}
            try:
                with open(
                    self.web_classification_cache_path,
                    "r",
                    encoding="utf-8",
                ) as stream:
                    payload = json.load(stream)
                domains = payload.get("domains", {}) if isinstance(payload, dict) else {}
                if not isinstance(domains, dict):
                    return {}
                safe = {}
                for domain, category in domains.items():
                    normalized = self.normalize_domain(domain)
                    if normalized and category in self.WEB_POLICY_CATEGORIES:
                        safe[normalized] = category
                return safe
            except Exception as error:
                logging.error("Failed to read web classification cache: %s", error)
                return {}

    @staticmethod
    def _write_json_atomic(path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        temporary_path = f"{path}.{os.getpid()}.tmp"
        with open(temporary_path, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)

    def _effective_blocked_domains(self, settings=None, classifications=None):
        settings = settings if isinstance(settings, dict) else self.load_cached_settings()
        classifications = (
            classifications
            if isinstance(classifications, dict)
            else self.load_web_classification_cache()
        )
        effective = set()
        for domain in settings.get("blacklisted_domains", []):
            normalized = self.normalize_domain(domain)
            if normalized:
                effective.add(normalized)

        # Tắt phân loại cũng tạm dừng policy theo danh mục, đúng với Dashboard.
        if settings.get("enable_web_classification") is True:
            for domain in settings.get("policy_blocked_domains", []):
                normalized = self.normalize_domain(domain)
                if normalized:
                    effective.add(normalized)
            blocked_categories = {
                category
                for category in settings.get("blocked_web_categories", [])
                if category in self.WEB_POLICY_CATEGORIES
            }
            for domain, category in classifications.items():
                if category in blocked_categories:
                    effective.add(domain)
        return sorted(effective)

    def save_settings_cache(
        self,
        config_data,
        blacklisted_domains=None,
        policy_blocked_domains=None,
    ):
        """Lưu cài đặt settings và danh sách blacklist vào file cache cục bộ."""
        try:
            with self.cache_lock:
                existing = self.load_cached_settings()
                old_revision = existing.get("updated_at")
                new_revision = config_data.get("updated_at") if isinstance(config_data, dict) else None
                if old_revision:
                    try:
                        old_time = datetime.fromisoformat(old_revision.replace("Z", "+00:00"))
                        new_time = datetime.fromisoformat(new_revision.replace("Z", "+00:00"))
                        if new_time < old_time:
                            return  # Ignore an out-of-order heartbeat/config reply.
                    except (ValueError, TypeError, AttributeError):
                        # Do not renew a versioned text policy from an unversioned reply.
                        if isinstance(config_data, dict):
                            config_data = {**config_data, "enable_text_moderation": False}
                classifications = self.load_web_classification_cache()
                previous_domains = self._effective_blocked_domains(
                    existing,
                    classifications,
                )
                cache_data = existing.copy()
                if isinstance(config_data, dict):
                    cache_data.update(config_data)
                now = time.time()
                old_policy = {
                    "enabled": existing.get("enable_text_moderation") is True,
                    "issued_at": existing.get("text_policy_issued_at"),
                    "expires_at": existing.get("text_policy_expires_at"),
                    "enabled_since": existing.get("text_policy_enabled_since"),
                }
                # A successful backend config refresh is the only issuer. Do
                # not trust persisted True from an old or partial configuration.
                enabled = isinstance(config_data, dict) and config_data.get("enable_text_moderation") is True
                cache_data["enable_text_moderation"] = enabled
                cache_data["text_policy_issued_at"] = now
                cache_data["text_policy_expires_at"] = now + POLICY_LEASE_SECONDS
                cache_data["text_policy_enabled_since"] = (
                    old_policy["enabled_since"] if enabled and policy_enabled(old_policy, now) and old_revision == new_revision
                    else now if enabled else None
                )
                if blacklisted_domains is not None:
                    cache_data["blacklisted_domains"] = blacklisted_domains
                if policy_blocked_domains is not None:
                    cache_data["policy_blocked_domains"] = policy_blocked_domains
                self._write_json_atomic(self.settings_cache_path, cache_data)
                # A cached True on disk never authorizes capture after a restart.
                screenshot_enabled = (isinstance(config_data, dict)
                                      and config_data.get("enable_screenshot_review") is True
                                      and isinstance(new_revision, str))
                interval = config_data.get("screenshot_interval_seconds", 300) if isinstance(config_data, dict) else 300
                if not isinstance(interval, int) or isinstance(interval, bool) or not 60 <= interval <= 3600:
                    interval = 300
                self._screenshot_policy = {
                    "enabled": screenshot_enabled,
                    "revision": new_revision,
                    "interval_seconds": interval,
                    "request": config_data.get("screenshot_request") if screenshot_enabled else None,
                }
                self._screenshot_policy_deadline = time.monotonic() + 180
                current_domains = self._effective_blocked_domains(
                    cache_data,
                    classifications,
                )

            # Outside cache_lock: queue validation reads policy back from cache.
            if hasattr(self.offline_queue, "refresh_text_policy"):
                self.offline_queue.refresh_text_policy()

            # Heartbeat chứa policy category. Vì vậy chỉ cần policy đổi là hosts
            # được cập nhật trong chu kỳ 60 giây, không phải chờ config 10 phút.
            if previous_domains != current_domains:
                self.update_hosts_file(current_domains)
        except Exception as e:
            logging.error(f"Failed to save settings cache: {e}")

    def remember_web_classification(
        self,
        domain,
        category,
        classification_source=None,
    ):
        """Lưu nhãn đã phân loại và chặn ngay nếu category đang có policy block."""
        normalized = self.normalize_domain(domain)
        if not normalized or category not in self.WEB_POLICY_CATEGORIES:
            return False

        try:
            with self.cache_lock:
                settings = self.load_cached_settings()
                classifications = self.load_web_classification_cache()
                previous_domains = self._effective_blocked_domains(
                    settings,
                    classifications,
                )
                existing_category = classifications.get(normalized)
                # A pending low-confidence visit does not invalidate an older,
                # already confirmed category for the same domain.
                if category == "unknown" and existing_category not in {None, "unknown"}:
                    return normalized in previous_domains
                if classifications.get(normalized) == category:
                    return normalized in previous_domains

                # Pop + append keeps recently refreshed entries at the end so a
                # bounded cache can evict the oldest observations deterministically.
                classifications.pop(normalized, None)
                classifications[normalized] = category
                while len(classifications) > self.MAX_CLASSIFIED_DOMAINS:
                    classifications.pop(next(iter(classifications)))
                self._write_json_atomic(
                    self.web_classification_cache_path,
                    {"version": 1, "domains": classifications},
                )
                current_domains = self._effective_blocked_domains(
                    settings,
                    classifications,
                )

            if previous_domains != current_domains:
                self.update_hosts_file(current_domains)
            blocked = normalized in current_domains
            logging.info(
                "Website classification policy evaluated: domain=%s category=%s source=%s blocked=%s",
                normalized,
                category,
                classification_source or "unspecified",
                blocked,
            )
            return blocked
        except Exception as error:
            logging.error("Failed to persist website classification policy: %s", error)
            return False

    def apply_cached_web_policy(self):
        """Áp dụng lại blacklist + policy AI từ cache khi Service khởi động offline."""
        domains = self._effective_blocked_domains()
        self.update_hosts_file(domains)
        return domains

    def get_web_domain_policy(self, domain):
        """Return the canonical domain, cached category, and current block state."""
        normalized = self.normalize_domain(domain)
        if not normalized:
            return {"domain": None, "category": None, "blocked": False}
        with self.cache_lock:
            settings = self.load_cached_settings()
            classifications = self.load_web_classification_cache()
            blocked_domains = set(self._effective_blocked_domains(
                settings,
                classifications,
            ))
            return {
                "domain": normalized,
                "category": classifications.get(normalized),
                "blocked": normalized in blocked_domains,
            }

    def is_web_domain_blocked(self, domain):
        """Check a loopback connection host against the effective Agent policy."""
        return self.get_web_domain_policy(domain)["blocked"]

    def update_hosts_file(self, blacklisted_domains):
        """Cập nhật file C:\\Windows\\System32\\drivers\\etc\\hosts để chặn domain cấm chủ động."""
        with self.lock:
            try:
                if not os.path.exists(self.hosts_path):
                    logging.error(f"Hosts file not found at {self.hosts_path}")
                    return

                safe_domains = []
                seen_domains = set()
                for domain in blacklisted_domains:
                    clean_domain = self.normalize_domain(domain)
                    if clean_domain and clean_domain not in seen_domains:
                        safe_domains.append(clean_domain)
                        seen_domains.add(clean_domain)
                    elif not clean_domain:
                        logging.warning("Ignored invalid blacklist domain received from backend.")

                # Đọc nội dung file hosts hiện tại
                with open(self.hosts_path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()

                # Lọc bỏ khối nội dung giữa 2 marker cũ
                new_lines = []
                inside_block = False
                for line in lines:
                    if line.strip() == self.HOSTS_MARKER_START:
                        inside_block = True
                        continue
                    if line.strip() == self.HOSTS_MARKER_END:
                        inside_block = False
                        continue
                    if not inside_block:
                        new_lines.append(line)

                # Tạo khối nội dung chặn mới nếu có domain cấm
                if safe_domains:
                    new_lines.append(f"\n{self.HOSTS_MARKER_START}\n")
                    for clean_domain in safe_domains:
                        new_lines.append(f"{self.BLOCK_SINK_ADDRESS} {clean_domain}\n")
                        if not clean_domain.startswith("www."):
                            new_lines.append(
                                f"{self.BLOCK_SINK_ADDRESS} www.{clean_domain}\n"
                            )
                    new_lines.append(f"{self.HOSTS_MARKER_END}\n")

                # Ghi lại file Hosts
                with open(self.hosts_path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)

                # Làm mới DNS cache của Windows
                os.system("ipconfig /flushdns > nul")
                logging.info(f"Updated Windows Hosts file with {len(safe_domains)} valid blacklisted domains.")
            except Exception as e:
                logging.error(f"Failed to update Hosts file (Check admin rights): {e}")

    @classmethod
    def normalize_domain(cls, domain):
        """Trả về hostname ASCII an toàn để ghi hosts, hoặc None nếu không hợp lệ."""
        if not isinstance(domain, str) or not domain:
            return None
        if any(ord(char) <= 32 or ord(char) == 127 for char in domain):
            return None
        if "#" in domain or "\\" in domain:
            return None

        candidate = domain.lower()
        if candidate.startswith("www."):
            candidate = candidate[4:]
        candidate = candidate[:-1] if candidate.endswith(".") else candidate

        try:
            ascii_domain = candidate.encode("idna").decode("ascii")
        except (UnicodeError, ValueError):
            return None

        if len(ascii_domain) < 3 or len(ascii_domain) > 200:
            return None
        labels = ascii_domain.split(".")
        if len(labels) < 2 or any(not cls.DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
            return None
        return ascii_domain

    def check_policy_status(self):
        """
        Kiểm tra các quy định chính sách:
        1. is_locked == True -> Khóa ngay lập tức.
        2. Thời gian hiện tại nằm ngoài khung giờ allowed_start_time - allowed_end_time -> Khóa.
        3. Tổng thời gian dùng máy hôm nay (từ SQLite daily_usage) > daily_limit_minutes -> Khóa.
        
        @returns tuple: (should_lock: bool, reason: str, seconds_remaining: int)
        """
        settings = self.load_cached_settings()

        # 1. Kiểm tra cờ khóa máy thủ công từ phụ huynh
        if settings.get("is_locked", False):
            return True, "Parent has manually locked the device.", 0

        now = datetime.now()
        current_time_str = now.strftime("%H:%M:%S")

        start_time_str = settings.get("allowed_start_time", "07:00:00")
        end_time_str = settings.get("allowed_end_time", "21:00:00")

        # 2. Kiểm tra khung giờ cho phép
        try:
            cur_t = datetime.strptime(current_time_str, "%H:%M:%S").time()
            start_t = datetime.strptime(start_time_str, "%H:%M:%S").time()
            end_t = datetime.strptime(end_time_str, "%H:%M:%S").time()

            # A range such as 22:00-06:00 crosses midnight and must use OR.
            if start_t <= end_t:
                within_allowed_hours = start_t <= cur_t <= end_t
            else:
                within_allowed_hours = cur_t >= start_t or cur_t <= end_t

            if not within_allowed_hours:
                return True, f"Outside allowed usage hours ({start_time_str} - {end_time_str}).", 0
        except Exception as e:
            logging.error(f"Time parsing error: {e}")

        # 3. Kiểm tra tổng thời gian sử dụng trong ngày
        daily_limit_minutes = settings.get("daily_limit_minutes", 120)
        max_allowed_seconds = daily_limit_minutes * 60

        used_seconds = self.offline_queue.get_daily_usage()
        remaining_seconds = max_allowed_seconds - used_seconds

        if remaining_seconds <= 0:
            return True, f"Daily limit of {daily_limit_minutes} minutes has been exceeded.", 0

        return False, "OK", remaining_seconds
