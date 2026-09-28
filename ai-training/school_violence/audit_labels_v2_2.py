"""Create an AI-assisted label audit and human review queue for v2.2 JSONL.

This is NOT a human annotation step. Input CSVs are read-only and no row is
marked reviewed, relabeled, or silently moved between train/validation/test.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from school_violence.training import LABELS, load_sources
from text_safety.normalization import normalize_text


HELP_CUE = re.compile(r"\b(?:help|cứu|giúp|phải làm sao|xử lý sao)\b|🆘", re.IGNORECASE)
DEFINITION_CUE = re.compile(r"\blà gì\b", re.IGNORECASE)
THREAT_CUE = re.compile(r"(?:đe dọa|dọa đánh|đe đánh|đợi đấy|biết tay)", re.IGNORECASE)
EDUCATION_CUE = re.compile(
    r"(?:tình huống giả định|một ví dụ có câu|thảo luận cách phản ứng|"
    r"tài liệu dành cho|hội thoại mẫu|dùng như ví dụ|"
    r"hướng dẫn giữ bình tĩnh|một hoạt động dành cho|"
    r"bài học dành cho|phân tích ví dụ|nhận diện và phòng tránh)", re.IGNORECASE
)
PERSONAL_CUE = re.compile(r"\bem\b", re.IGNORECASE)
NEGATED_VIOLENCE_CUE = re.compile(
    r"em không bị bạn đánh|không ai dọa đánh em|không ai bắt nạt em|"
    r"không có ai bắt nạt em|không bị ai bắt nạt|bạn không đánh em", re.IGNORECASE
)
ACCIDENTAL_CONTEXT_CUE = re.compile(
    r"em bị ngã nhưng không có ai xô|bạn va vào em rồi xin lỗi|"
    r"bạn va phải em rồi xin lỗi", re.IGNORECASE
)
SPLITS = ("train", "validation", "test")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def audit(query: Path, webpage: Path) -> tuple[dict, list[dict]]:
    # Reuse trainer's combined integrity checks, but do not fit a model.
    _, source_audit = load_sources([query, webpage])
    queries, pages = read_csv(query), read_csv(webpage)
    by_id: dict[str, dict] = {}
    observations = Counter()
    issues = []

    def enqueue(row: dict, dataset: str, category: str, priority: int,
                question: str, observation: str) -> None:
        item = by_id.get(row["id"])
        if item is None:
            item = {
                "id": row["id"], "dataset": dataset, "text": row["text"],
                "current_label": row["label"], "group_id": row["group_id"],
                "split": row["split"], "review_status": row["review_status"],
                "priority": priority, "categories": [], "review_questions": [],
                "ai_observations_not_human_decisions": [],
            }
            by_id[row["id"]] = item
        item["priority"] = min(item["priority"], priority)
        if category not in item["categories"]:
            item["categories"].append(category)
        if question not in item["review_questions"]:
            item["review_questions"].append(question)
        if observation not in item["ai_observations_not_human_decisions"]:
            item["ai_observations_not_human_decisions"].append(observation)

    ambiguous = [row for row in queries if row.get("annotation_status") == "needs_human_context_review"]
    for row in ambiguous:
        text = row["text_normalized"]
        if DEFINITION_CUE.search(text):
            category, question = (
                "definition_or_explanation",
                "Đây chỉ là câu hỏi khái niệm chung, hay có ngữ cảnh người nói đang bị hại?",
            )
        elif HELP_CUE.search(row["text"]) or HELP_CUE.search(text):
            category, question = (
                "possible_personal_help_request",
                "Người tìm kiếm đang tự cầu cứu vì trải nghiệm của mình, hay tìm lời khuyên chung? Chỉ dùng HIGH_RISK khi ngữ cảnh xác nhận trải nghiệm/cầu cứu cá nhân.",
            )
        elif THREAT_CUE.search(text):
            category, question = (
                "threat_with_unknown_target",
                "Đe dọa thật nhắm vào người tìm kiếm hay chỉ là từ khóa/tin tức/hướng dẫn?",
            )
        else:
            category, question = (
                "short_ambiguous_fragment",
                "Văn bản có tự xác nhận nạn nhân hoặc đe dọa thật không? Nếu không, RISK là nhãn tạm theo thông tin hiện có.",
            )
        enqueue(row, "query", category, 1, question,
                "RISK hiện là nhãn tạm; không suy đoán trẻ là nạn nhân từ riêng truy vấn.")
        if "bị lấy đồ trên mạng" in text:
            enqueue(row, "query", "unnatural_or_underspecified_synthetic_context", 1,
                    "'Đồ' là vật thật, tài sản số hay câu sinh không tự nhiên? Cần xác minh trước khi giữ trong train/test.",
                    "Không tự đổi sang SAFE/HIGH_RISK hoặc tự viết lại câu.")
            issues.append({"id": row["id"], "issue": "underspecified_digital_vs_physical_property"})
    observations["ambiguous_query_rows"] = len(ambiguous)

    negations = [row for row in queries if row.get("query_type") == "negation_hard_negative"]
    for row in negations:
        canonical = row["text_normalized"]
        expected = "SAFE" if ACCIDENTAL_CONTEXT_CUE.search(canonical) else (
            "RISK" if NEGATED_VIOLENCE_CUE.search(canonical) else None
        )
        if expected is None or row["label"] != expected:
            observations["negation_policy_mismatches"] += 1
            enqueue(row, "query", "negation_policy_mismatch_or_unknown", 1,
                    "Đọc toàn bộ câu phủ định; phân biệt tai nạn vô ý với phủ định chủ đề bạo lực.",
                    "Nhãn hiện tại có thể không khớp hướng dẫn, cần người quyết định.")
        else:
            observations[f"negation_{expected}_consistent_template"] += 1
            enqueue(row, "query", "negation_context_check", 2,
                    "Xác nhận câu thực sự mô tả tai nạn vô ý, hay chỉ phủ định nguy cơ nhưng vẫn nhắc đến đánh/dọa/bắt nạt.",
                    f"Tự động đối chiếu mẫu câu cho kết quả {expected}; chưa phải duyệt bởi người.")
    observations["negation_query_rows"] = len(negations)

    # One independent example per page-label/quote-type/context/split stratum;
    # all page rows still undergo the structural consistency scan below.
    strata: dict[tuple[str, str, str, str], dict] = {}
    for row in pages:
        label, content = row["label"], row["content"]
        quoted = '"' in content
        metadata_quoted = row["contains_quote"] == "True"
        quote_type = row["quote_type"]
        expected_quote_type = (
            "none" if not quoted else "educational_or_news_quote" if label == "RISK"
            else "personal_threat_quote" if label == "HIGH_RISK" else "none"
        )
        if quoted != metadata_quoted or quote_type != expected_quote_type:
            observations["quote_metadata_mismatches"] += 1
            enqueue(row, "webpage", "quote_metadata_mismatch", 1,
                    "Kiểm tra câu trích dẫn và loại trích dẫn trong toàn bài.",
                    "Cột contains_quote/quote_type không khớp nội dung hoặc nhãn.")
        if label == "RISK" and quoted and not EDUCATION_CUE.search(content):
            observations["educational_quote_without_context_cue"] += 1
            enqueue(row, "webpage", "quoted_threat_without_educational_context", 1,
                    "Câu trích dẫn là ví dụ giáo dục/tin tức hay lời đe dọa thật?",
                    "Thiếu dấu hiệu ngữ cảnh giáo dục trong đoạn nội dung.")
        if label == "HIGH_RISK" and not PERSONAL_CUE.search(row["text"]):
            observations["high_risk_page_without_personal_cue"] += 1
            enqueue(row, "webpage", "high_risk_without_personal_context", 1,
                    "Có lời kể cá nhân hoặc đe dọa thật ngoài ngữ cảnh giáo dục không?",
                    "Không tìm thấy đại từ cá nhân 'em' trong toàn trang.")
        if label in ("RISK", "HIGH_RISK"):
            key = (label, row["contains_quote"], row["context_type"], row["split"])
            # Deterministic sampling independent of physical CSV row order.
            if key not in strata or row["id"] < strata[key]["id"]:
                strata[key] = row
        observations[f"page_{label}_{'quoted' if quoted else 'unquoted'}"] += 1

    for row in strata.values():
        label = row["label"]
        question = (
            "Trích dẫn chỉ là ví dụ/tin tức, không phải đe dọa đang nhắm vào người viết?"
            if label == "RISK" else
            "Có trải nghiệm/cầu cứu cá nhân hoặc đe dọa thật trong bối cảnh trang?"
        )
        enqueue(row, "webpage", "stratified_quote_context_sample", 3, question,
                "Mẫu đại diện để kiểm tra ngữ cảnh; không phải kiểm duyệt toàn bộ trang.")
    observations["page_quote_context_strata_sampled"] = len(strata)

    high_queries = [row for row in queries if row["label"] == "HIGH_RISK"]
    no_personal = [row for row in high_queries if not PERSONAL_CUE.search(row["text_normalized"])]
    for row in no_personal:
        enqueue(row, "query", "high_risk_without_personal_cue", 1,
                "Có đe dọa trực tiếp hoặc trải nghiệm cá nhân đủ rõ cho HIGH_RISK không?",
                "Thiếu đại từ 'em' trong bản chuẩn đối chiếu; cần đọc đầy đủ ngữ cảnh.")
    observations["high_risk_query_rows"] = len(high_queries)
    observations["high_risk_query_without_personal_cue"] = len(no_personal)

    # Extra small samples for direct personal risk versus generic discussion.
    for kind, match in (
        ("direct_personal_risk", lambda row: row["query_type"] == "direct_personal_risk" and THREAT_CUE.search(row["text_normalized"])),
        ("very_short_direct_risk", lambda row: row["query_type"] == "very_short_direct_risk"),
        ("prevention_or_information", lambda row: row["query_type"] == "prevention_or_information" and THREAT_CUE.search(row["text_normalized"])),
    ):
        for split in SPLITS:
            matches = [row for row in queries if row["split"] == split and match(row)]
            if matches:
                row = min(matches, key=lambda item: item["id"])
                enqueue(row, "query", "stratified_help_or_threat_sample", 3,
                        "Dựa trên toàn bộ câu, đây là hỗ trợ chung, cầu cứu cá nhân hay đe dọa thật?",
                        f"Mẫu đại diện của nhóm {kind}; chưa phải duyệt bởi người.")
                observations["query_help_threat_strata_sampled"] += 1

    normalized_short = defaultdict(list)
    for row in ambiguous:
        normalized_short[normalize_text(row["text"]).folded].append(row)
    for members in normalized_short.values():
        if len(members) > 1:
            observations["ambiguous_same_runtime_text_groups"] += 1
            for row in members:
                enqueue(row, "query", "equivalent_short_variants", 2,
                        "Các biến thể chuẩn hóa giống nhau đã được giữ cùng nhóm/tập chưa?",
                        "Không tính biến thể tương đương thành nhiều bằng chứng độc lập.")

    queue = sorted(by_id.values(), key=lambda item: (item["priority"], item["dataset"], item["id"]))
    metadata = {
        "audit_type": "ai_assisted_pre_review_not_human_annotation",
        "policy": "ai-training/school_violence/ANNOTATION_GUIDE.md",
        "source_files": [{"name": query.name, "sha256": sha256(query), "rows": len(queries)},
                         {"name": webpage.name, "sha256": sha256(webpage), "rows": len(pages)}],
        "source_rows": len(queries) + len(pages),
        "source_review_status": dict(Counter(row["review_status"] for row in queries + pages)),
        "human_review_decisions_applied": 0,
        "changed_labels": 0,
        "queue_rows": len(queue),
        "queue_by_priority": dict(Counter(item["priority"] for item in queue)),
        "queue_by_category": dict(Counter(category for item in queue for category in item["categories"])),
        "observations": dict(observations),
        "issues_needing_human_judgment": issues,
        "combined_integrity": {
            "rows": source_audit["source_rows"],
            "removed_exact_duplicates": source_audit["removed_duplicate_rows"],
            "cross_split_keys": {name: check["cross_split_keys"]
                                 for name, check in source_audit["leakage_checks"].items()},
        },
        "limitations": [
            "Patterns and selected examples are not exhaustive semantic review.",
            "Queue entries are questions, not human decisions or approved labels.",
            "No source CSV, label or review_status was changed by this audit.",
        ],
    }
    if len(ambiguous) != 100 or len(negations) != 393 or len(queries) != 6000 or len(pages) != 5986:
        raise ValueError("Unexpected v2.2 corpus or priority cohort; verify inputs manually")
    if any(item["review_status"] == "reviewed" for item in queue):
        raise ValueError("Audit queue unexpectedly includes an already-reviewed row")
    return metadata, queue


def main() -> None:
    base = Path(__file__).resolve().parents[2] / "Mô tả"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", type=Path, default=base / "laptopmonitoring_query_dataset_v2_2.csv")
    parser.add_argument("--webpage", type=Path, default=base / "laptopmonitoring_webpage_dataset_v2_2.csv")
    parser.add_argument("--output-dir", type=Path, default=base / "label_review_v2_2")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    report, queue = audit(args.query, args.webpage)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.validate_only:
        return
    report_path = args.output_dir / "audit_report.json"
    queue_path = args.output_dir / "review_queue.jsonl"
    if report_path.exists() or queue_path.exists():
        raise FileExistsError("Audit output exists; preserve it or choose a new directory")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with queue_path.open("x", encoding="utf-8", newline="\n") as handle:
        for item in queue:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
