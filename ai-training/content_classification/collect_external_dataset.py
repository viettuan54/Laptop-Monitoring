"""Collect, clean, label, and audit external app/domain training data.

Only deterministic mappings from explicitly approved sources are accepted.
Ambiguous, invalid, and conflicting rows are written to a review queue; this
collector never asks Gemini or the trained classifier to create training labels.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import ipaddress
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parent
TRAINING_ROOT = MODULE_ROOT.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.validate_dataset import (
    DATASET_SPECS,
    DatasetContractError,
    build_validation_report,
    load_taxonomy,
    normalize_app_name,
    normalize_domain,
    validate_csv_dataset,
)


DEFAULT_CONFIG_PATH = MODULE_ROOT / "external_sources.json"
DEFAULT_OUTPUT_DIR = TRAINING_ROOT / "datasets" / "content"
SOURCE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
SUPPORTED_SOURCE_KINDS = {"reviewed_json", "wikidata_sparql", "json_domain_list"}
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
REVIEW_HEADERS = (
    "resource_type",
    "key",
    "display_name",
    "candidate_labels",
    "reason",
    "source_ids",
    "source_urls",
)


class CollectionError(RuntimeError):
    """Raised when collection cannot safely continue."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_bytes_atomic(path: Path, payload: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _write_json_atomic(path: Path, payload):
    _write_bytes_atomic(
        path,
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )


def _write_csv_atomic(path: Path, headers: tuple[str, ...], rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise CollectionError(f"Missing JSON file: {path}") from error
    except json.JSONDecodeError as error:
        raise CollectionError(
            f"Invalid JSON {path}: line {error.lineno}: {error.msg}"
        ) from error


def load_source_config(path: Path | str = DEFAULT_CONFIG_PATH) -> dict:
    config_path = Path(path).resolve()
    config = _load_json(config_path)
    if config.get("config_version") != "1.0.0":
        raise CollectionError("Source config_version must be 1.0.0")
    if not isinstance(config.get("user_agent"), str) or not config["user_agent"].strip():
        raise CollectionError("Source config requires a non-empty user_agent")
    allowed_licenses = config.get("allowed_licenses")
    if not isinstance(allowed_licenses, list) or not allowed_licenses:
        raise CollectionError("Source config requires allowed_licenses")
    sources = config.get("sources")
    if not isinstance(sources, list) or not sources:
        raise CollectionError("Source config requires at least one source")

    seen_ids = set()
    for source in sources:
        if not isinstance(source, dict):
            raise CollectionError("Each source must be a JSON object")
        source_id = source.get("id")
        if not isinstance(source_id, str) or not SOURCE_ID_RE.fullmatch(source_id):
            raise CollectionError(f"Invalid source id: {source_id!r}")
        if source_id in seen_ids:
            raise CollectionError(f"Duplicate source id: {source_id}")
        seen_ids.add(source_id)
        if source.get("kind") not in SUPPORTED_SOURCE_KINDS:
            raise CollectionError(f"Unsupported kind for {source_id}: {source.get('kind')}")
        if source.get("license") not in allowed_licenses:
            raise CollectionError(
                f"Source {source_id} license is absent from allowed_licenses"
            )
        if not source.get("license_url"):
            raise CollectionError(f"Source {source_id} requires license_url")
        if source.get("allow_for_training") is not True:
            raise CollectionError(f"Source {source_id} is not approved for training")
        if not source.get("label_method"):
            raise CollectionError(f"Source {source_id} requires label_method")
    config["_path"] = config_path
    return config


def _default_fetch(url: str, headers: dict[str, str]) -> bytes:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_DOWNLOAD_BYTES:
            raise CollectionError(
                f"Download exceeds {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB: {url}"
            )
        payload = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(payload) > MAX_DOWNLOAD_BYTES:
        raise CollectionError(
            f"Download exceeds {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB: {url}"
        )
    return payload


def _sanitize_text(value, max_length: int) -> str:
    raw = "".join(
        " " if ord(character) < 32 or ord(character) == 127 else character
        for character in str(value or "")
    )
    text = " ".join(raw.split())
    return text[:max_length]


def domain_from_external_value(value: str) -> str:
    """Extract and canonicalize a domain from either a URL or host value."""
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("domain cannot be empty")
    parsed = urllib.parse.urlsplit(raw if "://" in raw else f"//{raw}")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("value does not contain a hostname")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError("IP addresses are not accepted as website domains")
    return normalize_domain(hostname)


def _wikidata_query(source: dict, limit: int) -> str:
    class_ids = source.get("class_ids") or [source.get("class_id", "")]
    if not isinstance(class_ids, list) or not class_ids or any(
        not re.fullmatch(r"Q[1-9][0-9]*", class_id) for class_id in class_ids
    ):
        raise CollectionError(f"Invalid Wikidata class_id/class_ids in {source['id']}")
    values = " ".join(f"wd:{class_id}" for class_id in class_ids)
    return f"""SELECT DISTINCT ?item ?itemLabel ?website WHERE {{
  VALUES ?class {{ {values} }}
  ?item wdt:P31 ?class;
        wdt:P856 ?website.
  FILTER(STRSTARTS(STR(?website), \"http\"))
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language \"vi,en\". }}
}}
LIMIT {limit}"""


def _select_deterministic(records: list[dict], source_id: str, limit: int) -> list[dict]:
    if limit <= 0 or len(records) <= limit:
        return records

    def rank(record):
        raw_key = record.get("raw_key", "")
        return hashlib.sha256(f"{source_id}\0{raw_key}".encode("utf-8")).digest()

    return sorted(records, key=rank)[:limit]


def _candidate(source: dict, raw_key, display_name, *, source_url=None) -> dict:
    return {
        "resource_type": source.get("resource_type"),
        "raw_key": str(raw_key or ""),
        "display_name": str(display_name or ""),
        "label": source.get("label"),
        "source_id": source["id"],
        "source_url": source_url or source.get("url") or source.get("endpoint") or "",
        "license": source["license"],
        "label_method": source["label_method"],
    }


def _collect_reviewed_json(source: dict, config_path: Path) -> tuple[list[dict], bytes]:
    relative_path = source.get("path")
    if not relative_path:
        raise CollectionError(f"Source {source['id']} requires path")
    path = (config_path.parent / relative_path).resolve()
    try:
        path.relative_to(config_path.parent.resolve())
    except ValueError as error:
        raise CollectionError(f"Source path escapes config directory: {relative_path}") from error
    payload = path.read_bytes()
    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise CollectionError(f"Invalid reviewed JSON source: {path}") from error
    if not isinstance(data, dict) or not str(data.get("catalog_version", "")).strip():
        raise CollectionError(
            f"Source {source['id']} requires a non-empty catalog_version"
        )
    records = data.get("records")
    if not isinstance(records, list):
        raise CollectionError(f"Source {source['id']} requires a records array")
    candidates = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise CollectionError(f"Invalid record in {source['id']}")
        identifier = record.get("app_name") or record.get("domain")
        display_name = record.get("display_name") or record.get("title")
        evidence_url = str(record.get("evidence_url", "")).strip()
        label_basis = str(record.get("label_basis", "")).strip()
        parsed_evidence = urllib.parse.urlsplit(evidence_url)
        missing = [
            field
            for field, value in (
                ("app_name/domain", identifier),
                ("display_name/title", display_name),
                ("label", record.get("label")),
                ("evidence_url", evidence_url),
                ("label_basis", label_basis),
            )
            if not str(value or "").strip()
        ]
        if missing:
            raise CollectionError(
                f"Record {index} in {source['id']} is missing: {', '.join(missing)}"
            )
        if (
            parsed_evidence.scheme != "https"
            or not parsed_evidence.hostname
            or parsed_evidence.username
            or parsed_evidence.password
        ):
            raise CollectionError(
                f"Record {index} in {source['id']} requires a safe HTTPS evidence_url"
            )
        derived_source = dict(source)
        derived_source["resource_type"] = record.get("resource_type", "apps")
        derived_source["label"] = record.get("label")
        candidates.append(
            _candidate(
                derived_source,
                identifier,
                display_name,
                source_url=evidence_url,
            )
        )
    return candidates, payload


def _download_with_cache(
    source: dict,
    url: str,
    cache_path: Path,
    *,
    user_agent: str,
    offline: bool,
    fetch,
) -> tuple[bytes, str, str | None, str]:
    """Return payload, acquisition mode, warning, and source retrieval time."""
    if offline:
        if not cache_path.is_file():
            raise CollectionError(f"Offline cache is missing for {source['id']}")
        retrieved_at = datetime.fromtimestamp(
            cache_path.stat().st_mtime, tz=timezone.utc
        ).replace(microsecond=0).isoformat()
        return cache_path.read_bytes(), "cache", None, retrieved_at
    try:
        payload = fetch(
            url,
            {
                "Accept": "application/sparql-results+json, application/json",
                "User-Agent": user_agent,
            },
        )
        _write_bytes_atomic(cache_path, payload)
        return payload, "network", None, _now_iso()
    except Exception as error:  # Network libraries expose several error families.
        if cache_path.is_file():
            retrieved_at = datetime.fromtimestamp(
                cache_path.stat().st_mtime, tz=timezone.utc
            ).replace(microsecond=0).isoformat()
            return (
                cache_path.read_bytes(),
                "cache_fallback",
                f"{source['id']}: network failed; used cache ({error})",
                retrieved_at,
            )
        raise CollectionError(f"Could not fetch {source['id']}: {error}") from error


def _collect_wikidata(
    source: dict,
    cache_path: Path,
    *,
    user_agent: str,
    offline: bool,
    fetch,
    max_records: int,
) -> tuple[list[dict], bytes, str, str | None, str]:
    multiplier = int(source.get("fetch_multiplier", 4))
    query = _wikidata_query(source, max(max_records * multiplier, max_records))
    url = source["endpoint"] + "?" + urllib.parse.urlencode(
        {"query": query, "format": "json"}
    )
    payload, mode, warning, retrieved_at = _download_with_cache(
        source,
        url,
        cache_path,
        user_agent=user_agent,
        offline=offline,
        fetch=fetch,
    )
    try:
        data = json.loads(payload.decode("utf-8"))
        bindings = data["results"]["bindings"]
    except (UnicodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise CollectionError(f"Invalid Wikidata response for {source['id']}") from error
    candidates = []
    for binding in bindings:
        website = binding.get("website", {}).get("value")
        item_url = binding.get("item", {}).get("value")
        title = binding.get("itemLabel", {}).get("value") or source.get("class_name")
        if website:
            candidates.append(
                _candidate(source, website, title, source_url=item_url or source["endpoint"])
            )
    return (
        _select_deterministic(candidates, source["id"], max_records),
        payload,
        mode,
        warning,
        retrieved_at,
    )


def _collect_json_domain_list(
    source: dict,
    cache_path: Path,
    *,
    user_agent: str,
    offline: bool,
    fetch,
    max_records: int,
) -> tuple[list[dict], bytes, str, str | None, str]:
    payload, mode, warning, retrieved_at = _download_with_cache(
        source,
        source["url"],
        cache_path,
        user_agent=user_agent,
        offline=offline,
        fetch=fetch,
    )
    try:
        values = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise CollectionError(f"Invalid JSON feed for {source['id']}") from error
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise CollectionError(f"Source {source['id']} must return a JSON string array")
    candidates = [
        _candidate(source, value, source.get("title", source["id"])) for value in values
    ]
    return (
        _select_deterministic(candidates, source["id"], max_records),
        payload,
        mode,
        warning,
        retrieved_at,
    )


def collect_candidates(
    config: dict,
    cache_dir: Path,
    *,
    offline: bool = False,
    max_per_source: int | None = None,
    fetch=None,
) -> tuple[list[dict], list[dict], list[str]]:
    fetch = fetch or _default_fetch
    candidates = []
    source_runs = []
    warnings = []
    cache_dir.mkdir(parents=True, exist_ok=True)
    for source in config["sources"]:
        configured_max = int(source.get("max_records", 0))
        limit = max_per_source if max_per_source is not None else configured_max
        if limit < 1 and source["kind"] != "reviewed_json":
            raise CollectionError(f"Source {source['id']} max_records must be positive")
        cache_path = cache_dir / f"{source['id']}.raw"
        if source["kind"] == "reviewed_json":
            rows, payload = _collect_reviewed_json(source, config["_path"])
            mode, warning = "local_reviewed", None
            retrieved_at = _now_iso()
        elif source["kind"] == "wikidata_sparql":
            rows, payload, mode, warning, retrieved_at = _collect_wikidata(
                source,
                cache_path,
                user_agent=config["user_agent"],
                offline=offline,
                fetch=fetch,
                max_records=limit,
            )
        else:
            rows, payload, mode, warning, retrieved_at = _collect_json_domain_list(
                source,
                cache_path,
                user_agent=config["user_agent"],
                offline=offline,
                fetch=fetch,
                max_records=limit,
            )
        candidates.extend(rows)
        if warning:
            warnings.append(warning)
        source_runs.append(
            {
                "source_id": source["id"],
                "kind": source["kind"],
                "license": source["license"],
                "license_url": source["license_url"],
                "label_method": source["label_method"],
                "acquisition_mode": mode,
                "retrieved_at": retrieved_at,
                "raw_sha256": _sha256_bytes(payload),
                "selected_candidate_count": len(rows),
            }
        )
    return candidates, source_runs, warnings


def _review_row(candidate: dict, reason: str, *, labels=None, sources=None) -> dict:
    sources = sources or [candidate]
    return {
        "resource_type": candidate.get("resource_type", ""),
        "key": _sanitize_text(candidate.get("raw_key"), 500),
        "display_name": _sanitize_text(candidate.get("display_name"), 500),
        "candidate_labels": "|".join(sorted(labels or {candidate.get("label", "")})),
        "reason": reason,
        "source_ids": "|".join(sorted({item.get("source_id", "") for item in sources})),
        "source_urls": "|".join(
            sorted({item.get("source_url", "") for item in sources if item.get("source_url")})
        ),
        "_candidate_count": len(sources),
    }


def clean_and_label_candidates(candidates: list[dict], taxonomy: dict):
    """Normalize candidates and quarantine invalid or conflicting groups."""
    grouped = defaultdict(list)
    review = []
    allowed = {
        "apps": set(taxonomy["resources"]["app"]["labels"]),
        "websites": set(taxonomy["resources"]["web"]["labels"]),
    }
    for candidate in candidates:
        resource_type = candidate.get("resource_type")
        if resource_type not in allowed:
            review.append(_review_row(candidate, "invalid_resource_type"))
            continue
        if candidate.get("label") not in allowed[resource_type]:
            review.append(_review_row(candidate, "label_outside_taxonomy"))
            continue
        try:
            if resource_type == "apps":
                key = normalize_app_name(candidate.get("raw_key", ""))
                display_name = _sanitize_text(candidate.get("display_name"), 150)
            else:
                key = domain_from_external_value(candidate.get("raw_key", ""))
                display_name = _sanitize_text(candidate.get("display_name"), 500)
        except (TypeError, ValueError) as error:
            review.append(_review_row(candidate, f"invalid_identifier: {error}"))
            continue
        normalized = dict(candidate, key=key, display_name=display_name)
        grouped[(resource_type, key)].append(normalized)

    accepted = {"apps": [], "websites": []}
    provenance = []
    for (resource_type, key), group in sorted(grouped.items()):
        labels = {item["label"] for item in group}
        if len(labels) != 1:
            review.append(
                _review_row(
                    group[0],
                    "conflicting_labels",
                    labels=labels,
                    sources=group,
                )
            )
            continue
        label = next(iter(labels))
        display_name = max(
            (item["display_name"] for item in group), key=lambda value: (len(value), value)
        )
        if resource_type == "apps":
            accepted[resource_type].append(
                {"app_name": key, "display_name": display_name, "label": label}
            )
        else:
            accepted[resource_type].append(
                {"domain": key, "title": display_name, "label": label}
            )
        provenance.append(
            {
                "resource_type": resource_type,
                "key": key,
                "label": label,
                "source_ids": sorted({item["source_id"] for item in group}),
                "source_urls": sorted(
                    {item["source_url"] for item in group if item.get("source_url")}
                ),
                "licenses": sorted({item["license"] for item in group}),
                "label_methods": sorted({item["label_method"] for item in group}),
                "candidate_count": len(group),
            }
        )
    for resource_type in accepted:
        key_field = DATASET_SPECS[resource_type]["key_field"]
        accepted[resource_type].sort(key=lambda row: row[key_field])
    review.sort(key=lambda row: (row["resource_type"], row["key"], row["reason"]))
    return accepted, provenance, review


def _write_jsonl_atomic(path: Path, rows: list[dict]):
    payload = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
    ).encode("utf-8")
    _write_bytes_atomic(path, payload)


def run_collection(
    *,
    config_path: Path | str = DEFAULT_CONFIG_PATH,
    output_dir: Path | str = DEFAULT_OUTPUT_DIR,
    offline: bool = False,
    max_per_source: int | None = None,
    minimum_samples_per_label: int = 1,
    fetch=None,
) -> dict:
    started_at = _now_iso()
    output_dir = Path(output_dir).resolve()
    config = load_source_config(config_path)
    taxonomy = load_taxonomy()
    cache_dir = output_dir / "raw-cache"
    candidates, source_runs, warnings = collect_candidates(
        config,
        cache_dir,
        offline=offline,
        max_per_source=max_per_source,
        fetch=fetch,
    )
    accepted, provenance, review = clean_and_label_candidates(candidates, taxonomy)

    apps_path = output_dir / "apps.csv"
    websites_path = output_dir / "websites.csv"
    _write_csv_atomic(apps_path, DATASET_SPECS["apps"]["headers"], accepted["apps"])
    _write_csv_atomic(
        websites_path,
        DATASET_SPECS["websites"]["headers"],
        accepted["websites"],
    )
    _write_csv_atomic(output_dir / "review_queue.csv", REVIEW_HEADERS, review)
    _write_jsonl_atomic(output_dir / "record_provenance.jsonl", provenance)

    dataset_reports = [
        validate_csv_dataset(
            "apps",
            apps_path,
            minimum_samples_per_label=minimum_samples_per_label,
        ),
        validate_csv_dataset(
            "websites",
            websites_path,
            minimum_samples_per_label=minimum_samples_per_label,
        ),
    ]
    validation = build_validation_report(dataset_reports, taxonomy)
    label_counts = {
        resource: dict(Counter(row["label"] for row in rows))
        for resource, rows in accepted.items()
    }
    quarantined_candidate_count = sum(
        row.get("_candidate_count", 1) for row in review
    )
    merged_duplicate_candidate_count = sum(
        max(0, row.get("candidate_count", 1) - 1) for row in provenance
    )
    report = {
        "report_version": "1.0.0",
        "started_at": started_at,
        "completed_at": _now_iso(),
        "config_file": str(config["_path"]),
        "config_sha256": _sha256_file(config["_path"]),
        "taxonomy_version": taxonomy["taxonomy_version"],
        "offline": offline,
        "source_runs": source_runs,
        "candidate_count": len(candidates),
        "accepted_count": sum(len(rows) for rows in accepted.values()),
        "review_count": len(review),
        "quarantined_candidate_count": quarantined_candidate_count,
        "merged_duplicate_candidate_count": merged_duplicate_candidate_count,
        "label_counts": label_counts,
        "warnings": warnings,
        "datasets": {
            "apps": {"path": str(apps_path), "sha256": _sha256_file(apps_path)},
            "websites": {
                "path": str(websites_path),
                "sha256": _sha256_file(websites_path),
            },
        },
        "validation_status": validation["status"],
    }
    reports_dir = output_dir / "reports"
    _write_json_atomic(reports_dir / "collection.json", report)
    _write_json_atomic(reports_dir / "validation.json", validation)
    return report


def _render_console(report: dict) -> str:
    lines = [
        f"External dataset collection: {report['validation_status']}",
        f"Candidates={report['candidate_count']} | accepted={report['accepted_count']} "
        f"| review_groups={report['review_count']} "
        f"| quarantined={report['quarantined_candidate_count']} "
        f"| merged_duplicates={report['merged_duplicate_candidate_count']}",
    ]
    for resource_type in ("apps", "websites"):
        lines.append(
            f"- {resource_type}: "
            + json.dumps(report["label_counts"].get(resource_type, {}), sort_keys=True)
        )
    for warning in report["warnings"]:
        lines.append(f"WARNING: {warning}")
    return "\n".join(lines)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Collect, clean, label, and validate external app/web data."
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use the raw cache and do not make network requests",
    )
    parser.add_argument(
        "--max-per-source",
        type=int,
        help="Override max_records for every network source",
    )
    parser.add_argument("--minimum-samples-per-label", type=int, default=1)
    args = parser.parse_args(argv)
    if args.max_per_source is not None and args.max_per_source < 1:
        parser.error("--max-per-source must be at least 1")
    if args.minimum_samples_per_label < 1:
        parser.error("--minimum-samples-per-label must be at least 1")
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        report = run_collection(
            config_path=args.config,
            output_dir=args.output_dir,
            offline=args.offline,
            max_per_source=args.max_per_source,
            minimum_samples_per_label=args.minimum_samples_per_label,
        )
        print(_render_console(report))
        return 1 if report["validation_status"] == "failed" else 0
    except (CollectionError, DatasetContractError, OSError, UnicodeError) as error:
        print(f"External dataset collection failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
