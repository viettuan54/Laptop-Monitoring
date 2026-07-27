# Child Monitor Agent

Windows Agent gồm một Service chạy dưới `LocalSystem` và Companion chạy trong
phiên đăng nhập của trẻ. Yêu cầu Windows 10/11, Python 3 và quyền Administrator.

## Cài đặt

Trước tiên đăng ký thiết bị qua Backend để nhận `device_secret`. Mở PowerShell
với quyền Administrator tại thư mục `child-monitor-agent`. Agent hỗ trợ Python
3.9-3.12 và khuyến nghị Python 3.11:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -ServerUrl "https://api.example.com" `
  -DeviceSecret "00000000-0000-0000-0000-000000000000" `
  -PythonExe "C:\Path\To\Python311\python.exe"
```

Installer sẽ:

1. Sao chép mã Agent vào `C:\Program Files\ChildMonitorAgent`.
2. Tạo virtual environment và cài dependencies.
3. Xác minh Device Secret bằng heartbeat với Backend.
4. Mã hóa secret bằng Windows DPAPI LocalMachine.
5. Giới hạn ACL file cấu hình cho SYSTEM và Administrators.
6. Cài `ChildMonitorService` ở chế độ Automatic và khởi động Service.
7. Watchdog của Service tự chạy Companion trong phiên đăng nhập hiện hành.

Máy cài đặt offline có thể truyền `-Wheelhouse <đường-dẫn>` chứa các wheel đã
tải trước.

## Edge AI: khoảng cách mắt và tư thế

Khi phụ huynh bật `enable_webcam_monitoring`, Companion trong phiên đăng nhập
người dùng sẽ mở webcam và chạy MediaPipe Face/Pose Landmarker bằng OpenCV.
Pipeline mặc định lấy mẫu 2 lần/giây và chỉ cảnh báo khi tín hiệu xấu kéo dài
ít nhất 5 giây:

- Khoảng cách mắt ước tính dưới 35 cm.
- Góc cổ trên 25°, góc thân trên 18° hoặc độ nghiêng vai trên 12°.

Frame chỉ tồn tại trong RAM của Companion. Ảnh, landmark và embedding không
được ghi xuống đĩa hay gửi qua Named Pipe/backend; chỉ loại cảnh báo và thông
điệp số được lưu vào SQLite offline queue. Backend tiếp tục chống trùng cảnh
báo trong 5 phút.

Agent cố định MediaPipe `0.10.33`. Runtime này đã được kiểm tra không chứa
Clearcut uploader của bản 0.10.35; không tự nâng phiên bản nếu chưa đánh giá lại
privacy notice và lưu lượng mạng của SDK.

Khoảng cách centimet là giá trị ước tính từ mô hình pinhole, IPD mặc định
6,3 cm và FOV ngang mặc định 60°. Giai đoạn đầu dùng các ngưỡng an toàn mặc
định trong Agent; bước hiệu chỉnh FOV/IPD theo từng camera cần được thực hiện
trước khi xem kết quả centimet là phép đo có độ chính xác cao.

## Xoay Device Secret hoặc đổi Backend

```powershell
powershell -ExecutionPolicy Bypass -File `
  "C:\Program Files\ChildMonitorAgent\installer\provision.ps1" `
  -ServerUrl "https://api.example.com" `
  -DeviceSecret "11111111-1111-1111-1111-111111111111"
```

Provisioning luôn xác minh credential trước khi thay thế file hiện tại. Chỉ dùng
`-SkipValidation` cho phục hồi offline có chủ đích.

## Gỡ cài đặt

Mặc định chỉ gỡ Service và giữ queue/config để có thể phục hồi:

```powershell
powershell -ExecutionPolicy Bypass -File `
  "C:\Program Files\ChildMonitorAgent\installer\uninstall.ps1"
```

Xóa vĩnh viễn cả cấu hình, logs và SQLite queue:

```powershell
powershell -ExecutionPolicy Bypass -File `
  "C:\Program Files\ChildMonitorAgent\installer\uninstall.ps1" -PurgeData
```
