# Child Monitor Agent

Windows Agent gồm một Service chạy dưới `LocalSystem` và Companion chạy trong
phiên đăng nhập của trẻ. Bản phát hành được đóng thành một bộ cài `.exe`; máy
được giám sát không cần cài Python hay tải package từ Internet.

## Cài bằng ChildMonitorSetup.exe (khuyến nghị)

1. Đăng ký thiết bị trên Parent Dashboard để nhận `device_secret`.
2. Chép `build\output\ChildMonitorSetup-<version>.exe` sang máy Windows 10/11
   64-bit cần giám sát.
3. Chọn **Run as administrator**, nhập Backend URL, Device Secret và Subject ID
   nếu máy đã có profile Edge AI cá nhân.
4. Setup xác minh credential, mã hóa secret bằng DPAPI LocalMachine, cài
   `ChildMonitorService` ở chế độ Automatic và khởi động Agent.

Bộ cài là một file duy nhất, nhưng cài hai executable riêng đúng theo mô hình
bảo mật của Windows:

- `ChildMonitorService.exe` chạy nền dưới `LocalSystem`, đồng bộ dữ liệu và áp
  dụng policy.
- `ChildMonitorCompanion.exe` do watchdog mở trong phiên đăng nhập của trẻ để
  theo dõi ứng dụng/lịch sử Edge, Chrome hoặc Cốc Cốc, hiển thị cảnh báo và chạy
  camera/Edge AI. Companion chuyển bản ghi qua Named Pipe để Service lưu vào
  hàng đợi cục bộ và đồng bộ backend.

Không nên ép hai tiến trình này thành một executable chạy cùng một session.
Service ở Session 0 không thể dùng camera/UI hoặc biến môi trường hồ sơ trình
duyệt của desktop người dùng một cách ổn định.

## Build bộ cài

Máy build cần Windows 64-bit, Python 3.11 64-bit và Inno Setup 6. Mở PowerShell
tại `child-monitor-agent` rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\build\build-agent.ps1 `
  -Version "1.0.5"
```

Script cài dependency build vào môi trường Python được chọn, tạo bundle
PyInstaller dạng one-folder cho Service/Companion, chạy self-test native
MediaPipe/OpenCV, rồi tạo:

```text
build\output\ChildMonitorSetup-1.0.5.exe
```

Để đóng gói model/profile cá nhân vào installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\build\build-agent.ps1 `
  -Version "1.0.5" `
  -EyeDistanceProfilePath ".\models\eye-distance-cua-tre.json" `
  -PostureModelPath "..\ai-training\artifacts\posture_baseline_v1.json" `
  -PostureProfilePath "..\ai-training\datasets\pilot\subject-001.posture-profile.json"
```

Bản build hiện chưa được ký Authenticode. Trước khi phân phối ngoài môi trường
demo, cần ký code bằng chứng thư của đơn vị để giảm cảnh báo Microsoft
SmartScreen và bảo đảm nguồn gốc file.

## Cài từ source (dành cho phát triển)

Trước tiên đăng ký thiết bị qua Backend để nhận `device_secret`. Mở PowerShell
với quyền Administrator tại thư mục `child-monitor-agent`. Agent hỗ trợ Python
3.9-3.12 và khuyến nghị Python 3.11:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -ServerUrl "https://api.tuansosad.id.vn" `
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

Khoảng cách centimet ưu tiên profile v3 đã chốt bằng hồi quy tuyến tính đơn
điệu theo nghịch đảo khoảng cách hai mắt. Profile áp dụng policy ba vùng:
`< 33 cm` là cảnh báo, `33 <= khoảng cách < 37 cm` là chưa chắc chắn và tiếp
tục lấy mẫu, `>= 37 cm` là an toàn. Agent chỉ dùng profile khi SHA-256, camera,
độ phân giải
640×480 và ngưỡng chính 35 cm đều khớp với lúc calibration.

Nếu profile thiếu hoặc không tương thích, Agent fallback về hệ số đơn (nếu đã
cấu hình), sau đó là mô hình pinhole với IPD mặc định 6,3 cm và FOV ngang mặc
định 60°. Không xem kết quả fallback là phép đo có độ chính xác cao. Chuẩn đo,
schema và công cụ tạo profile nằm trong `../ai-training`.

Tư thế luôn có lớp an toàn rule-based. Nếu `posture_baseline_v1.json` đã được
huấn luyện từ ít nhất ba subject và đạt đánh giá leave-one-subject-out, Agent
chạy thêm classifier theo cửa sổ ba giây. Model chỉ được bổ sung cảnh báo, không
được phép ghi đè một cảnh báo do luật hình học phát hiện. Model chưa đủ cửa sổ,
confidence thấp, sai nhịp lấy mẫu hoặc không tương thích đều fallback về luật.

`posture_profile_v1.json` là profile cá nhân theo subject-camera. Profile dịch
tư thế trung tính cá nhân về baseline tốt của model trước inference; nếu camera
hoặc độ phân giải không khớp thì Agent bỏ profile cá nhân nhưng vẫn giữ model và
rule-based.

Khi cài model/profile đã tạo từ `ai-training`, truyền rõ đường dẫn:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\install.ps1 `
  -ServerUrl "https://api.tuansosad.id.vn" `
  -DeviceSecret "00000000-0000-0000-0000-000000000000" `
  -SubjectId "subject-001" `
  -EyeDistanceProfilePath ".\models\eye-distance-cua-tre.json" `
  -PostureModelPath "..\ai-training\artifacts\posture_baseline_v1.json" `
  -PostureProfilePath "..\ai-training\datasets\pilot\subject-001.posture-profile.json"
```

Nếu không truyền `-EyeDistanceProfilePath`, installer dùng profile demo đóng gói
và runtime chỉ kích hoạt nó khi đúng camera/độ phân giải đã hiệu chỉnh.

## Xoay Device Secret hoặc đổi Backend

```powershell
powershell -ExecutionPolicy Bypass -File `
  "C:\Program Files\ChildMonitorAgent\installer\provision.ps1" `
  -ServerUrl "https://api.tuansosad.id.vn" `
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
