import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch


AGENT_ROOT = Path(__file__).resolve().parent.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


app_tracker_module = load_module(
    "companion_app_tracker",
    AGENT_ROOT / "companion" / "app_tracker.py",
)
AppTracker = app_tracker_module.AppTracker


def datetime_sequence(values):
    iterator = iter(values)

    class SequenceDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            value = next(iterator)
            return value if tz is None else value.astimezone(tz)

    return SequenceDateTime


class FakePipeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def send_app_tracking(self, **segment):
        self.calls.append(segment)
        return self.responses.pop(0)


class AppTrackingAcknowledgementTest(unittest.TestCase):
    def test_reads_only_bounded_executable_version_metadata(self):
        process = Mock()
        process.name.return_value = "study.exe"
        process.exe.return_value = r"C:\Program Files\Study\study.exe"

        def version_info(_path, key):
            if key == r"\VarFileInfo\Translation":
                return [(0x0409, 0x04B0)]
            if key.endswith(r"\ProductName"):
                return "Study Classroom"
            if key.endswith(r"\FileDescription"):
                return "Learning utility"
            raise RuntimeError(key)

        with patch.object(app_tracker_module.win32gui, "GetForegroundWindow", return_value=1), \
             patch.object(
                 app_tracker_module.win32process,
                 "GetWindowThreadProcessId",
                 return_value=(1, 42),
             ), patch.object(app_tracker_module.psutil, "Process", return_value=process), \
             patch.object(
                 app_tracker_module.win32api,
                 "GetFileVersionInfo",
                 side_effect=version_info,
             ):
            metadata = AppTracker.get_foreground_app_metadata("study.exe")

        self.assertEqual(metadata, {
            "product_name": "Study Classroom",
            "file_description": "Learning utility",
        })

    def test_executable_version_metadata_never_exposes_a_path(self):
        process = Mock()
        process.name.return_value = "study.exe"
        process.exe.return_value = r"C:\\Program Files\\Study\\study.exe"

        def version_info(_path, key):
            if key == r"\VarFileInfo\Translation":
                return [(0x0409, 0x04B0)]
            if key.endswith(r"\ProductName"):
                return r"C:\\Program Files\\Study"
            if key.endswith(r"\FileDescription"):
                return "Learning utility"
            raise RuntimeError(key)

        with patch.object(app_tracker_module.win32gui, "GetForegroundWindow", return_value=1), \
             patch.object(
                 app_tracker_module.win32process,
                 "GetWindowThreadProcessId",
                 return_value=(1, 42),
             ), patch.object(app_tracker_module.psutil, "Process", return_value=process), \
             patch.object(
                 app_tracker_module.win32api,
                 "GetFileVersionInfo",
                 side_effect=version_info,
             ):
            metadata = AppTracker.get_foreground_app_metadata("study.exe")

        self.assertEqual(metadata, {"file_description": "Learning utility"})

    def test_retryable_pipe_error_does_not_drop_pending_app_segment(self):
        record_id = "app-record-1"
        pipe_client = FakePipeClient([
            {"error": "processing_failed", "retryable": True},
            {"tracking_ack": record_id},
        ])
        tracker = AppTracker(pipe_client)
        tracker.pending_segments = [{
            "client_record_id": record_id,
            "app_name": "browser.exe",
            "start_time": "2026-08-19T08:00:00+07:00",
            "end_time": "2026-08-19T08:00:30+07:00",
            "duration_seconds": 30,
        }]

        tracker._send_pending_segments()
        self.assertEqual(len(tracker.pending_segments), 1)

        tracker._send_pending_segments()
        self.assertEqual(tracker.pending_segments, [])
        self.assertEqual(len(pipe_client.calls), 2)

    def test_missing_foreground_closes_segment_before_next_day(self):
        record_responses = []

        class AckPipe:
            def __init__(self):
                self.calls = []

            def send_app_tracking(self, **segment):
                self.calls.append(segment)
                record_responses.append(segment)
                return {"tracking_ack": segment["client_record_id"]}

        pipe_client = AckPipe()
        tracker = AppTracker(pipe_client)
        first = datetime(2026, 8, 19, 22, 0, tzinfo=timezone(timedelta(hours=7)))
        missing = first + timedelta(seconds=5)
        next_morning = first + timedelta(hours=10)
        tracker.get_foreground_app_name = Mock(
            side_effect=["browser.exe", None, "browser.exe"]
        )

        with patch.object(
            app_tracker_module,
            "datetime",
            datetime_sequence([first, missing, next_morning]),
        ), patch.object(
            app_tracker_module.time,
            "monotonic",
            side_effect=[100.0, 105.0, 36100.0],
        ):
            tracker.poll()
            tracker.poll()
            tracker.poll()

        self.assertEqual(len(record_responses), 1)
        self.assertEqual(record_responses[0]["app_name"], "browser.exe")
        self.assertEqual(record_responses[0]["duration_seconds"], 5)
        self.assertEqual(tracker.current_app, "browser.exe")
        self.assertEqual(tracker.app_start_monotonic, 36100.0)

    def test_large_poll_gap_does_not_bridge_sleep(self):
        pipe_client = Mock()
        pipe_client.send_app_tracking.side_effect = lambda **segment: {
            "tracking_ack": segment["client_record_id"]
        }
        tracker = AppTracker(pipe_client)
        first = datetime(2026, 8, 19, 22, 0, tzinfo=timezone(timedelta(hours=7)))
        observed = first + timedelta(seconds=6)
        resumed = first + timedelta(hours=8)
        tracker.get_foreground_app_name = Mock(
            side_effect=["browser.exe", "browser.exe", "browser.exe"]
        )

        with patch.object(
            app_tracker_module,
            "datetime",
            datetime_sequence([first, observed, resumed]),
        ), patch.object(
            app_tracker_module.time,
            "monotonic",
            side_effect=[100.0, 106.0, 28900.0],
        ):
            tracker.poll()
            tracker.poll()
            tracker.poll()

        segment = pipe_client.send_app_tracking.call_args.kwargs
        self.assertEqual(pipe_client.send_app_tracking.call_count, 1)
        self.assertEqual(segment["duration_seconds"], 6)
        self.assertEqual(tracker.app_start_monotonic, 28900.0)

    def test_lock_screen_process_is_never_tracked(self):
        pipe_client = Mock()
        pipe_client.send_app_tracking.side_effect = lambda **segment: {
            "tracking_ack": segment["client_record_id"]
        }
        tracker = AppTracker(pipe_client)
        first = datetime(2026, 8, 19, 20, 0, tzinfo=timezone(timedelta(hours=7)))
        tracker.get_foreground_app_name = Mock(
            side_effect=["browser.exe", "LockApp.exe", "LockApp.exe"]
        )

        with patch.object(
            app_tracker_module,
            "datetime",
            datetime_sequence([
                first,
                first + timedelta(seconds=5),
                first + timedelta(seconds=35),
            ]),
        ), patch.object(
            app_tracker_module.time,
            "monotonic",
            side_effect=[100.0, 105.0, 135.0],
        ):
            tracker.poll()
            tracker.poll()
            tracker.poll()

        self.assertEqual(pipe_client.send_app_tracking.call_count, 1)
        self.assertEqual(
            pipe_client.send_app_tracking.call_args.kwargs["app_name"],
            "browser.exe",
        )
        self.assertIsNone(tracker.current_app)


if __name__ == "__main__":
    unittest.main()
