# SafeNest Parent Dashboard

Dashboard web thuần HTML/CSS/JavaScript để trình diễn toàn bộ API Parent, Admin và
các endpoint Agent của dự án Laptop Monitor. Không cần cài thêm dependency.

## Chạy local

1. Khởi động backend ở cổng `3000`.
2. Mở terminal trong thư mục này và chạy:

   ```powershell
   node server.js
   ```

3. Truy cập `http://localhost:5173`.

Dev server tự proxy `/api/*` tới `http://localhost:3000`, vì vậy không cần thay đổi
CORS của backend. Nếu backend chạy ở địa chỉ khác:

```powershell
$env:API_TARGET = 'http://localhost:4000'
$env:WEB_PORT = '5173'
node server.js
```

Có thể dùng `npm start` nếu PowerShell cho phép chạy npm script. Chạy smoke test bằng
`node --test test/smoke.test.js`.

## Phạm vi API

- Auth: đăng ký, xác minh, gửi lại xác minh, đăng nhập, refresh, đăng xuất, đổi/quên/
  đặt lại mật khẩu, xóa tài khoản.
- Parent: trẻ em, thiết bị, xoay secret, policy, app/web activity, cảnh báo, AI
  analysis, AI summary và chatbot.
- Thời gian sử dụng: hiển thị riêng tổng hôm nay, tổng tháng, bảy ngày gần nhất và
  từng ngày trong tháng từ endpoint tổng hợp; không suy ra tổng từ 200 log gần nhất
  và không cộng website hai lần với ứng dụng trình duyệt.
- Chính sách phân loại: bật/tắt phân loại AI và cấu hình Cho phép/Chặn cho từng
  nhóm ứng dụng, website của mỗi hồ sơ trẻ.
- Vận hành Agent: trạng thái thiết bị online, lần heartbeat gần nhất, hướng dẫn
  cài Agent 1.0.13 và trạng thái kết nối Backend ngay trên Dashboard.
- Hoạt động: tìm kiếm, lọc theo thiết bị/danh mục/thời gian, phân trang cục bộ,
  mở liên kết website an toàn và xuất CSV UTF-8.
- Admin: thống kê, người dùng, blacklist và audit log.
- Quản trị tài khoản: tìm/lọc người dùng, xem hồ sơ trẻ và thiết bị,
  khóa/mở tài khoản, xác minh email, đổi vai trò, thu hồi phiên và xóa tài khoản.
- API Lab: heartbeat/config, vision alert, app/web log và batch log bằng
  `X-Device-Secret`. Secret chỉ được giữ trong bộ nhớ của tab.

Token đăng nhập được lưu trong `sessionStorage` và tự xóa khi đóng tab.
