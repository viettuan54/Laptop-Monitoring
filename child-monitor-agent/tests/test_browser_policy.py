import io
import json
import os
import struct
import sys
import tempfile
import threading
import uuid
import unittest
from unittest.mock import Mock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'companion'))
sys.path.insert(0, os.path.join(ROOT, 'service'))
from enforcement_core import EnforcementCore
from browser_native_host import read_message, write_message, watch
from pipe_server import PipeServer
from pipe_client import PipeClient
import win32file
import win32pipe


class BrowserPolicyTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.core = EnforcementCore(object(), config_dir=self.directory.name)
        self.core.hosts_path = os.path.join(self.directory.name, 'hosts')
        with open(self.core.hosts_path, 'w') as stream:
            stream.write('127.0.0.1 localhost\n')

    def tearDown(self):
        self.directory.cleanup()

    def test_repeated_category_and_switch_round_trips_with_real_hosts(self):
        with patch('enforcement_core.os.system', return_value=0):
            self.core.remember_web_classification('gamevui.vn', 'entertainment')
            for mode in ('category', 'switch'):
                for enabled in (True, False, True, False, True):
                    self.core.save_settings_cache({
                        'enable_web_classification': enabled if mode == 'switch' else True,
                        'blocked_web_categories': ['entertainment'] if enabled or mode == 'switch' else [],
                    }, ['always.test'], [])
                    policy = self.core.get_browser_web_policy()
                    self.assertEqual('gamevui.vn' in policy['blocked_domains'], enabled)
                    self.assertIn('always.test', policy['blocked_domains'])
                    with open(self.core.hosts_path) as stream:
                        self.assertEqual('127.0.0.2 gamevui.vn' in stream.read(), enabled)

    def test_failed_write_is_retried_on_identical_heartbeat(self):
        config = {'enable_web_classification': True, 'blocked_web_categories': ['entertainment']}
        with patch.object(self.core, 'update_hosts_file', side_effect=[False, True]) as update:
            for _ in range(3):
                self.core.save_settings_cache(config, [], ['gamevui.vn'])
            self.assertEqual(update.call_count, 2)

    def test_failed_startup_clear_is_retried(self):
        with patch.object(self.core, 'update_hosts_file', side_effect=[False, True]) as update:
            self.core.apply_cached_web_policy()
            self.core.save_settings_cache({'enable_web_classification': False}, [], [])
            self.assertEqual(update.call_count, 2)

    def test_stale_worker_reconciles_latest_snapshot(self):
        self.core.update_hosts_file = Mock(return_value=True)
        self.core.save_settings_cache({'enable_web_classification': True}, [], ['gamevui.vn'])
        self.core.save_settings_cache({'enable_web_classification': False}, [], [])
        self.core.reconcile_web_policy()
        self.assertEqual(self.core.update_hosts_file.call_args.args, ([],))

    def test_pipe_snapshot_is_read_only_and_requires_current_session(self):
        server = PipeServer(Mock(), self.core)
        server.app_processes = Mock()
        for allowed in (True, False):
            server.app_processes.client_allowed.return_value = allowed
            with patch('pipe_server.win32file.WriteFile') as write:
                if allowed:
                    server._process_client_message('{"action":"GET_BROWSER_WEB_POLICY"}', 42)
                    self.assertEqual(set(json.loads(write.call_args.args[1])), {'web_policy'})
                else:
                    with self.assertRaises(ValueError):
                        server._process_client_message('{"action":"GET_BROWSER_WEB_POLICY"}', 42)
                    self.assertNotIn('web_policy', json.loads(write.call_args.args[1]))


class NativeFramingTest(unittest.TestCase):
    def test_large_snapshot_over_real_windows_named_pipe(self):
        name = r'\\.\pipe\SafeNestPolicyTest-' + uuid.uuid4().hex
        handle = win32pipe.CreateNamedPipe(name, win32pipe.PIPE_ACCESS_DUPLEX,
            win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
            1, 65536, 65536, 0, None)
        response = {'web_policy': {'version': 1, 'revision': 'large',
            'blocked_domains': [f'website-{i}.example' for i in range(5000)]}}
        errors = []
        def server():
            try:
                win32pipe.ConnectNamedPipe(handle, None)
                _, request = win32file.ReadFile(handle, 65536)
                self.assertEqual(json.loads(request), {'action': 'GET_BROWSER_WEB_POLICY'})
                win32file.WriteFile(handle, json.dumps(response).encode())
                win32file.FlushFileBuffers(handle)
            except Exception as error:
                errors.append(error)
            finally:
                win32file.CloseHandle(handle)
        worker = threading.Thread(target=server, daemon=True)
        worker.start()
        client = PipeClient()
        client.PIPE_NAME = name
        self.assertEqual(client.get_browser_web_policy(), response)
        worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])

    def test_frame_and_truncated_inputs(self):
        stream = io.BytesIO()
        write_message(stream, {'action': 'watch'})
        stream.seek(0)
        self.assertEqual(read_message(stream), {'action': 'watch'})
        for raw in (b'\x01', struct.pack('<I', 5) + b'{}', struct.pack('<I', 1025)):
            with self.assertRaises(ValueError):
                read_message(io.BytesIO(raw))

    def test_unavailable_service_does_not_send_an_empty_policy(self):
        client = Mock()
        client.get_browser_web_policy.return_value = None
        output = io.BytesIO()
        with self.assertRaises(InterruptedError):
            watch(client, output, sleep=Mock(side_effect=InterruptedError))
        output.seek(0)
        self.assertEqual(read_message(output), {'error': 'agent_unavailable'})

    def test_response_size_is_bounded(self):
        with self.assertRaises(ValueError):
            write_message(io.BytesIO(), {'data': 'a' * 900000})


if __name__ == '__main__':
    unittest.main()
