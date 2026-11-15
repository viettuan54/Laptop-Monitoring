const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const { parentApiLimiter } = require('../middlewares/rateLimit.middleware');

router.use(auth, requireRole('parent'), parentApiLimiter);
const requireOwnedDevice = require('../middlewares/deviceOwnership.middleware');
const aiAnalysisController = require('../controllers/aiAnalysis.controller');
const { aiAnalysisLimiter, aiSummaryLimiter } = require('../middlewares/rateLimit.middleware');

// Lấy danh sách phân tích AI (có thể lọc theo device_id, limit, offset)
router.get('/', withRls, aiAnalysisController.getAnalysis);

// Lấy phân tích AI mới nhất của một thiết bị cụ thể
router.get('/latest/:device_id', withRls, aiAnalysisController.getLatestAnalysis);

// Kích hoạt phân tích AI thủ công cho thiết bị
router.post(
  '/analyze/:device_id',
  aiAnalysisLimiter,
  withRls,
  requireOwnedDevice,
  aiAnalysisController.triggerAnalysis
);

// Lấy báo cáo tóm tắt bằng ngôn ngữ tự nhiên
router.get(
  '/summary/:device_id',
  aiSummaryLimiter,
  withRls,
  requireOwnedDevice,
  aiAnalysisController.getSummaryReport
);

// Trò chuyện trực tiếp với trợ lý AI tư vấn tâm lý trẻ em
router.post('/chat', aiAnalysisLimiter, aiAnalysisController.chat);

module.exports = router;
