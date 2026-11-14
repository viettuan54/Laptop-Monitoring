/**
 * Kiểm tra thiết bị thuộc quyền phụ huynh bằng connection RLS hiện tại, sau đó
 * giải phóng connection ngay trước khi chuyển sang tác vụ chậm không dùng RLS.
 *
 * Middleware này phải được đặt sau auth + withRls.
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.db || typeof req.releaseRls !== 'function') {
      throw new Error('RLS context is required before device ownership check');
    }

    const { device_id } = req.params;
    const result = await req.db.query(
      'SELECT device_id FROM devices WHERE device_id = $1',
      [device_id]
    );

    if (result.rows.length === 0) {
      await req.releaseRls(false);
      return res.status(404).json({ message: 'Device not found or access denied' });
    }

    // SELECT ownership đã hoàn tất; không giữ transaction/connection trong lúc
    // controller chờ Gemini. COMMIT cũng xóa app.current_user_id transaction-local.
    await req.releaseRls(true);
    req.db = null;
    next();
  } catch (error) {
    console.error('Device ownership middleware error:', error);
    if (typeof req.releaseRls === 'function') {
      await req.releaseRls(false).catch(() => {});
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
};
