import logging
import os
import subprocess
import sys
import threading
import time

import win32api
import win32con
import win32event
import win32process
import win32profile
import win32security
import win32ts

from runtime_paths import agent_root


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# WM_WTSSESSION_CHANGE event values from the Windows SDK.  pywin32 does not
# expose these constants consistently across versions.
WTS_CONSOLE_CONNECT = 0x1
WTS_CONSOLE_DISCONNECT = 0x2
WTS_REMOTE_CONNECT = 0x3
WTS_REMOTE_DISCONNECT = 0x4
WTS_SESSION_LOGON = 0x5
WTS_SESSION_LOGOFF = 0x6
WTS_SESSION_LOCK = 0x7
WTS_SESSION_UNLOCK = 0x8

ACTIVE_SESSION_EVENTS = frozenset({
    WTS_CONSOLE_CONNECT,
    WTS_REMOTE_CONNECT,
    WTS_SESSION_LOGON,
    WTS_SESSION_UNLOCK,
})
INACTIVE_SESSION_EVENTS = frozenset({
    WTS_CONSOLE_DISCONNECT,
    WTS_REMOTE_DISCONNECT,
    WTS_SESSION_LOGOFF,
    WTS_SESSION_LOCK,
})


class Watchdog:
    """Keep the interactive Companion alive in the active Windows session."""

    def __init__(self, pipe_server=None):
        self.pipe_server = pipe_server
        self.running = False
        self.companion_process_handle = None
        self.monitor_thread = None
        self.process_lock = threading.Lock()
        self.session_available = threading.Event()

    @staticmethod
    def resolve_companion_command():
        """Resolve a packaged Companion, with a source/venv development fallback."""
        root_dir = agent_root()
        companion_dir = os.path.join(root_dir, "companion")
        companion_exe = os.path.join(companion_dir, "ChildMonitorCompanion.exe")
        if os.path.isfile(companion_exe):
            return companion_exe, subprocess.list2cmdline([companion_exe]), companion_dir

        companion_script = os.path.join(companion_dir, "main_companion.py")
        if not os.path.isfile(companion_script):
            raise FileNotFoundError(
                "Companion executable/script was not found under " + companion_dir
            )
        if getattr(sys, "frozen", False):
            raise FileNotFoundError(
                "ChildMonitorCompanion.exe is required by the packaged Service"
            )

        pythonw_exe = os.path.join(root_dir, "venv", "Scripts", "pythonw.exe")
        if not os.path.isfile(pythonw_exe):
            current_pythonw = os.path.join(
                os.path.dirname(sys.executable),
                "pythonw.exe",
            )
            pythonw_exe = (
                current_pythonw if os.path.isfile(current_pythonw) else sys.executable
            )
        return (
            pythonw_exe,
            subprocess.list2cmdline([pythonw_exe, companion_script]),
            companion_dir,
        )

    def get_active_session_user_sid(self, session_id):
        """Return the active user's token and SID for a Windows session."""
        try:
            user_token = win32ts.WTSQueryUserToken(session_id)
            token_user = win32security.GetTokenInformation(
                user_token,
                win32security.TokenUser,
            )
            return user_token, token_user[0]
        except Exception as error:
            logging.warning(
                "Could not query user token for Session %s: %s",
                session_id,
                error,
            )
            return None, None

    def prepare_pipe_for_active_session(self):
        """Prime the first Pipe DACL before its blocking listener is started."""
        session_id = win32ts.WTSGetActiveConsoleSessionId()
        if session_id == 0xFFFFFFFF or session_id == 0:
            self.session_available.clear()
            logging.info("No active console user session available for initial Pipe DACL.")
            return False

        # Let the watchdog retry token acquisition if Windows is still completing
        # an otherwise valid interactive logon.
        self.session_available.set()

        user_token, user_sid = self.get_active_session_user_sid(session_id)
        try:
            if not user_token or not user_sid:
                return False
            if self.pipe_server:
                self.pipe_server.set_user_sid(user_sid)
            logging.info(
                "Prepared Pipe Server DACL for Session %s before listener startup.",
                session_id,
            )
            return True
        finally:
            if user_token:
                try:
                    user_token.Close()
                except Exception:
                    pass

    def spawn_companion_process(self):
        """Launch Companion under the active user's token."""
        if not self.session_available.is_set():
            logging.debug("Companion spawn skipped because the user session is inactive.")
            return False
        user_token = None
        primary_token = None
        thread_handle = None
        try:
            session_id = win32ts.WTSGetActiveConsoleSessionId()
            if session_id == 0xFFFFFFFF or session_id == 0:
                logging.info("No active console user session detected currently.")
                return False

            user_token, user_sid = self.get_active_session_user_sid(session_id)
            if not user_token:
                logging.warning("Unable to obtain User Token for Session %s", session_id)
                return False

            if self.pipe_server:
                self.pipe_server.recreate_pipe(new_user_sid=user_sid)

            application_name, command_line, working_dir = (
                self.resolve_companion_command()
            )
            environment = win32profile.CreateEnvironmentBlock(user_token, False)
            startup_info = win32process.STARTUPINFO()
            startup_info.dwFlags = win32process.STARTF_USESHOWWINDOW
            startup_info.wShowWindow = win32con.SW_HIDE

            primary_token = win32security.DuplicateTokenEx(
                user_token,
                win32security.SecurityImpersonation,
                win32security.TOKEN_ALL_ACCESS,
                win32security.TokenPrimary,
            )
            if not self.session_available.is_set():
                logging.info("Companion spawn cancelled because the session became inactive.")
                return False
            process_handle, thread_handle, process_id, _ = (
                win32process.CreateProcessAsUser(
                    primary_token,
                    application_name,
                    command_line,
                    None,
                    None,
                    False,
                    win32process.CREATE_NO_WINDOW
                    | win32process.CREATE_UNICODE_ENVIRONMENT,
                    environment,
                    working_dir,
                    startup_info,
                )
            )

            with self.process_lock:
                # LOCK may race between the pre-create gate and CreateProcessAsUser.
                # Publish the handle only while the same lock used by termination is
                # held; otherwise terminate the just-created process immediately.
                if not self.session_available.is_set():
                    try:
                        win32api.TerminateProcess(process_handle, 0)
                        win32event.WaitForSingleObject(process_handle, 5000)
                    finally:
                        process_handle.Close()
                        process_handle = None
                    logging.info(
                        "Discarded Companion PID=%s created during session lock.",
                        process_id,
                    )
                    return False
                self._close_process_handle_locked()
                self.companion_process_handle = process_handle
            logging.info(
                "Successfully spawned Companion process PID=%s in Session %s",
                process_id,
                session_id,
            )
            return True
        except Exception as error:
            logging.error(
                "Failed to spawn companion process via CreateProcessAsUser: %s",
                error,
            )
            return False
        finally:
            for handle in (thread_handle, primary_token, user_token):
                if handle:
                    try:
                        handle.Close()
                    except Exception:
                        pass

    def _close_process_handle_locked(self):
        if self.companion_process_handle:
            try:
                self.companion_process_handle.Close()
            except Exception:
                pass
            self.companion_process_handle = None

    def terminate_companion_process(self):
        """Stop the Companion owned by this Service and release its handle."""
        with self.process_lock:
            handle = self.companion_process_handle
            if not handle:
                return
            try:
                if win32process.GetExitCodeProcess(handle) == win32con.STILL_ACTIVE:
                    win32api.TerminateProcess(handle, 0)
                    win32event.WaitForSingleObject(handle, 5000)
            except Exception as error:
                logging.warning("Could not terminate Companion cleanly: %s", error)
            finally:
                self._close_process_handle_locked()

    def on_session_change(self, event, session_id):
        """Refresh Named Pipe access and move Companion to the new session."""
        logging.info(
            "Session change event received: %s for Session ID: %s",
            event,
            session_id,
        )
        if event in INACTIVE_SESSION_EVENTS:
            # A locked/disconnected desktop is not active screen time.  Clear the
            # gate before terminating so the watchdog cannot immediately respawn.
            self.session_available.clear()
            if self.pipe_server:
                self.pipe_server.recreate_pipe(new_user_sid=None)
            self.terminate_companion_process()
            return

        if event not in ACTIVE_SESSION_EVENTS:
            logging.debug("Ignoring unsupported session-change event: %s", event)
            return

        self.session_available.set()
        user_token, user_sid = self.get_active_session_user_sid(session_id)
        try:
            if self.pipe_server and user_sid:
                self.pipe_server.recreate_pipe(new_user_sid=user_sid)
        finally:
            if user_token:
                try:
                    user_token.Close()
                except Exception:
                    pass

        self.terminate_companion_process()
        self.spawn_companion_process()

    def start(self):
        self.running = True
        self.monitor_thread = threading.Thread(
            target=self._watchdog_loop,
            daemon=True,
        )
        self.monitor_thread.start()
        logging.info("Watchdog thread started.")

    def stop(self):
        self.running = False
        self.terminate_companion_process()

    def _watchdog_loop(self):
        while self.running:
            try:
                if not self.session_available.is_set():
                    time.sleep(1)
                    continue
                with self.process_lock:
                    process_handle = self.companion_process_handle
                if not process_handle:
                    self.spawn_companion_process()
                else:
                    exit_code = win32process.GetExitCodeProcess(process_handle)
                    if exit_code != win32con.STILL_ACTIVE:
                        logging.warning(
                            "Companion process terminated with exit code %s. "
                            "Respawning...",
                            exit_code,
                        )
                        with self.process_lock:
                            if self.companion_process_handle == process_handle:
                                self._close_process_handle_locked()
                        self.spawn_companion_process()
            except Exception as error:
                logging.error("Watchdog loop error: %s", error)

            time.sleep(10)
