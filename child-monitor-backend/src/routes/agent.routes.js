const express = require('express');
const router = express.Router();
const deviceAuth = require('../middlewares/deviceAuth.middleware');
const agentController = require('../controllers/agent.controller');

// Tất cả route /api/agent/* đều xác thực bằng X-Device-Secret
// KHÔNG dùng JWT phụ huynh – Agent chỉ có Device Secret

// ── Heartbeat: Agent báo máy đang mở và nhận config ngay ─────────────────
// Gọi định kỳ mỗi 60 giây. Backend cập nhật last_seen_at.
router.post('/heartbeat', deviceAuth, agentController.heartbeat);

// ── Config: Agent lấy cấu hình đầy đủ (is_locked, time limit, privacy flags)
// Gọi khi khởi động Agent và mỗi khi cần đồng bộ cấu hình.
router.get('/config', deviceAuth, agentController.getConfig);

router.post(
  '/classification/web/fallback',
  deviceAuth,
  agentController.classifyWebFallback
);
router.get(
  '/classification/web/unknown-domains',
  deviceAuth,
  agentController.getUnknownWebDomains
);
router.post(
  '/classification/web/backfill',
  deviceAuth,
  agentController.backfillWebDomain
);

// ── Vision Alert: Agent gửi kết quả Computer Vision (chỉ metadata, không ảnh)
// alert_type: posture_warning | stranger_detected | eye_distance_warning
router.post('/vision-alert', deviceAuth, agentController.sendVisionAlert);

module.exports = router;
