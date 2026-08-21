import hashlib
import json
import math
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ROOT = os.path.join(AGENT_ROOT, "service")
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from content_classifier import ContentClassifier, ContentModelError
from pipe_server import PipeServer


CLASSES = ["education", "entertainment", "social", "unsafe", "unknown"]


def write_test_model(models_dir):
    model = {
        "model_version": "1.2.0",
        "model_type": "char_ngram_multinomial_nb",
        "resource_type": "websites",
        "classes": CLASSES,
        "key_field": "domain",
        "confidence_threshold": 0.7,
        "temperature": 1.0,
        "feature_config": {"minimum_n": 2, "maximum_n": 2},
        "class_log_prior": {label: math.log(0.2) for label in CLASSES},
        "default_log_likelihood": {label: -10.0 for label in CLASSES},
        "feature_log_likelihood": {
            "token:school": {
                "education": 0.0,
                "entertainment": -10.0,
                "social": -10.0,
                "unsafe": -10.0,
                "unknown": -10.0,
            }
        },
        "deployment_approved": True,
    }
    path = os.path.join(models_dir, "web_content_model_v1.json")
    payload = json.dumps(model, sort_keys=True).encode("utf-8")
    with open(path, "wb") as stream:
        stream.write(payload)
    with open(path + ".sha256", "w", encoding="ascii") as stream:
        stream.write(hashlib.sha256(payload).hexdigest() + "\n")
    return path


class ContentClassifierTest(unittest.TestCase):
    def test_verified_model_classifies_domain_locally(self):
        with tempfile.TemporaryDirectory() as models_dir:
            write_test_model(models_dir)
            classifier = ContentClassifier(models_dir)
            result = classifier.classify_web("www.school.test")

        self.assertEqual(result["domain"], "school.test")
        self.assertEqual(result["label"], "education")
        self.assertGreaterEqual(result["confidence"], 0.7)
        self.assertFalse(result["requires_gemini"])

    def test_checksum_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as models_dir:
            path = write_test_model(models_dir)
            with open(path, "ab") as stream:
                stream.write(b" ")
            with self.assertRaises(ContentModelError):
                ContentClassifier(models_dir)

    def test_switch_off_skips_both_local_model_and_gemini(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": False
        }
        classifier = Mock()
        api_client = Mock()
        server = PipeServer(Mock(), enforcement, api_client, classifier)

        result = server.classify_web_domain("example.test")

        self.assertEqual(result["source"], "disabled")
        classifier.classify_web.assert_not_called()
        api_client.classify_web_domain.assert_not_called()

    def test_low_confidence_uses_domain_only_gemini_fallback(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True
        }
        classifier = Mock()
        classifier.classify_web.return_value = {
            "label": None,
            "confidence": 0.6,
        }
        api_client = Mock()
        api_client.classify_web_domain.return_value = "entertainment"
        server = PipeServer(Mock(), enforcement, api_client, classifier)

        result = server.classify_web_domain("youtube.com")

        self.assertEqual(result["category"], "entertainment")
        self.assertEqual(result["source"], "gemini")
        api_client.classify_web_domain.assert_called_once_with("youtube.com")
        classifier.remember_web_label.assert_called_once_with(
            "youtube.com", "entertainment", source="gemini"
        )

    def test_tracking_path_defers_low_confidence_remote_fallback(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True
        }
        classifier = Mock()
        classifier.classify_web.return_value = {
            "label": None,
            "confidence": 0.6,
        }
        api_client = Mock()
        server = PipeServer(Mock(), enforcement, api_client, classifier)

        result = server.classify_web_domain(
            "youtube.com",
            allow_remote_fallback=False,
        )

        self.assertEqual(result, {
            "category": "unknown",
            "source": "pending",
            "confidence": None,
        })
        api_client.classify_web_domain.assert_not_called()

    def test_cached_gemini_result_keeps_its_provenance(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True
        }
        classifier = Mock()
        classifier.classify_web.return_value = {
            "label": "education",
            "confidence": 1.0,
            "decision_source": "gemini",
        }
        api_client = Mock()
        server = PipeServer(Mock(), enforcement, api_client, classifier)

        result = server.classify_web_domain("school.example")

        self.assertEqual(result["source"], "gemini")
        self.assertIsNone(result["confidence"])
        api_client.classify_web_domain.assert_not_called()

    def test_pipe_processing_error_returns_retryable_response_and_closes_request(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": False
        }
        queue = Mock()
        queue.record_app_usage.return_value = (None, False)
        server = PipeServer(queue, enforcement)
        message = json.dumps({
            "action": "TRACK_APP",
            "app_name": "browser.exe",
            "start_time": "2026-08-19T08:00:00+07:00",
            "end_time": "2026-08-19T08:00:30+07:00",
            "duration_seconds": 30,
            "client_record_id": "bc24f35c-ce48-4c5e-8d99-e4b565056269",
        })

        with patch("pipe_server.win32file.WriteFile") as write_file:
            with self.assertRaises(RuntimeError):
                server._process_client_message(message, 123)

        response = json.loads(write_file.call_args.args[1].decode("utf-8"))
        self.assertEqual(response["error"], "processing_failed")
        self.assertTrue(response["retryable"])

    def test_app_tracking_is_acknowledged_only_after_local_persistence(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {}
        enforcement.check_policy_status.return_value = (False, "OK", 3600)
        queue = Mock()
        record_id = "bc24f35c-ce48-4c5e-8d99-e4b565056269"
        queue.record_app_usage.return_value = (record_id, True)
        server = PipeServer(queue, enforcement)
        message = json.dumps({
            "action": "TRACK_APP",
            "app_name": "browser.exe",
            "start_time": "2026-08-19T08:00:00+07:00",
            "end_time": "2026-08-19T08:00:30+07:00",
            "duration_seconds": 30,
            "client_record_id": record_id,
        })

        with patch("pipe_server.win32file.WriteFile") as write_file:
            server._process_client_message(message, 123)

        response = json.loads(write_file.call_args.args[1].decode("utf-8"))
        self.assertEqual(response["tracking_ack"], record_id)

    def test_app_tracking_validation_rejects_lock_and_oversized_segments(self):
        record_id = "bc24f35c-ce48-4c5e-8d99-e4b565056269"
        valid = {
            "app_name": "browser.exe",
            "start_time": "2026-08-19T08:00:00+07:00",
            "end_time": "2026-08-19T08:00:30+07:00",
            "duration_seconds": 30,
            "client_record_id": record_id,
        }

        invalid_payloads = [
            {**valid, "app_name": "LockApp.exe"},
            {**valid, "duration_seconds": 121},
            {**valid, "duration_seconds": True},
            {**valid, "start_time": "2026-08-19T08:00:00"},
            {
                **valid,
                "end_time": "2026-08-19T16:00:00+07:00",
            },
            {**valid, "client_record_id": "not-a-uuid"},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    PipeServer.validate_app_tracking_payload(payload)

    def test_classified_web_visit_is_forwarded_to_enforcement_after_persistence(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True,
        }
        enforcement.check_policy_status.return_value = (False, "OK", 3600)
        classifier = Mock()
        classifier.classify_web.return_value = {
            "label": "entertainment",
            "confidence": 0.95,
            "decision_source": "trained_model",
        }
        queue = Mock()
        record_id = "7e1459b0-395b-4d85-a3cd-1f6589d578ea"
        queue.enqueue_web_log.return_value = (record_id, True)
        server = PipeServer(queue, enforcement, Mock(), classifier)
        message = json.dumps({
            "action": "TRACK_WEB",
            "url": "https://gamevui.vn/play",
            "domain": "gamevui.vn",
            "visit_time": "2026-08-19T08:00:00+07:00",
            "duration_seconds": 3,
            "page_title": "Game vui",
            "client_record_id": record_id,
        })

        with patch("pipe_server.win32file.WriteFile") as write_file:
            server._process_client_message(message, 123)

        queue.enqueue_web_log.assert_called_once()
        enforcement.remember_web_classification.assert_called_once_with(
            "gamevui.vn",
            "entertainment",
            "trained_model",
        )
        response = json.loads(write_file.call_args.args[1].decode("utf-8"))
        self.assertEqual(response["tracking_ack"], record_id)

    def test_pending_web_visit_schedules_immediate_background_fallback(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True,
        }
        enforcement.check_policy_status.return_value = (False, "OK", 3600)
        classifier = Mock()
        classifier.classify_web.return_value = {"label": None, "confidence": 0.4}
        queue = Mock()
        record_id = "051575a0-ab87-4030-8a35-f250cbad8c62"
        queue.enqueue_web_log.return_value = (record_id, True)
        server = PipeServer(queue, enforcement, Mock(), classifier)
        server._schedule_web_classification = Mock(return_value=True)
        message = json.dumps({
            "action": "TRACK_WEB",
            "url": "https://gamevui.vn/",
            "domain": "gamevui.vn",
            "visit_time": "2026-08-19T08:00:00+07:00",
            "duration_seconds": 3,
            "page_title": "Game vui",
            "client_record_id": record_id,
        })

        with patch("pipe_server.win32file.WriteFile"):
            server._process_client_message(message, 123)

        server._schedule_web_classification.assert_called_once_with("gamevui.vn")
        enforcement.remember_web_classification.assert_called_once_with(
            "gamevui.vn",
            "unknown",
            "pending",
        )

    def test_background_worker_finalizes_and_enforces_gemini_result(self):
        enforcement = Mock()
        enforcement.load_cached_settings.return_value = {
            "enable_web_classification": True,
        }
        classifier = Mock()
        classifier.classify_web.return_value = {"label": None, "confidence": 0.4}
        api_client = Mock()
        api_client.classify_web_domain.return_value = "entertainment"
        queue = Mock()
        server = PipeServer(queue, enforcement, api_client, classifier)
        server.running = True
        server.classification_pending.add("gamevui.vn")
        server.classification_queue.put("gamevui.vn")
        server.classification_queue.put(None)

        server._classification_worker()

        queue.update_unknown_web_category.assert_called_once_with(
            "gamevui.vn",
            "entertainment",
            "gemini",
            None,
        )
        enforcement.remember_web_classification.assert_called_once_with(
            "gamevui.vn",
            "entertainment",
            "gemini",
        )
        api_client.backfill_web_domain.assert_called_once_with(
            "gamevui.vn",
            "entertainment",
            "gemini",
            None,
        )
        self.assertNotIn("gamevui.vn", server.classification_pending)


if __name__ == "__main__":
    unittest.main()
