import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from content_classification.content_model import (
    calibrate_temperature,
    evaluate_model,
    fit_model,
    leakage_group,
    predict_model,
    stratified_group_split,
    validate_model,
)
from content_classification.hybrid_content_classifier import (
    build_exact_lookup,
    route_content_classification,
    validate_exact_lookup,
)
from content_classification.validate_dataset import load_taxonomy
from training.train_content_models import (
    load_training_config,
    train_all,
)


class ContentModelTrainingTest(unittest.TestCase):
    @staticmethod
    def _write_csv(path, headers, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)

    def test_domain_family_never_crosses_splits(self):
        classes = ["education", "entertainment", "social", "unsafe", "unknown"]
        rows = []
        for label in classes:
            for index in range(12):
                rows.append(
                    {
                        "domain": f"{label}-{index}.sample-{index}.test",
                        "title": label,
                        "label": label,
                    }
                )
        rows.extend(
            [
                {"domain": "one.pages.dev", "title": "One", "label": "unsafe"},
                {"domain": "two.pages.dev", "title": "Two", "label": "unsafe"},
            ]
        )
        splits, metadata = stratified_group_split(
            rows, "websites", classes, seed="unit-test"
        )

        owners = {}
        for split, records in splits.items():
            for record in records:
                group = leakage_group("websites", record["domain"])
                self.assertEqual(owners.setdefault(group, split), split)
        self.assertEqual(metadata["group_count"], len(owners))
        self.assertGreaterEqual(metadata["largest_group_size"], 2)
        page_splits = {
            split
            for split, records in splits.items()
            if any(record["domain"].endswith(".pages.dev") for record in records)
        }
        self.assertEqual(len(page_splits), 1)
        for split in splits.values():
            self.assertTrue(split)

    def test_ngram_model_learns_identifier_patterns_and_calibrates(self):
        classes = ["education", "entertainment", "social", "unsafe", "unknown"]
        tokens = {
            "education": "academy",
            "entertainment": "movies",
            "social": "friends",
            "unsafe": "phish-login",
            "unknown": "newswire",
        }
        rows = [
            {
                "domain": f"{token}-{index}.host-{label}-{index}.test",
                "title": label,
                "label": label,
            }
            for label, token in tokens.items()
            for index in range(20)
        ]
        splits, _ = stratified_group_split(
            rows, "websites", classes, seed="learning-test"
        )
        model = fit_model(
            splits["train"],
            "websites",
            classes,
            {"minimum_n": 2, "maximum_n": 4},
            alpha=0.2,
        )
        temperature, _ = calibrate_temperature(
            model, splits["validation"], maximum=12.0
        )
        model["temperature"] = temperature
        metrics = evaluate_model(model, splits["test"])

        self.assertGreater(metrics["accuracy"], 0.9)
        result = predict_model(model, "academy-new.host-education-new.test")
        self.assertEqual(result["label"], "education")
        self.assertAlmostEqual(sum(result["probabilities"].values()), 1.0)

    def test_model_contract_rejects_wrong_confidence_threshold(self):
        taxonomy = load_taxonomy()
        classes = taxonomy["resources"]["app"]["labels"]
        records = [
            {"app_name": f"{label}.exe", "display_name": label, "label": label}
            for label in classes
        ]
        model = fit_model(
            records,
            "apps",
            classes,
            {"minimum_n": 2, "maximum_n": 3},
        )
        model["confidence_threshold"] = 0.75
        with self.assertRaisesRegex(ValueError, "must be 0.7"):
            validate_model(model)

    def test_hybrid_router_prefers_reviewed_exact_match_and_enforces_model_gate(self):
        classes = ["learning", "entertainment", "browsers", "unknown"]
        records = [
            {"app_name": f"{label}.exe", "display_name": label, "label": label}
            for label in classes
        ]
        model = fit_model(
            records,
            "apps",
            classes,
            {"minimum_n": 2, "maximum_n": 3},
        )
        lookup = build_exact_lookup(
            records,
            "apps",
            classes,
            dataset_sha256="a" * 64,
            generated_at="2026-08-06T00:00:00+00:00",
        )

        exact = route_content_classification(model, lookup, "  LEARNING.EXE  ")
        unknown = route_content_classification(model, lookup, "not-reviewed.exe")
        no_lookup = route_content_classification(model, None, "not-reviewed.exe")

        self.assertEqual(validate_exact_lookup(lookup), lookup)
        self.assertEqual(exact["decision_source"], "exact_lookup")
        self.assertEqual(exact["label"], "learning")
        self.assertFalse(exact["requires_gemini"])
        self.assertEqual(unknown["decision_source"], "gemini_required")
        self.assertEqual(unknown["reason"], "model_not_deployment_approved")
        self.assertIsNone(unknown["label"])
        self.assertTrue(no_lookup["requires_gemini"])

    def test_hybrid_router_uses_only_approved_high_confidence_model(self):
        classes = ["learning", "entertainment", "browsers", "unknown"]
        records = [
            {
                "app_name": f"{label}-pattern-{index}.exe",
                "display_name": label,
                "label": label,
            }
            for label in classes
            for index in range(8)
        ]
        model = fit_model(
            records,
            "apps",
            classes,
            {"minimum_n": 2, "maximum_n": 4},
            temperature=0.1,
        )
        model["deployment_approved"] = True

        accepted = route_content_classification(
            model, None, "learning-pattern-new.exe"
        )
        self.assertEqual(accepted["decision_source"], "trained_model")
        self.assertEqual(accepted["label"], "learning")
        self.assertGreaterEqual(accepted["confidence"], 0.7)

        model["temperature"] = 100.0
        fallback = route_content_classification(
            model, None, "learning-pattern-new.exe"
        )
        self.assertEqual(fallback["decision_source"], "gemini_required")
        self.assertEqual(fallback["reason"], "model_confidence_below_threshold")
        self.assertIsNone(fallback["label"])

    def test_end_to_end_training_writes_two_json_artifacts_and_report(self):
        taxonomy = load_taxonomy()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset_dir = root / "datasets"
            app_rows = []
            app_tokens = {
                "learning": "study",
                "entertainment": "game",
                "browsers": "browser",
                "unknown": "utility",
            }
            for label, token in app_tokens.items():
                for index in range(8):
                    app_rows.append(
                        {
                            "app_name": f"{token}{index}.exe",
                            "display_name": f"{label} {index}",
                            "label": label,
                        }
                    )
            web_rows = []
            for label in taxonomy["resources"]["web"]["labels"]:
                for index in range(8):
                    web_rows.append(
                        {
                            "domain": f"{label}{index}.host-{label}-{index}.test",
                            "title": f"{label} {index}",
                            "label": label,
                        }
                    )
            self._write_csv(
                dataset_dir / "apps.csv",
                ("app_name", "display_name", "label"),
                app_rows,
            )
            self._write_csv(
                dataset_dir / "websites.csv",
                ("domain", "title", "label"),
                web_rows,
            )
            config = load_training_config()
            config.pop("_ratio_values")
            for resource in config["resources"].values():
                resource["search_grid"] = {
                    "ngram_ranges": [[2, 3]],
                    "alphas": [0.3],
                }
                resource["acceptance"] = {
                    "minimum_total_samples_per_class": 3,
                    "minimum_test_samples_per_class": 1,
                    "minimum_macro_f1": 0.0,
                    "minimum_conclusive_accuracy": 0.0,
                    "minimum_conclusive_coverage": 0.0,
                    "maximum_high_confidence_error_rate": 1.0,
                }
            config_path = root / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            output_dir = root / "artifacts"
            report = train_all(
                dataset_dir=dataset_dir,
                config_path=config_path,
                output_dir=output_dir,
            )
            app_model = json.loads(
                (output_dir / "app_content_model_v1.json").read_text(encoding="utf-8")
            )

            self.assertTrue((output_dir / "web_content_model_v1.json").is_file())
            self.assertTrue((output_dir / "app_exact_lookup_v1.json").is_file())
            self.assertTrue((output_dir / "evaluation_report.json").is_file())

        self.assertEqual(report["confidence_threshold"], 0.7)
        self.assertEqual(app_model["resource_type"], "apps")
        self.assertEqual(app_model["model_type"], "app_metadata_char_ngram_ensemble")
        self.assertEqual(
            app_model["runtime_metadata_fields"],
            ["product_name", "file_description"],
        )
        self.assertEqual(
            app_model["training_summary"]["fit_scope"],
            "train_only_with_validation_calibration",
        )
        self.assertEqual(report["resources"]["apps"]["exact_lookup"]["record_count"], 32)
        self.assertFalse(
            report["resources"]["apps"]["exact_lookup"]["held_out_generalization_claim"]
        )
        self.assertIn("test_metrics", report["resources"]["websites"])


if __name__ == "__main__":
    unittest.main()
