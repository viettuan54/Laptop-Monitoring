from pathlib import Path


agent_root = Path(SPECPATH).resolve().parent

a = Analysis(
    [str(agent_root / "installer" / "provision_agent.py")],
    pathex=[str(agent_root / "installer")],
    binaries=[],
    datas=[],
    hiddenimports=[],
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
    a.binaries,
    a.datas,
    [],
    name="ChildMonitorProvision",
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
