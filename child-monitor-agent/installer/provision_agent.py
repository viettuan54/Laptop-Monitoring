import argparse
import base64
import json
import os
import re
import subprocess
import tempfile
import uuid
from urllib.parse import urlparse

import requests
import win32crypt


CRYPTPROTECT_LOCAL_MACHINE = 0x4
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
SUBJECT_ID_PATTERN = re.compile(r"^subject-[A-Za-z0-9_-]+$")


def normalize_server_url(value):
    server_url = value.strip().rstrip("/")
    parsed = urlparse(server_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("ServerUrl must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("ServerUrl must not contain credentials, query, or fragment")
    if parsed.path not in ("", "/"):
        raise ValueError("ServerUrl must not contain a path")

    loopback_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and parsed.hostname.lower() not in loopback_hosts:
        raise ValueError("HTTPS is required for every non-loopback ServerUrl")
    return server_url


def normalize_device_secret(value):
    secret = value.strip().lower()
    if not UUID_PATTERN.fullmatch(secret):
        raise ValueError("DeviceSecret must be a UUID")
    # Reject malformed UUID strings that happen to match the surface pattern.
    if str(uuid.UUID(secret)) != secret:
        raise ValueError("DeviceSecret must be a canonical UUID")
    return secret


def normalize_vision_subject_id(value):
    if value is None:
        return None
    subject_id = value.strip()
    if not SUBJECT_ID_PATTERN.fullmatch(subject_id):
        raise ValueError("VisionSubjectId must use the form subject-<safe-id>")
    return subject_id


def validate_credentials(server_url, device_secret, timeout):
    response = requests.post(
        f"{server_url}/api/agent/heartbeat",
        headers={
            "Content-Type": "application/json",
            "X-Device-Secret": device_secret,
        },
        json={},
        timeout=timeout,
        allow_redirects=False,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Backend rejected Agent credentials (HTTP {response.status_code})"
        )


def encrypt_machine_scope(value):
    encrypted = win32crypt.CryptProtectData(
        value.encode("utf-8"),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_LOCAL_MACHINE,
    )
    return base64.b64encode(encrypted).decode("ascii")


def secure_config_file(config_path):
    result = subprocess.run(
        [
            "icacls",
            config_path,
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(F)",
            "/grant:r",
            "*S-1-5-32-544:(F)",
        ],
        capture_output=True,
        text=True,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
        raise RuntimeError(
            result.stderr.strip() or result.stdout.strip() or "icacls failed"
        )


def write_config_atomic(config_path, payload):
    config_dir = os.path.dirname(os.path.abspath(config_path))
    os.makedirs(config_dir, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=config_dir,
            prefix=".local_config.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            json.dump(payload, temporary, indent=2)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = temporary.name

        os.replace(temporary_path, config_path)
        temporary_path = None
        secure_config_file(config_path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.remove(temporary_path)


def main():
    parser = argparse.ArgumentParser(
        description="Provision or rotate credentials for Child Monitor Agent."
    )
    parser.add_argument("--server-url", required=True)
    parser.add_argument("--device-secret", required=True)
    parser.add_argument("--config-path", required=True)
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--vision-subject-id")
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Write credentials without contacting backend (offline recovery only).",
    )
    args = parser.parse_args()

    server_url = normalize_server_url(args.server_url)
    device_secret = normalize_device_secret(args.device_secret)
    vision_subject_id = normalize_vision_subject_id(args.vision_subject_id)

    if not args.skip_validation:
        validate_credentials(server_url, device_secret, args.timeout)

    payload = {
        "schema_version": 1,
        "server_url": server_url,
        "device_secret": encrypt_machine_scope(device_secret),
        "is_encrypted": True,
        "encryption_scope": "LocalMachine",
    }
    if vision_subject_id is None and os.path.isfile(args.config_path):
        try:
            with open(args.config_path, "r", encoding="utf-8") as stream:
                existing = json.load(stream)
            vision_subject_id = normalize_vision_subject_id(
                existing.get("vision_subject_id")
            )
        except (OSError, ValueError, json.JSONDecodeError):
            vision_subject_id = None
    if vision_subject_id is not None:
        payload["vision_subject_id"] = vision_subject_id
    write_config_atomic(args.config_path, payload)
    print(f"Agent provisioning completed for {server_url}.")


if __name__ == "__main__":
    main()
