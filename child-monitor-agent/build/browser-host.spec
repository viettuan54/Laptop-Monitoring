from pathlib import Path

agent_root = Path(SPECPATH).resolve().parent
a = Analysis([str(agent_root / 'companion' / 'browser_native_host.py')],
             pathex=[str(agent_root / 'companion')], binaries=[], datas=[],
             hiddenimports=['win32timezone'], hookspath=[], hooksconfig={},
             runtime_hooks=[], excludes=['cv2', 'mediapipe', 'numpy', 'tkinter'],
             noarchive=False, optimize=1)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [],
          name='SafeNestBrowserHost', debug=False, strip=False, upx=False, console=True)
