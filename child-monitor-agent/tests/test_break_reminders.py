import json
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, 'service'))
sys.path.insert(0, os.path.join(ROOT, 'companion'))
from offline_queue import OfflineQueue
from break_reminders import BreakReminderEngine
from break_monitor import BreakReminderMonitor


class BreakReminderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.queue = OfflineQueue(os.path.join(self.temp.name, 'queue.db'))
        self.now = 1000000
        self.settings = dict(enable_break_reminders=True, break_interval_minutes=5, break_duration_minutes=2)
        self.engine = self.make_engine()
        self.tick()

    def make_engine(self):
        return BreakReminderEngine(self.queue, clock=lambda: self.now, wall_clock=lambda: self.now)

    def tick(self, seconds=0, idle=0, desktop=True, session='session-1', blocked=False):
        self.now += seconds
        return self.engine.tick(self.settings, idle, desktop, session, blocked)

    def use(self, seconds):
        for _ in range(seconds // 5):
            result = self.tick(5)
        return result

    def records(self):
        with self.queue.get_connection() as conn:
            return [json.loads(row[0]) for row in conn.execute('SELECT payload FROM break_reminder_events')]

    def test_opt_in_and_no_early_or_duplicate_reminder(self):
        self.assertIsNone(self.use(295)['reminder'])
        reminder = self.tick(5)['reminder']
        self.assertEqual(reminder['interval_minutes'], 5)
        self.assertEqual(reminder, self.tick(5)['reminder'])
        self.assertEqual(self.records(), [])  # Due does not mean displayed.
        self.settings['enable_break_reminders'] = False
        self.assertEqual(self.tick(5), {'enabled': False})
        self.settings['enable_break_reminders'] = True
        self.assertIsNone(self.tick(5)['reminder'])

    def test_ten_minutes_reading_without_input_still_reminds(self):
        self.settings['break_interval_minutes'] = 10
        self.tick(idle=3600)
        for elapsed in range(5, 600, 5):
            self.assertIsNone(self.tick(5, idle=3600 + elapsed)['reminder'])
        reminder = self.tick(5, idle=4200)['reminder']
        self.assertEqual(reminder['interval_minutes'], 10)
        self.assertEqual(reminder['duration_minutes'], 2)
        self.assertEqual(self.engine.state['active_seconds'], 600)
        self.assertEqual(self.tick(5, idle=4205)['reminder'], reminder)

    def test_idle_after_typing_keeps_accumulated_time_and_visible_reminder(self):
        self.use(200)
        self.tick(5, idle=65)
        self.assertEqual(self.engine.state['active_seconds'], 205)
        self.tick(5, idle=125)
        self.assertEqual(self.engine.state['active_seconds'], 210)
        reminder = self.use(90)['reminder']
        self.assertEqual(self.tick(5, idle=600)['reminder'], reminder)

    def test_full_break_on_locked_desktop_resets_on_unlock(self):
        self.use(200)
        for _ in range(23):
            self.tick(5, desktop=False)
        self.assertEqual(self.engine.state['active_seconds'], 200)
        self.tick(5, idle=1000)
        self.assertEqual(self.engine.state['active_seconds'], 0)
        self.assertIsNone(self.use(295)['reminder'])
        self.assertIsNotNone(self.tick(5)['reminder'])

    def test_temporary_missing_ticks_do_not_count_unobserved_time(self):
        self.use(200)
        self.tick(20, idle=600)
        self.assertEqual(self.engine.state['active_seconds'], 200)
        self.assertIsNotNone(self.use(100)['reminder'])

    def test_unrelated_settings_refresh_does_not_restart_timer(self):
        self.use(200)
        self.settings.update(updated_at='2026-10-14T07:00:00Z', enable_screenshot_review=True)
        self.assertIsNotNone(self.use(100)['reminder'])

    def test_short_lock_pauses_long_sleep_resets(self):
        self.use(200)
        self.tick(5, desktop=False)
        self.tick(30, desktop=False)
        self.tick(5)
        self.assertEqual(self.engine.state['active_seconds'], 200)
        self.tick(600)
        self.assertEqual(self.engine.state['active_seconds'], 0)

    def test_restart_preserves_observed_time_but_not_unobserved_time(self):
        self.use(200)
        self.engine = self.make_engine()
        self.tick(20)
        self.assertEqual(self.engine.state['active_seconds'], 200)
        self.assertIsNotNone(self.use(100)['reminder'])
        self.engine = self.make_engine()
        self.assertIsNone(self.tick(600)['reminder'])

    def test_policy_and_session_changes_cancel_pending(self):
        pending = self.use(300)['reminder']
        self.settings['break_interval_minutes'] = 10
        self.engine.receipt(self.settings, pending['reminder_id'], 'shown')
        self.assertEqual(self.records(), [])
        self.assertIsNone(self.tick(5)['reminder'])
        self.use(100)
        self.tick(5, session='session-2')
        self.assertEqual(self.engine.state['active_seconds'], 0)

    def test_snooze_and_acknowledgement_do_not_claim_rest(self):
        pending = self.use(300)['reminder']
        for _ in range(2):
            self.engine.receipt(self.settings, pending['reminder_id'], 'shown')
        self.engine.receipt(self.settings, pending['reminder_id'], 'snoozed')
        self.assertEqual([r['event_type'] for r in self.records()], ['shown', 'snoozed'])
        self.assertIsNone(self.use(295)['reminder'])
        pending = self.tick(5)['reminder']
        self.engine.receipt(self.settings, pending['reminder_id'], 'acknowledged')
        self.assertEqual(self.engine.state['active_seconds'], 300)
        self.assertIsNone(self.use(115)['reminder'])
        self.assertIsNotNone(self.tick(5)['reminder'])

    def test_locked_policy_never_displays_reminder(self):
        self.use(295)
        self.assertIsNone(self.tick(5, blocked=True)['reminder'])

    def test_invalid_samples_and_missing_old_server_config_fail_closed(self):
        for idle in [float('nan'), float('inf'), -1, True, '0']:
            with self.assertRaises(ValueError):
                self.tick(idle=idle)
        self.assertEqual(self.engine.tick({}, 0, True, 'session-1'), {'enabled': False})
        for bad in [None, 0, 181, '30', True]:
            self.settings['break_interval_minutes'] = bad
            self.assertEqual(self.tick(5), {'enabled': False})

    def test_offline_sync_keeps_unacknowledged_and_retries_stable_id(self):
        pending = self.use(300)['reminder']
        self.engine.receipt(self.settings, pending['reminder_id'], 'shown')
        api = Mock()
        api.post.return_value = None
        self.queue._sync_break_reminders(api)
        row = self.records()[0]
        api.post.return_value = Mock(status_code=201)
        api.post.return_value.json.return_value = {'accepted_client_record_ids': ['unknown']}
        self.queue._sync_break_reminders(api)
        api.post.return_value.json.return_value = {'accepted_client_record_ids': [row['client_record_id']]}
        self.queue._sync_break_reminders(api)
        with self.queue.get_connection() as conn:
            self.assertEqual(conn.execute('SELECT synced FROM break_reminder_events').fetchone()[0], 1)
        self.assertTrue(all(call.kwargs['data']['records'][0]['client_record_id'] == row['client_record_id'] for call in api.post.call_args_list))


class BreakMonitorTest(unittest.TestCase):
    def setUp(self):
        self.pipe = Mock()
        self.notice = Mock()
        self.monitor = BreakReminderMonitor(self.pipe, self.notice, lambda: 0, lambda: True)
        self.reminder = dict(reminder_id='r1', interval_minutes=30, duration_minutes=5)
        self.pipe.send_break_tick.return_value = {'break_reminder': {'enabled': True, 'reminder': self.reminder}}

    def test_notice_is_once_and_cancelled_when_disabled(self):
        self.monitor.poll()
        self.monitor.poll()
        self.notice.assert_called_once()
        cancel = self.notice.call_args.args[2]
        self.pipe.send_break_tick.return_value = {'break_reminder': {'enabled': False}}
        self.monitor.poll()
        self.assertTrue(cancel.is_set())

    def test_same_reminder_reopens_after_pipe_recovers(self):
        self.monitor.poll()
        first_cancel = self.notice.call_args.args[2]
        good_response = self.pipe.send_break_tick.return_value
        self.pipe.send_break_tick.return_value = None
        with patch('break_monitor.time.monotonic', return_value=self.monitor.last_response + 16):
            self.monitor.poll()
        self.assertTrue(first_cancel.is_set())
        self.pipe.send_break_tick.return_value = good_response
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)
        self.assertFalse(self.notice.call_args.args[2].is_set())
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)

    def test_failed_window_creation_retries_same_reminder(self):
        self.notice.side_effect = OSError('dialog could not be created')
        with self.assertRaises(OSError):
            self.monitor.poll()
        self.notice.side_effect = None
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)
        self.assertFalse(self.notice.call_args.args[2].is_set())

    def test_window_worker_failure_retries_but_completed_response_does_not(self):
        worker = self.notice.return_value
        worker.is_alive.return_value = False
        self.monitor.poll()
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)
        self.notice.call_args.args[1]('acknowledged')
        self.pipe.send_break_response.return_value = None
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)
        self.monitor._cancel_notice()  # Connection failed before the ACK arrived.
        self.monitor.poll()
        self.assertEqual(self.notice.call_count, 2)

    def test_cancelled_window_cannot_enqueue_late_response(self):
        self.monitor.poll()
        callback = self.notice.call_args.args[1]
        self.pipe.send_break_tick.return_value = {'break_reminder': {'enabled': False}}
        self.monitor.poll()
        callback('acknowledged')
        self.assertTrue(self.monitor.events.empty())

    def test_display_is_not_reported_until_window_callback_and_retries_are_fifo(self):
        self.monitor.poll()
        self.pipe.send_break_response.assert_not_called()
        callback = self.notice.call_args.args[1]
        callback('shown')
        callback('acknowledged')
        self.pipe.send_break_response.return_value = None
        self.monitor.poll()
        self.pipe.send_break_response.assert_called_with('r1', 'shown')
        self.pipe.send_break_response.return_value = {'break_response_accepted': True}
        self.monitor.poll()
        self.assertEqual([c.args[1] for c in self.pipe.send_break_response.call_args_list], ['shown', 'shown', 'acknowledged'])


if __name__ == '__main__':
    unittest.main()
