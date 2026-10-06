"""Benchmark the pinned candidate and run the real local Agent-to-parent API flow.

These are functional checks using development fixtures, not a new accuracy test.
No deployment or third-party notification is performed.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .adapt_confirmed_errors_v6 import sha256
from .adapt_reviewed_queries_v8 import ARTIFACT_ROOT
from .benchmark_query_runtime import summarize_ms, windows_memory
from .evaluate_real_world import check_independence
from .predict import load_model


ROOT = Path(__file__).resolve().parents[2]


def http_json(url: str, body=None, key=None):
    headers = {"content-type": "application/json"}
    if key:
        headers["X-Local-Moderation-Key"] = key
    request = Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with urlopen(request, timeout=5) as response:
        return json.load(response)


def run(selection_path: Path, output: Path) -> dict:
    root = ARTIFACT_ROOT.resolve()
    if not output.resolve().is_relative_to(root) or output.resolve() == root:
        raise ValueError("Output must be inside the ignored artifact directory")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError("Output directory is not empty")
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    model_path = Path(selection["selected_artifact"])
    if not model_path.resolve().is_relative_to(root):
        raise ValueError("Candidate must be a local ignored artifact")
    if sha256(model_path) != selection["selected_model_sha256"]:
        raise ValueError("Selected candidate changed after selection")
    rows = [json.loads(line) for line in (model_path.parent / "train.jsonl").read_text(encoding="utf-8").splitlines()]
    if len(rows) != selection["development_rows"] or not rows:
        raise ValueError("Unexpected development fixture count")
    expected_algorithm = load_model(model_path)["algorithm"]
    output.mkdir(parents=True, exist_ok=True)
    queries_path = output / "development_queries.json"
    queries_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    started = time.perf_counter()
    measured = subprocess.run([sys.executable, "-B", "-m", "school_violence.benchmark_query_runtime",
        "--model", str(model_path), "--input", str(queries_path)], cwd=ROOT / "ai-training",
        capture_output=True, text=True, encoding="utf-8", check=True, timeout=30)
    benchmark = json.loads(measured.stdout)
    benchmark["process_wall_seconds_including_imports_and_warm_inferences"] = time.perf_counter() - started
    expected = {row["id"]: row for row in benchmark["predictions"]}
    fixtures = [next(row for row in rows if row["label"] == label
                     and expected[row["id"]]["label"] == label)
                for label in ("SAFE", "RISK", "HIGH_RISK")]
    fixtures_path = output / "functional_fixtures.json"
    fixtures_path.write_text(json.dumps(fixtures, ensure_ascii=False), encoding="utf-8")
    key = secrets.token_hex(24)
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        port = holder.getsockname()[1]
    environment = os.environ | {"TEXT_SAFETY_ENV": "development", "TEXT_SAFETY_API_KEY": key,
        "TEXT_SAFETY_MODEL_PATH": str(model_path), "PYTHONIOENCODING": "utf-8"}
    with (output / "service_test.log").open("w", encoding="utf-8") as log:
        started = time.perf_counter()
        server = subprocess.Popen([sys.executable, "-B", "-m", "school_violence.serve_query_test", str(port)],
            cwd=ROOT / "ai-training", env=environment, stdin=subprocess.PIPE, stdout=log, stderr=log)
        base_url = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    health = http_json(base_url + "/health")
                    break
                except (URLError, ConnectionError):
                    if time.monotonic() > deadline or server.poll() is not None:
                        raise RuntimeError("Candidate API startup failed") from None
                    time.sleep(0.05)
            startup_ms = (time.perf_counter() - started) * 1000
            assert health["model"] == selection["selected_model_version"]
            assert health["deploymentEligible"] is False
            assert health["engine"] == expected_algorithm
            singles = []
            for row in rows:
                started = time.perf_counter()
                response = http_json(base_url + "/v1/moderate", {"items": [
                    {"id": row["id"], "text": row["text"], "sourceType": "search_query"}]}, key)
                singles.append((time.perf_counter() - started) * 1000)
                result = response["results"][0]
                assert result["label"] == expected[row["id"]]["label"]
                assert all(abs(result["scores"][label] - expected[row["id"]]["scores"][label]) < 1e-12
                           for label in ("SAFE", "RISK", "HIGH_RISK"))
            batches = []
            for offset in range(0, len(rows), 20):
                started = time.perf_counter()
                chunk = rows[offset:offset + 20]
                response = http_json(base_url + "/v1/moderate", {"items": [
                    {"id": row["id"], "text": row["text"], "sourceType": "search_query"}
                    for row in chunk]}, key)
                batches.append((time.perf_counter() - started) * 1000)
                assert [item["label"] for item in response["results"]] == [expected[row["id"]]["label"] for row in chunk]
            for wrong_key, body, status in (("incorrect", {"items": []}, 401),
                (key, {"items": [{"id": "bad", "text": "synthetic private fixture", "sourceType": "invalid"}]}, 422)):
                try:
                    http_json(base_url + "/v1/moderate", body, wrong_key)
                    raise AssertionError("Invalid request was accepted")
                except HTTPError as error:
                    assert error.code == status
                    assert b"synthetic private fixture" not in error.read()
            worker_pid = int(next(line.split()[1] for line in (output / "service_test.log").read_text(
                encoding="utf-8").splitlines() if line.startswith("API_WORKER_PID ")))
            api = {"startup_ms": startup_ms, "single_request": summarize_ms(singles),
                   "batch_request_up_to_20_queries": summarize_ms(batches),
                   "memory": windows_memory(worker_pid), "consistent_rows": len(rows),
                   "auth_and_sanitized_validation_passed": True, "health": health}
            print(json.dumps({"runtime_benchmark": benchmark["inference"], "api": api}), flush=True)
            input_data = {"provider_url": base_url, "provider_key": key,
                "model_version": selection["selected_model_version"],
                "fixtures_path": str(fixtures_path.resolve()), "python": sys.executable,
                "agent_probe": str(Path(__file__).parent / "probe_agent_queue.py")}
            accepted = subprocess.run(["node", "test/queryCandidate.acceptance.js"],
                input=json.dumps(input_data), cwd=ROOT / "child-monitor-backend", capture_output=True,
                text=True, encoding="utf-8", timeout=60, env=os.environ | {"PYTHONIOENCODING": "utf-8"})
            (output / "acceptance_test.log").write_text(accepted.stdout + accepted.stderr, encoding="utf-8")
            if accepted.returncode:
                raise RuntimeError("Agent acceptance checks failed; see local acceptance_test.log")
            flow = json.loads(next(line.removeprefix("ACCEPTANCE_RESULT ") for line in accepted.stdout.splitlines()
                                  if line.startswith("ACCEPTANCE_RESULT ")))
        finally:
            server.stdin.close()
            server.wait(timeout=10)
    try:
        check_independence(rows, model_path.parent)
        raise AssertionError("Development rows accepted as an independent holdout")
    except ValueError:
        independence_guard = True
    production_environment = environment | {"TEXT_SAFETY_ENV": "production"}
    refused = subprocess.run([sys.executable, "-B", "-c", "from text_safety.config import get_settings; get_settings()"],
        cwd=ROOT / "ai-training", capture_output=True, text=True, env=production_environment)
    assert refused.returncode != 0 and "Unapproved" in refused.stderr
    report = {"selection_report_sha256": sha256(selection_path),
        "model": selection["selected_model_version"], "model_sha256": sha256(model_path),
        "functional_fixture_ids": [row["id"] for row in fixtures],
        "environment": {"os": platform.platform(), "python": platform.python_version(),
                        "logical_cpus": os.cpu_count()},
        "runtime": benchmark, "api": api, "agent_to_parent": flow,
        "development_holdout_reuse_rejected": independence_guard,
        "unapproved_production_startup_rejected": True, "deployment_eligible": False,
        "independent_final_holdout_evaluated": False,
        "limitations": ["Local sequential CPU benchmark on development queries; not a concurrent load test.",
                        "Real isolated PostgreSQL; test memory rate limiting; external push delivery captured.",
                        "Parent API and dashboard alert renderer checked; browser layout not exercised."]}
    (output / "verification_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"acceptance_checks": flow["check_count"], "report": str(output / "verification_report.json")}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection-report", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    run(args.selection_report, args.output_dir)


if __name__ == "__main__":
    main()
