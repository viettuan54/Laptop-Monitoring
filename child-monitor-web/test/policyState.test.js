const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_PATH = path.join(__dirname, '..', 'app.js');

function functionSource(source, name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `Dashboard function ${name} is missing`);
  const rest = source.slice(match.index);
  const next = /\n(?:async )?function /g;
  const boundary = next.exec(rest);
  return boundary ? rest.slice(0, boundary.index) : rest;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeForm(childId, { app = false, web = false, text = false, learning = 'allow', social = 'allow' } = {}, renderVersion = 1) {
  const status = { textContent: '' };
  const syncGuidance = { textContent: '' };
  const switchStatuses = Object.fromEntries(['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']
    .map(name => [name, { textContent: '', dataset: {} }]));
  const switchNotes = Object.fromEntries(['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']
    .map(name => [name, { textContent: '', hidden: true }]));
  const refreshButton = { hidden: true, focus() {} };
  const policyGroups = Object.fromEntries(['app', 'web'].map(resource => {
    const badgeClasses = new Set(['badge']);
    if (!(resource === 'app' ? app : web)) badgeClasses.add('neutral');
    const availability = {
      textContent: '',
      classList: {
        contains(name) { return badgeClasses.has(name); },
        toggle(name, enabled) {
          if (enabled) badgeClasses.add(name);
          else badgeClasses.delete(name);
          return badgeClasses.has(name);
        },
      },
    };
    const explanation = { textContent: '' };
    return [resource, {
      availability,
      explanation,
      classList: { toggled: false, toggle(_name, enabled) { this.toggled = enabled; } },
      querySelector(selector) {
        if (selector === '[data-policy-group-availability]') return availability;
        if (selector === '[data-policy-group-explanation]') return explanation;
        return null;
      },
    }];
  }));
  const submit = { disabled: false, textContent: 'Lưu chính sách' };
  const form = {
    id: 'policy-form',
    isConnected: true,
    dataset: { childId: String(childId), renderVersion: String(renderVersion) },
    elements: {
      enable_app_classification: { checked: app },
      enable_web_classification: { checked: web },
      enable_text_moderation: { checked: text },
      policy_app_learning: { value: learning },
      policy_web_social: { value: social },
    },
    querySelector(selector) {
      if (selector === '[data-policy-draft-status]') return status;
      if (selector === '[data-policy-sync-guidance]') return syncGuidance;
      if (selector === '[type="submit"]') return submit;
      if (selector === '[data-action="refresh-policy-state"]') return refreshButton;
      const switchStatus = selector.match(/^\[data-policy-switch-status="([^"]+)"\]$/);
      if (switchStatus) return switchStatuses[switchStatus[1]] || null;
      const switchNote = selector.match(/^\[data-policy-switch-note="([^"]+)"\]$/);
      if (switchNote) return switchNotes[switchNote[1]] || null;
      const policyGroup = selector.match(/^\.policy-group\[data-resource="(app|web)"\]$/);
      if (policyGroup) return policyGroups[policyGroup[1]];
      return null;
    },
    status,
    syncGuidance,
    submit,
    refreshButton,
    switchStatuses,
    switchNotes,
    policyGroups,
  };
  return form;
}

function fixture({ api = async () => ({}), children = [
  { child_id: 1, name: 'An', age: 8 },
  { child_id: 2, name: 'Bình', age: 10 },
] } = {}) {
  let currentForm = null;
  const toasts = [];
  const state = {
    page: 'policies',
    policyRenderVersion: 0,
    selectedChildId: 1,
    children,
    categoryPolicies: {},
    policyDrafts: {},
    policyBaselinesByChild: {},
    policyPendingByChild: {},
    policyDataVersions: {},
    policySaveErrors: {},
  };
  const context = vm.createContext({
    state,
    api,
    policySaveSequence: 0,
    policyCategoryGroups: {
      app: [['learning', 'Học tập', 'Ứng dụng học tập.']],
      web: [['social', 'Mạng xã hội', 'Website cộng đồng.']],
    },
    document: {
      querySelector(selector) {
        if (selector === '#policy-form') return currentForm;
        return null;
      },
    },
    pageHead: () => '<header>Chính sách</header>',
    sectionVisual: () => '',
    emptyState: () => '<p>Chưa có hồ sơ</p>',
    escapeHtml: value => String(value ?? ''),
    initials: value => String(value).slice(0, 1),
    reconcileSelectedId: (current, rows) => rows.some(row => String(row.child_id) === String(current))
      ? current : rows[0]?.child_id ?? null,
    toast: (...args) => toasts.push(args),
  });
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const declarations = [
    "const policyClassificationFields = ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation'];",
    ...['policySnapshotFromForm', 'policySnapshotsEqual', 'updatePolicyDraftStatus', 'capturePolicyDraft',
      'policyStatusForChild', 'policySyncGuidanceForChild', 'policyClassificationSaveState', 'policyClassificationSaveNote',
      'policySaveRequiresRefresh', 'policySettingHasUncertainResult', 'policyGroupHasUncertainResult',
      'policyGroupMatchesSnapshot', 'policyGroupView', 'syncPolicyClassificationUI',
      'syncPolicyFormState', 'savePolicyForm', 'isCurrentPolicyForm', 'renderPolicies',
      'categoryPolicyGroup', 'switchRow'].map(name => functionSource(source, name)),
  ];
  vm.runInContext(declarations.join('\n'), context);
  return {
    context,
    state,
    toasts,
    setForm(form) { currentForm = form; },
  };
}

function savedSettings(overrides = {}) {
  return {
    enable_app_classification: false,
    enable_web_classification: false,
    enable_text_moderation: false,
    ...overrides,
  };
}

function savedPolicies(overrides = {}) {
  const values = { 'app:learning': 'allow', 'web:social': 'allow', ...overrides };
  return { policies: Object.entries(values).map(([key, action]) => {
    const [resource_type, category] = key.split(':');
    return { resource_type, category, action };
  }) };
}

function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function markupAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)]
    .map(([, name, value]) => [name, value ?? '']));
}

function assertAriaTargets(markup) {
  const elements = [...markup.matchAll(/<[a-z][\w-]*\b[^>]*>/gi)].map(([tag]) => markupAttributes(tag));
  const ids = elements.filter(element => element.id).map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'rendered IDs must be unique');
  for (const element of elements) {
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      if (!(attribute in element)) continue;
      const references = element[attribute].trim().split(/\s+/);
      assert.equal(new Set(references).size, references.length, 'ARIA references must not repeat');
      for (const id of references) assert.ok(ids.includes(id), `${attribute} target ${id} must exist`);
    }
  }
  return elements;
}

test('policy controls reference unique descriptions, save statuses and notes in every save state', () => {
  const app = fixture();
  app.context.policyCategoryGroups.app = [['unknown', 'Chưa phân loại', 'Mô tả ứng dụng.']];
  app.context.policyCategoryGroups.web = [['unknown', 'Chưa phân loại', 'Mô tả website.']];
  const names = ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation'];
  const snapshot = { settings: savedSettings(), categories: {} };
  for (const saveState of ['unknown', 'saved', 'draft', 'pending', 'failed']) {
    app.state.policyBaselinesByChild = saveState === 'unknown' ? {} : { '1': snapshot };
    app.state.policyPendingByChild = saveState === 'pending' ? { '1': { snapshot } } : {};
    app.state.policySaveErrors = saveState === 'failed'
      ? { '1': { requiresRefresh: true, failedOperations: [{ kind: 'settings' }] } } : {};
    for (const checked of [false, true]) {
      const markup = names.map(name => app.context.switchRow(name, name, 'Hướng dẫn dài. '.repeat(40), checked, true)).join('')
        + app.context.categoryPolicyGroup('app', 'Ứng dụng', checked)
        + app.context.categoryPolicyGroup('web', 'Website', checked);
      const elements = assertAriaTargets(markup);
      for (const name of names) {
        const input = elements.find(element => element.type === 'checkbox' && element.name === name);
        assert.equal(input['aria-describedby'].split(/\s+/).length, 3);
        assert.equal('checked' in input, checked);
        const targets = input['aria-describedby'].split(/\s+/).map(id => elements.find(element => element.id === id));
        assert.ok(targets.some(element => element['data-policy-switch-status'] === name));
        assert.ok(targets.some(element => element['data-policy-switch-note'] === name));
      }
      const selects = elements.filter(element => element.name?.startsWith('policy_'));
      assert.equal(selects.length, 2);
      assert.notEqual(selects[0]['aria-describedby'], selects[1]['aria-describedby']);
    }
  }
});

test('accessibility enhancement preserves policy descriptions and retains non-policy behavior', () => {
  const app = fixture();
  const source = fs.readFileSync(APP_PATH, 'utf8');
  vm.runInContext('let accessibleControlSequence = 0;\n'
    + functionSource(source, 'ensureControlId') + '\n'
    + functionSource(source, 'enhanceFormAccessibility'), app.context);
  for (const policy of [true, false]) {
    for (const existing of [undefined, 'custom-hint custom-note']) {
      const markup = app.context.switchRow('enable_web_classification', 'Website', 'Mô tả', false, policy)
        + '<small id="custom-hint">Mô tả bổ sung</small><small id="custom-note">Ghi chú bổ sung</small>';
      const elements = assertAriaTargets(markup);
      const attributes = elements.find(element => element.type === 'checkbox');
      if (existing !== undefined) attributes['aria-describedby'] = existing;
      const before = attributes['aria-describedby'];
      for (const id of (before || '').split(/\s+/).filter(Boolean)) {
        assert.ok(elements.some(element => element.id === id), 'preserved description targets exist');
      }
      const control = {
        get id() { return attributes.id; },
        set id(value) { attributes.id = value; },
        closest(selector) { assert.equal(selector, '#policy-form'); return policy ? {} : null; },
        getAttribute(name) { return attributes[name] ?? null; },
        setAttribute(name, value) { attributes[name] = value; },
      };
      const title = markupAttributes(markup.match(/<strong[^>]*>/)[0]);
      const hint = markupAttributes(markup.match(/<small[^>]*>/)[0]);
      const row = { querySelector: selector => ({
        'input[type="checkbox"]': control, '.switch-copy strong': title, '.switch-copy small': hint,
      })[selector] };
      const root = { querySelectorAll: selector => selector === '.switch-row' ? [row] : [] };
      for (let pass = 0; pass < 3; pass++) app.context.enhanceFormAccessibility(root);
      assert.equal(attributes['aria-labelledby'], title.id);
      assert.equal(attributes['aria-describedby'], policy ? before : hint.id);
      if (policy) {
        delete attributes['aria-describedby'];
        app.context.enhanceFormAccessibility(root);
        assert.equal(attributes['aria-describedby'], hint.id, 'missing policy description still gets the fallback');
      }
    }
  }
});

test('non-policy switch markup remains unchanged for both checkbox states', () => {
  const app = fixture();
  for (const name of ['enable_break_reminders', 'is_locked', 'enable_screenshot_review', 'is_active']) {
    for (const checked of [false, true]) {
      const expected = `<div class="switch-row"><div class="switch-copy"><strong>Nhãn</strong><small>Mô tả</small></div><label class="switch"><input type="checkbox" name="${name}"  ${checked ? 'checked' : ''}><span></span></label></div>`;
      assert.equal(app.context.switchRow(name, 'Nhãn', 'Mô tả', checked), expected);
    }
  }
});

test('policy rendering preserves long names, many profiles, long descriptions and native tab order', async () => {
  const children = Array.from({ length: 200 }, (_, index) => ({
    child_id: index + 1, name: `${index + 1} Nguyễn & <An> ${'Tênrấtdài'.repeat(20)} 🌱`, age: null,
  }));
  const app = fixture({ children, api: async route => route.startsWith('/children')
    ? children : route.endsWith('/policies') ? savedPolicies() : savedSettings() });
  vm.runInContext(functionSource(fs.readFileSync(APP_PATH, 'utf8'), 'escapeHtml'), app.context);
  const longDescription = 'Hướng dẫn chính sách cần được giữ nguyên đầy đủ. '.repeat(80);
  app.context.policyCategoryGroups.app = [['learning', 'Học tập', longDescription]];
  const content = { innerHTML: '' };
  await app.context.renderPolicies(content);
  const elements = assertAriaTargets(content.innerHTML);
  assert.equal(elements.filter(element => element['data-action'] === 'select-policy-child').length, 200);
  for (const child of children) assert.ok(content.innerHTML.includes(app.context.escapeHtml(child.name)));
  assert.ok(content.innerHTML.includes(longDescription));
  assert.deepEqual(elements.filter(element => element.name).map(element => element.name), [
    'enable_app_classification', 'enable_web_classification', 'enable_text_moderation',
    'policy_app_learning', 'policy_web_social',
  ]);
  assert.ok(elements.every(element => !('tabindex' in element)), 'controls retain native tab order');
  assert.ok(elements.some(element => element.type === 'submit' && !('disabled' in element)));
});

test('policy draft is restored for its child after switching to another child', async () => {
  const app = fixture({ api: async route => {
    if (route === '/children?limit=200') return [
      { child_id: 1, name: 'An', age: 8 }, { child_id: 2, name: 'Bình', age: 10 },
    ];
    return route.includes('/policies') ? savedPolicies() : savedSettings();
  } });
  const content = { innerHTML: '' };

  await app.context.renderPolicies(content);
  assert.match(content.innerHTML, /aria-pressed="true"[^>]*data-action="select-policy-child"/);
  assert.match(content.innerHTML, /aria-pressed="false"[^>]*data-action="select-policy-child"/);
  const savedA = app.state.policyBaselinesByChild['1'];
  const draftA = makeForm(1, { app: true, learning: 'block' }, app.state.policyRenderVersion);
  app.setForm(draftA);
  app.context.capturePolicyDraft(draftA);
  assert.equal(draftA.status.textContent, 'Bản nháp chưa lưu');

  app.state.selectedChildId = 2;
  await app.context.renderPolicies(content);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.categoryPolicies)), {
    'app:learning': 'allow', 'web:social': 'allow',
  });

  app.state.selectedChildId = 1;
  await app.context.renderPolicies(content);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.policyBaselinesByChild['1'])), JSON.parse(JSON.stringify(savedA)));
  assert.equal(app.state.categoryPolicies['app:learning'], 'block');
  assert.match(content.innerHTML, /value="block" selected/);
  assert.match(content.innerHTML, /Bản nháp chưa lưu/);
});

test('late policy load for an old child cannot replace the newly selected child', async () => {
  const requests = new Map();
  const app = fixture({ api: route => {
    if (route === '/children?limit=200') return Promise.resolve([
      { child_id: 1, name: 'An', age: 8 }, { child_id: 2, name: 'Bình', age: 10 },
    ]);
    const gate = deferred();
    requests.set(route, gate);
    return gate.promise;
  } });
  const content = { innerHTML: '' };

  const loadA = app.context.renderPolicies(content);
  await new Promise(setImmediate);
  app.state.selectedChildId = 2;
  const loadB = app.context.renderPolicies(content);
  await new Promise(setImmediate);
  requests.get('/settings/2').resolve(savedSettings({ enable_web_classification: true }));
  requests.get('/settings/2/policies').resolve(savedPolicies({ 'web:social': 'block' }));
  await loadB;
  const htmlForB = content.innerHTML;

  requests.get('/settings/1').resolve(savedSettings({ enable_app_classification: true }));
  requests.get('/settings/1/policies').resolve(savedPolicies({ 'app:learning': 'block' }));
  await loadA;

  assert.equal(app.state.selectedChildId, 2);
  assert.equal(app.state.categoryPolicies['web:social'], 'block');
  assert.equal(app.state.categoryPolicies['app:learning'], 'allow');
  assert.equal(content.innerHTML, htmlForB);
});

test('saving child A after switching to B updates only A state and preserves B draft', async () => {
  const pendingRequests = [];
  const app = fixture({ api: (route, options) => {
    const gate = deferred();
    pendingRequests.push({ route, options, gate });
    return gate.promise;
  } });
  app.state.policyBaselinesByChild['1'] = {
    settings: { enable_app_classification: false, enable_web_classification: false, enable_text_moderation: false },
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  app.state.policyBaselinesByChild['2'] = {
    settings: { enable_app_classification: false, enable_web_classification: false, enable_text_moderation: false },
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  app.state.policyRenderVersion = 1;
  const formA = makeForm(1, { app: true, learning: 'block' }, 1);
  app.setForm(formA);

  const saveA = app.context.savePolicyForm(formA);
  assert.equal(app.state.policyPendingByChild['1'].snapshot.categories['app:learning'], 'block');
  assert.equal(formA.submit.disabled, true);
  assert.equal(formA.status.textContent, 'Đang lưu chính sách...');

  const formB = makeForm(2, { web: true, social: 'block' });
  app.state.selectedChildId = 2;
  app.state.categoryPolicies = { 'app:learning': 'allow', 'web:social': 'block' };
  app.state.policyDrafts['2'] = {
    snapshot: {
      settings: { enable_app_classification: false, enable_web_classification: true, enable_text_moderation: false },
      categories: { 'app:learning': 'allow', 'web:social': 'block' },
    },
    revision: 1,
  };
  formA.isConnected = false;
  app.setForm(formB);

  assert.deepEqual(pendingRequests.map(request => request.route).sort(), [
    '/settings/1', '/settings/1/policies/app/learning',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(pendingRequests.find(request => request.route === '/settings/1').options.body)), {
    enable_app_classification: true,
    enable_web_classification: false,
    enable_text_moderation: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(pendingRequests.find(request => request.route.endsWith('/app/learning')).options.body)), {
    action: 'block',
  });
  for (const request of pendingRequests) request.gate.resolve({});
  await saveA;

  assert.equal(app.state.selectedChildId, 2);
  assert.equal(app.state.categoryPolicies['web:social'], 'block');
  assert.equal(app.state.policyDrafts['2'].snapshot.categories['web:social'], 'block');
  assert.equal(app.state.policyBaselinesByChild['1'].categories['app:learning'], 'block');
  assert.equal(app.state.policyDrafts['1'], undefined);
  assert.equal(formB.status.textContent, '');
  assert.equal(formB.submit.disabled, false);
});

test('failed policy save keeps the draft and does not retry automatically', async () => {
  let requestCount = 0;
  const app = fixture({ api: async () => {
    requestCount += 1;
    throw new Error('temporary failure');
  } });
  app.state.policyBaselinesByChild['1'] = {
    settings: { enable_app_classification: false, enable_web_classification: false, enable_text_moderation: false },
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  app.state.policyRenderVersion = 1;
  const form = makeForm(1, { app: true, learning: 'block' }, 1);
  app.setForm(form);

  await assert.rejects(app.context.savePolicyForm(form), /Chưa xác nhận được kết quả lưu/);
  assert.equal(requestCount, 2);
  assert.ok(app.state.policyDrafts['1']);
  assert.equal(app.state.policyPendingByChild['1'], undefined);
  assert.equal(app.state.policySaveErrors['1'].kind, 'failed');
  assert.equal(app.state.policySaveErrors['1'].requiresRefresh, true);
  assert.match(form.status.textContent, /Chưa xác nhận được kết quả lưu/);
  assert.match(form.syncGuidance.textContent, /Hãy chọn “Kiểm tra trạng thái đã lưu”/);
  assert.doesNotMatch(form.syncGuidance.textContent, /sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo/);
  assert.equal(form.submit.disabled, true);
  assert.equal(form.refreshButton.hidden, false);
  await assert.rejects(app.context.savePolicyForm(form), /Hãy kiểm tra trạng thái đã lưu/);
  assert.equal(requestCount, 2);
});

test('mixed policy save waits for every request, keeps uncertain changes and reconciles before explicit save', async () => {
  const requests = [];
  let serverSettings = savedSettings();
  const app = fixture({ api: (route, options = {}) => {
    if (options.method === 'PUT') {
      const gate = deferred();
      const request = { route, options, gate };
      requests.push(request);
      return gate.promise.then(result => {
        if (route === '/settings/1') serverSettings = { ...options.body };
        return result;
      });
    }
    if (route === '/children?limit=200') return Promise.resolve([
      { child_id: 1, name: 'An', age: 8 }, { child_id: 2, name: 'Bình', age: 10 },
    ]);
    if (route === '/settings/1') return Promise.resolve(serverSettings);
    if (route === '/settings/1/policies') return Promise.resolve(savedPolicies());
    if (route === '/settings/2') return Promise.resolve(savedSettings());
    if (route === '/settings/2/policies') return Promise.resolve(savedPolicies());
    return Promise.resolve({});
  } });
  const baseline = {
    settings: savedSettings(),
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  app.state.policyBaselinesByChild['1'] = structuredClone(baseline);
  app.state.policyBaselinesByChild['2'] = structuredClone(baseline);
  app.state.policyRenderVersion = 1;
  const formA = makeForm(1, { app: true, learning: 'block' }, 1);
  app.setForm(formA);

  let settled = false;
  const saveOutcome = app.context.savePolicyForm(formA).then(
    () => { settled = true; return null; },
    error => { settled = true; return error; },
  );
  assert.equal(requests.length, 2);
  formA.elements.enable_app_classification.checked = false;
  formA.elements.policy_app_learning.value = 'allow';
  app.context.capturePolicyDraft(formA);
  app.state.selectedChildId = 2;
  const formB = makeForm(2, { web: true, social: 'block' });
  const draftB = {
    snapshot: {
      settings: savedSettings({ enable_web_classification: true }),
      categories: { 'app:learning': 'allow', 'web:social': 'block' },
    },
    revision: 1,
  };
  app.state.policyDrafts['2'] = structuredClone(draftB);
  formA.isConnected = false;
  app.setForm(formB);

  requests.find(request => request.route.endsWith('/policies/app/learning')).gate.reject(new Error('network response lost'));
  await new Promise(setImmediate);
  assert.equal(settled, false, 'one rejection must not finish while another request is still pending');
  assert.ok(app.state.policyPendingByChild['1']);
  requests.find(request => request.route === '/settings/1').gate.resolve({});
  const partialError = await saveOutcome;

  assert.match(partialError.message, /Một phần thay đổi có thể đã được lưu/);
  assert.equal(requests.length, 2, 'a failed save must not trigger an automatic retry');
  assert.equal(app.state.policySaveErrors['1'].kind, 'partial');
  assert.equal(app.state.policySaveErrors['1'].requiresRefresh, true);
  assert.match(app.context.policySyncGuidanceForChild('1'), /Một phần thay đổi có thể đã được lưu.*Kiểm tra trạng thái đã lưu/);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.policySaveErrors['1'].failedOperations)), [{ kind: 'category', key: 'app:learning' }]);
  assert.equal(app.state.policyBaselinesByChild['1'].settings.enable_app_classification, true);
  assert.equal(app.state.policyBaselinesByChild['1'].categories['app:learning'], 'allow');
  assert.equal(app.state.policyDrafts['1'].snapshot.settings.enable_app_classification, false);
  assert.equal(app.state.policyDrafts['1'].snapshot.categories['app:learning'], 'allow');
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.policyDrafts['2'])), draftB);
  assert.equal(formB.status.textContent, '');
  assert.equal(formB.submit.disabled, false);

  app.state.selectedChildId = 1;
  const content = { innerHTML: '' };
  await app.context.renderPolicies(content);
  assert.equal(app.state.policySaveErrors['1'], undefined, 'a successful read reconciles the uncertain result');
  assert.equal(app.state.policyBaselinesByChild['1'].settings.enable_app_classification, true);
  assert.equal(app.state.policyDrafts['1'].snapshot.settings.enable_app_classification, false);
  assert.equal(app.state.policyDrafts['1'].snapshot.categories['app:learning'], 'allow');
  assert.match(content.innerHTML, /enable_app_classification/);

  const currentFormA = makeForm(1, { app: false, learning: 'allow' }, app.state.policyRenderVersion);
  app.setForm(currentFormA);
  const resumedSave = app.context.savePolicyForm(currentFormA);
  assert.equal(requests.length, 3, 'only an explicit save after reconciliation may send a new request');
  assert.equal(requests[2].route, '/settings/1', 'the confirmed category is not resent');
  requests[2].gate.resolve({});
  await resumedSave;
});

test('classification switches immediately update saved state and availability for all three controls', () => {
  const app = fixture();
  app.state.policyBaselinesByChild['1'] = {
    settings: savedSettings({ enable_app_classification: true, enable_web_classification: true, enable_text_moderation: true }),
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  app.state.categoryPolicies = { ...app.state.policyBaselinesByChild['1'].categories };
  const form = makeForm(1, { app: true, web: true, text: true });
  app.setForm(form);

  for (const name of ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']) {
    form.elements[name].checked = false;
  }
  app.context.capturePolicyDraft(form);

  assert.equal(form.policyGroups.app.availability.textContent, 'Chưa áp dụng');
  assert.match(form.policyGroups.app.explanation.textContent, /Thay đổi chưa được lưu/);
  assert.match(form.policyGroups.app.explanation.textContent, /Chưa áp dụng/);
  assert.equal(form.policyGroups.web.availability.textContent, 'Chưa áp dụng');
  assert.match(form.policyGroups.web.explanation.textContent, /Chưa áp dụng/);
  for (const resource of ['app', 'web']) {
    assert.equal(form.policyGroups[resource].availability.classList.contains('neutral'), true);
    assert.equal(form.policyGroups[resource].availability.classList.contains('badge'), true);
  }
  for (const name of ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']) {
    assert.equal(form.switchStatuses[name].textContent, 'Chưa lưu');
    assert.equal(form.switchNotes[name].textContent, 'Thay đổi này chưa được lưu.');
  }

  for (const name of ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']) {
    form.elements[name].checked = true;
  }
  app.context.capturePolicyDraft(form);
  assert.equal(form.policyGroups.app.availability.textContent, 'Phân loại bật');
  assert.equal(form.policyGroups.web.availability.textContent, 'Phân loại bật');
  for (const resource of ['app', 'web']) {
    assert.equal(form.policyGroups[resource].availability.classList.contains('neutral'), false);
    assert.equal(form.policyGroups[resource].availability.classList.contains('badge'), true);
  }
  for (const name of ['enable_app_classification', 'enable_web_classification', 'enable_text_moderation']) {
    assert.equal(form.switchStatuses[name].textContent, 'Đã lưu');
  }
  assert.equal(form.policyGroups.app.explanation.textContent, 'Phân loại bật trong cấu hình đã lưu.');

  for (const appEnabled of [false, true]) {
    form.elements.enable_app_classification.checked = appEnabled;
    form.elements.enable_web_classification.checked = !appEnabled;
    app.context.capturePolicyDraft(form);
    for (const resource of ['app', 'web']) {
      const enabled = resource === 'app' ? appEnabled : !appEnabled;
      const badge = form.policyGroups[resource].availability;
      assert.equal(badge.textContent, enabled ? 'Phân loại bật' : 'Chưa áp dụng');
      assert.equal(badge.classList.contains('neutral'), !enabled);
      assert.equal(badge.classList.contains('badge'), true);
    }
  }
});

test('successful policy save reports saved configuration without claiming device execution', async () => {
  const app = fixture({ api: async () => ({}) });
  app.state.policyRenderVersion = 1;
  app.state.policyBaselinesByChild['1'] = {
    settings: savedSettings(),
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  const form = makeForm(1, { app: true });
  app.setForm(form);

  app.context.capturePolicyDraft(form);
  assert.equal(form.switchStatuses.enable_app_classification.textContent, 'Chưa lưu');
  await app.context.savePolicyForm(form);

  assert.equal(form.switchStatuses.enable_app_classification.textContent, 'Đã lưu');
  assert.equal(form.policyGroups.app.availability.textContent, 'Phân loại bật');
  assert.equal(form.policyGroups.app.explanation.textContent, 'Phân loại bật trong cấu hình đã lưu.');
  assert.match(form.syncGuidance.textContent, /Chính sách đã lưu sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo/);
  assert.match(form.syncGuidance.textContent, /Ứng dụng chưa xác nhận thiết bị đã nhận/);
  assert.doesNotMatch(form.policyGroups.app.explanation.textContent, /thiết bị đã nhận|đã thực thi/);
});

test('policy sync guidance distinguishes a draft, an in-flight save and edits made during that save', async () => {
  const requests = [];
  const app = fixture({ api: route => {
    const gate = deferred();
    requests.push({ route, gate });
    return gate.promise;
  } });
  app.state.policyRenderVersion = 1;
  app.state.policyBaselinesByChild['1'] = {
    settings: savedSettings(),
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  const form = makeForm(1, { app: true });
  app.setForm(form);

  app.context.capturePolicyDraft(form);
  assert.match(form.syncGuidance.textContent, /Bản nháp chưa được lưu/);
  assert.doesNotMatch(form.syncGuidance.textContent, /sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo/);

  const save = app.context.savePolicyForm(form);
  assert.match(form.syncGuidance.textContent, /Đang lưu chính sách/);
  assert.doesNotMatch(form.syncGuidance.textContent, /đã lưu sẽ được đồng bộ/);

  form.elements.enable_app_classification.checked = false;
  app.context.capturePolicyDraft(form);
  assert.match(form.syncGuidance.textContent, /Bản nháp hiện tại chưa được lưu/);
  assert.doesNotMatch(form.syncGuidance.textContent, /sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo/);

  for (const request of requests) request.gate.resolve({});
  await save;
  assert.match(form.syncGuidance.textContent, /Bản nháp chưa được lưu/);

  form.elements.enable_app_classification.checked = true;
  app.context.capturePolicyDraft(form);
  assert.match(form.syncGuidance.textContent, /Chính sách đã lưu sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo/);
});

test('failed policy save leaves changed classification clearly unsaved', async () => {
  const app = fixture({ api: async () => { throw new Error('save failed'); } });
  app.state.policyRenderVersion = 1;
  app.state.policyBaselinesByChild['1'] = {
    settings: savedSettings(),
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  const form = makeForm(1, { app: true });
  app.setForm(form);

  await assert.rejects(app.context.savePolicyForm(form), /Chưa xác nhận được kết quả lưu/);

  assert.equal(form.switchStatuses.enable_app_classification.textContent, 'Chưa xác định');
  assert.match(form.switchNotes.enable_app_classification.textContent, /Chưa xác nhận kết quả lưu/);
  assert.equal(form.policyGroups.app.availability.textContent, 'Phân loại bật');
  assert.match(form.policyGroups.app.explanation.textContent, /Chưa xác nhận được kết quả lưu phần này/);
  assert.match(form.policyGroups.app.explanation.textContent, /Bản nháp vẫn được giữ/);
  assert.doesNotMatch(form.policyGroups.app.explanation.textContent, /trong cấu hình đã lưu/);
  assert.equal(form.switchStatuses.enable_web_classification.textContent, 'Chưa xác định');
  assert.match(form.switchNotes.enable_web_classification.textContent, /Chưa xác nhận kết quả lưu/);
  assert.equal(form.policyGroups.web.availability.textContent, 'Chưa áp dụng');
  assert.match(form.policyGroups.web.explanation.textContent, /Chưa xác nhận được kết quả lưu phần này/);
  assert.ok(app.state.policyDrafts['1']);
});

test('missing child age is rendered as a clear empty value', async () => {
  const app = fixture({
    api: async route => route === '/children?limit=200'
      ? [{ child_id: 1, name: 'An', age: null }]
      : route.endsWith('/policies') ? savedPolicies() : savedSettings(),
  });
  const content = { innerHTML: '' };

  await app.context.renderPolicies(content);

  assert.match(content.innerHTML, /Chưa có thông tin tuổi/);
  assert.doesNotMatch(content.innerHTML, /— tuổi/);
});

test('edits made after submit remain as a draft when that same child save completes', async () => {
  const pendingRequests = [];
  const app = fixture({ api: route => {
    const gate = deferred();
    pendingRequests.push(gate);
    return gate.promise;
  } });
  app.state.policyRenderVersion = 1;
  app.state.policyBaselinesByChild['1'] = {
    settings: { enable_app_classification: false, enable_web_classification: false, enable_text_moderation: false },
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  const form = makeForm(1, { app: true, learning: 'block' }, 1);
  app.setForm(form);
  const save = app.context.savePolicyForm(form);

  form.elements.enable_app_classification.checked = false;
  form.elements.policy_app_learning.value = 'allow';
  app.context.capturePolicyDraft(form);
  for (const request of pendingRequests) request.resolve({});
  await save;

  assert.equal(app.state.policyBaselinesByChild['1'].settings.enable_app_classification, true);
  assert.equal(app.state.policyBaselinesByChild['1'].categories['app:learning'], 'block');
  assert.equal(app.state.policyDrafts['1'].snapshot.settings.enable_app_classification, false);
  assert.equal(app.state.policyDrafts['1'].snapshot.categories['app:learning'], 'allow');
  assert.equal(form.status.textContent, 'Bản nháp chưa lưu');
  assert.equal(form.elements.enable_app_classification.checked, false);
  assert.equal(form.elements.policy_app_learning.value, 'allow');
});

test('policy text token meets AA contrast and inactive groups keep readable active controls', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const pageHead = functionSource(source, 'pageHead');
  const renderer = functionSource(source, 'renderPolicies');
  const ink = styles.match(/--ink:\s*(#[\da-f]{6})/i)?.[1];
  assert.ok(ink, 'existing text token should be present');
  assert.match(pageHead, /const context = page === 'policies' \? ''/);
  assert.doesNotMatch(renderer, /sectionVisual\('policies'\)|policy-summary-banner/);

  for (const background of ['#f4f7fb', '#d9e4f9', '#cfdff9', '#ffffff', '#f5f9ff', '#eaf3ff', '#e6f1fe']) {
    assert.ok(contrastRatio(ink, background) >= 4.5, `${ink} must meet AA on ${background}`);
  }

  assert.doesNotMatch(styles, /\.policy-group\.classification-off\s*\{[^}]*\bopacity\s*:/s);
  assert.doesNotMatch(styles, /\.policy-group\.classification-off\s*\{[^}]*border-style:\s*dashed/s);
  assert.match(source, /Quy tắc được lưu nhưng chưa áp dụng khi phân loại tắt/);
  assert.match(source, /availability: enabled \? 'Phân loại bật' : 'Chưa áp dụng'/);
  assert.doesNotMatch(source, /availability: enabled \? 'Đang áp dụng'/);
});

test('switching child policies restores focus to the newly selected child button', async () => {
  const app = fixture({ api: async route => route === '/children?limit=200'
    ? [{ child_id: 1, name: 'An', age: 8 }, { child_id: 2, name: 'Bình', age: 10 }]
    : route.endsWith('/policies') ? savedPolicies() : savedSettings() });
  let focused = false;
  const focusButton = {
    dataset: { id: '2' },
    focus(options) { focused = options?.preventScroll === true; },
  };
  const content = {
    innerHTML: '',
    querySelectorAll(selector) {
      assert.equal(selector, '[data-action="select-policy-child"]');
      return [focusButton];
    },
  };

  await app.context.renderPolicies(content, { focusChildId: 2 });
  assert.equal(focused, true);
});

test('duplicate category names have distinct accessible names for apps and websites', () => {
  const app = fixture();
  app.context.policyCategoryGroups.app = [['entertainment', 'Giải trí', 'Ứng dụng giải trí.']];
  app.context.policyCategoryGroups.web = [['entertainment', 'Giải trí', 'Website giải trí.']];

  const appSelect = app.context.categoryPolicyGroup('app', 'Ứng dụng', true);
  const webSelect = app.context.categoryPolicyGroup('web', 'Website', true);
  assert.match(appSelect, /aria-label="Quyền truy cập Giải trí, danh mục Ứng dụng"/);
  assert.match(webSelect, /aria-label="Quyền truy cập Giải trí, danh mục Website"/);
  assert.match(appSelect, /name="policy_app_entertainment"/);
  assert.match(webSelect, /name="policy_web_entertainment"/);
});

test('policy save feedback describes changed settings when no category rule changed', async () => {
  const app = fixture({ api: async () => ({}) });
  app.state.policyRenderVersion = 1;
  app.state.policyBaselinesByChild['1'] = {
    settings: { enable_app_classification: false, enable_web_classification: false, enable_text_moderation: false },
    categories: { 'app:learning': 'allow', 'web:social': 'allow' },
  };
  const form = makeForm(1, { app: true }, 1);
  app.setForm(form);

  await app.context.savePolicyForm(form);

  assert.equal(app.toasts[0][0], 'Đã lưu chính sách');
  assert.equal(app.toasts[0][1], 'cài đặt phân loại của An đã được lưu.');
  assert.doesNotMatch(app.toasts[0][1], /0 quy tắc/);
  assert.equal(form.status.textContent, 'Chính sách đã lưu');
});

test('policy classification switches expose unique accessible names matching their visible labels', () => {
  const app = fixture();
  const controls = [
    ['enable_app_classification', 'Phân loại và chặn ứng dụng'],
    ['enable_web_classification', 'Phân loại website'],
    ['enable_text_moderation', 'Phân tích an toàn văn bản'],
  ];
  const ids = new Set();

  for (const [name, label] of controls) {
    const markup = app.context.switchRow(name, label, 'Mô tả hỗ trợ', false, true);
    const input = markup.match(/<input type="checkbox"[^>]*>/)?.[0];
    const labelledBy = input?.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelledBy, `${name} must reference its visible label`);
    assert.equal(ids.has(labelledBy), false, `${name} accessible name reference must be unique`);
    ids.add(labelledBy);
    const visibleLabel = markup.match(new RegExp(`<strong id="${labelledBy}">([^<]+)</strong>`))?.[1];
    assert.equal(visibleLabel, label, `${name} accessible name must match its function label`);
  }
  assert.equal(ids.size, 3);
});

test('policy selection, keyboard focus and switch hit area stay clear and usable', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(styles, /\.policy-settings-layout \.child-pick\.active\s*\{[^}]*border-color:\s*var\(--forest\)/s);
  assert.match(styles, /\.policy-settings-layout \.child-pick:hover:not\(\.active\)\s*\{[^}]*background:\s*var\(--cream\)/s);
  assert.match(styles, /\.policy-settings-layout \.switch\s*\{\s*width:\s*44px;\s*height:\s*44px;/);
  assert.match(styles, /\.policy-settings-layout \.switch input:focus-visible \+ span\s*\{[^}]*outline:\s*3px solid var\(--forest\)/s);
  assert.match(styles, /\.policy-settings-layout \.child-pick:focus-visible,[\s\S]*?outline:\s*3px solid var\(--forest\)/);
});

test('policy child metadata uses readable scoped type and the existing text token meets AA', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const globalMetadata = [...styles.matchAll(/(?:^|\n)\.child-pick small\s*\{([^}]*)\}/g)]
    .find(([, declarations]) => /font-size:\s*0\.65rem;/.test(declarations));
  const policyMetadata = styles.match(/\.policy-settings-layout \.child-pick small\s*\{([^}]*)\}/);
  const softInk = styles.match(/--ink-soft:\s*(#[\da-f]{6})/i)?.[1];
  const backgroundTokens = ['--paper', '--cream', '--mint-2'].map(name => [
    name,
    styles.match(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1],
  ]);

  assert.ok(globalMetadata);
  assert.match(globalMetadata[1], /font-size:\s*0\.65rem;/);
  assert.ok(policyMetadata, 'Policies has a scoped metadata rule');
  assert.match(policyMetadata[1], /font-size:\s*0\.875rem !important;/);
  assert.match(policyMetadata[1], /line-height:\s*1\.5;/);
  assert.ok(softInk, 'existing secondary text token should be present');
  for (const [name, background] of backgroundTokens) {
    assert.ok(background, `${name} surface token should be present`);
    assert.ok(contrastRatio(softInk, background) >= 4.5, `${softInk} must meet AA on ${name} ${background}`);
  }
  assert.match(styles, /\.policy-settings-layout \.child-pick > span:last-child,[\s\S]*?\.policy-settings-layout \.policy-group-head > div,[\s\S]*?overflow-wrap:\s*anywhere;/);
});

test('policy initial loading has text, remains busy, and uses existing reduced-motion support', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(source, /page === 'policies'[\s\S]{0,260}role="status" aria-live="polite" aria-atomic="true"[\s\S]{0,150}Đang tải chính sách\.\.\./);
  assert.match(source, /content\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /\.policies-loading\s*\{\s*gap:\s*12px;/);
});

test('policy typography improves reading size and keeps sync guidance visible on mobile', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const policyTypesetting = styles.slice(styles.indexOf('.page-head-policies h1 {'));

  assert.match(source, /class="policy-layout policy-settings-layout"/);
  assert.match(policyTypesetting, /\.policy-settings-layout \.policy-rule small\s*\{[^}]*font-size:\s*0\.875rem !important;[^}]*line-height:\s*1\.5;/s);
  assert.match(policyTypesetting, /\.policy-settings-layout \.policy-group-head small\s*\{[^}]*font-size:\s*0\.875rem !important;/s);
  assert.match(policyTypesetting, /\.policy-save-bar > span strong\s*\{[^}]*font-size:\s*1rem;/s);
  assert.match(policyTypesetting, /@media \(max-width:\s*610px\)[\s\S]*?\.policy-save-bar > span small\s*\{\s*display:\s*block;/);
  assert.match(source, /data-policy-sync-guidance/);
});

test('policy layout wraps long content and keeps mobile controls and statuses available', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  assert.match(styles, /\.policy-settings-layout \.child-pick > span:last-child,[\s\S]*?\.policy-save-bar > span\s*\{\s*min-width:\s*0;\s*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.policy-settings-layout \.child-pick\s*\{[^}]*min-height:\s*48px;/s);
  assert.match(styles, /\.policy-settings-layout \.policy-group-head \.badge\s*\{[^}]*white-space:\s*normal;/s);
  assert.match(styles, /\.policy-settings-layout \.policy-rule select\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles.match(/\.policy-settings-layout \.policy-action\s*\{([^}]*)\}/)[1], /min-height:\s*44px;/);
  assert.match(styles.match(/\.policy-settings-layout \.policy-save-bar \.btn\s*\{([^}]*)\}/)[1], /min-height:\s*44px;/);
  assert.match(styles, /\.policy-settings-layout \.policy-group-head\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /@media \(max-width:\s*610px\)\s*\{\s*\.policy-save-bar\s*\{\s*bottom:\s*calc\(86px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(styles, /@media \(max-width:\s*610px\)[\s\S]*?\.policy-settings-layout \.policy-action\s*\{\s*min-height:\s*44px;/);
  assert.match(styles, /@media \(max-height:\s*32rem\)\s*\{\s*\.policy-settings-layout \.policy-save-bar\s*\{\s*position:\s*static;/);
  assert.match(source, /data-policy-sync-guidance/);
  assert.match(source, /Chưa áp dụng/);
  assert.match(source, /Quy tắc được lưu nhưng chưa áp dụng khi phân loại tắt/);
});

test('policy workspace stacks at 1024px and narrower while keeping desktop columns', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const policyStyles = styles.slice(styles.lastIndexOf('/* Policy workspace:'));
  const desktopLayout = policyStyles.match(/\.policy-settings-layout\s*\{([^}]*)\}/);
  const responsiveLayout = policyStyles.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(desktopLayout, 'desktop policy layout rule exists');
  assert.match(desktopLayout[1], /grid-template-columns:\s*220px minmax\(0,\s*1fr\);/);
  assert.ok(responsiveLayout, 'policy responsive breakpoint exists');
  assert.equal(Number(responsiveLayout[1]), 1024);
  assert.match(responsiveLayout[2], /\.policy-settings-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s);

  for (const width of [1024, 768, 390, 320]) {
    assert.ok(width <= Number(responsiveLayout[1]), `${width}px is covered by the single-column breakpoint`);
  }
});

test('policy page removes repeated banners and outer card layers but keeps the task flow', () => {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const renderer = functionSource(source, 'renderPolicies');
  const groups = functionSource(source, 'categoryPolicyGroup');

  assert.doesNotMatch(renderer, /sectionVisual\('policies'\)|policy-summary-banner|class="card/);
  assert.match(renderer, /aria-labelledby="policy-child-picker-title"/);
  assert.match(renderer, /<article class="policy-form-panel">/);
  assert.match(renderer, /data-policy-draft-status role="status" aria-live="polite"/);
  assert.match(groups, /data-resource="\$\{resourceType\}"/);
  assert.match(groups, /data-policy-group-availability/);
  assert.match(functionSource(source, 'policyGroupView'), /Quy tắc được lưu nhưng chưa áp dụng khi phân loại tắt/);
  assert.match(styles, /\.policy-settings-layout \.policy-group\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.policy-settings-layout \.policy-save-bar\s*\{[^}]*box-shadow:\s*none;[^}]*backdrop-filter:\s*none;/s);
  assert.match(styles, /\.policy-settings-layout \.child-picker\s*\{[^}]*border-right:\s*1px solid var\(--line\);/s);
});
