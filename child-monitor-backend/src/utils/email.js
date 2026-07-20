const nodemailer = require('nodemailer');

let transporter = null;
let transporterInitialized = false;

/**
 * Khởi tạo SMTP transporter dựa trên cấu hình môi trường.
 * Chỉ nên gọi 1 lần khi server khởi động (từ server.js).
 * Nếu gọi nhiều lần, các lần sau sẽ bị bỏ qua (idempotent).
 */
const initTransporter = () => {
  // Idempotent: không khởi tạo lại nếu đã chạy
  if (transporterInitialized) return;
  transporterInitialized = true;

  const isProduction = process.env.NODE_ENV === 'production';
  const hasSMTP =
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD;

  if (isProduction && !hasSMTP) {
    // Fail-fast ở production: không thể gửi email mà không có SMTP
    throw new Error(
      '❌ Môi trường PRODUCTION yêu cầu cấu hình đầy đủ biến SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD.'
    );
  }

  if (hasSMTP) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: parseInt(process.env.SMTP_PORT) === 465, // true cho port 465, false cho các port khác
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
    console.log('📬 Nodemailer SMTP Transporter đã được cấu hình thành công.');
  } else {
    // Dev mode không có SMTP: email sẽ được ghi ra console
    console.log('📬 Hệ thống đang ở chế độ phát triển và không cấu hình SMTP. Email sẽ được ghi ra console.');
  }
};

/**
 * Gửi email xác minh tài khoản hoặc đặt lại mật khẩu.
 * Gọi initTransporter() từ server.js trước khi dùng hàm này.
 *
 * @param {object} options
 * @param {string} options.to          Địa chỉ email nhận
 * @param {string} options.subject     Tiêu đề email
 * @param {string} options.html        Nội dung định dạng HTML
 * @param {string} options.textFallback Nội dung văn bản thô dự phòng
 */
async function sendMail({ to, subject, html, textFallback }) {
  // Không gọi initTransporter() ở đây để tránh double-init
  // initTransporter() đã được gọi từ server.js lúc startup
  // Nếu vì lý do nào đó chưa gọi (unit test, v.v.) thì transporter = null → fallback console

  const from = process.env.SMTP_FROM || '"Laptop Monitor" <no-reply@laptopmonitor.local>';

  if (transporter) {
    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        text: textFallback,
        html,
      });
      console.log(`[Email Sent] Email đã gửi thành công tới: ${to}`);
    } catch (err) {
      console.error(`[Email Error] Lỗi khi gửi email tới ${to}:`, err.message);
      // Ở production, ném lỗi để caller quyết định xử lý
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  } else {
    // Dev fallback: ghi ra console thay vì gửi thật
    console.log('\n=================== MOCK EMAIL SENDING ===================');
    console.log(`FROM: ${from}`);
    console.log(`TO: ${to}`);
    console.log(`SUBJECT: ${subject}`);
    console.log(`TEXT FALLBACK:\n${textFallback}`);
    console.log('==========================================================\n');
  }
}

module.exports = {
  sendMail,
  initTransporter,
};
