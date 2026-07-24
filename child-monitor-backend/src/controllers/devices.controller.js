const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { recordAudit } = require('../services/audit.service');

exports.getDevices = async (req, res) => {
  const { child_id } = req.query;
  let { limit, offset } = req.query;

  // Pagination: default 50, max 200 (nhất quán với getAlerts, getAppLogs, v.v.)
  limit  = Math.min(parseInt(limit)  || 50, 200);
  offset = Math.max(parseInt(offset) || 0,  0);

  try {
    let result;
    if (child_id) {
      // Lấy danh sách thiết bị của một đứa trẻ cụ thể (được bảo vệ bởi RLS)
      // Không SELECT device_secret – chỉ trả về khi đăng ký lần đầu
      result = await req.db.query(
        'SELECT device_id, child_id, device_name, device_uid, created_at FROM devices WHERE child_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [child_id, limit, offset]
      );
    } else {
      // Lấy toàn bộ thiết bị thuộc quyền sở hữu của phụ huynh hiện tại
      result = await req.db.query(
        'SELECT device_id, child_id, device_name, device_uid, created_at FROM devices ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
    }
    res.json({ data: result.rows, limit, offset, count: result.rows.length });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


exports.registerDevice = async (req, res) => {
  const { child_id, device_name, device_uid } = req.body;

  if (!child_id || !device_name || !device_uid) {
    return res.status(400).json({ message: 'Missing required fields: child_id, device_name, device_uid' });
  }

  // Đảm bảo không vượt quá độ dài VARCHAR trong DB (nhất quán với logs.controller.js)
  if (device_name.length > 100) {
    return res.status(400).json({ message: 'device_name cannot exceed 100 characters' });
  }
  if (device_uid.length > 150) {
    return res.status(400).json({ message: 'device_uid cannot exceed 150 characters' });
  }

  // Validate format của device_uid: Chỉ cho phép chữ, số, dấu gạch ngang, gạch dưới, và dấu hai chấm
  // Thường dùng cho UUID, địa chỉ MAC, hoặc chuỗi định danh phần cứng tiêu chuẩn.
  const deviceUidRegex = /^[a-zA-Z0-9_\-:]+$/;
  if (!deviceUidRegex.test(device_uid)) {
    return res.status(400).json({ message: 'device_uid contains invalid characters. Only alphanumeric, -, _, and : are allowed.' });
  }

  try {
    // Sinh ngẫu nhiên plaintext UUID làm device secret
    const plaintextSecret = uuidv4();
    // Băm SHA-256 của device secret để lưu xuống DB
    const hashedSecret = crypto.createHash('sha256').update(plaintextSecret).digest('hex');

    // Nhờ RLS, nếu phụ huynh truyền child_id của đứa trẻ không thuộc sở hữu của mình,
    // câu lệnh INSERT sẽ bị chặn hoàn toàn bởi chính sách RLS
    // Trả về plaintext secret để lưu ở agent – đây là lần DUY NHẤT secret được tiết lộ
    const result = await req.db.query(
      `INSERT INTO devices(child_id, device_name, device_uid, device_secret)
       VALUES($1, $2, $3, $4)
       RETURNING device_id, child_id, device_name, device_uid, created_at`,
      [child_id, device_name, device_uid, hashedSecret]
    );

    res.status(201).json({
      ...result.rows[0],
      device_secret: plaintextSecret,
      _note: 'Lưu device_secret ngay – sẽ không được hiển thị lại qua API này'
    });
  } catch (error) {
    // Lỗi trùng lặp device_uid (Unique constraint violation)
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Device UID already registered' });
    }
    // Lỗi vi phạm khóa ngoại hoặc bị chặn bởi RLS
    if (error.code === '23503' || error.message.includes('row-level security')) {
      return res.status(403).json({ message: 'Access denied or invalid child_id' });
    }

    console.error('Register device error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateDevice = async (req, res) => {
  const { id } = req.params;
  const { device_name } = req.body;

  if (!device_name || typeof device_name !== 'string') {
    return res.status(400).json({ message: 'device_name is required and must be a string' });
  }
  
  if (device_name.length > 100) {
    return res.status(400).json({ message: 'device_name cannot exceed 100 characters' });
  }

  try {
    // Nhờ RLS, nếu phụ huynh không sở hữu thiết bị này, câu lệnh UPDATE sẽ không tác động dòng nào
    const result = await req.db.query(
      'UPDATE devices SET device_name = $1 WHERE device_id = $2 RETURNING device_id, child_id, device_name, device_uid, created_at',
      [device_name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Device not found or access denied' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteDevice = async (req, res) => {
  const { id } = req.params;

  try {
    // Nhờ RLS, nếu phụ huynh không sở hữu thiết bị này, câu lệnh DELETE sẽ không tác động dòng nào
    const result = await req.db.query(
      'DELETE FROM devices WHERE device_id = $1 RETURNING device_id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Device not found or access denied' });
    }

    await recordAudit(req.db, req, {
      action: 'device.delete',
      targetType: 'device',
      targetId: result.rows[0].device_id,
    });

    res.json({ message: 'Device deleted successfully', device_id: result.rows[0].device_id });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/devices/:id/rotate-secret
// Xoay vòng Device Secret: sinh UUID mới, hash SHA-256, lưu vào DB.
// Secret cũ bị vô hiệu hóa ngay lập tức.
// Secret mới được trả về plaintext DUY NHẤT LẦN NÀY – phụ huynh
// phải cập nhật ngay vào Agent trên laptop của trẻ.
// ────────────────────────────────────────────────────────────────
exports.rotateSecret = async (req, res) => {
  const { id } = req.params;

  try {
    // Sinh plaintext UUID mới
    const newPlaintextSecret = uuidv4();
    const newHashedSecret = crypto.createHash('sha256').update(newPlaintextSecret).digest('hex');

    // Nhờ RLS, nếu phụ huynh không sở hữu thiết bị này, UPDATE trả về 0 dòng
    const result = await req.db.query(
      `UPDATE devices
       SET device_secret = $1
       WHERE device_id = $2
       RETURNING device_id, child_id, device_name, device_uid, created_at`,
      [newHashedSecret, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Device not found or access denied' });
    }

    await recordAudit(req.db, req, {
      action: 'device.rotate_secret',
      targetType: 'device',
      targetId: result.rows[0].device_id,
    });

    res.json({
      ...result.rows[0],
      device_secret: newPlaintextSecret,
      _note: 'Đây là lần duy nhất secret mới được hiển thị. Hãy cập nhật ngay vào Agent trên thiết bị của trẻ.',
    });
  } catch (error) {
    console.error('Rotate secret error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

