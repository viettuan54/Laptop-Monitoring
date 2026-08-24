import json
import logging
import os
import shutil
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

AGENT_VERSION = "1.0.11"


class WebTracker:
    """Read Chromium history in the interactive user's profile and forward it to Service."""

    CHROME_EPOCH = datetime(1601, 1, 1, tzinfo=timezone.utc)
    MAX_DURATION_SECONDS = 24 * 60 * 60
    MAX_RECORDS_PER_PROFILE_SCAN = 500

    def __init__(
        self,
        pipe_client,
        local_app_data=None,
        state_dir=None,
        scan_interval_seconds=15,
        initial_lookback_seconds=300,
    ):
        self.pipe_client = pipe_client
        self.local_app_data = local_app_data or os.environ.get("LOCALAPPDATA")
        if not self.local_app_data:
            self.local_app_data = os.path.join(
                os.path.expanduser("~"), "AppData", "Local"
            )

        self.state_dir = state_dir or os.path.join(
            self.local_app_data, "ChildMonitorAgent"
        )
        self.temp_dir = os.path.join(self.state_dir, "temp")
        self.checkpoint_path = os.path.join(
            self.state_dir, "web_tracker_checkpoint.json"
        )
        self.status_path = os.path.join(self.state_dir, "web_tracker_status.json")
        os.makedirs(self.temp_dir, exist_ok=True)

        self.scan_interval_seconds = max(1, int(scan_interval_seconds))
        self.initial_lookback_seconds = max(0, int(initial_lookback_seconds))
        self.last_scan_monotonic = 0.0
        self.checkpoints = self.load_checkpoints()
        self.tracker_instance_id = self._load_or_create_instance_id()
        self._current_scan_profiles = {}

    def load_checkpoints(self):
        if os.path.isfile(self.checkpoint_path):
            try:
                with open(self.checkpoint_path, "r", encoding="utf-8") as stream:
                    data = json.load(stream)
                if isinstance(data, dict):
                    return data
            except Exception as error:
                logging.error("Error loading web tracker checkpoint: %s", error)
        return {}

    def _load_or_create_instance_id(self):
        candidate = self.checkpoints.get("_tracker_instance_id")
        try:
            return str(uuid.UUID(str(candidate)))
        except (ValueError, TypeError, AttributeError):
            instance_id = str(uuid.uuid4())
            self.checkpoints["_tracker_instance_id"] = instance_id
            self.save_checkpoints()
            return instance_id

    def save_checkpoints(self):
        temporary_path = self.checkpoint_path + ".tmp"
        try:
            os.makedirs(self.state_dir, exist_ok=True)
            with open(temporary_path, "w", encoding="utf-8") as stream:
                json.dump(self.checkpoints, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, self.checkpoint_path)
        except Exception as error:
            logging.error("Error saving web tracker checkpoint: %s", error)
            try:
                if os.path.exists(temporary_path):
                    os.remove(temporary_path)
            except OSError:
                pass

    def get_browser_user_data_paths(self):
        paths = []
        candidates = (
            ("chrome", os.path.join(self.local_app_data, "Google", "Chrome", "User Data")),
            ("edge", os.path.join(self.local_app_data, "Microsoft", "Edge", "User Data")),
            ("coccoc", os.path.join(self.local_app_data, "CocCoc", "Browser", "User Data")),
        )
        for browser_name, user_data_path in candidates:
            if os.path.isdir(user_data_path):
                paths.append((browser_name, user_data_path))
        return paths

    @staticmethod
    def get_profiles_for_browser(user_data_path):
        profiles = []
        try:
            items = os.listdir(user_data_path)
        except OSError as error:
            logging.warning("Could not list browser profiles at %s: %s", user_data_path, error)
            return profiles

        for item in items:
            if item != "Default" and not item.startswith("Profile "):
                continue
            history_file = os.path.join(user_data_path, item, "History")
            if os.path.isfile(history_file):
                profiles.append((item, history_file))
        return profiles

    @classmethod
    def chrome_time_to_iso(cls, chrome_time):
        try:
            value = int(chrome_time)
            if value <= 0:
                return None
            return (cls.CHROME_EPOCH + timedelta(microseconds=value)).isoformat()
        except (OverflowError, TypeError, ValueError):
            return None

    @classmethod
    def current_chrome_time(cls):
        return int((datetime.now(timezone.utc) - cls.CHROME_EPOCH).total_seconds() * 1_000_000)

    def _checkpoint_for(self, checkpoint_key):
        value = self.checkpoints.get(checkpoint_key)
        if isinstance(value, dict):
            try:
                return max(0, int(value.get("visit_time", 0))), max(
                    0, int(value.get("visit_id", 0))
                )
            except (TypeError, ValueError):
                pass
        elif isinstance(value, (int, float)):
            return max(0, int(value)), 0

        lookback_microseconds = self.initial_lookback_seconds * 1_000_000
        return max(0, self.current_chrome_time() - lookback_microseconds), 0

    def _save_profile_checkpoint(self, checkpoint_key, visit_time, visit_id):
        self.checkpoints[checkpoint_key] = {
            "visit_time": int(visit_time),
            "visit_id": int(visit_id),
        }
        self.save_checkpoints()

    @staticmethod
    def _remove_snapshot(snapshot_path):
        for suffix in ("", "-wal", "-shm", "-journal"):
            try:
                candidate = snapshot_path + suffix
                if os.path.exists(candidate):
                    os.remove(candidate)
            except OSError:
                pass

    def _save_status(self, browser_roots):
        status = {
            "agent_version": AGENT_VERSION,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "local_app_data": self.local_app_data,
            "browser_roots": [
                {"browser": browser, "path": path}
                for browser, path in browser_roots
            ],
            "profiles": self._current_scan_profiles,
            "records_discovered": sum(
                item.get("records_discovered", 0)
                for item in self._current_scan_profiles.values()
            ),
            "records_forwarded": sum(
                item.get("records_forwarded", 0)
                for item in self._current_scan_profiles.values()
            ),
        }
        temporary_path = self.status_path + ".tmp"
        try:
            with open(temporary_path, "w", encoding="utf-8") as stream:
                json.dump(status, stream, indent=2, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, self.status_path)
        except OSError as error:
            logging.warning("Could not write web tracker status: %s", error)
            try:
                if os.path.exists(temporary_path):
                    os.remove(temporary_path)
            except OSError:
                pass

    def _create_history_snapshot(self, history_file, snapshot_path):
        """Use SQLite backup so recent WAL entries are included while Edge is open."""
        self._remove_snapshot(snapshot_path)
        source = None
        destination = None
        backup_error = None
        try:
            source_uri = Path(history_file).resolve().as_uri() + "?mode=ro"
            source = sqlite3.connect(source_uri, uri=True, timeout=2)
            destination = sqlite3.connect(snapshot_path)
            deadline = time.monotonic() + 3.0

            def abort_stalled_backup(_status, _remaining, _total):
                if time.monotonic() >= deadline:
                    raise TimeoutError("browser History backup exceeded 3 seconds")

            source.backup(
                destination,
                pages=128,
                progress=abort_stalled_backup,
                sleep=0.05,
            )
            destination.commit()
        except Exception as error:
            backup_error = error
        finally:
            if destination is not None:
                destination.close()
            if source is not None:
                source.close()

        if backup_error is None:
            return True

        logging.warning(
            "SQLite backup failed for %s; using file copy fallback: %s",
            history_file,
            backup_error,
        )
        # Close both SQLite handles before replacing the destination. On Windows,
        # trying to copy while the failed backup connection is still open always
        # raises AccessDenied and makes the fallback ineffective.
        self._remove_snapshot(snapshot_path)
        try:
            # Copy the SQLite family so recent Edge/Chrome visits that still
            # live in WAL remain visible. A racing write can make one scan
            # inconsistent; that scan fails closed and the next 15s poll retries.
            shutil.copy2(history_file, snapshot_path)
            for suffix in ("-wal", "-shm"):
                source_sidecar = history_file + suffix
                if os.path.isfile(source_sidecar):
                    shutil.copy2(source_sidecar, snapshot_path + suffix)
            return True
        except Exception as copy_error:
            logging.warning("Could not snapshot browser History %s: %s", history_file, copy_error)
            self._remove_snapshot(snapshot_path)
            return False

    def _client_record_id(self, browser_name, profile_name, visit_id, visit_time, raw_url):
        namespace = uuid.UUID(self.tracker_instance_id)
        identity = "\n".join(
            (browser_name, profile_name, str(visit_id), str(visit_time), raw_url)
        )
        return str(uuid.uuid5(namespace, identity))

    def scan_profile_history(self, browser_name, profile_name, history_file):
        checkpoint_key = f"{browser_name}:{profile_name}"
        profile_status = {
            "history_file": history_file,
            "records_discovered": 0,
            "records_forwarded": 0,
            "error": None,
        }
        self._current_scan_profiles[checkpoint_key] = profile_status
        last_visit_time, last_visit_id = self._checkpoint_for(checkpoint_key)
        snapshot_name = f"History_{browser_name}_{profile_name.replace(' ', '_')}.sqlite"
        snapshot_path = os.path.join(self.temp_dir, snapshot_name)
        if not self._create_history_snapshot(history_file, snapshot_path):
            profile_status["error"] = "history_snapshot_failed"
            return None

        latest_visit_time = last_visit_time
        latest_visit_id = last_visit_id
        last_response = None
        try:
            connection = sqlite3.connect(snapshot_path)
            try:
                rows = connection.execute(
                    """
                    SELECT visits.id, urls.url, urls.title,
                           visits.visit_time, visits.visit_duration
                    FROM urls
                    JOIN visits ON urls.id = visits.url
                    WHERE visits.visit_time > ?
                       OR (visits.visit_time = ? AND visits.id > ?)
                    ORDER BY visits.visit_time ASC, visits.id ASC
                    LIMIT ?
                    """,
                    (
                        last_visit_time,
                        last_visit_time,
                        last_visit_id,
                        self.MAX_RECORDS_PER_PROFILE_SCAN,
                    ),
                ).fetchall()
            finally:
                connection.close()
            profile_status["records_discovered"] = len(rows)

            for visit_id, raw_url, title, visit_time, visit_duration in rows:
                if not isinstance(raw_url, str):
                    latest_visit_time, latest_visit_id = visit_time, visit_id
                    continue

                parsed = urlparse(raw_url)
                if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
                    latest_visit_time, latest_visit_id = visit_time, visit_id
                    continue

                visit_iso = self.chrome_time_to_iso(visit_time)
                if not visit_iso:
                    latest_visit_time, latest_visit_id = visit_time, visit_id
                    continue

                duration_seconds = 0
                if visit_duration:
                    duration_seconds = min(
                        self.MAX_DURATION_SECONDS,
                        max(0, int(visit_duration / 1_000_000)),
                    )

                client_record_id = self._client_record_id(
                    browser_name,
                    profile_name,
                    visit_id,
                    visit_time,
                    raw_url,
                )
                response = self.pipe_client.send_web_tracking(
                    url=raw_url[:500],
                    domain=parsed.hostname.lower()[:200],
                    visit_time=visit_iso,
                    duration_seconds=duration_seconds,
                    page_title=(title or parsed.hostname)[:500],
                    client_record_id=client_record_id,
                )
                if not isinstance(response, dict) or response.get("tracking_ack") != client_record_id:
                    profile_status["error"] = "service_did_not_acknowledge"
                    break

                last_response = response
                profile_status["records_forwarded"] += 1
                latest_visit_time, latest_visit_id = visit_time, visit_id

            if (latest_visit_time, latest_visit_id) != (last_visit_time, last_visit_id):
                self._save_profile_checkpoint(
                    checkpoint_key, latest_visit_time, latest_visit_id
                )
            return last_response
        except Exception as error:
            logging.error("Error reading browser history for %s: %s", checkpoint_key, error)
            profile_status["error"] = str(error)[:300]
            return None
        finally:
            self._remove_snapshot(snapshot_path)

    def poll(self, force=False):
        now = time.monotonic()
        if not force and now - self.last_scan_monotonic < self.scan_interval_seconds:
            return None
        self.last_scan_monotonic = now

        last_response = None
        browser_roots = self.get_browser_user_data_paths()
        self._current_scan_profiles = {}
        for browser_name, user_data_path in browser_roots:
            for profile_name, history_file in self.get_profiles_for_browser(user_data_path):
                response = self.scan_profile_history(
                    browser_name, profile_name, history_file
                )
                if response is not None:
                    last_response = response
        self._save_status(browser_roots)
        return last_response
