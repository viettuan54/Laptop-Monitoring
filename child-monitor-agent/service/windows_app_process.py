"""Verified, handle-based operations confined to the monitored interactive user."""

import ctypes
from ctypes import wintypes
import os
import sys
import functools
import pywintypes

import win32api
import win32con
import win32event
import win32process
import win32security
import win32ts

from content_classifier import normalize_app_metadata
from runtime_paths import agent_root


PROTECTED_APPS = frozenset({
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
    "services.exe", "lsass.exe", "svchost.exe", "dwm.exe", "explorer.exe",
    "sihost.exe", "taskhostw.exe", "conhost.exe", "fontdrvhost.exe", "ctfmon.exe",
    "lockapp.exe", "logonui.exe", "taskmgr.exe", "msmpeng.exe",
    "childmonitorservice.exe", "childmonitorcompanion.exe",
})


def windows_errors(function):
    @functools.wraps(function)
    def call(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except pywintypes.error as error:
            raise OSError(str(error)) from None
    return call


def executable_is_protected(path):
    path = os.path.normcase(os.path.abspath(path))
    roots = (os.environ.get("WINDIR", r"C:\Windows"), agent_root())
    return (os.path.basename(path).casefold() in PROTECTED_APPS
            or path == os.path.normcase(os.path.abspath(sys.executable))
            or any(os.path.commonpath([path, os.path.abspath(root)]).casefold()
                   == os.path.abspath(root).casefold() for root in roots
                   if os.path.splitdrive(path)[0].casefold() == os.path.splitdrive(root)[0].casefold()))


class WindowsAppProcesses:
    def __init__(self, user_sid_provider):
        self.user_sid_provider = user_sid_provider
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.ProcessIdToSessionId.argtypes = [wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.ProcessIdToSessionId.restype = wintypes.BOOL
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel.IsProcessCritical.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        self.kernel.IsProcessCritical.restype = wintypes.BOOL
        self.kernel.GetNamedPipeClientProcessId.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.ULONG)]
        self.kernel.GetNamedPipeClientProcessId.restype = wintypes.BOOL

    @windows_errors
    def context(self):
        sid = self.user_sid_provider()
        if sid is None:
            return None
        return (win32security.ConvertSidToStringSid(sid), win32ts.WTSGetActiveConsoleSessionId())

    def _owner(self, handle, pid):
        session = wintypes.DWORD()
        if not self.kernel.ProcessIdToSessionId(pid, ctypes.byref(session)):
            raise ctypes.WinError(ctypes.get_last_error())
        token = win32security.OpenProcessToken(handle, win32con.TOKEN_QUERY)
        try:
            sid = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
            return win32security.ConvertSidToStringSid(sid), session.value
        finally:
            token.Close()

    def client_allowed(self, pipe_handle):
        pid = wintypes.ULONG()
        if not self.kernel.GetNamedPipeClientProcessId(int(pipe_handle), ctypes.byref(pid)):
            return False
        handle = None
        try:
            handle = win32api.OpenProcess(0x1000, False, pid.value)
            return self.context() is not None and self._owner(handle, pid.value) == self.context()
        except (OSError, pywintypes.error):
            return False
        finally:
            if handle:
                handle.Close()

    @windows_errors
    def open(self, pid, created_at):
        handle = win32api.OpenProcess(0x1000 | win32con.SYNCHRONIZE | win32con.PROCESS_TERMINATE, False, pid)
        try:
            context = self.context()
            if context is None or self._owner(handle, pid) != context:
                return None
            created = win32process.GetProcessTimes(handle)["CreationTime"].timestamp()
            if abs(created - created_at) > 0.001:
                return None
            buffer = ctypes.create_unicode_buffer(32768)
            size = wintypes.DWORD(len(buffer))
            if not self.kernel.QueryFullProcessImageNameW(int(handle), 0, buffer, ctypes.byref(size)):
                return None
            path = buffer.value
            critical = wintypes.BOOL()
            if (executable_is_protected(path)
                    or not self.kernel.IsProcessCritical(int(handle), ctypes.byref(critical))
                    or critical.value):
                return None
            if win32event.WaitForSingleObject(handle, 0) != win32con.WAIT_TIMEOUT:
                return None
            metadata = {}
            try:
                pairs = win32api.GetFileVersionInfo(path, r"\VarFileInfo\Translation") or [(0x409, 0x4B0)]
                for field, key in (("ProductName", "product_name"), ("FileDescription", "file_description")):
                    for language, codepage in pairs:
                        try:
                            value = win32api.GetFileVersionInfo(path, rf"\StringFileInfo\{language:04X}{codepage:04X}\{field}")
                            value = normalize_app_metadata(value)
                            if value:
                                metadata[key] = value
                                break
                        except (OSError, ValueError, pywintypes.error):
                            continue
            except (OSError, pywintypes.error):
                pass
            target = WindowsAppTarget(self, handle, context, os.path.basename(path), metadata)
            handle = None
            return target
        finally:
            if handle:
                handle.Close()


class WindowsAppTarget:
    def __init__(self, owner, handle, context, app_name, metadata):
        self.owner, self.handle, self.context = owner, handle, context
        self.app_name = app_name
        self.product_name = metadata.get("product_name")
        self.file_description = metadata.get("file_description")

    @windows_errors
    def alive(self):
        return win32event.WaitForSingleObject(self.handle, 0) == win32con.WAIT_TIMEOUT

    def context_valid(self):
        return self.owner.context() == self.context

    @windows_errors
    def terminate(self):
        if not self.context_valid():
            raise OSError("Session changed")
        win32api.TerminateProcess(self.handle, 1)

    def close(self):
        if self.handle:
            self.handle.Close()
            self.handle = None
