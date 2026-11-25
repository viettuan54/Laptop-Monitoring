"""Verify the 4 packaged content models and frozen classifier bytecode in a release."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import types
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader


CONTENT_ASSETS = (
    "app_content_model_v1.json",
    "web_content_model_v1.json",
    "app_exact_lookup_v1.json",
    "web_exact_lookup_v1.json",
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_frozen_module(
    pyz, module_name: str, fake_file: Path, package_alias: str | None = None
):
    if module_name not in pyz.toc:
        raise ValueError(f"Frozen archive is missing module: {module_name}")
    code = pyz.extract(module_name)
    module = types.ModuleType(package_alias or module_name)
    module.__file__ = str(fake_file)
    exec(code, module.__dict__)
    return module


def verify(release_root: Path, expected_source_dir: Path | None = None) -> dict:
    models_dir = release_root / "models"
    service_exe = release_root / "service" / "ChildMonitorService.exe"
    if not service_exe.is_file():
        raise FileNotFoundError(f"Missing frozen service binary: {service_exe}")

    asset_hashes = {}
    for name in CONTENT_ASSETS:
        asset_path = models_dir / name
        sidecar_path = models_dir / f"{name}.sha256"
        if not asset_path.is_file() or not sidecar_path.is_file():
            raise FileNotFoundError(f"Missing packaged content asset or checksum: {name}")
        actual_hash = _sha256(asset_path)
        recorded_hash = sidecar_path.read_text(encoding="ascii").strip().split()[0].lower()
        if actual_hash != recorded_hash:
            raise ValueError(f"Sidecar SHA-256 mismatch for {name}")
        if expected_source_dir is not None and (expected_source_dir / name).is_file():
            source_hash = _sha256(expected_source_dir / name)
            if actual_hash != source_hash:
                raise ValueError(
                    f"Packaged {name} does not match ai-training artifact ({actual_hash} != {source_hash})"
                )
        asset_hashes[name] = actual_hash

    pyz = CArchiveReader(str(service_exe)).open_embedded_archive("PYZ.pyz")
    runtime_paths_mod = _load_frozen_module(
        pyz, "runtime_paths", release_root / "service" / "runtime_paths.py"
    )
    sys.modules["runtime_paths"] = runtime_paths_mod
    frozen_cls_mod = _load_frozen_module(
        pyz,
        "content_classifier",
        release_root / "service" / "content_classifier.py",
        "frozen_content_classifier",
    )

    contracts = frozen_cls_mod.verify_packaged_content_assets(str(models_dir))
    classifier = frozen_cls_mod.ContentClassifier(str(models_dir))

    pornhub = classifier.classify_web("pornhub.com")
    onlyfans = classifier.classify_web("onlyfans.com")
    gamevui = classifier.classify_web("www.GameVui.vn")
    vioedu = classifier.classify_web("vioedu.vn")
    roblox = classifier.classify_web("roblox.com")
    coccoc = classifier.classify_app(
        "coccoc.exe",
        product_name="Cốc Cốc",
        file_description="Trình duyệt Cốc Cốc",
    )
    genshin = classifier.classify_app(
        "genshinimpact.exe",
        product_name="Genshin Impact",
        file_description="Open-World Action RPG Video Game",
    )

    for domain_name, result in (("pornhub.com", pornhub), ("onlyfans.com", onlyfans)):
        if result["label"] is not None or not result["requires_gemini"]:
            raise AssertionError(
                f"Safety regression: {domain_name} resolved locally to {result['label']!r} "
                f"(conf={result['confidence']:.4f}) instead of deferring to Gemini fallback"
            )
        if result["confidence"] >= 0.70:
            raise AssertionError(
                f"Safety regression: {domain_name} confidence {result['confidence']:.4f} >= 0.70"
            )

    if gamevui["label"] != "entertainment" or gamevui["decision_source"] != "exact_lookup":
        raise AssertionError(f"Unexpected exact lookup result for gamevui.vn: {gamevui}")
    if vioedu["label"] != "education" or vioedu["decision_source"] != "trained_model":
        raise AssertionError(f"Unexpected Tier 2 result for vioedu.vn: {vioedu}")
    if roblox["label"] is not None or not roblox["requires_gemini"]:
        raise AssertionError(f"Unexpected Tier 2 result for roblox.com: {roblox}")
    if coccoc["label"] != "browsers" or coccoc["decision_source"] != "exact_lookup":
        raise AssertionError(f"Unexpected exact lookup result for coccoc.exe: {coccoc}")
    if genshin["label"] != "entertainment" or genshin["decision_source"] != "trained_model":
        raise AssertionError(f"Unexpected Tier 2 result for genshinimpact.exe: {genshin}")

    def _compact(res: dict) -> dict:
        return {
            "label": res["label"],
            "candidate_label": res["candidate_label"],
            "confidence": round(float(res["confidence"]), 4),
            "decision_source": res["decision_source"],
            "requires_gemini": bool(res["requires_gemini"]),
        }

    return {
        "frozen_content_classifier_verified": True,
        "service_exe_sha256": _sha256(service_exe),
        "contracts": contracts,
        "record_counts": {
            "app_exact_lookup": classifier.app_lookup["record_count"],
            "web_exact_lookup": classifier.web_lookup["record_count"],
        },
        "asset_sha256": asset_hashes,
        "probes": {
            "pornhub.com": _compact(pornhub),
            "onlyfans.com": _compact(onlyfans),
            "www.GameVui.vn": _compact(gamevui),
            "vioedu.vn": _compact(vioedu),
            "roblox.com": _compact(roblox),
            "coccoc.exe": _compact(coccoc),
            "genshinimpact.exe": _compact(genshin),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument(
        "--expected-source-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "ai-training"
        / "artifacts"
        / "content_classification",
    )
    args = parser.parse_args()
    report = verify(args.release_root, args.expected_source_dir)
    (args.release_root / "content-models-capabilities.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
