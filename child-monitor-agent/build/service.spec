from pathlib import Path


agent_root = Path(SPECPATH).resolve().parent
service_root = agent_root / "service"

a = Analysis(
    [str(service_root / "main_service.py")],
    pathex=[str(service_root)],
    binaries=[],
    datas=[],
    hiddenimports=["win32timezone"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["cv2", "matplotlib", "mediapipe", "numpy", "tkinter"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ChildMonitorService",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
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
    name="ChildMonitorService",
)
