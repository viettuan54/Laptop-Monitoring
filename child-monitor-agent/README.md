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

## Cách tính thời gian sử dụng

Agent chỉ cộng thời gian của ứng dụng foreground khi phiên Windows đang hoạt động.
Thời gian khóa màn hình, đăng xuất, ngắt kết nối, sleep/hibernate và các tiến trình
`LockApp.exe`/`LogonUI.exe` không được tính. Mỗi segment ngắn được ghi cùng thời điểm
bắt đầu/kết thúc có UTC offset; segment đi qua 00:00 được chia vào đúng hai ngày.
Giới hạn hằng ngày luôn đọc riêng ngày local hiện tại, còn tổng tháng chỉ dùng cho
báo cáo Dashboard và không tham gia quyết định khóa màn hình.

Khi nâng cấp từ bản Agent cũ, Service tự rebuild bộ đếm của hôm nay và hôm qua từ
các segment hợp lệ. Các segment xuyên thời gian khóa/ngủ bị loại khỏi bộ đếm và
không được đồng bộ lại, nhờ vậy số liệu đã phình trong ngày được sửa ngay sau khi
Service khởi động lại.

## Build bộ cài

Máy build cần Windows 64-bit, Python 3.11 64-bit và Inno Setup 6. Mở PowerShell
tại `child-monitor-agent` rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\build\build-agent.ps1 `
  -Version "1.0.14"
```

Script cài dependency build vào môi trường Python được chọn, tạo bundle
PyInstaller dạng one-folder cho Service/Companion, chạy self-test native
MediaPipe/OpenCV, rồi tạo:

```text
build\output\ChildMonitorSetup-1.0.14.exe
```

Để đóng gói model/profile cá nhân vào installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\build\build-agent.ps1 `
  -Version "1.0.14" `
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

## Phân loại nội dung ứng dụng và website

Installer đóng gói `web_content_model_v1.json`, `app_content_model_v1.json`,
`app_exact_lookup_v1.json` và `web_exact_lookup_v1.json` cùng checksum SHA-256. Self-test của Service sẽ dừng
nếu asset bị thiếu, sai checksum hoặc model chưa đạt deployment gate.

Khi `enable_web_classification=true`, Service ưu tiên domain đã duyệt trong
`web_exact_lookup_v1.json` với nguồn `exact_lookup` và confidence `1.0`, sau đó
đưa domain chưa biết vào model website cục bộ. Kết quả có confidence từ `0.70` được lưu với nguồn
`trained_model`; kết quả thấp hơn ngưỡng mới gửi duy nhất domain tới Gemini và
lưu nguồn `gemini`. Khi công tắc tắt, Agent không gọi model/Gemini và lưu trạng
thái `disabled`, vì vậy quyền truy cập web vẫn hoạt động bình thường.

Khi `enable_app_classification=true`, Companion đọc tên process cùng
`ProductName`/`FileDescription` từ version resource của executable; không gửi
đường dẫn file, window title, tên tài liệu hay URL. Service phân loại theo thứ tự:

1. `app_exact_lookup_v1.json` đã duyệt thủ công (`exact_lookup`, confidence `1.0`).
2. Ensemble app-name + executable metadata đã qua deployment gate
   (`trained_model`, confidence từ `0.70`).
3. Gemini fallback nền khi thiếu metadata hoặc model chưa đủ confidence.

Nhãn ứng dụng, nguồn và confidence được lưu trong SQLite trước khi ACK Named Pipe,
sau đó đồng bộ idempotent lên Backend. Gemini không giữ luồng foreground tracking.

Website bị chặn qua `hosts` được chuyển tới loopback riêng `127.0.0.2`. Service
lắng nghe cục bộ trên cổng 80/443 để ghi nhận lượt truy cập thật qua HTTP Host
hoặc TLS SNI, sau đó vẫn từ chối kết nối. Agent không giải mã HTTPS, không cài
chứng chỉ và không đọc nội dung trang. Các kết nối phụ cùng domain trong 15 giây
được gộp thành một bản ghi `Truy cập bị Agent chặn` trên lịch sử hoạt động.

Mỗi 10 phút Agent lấy tối đa 25 app và 25 domain `unknown` cũ ở queue cục bộ và
backend để phân loại lại. Backfill chỉ cập nhật bản ghi còn `pending/disabled`, không ghi đè
nhãn đã có. Riêng domain mới có confidence cục bộ thấp được đưa ngay vào worker
nền để gọi Gemini mà không giữ luồng Named Pipe; vì vậy quyết định chặn không phải
đợi vòng backfill định kỳ.

Heartbeat đồng bộ thêm `blocked_web_categories` theo đúng hồ sơ trẻ. Sau khi một
domain có nhãn cuối cùng, Service lưu ánh xạ vào
`config/web_classification_cache.json`; nếu nhãn thuộc nhóm đang chọn **Chặn**,
domain được hợp nhất với blacklist toàn cục và ghi vào khối do Agent quản lý trong
Windows `hosts`. Backend cũng gửi `policy_blocked_domains` để áp dụng được cả dữ
liệu đã phân loại trước lúc nâng cấp/cài lại Agent. Đổi policy sang **Cho phép**
sẽ gỡ domain tương ứng ở heartbeat kế tiếp (tối đa khoảng 60 giây), còn cache giúp
policy tiếp tục có hiệu lực sau reboot hoặc khi Backend tạm thời mất kết nối.

## Phân tích an toàn văn bản

Khi phụ huynh bật `enable_text_moderation`, Companion nhận diện truy vấn từ URL
kết quả tìm kiếm của Google, Bing, Yahoo, DuckDuckGo, Cốc Cốc, YouTube và Brave.
Bộ phân tích văn bản không dùng page title/window title, không đọc nội dung trang
và không giải mã HTTPS.

Truy vấn được chuyển qua Named Pipe tới Service, ghi tạm trong SQLite đã giới hạn
ACL cho SYSTEM/Administrators, rồi gửi theo lô tối đa 20 bản ghi tới
`POST /api/agent/text-moderation/batch`. Bản ghi dùng UUID ổn định để retry không
tạo kết quả trùng. Khi Backend xác nhận — kể cả khi tính năng vừa bị tắt — Service
xóa ngay văn bản gốc khỏi hàng đợi; bản ghi chưa gửi quá 7 ngày cũng tự bị xóa.

Khóa OpenAI chỉ đặt tại Backend, không nằm trong Agent hay bộ cài. Phiên bản này
mới thu thập nguồn `search_query`; schema Backend đã dành sẵn `page_content`,
`chat_received` và `chat_authored` cho các bộ thu thập được người dùng cấp quyền
trong giai đoạn sau.

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
