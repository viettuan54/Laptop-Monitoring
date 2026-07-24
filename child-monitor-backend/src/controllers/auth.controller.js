const { adminPool } = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { recordAudit } = require('../services/audit.service');
const { v4: uuidv4 } = require('uuid');
const { revokeToken } = require('../utils/tokenBlacklist');
const crypto = require('crypto');
const { validatePassword } = require('../utils/validation');
const { sendMail } = require('../utils/email');

const handleFailedAttempt = async (email) => {
  try {
    const result = await adminPool.query(
      `INSERT INTO failed_login_attempts(email, attempt_count, last_attempt)
       VALUES ($1, 1, NOW())
       ON CONFLICT (email) DO UPDATE
       SET attempt_count = failed_login_attempts.attempt_count + 1, last_attempt = NOW()
       RETURNING attempt_count`,
      [email]
    );
    
    const count = result.rows[0].attempt_count;
    if (count >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // Khóa 15 phút
      await adminPool.query(
        'UPDATE failed_login_attempts SET lock_until = $1, attempt_count = 0 WHERE email = $2',
        [lockUntil, email]
      );
      return true; // Đã bị khóa
    }
    return false; // Chưa bị khóa
  } catch (err) {
    console.error('[BruteForce Protection Error] Failed to handle failed attempt:', err);
    return false; // Fail-open
  }
};

exports.register = async (req, res) => {
  const { name, email, password } = req.body;

  // ── VALIDATION ──────────────────────────────────────────────────
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── DATABASE ─────────────────────────────────────────────────────
  try {
    // Check if email already exists to prevent account enumeration
    const existingUser = await adminPool.query('SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (existingUser.rows.length > 0) {
      // Simulate password hashing to prevent timing attacks
      await bcrypt.hash(password, 12);
      console.log(`[Email Registration Attempt for ${normalizedEmail}]: Email already exists. Sent security notification.`);
      return res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const verificationTokenRaw = crypto.randomBytes(32).toString('hex');
    const verificationTokenHashed = crypto.createHash('sha256').update(verificationTokenRaw).digest('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await adminPool.query(
      'INSERT INTO users(name, email, password, verification_token, verification_token_expires) VALUES($1,$2,$3,$4,$5)',
      [name, normalizedEmail, hashed, verificationTokenHashed, verificationTokenExpires]
    );

    // Link trỏ về FRONTEND_URL để frontend bắt token rồi gọi POST /api/auth/verify
    const frontendBase = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verificationLink = `${frontendBase}/verify?token=${verificationTokenRaw}`;
    console.log(`[Email Verification Link for ${normalizedEmail}]: ${verificationLink}`);

    // Fire-and-forget: không await để tránh lỗi SMTP khiến user nhận 500
    // dù tài khoản đã được tạo thành công trong DB.
    sendMail({
      to: normalizedEmail,
      subject: 'Xác minh tài khoản - Laptop Monitor',
      textFallback: `Vui lòng nhấp vào đường dẫn sau để xác minh tài khoản của bạn: ${verificationLink}`,
      html: `
        <h3>Chào bạn ${name},</h3>
        <p>Cảm ơn bạn đã đăng ký sử dụng hệ thống giám sát laptop trẻ em <b>Laptop Monitor</b>.</p>
        <p>Vui lòng nhấp vào đường dẫn bên dưới để hoàn tất việc xác minh tài khoản:</p>
        <p><a href="${verificationLink}" target="_blank" style="padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">Xác minh tài khoản</a></p>
        <p>Đường dẫn này có hiệu lực trong vòng 24 giờ.</p>
        <p>Trân trọng,<br>Đội ngũ Laptop Monitor</p>
      `
    }).catch(err => console.error(`[Email Error] Gửi email xác minh tới ${normalizedEmail} thất bại:`, err.message));

    res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
  } catch (error) {
    if (error.code === '23505') {
      console.log(`[Email Registration Race Condition for ${email}]: Email already exists (Unique constraint). Sent security notification.`);
      return res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });
    }
    console.error('Register error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.login = async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ message: 'Request body is empty' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Missing email or password' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Kiểm tra nếu tài khoản đang bị khóa tạm thời (sử dụng Database với chính sách Fail-Open)
  try {
    const lockCheck = await adminPool.query(
      'SELECT lock_until FROM failed_login_attempts WHERE email = $1',
      [normalizedEmail]
    );
    if (lockCheck.rows.length > 0) {
      const lockUntil = lockCheck.rows[0].lock_until;
      if (lockUntil && new Date(lockUntil) > new Date()) {
        const remainingTime = Math.ceil((new Date(lockUntil) - new Date()) / 1000 / 60);
        return res.status(429).json({
          message: `Too many failed attempts. This account is temporarily locked. Please try again in ${remainingTime} minutes.`
        });
      }
    }
  } catch (err) {
    console.error('[BruteForce Protection Error] Failed to check lock status:', err);
    // Fail-open: tiếp tục đăng nhập nếu database lỗi kiểm tra khóa
  }

  try {
    const result = await adminPool.query(
      'SELECT user_id, name, email, password, role, is_verified, token_version FROM users WHERE LOWER(email)=LOWER($1)',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      // Giả lập hash password để tránh timing attack
      await bcrypt.hash(password, 12);
      
      const isLocked = await handleFailedAttempt(normalizedEmail);
      if (isLocked) {
        return res.status(429).json({ message: 'Too many failed attempts. This account is temporarily locked. Please try again in 15 minutes.' });
      }
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      const isLocked = await handleFailedAttempt(normalizedEmail);
      if (isLocked) {
        return res.status(429).json({ message: 'Too many failed attempts. This account is temporarily locked. Please try again in 15 minutes.' });
      }
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Đảm bảo kiểm tra xác minh email CHỈ sau khi đã đúng password
    if (!user.is_verified) {
      return res.status(403).json({ message: 'Email not verified. Please verify your email first.' });
    }

    // Đăng nhập thành công -> xóa số lần thử sai trong DB (Fail-Open nếu lỗi)
    try {
      await adminPool.query('DELETE FROM failed_login_attempts WHERE email = $1', [normalizedEmail]);
    } catch (err) {
      console.error('[BruteForce Protection Error] Failed to clear failed attempts:', err);
    }

    const jti = uuidv4();

    const accessToken = jwt.sign(
      { user_id: user.user_id, token_version: user.token_version, jti },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshTokenRaw = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
    const refreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await adminPool.query(
      'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1, $2, $3)',
      [user.user_id, refreshTokenHash, refreshTokenExpires]
    );

    res.json({ accessToken, refreshToken: refreshTokenRaw });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.logout = async (req, res) => {
  try {
    const { jti, exp } = req.user;
    if (jti && exp) {
      const expiresAt = new Date(exp * 1000);
      await revokeToken(jti, expiresAt);
    }

    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await adminPool.query(
        'DELETE FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash]
      );
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('[CRITICAL SECURITY ALERT] Logout token revocation failed:', error);
    res.json({ message: 'Logged out successfully' });
  }
};

exports.verifyEmail = async (req, res) => {
  const token = req.body?.token;
  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const result = await adminPool.query(
      'SELECT * FROM users WHERE verification_token = $1 AND verification_token_expires > NOW()',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    const user = result.rows[0];
    await adminPool.query(
      'UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE user_id = $1',
      [user.user_id]
    );

    res.json({ message: 'Email verified successfully. You can now login.' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resendVerification = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Missing email or password' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const result = await adminPool.query('SELECT user_id, name, email, password, is_verified FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    const verificationTokenRaw = crypto.randomBytes(32).toString('hex');
    const verificationTokenHashed = crypto.createHash('sha256').update(verificationTokenRaw).digest('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await adminPool.query(
      'UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE user_id = $3',
      [verificationTokenHashed, verificationTokenExpires, user.user_id]
    );

    const frontendBase = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verificationLink = `${frontendBase}/verify?token=${verificationTokenRaw}`;
    console.log(`[Resent Email Verification Link for ${normalizedEmail}]: ${verificationLink}`);

    // Fire-and-forget
    sendMail({
      to: normalizedEmail,
      subject: 'Gửi lại mã xác minh tài khoản - Laptop Monitor',
      textFallback: `Vui lòng nhấp vào đường dẫn sau để xác minh tài khoản của bạn: ${verificationLink}`,
      html: `
        <h3>Chào bạn ${user.name},</h3>
        <p>Bạn đã yêu cầu gửi lại email xác minh tài khoản cho hệ thống <b>Laptop Monitor</b>.</p>
        <p>Vui lòng nhấp vào đường dẫn bên dưới để hoàn tất việc xác minh tài khoản:</p>
        <p><a href="${verificationLink}" target="_blank" style="padding: 10px 20px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">Xác minh tài khoản</a></p>
        <p>Đường dẫn này có hiệu lực trong vòng 24 giờ.</p>
        <p>Trân trọng,<br>Đội ngũ Laptop Monitor</p>
      `
    }).catch(err => console.error(`[Email Error] Gửi email xác minh tới ${normalizedEmail} thất bại:`, err.message));

    res.json({ message: 'Verification email resent successfully' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ message: 'New password must be at least 8 characters and include an uppercase letter, a number, and a special character' });
  }

  const dbClient = await adminPool.connect();
  try {
    const userId = req.user.user_id;
    const result = await dbClient.query('SELECT user_id, email, password FROM users WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) {
      return res.status(400).json({ message: 'Invalid old password' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    await dbClient.query('BEGIN');
    try {
      await dbClient.query(
        'UPDATE users SET password = $1, token_version = token_version + 1 WHERE user_id = $2',
        [hashed, userId]
      );
      await dbClient.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [userId]
      );
      await recordAudit(dbClient, req, {
        action: 'account.change_password',
        targetType: 'user',
        targetId: userId,
      });
      await dbClient.query('COMMIT');
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    }

    res.json({ message: 'Password changed successfully. All previous sessions revoked.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    dbClient.release();
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  const genericResponse = { message: 'If the email exists, a password reset link has been sent.' };

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const result = await adminPool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.json(genericResponse);
    }

    const user = result.rows[0];
    const resetTokenRaw = crypto.randomBytes(32).toString('hex');
    const resetTokenHashed = crypto.createHash('sha256').update(resetTokenRaw).digest('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await adminPool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE user_id = $3',
      [resetTokenHashed, resetTokenExpires, user.user_id]
    );

    const frontendBase = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${frontendBase}/reset-password?token=${resetTokenRaw}`;
    console.log(`[Password Reset Link for ${normalizedEmail}]: ${resetLink}`);

    // Fire-and-forget
    sendMail({
      to: normalizedEmail,
      subject: 'Yêu cầu đặt lại mật khẩu - Laptop Monitor',
      textFallback: `Vui lòng nhấp vào đường dẫn sau để đặt lại mật khẩu của bạn: ${resetLink}`,
      html: `
        <h3>Chào bạn ${user.name},</h3>
        <p>Bạn nhận được email này vì bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu cho tài khoản <b>Laptop Monitor</b>.</p>
        <p>Vui lòng nhấp vào đường dẫn bên dưới để thực hiện đặt lại mật khẩu:</p>
        <p><a href="${resetLink}" target="_blank" style="padding: 10px 20px; background-color: #f44336; color: white; text-decoration: none; border-radius: 5px; display: inline-block;">Đặt lại mật khẩu</a></p>
        <p>Đường dẫn này có hiệu lực trong vòng 1 giờ. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
        <p>Trân trọng,<br>Đội ngũ Laptop Monitor</p>
      `
    }).catch(err => console.error(`[Email Error] Gửi email đặt lại mật khẩu tới ${normalizedEmail} thất bại:`, err.message));

    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ message: 'Missing token or new password' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character' });
  }

  const dbClient = await adminPool.connect();
  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const result = await dbClient.query(
      'SELECT user_id, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    const user = result.rows[0];
    const hashed = await bcrypt.hash(newPassword, 12);

    await dbClient.query('BEGIN');
    try {
      await dbClient.query(
        `UPDATE users 
         SET password = $1, reset_token = NULL, reset_token_expires = NULL, token_version = token_version + 1 
         WHERE user_id = $2`,
        [hashed, user.user_id]
      );
      await dbClient.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [user.user_id]
      );
      await recordAudit(dbClient, req, {
        action: 'account.reset_password',
        targetType: 'user',
        targetId: user.user_id,
        actorUserId: user.user_id,
        actorRole: 'password_reset',
      });
      await dbClient.query('COMMIT');
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    }

    res.json({ message: 'Password reset successfully. All previous sessions revoked.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    dbClient.release();
  }
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  let dbClient;
  let transactionOpen = false;
  try {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    dbClient = await adminPool.connect();
    await dbClient.query('BEGIN');
    transactionOpen = true;

    // Consume token theo một thao tác atomic. Với hai request đồng thời, chỉ một
    // transaction có thể DELETE được row và nhận quyền phát token kế tiếp.
    const consumedToken = await dbClient.query(
      `DELETE FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING token_id, user_id`,
      [tokenHash]
    );

    if (consumedToken.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      transactionOpen = false;
      console.warn(`[SECURITY WARNING] Invalid or expired refresh token attempt from IP: ${req.ip}`);
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const dbToken = consumedToken.rows[0];

    const userResult = await dbClient.query(
      'SELECT token_version FROM users WHERE user_id = $1',
      [dbToken.user_id]
    );

    if (userResult.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      transactionOpen = false;
      return res.status(401).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Sinh access token mới và refresh token mới
    const jti = uuidv4();
    const newAccessToken = jwt.sign(
      { user_id: dbToken.user_id, token_version: user.token_version, jti },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshTokenRaw = crypto.randomBytes(40).toString('hex');
    const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshTokenRaw).digest('hex');
    const newRefreshTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await dbClient.query(
      'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1, $2, $3)',
      [dbToken.user_id, newRefreshTokenHash, newRefreshTokenExpires]
    );

    await dbClient.query('COMMIT');
    transactionOpen = false;

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenRaw
    });
  } catch (error) {
    if (dbClient && transactionOpen) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[CRITICAL SECURITY ALERT] Refresh rollback failed:', rollbackError);
      }
    }
    console.error('Refresh token error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
};

// ────────────────────────────────────────────────────────────────
// DELETE /api/auth/account
// Phụ huynh xóa hoàn toàn tài khoản và dữ liệu hệ thống (Quyền được lãng quên)
// Yêu cầu xác thực JWT + truyền password để xác nhận hành động.
// ────────────────────────────────────────────────────────────────
exports.deleteAccount = async (req, res) => {
  const { password } = req.body;
  const user_id = req.user.user_id; // Đã qua middleware auth

  if (!password) {
    return res.status(400).json({ message: 'Password is required to confirm account deletion' });
  }

  const dbClient = await adminPool.connect();
  try {
    // 1. Kiểm tra sự tồn tại của user và đối chiếu mật khẩu
    const userResult = await dbClient.query(
      'SELECT password FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, userResult.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password. Deletion cancelled.' });
    }

    // 2. Tiến hành xóa tài khoản. DB với ON DELETE CASCADE trên children, devices, logs, v.v.
    // sẽ tự động dọn dẹp sạch toàn bộ dữ liệu đi kèm.
    await dbClient.query('BEGIN');
    await recordAudit(dbClient, req, {
      action: 'account.delete',
      targetType: 'user',
      targetId: user_id,
    });
    await dbClient.query('DELETE FROM users WHERE user_id = $1', [user_id]);
    await dbClient.query('COMMIT');

    res.json({
      message: 'Your account and all associated child data have been permanently deleted.'
    });
  } catch (error) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    dbClient.release();
  }
};
