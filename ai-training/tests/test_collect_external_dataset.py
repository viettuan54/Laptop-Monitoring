import csv
import json
import sys
import tempfile
import unittest
import urllib.parse
from collections import Counter
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.collect_external_dataset import (
    CollectionError,
    clean_and_label_candidates,
    domain_from_external_value,
    load_source_config,
    run_collection,
)
from content_classification.validate_dataset import load_taxonomy


class ExternalDatasetCollectionTest(unittest.TestCase):
    @staticmethod
    def _source(source_id, kind, **values):
        return {
            "id": source_id,
            "kind": kind,
            "license": "CC0-1.0",
            "license_url": "https://example.test/license",
            "allow_for_training": True,
            "label_method": "source_class_mapping",
            **values,
        }

    def _write_fixture_config(self, root: Path) -> Path:
        app_catalog = {
            "catalog_version": "test",
            "records": [
                {
                    "app_name": "study.exe",
                    "display_name": "Study",
                    "label": "learning",
                    "evidence_url": "https://example.test/study",
                    "label_basis": "Learning fixture",
                },
                {
                    "app_name": "game.exe",
                    "display_name": "Game",
                    "label": "entertainment",
                    "evidence_url": "https://example.test/game",
                    "label_basis": "Entertainment fixture",
                },
                {
                    "app_name": "browser.exe",
                    "display_name": "Browser",
                    "label": "browsers",
                    "evidence_url": "https://example.test/browser",
                    "label_basis": "Browser fixture",
                },
                {
                    "app_name": "tool.exe",
                    "display_name": "Tool",
                    "label": "unknown",
                    "evidence_url": "https://example.test/tool",
                    "label_basis": "Unknown fixture",
                },
            ],
        }
        (root / "apps.json").write_text(json.dumps(app_catalog), encoding="utf-8")
        sources = [
            {
                **self._source("reviewed-apps", "reviewed_json"),
                "path": "apps.json",
                "license": "project-curated-facts",
                "label_method": "curated_rule",
            }
        ]
        mappings = [
            ("education", "Q1"),
            ("entertainment", "Q2"),
            ("social", "Q3"),
            ("unknown", "Q4"),
        ]
        for label, class_id in mappings:
            sources.append(
                self._source(
                    f"wiki-{label}",
                    "wikidata_sparql",
                    endpoint="https://query.test/sparql",
                    class_id=class_id,
                    class_name=label,
                    resource_type="websites",
                    label=label,
                    max_records=10,
                )
            )
        sources.append(
            self._source(
                "unsafe-feed",
                "json_domain_list",
                url="https://feed.test/domains.json",
                resource_type="websites",
                label="unsafe",
                title="Unsafe",
                max_records=10,
                label_method="threat_feed",
            )
        )
        config = {
            "config_version": "1.0.0",
            "user_agent": "collector-test/1.0",
            "allowed_licenses": ["CC0-1.0", "project-curated-facts"],
            "sources": sources,
        }
        path = root / "sources.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    @staticmethod
    def _fake_fetch(url, _headers):
        if url == "https://feed.test/domains.json":
            return json.dumps(
                ["https://phish.example.co/login", "127.0.0.1"]
            ).encode("utf-8")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["query"][0]
        values = {
            "Q1": ("https://www.Example.edu/course", "School"),
            "Q2": ("https://video.example.org/watch", "Video"),
            "Q3": ("https://social.example.net/", "Social"),
            "Q4": ("https://news.example.com/latest", "News"),
        }
        class_id = next(key for key in values if f"wd:{key}" in query)
        website, label = values[class_id]
        return json.dumps(
            {
                "results": {
                    "bindings": [
                        {
                            "item": {"value": f"https://www.wikidata.org/wiki/{class_id}"},
                            "itemLabel": {"value": label},
                            "website": {"value": website},
                        }
                    ]
                }
            }
        ).encode("utf-8")

    def test_collects_cleans_labels_and_validates_all_classes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self._write_fixture_config(root)
            output = root / "output"
            report = run_collection(
                config_path=config,
                output_dir=output,
                fetch=self._fake_fetch,
            )
            with (output / "websites.csv").open(encoding="utf-8", newline="") as handle:
                websites = list(csv.DictReader(handle))
            review = (output / "review_queue.csv").read_text(encoding="utf-8")
            provenance = (output / "record_provenance.jsonl").read_text(
                encoding="utf-8"
            )

        self.assertEqual(report["validation_status"], "passed")
        self.assertEqual(report["accepted_count"], 9)
        self.assertEqual(report["review_count"], 1)
        self.assertIn(
            {"domain": "example.edu", "title": "School", "label": "education"},
            websites,
        )
        self.assertIn("IP addresses are not accepted", review)
        self.assertIn("https://www.wikidata.org/wiki/Q1", provenance)
        self.assertEqual(report["label_counts"]["apps"]["browsers"], 1)

    def test_conflicting_labels_are_quarantined(self):
        candidates = [
            {
                "resource_type": "websites",
                "raw_key": "https://same.example/path",
                "display_name": "One",
                "label": "education",
                "source_id": "one",
                "source_url": "https://source.example/one",
                "license": "CC0-1.0",
                "label_method": "source_class_mapping",
            },
            {
                "resource_type": "websites",
                "raw_key": "SAME.example",
                "display_name": "Two",
                "label": "social",
                "source_id": "two",
                "source_url": "https://source.example/two",
                "license": "CC0-1.0",
                "label_method": "source_class_mapping",
            },
        ]
        accepted, provenance, review = clean_and_label_candidates(
            candidates, load_taxonomy()
        )

        self.assertEqual(accepted["websites"], [])
        self.assertEqual(provenance, [])
        self.assertEqual(review[0]["reason"], "conflicting_labels")
        self.assertEqual(review[0]["candidate_labels"], "education|social")

    def test_domain_extraction_rejects_ip_and_normalizes_url(self):
        self.assertEqual(
            domain_from_external_value("HTTPS://WWW.München.example/path?token=secret"),
            "xn--mnchen-3ya.example",
        )
        with self.assertRaisesRegex(ValueError, "IP addresses"):
            domain_from_external_value("https://192.0.2.1/path")

    def test_config_rejects_unapproved_license(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "sources.json"
            path.write_text(
                json.dumps(
                    {
                        "config_version": "1.0.0",
                        "user_agent": "test/1",
                        "allowed_licenses": ["CC0-1.0"],
                        "sources": [
                            self._source(
                                "bad-license",
                                "json_domain_list",
                                url="https://example.test/data",
                                license="unknown-license",
                            )
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(CollectionError, "allowed_licenses"):
                load_source_config(path)

    def test_reviewed_catalog_requires_label_basis_and_https_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = self._write_fixture_config(root)
            catalog_path = root / "apps.json"
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog["records"][0].pop("label_basis")
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

            with self.assertRaisesRegex(CollectionError, "label_basis"):
                run_collection(config_path=config, output_dir=root / "output")

            catalog["records"][0]["label_basis"] = "Learning fixture"
            catalog["records"][0]["evidence_url"] = "http://example.test/study"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

            with self.assertRaisesRegex(CollectionError, "safe HTTPS"):
                run_collection(config_path=config, output_dir=root / "output")

    def test_project_app_catalog_has_at_least_50_records_per_label(self):
        catalog_path = (
            TRAINING_ROOT / "content_classification" / "reviewed_app_catalog.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        counts = Counter(record["label"] for record in catalog["records"])
        expected_labels = set(load_taxonomy()["resources"]["app"]["labels"])

        self.assertEqual(set(counts), expected_labels)
        for label in expected_labels:
            self.assertGreaterEqual(counts[label], 50, label)

    def test_project_vietnamese_website_catalog_is_balanced_and_auditable(self):
        catalog_path = (
            TRAINING_ROOT
            / "content_classification"
            / "reviewed_vietnamese_website_catalog.json"
        )
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        records = catalog["records"]
        counts = Counter(record["label"] for record in records)

        self.assertEqual(len(records), 60)
        self.assertEqual(
            counts,
            Counter(
                {
                    "education": 15,
                    "entertainment": 15,
                    "social": 15,
                    "unknown": 15,
                }
            ),
        )
        self.assertEqual(len({record["domain"] for record in records}), len(records))
        for record in records:
            self.assertEqual(record["resource_type"], "websites")
            self.assertTrue(record["evidence_url"].startswith("https://"))
            self.assertTrue(record["label_basis"].strip())

        gamevui = next(record for record in records if record["domain"] == "gamevui.vn")
        self.assertEqual(gamevui["label"], "entertainment")


if __name__ == "__main__":
    unittest.main()
