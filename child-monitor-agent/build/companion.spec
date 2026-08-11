from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs


agent_root = Path(SPECPATH).resolve().parent
companion_root = agent_root / "companion"
mediapipe_datas = collect_data_files("mediapipe", include_py_files=False)
mediapipe_binaries = collect_dynamic_libs("mediapipe")

a = Analysis(
    [str(companion_root / "main_companion.py")],
    pathex=[str(companion_root)],
    binaries=mediapipe_binaries,
    datas=mediapipe_datas,
    hiddenimports=["mediapipe"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["jax", "matplotlib", "PIL", "sounddevice", "tensorflow", "torch"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ChildMonitorCompanion",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ChildMonitorCompanion",
)
