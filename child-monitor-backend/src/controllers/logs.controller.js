const { adminPool } = require('../config/db');

// ────────────────────────────────────────────────────────────────
// Hằng số dùng chung cho 2 hàm batch
// ────────────────────────────────────────────────────────────────
const BATCH_MAX_RECORDS = 100;

// ────────────────────────────────────────────────────────────────
// POST /api/logs/app  – Agent (laptop con) gửi dữ liệu app usage
// Xác thực bằng X-Device-Secret, KHÔNG dùng JWT phụ huynh
// ────────────────────────────────────────────────────────────────
exports.logAppUsage = async (req, res) => {
  const { app_name, category, start_time, end_time, duration_seconds } = req.body;

  // device_id lấy từ req.device (đã được deviceAuth middleware gán)
  const device_id = req.device.device_id;

  if (!app_name || !start_time) {
    return res.status(400).json({ message: 'Missing required fields: app_name, start_time' });
  }

  // Đảm bảo không vượt quá độ dài VARCHAR(150) của cột app_name trong DB
  if (app_name.length > 150) {
    return res.status(400).json({ message: 'app_name cannot exceed 150 characters' });
  }

  // Validate category nếu có
  const validCategories = ['learning', 'entertainment', 'unknown'];
  if (category && !validCategories.includes(category)) {
    return res.status(400).json({ message: `Invalid category. Allowed: ${validCategories.join(', ')}` });
  }

  try {
    // Dùng adminPool vì không có RLS context từ device (device secret ≠ user context)
    // Device đã được xác thực ở middleware → insert trực tiếp theo device_id
    await adminPool.query(
      `INSERT INTO app_usage(device_id, app_name, category, start_time, end_time, duration_seconds)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [device_id, app_name, category || 'unknown', start_time, end_time || null, duration_seconds || null]
    );
    res.status(201).json({ message: 'App usage logged' });
  } catch (error) {
    console.error('Log app usage error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/logs/web  – Agent (laptop con) gửi dữ liệu website
// Xác thực bằng X-Device-Secret, KHÔNG dùng JWT phụ huynh
// ────────────────────────────────────────────────────────────────
exports.logWebsite = async (req, res) => {
  const { url, domain, category, visit_time, duration_seconds, page_title } = req.body;

  const device_id = req.device.device_id;

  if (!url || !visit_time) {
    return res.status(400).json({ message: 'Missing required fields: url, visit_time' });
  }

  // Đảm bảo không vượt quá độ dài VARCHAR của các cột trong DB
  if (url.length > 500) {
    return res.status(400).json({ message: 'url cannot exceed 500 characters' });
  }
  if (domain && domain.length > 200) {
    return res.status(400).json({ message: 'domain cannot exceed 200 characters' });
  }
  if (page_title && page_title.length > 500) {
    return res.status(400).json({ message: 'page_title cannot exceed 500 characters' });
  }

  // Validate category nếu có
  const validCategories = ['education', 'entertainment', 'social', 'unsafe', 'unknown'];
  if (category && !validCategories.includes(category)) {
    return res.status(400).json({ message: `Invalid category. Allowed: ${validCategories.join(', ')}` });
  }

  try {
    await adminPool.query(
      `INSERT INTO website_logs(device_id, url, domain, category, visit_time, duration_seconds, page_title)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [device_id, url, domain || null, category || 'unknown', visit_time, duration_seconds || null, page_title || null]
    );
    res.status(201).json({ message: 'Website log saved' });
  } catch (error) {
    console.error('Log website error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/logs/app  – Phụ huynh xem lịch sử app usage
// Xác thực bằng JWT phụ huynh + RLS
// Query params: device_id, start, end, limit (default 50), offset (default 0)
// ────────────────────────────────────────────────────────────────
exports.getAppLogs = async (req, res) => {
  const { device_id, start, end } = req.query;
  let { limit, offset } = req.query;

  // Pagination defaults & limits
  limit = Math.min(parseInt(limit) || 50, 200);
  offset = Math.max(parseInt(offset) || 0, 0);

  try {
    let queryText = `
      SELECT log_id, device_id, app_name, category, start_time, end_time, duration_seconds
      FROM app_usage
    `;
    const queryParams = [];
    const conditions = [];

    if (device_id) {
      queryParams.push(device_id);
      conditions.push(`device_id = $${queryParams.length}`);
    }
    if (start) {
      queryParams.push(start);
      conditions.push(`start_time >= $${queryParams.length}`);
    }
    if (end) {
      queryParams.push(end);
      conditions.push(`start_time <= $${queryParams.length}`);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ` ORDER BY start_time DESC`;
    queryParams.push(limit);
    queryText += ` LIMIT $${queryParams.length}`;
    queryParams.push(offset);
    queryText += ` OFFSET $${queryParams.length}`;

    // req.db đã có RLS context → tự động lọc theo phụ huynh đang đăng nhập
    const result = await req.db.query(queryText, queryParams);
    res.json({ data: result.rows, limit, offset, count: result.rows.length });
  } catch (error) {
    console.error('Get app logs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/logs/web  – Phụ huynh xem lịch sử trình duyệt
// Xác thực bằng JWT phụ huynh + RLS
// Query params: device_id, start, end, limit (default 50), offset (default 0)
// ────────────────────────────────────────────────────────────────
exports.getWebLogs = async (req, res) => {
  const { device_id, start, end } = req.query;
  let { limit, offset } = req.query;

  // Pagination defaults & limits
  limit = Math.min(parseInt(limit) || 50, 200);
  offset = Math.max(parseInt(offset) || 0, 0);

  try {
    let queryText = `
      SELECT log_id, device_id, url, domain, category, visit_time, duration_seconds, page_title
      FROM website_logs
    `;
    const queryParams = [];
    const conditions = [];

    if (device_id) {
      queryParams.push(device_id);
      conditions.push(`device_id = $${queryParams.length}`);
    }
    if (start) {
      queryParams.push(start);
      conditions.push(`visit_time >= $${queryParams.length}`);
    }
    if (end) {
      queryParams.push(end);
      conditions.push(`visit_time <= $${queryParams.length}`);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ` ORDER BY visit_time DESC`;
    queryParams.push(limit);
    queryText += ` LIMIT $${queryParams.length}`;
    queryParams.push(offset);
    queryText += ` OFFSET $${queryParams.length}`;

    // req.db đã có RLS context
    const result = await req.db.query(queryText, queryParams);
    res.json({ data: result.rows, limit, offset, count: result.rows.length });
  } catch (error) {
    console.error('Get web logs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/logs/app/batch  – Agent gửi hàng loạt app usage (offline sync)
//
// Body: { records: [ { client_record_id, app_name, category, start_time,
//                       end_time?, duration_seconds? }, ... ] }
// Tối đa 100 bản ghi / request (kiểm soát tại route bằng limit:'1mb').
//
// Bảo mật:
//  - device_id LUÔN lấy từ req.device (xác thực bởi deviceAuth middleware),
//    KHÔNG đọc device_id từ client → ngăn Agent giả mạo ghi log thiết bị khác.
//  - client_record_id (UUID sinh bởi Agent) + ON CONFLICT DO NOTHING
//    → idempotent: retry sau mất mạng không tạo bản ghi trùng.
//
// Soft-fail:
//  - Validate từng record bằng JS trước khi vào DB.
//  - Chỉ INSERT các validRecords → unnest() không bao giờ nhận dữ liệu bẩn.
//  - Trả về { inserted, skipped, skipped_reasons[] } để Agent log debug.
// ────────────────────────────────────────────────────────────────
exports.logAppBatch = async (req, res) => {
  const device_id = req.device.device_id; // PHẢI lấy từ req.device, không từ body
  const { records } = req.body;

  if (!Array.isArray(records)) {
    return res.status(400).json({ message: 'records must be an array' });
  }
  if (records.length === 0) {
    return res.status(400).json({ message: 'records array is empty' });
  }
  if (records.length > BATCH_MAX_RECORDS) {
    return res.status(400).json({
      message: `Batch too large. Maximum ${BATCH_MAX_RECORDS} records per request`,
    });
  }

  const validCategories = ['learning', 'entertainment', 'unknown'];
  const validRecords = [];
  const skippedReasons = [];

  // ── Validate từng record ở tầng JS (soft-fail) ───────────────
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const idx = `[${i}]`;

    if (!r.client_record_id || typeof r.client_record_id !== 'string') {
      skippedReasons.push(`${idx} missing client_record_id`);
      continue;
    }
    if (!r.app_name || typeof r.app_name !== 'string') {
      skippedReasons.push(`${idx} missing app_name`);
      continue;
    }
    if (r.app_name.length > 150) {
      skippedReasons.push(`${idx} app_name exceeds 150 chars`);
      continue;
    }
    if (!r.start_time) {
      skippedReasons.push(`${idx} missing start_time`);
      continue;
    }
    if (r.category && !validCategories.includes(r.category)) {
      skippedReasons.push(`${idx} invalid category '${r.category}'`);
      continue;
    }

    validRecords.push({
      client_record_id: r.client_record_id.trim().substring(0, 64),
      app_name:         r.app_name.trim().substring(0, 150),
      category:         r.category || 'unknown',
      start_time:       r.start_time,
      end_time:         r.end_time   || null,
      duration_seconds: Number.isFinite(r.duration_seconds) ? Math.floor(r.duration_seconds) : null,
    });
  }

  if (validRecords.length === 0) {
    return res.status(400).json({
      message: 'No valid records to insert',
      inserted: 0,
      skipped: skippedReasons.length,
      skipped_reasons: skippedReasons,
    });
  }

  try {
    // ── Build arrays cho unnest() ─────────────────────────────────
    // unnest() INSERT toàn bộ validRecords bằng 1 câu SQL (hiệu quả hơn N INSERT riêng lẻ).
    // Dùng explicit type cast để PostgreSQL không suy luận sai kiểu khi có null xen giữa.
    // ON CONFLICT DO NOTHING trên client_record_id → idempotent khi Agent retry.
    const clientIds = validRecords.map((r) => r.client_record_id);
    const appNames  = validRecords.map((r) => r.app_name);
    const categories = validRecords.map((r) => r.category);
    const startTimes = validRecords.map((r) => r.start_time);
    const endTimes   = validRecords.map((r) => r.end_time);
    const durations  = validRecords.map((r) => r.duration_seconds);

    const result = await adminPool.query(
      `INSERT INTO app_usage(client_record_id, device_id, app_name, category, start_time, end_time, duration_seconds)
       SELECT
         unnest($1::text[]),
         $2::uuid,
         unnest($3::text[]),
         unnest($4::text[]),
         unnest($5::timestamptz[]),
         unnest($6::timestamptz[]),
         unnest($7::int[])
       ON CONFLICT (client_record_id) DO NOTHING`,
      [clientIds, device_id, appNames, categories, startTimes, endTimes, durations]
    );

    // result.rowCount = số dòng thực sự được INSERT (sau khi ON CONFLICT DO NOTHING lọc trùng)
    // Không dùng validRecords.length vì bản ghi trùng client_record_id sẽ bị bỏ qua
    const insertedCount = result.rowCount ?? 0;
    const duplicateCount = validRecords.length - insertedCount;

    res.status(201).json({
      message: 'Batch app usage logged',
      inserted: insertedCount,
      duplicates: duplicateCount,
      skipped: skippedReasons.length,
      skipped_reasons: skippedReasons,
    });
  } catch (error) {
    console.error('Log app batch error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/logs/web/batch  – Agent gửi hàng loạt website logs (offline sync)
//
// Body: { records: [ { client_record_id, url, visit_time, domain?,
//                       category?, duration_seconds?, page_title? }, ... ] }
// Tối đa 100 bản ghi / request.
//
// Các nguyên tắc bảo mật và soft-fail giống logAppBatch ở trên.
// ────────────────────────────────────────────────────────────────
exports.logWebBatch = async (req, res) => {
  const device_id = req.device.device_id; // PHẢI lấy từ req.device, không từ body
  const { records } = req.body;

  if (!Array.isArray(records)) {
    return res.status(400).json({ message: 'records must be an array' });
  }
  if (records.length === 0) {
    return res.status(400).json({ message: 'records array is empty' });
  }
  if (records.length > BATCH_MAX_RECORDS) {
    return res.status(400).json({
      message: `Batch too large. Maximum ${BATCH_MAX_RECORDS} records per request`,
    });
  }

  const validWebCategories = ['education', 'entertainment', 'social', 'unsafe', 'unknown'];
  const validRecords = [];
  const skippedReasons = [];

  // ── Validate từng record ở tầng JS (soft-fail) ───────────────
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const idx = `[${i}]`;

    if (!r.client_record_id || typeof r.client_record_id !== 'string') {
      skippedReasons.push(`${idx} missing client_record_id`);
      continue;
    }
    if (!r.url || typeof r.url !== 'string') {
      skippedReasons.push(`${idx} missing url`);
      continue;
    }
    if (r.url.length > 500) {
      skippedReasons.push(`${idx} url exceeds 500 chars`);
      continue;
    }
    if (!r.visit_time) {
      skippedReasons.push(`${idx} missing visit_time`);
      continue;
    }
    if (r.domain && r.domain.length > 200) {
      skippedReasons.push(`${idx} domain exceeds 200 chars`);
      continue;
    }
    if (r.page_title && r.page_title.length > 500) {
      skippedReasons.push(`${idx} page_title exceeds 500 chars`);
      continue;
    }
    if (r.category && !validWebCategories.includes(r.category)) {
      skippedReasons.push(`${idx} invalid category '${r.category}'`);
      continue;
    }

    validRecords.push({
      client_record_id: r.client_record_id.trim().substring(0, 64),
      url:              r.url.trim().substring(0, 500),
      domain:           r.domain      ? r.domain.trim().substring(0, 200)    : null,
      category:         r.category    || 'unknown',
      visit_time:       r.visit_time,
      duration_seconds: Number.isFinite(r.duration_seconds) ? Math.floor(r.duration_seconds) : null,
      page_title:       r.page_title  ? r.page_title.trim().substring(0, 500) : null,
    });
  }

  if (validRecords.length === 0) {
    return res.status(400).json({
      message: 'No valid records to insert',
      inserted: 0,
      skipped: skippedReasons.length,
      skipped_reasons: skippedReasons,
    });
  }

  try {
    // ── Build arrays cho unnest() ─────────────────────────────────
    const clientIds  = validRecords.map((r) => r.client_record_id);
    const urls       = validRecords.map((r) => r.url);
    const domains    = validRecords.map((r) => r.domain);
    const categories = validRecords.map((r) => r.category);
    const visitTimes = validRecords.map((r) => r.visit_time);
    const durations  = validRecords.map((r) => r.duration_seconds);
    const pageTitles = validRecords.map((r) => r.page_title);

    const result = await adminPool.query(
      `INSERT INTO website_logs(client_record_id, device_id, url, domain, category, visit_time, duration_seconds, page_title)
       SELECT
         unnest($1::text[]),
         $2::uuid,
         unnest($3::text[]),
         unnest($4::text[]),
         unnest($5::text[]),
         unnest($6::timestamptz[]),
         unnest($7::int[]),
         unnest($8::text[])
       ON CONFLICT (client_record_id) DO NOTHING`,
      [clientIds, device_id, urls, domains, categories, visitTimes, durations, pageTitles]
    );

    // result.rowCount = số dòng thực sự được INSERT (sau khi ON CONFLICT DO NOTHING lọc trùng)
    const insertedCount = result.rowCount ?? 0;
    const duplicateCount = validRecords.length - insertedCount;

    res.status(201).json({
      message: 'Batch website logs saved',
      inserted: insertedCount,
      duplicates: duplicateCount,
      skipped: skippedReasons.length,
      skipped_reasons: skippedReasons,
    });
  } catch (error) {
    console.error('Log web batch error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};