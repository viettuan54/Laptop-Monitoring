import { api } from './api.js';
import { childName } from './devices.js';
import { escapeHtml, initials, reconcileSelectedId } from './format.js';
import { state } from './state.js';
import { emptyState, pageHead, toast } from './ui.js';

let policySaveSequence = 0;

const policyCategoryGroups = {
  app: [
    ['learning', 'Học tập', 'Ứng dụng phục vụ học tập và sáng tạo.'],
    ['entertainment', 'Giải trí', 'Trò chơi, nội dung giải trí và đa phương tiện.'],
    ['browsers', 'Trình duyệt', 'Các trình duyệt web được Agent nhận diện.'],
    ['unknown', 'Chưa phân loại', 'Ứng dụng chưa có nhãn hoặc mới xuất hiện.'],
  ],
  web: [
    ['education', 'Giáo dục', 'Website học tập, tài liệu và nghiên cứu.'],
    ['entertainment', 'Giải trí', 'Video, âm nhạc và nội dung giải trí.'],
    ['social', 'Mạng xã hội', 'Mạng xã hội và nền tảng cộng đồng.'],
    ['unsafe', 'Không an toàn', 'Nội dung được hệ thống đánh giá có rủi ro.'],
    ['unknown', 'Chưa phân loại', 'Website chưa có nhãn hoặc chưa đủ dữ liệu.'],
  ],
};

const policyClassificationFields = [
  'enable_app_classification',
  'enable_web_classification',
  'enable_text_moderation',
];

function policySnapshotFromForm(form) {
  const settings = Object.fromEntries(policyClassificationFields.map((name) => [name, Boolean(form.elements[name]?.checked)]));
  const categories = {};
  Object.entries(policyCategoryGroups).forEach(([resourceType, categoryList]) => {
    categoryList.forEach(([category]) => {
      categories[`${resourceType}:${category}`] = form.elements[`policy_${resourceType}_${category}`]?.value || 'allow';
    });
  });
  return { settings, categories };
}

function policySnapshotsEqual(left, right) {
  if (!left || !right) return false;
  return policyClassificationFields.every((name) => Boolean(left.settings?.[name]) === Boolean(right.settings?.[name]))
    && Object.entries(policyCategoryGroups).every(([resourceType, categories]) => categories.every(([category]) => {
      const key = `${resourceType}:${category}`;
      return (left.categories?.[key] || 'allow') === (right.categories?.[key] || 'allow');
    }));
}

function updatePolicyDraftStatus(form, message) {
  const status = form?.querySelector('[data-policy-draft-status]');
  if (status) status.textContent = message;
  const syncGuidance = form?.querySelector('[data-policy-sync-guidance]');
  if (syncGuidance) syncGuidance.textContent = policySyncGuidanceForChild(String(form.dataset.childId));
}

function capturePolicyDraft(form) {
  if (!form || form.id !== 'policy-form') return null;
  const childId = String(form.dataset.childId);
  const snapshot = policySnapshotFromForm(form);
  const pending = state.policyPendingByChild[childId];
  const baseline = pending?.snapshot || state.policyBaselinesByChild[childId];
  if (!baseline) return null;

  if (policySnapshotsEqual(snapshot, baseline)) {
    delete state.policyDrafts[childId];
  } else {
    const existing = state.policyDrafts[childId];
    const revision = existing?.revision
      + (existing && policySnapshotsEqual(existing.snapshot, snapshot) ? 0 : 1) || 1;
    state.policyDrafts[childId] = { snapshot, revision };
  }

  if (String(state.selectedChildId) === childId) state.categoryPolicies = { ...snapshot.categories };
  if (pending) {
    updatePolicyDraftStatus(form, state.policyDrafts[childId]
      ? 'Đang lưu phiên bản đã gửi; bản nháp hiện tại chưa được lưu.'
      : 'Đang lưu chính sách...');
  } else {
    updatePolicyDraftStatus(form, policyStatusForChild(childId));
  }
  syncPolicyClassificationUI(form);
  return state.policyDrafts[childId] || null;
}

function policyStatusForChild(childId) {
  if (state.policyPendingByChild[childId]) {
    return state.policyDrafts[childId]
      ? 'Đang lưu phiên bản đã gửi; bản nháp hiện tại chưa được lưu.'
      : 'Đang lưu chính sách...';
  }
  const saveOutcome = state.policySaveErrors[childId];
  if (saveOutcome?.requiresRefresh) {
    return saveOutcome.kind === 'partial'
      ? 'Một phần thay đổi có thể đã được lưu. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.'
      : 'Chưa xác nhận được kết quả lưu. Bản nháp vẫn được giữ; hãy kiểm tra trạng thái trước khi thử lại.';
  }
  if (saveOutcome) {
    return state.policyDrafts[childId]
      ? 'Không lưu được. Bản nháp vẫn được giữ.'
      : 'Lần lưu trước không thành công';
  }
  if (state.policyDrafts[childId]) return 'Bản nháp chưa lưu';
  return 'Chính sách đã lưu';
}

function policySyncGuidanceForChild(childId) {
  const pending = state.policyPendingByChild[childId];
  const draft = state.policyDrafts[childId];
  const saveOutcome = state.policySaveErrors[childId];

  if (pending) {
    const hasNewDraft = draft && !policySnapshotsEqual(draft.snapshot, pending.snapshot);
    return hasNewDraft
      ? 'Đang lưu thay đổi đã gửi. Bản nháp hiện tại chưa được lưu; chưa thể coi là cấu hình sẽ được đồng bộ.'
      : 'Đang lưu chính sách. Chưa xác nhận cấu hình đã lưu hoặc thiết bị đã nhận.';
  }
  if (saveOutcome?.requiresRefresh) {
    return saveOutcome.kind === 'partial'
      ? 'Một phần thay đổi có thể đã được lưu. Hãy chọn “Kiểm tra trạng thái đã lưu” trước khi tiếp tục.'
      : 'Chưa xác nhận được kết quả lưu. Hãy chọn “Kiểm tra trạng thái đã lưu” trước khi tiếp tục.';
  }
  if (saveOutcome) return 'Lần lưu trước chưa thành công. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.';
  if (draft) return 'Bản nháp chưa được lưu, vì vậy chưa thể coi đây là cấu hình sẽ được đồng bộ.';
  if (!state.policyBaselinesByChild[childId]) return 'Chưa tải được trạng thái đã lưu; chưa thể xác nhận cấu hình nào sẽ được đồng bộ.';
  return 'Chính sách đã lưu sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo. Ứng dụng chưa xác nhận thiết bị đã nhận.';
}

function policySaveRequiresRefresh(childId) {
  return Boolean(state.policySaveErrors[childId]?.requiresRefresh);
}

function policySettingHasUncertainResult(childId, name) {
  const outcome = state.policySaveErrors[childId];
  return Boolean(outcome?.requiresRefresh && outcome.failedOperations?.some((operation) => operation.kind === 'settings'));
}

function policyGroupHasUncertainResult(childId, resourceType) {
  const outcome = state.policySaveErrors[childId];
  if (!outcome?.requiresRefresh) return false;
  if (outcome.failedOperations?.some((operation) => operation.kind === 'settings')) return true;
  const groupKeys = new Set(policyCategoryGroups[resourceType].map(([category]) => `${resourceType}:${category}`));
  return Boolean(outcome.failedOperations?.some((operation) => operation.kind === 'category' && groupKeys.has(operation.key)));
}

function policyClassificationSaveState(childId, name, value) {
  const pending = state.policyPendingByChild[childId];
  if (pending) return Boolean(pending.snapshot.settings?.[name]) === Boolean(value) ? 'Đang lưu' : 'Chưa lưu';
  if (policySettingHasUncertainResult(childId, name)) return 'Chưa xác định';
  const baseline = state.policyBaselinesByChild[childId];
  if (!baseline || baseline.settings?.[name] == null) return 'Chưa xác định';
  if (Boolean(baseline.settings[name]) === Boolean(value)) return 'Đã lưu';
  return state.policySaveErrors[childId] ? 'Lưu chưa thành công' : 'Chưa lưu';
}

function policyClassificationSaveNote(childId, name, value, saveState) {
  if (saveState === 'Đang lưu') return 'Đang lưu cấu hình; chưa xác nhận thiết bị đã nhận.';
  if (saveState === 'Chưa lưu') {
    return state.policyPendingByChild[childId]
      ? 'Thay đổi này chưa nằm trong lần lưu đang xử lý.'
      : 'Thay đổi này chưa được lưu.';
  }
  if (saveState === 'Lưu chưa thành công') return 'Bản nháp vẫn được giữ.';
  if (saveState === 'Chưa xác định') {
    return policySaveRequiresRefresh(childId)
      ? 'Chưa xác nhận kết quả lưu. Hãy kiểm tra lại trạng thái.'
      : 'Chưa tải được trạng thái đã lưu.';
  }
  if (!value) return 'Cấu hình đã lưu ở trạng thái tắt.';
  return '';
}

function policyGroupMatchesSnapshot(resourceType, enabled, snapshot) {
  if (!snapshot) return false;
  const settingName = resourceType === 'app' ? 'enable_app_classification' : 'enable_web_classification';
  if (Boolean(snapshot.settings?.[settingName]) !== Boolean(enabled)) return false;
  return policyCategoryGroups[resourceType].every(([category]) => {
    const key = `${resourceType}:${category}`;
    return (state.categoryPolicies[key] || 'allow') === (snapshot.categories?.[key] || 'allow');
  });
}

function policyGroupView(childId, resourceType, enabled) {
  const pending = state.policyPendingByChild[childId];
  const baseline = state.policyBaselinesByChild[childId];
  let saveState;
  if (pending) saveState = policyGroupMatchesSnapshot(resourceType, enabled, pending.snapshot) ? 'pending' : 'draft';
  else if (!baseline) saveState = 'unknown';
  else if (policyGroupHasUncertainResult(childId, resourceType)) saveState = 'error';
  else if (policyGroupMatchesSnapshot(resourceType, enabled, baseline)) saveState = 'saved';
  else saveState = state.policySaveErrors[childId] ? 'error' : 'draft';

  let message;
  if (saveState === 'pending') message = 'Đang lưu cấu hình. Chưa xác nhận thiết bị đã nhận.';
  else if (pending && saveState === 'draft') message = 'Thay đổi mới chưa được lưu; lần lưu trước vẫn đang xử lý.';
  else if (saveState === 'error') {
    message = 'Chưa xác nhận được kết quả lưu phần này. Bản nháp vẫn được giữ; hãy kiểm tra lại trước khi tiếp tục.';
  }
  else if (saveState === 'draft') {
    message = enabled
      ? 'Nhóm này có thay đổi chưa được lưu.'
      : 'Thay đổi chưa được lưu. Quy tắc sẽ ở trạng thái Chưa áp dụng khi phân loại tắt.';
  } else if (saveState === 'unknown') message = 'Chưa tải được trạng thái đã lưu.';
  else if (!enabled) message = 'Quy tắc được lưu nhưng chưa áp dụng khi phân loại tắt.';
  else message = 'Phân loại bật trong cấu hình đã lưu.';

  return {
    saveState,
    availability: enabled ? 'Phân loại bật' : 'Chưa áp dụng',
    message,
  };
}

function syncPolicyClassificationUI(form) {
  if (!form || form.id !== 'policy-form') return;
  const childId = String(form.dataset.childId);
  for (const name of policyClassificationFields) {
    const value = Boolean(form.elements[name]?.checked);
    const saveState = policyClassificationSaveState(childId, name, value);
    const stateNode = form.querySelector(`[data-policy-switch-status="${name}"]`);
    const noteNode = form.querySelector(`[data-policy-switch-note="${name}"]`);
    if (stateNode) {
      stateNode.textContent = saveState;
      stateNode.dataset.saveState = saveState;
    }
    if (noteNode) {
      noteNode.textContent = policyClassificationSaveNote(childId, name, value, saveState);
      noteNode.hidden = !noteNode.textContent;
    }
  }

  for (const [resourceType, settingName] of [
    ['app', 'enable_app_classification'],
    ['web', 'enable_web_classification'],
  ]) {
    const group = form.querySelector(`.policy-group[data-resource="${resourceType}"]`);
    if (!group) continue;
    const enabled = Boolean(form.elements[settingName]?.checked);
    const view = policyGroupView(childId, resourceType, enabled);
    const availability = group.querySelector('[data-policy-group-availability]');
    const explanation = group.querySelector('[data-policy-group-explanation]');
    if (availability) {
      availability.textContent = view.availability;
      availability.classList.toggle('neutral', !enabled);
    }
    if (explanation) explanation.textContent = view.message;
    if (group.classList) group.classList.toggle('classification-off', !enabled);
  }
}

function syncPolicyFormState(childId) {
  if (String(state.selectedChildId) !== String(childId) || state.page !== 'policies') return;
  const form = document.querySelector('#policy-form');
  if (!form || String(form.dataset.childId) !== String(childId)) return;
  const pending = state.policyPendingByChild[childId];
  const requiresRefresh = policySaveRequiresRefresh(childId);
  const submit = form.querySelector('[type="submit"]');
  const refreshButton = form.querySelector('[data-action="refresh-policy-state"]');
  const shouldRestoreFocus = submit && document.activeElement === submit;
  if (submit) {
    submit.disabled = Boolean(pending) || requiresRefresh;
    submit.textContent = pending ? 'Đang lưu chính sách...' : requiresRefresh ? 'Cần kiểm tra trạng thái' : 'Lưu chính sách';
  }
  if (refreshButton) refreshButton.hidden = !requiresRefresh;
  updatePolicyDraftStatus(form, policyStatusForChild(childId));
  syncPolicyClassificationUI(form);
  if (shouldRestoreFocus && requiresRefresh) refreshButton?.focus({ preventScroll: true });
}

async function savePolicyForm(form) {
  const childId = String(form.dataset.childId);
  if (!isCurrentPolicyForm(form) || state.policyPendingByChild[childId]) return;
  if (policySaveRequiresRefresh(childId)) {
    throw new Error('Hãy kiểm tra trạng thái đã lưu trước khi thử lại.');
  }
  const baseline = state.policyBaselinesByChild[childId];
  if (!baseline) throw new Error('Chưa tải được chính sách hiện tại. Hãy tải lại rồi thử lại.');

  const snapshot = policySnapshotFromForm(form);
  capturePolicyDraft(form);
  const settingsBody = Object.fromEntries(policyClassificationFields.map((name) => [name, snapshot.settings[name]]));
  const classificationSettingsChanged = policyClassificationFields.some((name) =>
    Boolean(baseline.settings?.[name]) !== snapshot.settings[name]
  );
  const policyUpdates = [];
  Object.entries(policyCategoryGroups).forEach(([resourceType, categories]) => {
    categories.forEach(([category]) => {
      const key = `${resourceType}:${category}`;
      const action = snapshot.categories[key] || 'allow';
      if (action !== (baseline.categories?.[key] || 'allow')) {
        policyUpdates.push({ resourceType, category, action });
      }
    });
  });
  const operations = [
    ...(classificationSettingsChanged ? [{
      kind: 'settings',
      descriptor: { kind: 'settings' },
      send: () => api(`/settings/${childId}`, { method: 'PUT', body: settingsBody }),
    }] : []),
    ...policyUpdates.map(({ resourceType, category, action }) => ({
      kind: 'category',
      key: `${resourceType}:${category}`,
      action,
      descriptor: { kind: 'category', key: `${resourceType}:${category}` },
      send: () => api(`/settings/${childId}/policies/${resourceType}/${category}`, { method: 'PUT', body: { action } }),
    })),
  ];

  const token = ++policySaveSequence;
  state.policyPendingByChild[childId] = { token, snapshot };
  state.policyDataVersions[childId] = (state.policyDataVersions[childId] || 0) + 1;
  delete state.policySaveErrors[childId];
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Đang lưu chính sách...';
  }
  updatePolicyDraftStatus(form, 'Đang lưu chính sách...');
  syncPolicyClassificationUI(form);

  try {
    const results = await Promise.allSettled(operations.map((operation) => {
      try { return operation.send(); } catch (error) { return Promise.reject(error); }
    }));
    if (state.policyPendingByChild[childId]?.token !== token) return;

    const confirmedSnapshot = {
      settings: { ...(baseline.settings || {}) },
      categories: { ...(baseline.categories || {}) },
    };
    const failedOperations = [];
    results.forEach((result, index) => {
      const operation = operations[index];
      if (result.status === 'rejected') {
        failedOperations.push(operation.descriptor);
      } else if (operation.kind === 'settings') {
        confirmedSnapshot.settings = { ...snapshot.settings };
      } else {
        confirmedSnapshot.categories[operation.key] = operation.action;
      }
    });
    state.policyBaselinesByChild[childId] = confirmedSnapshot;

    const currentDraft = state.policyDrafts[childId];
    if (failedOperations.length) {
      state.policyDrafts[childId] = {
        snapshot: currentDraft?.snapshot || snapshot,
        revision: currentDraft?.revision || 1,
      };
      const succeededCount = results.length - failedOperations.length;
      const kind = succeededCount ? 'partial' : 'failed';
      state.policySaveErrors[childId] = { kind, requiresRefresh: true, failedOperations };
      const message = kind === 'partial'
        ? 'Một phần thay đổi có thể đã được lưu. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.'
        : 'Chưa xác nhận được kết quả lưu. Bản nháp vẫn được giữ; hãy kiểm tra trạng thái trước khi thử lại.';
      throw new Error(message);
    }

    if (currentDraft && policySnapshotsEqual(currentDraft.snapshot, snapshot)) delete state.policyDrafts[childId];
    delete state.policySaveErrors[childId];
    const child = state.children.find((item) => String(item.child_id) === childId);
    const savedChanges = [];
    if (classificationSettingsChanged) savedChanges.push('cài đặt phân loại');
    if (policyUpdates.length) savedChanges.push(`${policyUpdates.length} quy tắc truy cập theo danh mục`);
    const childName = child?.name || 'hồ sơ trẻ';
    const savedMessage = savedChanges.length
      ? `${savedChanges.join(' và ')} của ${childName} đã được lưu.`
      : `Không có thay đổi mới cho ${childName}.`;
    toast('Đã lưu chính sách', savedMessage);
  } catch (error) {
    if (state.policyPendingByChild[childId]?.token === token && !policySaveRequiresRefresh(childId)) {
      state.policySaveErrors[childId] = {
        kind: 'failed',
        requiresRefresh: true,
        failedOperations: operations.map((operation) => operation.descriptor),
      };
      if (!state.policyDrafts[childId]) state.policyDrafts[childId] = { snapshot, revision: 1 };
    }
    throw error;
  } finally {
    if (state.policyPendingByChild[childId]?.token === token) {
      delete state.policyPendingByChild[childId];
      state.policyDataVersions[childId] = (state.policyDataVersions[childId] || 0) + 1;
      syncPolicyFormState(childId);
    }
  }
}

function isCurrentPolicyForm(form) {
  return form?.isConnected && state.page === 'policies'
    && String(state.selectedChildId) === String(form.dataset.childId)
    && Number(form.dataset.renderVersion) === state.policyRenderVersion
    && document.querySelector('#policy-form') === form;
}

async function renderPolicies(content, { focusChildId } = {}) {
  const renderVersion = ++state.policyRenderVersion;
  const requestedChildId = state.selectedChildId == null ? '' : String(state.selectedChildId);
  let children;
  try {
    children = await api('/children?limit=200');
  } catch (error) {
    if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
      || String(state.selectedChildId ?? '') !== requestedChildId) return;
    throw error;
  }
  if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
    || String(state.selectedChildId ?? '') !== requestedChildId) return;
  state.children = children;
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  if (!state.selectedChildId) {
    state.categoryPolicies = {};
    content.innerHTML = pageHead('policies') + emptyState('⚙', 'Cần có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi cấu hình chính sách.', '<button class="btn" data-page="children">Đến trang hồ sơ trẻ</button>');
    return;
  }

  const childId = String(state.selectedChildId);
  const childDataVersion = state.policyDataVersions[childId] || 0;
  let settings;
  let policyResult;
  try {
    [settings, policyResult] = await Promise.all([
      api(`/settings/${childId}`),
      api(`/settings/${childId}/policies`),
    ]);
  } catch (error) {
    if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
      || String(state.selectedChildId) !== childId
      || (state.policyDataVersions[childId] || 0) !== childDataVersion) return;
    throw error;
  }
  if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
    || String(state.selectedChildId) !== childId
    || (state.policyDataVersions[childId] || 0) !== childDataVersion) return;

  const savedCategories = Object.fromEntries(
    (policyResult.policies || []).map((item) => [`${item.resource_type}:${item.category}`, item.action])
  );
  const savedSnapshot = {
    settings: Object.fromEntries(policyClassificationFields.map((name) => [name, Boolean(settings[name])])),
    categories: savedCategories,
  };
  state.policyBaselinesByChild[childId] = savedSnapshot;
  const draft = state.policyDrafts[childId];
  if (draft && policySnapshotsEqual(draft.snapshot, savedSnapshot)) delete state.policyDrafts[childId];
  delete state.policySaveErrors[childId];
  const visibleDraft = state.policyDrafts[childId];
  const pending = state.policyPendingByChild[childId];
  const visibleSnapshot = visibleDraft?.snapshot || pending?.snapshot || savedSnapshot;
  const visibleSettings = { ...settings, ...visibleSnapshot.settings };
  state.categoryPolicies = { ...visibleSnapshot.categories };
  const policyStatus = policyStatusForChild(childId);
  const refreshRequired = policySaveRequiresRefresh(childId);
  const saveButton = pending
    ? '<button class="btn" type="submit" disabled>Đang lưu chính sách...</button>'
    : `<button class="btn" type="submit" ${refreshRequired ? 'disabled' : ''}>${refreshRequired ? 'Cần kiểm tra trạng thái' : 'Lưu chính sách'}</button>`;
  const refreshButton = `<button class="btn btn-secondary policy-state-refresh" type="button" data-action="refresh-policy-state" data-id="${escapeHtml(childId)}" ${refreshRequired ? '' : 'hidden'}>Kiểm tra trạng thái đã lưu</button>`;
  content.innerHTML = `
    ${pageHead('policies')}
    <section class="policy-layout policy-settings-layout">
      <aside class="child-picker" aria-labelledby="policy-child-picker-title"><h2 id="policy-child-picker-title">Chọn hồ sơ trẻ</h2>${state.children.map((child) => `<button class="child-pick ${String(child.child_id) === childId ? 'active' : ''}" type="button" aria-pressed="${String(child.child_id) === childId}" data-action="select-policy-child" data-id="${child.child_id}"><span class="mini-avatar">${escapeHtml(initials(child.name))}</span><span><strong>${escapeHtml(child.name)}</strong><small>${child.age == null ? 'Chưa có thông tin tuổi' : `${escapeHtml(child.age)} tuổi`}</small></span></button>`).join('')}</aside>
      <article class="policy-form-panel">
        <form id="policy-form" class="form-grid" data-child-id="${escapeHtml(childId)}" data-render-version="${renderVersion}">
          <section class="setting-section"><h3>Phân loại AI & truy cập</h3><p>Chỉ phân loại và áp dụng chính sách Cho phép/Chặn khi công tắc tương ứng được bật. Khi tắt, nội dung đó được truy cập bình thường.</p>
            ${switchRow('enable_app_classification', 'Phân loại và chặn ứng dụng', 'Ứng dụng thuộc nhóm chặn sẽ nhận yêu cầu đóng; Agent buộc thoát sau 8 giây nếu vẫn chạy. Nội dung chưa lưu có thể bị mất.', visibleSettings.enable_app_classification, true)}
            ${switchRow('enable_web_classification', 'Phân loại website', 'Gán một trong 5 nhãn website rồi áp dụng chính sách truy cập.', visibleSettings.enable_web_classification, true)}
            ${switchRow('enable_text_moderation', 'Phân tích an toàn văn bản', 'Phân tích câu tìm kiếm mới của bé: SAFE không tạo cảnh báo; RISK nhắc phụ huynh quan sát bé trong thời gian này; HIGH_RISK cảnh báo bé có dấu hiệu bị bạo lực. Chưa phân tích nội dung trang hoặc chat. Không lưu nguyên văn câu tìm kiếm trên máy chủ. Thay đổi cần thời gian đồng bộ tới thiết bị.', visibleSettings.enable_text_moderation, true)}
          </section>
          <section class="setting-section"><h3>Quyền truy cập theo danh mục</h3><p>Chọn Cho phép hoặc Chặn cho từng nhóm. Với website, Agent ghi nhớ tên miền đã được AI phân loại và chặn các lần truy cập tiếp theo khi nhóm tương ứng đang chọn Chặn.</p>
            <div class="policy-groups">
              ${categoryPolicyGroup('app', 'Ứng dụng', visibleSettings.enable_app_classification)}
              ${categoryPolicyGroup('web', 'Website', visibleSettings.enable_web_classification)}
            </div>
          </section>
          <div class="form-actions policy-save-bar field full"><span><strong data-policy-draft-status role="status" aria-live="polite" aria-atomic="true">${policyStatus}</strong><small data-policy-sync-guidance>${escapeHtml(policySyncGuidanceForChild(childId))}</small></span>${refreshButton}${saveButton}</div>
        </form>
      </article>
    </section>`;
  if (focusChildId != null) {
    [...content.querySelectorAll('[data-action="select-policy-child"]')]
      .find((button) => String(button.dataset.id) === String(focusChildId))
      ?.focus({ preventScroll: true });
  }
}

function categoryPolicyGroup(resourceType, title, enabled) {
  const view = policyGroupView(String(state.selectedChildId), resourceType, enabled);
  return `<article class="policy-group ${enabled ? '' : 'classification-off'}" data-resource="${resourceType}"><div class="policy-group-head"><div><strong>${title}</strong><small data-policy-group-explanation>${escapeHtml(view.message)}</small></div><span class="badge ${enabled ? '' : 'neutral'}" data-policy-group-availability>${view.availability}</span></div><div class="policy-rule-list">${policyCategoryGroups[resourceType].map(([category, label, description]) => {
    const key = `${resourceType}:${category}`;
    const action = state.categoryPolicies[key] || 'allow';
    const descriptionId = `policy-${resourceType}-${category}-description`;
    return `<label class="policy-rule"><span><strong>${label}</strong><small id="${descriptionId}">${description}</small></span><select class="select policy-action ${action}" name="policy_${resourceType}_${category}" aria-label="Quyền truy cập ${label}, danh mục ${title}" aria-describedby="${descriptionId}"><option value="allow" ${action === 'allow' ? 'selected' : ''}>Cho phép</option><option value="block" ${action === 'block' ? 'selected' : ''}>Chặn</option></select></label>`;
  }).join('')}</div></article>`;
}

function switchRow(name, label, text, checked, policyClassification = false) {
  const childId = String(state.selectedChildId);
  const saveState = policyClassification ? policyClassificationSaveState(childId, name, checked) : '';
  const saveNote = policyClassification ? policyClassificationSaveNote(childId, name, checked, saveState) : '';
  const labelId = policyClassification ? `policy-${name}-label` : '';
  const labelMarkup = policyClassification ? `<strong id="${labelId}">${label}</strong>` : `<strong>${label}</strong>`;
  const accessibleName = policyClassification
    ? `aria-labelledby="${labelId}" aria-describedby="policy-${name}-description policy-${name}-status policy-${name}-note"`
    : '';
  const descriptionMarkup = policyClassification
    ? `<small id="policy-${name}-description">${text}</small>`
    : `<small>${text}</small>`;
  const policyState = policyClassification
    ? `<small id="policy-${name}-status" class="policy-switch-status" data-policy-switch-status="${name}" data-save-state="${saveState}">${saveState}</small><small id="policy-${name}-note" class="policy-switch-note" data-policy-switch-note="${name}" ${saveNote ? '' : 'hidden'}>${saveNote}</small>`
    : '';
  return `<div class="switch-row"><div class="switch-copy">${labelMarkup}${descriptionMarkup}${policyState}</div><label class="switch"><input type="checkbox" name="${name}" ${accessibleName} ${checked ? 'checked' : ''}><span></span></label></div>`;
}

export {
  capturePolicyDraft,
  isCurrentPolicyForm,
  policyCategoryGroups,
  policySaveRequiresRefresh,
  renderPolicies,
  savePolicyForm,
  switchRow,
  syncPolicyFormState,
};
