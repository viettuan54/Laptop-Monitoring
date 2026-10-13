"""Session-local break reminders. No input content, screenshots or key hooks."""
import json
import math
import threading
import time
import uuid
from datetime import datetime, timezone


class BreakReminderEngine:
    IDLE_SECONDS = 60
    MAX_TICK_GAP = 15

    def __init__(self, offline_queue, clock=time.monotonic, wall_clock=time.time):
        self.queue = offline_queue
        self.clock = clock
        self.wall_clock = wall_clock
        self.lock = threading.RLock()
        self.last_mono = None
        with self.queue.get_connection() as conn:
            row = conn.execute("SELECT value FROM agent_metadata WHERE key = 'break_reminder_state'").fetchone()
        try:
            self.state = json.loads(row[0]) if row else {}
        except (ValueError, TypeError):
            self.state = {}
        if not isinstance(self.state, dict):
            self.state = {}

    @staticmethod
    def policy(settings):
        interval = settings.get('break_interval_minutes', 30)
        duration = settings.get('break_duration_minutes', 5)
        valid = (type(interval) is int and 5 <= interval <= 180
                 and type(duration) is int and 1 <= duration <= 30)
        return (settings.get('enable_break_reminders') is True and valid,
                interval if valid else 30, duration if valid else 5)

    def _persist(self, conn=None):
        sql = "INSERT INTO agent_metadata(key, value) VALUES ('break_reminder_state', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        if conn is not None:
            conn.execute(sql, (json.dumps(self.state),))
        else:
            with self.queue.get_connection() as connection:
                connection.execute(sql, (json.dumps(self.state),))

    def tick(self, settings, idle_seconds, desktop_active, session_key, blocked=False):
        if (type(idle_seconds) not in (int, float) or not math.isfinite(idle_seconds)
                or idle_seconds < 0 or type(desktop_active) is not bool):
            raise ValueError('Invalid activity sample')
        with self.lock:
            enabled, interval, duration = self.policy(settings)
            now, wall = self.clock(), self.wall_clock()
            signature = [enabled, interval, duration, session_key]
            if self.state.get('policy') != signature:
                self.state = {'policy': signature, 'active_seconds': 0}
                self.last_mono = None
            previous_wall = self.state.get('last_tick', wall)
            wall_gap = wall - previous_wall
            delta = now - self.last_mono if self.last_mono is not None else 0
            self.last_mono = now
            if not enabled:
                self.state = {'policy': signature, 'active_seconds': 0, 'last_tick': wall}
                self._persist()
                return {'enabled': False}

            # Keep time already observed through short locks/restarts, but never
            # count sleep, a missing Companion or a clock change as active use.
            continuous = 0 <= delta <= self.MAX_TICK_GAP and 0 <= wall_gap <= self.MAX_TICK_GAP
            active = desktop_active and not blocked and idle_seconds < self.IDLE_SECONDS
            inactive_since = self.state.get('inactive_since')
            if not desktop_active or blocked:
                inactive_since = inactive_since if inactive_since is not None else previous_wall
            elif idle_seconds >= self.IDLE_SECONDS:
                inactive_since = wall - idle_seconds
            else:
                inactive_since = None
            rest_elapsed = ((inactive_since is not None and wall - inactive_since >= duration * 60)
                            or wall_gap >= duration * 60)
            if wall_gap < 0 or rest_elapsed:
                self.state.update(active_seconds=0, reminder=None, next_allowed=0)
            elif continuous and active and self.state.get('was_active'):
                self.state['active_seconds'] = min(interval * 60, self.state.get('active_seconds', 0) + delta)
            self.state.update(last_tick=wall, was_active=active, inactive_since=inactive_since)

            pending = self.state.get('reminder')
            if pending and (blocked or not desktop_active or wall - pending['created_at'] > 125):
                self.state.update(reminder=None, next_allowed=wall + 300)
                pending = None
            if (active and not pending and self.state.get('active_seconds', 0) >= interval * 60
                    and wall >= self.state.get('next_allowed', 0)):
                pending = {'reminder_id': str(uuid.uuid4()), 'interval_minutes': interval,
                           'duration_minutes': duration, 'created_at': wall}
                self.state['reminder'] = pending
            self._persist()
            return {'enabled': True, 'reminder': pending if active else None}

    def receipt(self, settings, reminder_id, event_type):
        if event_type not in {'shown', 'acknowledged', 'snoozed'}:
            raise ValueError('Invalid reminder response')
        with self.lock:
            pending = self.state.get('reminder')
            enabled, interval, duration = self.policy(settings)
            # Late responses to a cancelled/changed policy are discarded and
            # acknowledged so they do not block subsequent reminders.
            if (not enabled or not pending or pending['reminder_id'] != reminder_id
                    or [enabled, interval, duration] != self.state.get('policy', [])[:3]):
                return True
            now = self.wall_clock()
            event = {'client_record_id': str(uuid.uuid5(uuid.UUID(reminder_id), event_type)),
                     'reminder_id': reminder_id, 'event_type': event_type,
                     'interval_minutes': interval, 'duration_minutes': duration,
                     'occurred_at': datetime.fromtimestamp(now, timezone.utc).isoformat()}
            with self.queue.get_connection() as conn:
                if event_type != 'shown':
                    # Pressing a button is acknowledgement, not proof of rest.
                    self.state.update(reminder=None, next_allowed=now + (300 if event_type == 'snoozed' else duration * 60))
                conn.execute("INSERT OR IGNORE INTO break_reminder_events(client_record_id, payload) VALUES (?, ?)",
                             (event['client_record_id'], json.dumps(event)))
                self._persist(conn)
            return True
