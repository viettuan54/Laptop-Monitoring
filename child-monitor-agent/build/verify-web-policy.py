"""Verify web enforcement wiring in a frozen release without executing binaries."""
import argparse
import base64
import hashlib
import json
import marshal
from pathlib import Path
from PyInstaller.archive.readers import CArchiveReader


def symbols(code):
    import types
    result = set(code.co_names) | {code.co_name}
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            result.update(symbols(value))
        elif isinstance(value, str):
            result.add(value)
    return result


def verify(root):
    service = CArchiveReader(str(root / 'service/ChildMonitorService.exe')).open_embedded_archive('PYZ.pyz')
    assert {'get_browser_web_policy', 'reconcile_web_policy'} <= symbols(service.extract('enforcement_core'))
    assert 'GET_BROWSER_WEB_POLICY' in symbols(service.extract('pipe_server'))
    host = CArchiveReader(str(root / 'browser-host/SafeNestBrowserHost.exe'))
    native_symbols = symbols(marshal.loads(host.extract('browser_native_host')))
    assert {'read_message', 'write_message', 'watch', 'register_host'} <= native_symbols
    client = host.open_embedded_archive('PYZ.pyz').extract('pipe_client')
    assert 'get_browser_web_policy' in symbols(client)
    manifest = json.loads((root / 'browser-extension/manifest.json').read_text(encoding='utf-8'))
    digest = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    extension_id = ''.join(chr(ord('a') + int(char, 16)) for char in digest)
    assert f'chrome-extension://{extension_id}/' in native_symbols
    assert {'nativeMessaging', 'declarativeNetRequest', 'tabs', 'webNavigation'} <= set(manifest['permissions'])
    source = Path(__file__).resolve().parent.parent / 'browser-extension'
    assets = {}
    for item in source.iterdir():
        if item.is_file():
            packaged = root / 'browser-extension' / item.name
            assert packaged.read_bytes() == item.read_bytes(), f'Stale asset: {item.name}'
            assets[item.name] = hashlib.sha256(item.read_bytes()).hexdigest()
    return {'extension_id': extension_id, 'frozen_web_policy_verified': True,
            'installed_browser_tested': False, 'assets': assets}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-root', type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.release_root)
    (args.release_root / 'web-policy-capabilities.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
