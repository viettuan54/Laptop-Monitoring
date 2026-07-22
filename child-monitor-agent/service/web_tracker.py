import os
import shutil
import sqlite3
import json
import logging
import time
from urllib.parse import urlparse
from datetime import datetime, timedelta

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class WebTracker:
    def __init__(self, offline_queue, config_dir=None):
        self.offline_queue = offline_queue
        if config_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_dir = os.path.join(base_dir, "config")
            
        self.checkpoint_path = os.path.join(config_dir, "tracker_checkpoint.json")
        self.temp_dir = os.path.join(os.path.dirname(config_dir), "temp")
        os.makedirs(self.temp_dir, exist_ok=True)
        
        self.checkpoints = self.load_checkpoints()

    def load_checkpoints(self):
        """Tải thông tin checkpoint của từng profile trình duyệt."""
        if os.path.exists(self.checkpoint_path):
            try:
                with open(self.checkpoint_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logging.error(f"Error loading checkpoint file: {e}")
        return {}

    def save_checkpoints(self):
        """Lưu thông tin checkpoint xuống file JSON."""
        try:
            with open(self.checkpoint_path, "w", encoding="utf-8") as f:
                json.dump(self.checkpoints, f, indent=2)
        except Exception as e:
            logging.error(f"Error saving checkpoint file: {e}")

    def get_browser_user_data_paths(self):
        """Lấy danh sách đường dẫn thư mục User Data của Chrome và Edge."""
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if not local_app_data:
            return []

        paths = []
        # Google Chrome
        chrome_path = os.path.join(local_app_data, "Google", "Chrome", "User Data")
        if os.path.exists(chrome_path):
            paths.append(("chrome", chrome_path))

        # Microsoft Edge
        edge_path = os.path.join(local_app_data, "Microsoft", "Edge", "User Data")
        if os.path.exists(edge_path):
            paths.append(("edge", edge_path))

        return paths

    def get_profiles_for_browser(self, user_data_path):
        """Tìm tất cả các profile (Default, Profile 1, Profile 2...) trong User Data."""
        profiles = []
        if not os.path.exists(user_data_path):
            return profiles

        for item in os.listdir(user_data_path):
            item_path = os.path.join(user_data_path, item)
            if os.path.isdir(item_path):
                # Profile thường tên là Default hoặc bắt đầu bằng Profile
                if item == "Default" or item.startswith("Profile "):
                    history_file = os.path.join(item_path, "History")
                    if os.path.exists(history_file):
                        profiles.append((item, history_file))

        return profiles

    @staticmethod
    def chrome_time_to_iso(chrome_time):
        """Chuyển đổi Chrome/Edge Epoch Microseconds (từ 1601-01-01) sang ISO 8601 UTC string."""
        if not chrome_time:
            return datetime.now().isoformat()
        try:
            # 11644473600 là số giây giữa 1601-01-01 và 1970-01-01 (Unix epoch)
            epoch_start = datetime(1601, 1, 1)
            delta = timedelta(microseconds=chrome_time)
            dt = epoch_start + delta
            return dt.isoformat() + "Z"
        except Exception:
            return datetime.now().isoformat()

    def scan_profile_history(self, browser_name, profile_name, history_file):
        """Đọc và trích xuất lịch sử duyệt web từ file History của 1 profile cụ thể."""
        checkpoint_key = f"{browser_name}:{profile_name}"
        last_visit_time = self.checkpoints.get(checkpoint_key, 0)

        # Sao chép file History ra một vị trí tạm để tránh lỗi "database is locked" khi trình duyệt đang chạy
        temp_history_file = os.path.join(self.temp_dir, f"History_{browser_name}_{profile_name}.tmp")
        try:
            shutil.copy2(history_file, temp_history_file)
        except Exception as e:
            logging.warning(f"Could not copy History file for {checkpoint_key}: {e}")
            return

        max_visit_time = last_visit_time
        try:
            conn = sqlite3.connect(temp_history_file)
            cursor = conn.cursor()

            # Truy vấn kết hợp bảng urls và visits trong Chromium SQLite History
            query = """
            SELECT urls.url, urls.title, visits.visit_time, visits.visit_duration
            FROM urls
            JOIN visits ON urls.id = visits.url
            WHERE visits.visit_time > ?
            ORDER BY visits.visit_time ASC
            """
            cursor.execute(query, (last_visit_time,))
            rows = cursor.fetchall()

            for row in rows:
                raw_url, title, visit_time, visit_duration = row
                if visit_time > max_visit_time:
                    max_visit_time = visit_time

                # Lọc bỏ các URL nội bộ trình duyệt
                if raw_url.startswith(("chrome://", "edge://", "about:", "file://")):
                    continue

                parsed = urlparse(raw_url)
                domain = parsed.netloc.lower()
                if not domain:
                    continue

                visit_iso = self.chrome_time_to_iso(visit_time)
                duration_seconds = max(0, int(visit_duration / 1000000)) if visit_duration else 0
                page_title = title if title else domain

                # Đưa log vào hàng đợi SQLite local
                self.offline_queue.enqueue_web_log(
                    url=raw_url,
                    domain=domain,
                    visit_time=visit_iso,
                    duration_seconds=duration_seconds,
                    page_title=page_title,
                    category="unknown"
                )

            conn.close()

            # Cập nhật checkpoint nếu có dữ liệu mới
            if max_visit_time > last_visit_time:
                self.checkpoints[checkpoint_key] = max_visit_time
                self.save_checkpoints()

        except Exception as e:
            logging.error(f"Error reading history for {checkpoint_key}: {e}")
        finally:
            if os.path.exists(temp_history_file):
                try:
                    os.remove(temp_history_file)
                except Exception:
                    pass

    def track(self):
        """Hàm chính thực hiện quét toàn bộ trình duyệt và profile."""
        browser_paths = self.get_browser_user_data_paths()
        for browser_name, user_data_path in browser_paths:
            profiles = self.get_profiles_for_browser(user_data_path)
            for profile_name, history_file in profiles:
                self.scan_profile_history(browser_name, profile_name, history_file)
