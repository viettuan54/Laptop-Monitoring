import { websiteActivityTitle } from './activity.js';
import { alertPresentation, refreshUnreadAlertCount, updateAlertIndicator } from './alerts.js';
import { api } from './api.js';
import {
  currentDateLabel,
  emptyUsageSummary,
  localDateFromKey,
  localDateKey,
  localMonthKey,
  shiftLocalDateKey,
} from './dates.js';
import { childName, deviceName, isDeviceOnline } from './devices.js';
import {
  categoryBadge,
  categoryLabel,
  duration,
  escapeHtml,
  reconcileSelectedId,
  relativeTime,
} from './format.js';
import { state } from './state.js';
import { icons } from './ui.js';

let overviewRenderSequence = 0;

function normalizeUsageSummary(value, requestedMonth = localMonthKey()) {
  const month = /^\d{4}-\d{2}$/.test(String(value?.month || ''))
    ? String(value.month)
    : requestedMonth;
  const daily = Array.isArray(value?.daily)
    ? value.daily
      .map((item) => ({
        date: String(item?.date || '').slice(0, 10),
        duration_seconds: Math.max(0, Number(item?.duration_seconds) || 0),
      }))
      .filter((item) => localDateFromKey(item.date) && item.date.startsWith(`${month}-`))
    : [];
  return {
    month,
    timezone: String(value?.timezone || ''),
    daily,
    recent_daily: [],
    month_total_seconds: Math.max(0, Number(value?.month_total_seconds) || 0),
    today_seconds: Math.max(0, Number(value?.today_seconds) || 0),
    ignored_segment_count: Math.max(0, Number(value?.ignored_segment_count) || 0),
    max_valid_agent_segment_seconds: Math.max(
      0,
      Number(value?.max_valid_agent_segment_seconds) || 0
    ),
  };
}

async function loadOverviewUsageSummary(today = new Date(), childId = '') {
  const currentDate = localDateKey(today);
  const currentMonth = currentDate.slice(0, 7);
  const recentStart = shiftLocalDateKey(currentDate, -6);
  const months = [...new Set([currentMonth, recentStart.slice(0, 7)])];
  const summaries = await Promise.all(months.map(async (month) => {
    const path = `/logs/usage-summary?month=${month}${childId ? `&child_id=${encodeURIComponent(childId)}` : ''}`;
    return normalizeUsageSummary(await api(path), month);
  }));
  const current = summaries.find((summary) => summary.month === currentMonth)
    || emptyUsageSummary(currentMonth);
  const secondsByDate = new Map(
    summaries.flatMap((summary) => summary.daily)
      .map((item) => [item.date, item.duration_seconds])
  );
  const recentDaily = Array.from({ length: 7 }, (_, index) => {
    const key = shiftLocalDateKey(currentDate, index - 6);
    return { date: key, duration_seconds: secondsByDate.get(key) || 0 };
  });
  return { ...current, recent_daily: recentDaily };
}

function usageMetricParts(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return { value: minutes, unit: 'phút' };
  return {
    value: new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(minutes / 60),
    unit: 'giờ',
  };
}

function usageDaysInMonth(summary) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(summary?.month || ''));
  if (!match) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const count = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const secondsByDate = new Map((summary.daily || []).map((item) => [item.date, item.duration_seconds]));
  const todayKey = localDateKey();
  return Array.from({ length: count }, (_, index) => {
    const key = `${summary.month}-${String(index + 1).padStart(2, '0')}`;
    return {
      date: key,
      label: String(index + 1),
      seconds: Math.max(0, Number(secondsByDate.get(key)) || 0),
      isToday: key === todayKey,
    };
  });
}

function usageRecentDays(summary) {
  return (summary.recent_daily || []).map((item) => {
    const date = localDateFromKey(item.date);
    return {
      date: item.date,
      label: date
        ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'UTC' }).format(date)
        : item.date,
      seconds: Math.max(0, Number(item.duration_seconds) || 0),
    };
  });
}

function usageMonthLabel(month) {
  const date = localDateFromKey(`${month}-01`);
  return date
    ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : month;
}

async function loadParentCore(usageChildId = state.overviewChildId) {
  const overviewNow = new Date();
  const usageMonth = localMonthKey(overviewNow);
  const resources = [
    { key: 'children', label: 'hồ sơ trẻ', request: api('/children?limit=200'), pick: (value) => value || [] },
    { key: 'devices', label: 'thiết bị', request: api('/devices?limit=200'), pick: (value) => value.data || [] },
    { key: 'alerts', label: 'cảnh báo', request: api('/alerts?limit=200'), pick: (value) => value.data || [] },
    { key: 'analyses', label: 'phân tích AI', request: api('/ai-analysis?limit=50'), pick: (value) => value.data || [] },
    { key: 'appLogs', label: 'hoạt động ứng dụng', request: api('/logs/app?limit=200'), pick: (value) => value.data || [] },
    { key: 'webLogs', label: 'hoạt động website', request: api('/logs/web?limit=200'), pick: (value) => value.data || [] },
    { key: 'usageSummary', label: `tổng hợp sử dụng tháng ${usageMonth}`, request: loadOverviewUsageSummary(overviewNow, usageChildId), pick: (value) => value },
  ];
  const [results, unreadError] = await Promise.all([
    Promise.allSettled(resources.map((resource) => resource.request)),
    refreshUnreadAlertCount().then(() => null, (error) => error),
  ]);
  state.parentLoadErrors = unreadError ? ['cảnh báo chưa đọc'] : [];
  results.forEach((result, index) => {
    const resource = resources[index];
    if (result.status === 'fulfilled') {
      if (resource.key === 'usageSummary' && String(state.overviewChildId) !== String(usageChildId)) return;
      state[resource.key] = resource.pick(result.value);
    } else {
      state.parentLoadErrors.push(resource.label);
    }
  });
  if (state.overviewChildId && !state.children.some((item) => String(item.child_id) === String(state.overviewChildId))) {
    state.overviewChildId = '';
  }
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  state.selectedDeviceId = reconcileSelectedId(state.selectedDeviceId, state.devices, 'device_id');
  updateAlertIndicator();
}

async function renderOverview(content) {
  const renderSequence = ++overviewRenderSequence;
  const usageChildId = state.overviewChildId;
  await loadParentCore(usageChildId);
  if (renderSequence !== overviewRenderSequence || !document.body.contains(content) || state.page !== 'overview') return;
  const unread = state.unreadAlertCount;
  const usageSummary = state.usageSummary || emptyUsageSummary();
  const todayUsage = usageMetricParts(usageSummary.today_seconds);
  const monthUsage = usageMetricParts(usageSummary.month_total_seconds);
  const monthDays = usageDaysInMonth(usageSummary);
  const recentDays = usageRecentDays(usageSummary);
  const recentTotalSeconds = recentDays.reduce((sum, item) => sum + item.seconds, 0);
  const recentMaxSeconds = Math.max(...recentDays.map((item) => item.seconds), 1);
  const monthMaxSeconds = Math.max(...monthDays.map((item) => item.seconds), 1);
  const risky = state.analyses.filter((item) => ['high', 'critical'].includes(String(item.risk_level).toLowerCase())).length;
  const onlineDevices = state.devices.filter(isDeviceOnline).length;
  const usageScopeName = state.overviewChildId ? childName(state.overviewChildId) : 'Toàn gia đình';
  const hasActivity = usageSummary.month_total_seconds > 0 || state.appLogs.length + state.webLogs.length > 0;
  const setupSteps = [
    { done: state.children.length > 0, label: 'Tạo hồ sơ trẻ', page: 'children' },
    { done: state.devices.length > 0, label: 'Đăng ký thiết bị', page: 'devices' },
    { done: onlineDevices > 0, label: 'Kết nối Agent', page: 'devices' },
    { done: hasActivity, label: 'Nhận dữ liệu hoạt động', page: 'activity' },
  ];
  // Category shares still use recent app logs; usage totals and charts use the aggregate.
  const categories = state.appLogs.reduce((map, item) => {
    const key = item.category || 'unknown';
    map[key] = (map[key] || 0) + (Number(item.duration_seconds) || 0);
    return map;
  }, {});
  const categorySampleSeconds = Object.values(categories).reduce((sum, seconds) => sum + seconds, 0);
  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const loadErrors = state.parentLoadErrors;
  const usageUnavailable = loadErrors.some((label) => label.startsWith('tổng hợp sử dụng'));
  const alertsUnavailable = loadErrors.includes('cảnh báo');
  const unreadUnavailable = loadErrors.includes('cảnh báo chưa đọc');
  const activityUnavailable = loadErrors.includes('hoạt động ứng dụng') || loadErrors.includes('hoạt động website');
  const recentAlerts = state.alerts.filter((item) => !item.is_read).slice(0, 5);
  const recentActivity = [...state.appLogs.map((item) => ({ ...item, type: 'app', at: item.start_time, title: item.app_name })),
    ...state.webLogs.map((item) => ({ ...item, type: 'web', at: item.visit_time, title: websiteActivityTitle(item) }))]
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6);
  const partialNotice = loadErrors.length
    ? `<div class="overview-notice" role="status"><strong>Một phần dữ liệu chưa cập nhật được</strong><p>Hãy chọn Làm mới để thử lại: ${escapeHtml(loadErrors.join(', '))}. Các danh sách đã tải trước đó được giữ lại nếu có.</p></div>`
    : '';
  const usageQualityNotice = usageSummary.ignored_segment_count > 0
    ? `<details class="usage-quality-note"><summary>Đã bỏ qua ${usageSummary.ignored_segment_count} đoạn thời gian bất thường</summary><p>Các đoạn có thể phát sinh khi máy khóa hoặc ngủ${usageSummary.max_valid_agent_segment_seconds ? ` và dài hơn ${duration(usageSummary.max_valid_agent_segment_seconds)}` : ''}. Bản ghi gốc vẫn được giữ nguyên để kiểm tra và đối chiếu.</p></details>`
    : '';
  const restoreScopeFocus = document.activeElement?.id === 'overview-child';
  const monthExpanded = content.querySelector('.overview-month')?.open;
  const weekDescription = recentDays.map((day) => `${day.label}: ${duration(day.seconds)}`).join('; ');
  const monthDescription = monthDays.map((day) => `Ngày ${day.label}: ${duration(day.seconds)}`).join('; ');

  content.innerHTML = `
    <div class="overview-page">
      <header class="overview-header">
        <div><h1>Tổng quan gia đình</h1><p>${escapeHtml(currentDateLabel())}</p></div>
        <button class="btn btn-secondary" data-action="refresh-overview">${icons.refresh} Làm mới</button>
      </header>
      ${partialNotice}
      <div class="overview-family-status" aria-label="Thiết bị và hồ sơ toàn gia đình">
        <p><strong>${loadErrors.includes('thiết bị') ? 'Chưa cập nhật được kết nối thiết bị' : onlineDevices ? `${onlineDevices} thiết bị đang trực tuyến` : state.devices.length ? 'Không có thiết bị đang trực tuyến' : 'Chưa có thiết bị kết nối'}</strong></p>
        <div class="overview-family-links">
          <button class="link-button" data-page="devices">${loadErrors.includes('thiết bị') ? 'Xem thiết bị' : `${state.devices.length} thiết bị`}</button>
          <button class="link-button" data-page="children">${loadErrors.includes('hồ sơ trẻ') ? 'Xem hồ sơ trẻ' : `${state.children.length} hồ sơ trẻ`}</button>
          <button class="link-button" data-page="policies">Điều chỉnh chính sách</button>
        </div>
      </div>
      <div class="overview-priority">
        <section class="overview-alerts" aria-labelledby="overview-alerts-title">
          <div class="overview-section-heading">
            <div><h2 id="overview-alerts-title">Cảnh báo cần chú ý</h2><p>Toàn gia đình · <strong class="overview-alert-count">${unreadUnavailable ? 'Chưa cập nhật được số chưa đọc' : `${unread} cảnh báo chưa đọc`}</strong></p></div>
            <button class="link-button" data-page="alerts">Xem tất cả cảnh báo</button>
          </div>
          ${alertsUnavailable ? '<p class="overview-inline-status" role="status">Chưa cập nhật được danh sách cảnh báo. Dữ liệu bên dưới, nếu có, là lần tải trước.</p>' : ''}
          ${recentAlerts.length ? `<ul class="overview-alert-list">${recentAlerts.map((item) => {
            const presentation = alertPresentation(item.alert_type);
            return `<li><span class="overview-alert-type ${presentation.tone}">${escapeHtml(presentation.label)}</span><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.created_at)}</small></li>`;
          }).join('')}</ul>` : alertsUnavailable || unreadUnavailable ? '<p class="overview-empty">Chưa đủ dữ liệu để xác định cảnh báo mới. Hãy thử làm mới.</p>' : unread ? '<p class="overview-empty">Mở tất cả cảnh báo để xem các mục chưa đọc.</p>' : '<p class="overview-empty">Chưa có cảnh báo mới.</p>'}
          <div class="overview-analysis-link">
            <button class="link-button" data-page="ai">Xem phân tích AI</button>
            ${loadErrors.includes('phân tích AI') ? '<span>Chưa cập nhật được phân tích.</span>' : risky ? `<span>${risky} kết quả phân tích có rủi ro cao · thống kê riêng.</span>` : ''}
          </div>
        </section>
        <section class="overview-usage-summary" aria-labelledby="overview-usage-title">
          <h2 id="overview-usage-title">Thời gian sử dụng</h2>
          <label class="overview-scope-control"><span>Thời gian sử dụng của</span><select class="select" id="overview-child" aria-describedby="overview-scope-help"><option value="">Toàn gia đình</option>${state.children.map((child) => `<option value="${child.child_id}" ${String(child.child_id) === String(state.overviewChildId) ? 'selected' : ''}>${escapeHtml(child.name)}</option>`).join('')}</select></label>
          <p class="overview-scope-help" id="overview-scope-help">Chỉ áp dụng cho thời gian sử dụng và các biểu đồ thời gian.</p>
          ${usageUnavailable ? '<p class="overview-inline-status" role="status">Chưa tải được thời gian sử dụng cho phạm vi này. Hãy thử làm mới.</p>' : `<dl class="overview-usage-totals"><div><dt>Hôm nay</dt><dd>${todayUsage.value}<span>${todayUsage.unit}</span></dd></div><div><dt>Tổng trong tháng</dt><dd>${monthUsage.value}<span>${monthUsage.unit}</span></dd></div></dl>`}
        </section>
      </div>
      ${setupSteps.every((step) => step.done) ? '' : `<section class="overview-setup" aria-labelledby="overview-setup-title"><h2 id="overview-setup-title">Hoàn tất kết nối gia đình</h2><ol>${setupSteps.map((step) => `<li><button class="link-button" data-page="${step.page}">${step.label}</button><span>${step.done ? 'Đã hoàn tất' : 'Chưa hoàn tất'}</span></li>`).join('')}</ol></section>`}
      <div class="overview-detail-grid">
        <section class="overview-activity" aria-labelledby="overview-activity-title">
          <div class="overview-section-heading"><div><h2 id="overview-activity-title">Hoạt động gần đây</h2><p>Ứng dụng và website · Toàn gia đình</p></div><button class="link-button" data-page="activity">Xem tất cả</button></div>
          ${activityUnavailable ? '<p class="overview-inline-status" role="status">Một phần hoạt động chưa cập nhật được. Các mục đã tải trước đó được giữ lại.</p>' : ''}
          ${recentActivity.length ? `<ul class="overview-activity-list">${recentActivity.map((item) => `<li><strong>${escapeHtml(item.title || 'Không có tiêu đề')}</strong><div class="overview-activity-meta"><span>${item.type === 'app' ? 'Ứng dụng' : 'Website'} · ${escapeHtml(categoryLabel(item.category))}</span><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.at)}</small></div></li>`).join('')}</ul>` : `<p class="overview-empty">${activityUnavailable ? 'Chưa tải được hoạt động. Hãy thử làm mới.' : 'Chưa có hoạt động. Dữ liệu sẽ xuất hiện sau khi thiết bị gửi về.'}</p>`}
        </section>
        <section class="overview-time-detail" aria-labelledby="overview-week-title">
          <div class="overview-section-heading"><div><h2 id="overview-week-title">7 ngày gần nhất</h2><p>${escapeHtml(usageScopeName)}${usageUnavailable ? '' : ` · Tổng ${duration(recentTotalSeconds)}`}</p></div></div>
          ${usageUnavailable ? '<p class="overview-empty">Biểu đồ sẽ hiển thị khi tải được dữ liệu thời gian sử dụng.</p>' : `
            <div class="chart-wrap usage-week-chart" role="img" aria-label="${escapeHtml(`Thời gian sử dụng của ${usageScopeName} trong 7 ngày gần nhất. ${weekDescription}`)}">${recentDays
              .map((day) => `<div class="bar-column"><span class="bar-value">${Math.round(day.seconds / 60)}p</span><div class="bar-track" title="${escapeHtml(day.date)}: ${duration(day.seconds)}"><div class="bar-fill ${day.seconds ? '' : 'is-empty'}" style="height:${day.seconds ? Math.max(4, Math.round((day.seconds / recentMaxSeconds) * 100)) : 0}%;"></div></div><small>${escapeHtml(day.label)}</small></div>`)
              .join('')}</div>
            <p class="overview-chart-note">Đơn vị: phút · Thời gian tổng hợp từ thiết bị.</p>
            ${usageQualityNotice}
            <details class="overview-month" ${monthExpanded ? 'open' : ''}>
              <summary>Chi tiết từng ngày trong ${escapeHtml(usageMonthLabel(usageSummary.month))}</summary>
              <p>${escapeHtml(usageScopeName)} · ${usageSummary.timezone ? `Múi giờ: ${escapeHtml(usageSummary.timezone)}.` : 'Theo múi giờ của hệ thống.'} Ngày hôm nay được đánh dấu.</p>
              <div class="usage-month-scroll" tabindex="0" role="region" aria-label="Biểu đồ từng ngày trong tháng, có thể cuộn ngang"><div class="usage-month-chart" style="--usage-day-count:${monthDays.length}" role="img" aria-label="${escapeHtml(monthDescription)}">${monthDays
                .map((day) => `<div class="usage-month-day ${day.isToday ? 'is-today' : ''}"><span>${day.seconds ? `${Math.round(day.seconds / 60)}p` : ''}</span><div class="usage-month-track" title="Ngày ${day.label}: ${duration(day.seconds)}"><div class="usage-month-fill" style="height:${day.seconds ? Math.max(3, Math.round((day.seconds / monthMaxSeconds) * 100)) : 0}%"></div></div><small>${day.label}</small></div>`)
                .join('')}</div></div>
              <table class="overview-month-table"><caption>Thời gian sử dụng từng ngày · ${escapeHtml(usageScopeName)}</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Thời gian</th></tr></thead><tbody>${monthDays.map((day) => `<tr ${day.isToday ? 'class="is-today"' : ''}><th scope="row">${day.label}${day.isToday ? ' · Hôm nay' : ''}</th><td>${duration(day.seconds)}</td></tr>`).join('')}</tbody></table>
            </details>`}
        </section>
      </div>
      <section class="overview-categories" aria-labelledby="overview-categories-title">
        <div class="overview-section-heading"><div><h2 id="overview-categories-title">Phân bổ ứng dụng gần đây</h2><p>Toàn gia đình · 3 danh mục có thời lượng cao nhất. Tỷ lệ tính trên toàn bộ thời lượng ứng dụng trong các bản ghi gần đây.</p></div></div>
        ${loadErrors.includes('hoạt động ứng dụng') ? '<p class="overview-inline-status" role="status">Chưa cập nhật được phân bổ. Dữ liệu bên dưới, nếu có, là lần tải trước.</p>' : ''}
        ${sortedCategories.length ? `<table class="overview-category-table"><thead><tr><th scope="col">Danh mục</th><th scope="col">Thời lượng</th><th scope="col">Tỷ lệ</th></tr></thead><tbody>${sortedCategories.map(([name, seconds]) => `<tr><th scope="row">${escapeHtml(categoryLabel(name))}</th><td>${duration(seconds)}</td><td>${categorySampleSeconds ? Math.round((seconds / categorySampleSeconds) * 100) : 0}%</td></tr>`).join('')}</tbody></table>` : `<p class="overview-empty">${loadErrors.includes('hoạt động ứng dụng') ? 'Chưa tải được dữ liệu phân bổ.' : 'Chưa đủ dữ liệu để hiển thị phân bổ.'}</p>`}
      </section>
    </div>`;
  if (restoreScopeFocus) content.querySelector('#overview-child')?.focus({ preventScroll: true });
}

function metric(label, value, suffix, icon, highlight = false) {
  return `<article class="metric-card metric-${icon} ${highlight ? 'highlight' : ''}" aria-label="${escapeHtml(`${label}: ${value} ${suffix}`)}"><span class="metric-accent" aria-hidden="true"></span><div class="metric-icon">${icons[icon]}</div><p class="metric-label">${label}</p><div class="metric-value">${value}<small>${suffix}</small></div></article>`;
}

function activityListItem(item) {
  return `<div class="list-item"><div class="list-icon">${item.type === 'app' ? 'A' : 'W'}</div><div class="list-copy"><strong>${escapeHtml(item.title || 'Không có tiêu đề')}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.at)}</small></div>${categoryBadge(item.category)}</div>`;
}

function alertListItem(item) {
  const presentation = alertPresentation(item.alert_type);
  return `<div class="list-item"><div class="list-icon alert-list-icon ${presentation.tone}">${presentation.symbol}</div><div class="list-copy"><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.created_at)}</small></div><span class="badge ${item.is_read ? 'neutral' : 'coral'}">${item.is_read ? 'Đã đọc' : 'Mới'}</span></div>`;
}

export { renderOverview };
