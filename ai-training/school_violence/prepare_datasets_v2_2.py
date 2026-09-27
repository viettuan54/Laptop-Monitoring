"""Repair the two v2.1 synthetic CSVs without changing source files or training.

This is automated policy alignment, NOT completed human annotation. Runtime
normalization and semantic grouping are separate from the canonical QA text.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from text_safety.normalization import normalize_text


LABELS = ("SAFE", "RISK", "HIGH_RISK")
SPLITS = ("train", "validation", "test")
RATIOS = (.7, .15, .15)
SEED = "school-violence-dataset-v2.2"
EXTRA_COLUMNS = (
    "original_label", "original_group_id", "original_split", "original_text",
    "text_runtime_normalized", "correction_reason", "annotation_status",
)
NEGATION_TOPIC = re.compile(
    r"em không bị bạn đánh|không ai dọa đánh em|không ai bắt nạt em|"
    r"không có ai bắt nạt em|không bị ai bắt nạt|bạn không đánh em"
)
QUOTE = re.compile(r'"[^"\n]+"')
GRAMMAR_RULES = (
    (r"\bvề về\b", "về"), (r"\bve ve\b", "ve"),
    (r"\bdấu hiệu của về\b", "dấu hiệu của"),
    (r"\bdau hieu cua ve\b", "dau hieu cua"),
    (r"\bcách dấu hiệu của\b", "dấu hiệu của"),
    (r"\bcach dau hieu cua\b", "dau hieu cua"),
    (r"\bcách quy định về\b", "quy định về"),
    (r"\bcach quy dinh ve\b", "quy dinh ve"),
    (r"\bcách tìm hiểu\b", "tìm hiểu"),
    (r"\bcach tim hieu\b", "tim hieu"),
    (r"\bxử lý về\b", "cách xử lý"),
    (r"\bxu ly ve\b", "cach xu ly"),
    (r"\b(trên mạng|trong lớp|ở trường|tan học|tren mang|trong lop|o truong|tan hoc) \1\b", r"\1"),
)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def clean(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip()


def exact_key(value: str) -> str:
    return re.sub(r"\s+", " ", clean(value).casefold())


def repair_query(row: dict) -> list[str]:
    reasons = []
    canonical = clean(row["text_normalized"])
    raw = clean(row["text"])
    if row["query_type"] == "negation_hard_negative" and NEGATION_TOPIC.search(canonical):
        if row["label"] != "RISK":
            row["label"] = "RISK"
            reasons.append("negated_school_violence_topic_is_RISK_per_annotation_guide")
    # Only this unambiguous phrase is repaired; standalone hok retains its
    # possible meaning 'không'. Preserve accents/no-accents and other evasions.
    repaired = re.sub(r"\bhok(?=\s+sinh\b)", "hoc", raw, flags=re.IGNORECASE)
    if repaired != raw:
        reasons.append("hok_sinh_means_hoc_sinh_not_khong_sinh")
    raw = repaired
    if row["query_type"] in ("prevention_or_information", "very_short_or_ambiguous"):
        before = (raw, canonical)
        for pattern, replacement in GRAMMAR_RULES:
            raw = re.sub(pattern, replacement, raw)
            canonical = re.sub(pattern, replacement, canonical)
        if (raw, canonical) != before:
            reasons.append("repair_synthetic_grammar_and_adjacent_phrase_repetition")
    # Physical pushing cannot happen on the internet. This is a known malformed
    # generated sample, not a rule for relabeling arbitrary online reports.
    if row["id"] == "Q_003401" and canonical == "bị xô đẩy trên mạng":
        raw, canonical = "bi xo day o san truong", "bị xô đẩy ở sân trường"
        reasons.append("replace_impossible_physical_pushing_online_context")
    row["text"] = row["text_raw"] = raw
    row["text_normalized"] = canonical
    ambiguous = row["query_type"] == "very_short_or_ambiguous"
    if ambiguous:
        row["annotation_status"] = "needs_human_context_review"
        reasons.append("short_query_intent_not_inferred_without_explicit_personal_context")
    return reasons


def repair_page(row: dict) -> list[str]:
    reasons = []
    row["title"], row["content"] = clean(row["title"]), clean(row["content"])
    # A deterministic subset gets synthetic paraphrases of the same threats,
    # rather than making a literal quote a universal feature of RISK/HIGH_RISK.
    # Apply to all members of the original group, not randomly per sentence.
    selected = int(digest(SEED + row["original_group_id"]), 16) % 4 == 0
    if selected and row["label"] != "SAFE":
        before = row["content"]
        value = before
        if row["label"] == "RISK":
            value = re.sub(
                r'Một ví dụ có câu "[^"\n]+" để mọi người thảo luận cách phản ứng an toàn\.',
                "Các thành viên thảo luận cách nhận biết hành vi này và phản ứng an toàn.", value,
            )
            value = re.sub(
                r'đưa ra tình huống giả định "[^"\n]+"',
                "đưa ra tình huống giả định một học sinh bị đe dọa", value,
            )
        else:
            value = re.sub(
                r'và có lần còn nói "[^"\n]+"',
                "và có lần còn đe dọa em", value,
            )
            value = re.sub(
                r'Họ còn nói "[^"\n]+"\.',
                "Họ còn đe dọa sẽ gây hại cho em.", value,
            )
        if value != before:
            row["content"] = value
            reasons.append("synthetic_indirect_threat_paraphrase_without_literal_quote")
    quoted = bool(QUOTE.search(row["content"]))
    row["contains_quote"] = "True" if quoted else "False"
    row["quote_type"] = (
        "none" if not quoted else
        "educational_or_news_quote" if row["label"] == "RISK" else
        "personal_threat_quote" if row["label"] == "HIGH_RISK" else "none"
    )
    row["text"] = row["title"] + "\n" + row["content"]
    return reasons


def group_rows(rows: list[dict], kind: str) -> None:
    """Connected components: original paraphrases, canonical/runtime duplicates,
    and identical page bodies (before AND after repair) must stay together.
    Labels are not used for grouping, so legitimate mixed-label context pairs
    cannot leak across splits.
    """
    parents = list(range(len(rows)))

    def find(i: int) -> int:
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    seen = {}
    for i, row in enumerate(rows):
        keys = [("source_group", row["original_group_id"]),
                ("runtime", normalize_text(row["text"]).folded)]
        if kind == "query":
            keys.append(("canonical", normalize_text(row["text_normalized"]).folded))
        else:
            keys.extend((name, normalize_text(value).folded) for name, value in (
                ("body", row["content"]), ("original_body", row.pop("_original_content")),
                ("page", row["page_id"]),
            ))
        for key in keys:
            if not key[1]:
                raise ValueError("Empty grouping key")
            if key in seen:
                parents[find(i)] = find(seen[key])
            else:
                seen[key] = i
    components = defaultdict(list)
    for i, row in enumerate(rows):
        components[find(i)].append(row)
    for members in components.values():
        group = "V22_" + kind.upper() + "_" + digest("|".join(sorted(r["id"] for r in members)))[:16]
        for row in members:
            row["group_id"] = group


def assign_splits(rows: list[dict]) -> None:
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["group_id"]].append(row)
    totals = Counter(r["label"] for r in rows)
    assigned = {name: Counter() for name in SPLITS}
    # Put large components first; the seeded hash breaks ties reproducibly.
    groups = sorted(grouped.items(), key=lambda item: (-len(item[1]), digest(SEED + item[0])))
    for group, members in groups:
        counts = Counter(row["label"] for row in members)
        def cost(split_index: int) -> float:
            return sum(
                ((assigned[name][label] + (counts[label] if i == split_index else 0)
                  - RATIOS[i] * totals[label]) ** 2) / max(1, totals[label])
                for i, name in enumerate(SPLITS) for label in LABELS
            )
        chosen = min(range(len(SPLITS)), key=lambda i: (cost(i), i))
        name = SPLITS[chosen]
        assigned[name].update(counts)
        for row in members:
            row["split"] = name


def validate(rows: list[dict], kind: str) -> dict:
    if not rows or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Empty rows or duplicate IDs")
    keys = defaultdict(set)
    labels_by_runtime = defaultdict(set)
    for row in rows:
        if row["label"] not in LABELS or row["split"] not in SPLITS or not row["text"].strip():
            raise ValueError(f"Invalid row {row['id']}")
        if row["source"] != "synthetic" or row["review_status"] != "unreviewed":
            raise ValueError("Do not invent provenance or completed human review")
        runtime = normalize_text(row["text"])
        if row["text_runtime_normalized"] != runtime.unicode:
            raise ValueError("Runtime normalization metadata mismatch")
        labels_by_runtime[runtime.folded].add(row["label"])
        for name, value in (("group", row["group_id"]), ("runtime", runtime.folded),
                            ("exact", exact_key(row["text"]))):
            keys[(name, value)].add(row["split"])
        if kind == "query":
            if row["text_raw"] != row["text"] or re.search(r"\bhok sinh\b", row["text"], re.I):
                raise ValueError("Raw query mismatch or ambiguous hok sinh remains")
            keys[("canonical", normalize_text(row["text_normalized"]).folded)].add(row["split"])
        else:
            if row["text"] != row["title"] + "\n" + row["content"]:
                raise ValueError("Page context is incomplete")
            keys[("body", normalize_text(row["content"]).folded)].add(row["split"])
            keys[("page", row["page_id"])].add(row["split"])
            if (row["contains_quote"] == "True") != bool(QUOTE.search(row["content"])):
                raise ValueError("Quote metadata mismatch")
    leaks = Counter(name for (name, _), splits in keys.items() if len(splits) > 1)
    if leaks or any(len(labels) > 1 for labels in labels_by_runtime.values()):
        raise ValueError(f"Split leakage or conflicting normalized labels: {dict(leaks)}")
    if len({exact_key(r["text"]) for r in rows}) != len(rows):
        raise ValueError("Exact duplicates must be deduplicated")
    return {
        "rows": len(rows), "labels": dict(Counter(r["label"] for r in rows)),
        "split_labels": {s: dict(Counter(r["label"] for r in rows if r["split"] == s)) for s in SPLITS},
        "group_count": len({r["group_id"] for r in rows}),
        "cross_split_group_exact_runtime_canonical_body_page_keys": dict(leaks),
        "review_status": dict(Counter(r["review_status"] for r in rows)),
        "annotation_status": dict(Counter(r["annotation_status"] for r in rows)),
        "quote_by_label": {label: dict(Counter(r.get("contains_quote", "not_applicable") for r in rows if r["label"] == label)) for label in LABELS},
        "text_length": {"min": min(len(r["text"]) for r in rows), "max": max(len(r["text"]) for r in rows)},
    }


def prepare(source: Path, output: Path, kind: str) -> dict:
    source_bytes = source.read_bytes()
    reader = csv.DictReader(io.StringIO(source_bytes.decode("utf-8-sig"), newline=""))
    columns = list(reader.fieldnames or [])
    rows = list(reader)
    changes = []
    for row in rows:
        row.update(original_label=row["label"], original_group_id=row["group_id"],
                   original_split=row["split"], original_text=row["text"],
                   annotation_status="automated_policy_alignment_unreviewed")
        if kind == "webpage":
            row["_original_content"] = row["content"]
        reasons = repair_query(row) if kind == "query" else repair_page(row)
        row["dataset_version"] = "v2.2"
        row["review_status"] = "unreviewed"
        row["evaluation_status"] = "provisional_unreviewed"
        row["text_runtime_normalized"] = normalize_text(row["text"]).unicode
        row["correction_reason"] = ";".join(reasons)
        row["notes"] = (
            "Synthetic experimental data, not human-reviewed. Train from text with runtime preprocessing. "
            "Respect group_id AND split; legacy trainer ignores both. QA metadata must not be model features."
        )
        if reasons:
            changes.append({"id": row["id"], "original_label": row["original_label"],
                            "label": row["label"], "text_changed": row["original_text"] != row["text"],
                            "reasons": reasons})
    group_rows(rows, kind)
    # Never introduce arbitrary suffixes merely to retain 6000 unique examples.
    deduplicated = {}
    removed = []
    for row in rows:
        key = exact_key(row["text"])
        if key in deduplicated:
            if deduplicated[key]["label"] != row["label"]:
                raise ValueError("Conflicting labels after repair")
            removed.append({"id": row["id"], "retained_id": deduplicated[key]["id"]})
        else:
            deduplicated[key] = row
    rows = list(deduplicated.values())
    assign_splits(rows)
    audit = validate(rows, kind)
    output_bytes = io.StringIO(newline="")
    writer = csv.DictWriter(output_bytes, fieldnames=columns + list(EXTRA_COLUMNS), lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    encoded = output_bytes.getvalue().encode("utf-8-sig")
    # Never silently overwrite an existing user-edited v2.2 file.
    if output.exists() and output.read_bytes() != encoded:
        raise FileExistsError(f"Existing output differs; preserve it: {output}")
    if not output.exists():
        output.write_bytes(encoded)
    if source.read_bytes() != source_bytes:
        raise AssertionError("Source file changed")
    return {
        "source": source.name, "output": output.name,
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "output_sha256": hashlib.sha256(encoded).hexdigest(),
        "label_changes": sum(c["original_label"] != c["label"] for c in changes),
        "text_changes": sum(c["text_changed"] for c in changes),
        "reason_counts": dict(Counter(reason for c in changes for reason in c["reasons"])),
        "removed_exact_duplicates": removed, "audit": audit, "changes": changes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[2] / "Mô tả")
    args = parser.parse_args()
    report_path = args.directory / "dataset_v2_2_corrections.json"
    if report_path.exists():
        raise FileExistsError("Correction report already exists; preserve prior outputs")
    for kind in ("query", "webpage"):
        target = args.directory / f"laptopmonitoring_{kind}_dataset_v2_2.csv"
        if target.exists():
            raise FileExistsError(f"Output already exists: {target}")
    results = [prepare(
        args.directory / f"laptopmonitoring_{kind}_dataset_v2_1_6000.csv",
        args.directory / f"laptopmonitoring_{kind}_dataset_v2_2.csv", kind,
    ) for kind in ("query", "webpage")]
    report = {
        "dataset_version": "v2.2", "human_review_complete": False,
        "deployment_eligible": False, "training_performed": False,
        "policy": "school_violence/ANNOTATION_GUIDE.md",
        "split_strategy": "seeded_label_distribution_connected_components_70_15_15",
        "seed": SEED, "datasets": results,
        "limitations": [
            "Synthetic only; no independent real-world evaluation.",
            "All rows require human review; short ambiguous queries explicitly flagged.",
            "Web pages are still short synthetic contextual samples, not real long pages.",
            "Legacy school_violence.training ignores group_id and CSV split; must be updated before training these files.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{k: v for k, v in r.items() if k != "changes"} for r in results], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
