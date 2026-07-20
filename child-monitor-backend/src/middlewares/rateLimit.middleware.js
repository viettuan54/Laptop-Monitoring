const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

/**
 * Brute force protection – giới hạn 5 lần login sai / 1 phút / 1 IP
 */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 phút
  max: 5,                       // tối đa 5 request
  skipSuccessfulRequests: true, // chỉ đếm request thất bại
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * Register spam protection – giới hạn 10 lần đăng ký / 1 giờ / 1 IP
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1 giờ
  max: 10,                      // tối đa 10 request
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many registrations, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * AI Analysis Limiter - Giới hạn 5 lần / 1 giờ / 1 thiết bị của phụ huynh
 */
const aiAnalysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 5,
  // Note: for /chat route, req.params.device_id is undefined, so the limit behaves as 5 requests / hour / user.
  keyGenerator: (req) => `${req.user.user_id}:${req.params.device_id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many AI analysis requests for this device, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * AI Summary Limiter - Giới hạn 10 lần / 1 giờ / 1 thiết bị của phụ huynh
 */
const aiSummaryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 10,
  keyGenerator: (req) => `${req.user.user_id}:${req.params.device_id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many AI summary requests for this device, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * parentLimiter - Giới hạn 100 requests / 15 phút / IP cho phụ huynh
 */
const parentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * agentLimiter - Giới hạn 600 requests / 15 phút cho agent gửi logs,
 * dùng hash của device_secret làm key để giải quyết vấn đề dùng chung NAT/IP
 */
const agentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 600,
  keyGenerator: (req) => {
    const secret = req.headers['x-device-secret'];
    if (secret) {
      // Validate format UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(secret)) {
        return crypto.createHash('sha256').update(secret).digest('hex');
      }
    }
    return req.ip; // Fallback về IP nếu thiếu/sai định dạng secret
  },
  // Tắt cảnh báo về X-Forwarded-For vì keyGenerator đã dùng device secret (không phụ thuộc IP)
  validate: { xForwardedForHeader: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many log uploads from this device' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * forgotPasswordLimiter - Giới hạn 3 lần quên mật khẩu / 1 giờ / IP
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset requests, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * verifyEmailLimiter - Giới hạn 10 lần verify / 15 phút / IP
 */
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many email verification attempts, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * resendVerificationLimiter - Giới hạn 3 lần gửi lại email xác minh / 1 giờ / IP
 */
const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many verification email requests, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

/**
 * resetPasswordLimiter - Giới hạn 10 lần đặt lại mật khẩu / 1 giờ / IP
 */
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 10,                  // 10 lần (nới rộng hơn forgotPasswordLimiter)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset attempts, try again later' },
  handler: (req, res, next, options) => {
    res.status(429).json(options.message);
  },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  aiAnalysisLimiter,
  aiSummaryLimiter,
  parentLimiter,
  agentLimiter,
  forgotPasswordLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
  resetPasswordLimiter,
};
