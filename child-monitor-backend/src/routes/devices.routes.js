const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const { parentApiLimiter } = require('../middlewares/rateLimit.middleware');

router.use(auth, requireRole('parent'), parentApiLimiter);
const devicesController = require('../controllers/devices.controller');

// Tất cả các route quản lý thiết bị đều yêu cầu đăng nhập và áp dụng cơ chế RLS
router.get('/', withRls, devicesController.getDevices);
router.post('/', withRls, devicesController.registerDevice);
router.put('/:id', withRls, devicesController.updateDevice);
router.delete('/:id', withRls, devicesController.deleteDevice);

// Xoay vòng Device Secret – secret cũ bị vô hiệu ngay lập tức
router.post('/:id/rotate-secret', withRls, devicesController.rotateSecret);

module.exports = router;
