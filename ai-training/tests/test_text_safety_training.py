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
    _fallback_schema_error,
    canonical_labels,
    deployment_gate,
    format_model_input,
    format_model_text,
    grouped_multilabel_split,
    load_jsonl_records,
    load_training_config,
    main,
    multilabel_evaluation,
    preserved_group_splits,
    select_thresholds,
    run_training,
    validate_annotation_records,
    validate_split_coverage,
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

    def test_schema_error_does_not_echo_oversized_text(self):
        sensitive = "SENSITIVE_MARKER" + "x" * 4000
        invalid = make_record("record-001", "conversation-001", text=sensitive)

        with self.assertRaises(TextSafetyTrainingError) as captured:
            validate_annotation_records([invalid])

        self.assertNotIn("SENSITIVE_MARKER", str(captured.exception))

    def test_optional_context_and_split_are_accepted_with_or_without_jsonschema(self):
        record = make_record("record-001", "conversation-001")
        record.payload.pop("context")
        record.payload.pop("split")

        self.assertIsNone(_fallback_schema_error(record.payload))
        self.assertEqual(validate_annotation_records([record]), [record])

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
                conversation_id = record.payload["conversation_id"]
                owners.setdefault(conversation_id, split)
                self.assertEqual(owners[conversation_id], split)
        self.assertEqual(
            {split: [record.record_id for record in items] for split, items in first.items()},
            {split: [record.record_id for record in items] for split, items in second.items()},
        )
        self.assertEqual(metadata["group_count"], 6)

    def test_same_user_and_duplicate_text_cannot_cross_splits(self):
        records = [
            make_record("r1", "conversation-a", text="Dòng chữ giống nhau"),
            make_record("r2", "conversation-b", text="Nội dung khác"),
            make_record("r3", "conversation-c", text="Dòng  chữ giống nhau"),
            make_record("r4", "conversation-d"),
            make_record("r5", "conversation-e"),
        ]
        records[0].payload["subject_id"] = "same-user"
        records[1].payload["subject_id"] = "same-user"
        splits, metadata = grouped_multilabel_split(
            validate_annotation_records(records),
            ratios={"train": 0.6, "validation": 0.2, "test": 0.2},
            seed="connected-groups",
        )
        owners = {
            record.record_id: split
            for split, items in splits.items()
            for record in items
        }

        self.assertEqual(owners["r1"], owners["r2"])
        self.assertEqual(owners["r1"], owners["r3"])
        self.assertEqual(metadata["group_count"], 3)
        self.assertTrue(all(splits.values()))

    def test_balanced_independent_groups_follow_configured_split_ratios(self):
        labels = canonical_labels()
        records = [
            make_record(
                f"row-{index}",
                f"conversation-{index}",
                (labels[index % len(labels)],),
                text=f"Nội dung duy nhất {index}",
            )
            for index in range(200)
        ]

        _, metadata = grouped_multilabel_split(
            records,
            ratios={"train": 0.7, "validation": 0.15, "test": 0.15},
            seed="split-ratio-regression",
        )

        self.assertEqual(metadata["split_counts"], {
            "train": 140, "validation": 30, "test": 30,
        })
        self.assertTrue(all(count > 0 for count in metadata["label_counts"]["validation"].values()))

    def test_auto_split_ignores_stale_split_values_but_preserve_rejects_them(self):
        records = [
            make_record("r1", "conversation-a", text="Câu đầu", split="train"),
            make_record("r2", "conversation-a", text="Câu sau", split="test"),
            make_record("r3", "conversation-b", split="validation"),
            make_record("r4", "conversation-c", split="train"),
        ]

        accepted = validate_annotation_records(records)
        splits, _ = grouped_multilabel_split(
            accepted,
            ratios={"train": 0.6, "validation": 0.2, "test": 0.2},
            seed="stale-splits",
        )
        owners = {
            record.record_id: split
            for split, items in splits.items()
            for record in items
        }
        self.assertEqual(owners["r1"], owners["r2"])
        with self.assertRaisesRegex(TextSafetyTrainingError, "multiple preserved splits"):
            preserved_group_splits(accepted)

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
        self.assertNotIn("muc_tieu", text)
        self.assertEqual(
            text,
            format_model_input(
                record.payload["text"],
                record.payload["source_type"],
                record.payload["direction"],
            ),
        )


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

    def test_internal_evaluation_data_cannot_receive_deployment_approval(self):
        config = load_training_config()
        report = {
            "macro": {"f1": 1.0},
            "per_label": {
                label: {"support": 25, "recall": 1.0}
                for label in config["acceptance"]["minimum_test_recall"]
            },
        }

        evaluation_only = deployment_gate(
            report, config["acceptance"], dataset_uses={"internal_evaluation"}
        )
        commercial = deployment_gate(
            report, config["acceptance"], dataset_uses={"commercial"}
        )
        validation = {
            label: {
                "selected": {"recall": 0.0},
                "minimum_recall": 0.9,
                "recall_constraint_met": False,
            }
            for label in config["acceptance"]["minimum_test_recall"]
        }
        failed_validation = deployment_gate(
            report,
            config["acceptance"],
            dataset_uses={"commercial"},
            validation_thresholds=validation,
        )

        self.assertFalse(evaluation_only["passed"])
        self.assertTrue(commercial["passed"])
        self.assertFalse(failed_validation["passed"])

    def test_training_coverage_requires_positive_and_negative_validation_examples(self):
        labels = canonical_labels()
        splits = {
            "train": [make_record("r1", "a", labels), make_record("r2", "b")],
            "validation": [make_record("r3", "c")],
            "test": [make_record("r4", "d")],
        }

        with self.assertRaisesRegex(TextSafetyTrainingError, "validation split"):
            validate_split_coverage(splits)

    def test_run_writes_versioned_privacy_safe_artifacts_without_training_text(self):
        labels = canonical_labels()
        records = [
            make_record("r1", "conversation-a", labels, split="train"),
            make_record("r2", "conversation-b", split="train"),
            make_record("r3", "conversation-c", labels, split="validation"),
            make_record("r4", "conversation-d", split="validation"),
            make_record("r5", "conversation-e", split="test"),
        ]
        validation_probabilities = [[0.9] * len(labels), [0.1] * len(labels)]
        test_probabilities = [[0.1] * len(labels)]
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
                return_value=(
                    object(), object(), validation_probabilities,
                    test_probabilities, run_summary,
                ),
            ):
                report = run_training(
                    [input_path], output_dir=output_dir, preserve_splits=True
                )
            manifest = json.loads((output_dir / "training_manifest.json").read_text(encoding="utf-8"))
            evaluation = json.loads((output_dir / "evaluation_report.json").read_text(encoding="utf-8"))

        self.assertFalse(report["deployment_approved"])
        self.assertEqual(manifest["dataset_version"], "vi-text-safety-v1")
        self.assertEqual(manifest["model_input_format_version"], "text-safety-input-v2")
        self.assertEqual(manifest["privacy"]["raw_text_written_to_reports"], False)
        self.assertNotIn(records[4].payload["text"], json.dumps(evaluation))

    def test_validate_only_cli_does_not_require_model_dependencies(self):
        labels = canonical_labels()
        records = [
            make_record("r1", "conversation-a", labels, split="train"),
            make_record("r2", "conversation-b", split="train"),
            make_record("r3", "conversation-c", labels, split="validation"),
            make_record("r4", "conversation-d", split="validation"),
            make_record("r5", "conversation-e", split="test"),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "accepted.jsonl"
            path.write_text(
                "\n".join(json.dumps(record.payload, ensure_ascii=False) for record in records) + "\n",
                encoding="utf-8",
            )
            with patch("builtins.print") as output:
                status = main(["--input", str(path), "--preserve-splits", "--validate-only"])

        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.call_args.args[0])["status"], "valid")


if __name__ == "__main__":
    unittest.main()
