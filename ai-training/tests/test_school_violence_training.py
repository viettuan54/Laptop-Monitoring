import csv
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.predict import load_model
from unittest.mock import patch

from school_violence.training import LABELS, evaluate, fit, load_source, load_sources, main, predict, run, split_records

FIELDS = ["id", "text", "label", "group_id", "split", "source", "review_status", "dataset_version"]


def row(identifier, text, label="SAFE", group=None, split="train", **metadata):
    return {"id": identifier, "text": text, "label": label, "group_id": group or identifier,
            "split": split, "source": "synthetic", "review_status": "unreviewed",
            "dataset_version": "v2.2", **metadata}


def write_csv(path, rows):
    fields = list(dict.fromkeys(FIELDS + [key for item in rows for key in item]))
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def corpus(prefix="example"):
    return [row(f"{prefix}-{split}-{label}", f"{prefix} văn bản {label} {split}", label, split=split)
            for split in ("train", "validation", "test") for label in LABELS]


class SchoolViolenceTrainingTests(unittest.TestCase):
    def test_rejects_private_or_non_synthetic_training_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "data.csv"
            write_csv(source, [row("one", "Liên hệ child@example.com")])
            with self.assertRaisesRegex(ValueError, "Potential private identifier") as captured:
                load_source(source)
            self.assertNotIn("child@example.com", str(captured.exception))
            write_csv(source, [row("one", "Một câu ví dụ", source="internal", review_status="reviewed")])
            with self.assertRaisesRegex(ValueError, "only accepts synthetic"):
                load_source(source)

    def test_dedup_and_grouped_split(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "data.csv"
            rows = [row(f"{label}-{index}", f"Ví dụ {label} số {index}", label,
                        split="train" if index < 8 else "validation" if index < 10 else "test")
                    for label in LABELS for index in range(12)]
            rows.append(row("duplicate", "VÍ DỤ SAFE SỐ 0", group="duplicate-group"))
            write_csv(source, rows)
            records, audit = load_source(source)
            self.assertEqual(audit["removed_duplicate_rows"], 1)
            self.assertEqual(audit["original_cross_split_groups"], 0)
            splits, report = split_records(records)
            self.assertEqual(report["cross_split_normalized_groups"], 0)
            self.assertTrue(report["csv_split_preserved"])
            for name in ("train", "validation", "test"):
                self.assertEqual(set(LABELS), {row["label"] for row in splits[name]})
                self.assertTrue(all(item["split"] == name for item in splits[name]))
            model = fit(splits["train"], 1.0)
            self.assertIn(predict(model, "Ví dụ SAFE số 1"), LABELS)
            self.assertIn("confusion_matrix", evaluate(model, splits["test"]))
            output = Path(directory) / "artifact"
            report = run(source, output)
            self.assertFalse(report["deployment_eligible"])
            self.assertEqual(sum(report["split"]["counts"][name][label]
                                 for name in ("train", "validation", "test") for label in LABELS), 36)
            self.assertEqual(tuple(load_model(output / "model.json.gz")["labels"]), LABELS)
            with self.assertRaises(FileExistsError):
                run(source, output)

    def test_combines_inputs_preserves_splits_and_artifact_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            query, page = Path(directory) / "query.csv", Path(directory) / "page.csv"
            query_rows, page_rows = corpus("query"), corpus("page")
            write_csv(query, query_rows)
            write_csv(page, page_rows)
            originals = [query.read_bytes(), page.read_bytes()]
            output = Path(directory) / "artifact"
            report = run([query, page], output, model_version="test-model-v3", dataset_version="combined-test-v2.2")
            self.assertEqual(report["source_audit"]["source_rows"], 18)
            self.assertEqual(len(report["source_audit"]["inputs"]), 2)
            self.assertFalse(report["deployment_eligible"])
            self.assertTrue(report["training_performed"])
            for split in ("train", "validation", "test"):
                with (output / f"{split}.jsonl").open(encoding="utf-8") as handle:
                    exported = [json.loads(line) for line in handle]
                expected = {r["id"]: r for r in query_rows + page_rows if r["split"] == split}
                self.assertEqual(set(expected), {r["id"] for r in exported})
                for record in exported:
                    self.assertEqual(record["group_id"], expected[record["id"]]["group_id"])
                    self.assertEqual(record["split"], split)
                    self.assertEqual(record["text"], expected[record["id"]]["text"])
            configuration = json.loads((output / "training_config.json").read_text(encoding="utf-8"))
            manifest = json.loads((output / "dataset_manifest.json").read_text(encoding="utf-8"))
            model = load_model(output / "model.json.gz")
            self.assertEqual(configuration["input_columns"], ["text"])
            self.assertFalse(configuration["resplit"])
            self.assertEqual(configuration["selected_alpha"], model["alpha"])
            self.assertEqual(model["training_configuration"], configuration)
            self.assertEqual(model["model_version"], "test-model-v3")
            self.assertEqual(model["dataset_version"], "combined-test-v2.2")
            self.assertEqual(model["combined_dataset_sha256"], manifest["combined_dataset_sha256"])
            self.assertEqual([query.read_bytes(), page.read_bytes()], originals)

    def test_validate_only_does_not_train_or_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "query.csv", Path(directory) / "output"
            write_csv(source, corpus())
            with patch("school_violence.training.fit", side_effect=AssertionError("must not train")):
                report = run(source, output, validate_only=True)
            self.assertFalse(output.exists())
            self.assertFalse(report["training_performed"])
            self.assertEqual(report["dataset_version"], "school-violence-combined-v2.2")
            self.assertEqual(report["configuration"]["input_columns"], ["text"])

    def test_cli_supports_multiple_or_repeated_input_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.csv", Path(directory) / "second.csv"
            output = Path(directory) / "output"
            write_csv(first, corpus("first"))
            write_csv(second, corpus("second"))
            for arguments in (["--input", str(first), str(second)],
                              ["--input", str(first), "--input", str(second)]):
                with self.subTest(arguments=arguments):
                    stream = io.StringIO()
                    argv = ["trainer", *arguments, "--output-dir", str(output), "--validate-only",
                            "--model-version", "cli-v3", "--alpha-candidates", "0.25", "1"]
                    with patch.object(sys, "argv", argv), contextlib.redirect_stdout(stream):
                        main()
                    report = json.loads(stream.getvalue())
                    self.assertEqual(report["source_audit"]["source_rows"], 18)
                    self.assertEqual(report["model_version"], "cli-v3")
                    self.assertEqual(report["configuration"]["alpha_candidates"], [.25, 1])
                    self.assertFalse(report["training_performed"])
                    self.assertFalse(output.exists())

    def test_multifile_ids_and_bad_csv_shape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.csv", Path(directory) / "second.csv"
            write_csv(first, [row("same-id", "Văn bản thứ nhất")])
            write_csv(second, [row("same-id", "Văn bản thứ hai")])
            with self.assertRaisesRegex(ValueError, "Duplicate ID"):
                load_sources([first, second])
            for bad_csv in (
                ",".join(FIELDS) + "\na,test,SAFE,g,train,synthetic,unreviewed\n",
                ",".join(FIELDS) + "\na,test,SAFE,g,train,synthetic,unreviewed,v2.2,extra\n",
                ",".join(FIELDS + ["text"]) + "\n",
            ):
                first.write_text(bad_csv, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Malformed|duplicate CSV columns"):
                    load_source(first)

    def test_metadata_never_changes_model_features(self):
        rows = corpus()
        poisoned = [{**item, "text_normalized": "metadata-only-secret-signal",
                     "original_text": "metadata-only-secret-signal", "query_type": item["label"],
                     "group_id": item["label"], "contains_quote": "metadata-only-secret-signal"}
                    for item in rows]
        self.assertEqual(fit(rows, 1.0), fit(poisoned, 1.0))

    def test_same_group_different_labels_is_allowed_in_one_split(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rows.csv"
            rows = corpus() + [row("context-a", "Em không bị bạn đánh", "RISK", group="context"),
                               row("context-b", "Bạn va vào em rồi xin lỗi", "SAFE", group="context")]
            write_csv(source, rows)
            records, _ = load_source(source)
            splits, _ = split_records(records)
            self.assertEqual({r["id"] for r in splits["train"] if r["group_id"] == "context"}, {"context-a", "context-b"})

    def test_dedup_in_same_split_retains_all_source_ids_and_groups(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.csv", Path(directory) / "second.csv"
            write_csv(first, [row("a", "Cùng học bài", group="g-a", review_status="reviewed")])
            write_csv(second, [row("b", "  CÙNG HỌC BÀI  ", group="g-b")])
            records, audit = load_sources([first, second])
            self.assertEqual(len(records), 1)
            self.assertEqual(audit["removed_duplicate_rows"], 1)
            self.assertEqual(records[0]["source_ids"], ["a", "b"])
            self.assertEqual(records[0]["group_ids"], ["g-a", "g-b"])
            self.assertEqual(len(records[0]["source_refs"]), 2)
            self.assertEqual(records[0]["review_status"], "unreviewed")

    def test_combined_leakage_and_conflicts_fail_before_writing(self):
        cases = [
            (row("a", "Một câu"), row("b", "MỘT CÂU", split="test"), "cross-split exact duplicate"),
            (row("a", "Nội dung thứ nhất", group="shared"), row("b", "Nội dung thứ hai", group="shared", split="test"), "Cross-split leakage"),
            (row("a", "bị bắt nạt"), row("b", "bi bat nat", split="test"), "Cross-split leakage"),
            (row("a", "Câu có lỗi gõ", text_normalized="bị bắt nạt"), row("b", "bi bat nat", split="test"), "Cross-split leakage"),
            (row("a", "Một câu"), row("b", "Một câu", label="HIGH_RISK"), "Conflicting labels"),
            (row("a", "bị bắt nạt"), row("b", "bi bat nat", label="HIGH_RISK"), "Conflicting labels"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.csv", Path(directory) / "second.csv"
            output = Path(directory) / "output"
            for a, b, error in cases:
                with self.subTest(error=error, first=a["text"]):
                    write_csv(first, [a])
                    write_csv(second, [b])
                    with self.assertRaisesRegex(ValueError, error):
                        run([first, second], output, validate_only=True)
                    self.assertFalse(output.exists())

    def test_page_body_and_page_id_leakage_detected_across_files(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "first.csv", Path(directory) / "second.csv"
            a = row("a", "Tiêu đề A\nCùng một nội dung", title="Tiêu đề A", content="Cùng một nội dung", page_id="p-a")
            b = row("b", "Tiêu đề B\nCùng một nội dung", title="Tiêu đề B", content="Cùng một nội dung", page_id="p-b", split="test")
            write_csv(first, [a])
            write_csv(second, [b])
            with self.assertRaisesRegex(ValueError, "page_body"):
                load_sources([first, second])
            b.update(text="Tiêu đề B\nNội dung khác", content="Nội dung khác", page_id="p-a")
            write_csv(second, [b])
            with self.assertRaisesRegex(ValueError, "page_id"):
                load_sources([first, second])
            # A query equal to a page's body cannot be silently placed in test.
            write_csv(second, [row("b", "Cùng một nội dung", split="test")])
            with self.assertRaisesRegex(ValueError, "equivalent_text"):
                load_sources([first, second])

    def test_malformed_schema_ids_metadata_and_splits_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rows.csv"
            for changes, error in [({"group_id": ""}, "group_id"), ({"dataset_version": ""}, "dataset_version"),
                                   ({"split": "unknown"}, "Invalid source split"),
                                   ({"text_runtime_normalized": "not-the-runtime-output"}, "Stale runtime"),
                                   ({"content": "part", "title": "title"}, "Page text")]:
                with self.subTest(changes=changes):
                    write_csv(source, [row("a", "Nội dung", **changes)])
                    with self.assertRaisesRegex(ValueError, error):
                        load_source(source)
            write_csv(source, [row("a", "Nội dung"), row("a", "Nội dung khác")])
            with self.assertRaisesRegex(ValueError, "Duplicate ID"):
                load_source(source)
            with self.assertRaisesRegex(ValueError, "distinct"):
                load_sources([source, source])
            source.write_text("id,text,label,split,source,review_status\na,test,SAFE,train,synthetic,unreviewed\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Missing"):
                load_source(source)

    def test_missing_label_in_csv_split_is_not_automatically_repaired(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "rows.csv"
            write_csv(source, [row("a", "Nội dung")])
            records, _ = load_source(source)
            with self.assertRaisesRegex(ValueError, "must contain every label"):
                split_records(records)

    def test_invalid_alpha_or_versions_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "rows.csv", Path(directory) / "output"
            write_csv(source, corpus())
            for candidates in ((), (0,), (-1,), (float("nan"),), (float("inf"),)):
                with self.assertRaisesRegex(ValueError, "Alpha candidates"):
                    run(source, output, alpha_candidates=candidates)
            with self.assertRaisesRegex(ValueError, "versions"):
                run(source, output, model_version=" ")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
