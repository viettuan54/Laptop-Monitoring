"""A native, non-modal Windows reminder using the Agent's existing pywin32."""
import threading
import time
import logging
import ctypes
from ctypes import wintypes
import win32api
import win32con
import win32gui


def dialog_template(reminder):
    style = win32con.WS_POPUP | win32con.WS_CAPTION | win32con.WS_SYSMENU | win32con.DS_SETFONT
    child = win32con.WS_CHILD | win32con.WS_VISIBLE
    text = (f"Bạn đã sử dụng máy khoảng {reminder['interval_minutes']} phút. "
            f"Hãy nghỉ {reminder['duration_minutes']} phút trước khi tiếp tục.\n\n"
            "Bạn có thể lưu công việc trước khi nghỉ. Máy và ứng dụng vẫn mở.")
    return [
        ['LaptopChildren · Nghỉ giải lao', (0, 0, 282, 128), style, None, (10, 'Segoe UI')],
        [130, 'Đến lúc nghỉ một chút', -1, (14, 12, 254, 16), child | win32con.SS_LEFT],
        [130, text, -1, (14, 33, 254, 57), child | win32con.SS_LEFT],
        [128, 'Nghỉ ngay', 1, (14, 100, 88, 20), child | win32con.WS_TABSTOP | win32con.BS_DEFPUSHBUTTON],
        [128, 'Nhắc lại sau 5 phút', 2, (112, 100, 156, 20), child | win32con.WS_TABSTOP | win32con.BS_PUSHBUTTON],
    ]


def check_break_notice_support():
    """Build and destroy a hidden native dialog during release self-test."""
    handle = win32gui.CreateDialogIndirect(win32api.GetModuleHandle(None),
        dialog_template({'interval_minutes': 30, 'duration_minutes': 5}), 0, {})
    try:
        if not win32gui.GetDlgItem(handle, 1) or not win32gui.GetDlgItem(handle, 2):
            raise RuntimeError('Break reminder buttons are missing')
    finally:
        win32gui.DestroyWindow(handle)


def show_break_notice(reminder, on_event, cancel_event):
    def show():
        try:
            if cancel_event.is_set():
                return
            user32 = ctypes.windll.user32
            user32.SetTimer.argtypes = [wintypes.HWND, ctypes.c_size_t, wintypes.UINT, ctypes.c_void_p]
            user32.SetTimer.restype = ctypes.c_size_t
            shown = False
            deadline = time.monotonic() + 120
            def respond(hwnd, event):
                if not cancel_event.is_set():
                    on_event(event)
                win32gui.EndDialog(hwnd, 0)
            def command(hwnd, message, wparam, lparam):
                control = win32api.LOWORD(wparam)
                if control in (1, 2):
                    respond(hwnd, 'acknowledged' if control == 1 else 'snoozed')
                return 1
            def initialize(hwnd, *args):
                left, top, right, bottom = win32gui.GetWindowRect(hwnd)
                width, height = right - left, bottom - top
                win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST,
                    max(0, win32api.GetSystemMetrics(0) - width - 24),
                    max(0, win32api.GetSystemMetrics(1) - height - 64), width, height, win32con.SWP_NOACTIVATE)
                if not user32.SetTimer(hwnd, 1, 100, None):
                    win32gui.EndDialog(hwnd, 0)
                    raise ctypes.WinError()
                return 1
            def timer(hwnd, *args):
                nonlocal shown
                if cancel_event.is_set():
                    win32gui.EndDialog(hwnd, 0)
                elif time.monotonic() >= deadline:
                    respond(hwnd, 'snoozed')
                elif not shown and win32gui.IsWindowVisible(hwnd):
                    win32gui.UpdateWindow(hwnd)
                    on_event('shown')
                    shown = True
                return 1
            callbacks = {win32con.WM_INITDIALOG: initialize,
                         win32con.WM_TIMER: timer,
                         win32con.WM_COMMAND: command,
                         win32con.WM_CLOSE: lambda hwnd, *args: respond(hwnd, 'snoozed')}
            # Native dialog processing provides Tab/Enter/Escape and accessibility.
            # It blocks only this worker; it has no owner and cannot disable apps.
            win32gui.DialogBoxIndirect(win32api.GetModuleHandle(None), dialog_template(reminder), 0, callbacks)
        except Exception:
            logging.exception('Could not display break reminder')
    worker = threading.Thread(target=show, daemon=True, name='BreakReminderNotice')
    worker.start()
    return worker
