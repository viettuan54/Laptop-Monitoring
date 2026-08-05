const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const settingsController = require('../controllers/settings.controller');

// Lấy và cập nhật chính sách allow/block theo nhãn của từng trẻ
router.get('/:child_id/policies', auth, requireRole('parent'), withRls, settingsController.getCategoryPolicies);
router.put(
  '/:child_id/policies/:resource_type/:category',
  auth,
  requireRole('parent'),
  withRls,
  settingsController.updateCategoryPolicy
);

// Lấy cấu hình giám sát của trẻ em
router.get('/:child_id', auth, requireRole('parent'), withRls, settingsController.getSettings);

// Cập nhật cấu hình giám sát của trẻ em
router.put('/:child_id', auth, requireRole('parent'), withRls, settingsController.updateSettings);

module.exports = router;
