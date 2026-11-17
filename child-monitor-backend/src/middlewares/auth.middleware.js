const jwt = require('jsonwebtoken');
const { adminPool } = require('../config/db');
const { isBlacklisted } = require('../utils/tokenBlacklist');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Case 2: Không gửi Authorization header
    if (!authHeader) {
      return res.status(401).json({ message: 'Authorization header missing' });
    }

    // Case 3: Sai format (không có "Bearer <token>")
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Invalid authorization format' });
    }

    const token = parts[1];

    // Case 4: Bearer nhưng token rỗng ("Authorization: Bearer")
    if (!token) {
      return res.status(401).json({ message: 'Token missing' });
    }

    let decoded;
    try {
      // Case 9: CHỈ chấp nhận HS256 → chặn alg "none" hoặc các alg khác
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
      });
    } catch (err) {
      // Case 6: Token hết hạn
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expired' });
      }
      // Case 5: random string không phải JWT
      // Case 7: ký bằng secret khác → signature mismatch
      // Case 8: payload bị sửa nhưng không ký lại → signature mismatch
      // Case 9: alg không hợp lệ → bị chặn bởi options.algorithms ở trên
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Case 11: Token đã bị revoke/blacklist (logout) – kiểm tra theo jti
    // jti cần có trong payload; token cũ (trước khi patch) sẽ không có jti
    if (decoded.jti) {
      const revoked = await isBlacklisted(decoded.jti);
      if (revoked) {
        return res.status(401).json({ message: 'Token has been revoked' });
      }
    }

    let userResult;
    try {
      userResult = await adminPool.query(
        'SELECT user_id, name, email, role, token_version, is_active, is_verified, face_enrolled FROM users WHERE user_id = $1',
        [decoded.user_id]
      );
    } catch (dbError) {
      console.error('Auth middleware DB error:', dbError);
      // Không trả 500 ở middleware auth — coi như không xác thực được
      return res.status(401).json({ message: 'Invalid token' });
    }

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const dbUser = userResult.rows[0];
    if (dbUser.role === 'admin' && (!dbUser.face_enrolled || !dbUser.is_verified || decoded.face_verified !== true)) {
      return res.status(401).json({ message: 'Admin face verification required. Please sign in again' });
    }
    if (!dbUser.is_active) {
      return res.status(401).json({ message: 'Account has been disabled' });
    }
    // Kiểm tra token_version để vô hiệu hóa phiên khi mật khẩu thay đổi
    // Fail closed for legacy/malformed tokens without token_version. Otherwise
    // such tokens would survive password changes until their normal expiry.
    if (decoded.token_version === undefined || decoded.token_version !== dbUser.token_version) {
      return res.status(401).json({ message: 'Token has been revoked due to password change' });
    }

    // Case 1: Token hợp lệ → cho đi tiếp
    req.user = decoded;          // { user_id, jti, iat, exp }
    req.currentUser = dbUser; // dữ liệu user mới nhất từ DB (vd: role)

    next();
  } catch (error) {
    console.error('Auth middleware unexpected error:', error);
    return res.status(401).json({ message: 'Invalid token' });
  }
};
