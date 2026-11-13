import json
import sys
import tempfile
import unittest
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from evaluation.evaluate_hybrid_content_pipeline import (
    DEFAULT_APPS_EVAL_CSV,
    DEFAULT_ARTIFACTS_DIR,
    DEFAULT_GEMINI_CACHE_PATH,
    DEFAULT_WEBSITES_EVAL_CSV,
    compute_classification_metrics,
    evaluate_hybrid_pipeline,
    load_eval_dataset,
    render_markdown_report,
    summarize_latencies,
)


class EvaluateHybridContentPipelineTest(unittest.TestCase):
    def test_compute_classification_metrics_confusion_and_f1(self):
        classes = ["learning", "entertainment", "browsers", "unknown"]
        pairs = [
            ("learning", "learning"),
            ("learning", "learning"),
            ("entertainment", "entertainment"),
            ("entertainment", "unknown"),
            ("browsers", "browsers"),
            ("unknown", "unknown"),
        ]
        metrics = compute_classification_metrics(pairs, classes, total_population=10)
        self.assertEqual(metrics["sample_count"], 6)
        self.assertAlmostEqual(metrics["share_of_total"], 0.6)
        self.assertAlmostEqual(metrics["accuracy"], 5 / 6)
        self.assertEqual(metrics["confusion_matrix"]["learning"]["learning"], 2)
        self.assertEqual(metrics["confusion_matrix"]["entertainment"]["unknown"], 1)
        self.assertAlmostEqual(metrics["per_class"]["learning"]["f1"], 1.0)
        self.assertGreater(metrics["macro_f1"], 0.75)

    def test_summarize_latencies_handles_empty_and_populated(self):
        empty = summarize_latencies([])
        self.assertEqual(empty["count"], 0)
        self.assertIsNone(empty["mean_ms"])

        stats = summarize_latencies([0.05, 0.10, 0.15, 0.20, 0.40])
        self.assertEqual(stats["count"], 5)
        self.assertAlmostEqual(stats["mean_ms"], 0.18)
        self.assertAlmostEqual(stats["median_ms"], 0.15)
        self.assertLess(stats["max_ms"], 1.0)

    def test_load_eval_dataset_enforces_cohort_separation(self):
        app_lookup = json.loads(
            (DEFAULT_ARTIFACTS_DIR / "app_exact_lookup_v1.json").read_text(encoding="utf-8")
        )
        web_lookup = json.loads(
            (DEFAULT_ARTIFACTS_DIR / "web_exact_lookup_v1.json").read_text(encoding="utf-8")
        )
        apps = load_eval_dataset(
            "apps",
            DEFAULT_APPS_EVAL_CSV,
            app_lookup,
            ["learning", "entertainment", "browsers", "unknown"],
        )
        websites = load_eval_dataset(
            "websites",
            DEFAULT_WEBSITES_EVAL_CSV,
            web_lookup,
            ["education", "entertainment", "social", "unsafe", "unknown"],
        )
        self.assertEqual(len(apps), 80)
        self.assertEqual(len(websites), 125)
        self.assertEqual(sum(1 for r in apps if r["cohort"] == "out_of_lookup"), 56)
        self.assertEqual(sum(1 for r in websites if r["cohort"] == "out_of_lookup"), 90)

    def test_cached_hybrid_evaluation_reproduces_report_and_markdown(self):
        if not DEFAULT_GEMINI_CACHE_PATH.is_file():
            self.skipTest("Gemini cache file not generated yet")
        report = evaluate_hybrid_pipeline(
            gemini_mode="cache",
            latency_iterations=5,
        )
        self.assertEqual(report["combined_overview"]["representative_all"]["total_samples"], 205)
        self.assertEqual(report["combined_overview"]["strictly_out_of_lookup"]["total_samples"], 146)
        self.assertTrue(
            report["combined_overview"]["representative_all"]["latency_ms"]["local_under_1ms_verified"]
        )
        md = render_markdown_report(report)
        self.assertIn("Confusion Matrix", md)
        self.assertIn("Macro-F1", md)
        self.assertIn("Tầng 1: Exact Lookup", md)
        self.assertIn("Tầng 2: N-gram", md)
        self.assertIn("Tầng 3: Gemini Fallback", md)


if __name__ == "__main__":
    unittest.main()
