import { api } from './api.js';
import { formatDate } from './dates.js';
import { deviceName } from './devices.js';
import { escapeHtml, localizeError, queryString, reconcileSelectedId } from './format.js';
import { state } from './state.js';
import { modalRoot, pageHead, showModal } from './ui.js';

// clearSession replaces state.chat; token refresh preserves it. No persistent AI storage.
const aiSessions = new WeakMap();

function riskLevelLabel(level) {
  return {
    low: 'Rủi ro thấp',
    medium: 'Cần lưu ý',
    high: 'Rủi ro cao',
    critical: 'Nghiêm trọng',
  }[String(level || '').toLowerCase()] || 'Chưa xác định';
}

function aiSession() {
  let session = aiSessions.get(state.chat);
  if (!session || session.userId !== state.userId) {
    session = { history: state.chat, userId: state.userId, view: null, draft: '',
      chatOperation: null, chatStatus: '', runs: new Map() };
    aiSessions.set(state.chat, session);
  }
  return session;
}

function aiBehaviorLabel(type) {
  return { learning: 'Học tập', entertainment: 'Giải trí', risk: 'Có rủi ro', normal: 'Thông thường' }[type] || type || 'Chưa xác định';
}

function aiSessionCurrent(session) {
  return state.chat === session.history && state.userId === session.userId
    && state.role === 'parent' && Boolean(state.accessToken);
}

function aiViewCurrent(view) {
  return Boolean(view && aiSessionCurrent(view.session) && state.page === 'ai'
    && view.session.view === view && view.content.aiView === view && view.content.isConnected
    && document.querySelector('#page-content') === view.content
    && view.content.querySelector('#ai-surface') === view.surface);
}

function aiViewFrom(node) {
  const view = node?.closest('#ai-surface')?.aiView;
  return aiViewCurrent(view) && view.surface.contains(node) ? view : null;
}

function aiStatus(view, id, message) {
  if (!aiViewCurrent(view)) return;
  const region = view.surface.querySelector(id);
  if (region.textContent !== message) region.textContent = message;
}

function aiFocus(view, origin) {
  const scope = view.scope;
  let moved = !origin || (document.activeElement !== origin && document.activeElement !== document.body);
  const focus = event => { if (event.target !== origin && event.target !== document.body) moved = true; };
  const pointer = event => { if (event.target !== origin && !origin?.contains(event.target)) moved = true; };
  document.addEventListener('focusin', focus);
  document.addEventListener('pointerdown', pointer);
  const owned = () => !moved && aiViewCurrent(view) && scope === view.scope
    && !modalRoot.firstElementChild && document.hasFocus?.() !== false;
  return {
    owned,
    restore(target) { if (owned() && target?.isConnected && view.surface.contains(target)) target.focus({ preventScroll: true }); },
    dispose() { document.removeEventListener('focusin', focus); document.removeEventListener('pointerdown', pointer); },
  };
}

function aiControls(view) {
  if (!aiViewCurrent(view)) return;
  const ready = view.deviceReady && Boolean(view.deviceId);
  const run = view.session.runs.get(view.deviceId);
  view.run = run;
  const running = run && ['posting', 'refreshing'].includes(run.phase);
  const button = view.surface.querySelector('[data-action="run-analysis"]');
  button.disabled = !ready || Boolean(running);
  button.setAttribute('aria-busy', String(Boolean(running)));
  button.textContent = run?.phase === 'posting' ? 'Đang phân tích…'
    : run?.phase === 'refreshing' ? 'Đang tải kết quả…' : 'Chạy phân tích mới';
  view.surface.querySelector('[data-action="latest-analysis"]').disabled = !ready || view.latest?.status === 'pending';
  for (const control of view.surface.querySelectorAll('[data-action="summary"]')) {
    control.disabled = !ready || (view.summary?.status === 'pending' && view.summary.period === control.dataset.period);
  }
  const message = !run ? '' : run.phase === 'posting' ? 'Đang phân tích thiết bị đang chọn…'
    : run.phase === 'refreshing' ? 'Phân tích đã hoàn thành. Đang tải lại kết quả…'
    : run.phase === 'refresh-error' ? 'Phân tích đã hoàn thành, nhưng chưa tải lại được kết quả.'
    : run.phase === 'no-result' ? run.error
    : run.phase === 'unconfirmed' ? `Chưa xác nhận được kết quả phân tích. ${run.error} Bạn có thể tải lại lịch sử để kiểm tra.`
    : 'Phân tích đã hoàn thành.';
  aiStatus(view, '#ai-analysis-status', message);
  const retry = view.surface.querySelector('#ai-analysis-retry');
  const retryNeeded = run && ['refresh-error', 'unconfirmed'].includes(run.phase);
  // Do not replace an unchanged retry button while it owns keyboard focus.
  if (retryNeeded && !retry.firstElementChild) retry.innerHTML = '<button class="btn btn-secondary" data-action="retry-ai-analysis">Tải lại kết quả</button>';
  else if (!retryNeeded && retry.firstElementChild) retry.innerHTML = '';
}

function aiChangeScope(view, deviceId) {
  if (!aiViewCurrent(view)) return;
  view.scope += 1;
  view.deviceId = String(deviceId || '');
  view.deviceReady = false;
  view.summary = null;
  view.summaryRequests = new Map();
  view.latest = null;
  state.selectedDeviceId = deviceId || null;
  state.analyses = [];
  view.surface.querySelector('#summary-result').innerHTML = '';
  view.surface.querySelector('#summary-result').setAttribute('aria-busy', 'false');
  aiStatus(view, '#ai-summary-status', '');
  aiStatus(view, '#ai-latest-status', '');
  aiControls(view);
}

async function loadAIHistory(view, origin = null) {
  if (!aiViewCurrent(view)) return { status: 'ignored' };
  const version = ++view.historyVersion;
  let scope = view.scope;
  const requestedDevice = view.deviceId;
  const current = () => aiViewCurrent(view) && version === view.historyVersion && scope === view.scope;
  const focus = aiFocus(view, origin);
  const history = view.surface.querySelector('#ai-history');
  state.analyses = [];
  view.historyPending = true;
  history.innerHTML = '';
  history.setAttribute('aria-busy', 'true');
  aiStatus(view, '#ai-history-status', requestedDevice
    ? `Đang tải phân tích của ${view.devices.find(d => String(d.device_id) === requestedDevice)?.device_name || 'thiết bị đang chọn'}…`
    : 'Đang tải thiết bị và phân tích…');
  try {
    const devices = (await api('/devices?limit=200')).data || [];
    if (!current()) return { status: 'ignored' };
    const selected = reconcileSelectedId(requestedDevice, devices, 'device_id');
    if (String(selected || '') !== view.deviceId) { aiChangeScope(view, selected); scope = view.scope; }
    view.devices = devices;
    state.devices = devices;
    state.selectedDeviceId = selected;
    view.deviceId = String(selected || '');
    view.deviceReady = true;
    const picker = view.surface.querySelector('#ai-device');
    picker.innerHTML = '<option value="">Chọn thiết bị</option>' + devices.map(d => `<option value="${escapeHtml(d.device_id)}" ${String(d.device_id) === view.deviceId ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('');
    picker.value = view.deviceId;
    aiControls(view);
    const rows = selected ? (await api(`/ai-analysis${queryString({ device_id: selected, limit: 50 })}`)).data || [] : [];
    if (!current()) return { status: 'ignored' };
    state.analyses = rows;
    history.innerHTML = rows.map(item => `<article class="analysis-card"><div class="ai-result-heading"><h3>${escapeHtml(aiBehaviorLabel(item.behavior_type))}</h3><span class="badge ${escapeHtml(String(item.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(item.risk_level))}</span></div><p>${escapeHtml(item.suggestion)}</p><div class="ai-result-meta">${escapeHtml(deviceName(item.device_id))} · Ghi nhận: <time>${formatDate(item.analyzed_at)}</time></div></article>`).join('') || `<div class="ai-empty"><h3>${selected ? 'Chưa có kết quả phân tích' : 'Chưa có thiết bị'}</h3><p>${selected ? 'Chọn “Chạy phân tích mới” để gửi yêu cầu cho thiết bị này.' : 'Thêm thiết bị ở trang Thiết bị để dùng phân tích và báo cáo. Bạn vẫn có thể trò chuyện với trợ lý.'}</p></div>`;
    const run = view.session.runs.get(view.deviceId);
    if (run && ['refreshing', 'refresh-error'].includes(run.phase)) run.phase = 'complete';
    aiStatus(view, '#ai-history-status', rows.length ? `Đã tải ${rows.length} kết quả phân tích.` : selected ? 'Chưa có phân tích.' : 'Chưa có thiết bị để phân tích.');
    return { status: 'loaded' };
  } catch (error) {
    if (!current()) return { status: 'ignored' };
    const run = view.session.runs.get(view.deviceId);
    if (run?.phase === 'refreshing') run.phase = 'refresh-error';
    aiStatus(view, '#ai-history-status', `Chưa tải được phân tích của thiết bị đang chọn. ${localizeError(error.message)}`);
    history.innerHTML = '<button class="btn btn-secondary" data-action="retry-ai-history">Tải lại kết quả</button>';
    return { status: 'error' };
  } finally {
    if (current()) {
      view.historyPending = false;
      history.setAttribute('aria-busy', 'false');
      aiControls(view);
      focus.restore(history.querySelector('[data-action="retry-ai-history"]') || history);
    }
    focus.dispose();
  }
}

async function runAIAnalysis(view, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId) return;
  const session = view.session, deviceId = view.deviceId;
  if (['posting', 'refreshing'].includes(session.runs.get(deviceId)?.phase)) return;
  const operation = { deviceId, phase: 'posting' };
  session.runs.set(deviceId, operation);
  const current = () => aiSessionCurrent(session) && session.runs.get(deviceId) === operation;
  const focus = aiFocus(view, button);
  let postCompleted = false;
  aiControls(view);
  try {
    await api(`/ai-analysis/analyze/${deviceId}`, { method: 'POST' });
    postCompleted = true;
    if (!current()) return;
    // A new mount may explicitly adopt this same pending operation; never use a route's main blindly.
    const target = session.view;
    if (aiViewCurrent(target) && target.deviceId === deviceId && target.run === operation) {
      operation.phase = 'refreshing';
      aiControls(target);
      await loadAIHistory(target);
    } else operation.phase = 'complete';
  } catch (error) {
    if (!current()) return;
    operation.phase = postCompleted ? 'refresh-error' : 'unconfirmed';
    if (['INSUFFICIENT_ACTIVITY', 'INVALID_AI_RESULT'].includes(error.payload?.code)) operation.phase = 'no-result';
    operation.error = localizeError(error.message);
  } finally {
    if (current()) {
      aiControls(session.view);
      focus.restore(button);
    }
    focus.dispose();
  }
}

async function requestAISummary(view, period, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId || !['daily', 'weekly'].includes(period)) return;
  if (view.summary?.status === 'pending' && view.summary.period === period) return;
  const scope = view.scope, deviceId = view.deviceId;
  const operation = view.summary = { period, deviceId, status: 'pending' };
  const current = () => aiViewCurrent(view) && view.scope === scope && view.summary === operation;
  const focus = aiFocus(view, button);
  const target = view.surface.querySelector('#summary-result');
  const label = `${period === 'daily' ? 'Báo cáo 1 ngày qua' : 'Báo cáo 7 ngày qua'} — ${deviceName(deviceId)}`;
  target.innerHTML = '';
  target.setAttribute('aria-busy', 'true');
  aiStatus(view, '#ai-summary-status', `Đang tạo ${label}…`);
  aiControls(view);
  try {
    // Switching daily -> weekly -> daily reuses the still-running daily GET,
    // but only the newest UI operation is allowed to display its response.
    let request = view.summaryRequests.get(period);
    if (!request) {
      request = {};
      view.summaryRequests.set(period, request);
      request.promise = (async () => {
        try { return await api(`/ai-analysis/summary/${deviceId}?period=${period}`); }
        finally { if (view.summaryRequests.get(period) === request) view.summaryRequests.delete(period); }
      })();
    }
    const result = await request.promise;
    if (!current()) return;
    operation.status = 'complete';
    target.innerHTML = `<div class="summary-box">${escapeHtml(result.summary)}</div>`;
    aiStatus(view, '#ai-summary-status', `Đã tải ${label}.`);
  } catch (error) {
    if (!current()) return;
    operation.status = 'error';
    aiStatus(view, '#ai-summary-status', `Chưa tạo được ${label}. ${localizeError(error.message)}`);
    target.innerHTML = `<p class="muted">${escapeHtml(label)}: chưa tải được báo cáo. ${escapeHtml(localizeError(error.message))}</p><button class="btn btn-secondary" data-action="retry-ai-summary" data-period="${period}">Thử lại báo cáo</button>`;
  } finally {
    if (current()) {
      target.setAttribute('aria-busy', 'false');
      aiControls(view);
      focus.restore(target.querySelector('[data-action="retry-ai-summary"]') || view.surface.querySelector(`[data-period="${period}"]`));
    }
    focus.dispose();
  }
}

function openAILatest(view, result) {
  if (!aiViewCurrent(view) || modalRoot.firstElementChild) return;
  showModal('Phân tích mới nhất', `${deviceName(result.device_id)} · ${formatDate(result.analyzed_at)}`, `<span class="badge ${escapeHtml(String(result.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(result.risk_level))}</span><h3>${escapeHtml(aiBehaviorLabel(result.behavior_type))}</h3><p class="muted analysis-suggestion">${escapeHtml(result.suggestion)}</p>`);
}

async function requestAILatest(view, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId || modalRoot.firstElementChild || view.latest?.status === 'pending') return;
  if (view.latest?.status === 'ready') {
    aiStatus(view, '#ai-latest-status', '');
    openAILatest(view, view.latest.result);
    view.latest = null;
    return;
  }
  const scope = view.scope, deviceId = view.deviceId;
  const operation = view.latest = { status: 'pending' };
  const current = () => aiViewCurrent(view) && scope === view.scope && view.latest === operation;
  const focus = aiFocus(view, button);
  aiStatus(view, '#ai-latest-status', 'Đang tải kết quả mới nhất…');
  aiControls(view);
  try {
    const result = await api(`/ai-analysis/latest/${deviceId}`);
    if (!current()) return;
    operation.result = result;
    operation.status = 'ready';
    // Re-enable before opening: the shared modal can then return focus to its trigger.
    aiControls(view);
    if (focus.owned()) {
      focus.restore(button);
      aiStatus(view, '#ai-latest-status', '');
      openAILatest(view, result);
      view.latest = null;
    } else aiStatus(view, '#ai-latest-status', 'Đã tải kết quả. Chọn “Xem phân tích mới nhất” để xem.');
  } catch (error) {
    if (!current()) return;
    operation.status = 'error';
    aiStatus(view, '#ai-latest-status', `Chưa tải được kết quả mới nhất. ${localizeError(error.message)} Chọn lại nút để thử lại.`);
  } finally {
    if (current()) { aiControls(view); focus.restore(button); }
    focus.dispose();
  }
}

function syncAIChat(view, messages = false) {
  if (!aiViewCurrent(view)) return;
  const session = view.session;
  view.chatOperation = session.chatOperation;
  const form = view.surface.querySelector('#chat-form');
  const input = form.querySelector('[name="message"]');
  input.value = session.draft;
  input.readOnly = Boolean(session.chatOperation);
  form.querySelector('[type="submit"]').disabled = Boolean(session.chatOperation);
  form.setAttribute('aria-busy', String(Boolean(session.chatOperation)));
  aiStatus(view, '#ai-chat-status', session.chatOperation ? 'Đang chờ phản hồi…' : session.chatStatus);
  if (messages) {
    const log = view.surface.querySelector('#chat-messages');
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = session.history.map(msg => `<div class="chat-bubble ${msg.role === 'user' ? 'user' : ''}">${escapeHtml(msg.content)}</div>`).join('');
    if (atEnd) log.scrollTop = log.scrollHeight;
  }
}

function captureAIChatDraft(input) {
  const view = aiViewFrom(input);
  if (view && input === view.surface.querySelector('#chat-form [name="message"]') && !view.session.chatOperation) view.session.draft = input.value;
}

async function submitAIChat(form) {
  const view = aiViewFrom(form);
  if (!view || view.session.chatOperation) return;
  const session = view.session, input = form.querySelector('[name="message"]');
  const text = input.value;
  if (!text || text.length > 2000) return;
  session.draft = text;
  const operation = session.chatOperation = { text };
  const current = () => aiSessionCurrent(session) && session.chatOperation === operation;
  const focus = aiFocus(view, document.activeElement);
  const messages = [...session.history, { role: 'user', content: text }].slice(-20).map(msg => ({ role: msg.role, content: msg.content }));
  syncAIChat(view);
  try {
    const result = await api('/ai-analysis/chat', { method: 'POST', body: { messages } });
    if (!current()) return;
    session.history.push({ role: 'user', content: text }, { role: 'model', content: result.reply });
    if (session.draft === text) session.draft = '';
    session.chatStatus = 'Đã nhận phản hồi.';
  } catch (error) {
    if (!current()) return;
    session.chatStatus = `Chưa nhận được phản hồi. ${localizeError(error.message)} Câu hỏi được giữ lại; bạn có thể gửi lại.`;
  } finally {
    if (current()) {
      session.chatOperation = null;
      const target = session.view;
      if (aiViewCurrent(target) && target.chatOperation === operation) syncAIChat(target, true);
      focus.restore(input);
    }
    focus.dispose();
  }
}

async function handleAIAction(button) {
  const view = aiViewFrom(button);
  if (!view) return;
  const action = button.dataset.action;
  if (action === 'run-analysis') return await runAIAnalysis(view, button);
  if (action === 'latest-analysis') return await requestAILatest(view, button);
  if (action === 'summary') return await requestAISummary(view, button.dataset.period, button);
  if (action === 'retry-ai-summary' && view.summary?.status === 'error' && view.summary.period === button.dataset.period) return await requestAISummary(view, view.summary.period, button);
  if (action === 'retry-ai-history' || action === 'retry-ai-analysis') {
    if (view.historyPending) return;
    const run = view.session.runs.get(view.deviceId);
    if (action === 'retry-ai-analysis' && run?.phase === 'refresh-error') run.phase = 'refreshing';
    aiControls(view);
    return await loadAIHistory(view, button);
  }
}

function changeAIDevice(picker) {
  const view = aiViewFrom(picker);
  if (!view) return;
  aiChangeScope(view, picker.value);
  view.historyTask = loadAIHistory(view);
  return view.historyTask;
}

async function renderAI(content) {
  if (state.page !== 'ai' || !content.isConnected || document.querySelector('#page-content') !== content) return;
  const session = aiSession();
  if (!aiSessionCurrent(session)) return;
  const view = { content, session, scope: 0, historyVersion: 0, devices: state.devices.slice(),
    deviceId: String(state.selectedDeviceId || ''), deviceReady: false, summary: null, summaryRequests: new Map(), latest: null };
  content.aiView = session.view = view;
  content.innerHTML = `
    <div id="ai-surface">
    ${pageHead('ai')}
    <section class="ai-toolbar" aria-labelledby="ai-analysis-title">
      <div class="ai-toolbar-copy"><h2 id="ai-analysis-title">Phân tích theo thiết bị</h2><p id="ai-device-scope">Phân tích nhật ký ứng dụng và website được ghi nhận trong 24 giờ qua của thiết bị đang chọn.</p></div>
      <div class="ai-toolbar-controls"><div class="ai-device-field"><label for="ai-device">Thiết bị phân tích và báo cáo</label><select class="select ai-device-select" id="ai-device" aria-describedby="ai-device-scope"><option value="">Chọn thiết bị</option>${state.devices.map((d) => `<option value="${escapeHtml(d.device_id)}" ${String(d.device_id) === String(state.selectedDeviceId) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select></div><button class="btn" data-action="run-analysis" disabled>Chạy phân tích mới</button></div>
      <div class="ai-run-feedback"><div id="ai-analysis-status" class="ai-status" role="status" aria-atomic="true"></div><div id="ai-analysis-retry"></div></div>
    </section>
    <div class="ai-layout">
      <section class="card ai-summary" aria-labelledby="ai-summary-title">
        <div class="card-head"><div><h2 id="ai-summary-title">Báo cáo tóm tắt</h2><p>Tạo theo yêu cầu cho thiết bị đang chọn, từ dữ liệu trong 1 hoặc 7 ngày qua.</p></div></div>
        <div class="ai-section-body"><div class="form-actions form-actions-start"><button class="btn btn-secondary" data-action="summary" data-period="daily" disabled>Tạo báo cáo 1 ngày</button><button class="btn btn-secondary" data-action="summary" data-period="weekly" disabled>Tạo báo cáo 7 ngày</button></div><p class="ai-note">Báo cáo tổng hợp thời lượng từ toàn bộ nhật ký trong khoảng thời gian đã chọn, riêng cho ứng dụng và website, cùng các cảnh báo trong kỳ. Tối đa 5 phiên ứng dụng và 5 phiên website dài nhất chỉ được dùng để minh họa.</p><div id="ai-summary-status" class="ai-status" role="status" aria-atomic="true"></div><div id="summary-result" aria-busy="false"></div></div>
      </section>
      <section class="card chat-card" aria-labelledby="ai-chat-title">
        <div class="chat-header"><h2 id="ai-chat-title">Trợ lý AI</h2><p id="ai-chat-context">Trả lời dựa trên tối đa 20 tin nhắn gần nhất, gồm câu hỏi mới; không tự đọc nhật ký hoặc kết quả phân tích của thiết bị.</p></div>
        <div class="chat-messages" id="chat-messages" role="region" aria-label="Nội dung trò chuyện" tabindex="0"></div>
        <div id="ai-chat-status" class="ai-status" role="status" aria-atomic="true"></div>
        <form id="chat-form" class="chat-form"><label for="ai-chat-input">Câu hỏi của bạn</label><div class="ai-chat-compose"><input class="input" id="ai-chat-input" name="message" maxlength="2000" required aria-describedby="ai-chat-context ai-chat-disclaimer" placeholder="Hỏi về thói quen số…"><button class="btn" type="submit" aria-label="Gửi câu hỏi">Gửi</button></div></form>
        <p id="ai-chat-disclaimer" class="ai-note">Không thay thế tư vấn y khoa hoặc tâm lý.</p>
      </section>
      <section class="card ai-history-panel" aria-labelledby="ai-history-title">
        <div class="card-head"><div><h2 id="ai-history-title">Lịch sử phân tích</h2><p>Tối đa 50 kết quả gần nhất của thiết bị đang chọn, mới nhất trước.</p></div><button class="btn btn-secondary btn-sm" data-action="latest-analysis" disabled>Xem phân tích mới nhất</button></div>
        <p class="ai-note ai-history-note">Kết quả chỉ mang tính tham khảo. “Rủi ro thấp” không đồng nghĩa trẻ chắc chắn an toàn.</p>
        <div id="ai-latest-status" class="ai-status" role="status" aria-atomic="true"></div><div id="ai-history-status" class="ai-status" role="status" aria-atomic="true"></div><div id="ai-history" tabindex="-1" aria-busy="false"></div>
      </section>
    </div></div>`;
  view.surface = content.querySelector('#ai-surface');
  view.surface.aiView = view;
  syncAIChat(view, true);
  const messages = view.surface.querySelector('#chat-messages');
  messages.scrollTop = messages.scrollHeight;
  aiControls(view);
  // Mount resolves immediately; navigation's focus cleanup must not wait for network responses.
  view.historyTask = loadAIHistory(view);
  return view;
}

export {
  captureAIChatDraft,
  changeAIDevice,
  handleAIAction,
  renderAI,
  submitAIChat,
};
