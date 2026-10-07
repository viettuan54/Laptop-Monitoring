"""Exercise the pinned entrypoint on an isolated port; never restart the live API."""
import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(port, key=None, body=None):
    route = "/v1/moderate" if body else "/model-info" if key else "/health"
    req = Request(f"http://127.0.0.1:{port}{route}",
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type": "application/json", **({"X-Local-Moderation-Key": key} if key else {})})
    with urlopen(req, timeout=2) as response:
        return json.load(response)


def wait_ready(process, port, key):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Isolated service exited before becoming ready")
        try:
            return request(port, key)
        except (OSError, URLError):
            time.sleep(0.1)
    raise RuntimeError("Isolated service startup timed out")


def run(config_path, output):
    root = Path(__file__).resolve().parents[1]
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    checks = []
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        port = holder.getsockname()[1]
    child = None
    with tempfile.TemporaryDirectory(prefix="pinned-api-recovery-") as directory:
        temp = Path(directory)
        key = secrets.token_hex(24)
        backend_env = temp / "backend.env"
        backend_env.write_text(f"NODE_ENV=test\nLOCAL_MODERATION_API_KEY={key}\nLOCAL_MODERATION_URL=http://127.0.0.1:{port}\n", encoding="utf-8")
        config.update(backend_env_path=str(backend_env), port=port, log_dir=str(temp / "logs"))
        local_config = temp / "runtime.json"
        local_config.write_text(json.dumps(config), encoding="utf-8")
        command = [sys.executable, "-X", "utf8", "-B", "-m", "text_safety.run_pinned", "--config", str(local_config)]
        def start():
            return subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            child = start()
            before = wait_ready(child, port, key)
            assert before["modelSha256"] == config["model_sha256"]
            checks.append("pinned_service_starts_with_backend_key")
            payload = {"items": [{"id": "synthetic-recovery", "text": "runtime recovery probe", "sourceType": "search_query"}]}
            expected = request(port, key, payload)
            try:
                request(port, "invalid-key", payload)
                raise AssertionError("Invalid key was accepted")
            except HTTPError as error:
                assert error.code == 401
            checks.append("invalid_key_is_rejected")
            duplicate = start()
            try:
                assert duplicate.wait(timeout=15) != 0
            finally:
                if duplicate.poll() is None:
                    duplicate.kill(); duplicate.wait(timeout=5)
            assert request(port, key)["modelSha256"] == config["model_sha256"]
            checks.append("duplicate_start_does_not_replace_running_service")
            previous_pid = child.pid
            child.kill(); child.wait(timeout=5)
            checks.append("isolated_service_process_stopped")
            child = start()
            after = wait_ready(child, port, key)
            assert child.pid != previous_pid
            assert after == before
            assert request(port, key, payload) == expected
            checks.append("process_restart_preserves_model_and_predictions")
            child.kill(); child.wait(timeout=5)
            config["model_sha256"] = "0" * 64
            local_config.write_text(json.dumps(config), encoding="utf-8")
            child = start()
            assert child.wait(timeout=15) != 0
            checks.append("changed_pin_refuses_startup")
        finally:
            if child is not None and child.poll() is None:
                child.kill(); child.wait(timeout=5)
    report = {"checks": checks, "passed": len(checks),
        "live_service_interrupted": False, "os_reboot_tested": False,
        "scheduled_task_auto_restart_tested": False, "independent_accuracy_test": False}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    run(args.config, args.output)
