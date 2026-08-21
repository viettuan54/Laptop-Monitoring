import os
import sqlite3
import uuid
import time
import logging
import subprocess
from datetime import datetime, timedelta, time as datetime_time

from runtime_paths import agent_root

# Cấu hình logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


MAX_APP_SEGMENT_SECONDS = 120
USAGE_ACCOUNTING_VERSION = 2
USAGE_REBUILD_DAYS = 2
NON_USAGE_APPS = frozenset({"lockapp.exe", "logonui.exe"})


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

            cursor.execute("""
            CREATE TABLE IF NOT EXISTS agent_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """)

            accounting_version_row = cursor.execute(
                "SELECT value FROM agent_metadata WHERE key = 'usage_accounting_version'"
            ).fetchone()
            try:
                accounting_version = int(accounting_version_row[0]) if accounting_version_row else 0
            except (TypeError, ValueError):
                accounting_version = 0

            if accounting_version < USAGE_ACCOUNTING_VERSION:
                repaired_rows, skipped_rows = self._rebuild_recent_daily_usage(
                    conn,
                    days=USAGE_REBUILD_DAYS,
                )
                cursor.execute(
                    """INSERT INTO agent_metadata(key, value) VALUES(?, ?)
                       ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
                    ("usage_accounting_version", str(USAGE_ACCOUNTING_VERSION)),
                )
                logging.info(
                    "Rebuilt recent daily usage from %s valid app segment(s); "
                    "ignored %s invalid/locked-session segment(s).",
                    repaired_rows,
                    skipped_rows,
                )
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

    @staticmethod
    def _parse_usage_timestamp(value):
        if not isinstance(value, str) or not value or len(value) > 64:
            raise ValueError("App usage timestamp is invalid")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("App usage timestamp must include a UTC offset")
        return parsed

    @classmethod
    def split_usage_by_local_date(cls, start_time, end_time, duration_seconds):
        """Allocate one short active-use segment to its captured local dates.

        The Companion timestamps include the user's real UTC offset.  Using those
        timestamps, rather than the Service receipt time, prevents delayed records
        from being charged to a later day.  A segment spanning midnight is divided
        proportionally while preserving the exact reported duration.
        """
        if (
            isinstance(duration_seconds, bool)
            or not isinstance(duration_seconds, int)
            or duration_seconds <= 0
            or duration_seconds > MAX_APP_SEGMENT_SECONDS
        ):
            raise ValueError("App usage duration is outside the accepted segment range")

        start = cls._parse_usage_timestamp(start_time)
        end = cls._parse_usage_timestamp(end_time)
        elapsed_seconds = (end - start).total_seconds()
        if elapsed_seconds <= 0 or elapsed_seconds > MAX_APP_SEGMENT_SECONDS:
            raise ValueError("App usage timestamp interval is invalid")

        # Keep the calendar boundary of the user offset captured at segment start.
        local_end = end.astimezone(start.tzinfo)
        cursor = start
        wall_parts = []
        while cursor.date() < local_end.date():
            next_midnight = datetime.combine(
                cursor.date() + timedelta(days=1),
                datetime_time.min,
                tzinfo=start.tzinfo,
            )
            wall_parts.append((cursor.date().isoformat(), (next_midnight - cursor).total_seconds()))
            cursor = next_midnight
        wall_parts.append((cursor.date().isoformat(), (local_end - cursor).total_seconds()))

        positive_parts = [(date_key, seconds) for date_key, seconds in wall_parts if seconds > 0]
        total_wall_seconds = sum(seconds for _, seconds in positive_parts)
        if not positive_parts or total_wall_seconds <= 0:
            raise ValueError("App usage interval has no positive duration")

        raw_allocations = [
            duration_seconds * seconds / total_wall_seconds
            for _, seconds in positive_parts
        ]
        allocated_seconds = [int(value) for value in raw_allocations]
        remainder = duration_seconds - sum(allocated_seconds)
        remainder_order = sorted(
            range(len(raw_allocations)),
            key=lambda index: raw_allocations[index] - allocated_seconds[index],
            reverse=True,
        )
        for index in remainder_order[:remainder]:
            allocated_seconds[index] += 1

        allocations = {}
        for (date_key, _), seconds in zip(positive_parts, allocated_seconds):
            if seconds > 0:
                allocations[date_key] = allocations.get(date_key, 0) + seconds
        return allocations

    @staticmethod
    def _increment_daily_usage(connection, allocations):
        for date_key, seconds in allocations.items():
            connection.execute(
                """INSERT INTO daily_usage (date, seconds_used)
                   VALUES (?, ?)
                   ON CONFLICT(date) DO UPDATE
                   SET seconds_used = seconds_used + excluded.seconds_used""",
                (date_key, seconds),
            )

    def record_app_usage(
        self,
        app_name,
        start_time,
        end_time,
        duration_seconds,
        category="unknown",
        client_record_id=None,
    ):
        """Persist an app segment and its per-day totals atomically and idempotently."""
        client_record_id = client_record_id or str(uuid.uuid4())
        allocations = self.split_usage_by_local_date(
            start_time,
            end_time,
            duration_seconds,
        )
        with self.get_connection() as conn:
            cursor = conn.execute(
                """INSERT OR IGNORE INTO app_logs
                       (client_record_id, app_name, category, start_time, end_time,
                        duration_seconds, synced)
                   VALUES (?, ?, ?, ?, ?, ?, 0)""",
                (
                    client_record_id,
                    app_name,
                    category,
                    start_time,
                    end_time,
                    duration_seconds,
                ),
            )
            inserted = cursor.rowcount == 1
            if inserted:
                self._increment_daily_usage(conn, allocations)
            conn.commit()
        return client_record_id, inserted

    def _rebuild_recent_daily_usage(self, connection, days=USAGE_REBUILD_DAYS):
        """Repair recent totals once when upgrading from receipt-date accounting."""
        safe_days = max(1, min(int(days), 31))
        today = datetime.now().date()
        cutoff = today - timedelta(days=safe_days - 1)
        scan_from = cutoff - timedelta(days=1)
        rows = connection.execute(
            """SELECT client_record_id, app_name, start_time, end_time, duration_seconds
               FROM app_logs
               WHERE substr(start_time, 1, 10) >= ?""",
            (scan_from.isoformat(),),
        ).fetchall()

        repaired_allocations = {}
        repaired_rows = 0
        skipped_rows = 0
        quarantined_record_ids = []
        for client_record_id, app_name, start_time, end_time, duration_seconds in rows:
            if str(app_name or "").casefold() in NON_USAGE_APPS:
                skipped_rows += 1
                quarantined_record_ids.append(client_record_id)
                continue
            try:
                allocations = self.split_usage_by_local_date(
                    start_time,
                    end_time,
                    duration_seconds,
                )
            except (TypeError, ValueError, OverflowError):
                skipped_rows += 1
                quarantined_record_ids.append(client_record_id)
                continue
            repaired_rows += 1
            for date_key, seconds in allocations.items():
                if cutoff.isoformat() <= date_key <= today.isoformat():
                    repaired_allocations[date_key] = (
                        repaired_allocations.get(date_key, 0) + seconds
                    )

        connection.execute(
            "DELETE FROM daily_usage WHERE date BETWEEN ? AND ?",
            (cutoff.isoformat(), today.isoformat()),
        )
        if quarantined_record_ids:
            # These rows represent lock/sleep rather than active use. Marking them
            # handled keeps a pre-upgrade queue from uploading corrupt totals.
            for offset in range(0, len(quarantined_record_ids), 500):
                record_id_chunk = quarantined_record_ids[offset:offset + 500]
                placeholders = ",".join("?" for _ in record_id_chunk)
                connection.execute(
                    f"UPDATE app_logs SET synced = 1 "
                    f"WHERE client_record_id IN ({placeholders})",
                    record_id_chunk,
                )
        self._increment_daily_usage(connection, repaired_allocations)
        return repaired_rows, skipped_rows

    def rebuild_recent_daily_usage(self, days=USAGE_REBUILD_DAYS):
        """Explicit repair hook used by diagnostics and upgrade tests."""
        with self.get_connection() as conn:
            result = self._rebuild_recent_daily_usage(conn, days=days)
            conn.commit()
            return result

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

    def add_daily_usage(self, seconds, usage_date=None):
        """Cộng dồn số giây sử dụng máy cho ngày hiện tại (YYYY-MM-DD local)."""
        if isinstance(seconds, bool) or not isinstance(seconds, int) or seconds <= 0:
            raise ValueError("Daily usage increment must be a positive integer")
        date_key = usage_date or datetime.now().strftime("%Y-%m-%d")
        try:
            datetime.strptime(date_key, "%Y-%m-%d")
        except (TypeError, ValueError):
            raise ValueError("Daily usage date must use YYYY-MM-DD") from None
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT INTO daily_usage (date, seconds_used)
                VALUES (?, ?)
                ON CONFLICT(date) DO UPDATE SET seconds_used = seconds_used + excluded.seconds_used
                """, (date_key, seconds))
                conn.commit()
        except Exception as e:
            logging.error(f"Failed to update daily usage: {e}")

    def get_daily_usage(self, usage_date=None):
        """Lấy tổng số giây đã dùng máy hôm nay."""
        date_key = usage_date or datetime.now().strftime("%Y-%m-%d")
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT seconds_used FROM daily_usage WHERE date = ?", (date_key,))
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
