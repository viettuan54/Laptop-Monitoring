const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const adminController = require('../controllers/admin.controller');

// Tất cả các route admin đều yêu cầu JWT hợp lệ VÀ role = 'admin'
router.get('/users', auth, requireRole('admin'), adminController.getUsers);
router.get('/stats', auth, requireRole('admin'), adminController.getStats);
router.get('/blacklist', auth, requireRole('admin'), adminController.getBlacklist);
router.get('/audit-logs', auth, requireRole('admin'), adminController.getAuditLogs);
router.post('/blacklist', auth, requireRole('admin'), adminController.addBlacklist);
router.delete('/blacklist/:id', auth, requireRole('admin'), adminController.deleteBlacklist);

module.exports = router;
