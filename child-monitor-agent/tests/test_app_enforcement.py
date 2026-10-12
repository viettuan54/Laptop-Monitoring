import json
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock

SERVICE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "service")
sys.path.insert(0, SERVICE)
from app_enforcement import AppEnforcer
from offline_queue import OfflineQueue


class AppEnforcementTest(unittest.TestCase):
    def setUp(self):
        self.time = 0
        self.policy = {"enable_app_classification": True, "blocked_app_categories": ["entertainment"]}
        self.target = Mock(app_name="game.exe", product_name="Game", file_description="Game")
        self.target.alive.return_value = True
        self.target.context_valid.return_value = True
        self.processes = Mock()
        self.processes.open.return_value = self.target
        self.classify = Mock(return_value={"category": "entertainment", "source": "trained_model", "confidence": 0.9})
        self.schedule = Mock()
        self.sink = Mock(return_value=True)
        self.enforcer = AppEnforcer(self.processes, lambda: self.policy, self.classify,
                                    self.schedule, self.sink, clock=lambda: self.time)
        self.candidates = [{"pid": 200, "created_at": 1000}]

    def test_closes_gracefully_and_records_only_verified_exit(self):
        commands = self.enforcer.check(self.candidates)
        self.assertEqual(commands[0]["pid"], 200)
        self.sink.assert_not_called()
        self.target.terminate.assert_not_called()
        self.target.alive.return_value = False
        self.enforcer.tick()
        self.assertEqual(self.sink.call_args.args[0]["outcome"], "closed")
        self.assertEqual(self.sink.call_args.args[0]["reason"], "graceful_exit")
        self.target.close.assert_called_once()

    def test_forced_termination_waits_for_confirmed_exit(self):
        self.enforcer.check(self.candidates)
        self.time = 7
        self.enforcer.tick()
        self.target.terminate.assert_not_called()
        self.time = 8
        self.enforcer.tick()
        self.target.terminate.assert_called_once()
        self.sink.assert_not_called()
        self.target.alive.return_value = False
        self.enforcer.tick()
        self.assertEqual(self.sink.call_args.args[0]["reason"], "terminated")

    def test_off_allow_and_session_change_cancel_pending_termination(self):
        for change in ('off', 'allow', 'session'):
            with self.subTest(change=change):
                self.setUp()
                self.enforcer.check(self.candidates)
                if change == 'off':
                    self.policy['enable_app_classification'] = False
                elif change == 'allow':
                    self.policy['blocked_app_categories'] = []
                else:
                    self.target.context_valid.return_value = False
                self.time = 10
                self.enforcer.tick()
                self.target.terminate.assert_not_called()
                self.assertEqual(self.sink.call_args.args[0]['outcome'], 'cancelled')

    def test_pending_is_not_the_confirmed_unknown_category(self):
        self.policy['blocked_app_categories'] = ['unknown']
        self.classify.return_value = {'category': 'unknown', 'source': 'pending'}
        self.assertEqual(self.enforcer.check(self.candidates), [])
        self.schedule.assert_called_once()
        self.enforcer.check(self.candidates)
        self.schedule.assert_called_once()  # Avoid repeatedly calling a failing provider.
        self.classify.return_value = {'category': 'unknown', 'source': 'gemini', 'confidence': None}
        self.assertEqual(len(self.enforcer.check(self.candidates)), 1)

    def test_disabled_skips_inspection_and_classification(self):
        self.policy['enable_app_classification'] = False
        self.assertEqual(self.enforcer.check(self.candidates), [])
        self.processes.open.assert_not_called()

    def test_rejected_identity_or_protected_process_is_never_terminated(self):
        self.processes.open.return_value = None
        self.assertEqual(self.enforcer.check(self.candidates), [])
        self.classify.assert_not_called()

    def test_access_denied_reports_failure_without_repeating_every_poll(self):
        self.enforcer.check(self.candidates)
        self.target.terminate.side_effect = OSError('denied')
        self.time = 9
        self.enforcer.tick()
        self.assertEqual(self.sink.call_args.args[0]['outcome'], 'failed')
        self.enforcer.check(self.candidates)
        self.target.terminate.assert_called_once()

    def test_termination_timeout_is_not_reported_as_success(self):
        self.enforcer.check(self.candidates)
        self.time = 8
        self.enforcer.tick()
        self.time = 12
        self.enforcer.tick()
        self.assertEqual(self.sink.call_args.args[0]['reason'], 'termination_timeout')

    def test_receipt_retry_keeps_id_and_does_not_repeat_termination(self):
        self.enforcer.check(self.candidates)
        self.target.alive.return_value = False
        self.sink.side_effect = [False, True]
        self.enforcer.tick()
        first = self.sink.call_args.args[0].copy()
        self.enforcer.tick()
        self.assertEqual(self.sink.call_args.args[0], first)
        self.target.terminate.assert_not_called()

    def test_reopen_with_new_creation_time_is_checked_again(self):
        self.enforcer.check(self.candidates)
        self.target.alive.return_value = False
        self.enforcer.tick()
        self.target.alive.return_value = True
        self.assertEqual(len(self.enforcer.check([{'pid': 200, 'created_at': 2000}])), 1)

    def test_malformed_candidate_batch_is_rejected(self):
        for value in (None, {}, [{'pid': True, 'created_at': 1}], [{'pid': 200, 'created_at': float('nan')}], self.candidates * 65):
            with self.assertRaises(ValueError):
                self.enforcer.check(value)


class EnforcementQueueTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.temp.name, 'queue.db')
        self.queue = OfflineQueue(self.path, secure_file=False)

    def tearDown(self):
        self.temp.cleanup()

    def test_labels_survive_restart_but_not_model_change(self):
        result = {'category': 'entertainment', 'source': 'gemini', 'confidence': None}
        self.queue.remember_app_classification('key', 'v1', result)
        restarted = OfflineQueue(self.path, secure_file=False)
        self.assertEqual(restarted.get_app_classification('key', 'v1'), result)
        self.assertIsNone(restarted.get_app_classification('key', 'v2'))
        self.queue.remember_app_classification('pending', 'v1', {'category': 'unknown', 'source': 'pending'})
        self.assertIsNone(self.queue.get_app_classification('pending', 'v1'))

    def test_only_acknowledged_receipts_are_synced_and_retries_are_idempotent(self):
        for record_id in ('first', 'second', 'first'):
            self.assertTrue(self.queue.enqueue_app_enforcement({'client_record_id': record_id}))
        api = Mock()
        api.post.return_value.status_code = 201
        api.post.return_value.json.return_value = {'accepted_client_record_ids': ['first', 'foreign']}
        self.queue._sync_app_enforcement(api)
        with self.queue.get_connection() as conn:
            self.assertEqual(dict(conn.execute('SELECT client_record_id,synced FROM app_enforcement_events')), {'first': 1, 'second': 0})
        api.post.return_value.json.return_value = {}
        self.queue._sync_app_enforcement(api)
        self.assertEqual(api.post.call_args.kwargs['data']['records'], [{'client_record_id': 'second'}])


if __name__ == '__main__':
    unittest.main()
