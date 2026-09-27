import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from school_violence.prepare_datasets_v2_2 import (
    SEED, assign_splits, digest, group_rows, prepare, repair_page, repair_query,
)


class PrepareV22Tests(unittest.TestCase):
    def query(self, text, canonical, label="SAFE", query_type="negation_hard_negative"):
        return {"id": "example", "text": text, "text_raw": text,
                "text_normalized": canonical, "label": label, "query_type": query_type}

    def test_negation_policy_and_context(self):
        for text in ("em không bị bạn đánh ở lớp", "không ai dọa đánh em",
                     "không ai bắt nạt em", "không bị ai bắt nạt", "bạn không đánh em"):
            row = self.query(text, text)
            repair_query(row)
            self.assertEqual(row["label"], "RISK")
        for text in ("em bị ngã nhưng không có ai xô", "bạn va vào em rồi xin lỗi",
                     "bạn va phải em rồi xin lỗi, em không nghĩ đó là bắt nạt"):
            row = self.query(text, text)
            repair_query(row)
            self.assertEqual(row["label"], "SAFE")

    def test_hok_sinh_does_not_replace_standalone_hok(self):
        row = self.query("hok sinh noi hok muon di hoc", "học sinh nói không muốn đi học",
                         query_type="normal_search")
        repair_query(row)
        self.assertEqual(row["text"], "hoc sinh noi hok muon di hoc")
        self.assertEqual(row["text_raw"], row["text"])

    def test_short_query_not_silently_inferred_personal(self):
        row = self.query("bị bắt nạt", "bị bắt nạt", "RISK", "very_short_or_ambiguous")
        repair_query(row)
        self.assertEqual(row["label"], "RISK")
        self.assertEqual(row["annotation_status"], "needs_human_context_review")

    def test_no_quote_variants_preserve_context_and_label(self):
        group = next(f"G_{i}" for i in range(100) if int(digest(SEED + f"G_{i}"), 16) % 4 == 0)
        examples = (
            ("RISK", 'Tài liệu dành cho học sinh mô tả bắt nạt. Một ví dụ có câu "Tan học đợi đấy" để mọi người thảo luận cách phản ứng an toàn.'),
            ("HIGH_RISK", 'Hôm nay, bạn cùng lớp đánh em ở sân trường. Họ còn nói "Tan học đợi đấy". Em muốn có người giúp.'),
            ("HIGH_RISK", 'Em đang gặp chuyện với mấy bạn. Họ xô em ngã và có lần còn nói "Tan học đợi đấy". Em rất sợ.'),
        )
        for label, content in examples:
            row = {"title": "Ví dụ", "content": content, "label": label, "original_group_id": group}
            repair_page(row)
            self.assertEqual(row["label"], label)
            self.assertNotIn('"', row["content"])
            self.assertEqual(row["contains_quote"], "False")
            self.assertEqual(row["quote_type"], "none")
            self.assertEqual(row["text"], row["title"] + "\n" + row["content"])

    def test_transitive_groups_and_mixed_label_groups_not_split(self):
        rows = [
            {"id": "a", "original_group_id": "g1", "text": "bị bắt nạt", "text_normalized": "bị bắt nạt", "label": "RISK"},
            {"id": "b", "original_group_id": "g1", "text": "tai nạn", "text_normalized": "tai nạn", "label": "SAFE"},
            {"id": "c", "original_group_id": "g2", "text": "bi bat nat", "text_normalized": "bị bắt nạt", "label": "RISK"},
        ]
        group_rows(rows, "query")
        self.assertEqual(len({r["group_id"] for r in rows}), 1)
        assign_splits(rows)
        self.assertEqual(len({r["split"] for r in rows}), 1)

    def test_same_page_body_with_different_title_is_one_group(self):
        rows = [{"id": str(i), "original_group_id": f"g{i}", "page_id": f"p{i}",
                 "text": f"Tiêu đề {i}\nNội dung", "content": "Nội dung", "_original_content": "Nội dung"}
                for i in range(2)]
        group_rows(rows, "webpage")
        self.assertEqual(rows[0]["group_id"], rows[1]["group_id"])

    def test_prepare_preserves_source_and_reports_duplicates(self):
        columns = ["id", "group_id", "text", "text_raw", "text_normalized", "label", "query_type",
                   "source", "review_status", "dataset_version", "split", "evaluation_status", "notes"]
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.csv", Path(directory) / "output.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=columns)
                writer.writeheader()
                for i in range(2):
                    row = self.query("hok sinh hỏi: em không bị bạn đánh", "học sinh hỏi: em không bị bạn đánh")
                    row.update(id=f"q{i}", group_id=f"g{i}", source="synthetic", review_status="unreviewed",
                               dataset_version="v2.1", split="train", evaluation_status="provisional_unreviewed", notes="")
                    writer.writerow(row)
            original = source.read_bytes()
            report = prepare(source, output, "query")
            self.assertEqual(original, source.read_bytes())
            self.assertEqual(report["audit"]["rows"], 1)
            self.assertEqual(report["label_changes"], 2)
            self.assertEqual(len(report["removed_exact_duplicates"]), 1)
            with output.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[0]["label"], "RISK")
            self.assertEqual(rows[0]["review_status"], "unreviewed")
            self.assertEqual(rows[0]["original_label"], "SAFE")


if __name__ == "__main__":
    unittest.main()
