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
 *  - Khi request kết thúc (finish/close), ROLLBACK + release connection về pool
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
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      client.release();
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  let released = false;
  const releaseClient = async () => {
    if (!released) {
      released = true;
      try {
        // ROLLBACK để reset transaction-scoped set_config và giải phóng lock
        // Không cần RESET app.current_user_id vì transaction-scoped tự xóa
        await client.query('ROLLBACK');
      } catch (err) {
        console.error('Error rolling back RLS transaction:', err.message);
      } finally {
        client.release();
      }
    }
  };

  // Đăng ký giải phóng connection khi request kết thúc hoặc bị ngắt kết nối giữa chừng
  res.on('finish', releaseClient);
  res.on('close', releaseClient);

  next();
};
