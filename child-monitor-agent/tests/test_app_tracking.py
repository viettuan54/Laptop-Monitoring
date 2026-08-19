import importlib.util
import unittest
from pathlib import Path


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


class FakePipeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def send_app_tracking(self, **segment):
        self.calls.append(segment)
        return self.responses.pop(0)


class AppTrackingAcknowledgementTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
