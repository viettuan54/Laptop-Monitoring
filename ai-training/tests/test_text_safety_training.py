import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from text_safety.training import (
    AnnotationRecord,
    TextSafetyTrainingError,
    canonical_labels,
    format_model_text,
    grouped_multilabel_split,
    load_jsonl_records,
    load_training_config,
    multilabel_evaluation,
    select_thresholds,
    run_training,
    validate_annotation_records,
)


def make_record(
    record_id,
    group,
    labels=(),
    *,
    text=None,
    split="train",
    annotators=("reviewer-001", "reviewer-002"),
):
    return AnnotationRecord(
        payload={
            "record_id": record_id,
            "conversation_id": group,
            "subject_id": None,
            "text": text or f"Nội dung đã ẩn danh {record_id}",
            "context": [],
            "labels": list(labels),
            "target": "child",
            "source_type": "chat_received",
            "direction": "received",
            "severity": "high" if labels else "low",
            "requires_immediate_alert": False,
            "annotator_ids": list(annotators),
            "split": split,
            "provenance": {
                "source": "internal_anonymized",
                "license": "internal-reviewed",
                "allowed_use": "internal_evaluation",
            },
        },
        source_path="unit-test.jsonl",
        source_line=1,
    )


class TextSafetyTrainingPreparationTest(unittest.TestCase):
    def test_dataset_contract_requires_two_reviewers_and_grouping_key(self):
        invalid = make_record(
            "record-001", "conversation-001", annotators=("reviewer-001",)
        )

        with self.assertRaisesRegex(TextSafetyTrainingError, "fails schema"):
            validate_annotation_records([invalid])

    def test_camel_case_alert_field_is_canonicalized_at_ingestion(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "records.jsonl"
            payload = make_record("record-001", "conversation-001").payload
            payload.pop("requires_immediate_alert")
            payload["requiresImmediateAlert"] = True
            path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
            records = load_jsonl_records([path])

        self.assertTrue(records[0].payload["requires_immediate_alert"])
        self.assertNotIn("requiresImmediateAlert", records[0].payload)

    def test_text_with_possible_personal_identifier_is_rejected_without_echoing_text(self):
        sensitive = "Liên hệ secret.person@example.test ngay"
        invalid = make_record("record-001", "conversation-001", text=sensitive)

        with self.assertRaises(TextSafetyTrainingError) as captured:
            validate_annotation_records([invalid])

        self.assertNotIn(sensitive, str(captured.exception))

    def test_reviewed_vihos_span_is_accepted_but_out_of_bounds_span_is_not(self):
        text = "Bạn thật ngu"
        valid = make_record("record-001", "conversation-001", ("harassment",), text=text)
        valid.payload["offensive_spans"] = [
            {"start": text.index("ngu"), "end": len(text), "source_label": "offensive"}
        ]
        invalid = make_record("record-002", "conversation-002", ("harassment",), text=text)
        invalid.payload["offensive_spans"] = [{"start": 0, "end": len(text) + 1}]

        self.assertEqual(validate_annotation_records([valid])[0].record_id, "record-001")
        with self.assertRaisesRegex(TextSafetyTrainingError, "span"):
            validate_annotation_records([invalid])

    def test_grouped_split_never_divides_a_conversation_and_is_deterministic(self):
        records = [
            make_record("r1", "conversation-a", ("harassment",)),
            make_record("r2", "conversation-a", ("harassment/threatening",)),
            make_record("r3", "conversation-b", ("self-harm/intent",)),
            make_record("r4", "conversation-c", ("violence/inciting",)),
            make_record("r5", "conversation-d", ("hate",)),
            make_record("r6", "conversation-e", ()),
            make_record("r7", "conversation-f", ("self-harm",)),
        ]
        first, metadata = grouped_multilabel_split(
            records,
            ratios={"train": 0.6, "validation": 0.2, "test": 0.2},
            seed="split-test",
        )
        second, _ = grouped_multilabel_split(
            records,
            ratios={"train": 0.6, "validation": 0.2, "test": 0.2},
            seed="split-test",
        )

        owners = {}
        for split, items in first.items():
            for record in items:
                owners.setdefault(record.group_key, split)
                self.assertEqual(owners[record.group_key], split)
        self.assertEqual(
            {split: [record.record_id for record in items] for split, items in first.items()},
            {split: [record.record_id for record in items] for split, items in second.items()},
        )
        self.assertEqual(metadata["group_count"], 6)

    def test_model_input_keeps_metadata_and_normalizes_obfuscation(self):
        record = make_record(
            "record-001",
            "conversation-001",
            text="DMM m nói c.h.ế.t đi 💀",
        )

        text = format_model_text(record)

        self.assertIn("nguon_chat_received", text)
        self.assertIn("huong_received", text)
        self.assertIn("dit me may", text)
        self.assertIn("chết đi", text)
        self.assertIn("emoji_skull", text)


class TextSafetyTrainingEvaluationTest(unittest.TestCase):
    def test_multilabel_evaluation_tracks_fps_fns_confusion_and_critical_recall(self):
        records = [
            make_record("r1", "conversation-a", ("self-harm/intent",)),
            make_record("r2", "conversation-b", ("harassment/threatening",)),
            make_record("r3", "conversation-c", ()),
        ]
        labels = ("self-harm/intent", "harassment/threatening")
        report = multilabel_evaluation(
            records,
            probabilities=[[0.9, 0.1], [0.1, 0.4], [0.7, 0.2]],
            thresholds={"self-harm/intent": 0.5, "harassment/threatening": 0.5},
            labels=labels,
        )

        self.assertEqual(report["per_label"]["self-harm/intent"]["confusion_matrix"]["false_positive"], 1)
        self.assertEqual(report["per_label"]["harassment/threatening"]["confusion_matrix"]["false_negative"], 1)
        self.assertEqual(report["critical_recall"]["self_harm_intent"], 1.0)
        self.assertEqual(report["critical_recall"]["harassment_threatening"], 0.0)
        self.assertEqual(report["false_positives"][0]["record_id"], "r3")
        self.assertNotIn("text", report["false_positives"][0])

    def test_threshold_selection_prioritizes_required_self_harm_recall(self):
        records = [
            make_record("r1", "conversation-a", ("self-harm/intent",)),
            make_record("r2", "conversation-b", ("self-harm/intent",)),
            make_record("r3", "conversation-c", ()),
        ]
        thresholds, details = select_thresholds(
            records,
            probabilities=[[0.7], [0.55], [0.52]],
            candidates=[0.5, 0.6],
            minimum_recall={"self-harm/intent": 1.0},
            labels=("self-harm/intent",),
        )

        self.assertEqual(thresholds["self-harm/intent"], 0.5)
        self.assertTrue(details["self-harm/intent"]["recall_constraint_met"])

    def test_default_training_config_is_pinned_and_valid(self):
        config = load_training_config()

        self.assertEqual(config["model"]["id"], "FacebookAI/xlm-roberta-base")
        self.assertEqual(len(config["model"]["revision"]), 40)
        self.assertIn("self-harm/intent", config["threshold_tuning"]["minimum_recall"])

    def test_run_writes_versioned_privacy_safe_artifacts_without_training_text(self):
        labels = canonical_labels()
        records = [
            make_record("r1", "conversation-a", split="train"),
            make_record("r2", "conversation-b", split="validation"),
            make_record("r3", "conversation-c", split="test"),
        ]
        probabilities = [[0.1] * len(labels)]
        run_summary = {
            "base_model": "test/model",
            "requested_revision": "a" * 40,
            "resolved_revision": "a" * 40,
            "positive_class_weights": {label: 1.0 for label in labels},
            "training_metrics": {"train_loss": 0.1},
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "accepted.jsonl"
            input_path.write_text(
                "\n".join(json.dumps(record.payload, ensure_ascii=False) for record in records) + "\n",
                encoding="utf-8",
            )
            output_dir = root / "artifact"
            with patch(
                "text_safety.training.train_model",
                return_value=(object(), object(), probabilities, probabilities, run_summary),
            ):
                report = run_training(
                    [input_path], output_dir=output_dir, preserve_splits=True
                )
            manifest = json.loads((output_dir / "training_manifest.json").read_text(encoding="utf-8"))
            evaluation = json.loads((output_dir / "evaluation_report.json").read_text(encoding="utf-8"))

        self.assertFalse(report["deployment_approved"])
        self.assertEqual(manifest["dataset_version"], "vi-text-safety-v1")
        self.assertEqual(manifest["privacy"]["raw_text_written_to_reports"], False)
        self.assertNotIn(records[2].payload["text"], json.dumps(evaluation))


if __name__ == "__main__":
    unittest.main()
