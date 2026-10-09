import base64
import json
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'service'))
sys.path.insert(0, str(ROOT / 'companion'))
from screen_monitor import ScreenMonitor, capture_desktop, check_capture_support
from screenshot_upload import ScreenshotUploader
from enforcement_core import EnforcementCore
from pipe_client import PipeClient
from pipe_server import PipeServer

REVISION = '2026-10-08T00:00:00.000Z'


def policy():
    return {'enabled': True, 'revision': REVISION, 'valid_for_seconds': 180, 'interval_seconds': 300}


def record():
    fixtures = ROOT.parent / 'child-monitor-backend' / 'test' / 'fixtures'
    return {'client_record_id': str(uuid.uuid4()), 'captured_at': datetime.now(timezone.utc).isoformat(),
            'policy_revision': REVISION,
            'image_base64': base64.b64encode((fixtures / 'screenshot.jpg').read_bytes()).decode(),
            'thumbnail_base64': base64.b64encode((fixtures / 'screenshot-thumb.jpg').read_bytes()).decode()}


class ScreenMonitorTest(unittest.TestCase):
    def setUp(self):
        self.pipe = Mock()
        self.pipe.send_ping.return_value = {'screenshot_config': policy()}
        self.pipe.send_screenshot.return_value = {'screenshot_queued': True, 'screenshot_config': policy()}
        self.notice = Mock()
        self.capture = Mock(return_value={'image_base64': 'image', 'thumbnail_base64': 'thumb'})
        self.monitor = ScreenMonitor(self.pipe, self.notice, self.capture, available=lambda: True)

    def test_disabled_missing_expired_policy_and_locked_desktop_never_capture(self):
        for response in (None, {}, {'screenshot_config': {'enabled': False}},
                         {'screenshot_config': {**policy(), 'valid_for_seconds': 0}}):
            self.pipe.send_ping.return_value = response
            self.assertFalse(self.monitor.step())
        self.pipe.send_ping.return_value = {'screenshot_config': policy()}
        self.monitor.available = lambda: False
        self.assertFalse(self.monitor.step())
        self.notice.assert_not_called()
        self.capture.assert_not_called()

    def test_notice_precedes_capture_and_cadence_is_five_minutes(self):
        calls = []
        self.notice.side_effect = lambda: calls.append('notice')
        self.capture.side_effect = lambda: calls.append('capture') or {'image_base64': 'x', 'thumbnail_base64': 'y'}
        with patch('screen_monitor.time.monotonic', return_value=1000):
            self.assertTrue(self.monitor.step())
        with patch('screen_monitor.time.monotonic', return_value=1299):
            self.assertFalse(self.monitor.step())
        with patch('screen_monitor.time.monotonic', return_value=1300):
            self.assertTrue(self.monitor.step())
        self.assertEqual(calls, ['notice', 'capture', 'notice', 'capture'])
        uploaded = self.pipe.send_screenshot.call_args.args[0]
        self.assertEqual(uploaded['policy_revision'], REVISION)
        self.assertIsNotNone(datetime.fromisoformat(uploaded['captured_at']).tzinfo)

    def test_revoked_during_notice_or_capture_discards_image(self):
        self.notice.side_effect = lambda: self.monitor.update_config({'screenshot_config': {'enabled': False}})
        self.assertFalse(self.monitor.step())
        self.capture.assert_not_called()
        self.notice.side_effect = None
        self.monitor.last_capture = None
        self.capture.side_effect = lambda: self.monitor.update_config({'screenshot_config': {'enabled': False}}) or {'image_base64': 'x'}
        self.assertFalse(self.monitor.step())
        self.pipe.send_screenshot.assert_not_called()

    def test_manual_request_captures_once_without_waiting_five_minutes(self):
        self.assertTrue(self.monitor.step())
        request = {'id': str(uuid.uuid4()), 'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=3)).isoformat()}
        self.pipe.send_ping.return_value = {'screenshot_config': {**policy(), 'request': request}}
        self.assertTrue(self.monitor.step())
        self.assertEqual(self.pipe.send_screenshot.call_args.args[0]['client_record_id'], request['id'])
        self.assertFalse(self.monitor.step())
        self.assertEqual(self.capture.call_count, 2)
        # A locked session leaves a new command pending until it can be captured.
        request = {'id': str(uuid.uuid4()), 'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat()}
        self.pipe.send_ping.return_value = {'screenshot_config': {**policy(), 'request': request}}
        self.monitor.available = lambda: False
        self.assertFalse(self.monitor.step())
        self.monitor.available = lambda: True
        self.assertTrue(self.monitor.step())

    def test_expired_manual_request_cannot_bypass_periodic_interval(self):
        self.assertTrue(self.monitor.step())
        request = {'id': str(uuid.uuid4()), 'expires_at': (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}
        self.pipe.send_ping.return_value = {'screenshot_config': {**policy(), 'request': request}}
        self.assertFalse(self.monitor.step())

    def test_transient_pipe_failure_keeps_only_the_existing_unexpired_lease(self):
        with patch('screen_monitor.time.monotonic', return_value=1000):
            self.monitor.update_config({'screenshot_config': policy()})
        with patch('screen_monitor.time.monotonic', return_value=1100):
            self.monitor.update_config(None)
            self.assertTrue(self.monitor._allowed())
        with patch('screen_monitor.time.monotonic', return_value=1181):
            self.assertFalse(self.monitor._allowed())
        self.monitor.update_config({'screenshot_config': {'enabled': False}})
        self.assertFalse(self.monitor._allowed())

    def test_busy_pipe_retries_same_image_without_recapturing_and_drops_revoked_bytes(self):
        self.pipe.send_screenshot.side_effect = [None, {'screenshot_queued': True, 'screenshot_config': policy()}]
        with patch('screen_monitor.time.monotonic', return_value=1000):
            self.assertFalse(self.monitor.step())
        first = self.pipe.send_screenshot.call_args.args[0]
        with patch('screen_monitor.time.monotonic', return_value=1001):
            self.assertFalse(self.monitor.step())
        self.assertEqual(self.pipe.send_screenshot.call_count, 1)
        with patch('screen_monitor.time.monotonic', return_value=1005):
            self.assertTrue(self.monitor.step())
        self.assertEqual(self.pipe.send_screenshot.call_args.args[0], first)
        self.capture.assert_called_once()
        self.notice.assert_called_once()
        self.assertIsNone(self.monitor.pending_record)
        self.pipe.send_screenshot.side_effect = None
        self.pipe.send_screenshot.return_value = None
        self.monitor.last_capture = None
        self.assertFalse(self.monitor.step())
        self.assertIsNotNone(self.monitor.pending_record)
        self.pipe.send_ping.return_value = {'screenshot_config': {'enabled': False}}
        self.assertFalse(self.monitor.step())
        self.assertIsNone(self.monitor.pending_record)

    def test_gdi_capture_encodes_valid_jpegs_and_releases_owned_resources(self):
        import cv2
        import numpy as np
        import screen_monitor
        import win32gui
        # Exercise real native handles/JPEGs without MFC or any desktop pixels.
        def paint(memory, x, y, width, height, source, sx, sy, flags):
            brush = win32gui.CreateSolidBrush(0x787878)
            try:
                win32gui.FillRect(memory, (0, 0, width, height), brush)
            finally:
                win32gui.DeleteObject(brush)

        with patch.object(screen_monitor, 'desktop_available', return_value=True), \
             patch.object(screen_monitor.ctypes.windll.user32, 'GetSystemMetrics', side_effect=[800, 600]), \
             patch.dict(sys.modules, {'win32ui': None}), \
             patch.object(win32gui, 'BitBlt', side_effect=paint), \
             patch.object(win32gui, 'CreateCompatibleBitmap', wraps=win32gui.CreateCompatibleBitmap) as create_bitmap, \
             patch.object(win32gui, 'DeleteDC', wraps=win32gui.DeleteDC) as delete_dc, \
             patch.object(win32gui, 'DeleteObject', wraps=win32gui.DeleteObject) as delete_object:
            result = capture_desktop()
        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(result['image_base64']), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape, (600, 800, 3))
        self.assertTrue(np.all(np.abs(decoded.astype(int) - 120) <= 2))
        self.assertEqual(delete_dc.call_count, 2)
        self.assertEqual(create_bitmap.call_count, 1)
        self.assertEqual(delete_object.call_count, 2)  # paint brush and bitmap
        self.assertLessEqual(len(base64.b64decode(result['thumbnail_base64'])), 40 * 1024)

    def test_frozen_capture_self_test_uses_offscreen_colors_without_mfc(self):
        import cv2  # Load native extensions before patch.dict restores sys.modules.
        import win32gui
        with patch.dict(sys.modules, {'win32ui': None}), \
             patch.object(win32gui, 'BitBlt') as read_desktop:
            result = check_capture_support()
        read_desktop.assert_not_called()
        self.assertTrue(base64.b64decode(result['image_base64']).startswith(b'\xff\xd8'))

    def test_gdi_failure_releases_handles_and_restores_dpi(self):
        import screen_monitor
        import win32gui
        user32 = screen_monitor.ctypes.windll.user32
        for failure in ('blit', 'read'):
            with self.subTest(failure=failure), \
                 patch.object(screen_monitor, 'desktop_available', return_value=True), \
                 patch.object(user32, 'GetSystemMetrics', side_effect=[64, 48]), \
                 patch.object(user32, 'SetThreadDpiAwarenessContext', return_value=123) as dpi, \
                 patch.object(win32gui, 'BitBlt', side_effect=OSError('blit failed') if failure == 'blit' else None), \
                 patch.object(screen_monitor.ctypes.windll.gdi32, 'GetDIBits', return_value=0), \
                 patch.object(win32gui, 'DeleteDC', wraps=win32gui.DeleteDC) as delete_dc, \
                 patch.object(win32gui, 'DeleteObject', wraps=win32gui.DeleteObject) as delete_object:
                with self.assertRaises(OSError):
                    capture_desktop()
                self.assertEqual(delete_dc.call_count, 2)
                delete_object.assert_called_once()
                self.assertEqual(dpi.call_args.args, (123,))


class ScreenshotConsentTest(unittest.TestCase):
    def test_only_current_requested_image_bypasses_upload_cadence(self):
        current = policy()
        uploader = ScreenshotUploader(Mock(), lambda: current)
        self.assertTrue(uploader.enqueue(record()))
        uploader.pending.get_nowait()
        uploader.pending.task_done()
        self.assertFalse(uploader.enqueue(record()))
        requested = record()
        current['request'] = {'id': requested['client_record_id'],
                              'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=3)).isoformat()}
        self.assertTrue(uploader.enqueue(requested))
        uploader.pending.get_nowait()
        uploader.pending.task_done()
        current['request']['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        self.assertFalse(uploader.enqueue(requested))

    def test_service_consent_is_memory_only_expires_and_ignores_old_replies(self):
        with tempfile.TemporaryDirectory() as directory:
            core = EnforcementCore(Mock(), config_dir=directory)
            core.update_hosts_file = Mock()
            self.assertFalse(core.get_screenshot_policy()['enabled'])
            with patch('enforcement_core.time.monotonic', return_value=1000):
                command = {'id': str(uuid.uuid4()), 'expires_at': '2026-10-08T00:03:00Z'}
                core.save_settings_cache({'enable_screenshot_review': True, 'updated_at': REVISION, 'screenshot_request': command})
                self.assertTrue(core.get_screenshot_policy()['enabled'])
                self.assertEqual(core.get_screenshot_policy()['request'], command)
                restarted = EnforcementCore(Mock(), config_dir=directory)
                self.assertFalse(restarted.get_screenshot_policy()['enabled'])
            with patch('enforcement_core.time.monotonic', return_value=1181):
                self.assertFalse(core.get_screenshot_policy()['enabled'])
            core.save_settings_cache({'enable_screenshot_review': False, 'updated_at': '2026-10-08T00:01:00.000Z'})
            core.save_settings_cache({'enable_screenshot_review': True, 'updated_at': REVISION})
            self.assertFalse(core.get_screenshot_policy()['enabled'])

    def test_uploader_bounds_queue_and_rechecks_consent_before_network_retry(self):
        current = policy()
        api = Mock()
        uploader = ScreenshotUploader(api, lambda: current)
        item = record()
        self.assertTrue(uploader.enqueue(item))
        self.assertFalse(uploader.enqueue(record()))
        current = {'enabled': False}
        self.assertFalse(uploader.upload(item))
        api.request.assert_not_called()
        current = policy()
        api.request.return_value = Mock(status_code=201)
        api.request.return_value.json.return_value = {'accepted_client_record_id': item['client_record_id']}
        self.assertTrue(uploader.upload(item))
        before_send = api.request.call_args.kwargs['before_send']
        self.assertTrue(before_send())
        current = {'enabled': False}
        self.assertFalse(before_send())
        uploader.stop()
        self.assertTrue(uploader.pending.empty())

    def test_uploader_rejects_bad_image_stale_record_and_changed_revision(self):
        uploader = ScreenshotUploader(Mock(), policy)
        for change in ({'policy_revision': 'old'}, {'image_base64': 'bad'},
                       {'image_base64': 'A' * 600000}, {'captured_at': '2020-01-01T00:00:00Z'}):
            self.assertFalse(uploader.enqueue({**record(), **change}))


class ScreenshotPipeTest(unittest.TestCase):
    def test_large_message_is_reassembled_and_size_is_bounded(self):
        server = PipeServer(Mock(), Mock())
        server.running = True
        payload = json.dumps({'action': 'SCREENSHOT', 'record': record()})
        payload = payload + ' ' * 80000
        chunks = [payload[:65536].encode(), payload[65536:].encode()]
        def finish(message, handle):
            self.assertEqual(json.loads(message)['action'], 'SCREENSHOT')
            server.running = False
        with patch('pipe_server.win32file.ReadFile', side_effect=[(234, chunks[0]), (0, chunks[1])]), \
             patch('pipe_server.win32file.CloseHandle'), patch.object(server, '_process_client_message', side_effect=finish):
            server._handle_client(123)
        server.running = True
        with patch('pipe_server.win32file.ReadFile', return_value=(234, b'x' * 65536)), \
             patch('pipe_server.win32file.CloseHandle'), patch.object(server, '_process_client_message') as process:
            server._handle_client(123)
        process.assert_not_called()

    def test_client_closes_handle_when_write_fails(self):
        with patch('pipe_client.win32file.CreateFile', return_value=123), \
             patch('pipe_client.win32file.WriteFile', side_effect=ValueError()), \
             patch('pipe_client.win32file.CloseHandle') as close:
            self.assertIsNone(PipeClient().send_screenshot(record()))
        self.assertEqual(close.call_count, 3)
        self.assertTrue(all(call.args == (123,) for call in close.call_args_list))


if __name__ == '__main__':
    unittest.main()
