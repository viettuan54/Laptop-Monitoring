const express = require('express');
const expressJson1mb = express.json({ limit: '1mb' }); // Cấu hình cục bộ 1MB cho batch routes
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const deviceAuth = require('../middlewares/deviceAuth.middleware');
const { parentLimiter, agentLimiter, screenshotReadLimiter } = require('../middlewares/rateLimit.middleware');
const logsController = require('../controllers/logs.controller');
const screenshotsController = require('../controllers/screenshots.controller');

// Authenticate before accepting an image body. This router precedes the global parser.
router.post('/screenshots', agentLimiter, deviceAuth, expressJson1mb, screenshotsController.upload);
router.get('/screenshots', auth, requireRole('parent'), screenshotReadLimiter, withRls, screenshotsController.list);
router.get('/screenshots/:id', auth, requireRole('parent'), screenshotReadLimiter, withRls, screenshotsController.getImage);

// ── 1. Batch routes: sử dụng parser cục bộ 1mb trước ──────────────────────
// Đăng ký trước để tránh bị parse bởi middleware router-wide 100kb phía dưới.
router.post('/app/batch', agentLimiter, expressJson1mb, deviceAuth, logsController.logAppBatch);
router.post('/web/batch', agentLimiter, expressJson1mb, deviceAuth, logsController.logWebBatch);

// ── 2. Parser mặc định 100kb cho tất cả các route bên dưới ─────────────────
router.use(express.json({ limit: '100kb' }));
router.post('/screenshots/request', parentLimiter, auth, requireRole('parent'), withRls, screenshotsController.requestCapture);
router.delete('/screenshots', parentLimiter, auth, requireRole('parent'), withRls, screenshotsController.removeAll);
router.delete('/screenshots/:id', parentLimiter, auth, requireRole('parent'), withRls, screenshotsController.removeOne);

// ── 3. Agent Routes (dùng X-Device-Secret, KHÔNG cần JWT phụ huynh) ──────────
// Agent trên laptop con gọi các route này để gửi dữ liệu đơn lẻ
router.post('/app', agentLimiter, deviceAuth, logsController.logAppUsage);
router.post('/web', agentLimiter, deviceAuth, logsController.logWebsite);

// ── 4. Parent Routes (dùng JWT phụ huynh + RLS) ──────────────────────────────
// Phụ huynh xem lịch sử app/web của con
// ?device_id=&start=&end=&limit=&offset=
router.get('/usage-summary', parentLimiter, auth, requireRole('parent'), withRls, logsController.getUsageSummary);
router.get('/app', parentLimiter, auth, requireRole('parent'), withRls, logsController.getAppLogs);
router.get('/web', parentLimiter, auth, requireRole('parent'), withRls, logsController.getWebLogs);

module.exports = router;
