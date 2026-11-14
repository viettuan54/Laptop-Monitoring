const { backendPool } = require('../config/db');

/**
 * Middleware thiết lập Row Level Security (RLS) context cho phụ huynh.
 *
 * Cách hoạt động:
 *  - Lấy một connection từ backendPool (non-superuser → RLS có hiệu lực)
 *  - Bắt đầu transaction để set_config với is_local=TRUE (scoped theo transaction)
 *    → Đảm bảo user_id được reset ngay khi transaction kết thúc, tránh leak
 *    giữa các request trong cùng một pooled connection.
 *  - Gán req.db = client để controller dùng trong cùng connection/transaction
 *  - Hoàn tất transaction trước khi gửi response; ngắt kết nối thì rollback.
 *  - Các route dùng middleware này trả response không streaming (JSON/send/end).
 *
 * Tại sao dùng transaction thay vì set_config(..., false)?
 *  - set_config('key', val, false): scoped theo session/connection
 *    → Nếu RESET không chạy được (exception/lỗi mạng), connection pool
 *       tái sử dụng connection cũ với user_id cũ → data leak chéo request.
 *  - set_config('key', val, true): scoped theo transaction hiện tại
 *    → Ngay khi COMMIT/ROLLBACK, giá trị tự động bị xóa → an toàn hơn.
 */
module.exports = async (req, res, next) => {
  let client;
  try {
    client = await backendPool.connect();

    // Bắt đầu transaction để set_config có thể dùng is_local=TRUE
    await client.query('BEGIN');

    // is_local=TRUE: giá trị chỉ tồn tại trong phạm vi transaction này
    // → Khi ROLLBACK/COMMIT, app.current_user_id tự động được reset về null
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [String(req.user.user_id)]
    );

    req.db = client;
  } catch (error) {
    console.error('RLS context setup error:', error);
    if (client) {
      let rollbackError;
      try { await client.query('ROLLBACK'); } catch (err) { rollbackError = err; }
      client.release(rollbackError);
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  // Share the in-flight promise: concurrent callers must await the same COMMIT.
  let completion;
  const releaseClient = (success) => {
    if (!completion) completion = (async () => {
      let transactionError;
      try {
        const result = await client.query(success ? 'COMMIT' : 'ROLLBACK');
        // PostgreSQL can resolve COMMIT with ROLLBACK after an earlier SQL error.
        if (success && result?.command === 'ROLLBACK') {
          throw new Error('RLS transaction was rolled back instead of committed');
        }
      } catch (err) {
        transactionError = err;
        console.error('[CRITICAL] Error releasing RLS transaction client:', err.message);
        throw err;
      } finally {
        // Discard failed/uncertain connections instead of returning them to the pool.
        client.release(transactionError);
      }
    })();
    return completion;
  };

  // Cho phép middleware/controller kết thúc RLS transaction sớm khi phần còn
  // lại của request không cần req.db (ví dụ: gọi API AI qua mạng ngoài).
  // Lỗi COMMIT phải truyền tới caller, không được biến thành kết quả thành công.
  req.releaseRls = releaseClient;

  const originalEnd = res.end;
  let ending = false;
  res.end = function (...args) {
    if (ending) return this;
    ending = true;
    releaseClient(res.statusCode < 400).then(() => {
      if (!res.destroyed) originalEnd.apply(res, args);
    }).catch(() => {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      // Replace both the success body and its entity headers before sending 500.
      res.end = originalEnd;
      res.removeHeader('Content-Length');
      res.removeHeader('ETag');
      res.removeHeader('Content-Encoding');
      res.status(500).json({ message: 'Internal server error' });
    });
    return this;
  };

  const rollbackOnClose = () => { releaseClient(false).catch(() => {}); };
  res.on('close', rollbackOnClose);
  if (res.destroyed) {
    rollbackOnClose();
    return;
  }

  next();
};
