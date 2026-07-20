const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

app.set('trust proxy', 1);

// ── Security Headers ──────────────────────────────────────────────────────
// helmet đặt các HTTP header bảo mật cơ bản:
// X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, v.v.
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────
// Fail-safe: chặt chẽ theo hướng bảo mật
//   - Production: phải set ALLOWED_ORIGIN trong .env → chỉ cho phép origin đó
//   - Development (NODE_ENV=development và KHÔNG có ALLOWED_ORIGIN): mở cho localhost
//   - Nếu không set gì cả → trả về false (chặn tất cả) thay vì mở toàn bộ '*'
const getAllowedOrigin = () => {
  if (process.env.ALLOWED_ORIGIN) {
    return process.env.ALLOWED_ORIGIN;
  }
  if (process.env.NODE_ENV === 'development') {
    // Chỉ mở rộng trong môi trường dev local
    return /^http:\/\/localhost(:\d+)?$/;
  }
  // Production mà không set ALLOWED_ORIGIN → chặn tất cả
  return false;
};

const corsOptions = {
  origin: getAllowedOrigin(),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Secret'],
};
app.use(cors(corsOptions));

// ── Logs Route (Giao thức gửi log của Agent & xem log của Phụ huynh) ──────
// Đặt trước parser global để cho phép tùy biến giới hạn payload (100kb vs 1mb)
app.use('/api/logs', require('./routes/logs.routes'));

// Giữ limit 100kb global để ngăn chặn DoS (Payload lớn có thể làm cạn kiệt băng thông, CPU, RAM)
// đối với các route còn lại.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));

const { parentLimiter, agentLimiter } = require('./middlewares/rateLimit.middleware');

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', parentLimiter, require('./routes/auth.routes'));
app.use('/api/children', parentLimiter, require('./routes/children.routes'));
app.use('/api/devices', parentLimiter, require('./routes/devices.routes'));
app.use('/api/settings', parentLimiter, require('./routes/settings.routes'));
app.use('/api/alerts', parentLimiter, require('./routes/alerts.routes'));
app.use('/api/ai-analysis', parentLimiter, require('./routes/aiAnalysis.routes'));
app.use('/api/agent', agentLimiter, require('./routes/agent.routes'));
app.use('/api/admin', parentLimiter, require('./routes/admin.routes'));

app.get('/', (req, res) => {
  res.send('Child Monitoring Backend is running');
});

// 404 handler – route không tồn tại
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler – bắt lỗi từ middleware và async throw ngoài try/catch
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Payload too large' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON payload' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;