const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPool } = require('../src/config/db');

test('summary reports send full-period duration statistics to Gemini', async (t) => {
  const provider = require('@google/genai');
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-only';
  const servicePath = require.resolve('../src/services/ai.service');
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    delete require.cache[servicePath];
  });

  let capturedPrompt;
  let providerCalls = 0;
  t.mock.method(provider, 'GoogleGenAI', class {
    models = {
      generateContent: async (request) => {
        providerCalls++;
        capturedPrompt = request.contents[0].parts[0].text;
        return { text: '  Báo cáo thử nghiệm.  ' };
      },
    };
  });
  delete require.cache[servicePath];
  const { generateSummaryReport } = require(servicePath);
  let apps = [];
  let websites = [];
  let alerts = [];
  const queries = [];
  t.mock.method(adminPool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM app_usage')) return { rows: apps };
    if (sql.includes('FROM website_logs')) return { rows: websites };
    if (sql.includes('FROM alerts')) return { rows: alerts };
    assert.fail('Unexpected database query');
  });
  const payload = () => JSON.parse(
    capturedPrompt.split('<user_activity_logs>\n')[1].split('\n</user_activity_logs>')[0]
  );
  const category = (stats, name) => stats.categories.find((row) => row.category === name);
  const biasedSessions = (learningCategory, nameField) => [
    ...Array.from({ length: 80 }, () => ({
      [nameField]: 'study', category: learningCategory, duration_seconds: 15,
    })),
    ...Array.from({ length: 20 }, () => ({
      [nameField]: 'game', category: 'entertainment', duration_seconds: 30,
    })),
  ];

  for (const period of ['daily', 'weekly']) {
    await t.test(`${period}: 80 short learning sessions still account for 66.7%`, async () => {
      apps = biasedSessions('learning', 'app_name');
      websites = [];
      queries.length = 0;
      const before = Date.now();
      assert.equal(await generateSummaryReport(42, period), 'Báo cáo thử nghiệm.');
      const after = Date.now();
      const data = payload();
      const stats = data.full_period_statistics.app_usage;
      assert.equal(stats.session_count, 100);
      assert.equal(stats.total_duration_seconds, 1800);
      assert.equal(category(stats, 'learning').duration_seconds, 1200);
      assert.equal(category(stats, 'learning').percentage_of_total_duration, 66.7);
      assert.equal(category(stats, 'entertainment').duration_seconds, 600);
      assert.equal(category(stats, 'entertainment').percentage_of_total_duration, 33.3);
      assert.equal(data.representative_sessions.app_usage.length, 5);
      assert.ok(data.representative_sessions.app_usage.every((row) => row.category === 'entertainment'));
      assert.equal(apps[0].category, 'learning', 'selection must not reorder source rows');
      assert.match(capturedPrompt, /Không suy ra tỷ lệ từ representative_sessions/);
      assert.doesNotMatch(capturedPrompt, /ước lượng tương đối|70%/);
      const interval = (period === 'weekly' ? 7 : 1) * 86400000;
      assert.equal(queries.length, 3);
      for (const { sql, params } of queries) {
        assert.doesNotMatch(sql, /\bLIMIT\b/i);
        assert.equal(params[0], 42);
        assert.ok(params[1].getTime() >= before - interval);
        assert.ok(params[1].getTime() <= after - interval);
      }
    });
  }

  await t.test('website-only reports aggregate every education session', async () => {
    apps = [];
    websites = biasedSessions('education', 'domain');
    await generateSummaryReport(42);
    const data = payload();
    const stats = data.full_period_statistics.websites;
    assert.equal(stats.total_duration_seconds, 1800);
    assert.equal(category(stats, 'education').duration_seconds, 1200);
    assert.equal(category(stats, 'education').percentage_of_total_duration, 66.7);
    assert.equal(category(stats, 'entertainment').percentage_of_total_duration, 33.3);
    assert.equal(data.representative_sessions.websites.length, 5);
    assert.equal(data.full_period_statistics.app_usage.total_duration_seconds, 0);
  });

  await t.test('browser and unclassified time stay in the denominator; web time stays separate', async () => {
    apps = [
      { category: 'learning', duration_seconds: '60' },
      { category: 'entertainment', duration_seconds: 30 },
      { category: 'browsers', duration_seconds: 30 },
      { category: null, duration_seconds: 15 },
      { category: 'legacy-category', duration_seconds: 15 },
    ];
    websites = [
      { category: 'education', duration_seconds: 15 },
      { category: 'social', duration_seconds: 5 },
      { category: 'unsafe', duration_seconds: 5 },
      { category: 'unknown', duration_seconds: 5 },
    ];
    await generateSummaryReport(42);
    const stats = payload().full_period_statistics;
    assert.equal(stats.app_usage.total_duration_seconds, 150);
    assert.equal(category(stats.app_usage, 'learning').percentage_of_total_duration, 40);
    assert.equal(category(stats.app_usage, 'entertainment').percentage_of_total_duration, 20);
    assert.equal(category(stats.app_usage, 'browsers').percentage_of_total_duration, 20);
    assert.equal(category(stats.app_usage, 'unknown').duration_seconds, 30);
    assert.equal(stats.websites.total_duration_seconds, 30);
    assert.equal(category(stats.websites, 'education').percentage_of_total_duration, 50);
    assert.equal(category(stats.websites, 'social').duration_seconds, 5);
    assert.equal(category(stats.websites, 'unsafe').duration_seconds, 5);
    assert.match(capturedPrompt, /Không cộng thời lượng ứng dụng với website/);
  });

  await t.test('missing or invalid durations cannot invent a time ratio from visit counts', async () => {
    apps = [];
    websites = [null, undefined, '', 'invalid', -10, Infinity, NaN, 0].map((duration_seconds) => ({
      category: 'education', duration_seconds,
    }));
    await generateSummaryReport(42);
    const stats = payload().full_period_statistics.websites;
    assert.equal(stats.session_count, 8);
    assert.equal(stats.sessions_without_duration, 7);
    assert.equal(stats.total_duration_seconds, 0);
    assert.ok(stats.categories.every((row) => row.percentage_of_total_duration === null));
    assert.match(capturedPrompt, /không đủ dữ liệu thời lượng để tính tỷ lệ/);
  });

  await t.test('partial duration coverage is disclosed without discarding valid time', async () => {
    apps = [{ category: 'learning', duration_seconds: 30 }, { category: 'entertainment' }];
    websites = [];
    await generateSummaryReport(42);
    const stats = payload().full_period_statistics.app_usage;
    assert.equal(stats.session_count, 2);
    assert.equal(stats.sessions_without_duration, 1);
    assert.equal(stats.total_duration_seconds, 30);
    assert.equal(category(stats, 'learning').percentage_of_total_duration, 100);
    assert.equal(category(stats, 'entertainment').percentage_of_total_duration, 0);
    assert.match(capturedPrompt, /sessions_without_duration/);
  });

  await t.test('empty and alert-only periods still skip Gemini', async () => {
    apps = [];
    websites = [];
    const callsBefore = providerCalls;
    assert.match(await generateSummaryReport(42, 'daily'), /chưa ghi nhận nhật ký/);
    alerts = [{ message: 'fixture alert' }];
    assert.match(await generateSummaryReport(42, 'weekly'), /7 ngày qua.*1 cảnh báo.*fixture alert/);
    assert.equal(providerCalls, callsBefore);
  });
});
