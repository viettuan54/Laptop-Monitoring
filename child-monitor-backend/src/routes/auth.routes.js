const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const authController = require('../controllers/auth.controller');
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
  resetPasswordLimiter,
  faceAuthLimiter,
} = require('../middlewares/rateLimit.middleware');

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/admin-face', faceAuthLimiter, authController.verifyAdminFace);
router.post('/logout', auth, authController.logout);

// Email verification routes
router.post('/verify', verifyEmailLimiter, authController.verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, authController.resendVerification);

// Password management routes
router.post('/change-password', auth, authController.changePassword);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/refresh', authController.refresh);

// Delete account (GDPR Privacy right to be forgotten)
router.delete('/account', auth, authController.deleteAccount);

module.exports = router;
