const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const withRls = require('../middlewares/rls.middleware');
const { parentApiLimiter } = require('../middlewares/rateLimit.middleware');

router.use(auth, requireRole('parent'), parentApiLimiter);
const childrenController = require('../controllers/children.controller');

// Tất cả các route quản lý trẻ em đều yêu cầu đăng nhập và áp dụng cơ chế RLS
router.get('/', withRls, childrenController.getChildren);
router.post('/', withRls, childrenController.createChild);
router.put('/:id', withRls, childrenController.updateChild);
router.delete('/:id', withRls, childrenController.deleteChild);

module.exports = router;
