const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const { parentApiLimiter } = require('../middlewares/rateLimit.middleware');

router.use(auth, requireRole('parent'), parentApiLimiter);
const settingsController = require('../controllers/settings.controller');

// Lấy và cập nhật chính sách allow/block theo nhãn của từng trẻ
router.get('/:child_id/policies', withRls, settingsController.getCategoryPolicies);
router.put(
  '/:child_id/policies/:resource_type/:category',
  withRls,
  settingsController.updateCategoryPolicy
);

// Lấy cấu hình giám sát của trẻ em
router.get('/:child_id', withRls, settingsController.getSettings);

// Cập nhật cấu hình giám sát của trẻ em
router.put('/:child_id', withRls, settingsController.updateSettings);

module.exports = router;
