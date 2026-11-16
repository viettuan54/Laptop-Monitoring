const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const adminController = require('../controllers/admin.controller');

// Tất cả các route admin đều yêu cầu JWT hợp lệ VÀ role = 'admin'
router.get('/users', auth, requireRole('admin'), adminController.getUsers);
router.post('/users', auth, requireRole('admin'), adminController.createUser);
router.get('/users/:id', auth, requireRole('admin'), adminController.getUserDetails);
router.patch('/users/:id', auth, requireRole('admin'), adminController.updateUser);
router.post('/users/:id/revoke-sessions', auth, requireRole('admin'), adminController.revokeUserSessions);
router.delete('/users/:id', auth, requireRole('admin'), adminController.deleteUser);
router.get('/stats', auth, requireRole('admin'), adminController.getStats);
router.get('/blacklist', auth, requireRole('admin'), adminController.getBlacklist);
router.get('/audit-logs', auth, requireRole('admin'), adminController.getAuditLogs);
router.post('/blacklist', auth, requireRole('admin'), adminController.addBlacklist);
router.delete('/blacklist/:id', auth, requireRole('admin'), adminController.deleteBlacklist);

module.exports = router;
