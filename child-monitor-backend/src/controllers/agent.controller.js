const { adminPool } = require('../config/db');
const { sendPushNotification } = require('../services/notification.service');

// ────────────────────────────────────────────────────────────────
// POST /api/agent/heartbeat
// Agent gửi định kỳ (mỗi 60 giây) để báo máy đang hoạt động.
// Cập nhật last_seen_at trên thiết bị và trả về config snapshot
// để Agent nhận lệnh ngay trong cùng một request (tiết kiệm round-trip).
// ────────────────────────────────────────────────────────────────
exports.heartbeat = async (req, res) => {
  const { device_id, child_id } = req.device;

  try {
    // Cập nhật last_seen_at và lấy giá trị vừa ghi để trả về cho Agent xác nhận
    const updateResult = await adminPool.query(
      'UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1 RETURNING last_seen_at',
      [device_id]
    );
    const last_seen_at = updateResult.rows[0]?.last_seen_at ?? new Date();

    // Lấy config hiện tại để trả về ngay cùng response
    // Agent sẽ dùng để kiểm tra is_locked, time limit, v.v.
    const settingsResult = await adminPool.query(
      `SELECT daily_limit_minutes, allowed_start_time, allowed_end_time,
              is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog
       FROM settings
       WHERE child_id = $1`,
      [child_id]
    );

    const config = settingsResult.rows[0] || {
      daily_limit_minutes: 120,
      allowed_start_time: '07:00:00',
      allowed_end_time: '21:00:00',
      is_locked: false,
      enable_webcam_monitoring: false,
      enable_screenshot_review: false,
      enable_keylog: false,
    };

    res.json({
      message: 'Heartbeat received',
      server_time: new Date().toISOString(),
      last_seen_at: last_seen_at instanceof Date ? last_seen_at.toISOString() : last_seen_at,
      config,
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/agent/config
// Agent gọi endpoint này để lấy toàn bộ cấu hình giám sát
// áp dụng cho thiết bị (bao gồm is_locked để thực thi khóa máy).
// Endpoint này không cập nhật last_seen_at (dùng heartbeat cho việc đó).
// ────────────────────────────────────────────────────────────────
exports.getConfig = async (req, res) => {
  const { child_id, device_id, device_name } = req.device;

  try {
    const settingsResult = await adminPool.query(
      `SELECT daily_limit_minutes, allowed_start_time, allowed_end_time,
              is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog
       FROM settings
       WHERE child_id = $1`,
      [child_id]
    );

    // Lấy danh sách blacklist toàn cục do admin quản lý để Agent kiểm tra website cục bộ.
    // website_blacklist là bảng global (không phân theo child/user) → lấy toàn bộ là đúng thiết kế.
    const blacklistResult = await adminPool.query(
      'SELECT domain FROM website_blacklist ORDER BY domain ASC'
    );

    const config = settingsResult.rows[0] || {
      daily_limit_minutes: 120,
      allowed_start_time: '07:00:00',
      allowed_end_time: '21:00:00',
      is_locked: false,
      enable_webcam_monitoring: false,
      enable_screenshot_review: false,
      enable_keylog: false,
    };

    res.json({
      device_id,
      device_name,
      child_id,
      config,
      blacklisted_domains: blacklistResult.rows.map((r) => r.domain),
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/agent/vision-alert
// Agent gửi kết quả phân tích Computer Vision cục bộ.
// Chỉ gửi dữ liệu cảnh báo dạng số/loại, KHÔNG bao giờ gửi ảnh.
//
// Body: {
//   alert_type: 'posture_warning' | 'stranger_detected' | 'eye_distance_warning',
//   message: string (mô tả ngắn, ví dụ: "Khoảng cách mắt 25cm - quá gần")
// }
// ────────────────────────────────────────────────────────────────
exports.sendVisionAlert = async (req, res) => {
  const { device_id } = req.device;
  const { alert_type, message } = req.body;

  // Chỉ chấp nhận các alert_type liên quan đến Computer Vision
  const VALID_VISION_ALERT_TYPES = ['posture_warning', 'stranger_detected', 'eye_distance_warning'];

  if (!alert_type || !VALID_VISION_ALERT_TYPES.includes(alert_type)) {
    return res.status(400).json({
      message: `Invalid alert_type. Allowed: ${VALID_VISION_ALERT_TYPES.join(', ')}`,
    });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ message: 'message is required' });
  }

  // Giới hạn độ dài message để tránh spam
  const trimmedMessage = message.trim().substring(0, 500);

  try {
    // ── Bảo mật: Kiểm tra xem phụ huynh có BẬT tính năng giám sát webcam không ──
    const settingsCheck = await adminPool.query(
      'SELECT enable_webcam_monitoring FROM settings WHERE child_id = $1',
      [req.device.child_id]
    );
    const hasWebcamEnabled = settingsCheck.rows[0]?.enable_webcam_monitoring ?? false;

    if (!hasWebcamEnabled) {
      return res.status(403).json({
        message: 'Webcam monitoring feature is disabled for this child. Vision alert rejected.',
      });
    }

    // Kiểm tra xem đã có cảnh báo cùng loại trong 5 phút qua chưa.
    // Tránh tạo hàng nghìn alert trùng lặp khi Agent phát hiện liên tục.
    const recentAlert = await adminPool.query(
      `SELECT alert_id FROM alerts
       WHERE device_id = $1 AND alert_type = $2 AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [device_id, alert_type]
    );

    if (recentAlert.rows.length > 0) {
      // Cảnh báo đã được tạo gần đây, bỏ qua để tránh spam
      return res.status(200).json({
        message: 'Alert suppressed (duplicate within 5 minutes)',
        suppressed: true,
      });
    }

    const result = await adminPool.query(
      `INSERT INTO alerts(device_id, alert_type, message)
       VALUES($1, $2, $3)
       RETURNING alert_id, device_id, alert_type, message, is_read, created_at`,
      [device_id, alert_type, trimmedMessage]
    );

    // Truy vấn lấy user_id của phụ huynh để gửi thông báo đẩy
    const childResult = await adminPool.query(
      'SELECT user_id FROM children WHERE child_id = $1',
      [req.device.child_id]
    );
    const userId = childResult.rows[0]?.user_id;

    if (userId) {
      const friendlyTitles = {
        posture_warning: 'Cảnh báo tư thế ngồi',
        stranger_detected: 'Phát hiện người lạ đứng sau',
        eye_distance_warning: 'Cảnh báo khoảng cách mắt',
      };
      const title = friendlyTitles[alert_type] || 'Cảnh báo từ thiết bị';
      sendPushNotification(userId, title, trimmedMessage, {
        type: 'alert',
        route: 'alerts',
        alert_id: result.rows[0].alert_id,
        device_id,
        alert_type,
      })
        .catch(err => console.error('Failed to send vision push notification:', err));
    }

    res.status(201).json({
      message: 'Vision alert recorded',
      alert: result.rows[0],
    });
  } catch (error) {
    console.error('Send vision alert error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
