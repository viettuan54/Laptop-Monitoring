import os
import sqlite3
import uuid
import time
import logging
from datetime import datetime

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

class OfflineQueue:
    def __init__(self, db_path=None, api_client=None):
        if db_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            db_path = os.path.join(base_dir, "db", "local.db")
            
        self.db_path = db_path
        self.api_client = api_client
        self.init_db()
        self.secure_db_file()

    def get_connection(self):
        return sqlite3.connect(self.db_path)

    def init_db(self):
        """Khởi tạo các bảng SQLite local nếu chưa tồn tại."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Bảng lưu app usage offline
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS app_logs (
                client_record_id TEXT PRIMARY KEY,
                app_name TEXT NOT NULL,
                category TEXT DEFAULT 'unknown',
                start_time TEXT NOT NULL,
                end_time TEXT,
                duration_seconds INTEGER,
                synced INTEGER DEFAULT 0
            )
            """)
            
            # Bảng lưu web history offline
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS web_logs (
                client_record_id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                domain TEXT,
                category TEXT DEFAULT 'unknown',
                visit_time TEXT NOT NULL,
                duration_seconds INTEGER,
                page_title TEXT,
                synced INTEGER DEFAULT 0
            )
            """)
            
            # Bảng lưu tổng thời gian sử dụng máy tính cộng dồn trong ngày
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_usage (
                date TEXT PRIMARY KEY,
                seconds_used INTEGER DEFAULT 0
            )
            """)
            conn.commit()

    def secure_db_file(self):
        """Thiết lập quyền truy cập NTFS (ACL) thông qua lệnh icacls để chỉ SYSTEM và Administrators có quyền đọc/ghi."""
        if os.name == 'nt':
            try:
                # Gỡ bỏ kế thừa quyền (inheritance) và cấp quyền full cho SYSTEM / Administrators
                # Quyền đọc/ghi cho người dùng thường (Standard User) sẽ bị từ chối
                cmd = f'icacls "{self.db_path}" /inheritance:r /grant:r SYSTEM:(F) /grant:r Administrators:(F)'
                os.system(cmd)
                logging.info(f"Secured SQLite database file permission: {self.db_path}")
            except Exception as e:
                logging.error(f"Failed to secure SQLite file permissions: {e}")

    def enqueue_app_log(self, app_name, start_time, end_time=None, duration_seconds=None, category='unknown'):
        """Thêm log sử dụng app vào SQLite local và tự sinh client_record_id."""
        client_record_id = str(uuid.uuid4())
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO app_logs (client_record_id, app_name, category, start_time, end_time, duration_seconds, synced)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """, (client_record_id, app_name, category, start_time, end_time, duration_seconds))
                conn.commit()
            return client_record_id
        except Exception as e:
            logging.error(f"Failed to enqueue app log: {e}")
            return None

    def enqueue_web_log(self, url, domain, visit_time, duration_seconds=None, page_title=None, category='unknown'):
        """Thêm log truy cập website vào SQLite local và tự sinh client_record_id."""
        client_record_id = str(uuid.uuid4())
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO web_logs (client_record_id, url, domain, category, visit_time, duration_seconds, page_title, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                """, (client_record_id, url, domain, category, visit_time, duration_seconds, page_title))
                conn.commit()
            return client_record_id
        except Exception as e:
            logging.error(f"Failed to enqueue web log: {e}")
            return None

    def add_daily_usage(self, seconds):
        """Cộng dồn số giây sử dụng máy cho ngày hiện tại (YYYY-MM-DD local)."""
        today = datetime.now().strftime("%Y-%m-%d")
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO daily_usage (date, seconds_used)
                VALUES (?, ?)
                ON CONFLICT(date) DO UPDATE SET seconds_used = seconds_used + excluded.seconds_used
                """, (today, seconds))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to update daily usage: {e}")

    def get_daily_usage(self):
        """Lấy tổng số giây đã dùng máy hôm nay."""
        today = datetime.now().strftime("%Y-%m-%d")
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT seconds_used FROM daily_usage WHERE date = ?", (today,))
                row = cursor.fetchone()
                return row[0] if row else 0
        except Exception as e:
            logging.error(f"Failed to get daily usage: {e}")
            return 0

    def sync_pending_logs(self, api_client=None):
        """Hàm wrapper đồng bộ dữ liệu ngoại tuyến (hỗ trợ cả truyền api_client hoặc dùng self.api_client)."""
        target_client = api_client or self.api_client
        if target_client:
            self.sync_offline_data(target_client)
        else:
            logging.warning("Cannot sync offline logs: APIClient is missing.")

    def sync_offline_data(self, api_client):
        """Đồng bộ hóa logs chưa gửi lên backend theo batch 100 bản ghi, có delay 200ms."""
        if api_client.suspended:
            logging.warning("Offline sync aborted because API client is suspended.")
            return

        self._sync_apps(api_client)
        self._sync_webs(api_client)
        self.cleanup_synced_logs(days=7)

    def _sync_apps(self, api_client):
        """Gửi batch app logs chưa sync."""
        while True:
            try:
                with self.get_connection() as conn:
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    cursor.execute("SELECT * FROM app_logs WHERE synced = 0 LIMIT 100")
                    rows = cursor.fetchall()

                if not rows:
                    break

                records = []
                record_ids = []
                for row in rows:
                    records.append({
                        "client_record_id": row["client_record_id"],
                        "app_name": row["app_name"],
                        "category": row["category"],
                        "start_time": row["start_time"],
                        "end_time": row["end_time"],
                        "duration_seconds": row["duration_seconds"]
                    })
                    record_ids.append(row["client_record_id"])

                response = api_client.post("/api/logs/app/batch", data={"records": records})
                if response and response.status_code == 201:
                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        # Cập nhật trạng thái đã sync
                        placeholders = ",".join(["?"] * len(record_ids))
                        cursor.execute(f"UPDATE app_logs SET synced = 1 WHERE client_record_id IN ({placeholders})", record_ids)
                        conn.commit()
                    logging.info(f"Successfully synced batch of {len(records)} app logs.")
                else:
                    logging.error("Failed to sync app logs batch. API error.")
                    break

                # Delay 200ms để tránh trigger rate limiter của backend
                time.sleep(0.200)

            except Exception as e:
                logging.error(f"Error during app logs sync: {e}")
                break

    def _sync_webs(self, api_client):
        """Gửi batch web logs chưa sync."""
        while True:
            try:
                with self.get_connection() as conn:
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    cursor.execute("SELECT * FROM web_logs WHERE synced = 0 LIMIT 100")
                    rows = cursor.fetchall()

                if not rows:
                    break

                records = []
                record_ids = []
                for row in rows:
                    records.append({
                        "client_record_id": row["client_record_id"],
                        "url": row["url"],
                        "domain": row["domain"],
                        "category": row["category"],
                        "visit_time": row["visit_time"],
                        "duration_seconds": row["duration_seconds"],
                        "page_title": row["page_title"]
                    })
                    record_ids.append(row["client_record_id"])

                response = api_client.post("/api/logs/web/batch", data={"records": records})
                if response and response.status_code == 201:
                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        placeholders = ",".join(["?"] * len(record_ids))
                        cursor.execute(f"UPDATE web_logs SET synced = 1 WHERE client_record_id IN ({placeholders})", record_ids)
                        conn.commit()
                    logging.info(f"Successfully synced batch of {len(records)} web logs.")
                else:
                    logging.error("Failed to sync web logs batch. API error.")
                    break

                time.sleep(0.200)

            except Exception as e:
                logging.error(f"Error during web logs sync: {e}")
                break

    def cleanup_synced_logs(self, days=7):
        """Xóa các bản ghi đã sync từ X ngày trước để tối ưu dung lượng DB file."""
        try:
            # Ở SQLite chúng ta so sánh datetime dạng TEXT ISO8601 dễ nhất qua strftime hoặc modifier
            # Ở đây ta dùng datetime('now', '-7 days')
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM app_logs WHERE synced = 1 AND start_time < datetime('now', '-' || ? || ' days')", (days,))
                cursor.execute("DELETE FROM web_logs WHERE synced = 1 AND visit_time < datetime('now', '-' || ? || ' days')", (days,))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to cleanup old synced logs: {e}")