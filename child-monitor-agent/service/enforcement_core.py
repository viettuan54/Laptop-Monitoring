import os
import sys
import json
import logging
import threading
import re
from datetime import datetime

from runtime_paths import agent_root

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class EnforcementCore:
    HOSTS_MARKER_START = "# === LAPTOP-MONITOR START ==="
    HOSTS_MARKER_END = "# === LAPTOP-MONITOR END ==="
    DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

    def __init__(self, offline_queue, config_dir=None):
        self.offline_queue = offline_queue
        if config_dir is None:
            config_dir = os.path.join(agent_root(), "config")

        self.settings_cache_path = os.path.join(config_dir, "settings_cache.json")
        self.hosts_path = r"C:\Windows\System32\drivers\etc\hosts"
        self.lock = threading.Lock()

    def load_cached_settings(self):
        """Đọc cài đặt settings và blacklist đã được cache từ file JSON."""
        if os.path.exists(self.settings_cache_path):
            try:
                with open(self.settings_cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logging.error(f"Failed to read settings cache: {e}")

        # Config mặc định an toàn nếu chưa có cache
        return {
            "daily_limit_minutes": 120,
            "allowed_start_time": "07:00:00",
            "allowed_end_time": "21:00:00",
            "is_locked": False,
            "enable_webcam_monitoring": False,
            "enable_app_classification": False,
            "enable_web_classification": False,
            "blacklisted_domains": []
        }

    def save_settings_cache(self, config_data, blacklisted_domains=None):
        """Lưu cài đặt settings và danh sách blacklist vào file cache cục bộ."""
        try:
            blacklist_was_refreshed = blacklisted_domains is not None
            cache_data = config_data.copy() if config_data else {}
            if blacklisted_domains is not None:
                cache_data["blacklisted_domains"] = blacklisted_domains
            elif "blacklisted_domains" not in cache_data:
                existing = self.load_cached_settings()
                cache_data["blacklisted_domains"] = existing.get("blacklisted_domains", [])

            with open(self.settings_cache_path, "w", encoding="utf-8") as f:
                json.dump(cache_data, f, indent=2)

            # Heartbeat only refreshes policy fields. Rewrite hosts/flush DNS only
            # when a full config response explicitly refreshes the blacklist.
            if blacklist_was_refreshed:
                self.update_hosts_file(cache_data.get("blacklisted_domains", []))
        except Exception as e:
            logging.error(f"Failed to save settings cache: {e}")

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
                        new_lines.append(f"127.0.0.1 {clean_domain}\n")
                        if not clean_domain.startswith("www."):
                            new_lines.append(f"127.0.0.1 www.{clean_domain}\n")
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
