import os
import sqlite3
import uuid
import time
import logging
import subprocess
from datetime import datetime, timedelta

from runtime_paths import agent_root

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


class ClosingSQLiteConnection(sqlite3.Connection):
    """sqlite3 context manager có commit/rollback nhưng mặc định không close."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class OfflineQueue:
    def __init__(self, db_path=None, api_client=None, secure_file=True):
        if db_path is None:
            db_path = os.path.join(agent_root(), "db", "local.db")
            
        self.db_path = db_path
        self.api_client = api_client
        self.init_db()
        if secure_file:
            self.secure_db_file()

    def get_connection(self):
        return sqlite3.connect(self.db_path, factory=ClosingSQLiteConnection)

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
                classification_source TEXT NOT NULL DEFAULT 'pending',
                classification_confidence REAL,
                visit_time TEXT NOT NULL,
                duration_seconds INTEGER,
                page_title TEXT,
                synced INTEGER DEFAULT 0
            )
            """)
            web_columns = {
                row[1] for row in cursor.execute("PRAGMA table_info(web_logs)").fetchall()
            }
            if "classification_source" not in web_columns:
                cursor.execute(
                    "ALTER TABLE web_logs ADD COLUMN classification_source TEXT NOT NULL DEFAULT 'pending'"
                )
            if "classification_confidence" not in web_columns:
                cursor.execute(
                    "ALTER TABLE web_logs ADD COLUMN classification_confidence REAL"
                )
            # Preserve already-classified rows created by older Agent versions.
            # Without this marker the backend would correctly reject the
            # contradictory combination category=<known>, source=pending.
            cursor.execute(
                """UPDATE web_logs
                   SET classification_source = 'legacy_agent'
                   WHERE category <> 'unknown'
                     AND classification_source = 'pending'"""
            )
            
            # Bảng lưu tổng thời gian sử dụng máy tính cộng dồn trong ngày
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_usage (
                date TEXT PRIMARY KEY,
                seconds_used INTEGER DEFAULT 0
            )
            """)

            # Chỉ lưu metadata cảnh báo Edge AI; không lưu ảnh hoặc frame camera.
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS vision_alerts (
                client_record_id TEXT PRIMARY KEY,
                alert_type TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced INTEGER DEFAULT 0
            )
            """)
            conn.commit()

    def secure_db_file(self):
        """Thiết lập quyền truy cập NTFS (ACL) thông qua lệnh icacls để chỉ SYSTEM và Administrators có quyền đọc/ghi."""
        if os.name == 'nt':
            try:
                # Gỡ bỏ kế thừa quyền (inheritance) và cấp quyền full cho SYSTEM / Administrators
                # Quyền đọc/ghi cho người dùng thường (Standard User) sẽ bị từ chối
                result = subprocess.run(
                    [
                        "icacls", self.db_path, "/inheritance:r",
                        "/grant:r", "*S-1-5-18:(F)",
                        "/grant:r", "*S-1-5-32-544:(F)",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if result.returncode != 0:
                    raise RuntimeError(
                        result.stderr.strip() or result.stdout.strip() or "icacls failed"
                    )
                logging.info(f"Secured SQLite database file permission: {self.db_path}")
            except Exception as e:
                logging.error(f"Failed to secure SQLite file permissions: {e}")

    def enqueue_app_log(self, app_name, start_time, end_time=None, duration_seconds=None,
                        category='unknown', client_record_id=None):
        """Thêm log sử dụng app vào SQLite local và tự sinh client_record_id."""
        client_record_id = client_record_id or str(uuid.uuid4())
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR IGNORE INTO app_logs
                    (client_record_id, app_name, category, start_time, end_time, duration_seconds, synced)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """, (client_record_id, app_name, category, start_time, end_time, duration_seconds))
                inserted = cursor.rowcount == 1
                conn.commit()
            return client_record_id, inserted
        except Exception as e:
            logging.error(f"Failed to enqueue app log: {e}")
            return None, False

    def enqueue_web_log(self, url, domain, visit_time, duration_seconds=None,
                        page_title=None, category='unknown', client_record_id=None,
                        classification_source=None, classification_confidence=None):
        """Thêm log truy cập website vào SQLite local và tự sinh client_record_id."""
        client_record_id = client_record_id or str(uuid.uuid4())
        if classification_source is None:
            classification_source = (
                "pending" if category == "unknown" else "legacy_agent"
            )
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR IGNORE INTO web_logs
                    (client_record_id, url, domain, category, classification_source,
                     classification_confidence, visit_time, duration_seconds, page_title, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (
                    client_record_id,
                    url,
                    domain,
                    category,
                    classification_source,
                    classification_confidence,
                    visit_time,
                    duration_seconds,
                    page_title,
                ))
                inserted = cursor.rowcount == 1
                conn.commit()
            return client_record_id, inserted
        except Exception as e:
            logging.error(f"Failed to enqueue web log: {e}")
            return None, False

    def get_unknown_web_domains(self, limit=25):
        """Return distinct local domains whose queued category is still unknown."""
        safe_limit = max(1, min(int(limit), 100))
        try:
            with self.get_connection() as conn:
                rows = conn.execute(
                    """SELECT DISTINCT lower(domain) AS domain
                       FROM web_logs
                       WHERE category = 'unknown'
                         AND classification_source IN ('pending', 'disabled')
                         AND domain IS NOT NULL AND domain <> ''
                       ORDER BY domain
                       LIMIT ?""",
                    (safe_limit,),
                ).fetchall()
            return [row[0] for row in rows]
        except Exception as e:
            logging.error(f"Failed to read unknown web domains: {e}")
            return []

    def update_unknown_web_category(
        self, domain, category, classification_source, classification_confidence=None
    ):
        """Backfill local queue rows without overwriting an existing final label."""
        if category not in {"education", "entertainment", "social", "unsafe", "unknown"}:
            return 0
        if classification_source not in {"trained_model", "gemini"}:
            return 0
        try:
            with self.get_connection() as conn:
                cursor = conn.execute(
                    """UPDATE web_logs
                       SET category = ?, classification_source = ?,
                           classification_confidence = ?
                       WHERE category = 'unknown'
                         AND classification_source IN ('pending', 'disabled')
                         AND lower(domain) = lower(?)""",
                    (
                        category,
                        classification_source,
                        classification_confidence,
                        domain,
                    ),
                )
                conn.commit()
                return cursor.rowcount
        except Exception as e:
            logging.error(f"Failed to backfill local web category: {e}")
            return 0

    def enqueue_vision_alert(self, alert_type, message, client_record_id=None):
        """Lưu metadata cảnh báo camera để đồng bộ sau; không nhận dữ liệu ảnh."""
        client_record_id = client_record_id or str(uuid.uuid4())
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cutoff = (
                    datetime.now().astimezone() - timedelta(minutes=5)
                ).isoformat()
                existing = cursor.execute(
                    """SELECT client_record_id FROM vision_alerts
                       WHERE alert_type = ? AND created_at >= ?
                       ORDER BY created_at DESC LIMIT 1""",
                    (alert_type, cutoff),
                ).fetchone()
                if existing:
                    return existing[0], False
                cursor.execute("""
                INSERT OR IGNORE INTO vision_alerts
                    (client_record_id, alert_type, message, created_at, synced)
                VALUES (?, ?, ?, ?, 0)
                """, (
                    client_record_id,
                    alert_type,
                    message,
                    datetime.now().astimezone().isoformat(),
                ))
                inserted = cursor.rowcount == 1
                conn.commit()
            return client_record_id, inserted
        except Exception as e:
            logging.error(f"Failed to enqueue vision alert: {e}")
            return None, False

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
        self._sync_vision_alerts(api_client)
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
                    try:
                        response_data = response.json()
                        accepted_ids = response_data.get("accepted_client_record_ids", [])
                    except (ValueError, AttributeError) as e:
                        logging.error(f"Invalid app batch acknowledgement: {e}")
                        break

                    # Fail closed nếu backend cũ/không hợp lệ không xác nhận ID cụ thể.
                    accepted_ids = [record_id for record_id in accepted_ids if record_id in record_ids]
                    if not accepted_ids:
                        logging.error("App batch returned no accepted IDs; local queue was left unchanged.")
                        break

                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        # Chỉ đánh dấu những record backend xác nhận đã lưu/đã tồn tại.
                        placeholders = ",".join(["?"] * len(accepted_ids))
                        cursor.execute(f"UPDATE app_logs SET synced = 1 WHERE client_record_id IN ({placeholders})", accepted_ids)
                        conn.commit()
                    logging.info(f"Backend accepted {len(accepted_ids)}/{len(records)} app logs.")
                    if len(accepted_ids) < len(record_ids):
                        logging.warning("Rejected app logs were retained locally for inspection/retry.")
                        break
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
                        "classification_source": row["classification_source"],
                        "classification_confidence": row["classification_confidence"],
                        "visit_time": row["visit_time"],
                        "duration_seconds": row["duration_seconds"],
                        "page_title": row["page_title"]
                    })
                    record_ids.append(row["client_record_id"])

                response = api_client.post("/api/logs/web/batch", data={"records": records})
                if response and response.status_code == 201:
                    try:
                        response_data = response.json()
                        accepted_ids = response_data.get("accepted_client_record_ids", [])
                    except (ValueError, AttributeError) as e:
                        logging.error(f"Invalid web batch acknowledgement: {e}")
                        break

                    accepted_ids = [record_id for record_id in accepted_ids if record_id in record_ids]
                    if not accepted_ids:
                        logging.error("Web batch returned no accepted IDs; local queue was left unchanged.")
                        break

                    with self.get_connection() as conn:
                        cursor = conn.cursor()
                        placeholders = ",".join(["?"] * len(accepted_ids))
                        cursor.execute(f"UPDATE web_logs SET synced = 1 WHERE client_record_id IN ({placeholders})", accepted_ids)
                        conn.commit()
                    logging.info(f"Backend accepted {len(accepted_ids)}/{len(records)} web logs.")
                    if len(accepted_ids) < len(record_ids):
                        logging.warning("Rejected web logs were retained locally for inspection/retry.")
                        break
                else:
                    logging.error("Failed to sync web logs batch. API error.")
                    break

                time.sleep(0.200)

            except Exception as e:
                logging.error(f"Error during web logs sync: {e}")
                break

    def _sync_vision_alerts(self, api_client):
        """Gửi tuần tự cảnh báo Edge AI vì backend tự chống trùng trong 5 phút."""
        while True:
            try:
                with self.get_connection() as conn:
                    conn.row_factory = sqlite3.Row
                    rows = conn.execute(
                        "SELECT * FROM vision_alerts WHERE synced = 0 ORDER BY created_at LIMIT 20"
                    ).fetchall()
                if not rows:
                    break

                made_progress = False
                for row in rows:
                    response = api_client.post("/api/agent/vision-alert", data={
                        "alert_type": row["alert_type"],
                        "message": row["message"],
                    })
                    if response is None:
                        return

                    # 200 includes backend duplicate suppression; 201 means inserted.
                    # A stale local policy may race with a parent disabling webcam;
                    # discard 400/403 rather than retrying sensitive telemetry forever.
                    if response.status_code in (200, 201, 400, 403):
                        with self.get_connection() as conn:
                            conn.execute(
                                "UPDATE vision_alerts SET synced = 1 WHERE client_record_id = ?",
                                (row["client_record_id"],),
                            )
                            conn.commit()
                        made_progress = True
                    else:
                        return
                if not made_progress:
                    break
                time.sleep(0.200)
            except Exception as e:
                logging.error(f"Error during vision alert sync: {e}")
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
                cursor.execute("DELETE FROM vision_alerts WHERE synced = 1 AND created_at < datetime('now', '-' || ? || ' days')", (days,))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to cleanup old synced logs: {e}")
