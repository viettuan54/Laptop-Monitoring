const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, deferred, row } = require('./alertsState.test');

test('live results appear without replacing the filter or scrolling; unchanged results keep their nodes', async () => {
  const view = fixture(); await view.render();
  const form = view.content.querySelector('#alert-filter');
  const select = form.querySelector('[name="device_id"]'); select.value = '3';
  const status = view.content.querySelector('#alerts-load-status');
  const button = view.content.querySelector('[data-action="mark-alert"]'); button.focus();
  view.context.api = async route => {
    assert.equal(route, '/alerts?device_id=2&limit=200');
    return { data: [{ ...row(), message: 'Updated' }] };
  };
  await view.render({ background: true });
  assert.equal(view.state.alerts[0].message, 'Updated');
  assert.equal(view.content.querySelector('#alert-filter'), form);
  assert.equal(view.content.querySelector('#alerts-load-status'), status);
  assert.equal(select.value, '3');
  const next = view.content.querySelector('[data-action="mark-alert"]');
  assert.notEqual(next, button); assert.equal(view.document.activeElement, next);
  assert.equal(next.focusOptions.preventScroll, true);
  await view.render({ background: true });
  assert.equal(view.content.querySelector('[data-action="mark-alert"]'), next);
  assert.equal(view.document.activeElement, next);
});

test('late responses cannot overwrite another page, session, filter or detached content', async () => {
  for (const invalidate of [
    view => { view.state.page = 'policies'; },
    view => { view.state.accessToken = ''; },
    view => { view.state.alertFilter = { device_id: '3' }; },
    view => { view.content.isConnected = false; },
  ]) for (const fail of [false, true]) {
    const view = fixture(); await view.render();
    const wait = deferred(); view.context.api = () => wait.promise;
    const html = view.content.innerHTML;
    const pending = view.render({ background: true }); invalidate(view);
    fail ? wait.reject(Error('late failure')) : wait.resolve({ data: [row(99)] });
    assert.equal((await pending).status, 'ignored');
    assert.equal(view.content.innerHTML, html); assert.equal(view.state.alerts[0].alert_id, 7);
    assert.equal(view.toasts.length, 0);
  }
});

test('a newer render wins when an earlier request completes late', async () => {
  for (const fail of [false, true]) {
    const view = fixture(); await view.render();
    const old = deferred(), fresh = deferred(); let count = 0;
    view.context.api = () => (++count === 1 ? old : fresh).promise;
    const first = view.render({ background: true }); const second = view.render({ background: true });
    fresh.resolve({ data: [row(12)] }); await second;
    const html = view.content.innerHTML;
    fail ? old.reject(Error('late failure')) : old.resolve({ data: [] }); await first;
    assert.equal(view.state.alerts[0].alert_id, 12); assert.equal(view.content.innerHTML, html);
  }
});

test('repeated polling failures keep results and one stable message; recovery clears stale status', async () => {
  const view = fixture(); await view.render();
  const form = view.content.querySelector('#alert-filter'); const select = form.querySelector('[name="device_id"]');
  select.value = '3'; select.focus();
  const rows = view.content.querySelector('#alerts-results').innerHTML;
  view.context.api = async () => { throw Error('offline'); };
  await view.context.refreshVisibleAlerts();
  const status = view.content.querySelector('#alerts-load-status'); const retry = status.querySelector('button');
  assert.match(view.status(), /có thể đã cũ/);
  await view.context.refreshVisibleAlerts();
  assert.equal(status.querySelector('button'), retry);
  assert.equal(view.content.querySelector('#alerts-results').innerHTML, rows);
  assert.equal(view.document.activeElement, select); assert.equal(view.toasts.length, 0);
  view.context.api = async () => ({ data: [row(9)] }); await view.context.refreshVisibleAlerts();
  assert.equal(view.status(), ''); assert.equal(view.state.alerts[0].alert_id, 9);
  assert.equal(view.document.activeElement, select); assert.equal(select.value, '3');
  assert.equal(view.context.alertListRefreshPromise, null);
});

test('a new foreground render owns pending after an older GET rejects', async () => {
  const view = fixture(); await view.render();
  const old = deferred(), fresh = deferred(); let count = 0;
  view.context.api = () => (++count === 1 ? old : fresh).promise;
  const first = view.render(); view.state.alertFilter = { device_id: '3' }; const second = view.render();
  const owner = view.content.alertsView.pending;
  old.reject(Error('late')); assert.equal((await first).status, 'ignored');
  assert.equal(view.content.alertsView.pending, owner); assert.match(view.status(), /Đang tải/);
  fresh.resolve({ data: [row(9)] }); await second; assert.equal(view.content.alertsView.pending, null);
});

test('Clarify notes keep their nodes and stay out of announcements during polling and retry', async () => {
  const view = fixture(); await view.render();
  const ids = ['alerts-scope-note', 'alerts-filter-help', 'alerts-read-help'];
  const notes = ids.map(id => view.content.querySelector('#' + id));
  const region = view.content.querySelector('#alerts-load-status');
  const select = view.content.querySelector('[name="device_id"]'); select.value = '3'; select.focus();
  for (const failure of [false, true, true, false]) {
    view.context.api = async () => { if (failure) throw Error('offline'); return { data: [row(10)] }; };
    await view.context.refreshVisibleAlerts();
    ids.forEach((id, index) => {
      assert.equal(view.content.querySelectorAll('#' + id).length, 1);
      assert.equal(view.content.querySelector('#' + id), notes[index]);
      assert.equal(region.contains(notes[index]), false);
      assert.ok(!region.textContent.includes(notes[index].textContent));
    });
    assert.equal(view.document.activeElement, select); assert.equal(select.value, '3');
  }
  view.context.api = async () => { throw Error('offline'); }; await view.render();
  view.context.api = async () => ({ data: [] }); await view.click('retry-alerts');
  ids.forEach((id, index) => assert.equal(view.content.querySelector('#' + id), notes[index]));
  assert.equal(view.document.activeElement, view.content.querySelector('#alerts-results'));
});

test('Distilled summary stays icon-free through loading, error, retry and read reconciliation', async () => {
  const view = fixture(); let bannerCalls = 0;
  view.context.sectionVisual = () => { bannerCalls++; return ''; };
  await view.render();
  const form = view.content.querySelector('#alert-filter');
  const live = view.content.querySelector('#alerts-load-status');
  const notes = ['alerts-scope-note', 'alerts-filter-help', 'alerts-read-help'].map(id => view.content.querySelector('#' + id));
  const wait = deferred(); view.context.api = () => wait.promise;
  const pending = view.render(); assert.match(view.status(), /Đang tải/);
  wait.reject(Error('offline')); await pending; assert.ok(view.content.querySelector('[data-action="retry-alerts"]'));
  view.context.api = async () => ({ data: [row()] }); await view.click('retry-alerts');
  view.context.api = async (_route, options) => options?.method === 'PUT' ? {} : { data: [row(7, true)] };
  await view.click('mark-alert', 7);
  assert.equal(bannerCalls, 0);
  assert.equal(view.content.querySelectorAll('.summary-icon').length, 0);
  assert.deepEqual(view.content.querySelector('.alert-summary').querySelectorAll('strong').map(node => node.textContent),
    ['1 cảnh báo', '0 cảnh báo', '0 cảnh báo', '0 cảnh báo']);
  assert.equal(view.content.querySelector('#alert-filter'), form);
  assert.equal(view.content.querySelector('#alerts-load-status'), live);
  assert.equal(view.content.querySelectorAll('#alerts-load-status').length, 1);
  for (const note of notes) { assert.equal(view.content.querySelector('#' + note.id), note); assert.equal(live.contains(note), false); }
  assert.equal(view.document.activeElement, view.content.querySelector('[data-alert-id="7"]'));
  assert.equal(view.content.querySelector('#alerts-results').getAttribute('aria-busy'), 'false');
});
