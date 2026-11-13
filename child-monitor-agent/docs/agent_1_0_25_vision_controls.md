# Agent 1.0.25 — bật riêng tư thế và khoảng cách mắt

## Kết quả kiểm tra bản 1.0.24

Đã đọc bytecode trong hai executable tại
`build/release/ChildMonitorAgent-1.0.24` bằng PyInstaller CArchiveReader:

- Service, module `pipe_server`: có `enable_webcam_monitoring`, chưa có
  `enable_posture_monitoring` và `enable_eye_distance_monitoring`.
- Companion, module `edge_vision`: chưa có `posture_enabled` và
  `eye_distance_enabled`.

Bản đóng gói 1.0.24 ở workspace chưa hỗ trợ điều khiển riêng. Mã nguồn đã sửa
sau khi build bản 1.0.24 không làm thay đổi executable đã phát hành.

## Hành vi bản 1.0.25

| Tư thế | Khoảng cách mắt | Agent thực hiện |
|---|---|---|
| Tắt | Tắt | Không chạy camera |
| Bật | Tắt | Phân tích và cảnh báo tư thế |
| Tắt | Bật | Ước lượng và cảnh báo khoảng cách mắt |
| Bật | Bật | Chạy cả hai chức năng |

Service chuyển hai cờ từ cấu hình backend tới Companion qua Named Pipe.
Companion bỏ qua phân tích của chức năng đã tắt; xóa các quan sát đang chờ khi
đổi lựa chọn để không dùng lại tín hiệu cũ. Đổi lựa chọn có thể mở lại camera.
Vẫn giữ nguyên ngưỡng và thời gian cảnh báo của các chức năng.

Nếu cấu hình chưa có cờ riêng, Agent đọc cờ chung `enable_webcam_monitoring`
để tương thích hệ thống cũ. Giá trị `false` của cờ riêng luôn được ưu tiên.

## Cài đặt và xác nhận

1. Backend cần migration V30 và API hỗ trợ hai cờ riêng.
2. Cập nhật web/Android có hai công tắc độc lập.
3. Cài `build/output/ChildMonitorSetup-1.0.25.exe` trên laptop của con.
4. Chờ đồng bộ, kiểm tra bốn tổ hợp trong bảng bằng webcam thật. Khi tắt cả hai,
   xác nhận đèn webcam tắt; khi bật riêng, xác nhận chỉ có cảnh báo tương ứng.

Build không tự cài hoặc thay đổi Windows Service đang chạy. Kiểm thử trên máy
build không thay cho nghiệm thu webcam, đồng bộ backend và thông báo trên máy con.

## Kiểm tra bộ cài

Lần build ngày 12/11/2026: 202 unit test đạt; 6 module trong executable đóng gói
khớp mã nguồn, kiểm tra cờ độc lập và phiên bản đóng gói đạt.

**Chưa xác nhận self-test executable:** Windows Application Control chặn chạy
file mới, kể cả khi thử ngoài sandbox. Không tắt hoặc thay đổi chính sách bảo vệ.
Script build tiêu chuẩn dừng tại bước này; bộ cài được biên dịch riêng từ bundle
đã tạo để bàn giao kiểm thử, chưa được coi là bản đã nghiệm thu chạy thực tế.
Cần chạy lại self-test trên môi trường được phép trước khi triển khai sử dụng.

Installer có file `.exe.sha256` để đối chiếu tính toàn vẹn.
Trạng thái kiểm tra mã nguồn đóng gói và bộ cài được lưu trong
`ChildMonitorSetup-1.0.25.verification.json` ở thư mục output sau khi xác minh.
