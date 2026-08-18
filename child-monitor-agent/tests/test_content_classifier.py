import hashlib
import json
import math
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock


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


if __name__ == "__main__":
    unittest.main()
