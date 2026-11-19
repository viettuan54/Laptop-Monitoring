"""Read-only native messaging bridge. No credentials or browsing history leave it."""
import json
import os
import struct
import sys
import time

EXTENSION_ORIGIN = "chrome-extension://ekdafhciefhbphafelindkdobljpkcaf/"
MAX_MESSAGE = 900000
HOST_NAME = "vn.safenest.web_policy"
REGISTRY_BROWSERS = (r"Google\Chrome", r"Chromium", r"Microsoft\Edge", r"CocCoc\Browser")


def register_host(remove=False):
    """Installer-only operation; the browser's normal path remains read-only."""
    import winreg
    if not getattr(sys, "frozen", False):
        raise ValueError("Register the packaged native host executable")
    manifest_path = os.path.join(os.path.dirname(sys.executable), HOST_NAME + ".json")
    if not remove:
        with open(manifest_path, "w", encoding="utf-8") as stream:
            json.dump({"name": HOST_NAME, "description": "SafeNest web policy bridge",
                       "path": sys.executable, "type": "stdio",
                       "allowed_origins": [EXTENSION_ORIGIN]}, stream, indent=2)
    for browser in REGISTRY_BROWSERS:
        path = "SOFTWARE\\" + browser + "\\NativeMessagingHosts\\" + HOST_NAME
        for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
            if remove:
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_READ | view) as key:
                        existing = winreg.QueryValueEx(key, "")[0]
                    if os.path.normcase(existing) == os.path.normcase(manifest_path):
                        winreg.DeleteKeyEx(winreg.HKEY_LOCAL_MACHINE, path, view)
                except FileNotFoundError:
                    pass
            else:
                with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_WRITE | view) as key:
                    winreg.SetValueEx(key, "", 0, winreg.REG_SZ, manifest_path)
    if remove and os.path.isfile(manifest_path):
        os.remove(manifest_path)


def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError("Incomplete message header")
    size = struct.unpack("<I", header)[0]
    if not 0 < size <= 1024:
        raise ValueError("Invalid request size")
    payload = stream.read(size)
    if len(payload) != size:
        raise ValueError("Incomplete message")
    return json.loads(payload)


def write_message(stream, payload):
    data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    if len(data) > MAX_MESSAGE:
        raise ValueError("Response too large")
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


def watch(client, output, sleep=time.sleep):
    while True:
        response = client.get_browser_web_policy()
        if not isinstance(response, dict) or not isinstance(response.get("web_policy"), dict):
            response = {"error": "agent_unavailable"}
        else:
            response = {"web_policy": response["web_policy"]}
        write_message(output, response)
        sleep(2)


def main():
    if sys.argv[1:] in (["--register"], ["--unregister"]):
        register_host(remove=sys.argv[1] == "--unregister")
        return 0
    if len(sys.argv) < 2 or sys.argv[1] != EXTENSION_ORIGIN:
        return 1
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    from pipe_client import PipeClient
    try:
        if read_message(sys.stdin.buffer) != {"action": "watch"}:
            return 1
        watch(PipeClient(), sys.stdout.buffer)
    except (BrokenPipeError, OSError, ValueError):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
