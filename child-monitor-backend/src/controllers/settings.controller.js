const { recordAudit } = require('../services/audit.service');

exports.getSettings = async (req, res) => {
  const { child_id } = req.params;

  try {
    // 1. Tìm cấu hình hiện tại của đứa trẻ (được bảo vệ bởi RLS)
    let result = await req.db.query(
      `SELECT setting_id, child_id, daily_limit_minutes, allowed_start_time, allowed_end_time,
              is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog, updated_at
       FROM settings WHERE child_id = $1`,
      [child_id]
    );

    // 2. Nếu chưa có cấu hình, tự động khởi tạo cấu hình mặc định (nếu đứa trẻ tồn tại và thuộc quyền sở hữu)
    if (result.rows.length === 0) {
      // Kiểm tra xem đứa trẻ có tồn tại và phụ huynh có quyền sở hữu không (thông qua RLS trên bảng children)
      const childCheck = await req.db.query('SELECT child_id FROM children WHERE child_id = $1', [child_id]);
      if (childCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Child not found or access denied' });
      }

      // Khởi tạo cấu hình mặc định trong database
      result = await req.db.query(
        `INSERT INTO settings(child_id)
         VALUES($1)
         RETURNING setting_id, child_id, daily_limit_minutes, allowed_start_time, allowed_end_time,
                   is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog, updated_at`,
        [child_id]
      );
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateSettings = async (req, res) => {
  const { child_id } = req.params;
  const {
    daily_limit_minutes,
    allowed_start_time,
    allowed_end_time,
    is_locked,
    enable_webcam_monitoring,
    enable_screenshot_review,
    enable_keylog,
  } = req.body;

  // Validate daily_limit_minutes: số nguyên từ 0 đến 1440 (24 giờ)
  if (daily_limit_minutes !== undefined && daily_limit_minutes !== null) {
    const limitNum = Number(daily_limit_minutes);
    if (!Number.isInteger(limitNum) || limitNum < 0 || limitNum > 1440) {
      return res.status(400).json({ message: 'daily_limit_minutes must be an integer between 0 and 1440' });
    }
  }

  // Validate allowed_start_time và allowed_end_time: định dạng HH:MM hoặc HH:MM:SS
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
  if (allowed_start_time && !timeRegex.test(allowed_start_time)) {
    return res.status(400).json({ message: 'allowed_start_time must be in HH:MM or HH:MM:SS format' });
  }
  if (allowed_end_time && !timeRegex.test(allowed_end_time)) {
    return res.status(400).json({ message: 'allowed_end_time must be in HH:MM or HH:MM:SS format' });
  }

  // Validate boolean fields (bao gồm is_locked để tránh lỗi kiểu dữ liệu ở DB)
  const boolFields = { is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog };
  for (const [key, val] of Object.entries(boolFields)) {
    if (val !== undefined && val !== null && typeof val !== 'boolean') {
      return res.status(400).json({ message: `${key} must be a boolean` });
    }
  }

  try {
    // Kiểm tra xem đứa trẻ có tồn tại và thuộc quyền sở hữu không trước khi cập nhật/chèn cấu hình
    const childCheck = await req.db.query('SELECT child_id FROM children WHERE child_id = $1', [child_id]);
    if (childCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    // Sử dụng INSERT ... ON CONFLICT để cập nhật hoặc tạo mới nếu chưa tồn tại cấu hình
    const result = await req.db.query(
      `INSERT INTO settings (
         child_id, daily_limit_minutes, allowed_start_time, allowed_end_time, is_locked,
         enable_webcam_monitoring, enable_screenshot_review, enable_keylog
       )
       VALUES (
         $1,
         COALESCE($2, 120),
         COALESCE($3, '07:00:00'::TIME),
         COALESCE($4, '21:00:00'::TIME),
         COALESCE($5, FALSE),
         COALESCE($6, FALSE),
         COALESCE($7, FALSE),
         COALESCE($8, FALSE)
       )
       ON CONFLICT (child_id)
       DO UPDATE SET
         daily_limit_minutes       = COALESCE($2, settings.daily_limit_minutes),
         allowed_start_time        = COALESCE($3, settings.allowed_start_time),
         allowed_end_time          = COALESCE($4, settings.allowed_end_time),
         is_locked                 = COALESCE($5, settings.is_locked),
         enable_webcam_monitoring  = COALESCE($6, settings.enable_webcam_monitoring),
         enable_screenshot_review  = COALESCE($7, settings.enable_screenshot_review),
         enable_keylog             = COALESCE($8, settings.enable_keylog),
         updated_at                = CURRENT_TIMESTAMP
       RETURNING setting_id, child_id, daily_limit_minutes, allowed_start_time, allowed_end_time,
                 is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog, updated_at`,
      [
        child_id,
        daily_limit_minutes,
        allowed_start_time,
        allowed_end_time,
        is_locked,
        enable_webcam_monitoring,
        enable_screenshot_review,
        enable_keylog,
      ]
    );

    const changedFields = Object.entries({
      daily_limit_minutes,
      allowed_start_time,
      allowed_end_time,
      is_locked,
      enable_webcam_monitoring,
      enable_screenshot_review,
      enable_keylog,
    })
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([field]) => field);

    await recordAudit(req.db, req, {
      action: 'settings.update',
      targetType: 'child',
      targetId: child_id,
      metadata: { changed_fields: changedFields },
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
