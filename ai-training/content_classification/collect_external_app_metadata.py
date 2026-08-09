"""Collect externally labelled software product names for app metadata training."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from io import StringIO
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = Path(__file__).resolve().parent / "external_app_metadata_sources.json"
DEFAULT_OUTPUT = ROOT / "datasets" / "content"
CLASS_ID_RE = re.compile(r"Q[1-9][0-9]*")
LABELS = ("learning", "entertainment", "browsers", "unknown")


class AppMetadataCollectionError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _atomic(path: Path, payload: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _normalize_product_name(value: str) -> str:
    value = " ".join(str(value or "").split()).strip()
    if not value or len(value) > 150:
        raise ValueError("product_name length is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("product_name contains control characters")
    return value


def _query(class_ids: list[str], limit: int) -> str:
    values = " ".join(f"wd:{value}" for value in class_ids)
    return f"""PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?item ?productName WHERE {{
  VALUES ?class {{ {values} }}
  ?item wdt:P31 ?class;
        rdfs:label ?productName.
  FILTER(LANG(?productName) = "en")
}}
LIMIT {limit}"""


def _fetch(url: str, user_agent: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/sparql-results+json", "User-Agent": user_agent},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read(25 * 1024 * 1024)


def collect_app_metadata(
    config_path: Path | str = DEFAULT_CONFIG,
    output_dir: Path | str = DEFAULT_OUTPUT,
    *,
    offline: bool = False,
    fetch=None,
) -> dict:
    config_path = Path(config_path).resolve()
    output_dir = Path(output_dir).resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("config_version") != "1.0.0":
        raise AppMetadataCollectionError("config_version must be 1.0.0")
    sources = config.get("sources")
    if not isinstance(sources, list) or not sources:
        raise AppMetadataCollectionError("sources must be a non-empty array")
    fetch = fetch or _fetch
    cache_dir = output_dir / "raw-cache" / "app-metadata"
    cache_dir.mkdir(parents=True, exist_ok=True)
    candidates = []
    source_runs = []
    for source in sources:
        source_id = source.get("id")
        label = source.get("label")
        class_ids = source.get("class_ids")
        limit = int(source.get("max_records", 0))
        if (
            not isinstance(source_id, str)
            or label not in LABELS
            or not isinstance(class_ids, list)
            or not class_ids
            or any(not isinstance(value, str) or not CLASS_ID_RE.fullmatch(value) for value in class_ids)
            or limit < 1
        ):
            raise AppMetadataCollectionError(f"invalid source: {source_id}")
        cache_path = cache_dir / f"{source_id}.raw"
        query = _query(class_ids, max(limit * 3, limit))
        url = config["endpoint"] + "?" + urllib.parse.urlencode(
            {"query": query, "format": "json"}
        )
        if offline:
            if not cache_path.is_file():
                raise AppMetadataCollectionError(f"missing offline cache: {source_id}")
            payload = cache_path.read_bytes()
            mode = "cache"
        else:
            try:
                payload = fetch(url, config["user_agent"])
                _atomic(cache_path, payload)
                mode = "network"
            except Exception as error:
                if not cache_path.is_file():
                    raise AppMetadataCollectionError(
                        f"could not fetch {source_id}: {error}"
                    ) from error
                payload = cache_path.read_bytes()
                mode = "cache_fallback"
        try:
            bindings = json.loads(payload.decode("utf-8"))["results"]["bindings"]
        except (UnicodeError, json.JSONDecodeError, KeyError, TypeError) as error:
            raise AppMetadataCollectionError(f"invalid response: {source_id}") from error
        selected = []
        for binding in bindings:
            name = binding.get("productName", {}).get("value")
            item = binding.get("item", {}).get("value")
            try:
                name = _normalize_product_name(name)
            except ValueError:
                continue
            selected.append(
                {
                    "product_name": name,
                    "label": label,
                    "source_id": source_id,
                    "source_url": item or config["endpoint"],
                }
            )
        selected.sort(
            key=lambda row: hashlib.sha256(
                f"{source_id}\0{row['product_name'].casefold()}".encode("utf-8")
            ).digest()
        )
        candidates.extend(selected[:limit])
        source_runs.append(
            {
                "source_id": source_id,
                "label": label,
                "class_ids": class_ids,
                "class_names": source.get("class_names", []),
                "acquisition_mode": mode,
                "selected_count": min(limit, len(selected)),
                "raw_sha256": hashlib.sha256(payload).hexdigest(),
            }
        )

    grouped = defaultdict(list)
    for row in candidates:
        grouped[row["product_name"].casefold()].append(row)
    accepted = []
    conflicts = []
    provenance = []
    for key, group in sorted(grouped.items()):
        labels = {row["label"] for row in group}
        if len(labels) != 1:
            conflicts.append({"product_name": key, "labels": sorted(labels)})
            continue
        chosen = max(group, key=lambda row: (len(row["product_name"]), row["product_name"]))
        accepted.append({"product_name": chosen["product_name"], "label": chosen["label"]})
        provenance.append(
            {
                "product_name": chosen["product_name"],
                "label": chosen["label"],
                "source_ids": sorted({row["source_id"] for row in group}),
                "source_urls": sorted({row["source_url"] for row in group}),
                "license": config["license"],
            }
        )
    accepted.sort(key=lambda row: (row["label"], row["product_name"].casefold()))
    buffer = StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=("product_name", "label"), lineterminator="\n")
    writer.writeheader()
    writer.writerows(accepted)
    _atomic(output_dir / "app_metadata.csv", buffer.getvalue().encode("utf-8"))
    _atomic(
        output_dir / "app_metadata_provenance.jsonl",
        ("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in provenance)).encode("utf-8"),
    )
    counts = Counter(row["label"] for row in accepted)
    minimum_per_label = int(config.get("minimum_records_per_label", 1))
    if minimum_per_label < 1:
        raise AppMetadataCollectionError("minimum_records_per_label must be positive")
    undersized = [label for label in LABELS if counts[label] < minimum_per_label]
    report = {
        "report_version": "1.0.0",
        "generated_at": _now(),
        "status": "failed" if undersized else "passed",
        "record_count": len(accepted),
        "label_counts": dict(sorted(counts.items())),
        "conflict_count": len(conflicts),
        "minimum_records_per_label": minimum_per_label,
        "undersized_labels": undersized,
        "license": config["license"],
        "license_url": config["license_url"],
        "sources": source_runs,
    }
    _atomic(
        output_dir / "reports" / "app_metadata_collection.json",
        (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = collect_app_metadata(args.config, args.output_dir, offline=args.offline)
    except (AppMetadataCollectionError, OSError, ValueError) as error:
        print(f"App metadata collection failed: {error}")
        return 2
    print(f"App metadata collection: {report['status']}")
    print(f"records={report['record_count']} labels={json.dumps(report['label_counts'], sort_keys=True)}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
