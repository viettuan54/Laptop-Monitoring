const express = require('express');
const auth = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const { pushTestLimiter } = require('../middlewares/rateLimit.middleware');
const notificationsController = require('../controllers/notifications.controller');

const router = express.Router();

router.get('/tokens', auth, requireRole('parent'), notificationsController.getTokens);
router.post('/tokens', auth, requireRole('parent'), notificationsController.registerToken);
router.delete('/tokens/:id', auth, requireRole('parent'), notificationsController.deleteToken);
router.post('/test', auth, requireRole('parent'), pushTestLimiter, notificationsController.sendTest);

module.exports = router;
