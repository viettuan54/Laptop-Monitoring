"""One context repair designed after, and pinned to, the separate ablation."""

from __future__ import annotations

import argparse
from functools import lru_cache
from pathlib import Path

from .context_query_model_v12 import ALGORITHM, query_features
from .experiment_role_context_v11 import CONFIGURATION as V11_CONFIG, fit as fit_context, run as run_context

MODEL_VERSION = "vi-school-violence-typed-context-v12-query-candidate"
PLAN = Path(__file__).with_name("V12_REPAIR_PLAN.md")
CONFIGURATION = {**V11_CONFIG, "name": "typed_context_fixed_high3"}
ABLATION_REPORT = Path(__file__).resolve().parents[1] / (
    "artifacts/school_violence/v12_context_ablation_20261006/ablation_report.json")


@lru_cache(maxsize=1024)
def training_keys(text: str) -> frozenset[str]:
    return frozenset(query_features(text))


def fit(rows: list[dict]) -> dict:
    return fit_context(rows, feature_keys=training_keys, algorithm=ALGORITHM, configuration=CONFIGURATION)


def run(source: Path, output: Path, *, authorized: bool) -> dict:
    result = run_context(source, output, authorized=authorized, candidate_fit=fit, plan=PLAN,
        model_version=MODEL_VERSION, configuration=CONFIGURATION,
        additional_code_paths=(Path(__file__), Path(__file__).with_name("context_query_model_v12.py"),
                               Path(__file__).with_name("component_context_query_model.py")),
        previous_report=ABLATION_REPORT)
    training_keys.cache_clear()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--authorized", action="store_true")
    args = parser.parse_args()
    run(args.source_dir, args.output_dir, authorized=args.authorized)


if __name__ == "__main__":
    main()
