"""Exercise Windows process handles against a disposable, hidden test process only."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import psutil
import win32api
import win32con
import win32security

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'service'))
from windows_app_process import WindowsAppProcesses, executable_is_protected


class WindowsAppProcessTest(unittest.TestCase):
    def test_windows_and_agent_executables_are_protected(self):
        self.assertTrue(executable_is_protected(sys.executable))
        self.assertTrue(executable_is_protected(r'C:\Windows\System32\notepad.exe'))
        self.assertTrue(executable_is_protected(r'C:\Apps\explorer.exe'))
        self.assertFalse(executable_is_protected(r'C:\Apps\example-game.exe'))

    @unittest.skipUnless(shutil.which('node'), 'Node is required for the disposable process fixture')
    def test_verifies_identity_owner_and_exit_with_real_windows_handles(self):
        token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
        try:
            sid = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
        finally:
            token.Close()
        adapter = WindowsAppProcesses(lambda: sid)
        with tempfile.TemporaryDirectory(prefix='agent-enforcement-test-') as folder:
            executable = os.path.join(folder, 'enforcement-fixture.exe')
            shutil.copy2(shutil.which('node'), executable)
            process = subprocess.Popen([executable, '-e', 'setInterval(()=>{},1000)'],
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            target = None
            try:
                created = psutil.Process(process.pid).create_time()
                self.assertIsNone(adapter.open(process.pid, created + 1))
                foreign = WindowsAppProcesses(lambda: win32security.ConvertStringSidToSid('S-1-5-18'))
                if win32security.ConvertSidToStringSid(sid) != 'S-1-5-18':
                    self.assertIsNone(foreign.open(process.pid, created))
                target = adapter.open(process.pid, created)
                self.assertIsNotNone(target, 'Fixture must belong to the monitored console session')
                self.assertEqual(target.app_name, 'enforcement-fixture.exe')
                self.assertTrue(target.alive())
                target.terminate()
                process.wait(timeout=5)
                self.assertFalse(target.alive())
            finally:
                if target is not None:
                    target.close()
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
