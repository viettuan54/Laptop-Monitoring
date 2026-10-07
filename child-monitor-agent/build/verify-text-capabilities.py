"""Reject frozen releases missing the search-query collection and upload path.

Inspect bytecode without starting a service or touching an installed Agent.
The old 1.0.14 bundle predates text collection despite the source having it.
Runtime behavior is covered separately by the Agent tests.
"""

import argparse
import hashlib
import json
import types
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader


REQUIRED = {
    "service/ChildMonitorService.exe": {
        "api_client": {"post_text_moderation"},
        "offline_queue": {"enqueue_text_moderation", "_sync_text_moderation"},
        "enforcement_core": {"get_text_moderation_policy"},
        "pipe_server": {"validate_text_moderation_record"},
        "text_privacy": {"eligible_timestamp", "protect_text", "unprotect_text"},
    },
    "companion/ChildMonitorCompanion.exe": {
        "web_tracker": {"extract_search_query", "update_text_config"},
        "text_privacy": {"eligible_timestamp", "search_parameter"},
    },
}


def symbols(code):
    found = set(code.co_names)
    found.add(code.co_name)
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            found.update(symbols(value))
    return found


def verify(root, version):
    checked = []
    for relative, required_modules in REQUIRED.items():
        path = root / relative
        archive = CArchiveReader(str(path)).open_embedded_archive("PYZ.pyz")
        for module, required_names in required_modules.items():
            if module not in archive.toc:
                raise ValueError(f"{relative} is missing module {module}")
            code = archive.extract(module)
            missing = required_names - symbols(code)
            if missing:
                raise ValueError(f"{relative}:{module} missing {', '.join(sorted(missing))}")
            if module == "web_tracker" and version not in code.co_consts:
                raise ValueError("Frozen collector version does not match installer version")
        checked.append({"binary": relative,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "required_modules": sorted(required_modules)})
    return {"version": version, "text_capabilities_verified": True, "binaries": checked,
        "installed_agent_tested": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    report = verify(args.release_root, args.expected_version)
    (args.release_root / "text-capabilities.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
