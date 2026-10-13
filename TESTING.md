# Integration tests

## Backend

Các test backend sử dụng PostgreSQL thật và cố ý không fallback sang cấu hình DB thông thường.
Tạo một database test riêng, chạy `Data.sql` cùng các migration mới nhất, sau đó sao chép
`child-monitor-backend/test.env.example` thành `child-monitor-backend/.env.test`.
Test sẽ tự nạp `.env.test` trước `.env`.

`TEST_DB_ADMIN_USER` phải có `BYPASSRLS` và quyền quản trị trên toàn bộ bảng/sequence
trong schema test để mô phỏng `adminPool`.
`TEST_DB_BACKEND_USER` phải là `NOSUPERUSER NOBYPASSRLS`.
`TEST_REDIS_URL` phải trỏ đến một Redis test thật; integration suite sẽ kết nối và
không chấp nhận fallback sang MemoryStore.

Redis hoặc Memurai test nên chỉ bind loopback trên một cổng riêng, ví dụ `6380`.
Xác minh trước khi chạy suite bằng `redis-cli -h 127.0.0.1 -p 6380 ping`; kết quả
phải là `PONG`.

Chạy từ thư mục `child-monitor-backend`:

```powershell
npm test
```

Suite kiểm tra:

- đăng nhập và refresh-token rotation đồng thời;
- cô lập dữ liệu giữa hai phụ huynh bằng RLS thật;
- khởi tạo 9 chính sách phân loại mặc định cho mỗi trẻ và cô lập chúng bằng RLS;
- retry batch idempotent và acknowledgement theo `client_record_id`;
- kết nối Redis thật cho distributed rate limit.
- kết quả chặn ứng dụng: xác thực thiết bị, retry không trùng và RLS giữa hai phụ huynh
  (cần chạy migration v28 bằng `node scripts/migrate-app-enforcement.js --test`).
- hạn mức 0: API phụ huynh giữ nguyên 0, config/heartbeat gửi 1440 kèm
  `daily_limit_unlimited: true` để tương thích Agent cũ; hạn mức dương và các
  điều khiển khóa thủ công/khung giờ được giữ nguyên.

Mỗi lần chạy tạo dữ liệu có prefix ngẫu nhiên và xóa bằng cascade sau khi hoàn tất.

## Agent

Nhắc nghỉ giải lao (Agent 1.0.22) dùng migration v29:
`node scripts/migrate-break-reminders.js --test`. Tài khoản migration phải sở
hữu bảng `settings`; đặt `TEST_DB_MIGRATION_USER/PASSWORD` khi role test không
có quyền này. Test kiểm tra cấu hình qua heartbeat, retry và RLS lịch sử.

Agent test thêm bộ đếm khi idle/khóa/ngủ, restart, đổi cấu hình/phiên, snooze,
hủy cửa sổ và ACK từng UUID. Dashboard chạy `npm test`, gồm render lịch sử,
lỗi API và phản hồi đến muộn khi đổi trẻ.

Agent test sử dụng SQLite trong thư mục tạm và không thay đổi ACL hoặc database thật:

```powershell
cd child-monitor-agent
.\run_tests.ps1
```

Suite xác nhận queue chỉ đánh dấu `synced` cho ID được backend xác nhận và giữ nguyên
dữ liệu khi acknowledgement bị thiếu.

Kiểm thử chính sách thời gian còn xác nhận 0 nghĩa là không giới hạn hạn mức
ngày, không hiển thị đếm ngược hạn mức khi không giới hạn, vẫn khóa ngoài giờ
hoặc theo lệnh phụ huynh, giữ chính sách khi chạy offline và xóa cờ không giới
hạn cũ khi nhận một hạn mức hữu hạn từ backend phiên bản trước.
