# Child Monitor Backend

Hệ thống giám sát laptop trẻ em (Backend API).

## 🚀 Tính năng nổi bật
* **Bảo mật phân tầng**: Phân tách luồng API Agent (X-Device-Secret đã băm SHA-256) và luồng Phụ huynh (JWT).
* **Bảo mật dữ liệu RLS**: Sử dụng Row Level Security (RLS) ở mức PostgreSQL để ngăn rò rỉ chéo thông tin giữa các phụ huynh.
* **Batch Offline Sync**: Hỗ trợ Agent gửi dữ liệu offline dạng lô bằng PostgreSQL `unnest()` và cơ chế idempotent tránh trùng lặp log khi retry.
* **AI Analysis**: Tự động phân tích xu hướng hành vi 24h và hỗ trợ Chat Advisor bằng Gemini AI (chống Prompt Injection bằng XML tags và code validation).
* **Quyền được lãng quên**: Hỗ trợ endpoint xóa hoàn toàn tài khoản và cascade sạch dữ liệu liên quan.
* **Distributed Rate Limit**: Production dùng Redis store dùng chung giữa nhiều process/server; development và test có thể dùng MemoryStore.
* **Audit Log**: Ghi transactionally các hành động nhạy cảm như blacklist, xóa thiết bị, rotate secret, đổi policy và thay đổi tài khoản.
* **Push Notification thật**: Gửi cảnh báo qua Expo Push Service hoặc Firebase Cloud Messaging, tự vô hiệu hóa token đã hủy đăng ký và kiểm tra Expo push receipt.

---

## Cấu hình production

Chạy lần lượt toàn bộ migration đến `migration_v14.sql`. Với database hiện có, tối thiểu phải chạy:

```powershell
psql -U postgres -d child_monitor_db -v ON_ERROR_STOP=1 -f migration_v12.sql
psql -U postgres -d child_monitor_db -v ON_ERROR_STOP=1 -f migration_v13.sql
psql -U postgres -d child_monitor_db -v ON_ERROR_STOP=1 -f migration_v14.sql
```

`migration_v12.sql` khắc phục lỗi đăng nhập `column "is_active" does not exist`; `migration_v13.sql` tạo bảng push; `migration_v14.sql` tạo challenge xác thực khuôn mặt một lần cho admin.
Hãy dùng role sở hữu schema (thường là `postgres`), vì role chỉ được `GRANT` quyền đọc/ghi không thể chạy `ALTER TABLE`.

Production bắt buộc cấu hình:

```env
NODE_ENV=production
REDIS_URL=rediss://user:password@redis-host:6379
```

Backend fail-fast và không mở HTTP port nếu Redis production không sẵn sàng. Admin có thể truy vấn audit log qua `GET /api/admin/audit-logs`, hỗ trợ `limit`, `offset`, `action` và `actor_user_id`.

## FCM / Expo Push Notification

Các API dành cho phụ huynh:

- `GET /api/notifications/tokens`: liệt kê thiết bị nhận thông báo (token luôn được che).
- `POST /api/notifications/tokens`: đăng ký hoặc kích hoạt lại token.
- `DELETE /api/notifications/tokens/:id`: gỡ thiết bị nhận thông báo.
- `POST /api/notifications/test`: gửi thông báo thử nghiệm, tối đa 5 lần/15 phút/tài khoản.

Body đăng ký Expo:

```json
{
  "provider": "expo",
  "platform": "android",
  "token": "ExponentPushToken[...]",
  "device_name": "Điện thoại của mẹ"
}
```

Body đăng ký FCM dùng cùng cấu trúc với `"provider": "fcm"`. Backend không ghi token vào log và không trả token đầy đủ về dashboard.

Để bật gửi thật:

```env
PUSH_NOTIFICATIONS_ENABLED=true
PUSH_PROVIDERS=expo,fcm
FIREBASE_PROJECT_ID=your-firebase-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\secure\firebase-service-account.json
EXPO_ACCESS_TOKEN=
```

`EXPO_ACCESS_TOKEN` chỉ cần khi dự án EAS bật Enhanced Push Security. Với FCM, có thể dùng `FIREBASE_SERVICE_ACCOUNT_JSON` thay cho `GOOGLE_APPLICATION_CREDENTIALS`; giá trị chấp nhận JSON một dòng hoặc base64.

Ứng dụng Expo cần lấy token bằng `Notifications.getExpoPushTokenAsync({ projectId })` rồi gửi token đó đến `POST /api/notifications/tokens`. Xem hướng dẫn chính thức: https://docs.expo.dev/push-notifications/push-notifications-setup/

## Xác thực khuôn mặt cho quản trị viên

Tài khoản `parent` đăng nhập bằng mật khẩu như bình thường. Với tài khoản có role `admin`, `POST /api/auth/login` chỉ trả challenge ngắn hạn sau khi mật khẩu đúng; chưa phát hành JWT hay refresh token. Dashboard chụp 3 khung hình từ camera và gửi đến `POST /api/auth/admin-face`.

Backend chỉ phát hành phiên khi:

1. Challenge còn hạn, đúng IP/User-Agent, chưa dùng và chưa vượt quá 3 lần thử.
2. Model FaceNet + SVM trong thư mục `AI/face_models_facenet` trả nhãn `admin`.
3. Nhãn `admin` vẫn trùng role `admin` trong PostgreSQL tại thời điểm cấp token.

Cài Python 3.11 và môi trường AI:

```powershell
cd child-monitor-backend
py -3.11 -m venv .venv-face
.\.venv-face\Scripts\python.exe -m pip install --upgrade pip
.\.venv-face\Scripts\python.exe -m pip install -r AI\requirements.txt
```

Cấu hình:

```env
FACE_AUTH_REQUIRED_FOR_ADMIN=true
FACE_PYTHON_BIN=C:\DoAn\Laptopmonitoring\child-monitor-backend\.venv-face\Scripts\python.exe
FACE_AUTH_TIMEOUT_MS=120000
FACE_CLASSIFICATION_THRESHOLD=0.75
FACE_DETECTION_THRESHOLD=0.90
```

Ảnh chỉ được ghi vào thư mục tạm với tên ngẫu nhiên trong lúc suy luận và bị xóa trong khối `finally`; database chỉ lưu challenge đã băm, không lưu ảnh hoặc embedding mới.

Ba khung hình khác nhau giúp loại bỏ việc gửi lặp đúng một file, nhưng chưa phải cơ chế chống giả mạo/liveness chuyên dụng. Khi triển khai production, cần bổ sung anti-spoofing và kiểm thử ngưỡng bằng dữ liệu camera thực tế của quản trị viên.
