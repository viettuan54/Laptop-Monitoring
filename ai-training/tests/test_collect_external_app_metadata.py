import csv
import json
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.collect_external_app_metadata import collect_app_metadata


class ExternalAppMetadataCollectorTest(unittest.TestCase):
    def test_collects_separate_product_metadata_with_provenance_and_conflict_quarantine(self):
        labels = ("learning", "entertainment", "browsers", "unknown")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = {
                "config_version": "1.0.0",
                "user_agent": "unit-test",
                "license": "CC0-1.0",
                "license_url": "https://example.test/license",
                "endpoint": "https://example.test/sparql",
                "sources": [
                    {
                        "id": f"source-{label}",
                        "label": label,
                        "class_ids": [f"Q{index + 1}"],
                        "class_names": [label],
                        "max_records": 10,
                    }
                    for index, label in enumerate(labels)
                ],
            }
            config_path = root / "sources.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")

            def fake_fetch(url, _user_agent):
                query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["query"][0]
                index = next(index for index in range(1, 5) if f"wd:Q{index}" in query)
                label = labels[index - 1]
                names = [f"{label} Product One", f"{label} Product Two"]
                if label in {"learning", "unknown"}:
                    names.append("Conflicting Product")
                return json.dumps(
                    {
                        "results": {
                            "bindings": [
                                {
                                    "item": {"value": f"https://www.wikidata.org/wiki/Q{index}0{offset}"},
                                    "productName": {"value": name},
                                }
                                for offset, name in enumerate(names)
                            ]
                        }
                    }
                ).encode("utf-8")

            output_dir = root / "content"
            report = collect_app_metadata(
                config_path, output_dir, fetch=fake_fetch
            )

            with (output_dir / "app_metadata.csv").open(
                "r", encoding="utf-8", newline=""
            ) as handle:
                rows = list(csv.DictReader(handle))
            provenance = [
                json.loads(line)
                for line in (output_dir / "app_metadata_provenance.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]

            self.assertEqual(report["status"], "passed")
            self.assertEqual(report["record_count"], 8)
            self.assertEqual(report["conflict_count"], 1)
            self.assertEqual(report["label_counts"], {label: 2 for label in labels})
            self.assertEqual(len(rows), 8)
            self.assertEqual(len(provenance), 8)
            self.assertFalse(any(row["product_name"] == "Conflicting Product" for row in rows))
            self.assertFalse((output_dir / "apps.csv").exists())

            offline = collect_app_metadata(config_path, output_dir, offline=True)
            self.assertEqual(offline["record_count"], 8)
            self.assertTrue(all(item["acquisition_mode"] == "cache" for item in offline["sources"]))


if __name__ == "__main__":
    unittest.main()
