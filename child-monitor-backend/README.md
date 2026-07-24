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

---

## Cấu hình production

Chạy lần lượt toàn bộ migration đến `migration_v11.sql`.

Production bắt buộc cấu hình:

```env
NODE_ENV=production
REDIS_URL=rediss://user:password@redis-host:6379
```

Backend fail-fast và không mở HTTP port nếu Redis production không sẵn sàng. Admin có thể truy vấn audit log qua `GET /api/admin/audit-logs`, hỗ trợ `limit`, `offset`, `action` và `actor_user_id`.
