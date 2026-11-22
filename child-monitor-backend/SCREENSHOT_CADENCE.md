# Chụp ngay và chu kỳ chụp

- `POST /api/logs/screenshots/request`: yêu cầu một ảnh của thiết bị thuộc phụ huynh, kể cả khi `enable_screenshot_review=false`. Không thay đổi settings. Yêu cầu hết hạn sau 3 phút; gửi lại khi đang chờ trả cùng UUID.
- `PUT /api/settings/:child_id`: `screenshot_interval_minutes` là số nguyên 1–60, mặc định 5. Cập nhật riêng chu kỳ không bật lịch. Agent nhận `screenshot_interval_seconds` tương ứng. Giá trị lưu theo trẻ thay thế mặc định môi trường cho hồ sơ đó.
- Khi định kỳ tắt, upload chỉ được chấp nhận nếu UUID khớp yêu cầu còn hạn và đúng revision. Đổi settings hủy yêu cầu đang chờ. Ảnh cũ không bị xóa.
- Service và Companion phải cùng cập nhật. Cờ `enabled` vẫn chỉ biểu thị lịch định kỳ; yêu cầu một ảnh được cấp quyền riêng với thời hạn, không lưu quyền chụp xuống đĩa.

## Triển khai

Chạy `migration_v34.sql` bằng tài khoản sở hữu bảng `settings` trước khi khởi động backend mới. Migration chỉ thêm cột, không xóa dữ liệu. Sau đó cập nhật Dashboard, Android 0.7.0 và cả Service/Companion trên laptop. Khởi động lại backend/Agent và tải lại Dashboard.

Ví dụ: `psql -U postgres -d child_monitor_db -v ON_ERROR_STOP=1 -f migration_v34.sql`.

Trong phiên sửa này chưa áp dụng migration lên cơ sở dữ liệu thật, chưa triển khai backend/Agent mới và chưa xác nhận ảnh thật từ laptop. Kiểm thử tích hợp bị chặn bởi Redis test không hoạt động và role test không có quyền nâng cấp schema. Các kiểm thử đơn vị sử dụng dữ liệu giả, không chụp desktop thật.
