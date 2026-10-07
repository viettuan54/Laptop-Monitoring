# Vận hành dịch vụ phân loại văn bản v13

Cập nhật 2026-10-07. Người dùng đã xác nhận Agent phân loại và gửi cảnh báo thành công. Đợt này hoàn thiện cách chạy dịch vụ AI và kiểm tra phục hồi; không huấn luyện lại hoặc đổi quy tắc cảnh báo.

**Trạng thái trên máy backend của workspace:** tác vụ được cài lúc 16:40 ngày 2026-10-07 (Asia/Saigon), có trigger khởi động cùng Windows. Dịch vụ đang chạy, kiểm tra xác thực trên cổng 8100 trả đúng version và SHA v13.

**Đã áp dụng và nghiệm thu bản sửa ngày 2026-10-07:** sau khi người dùng chạy lại lệnh cài, tác vụ có cả trigger khởi động Windows và lịch mỗi phút, MultipleInstances=IgnoreNew. Phép thử lúc 17:09 (Asia/Saigon) dừng riêng tác vụ đã xác minh; Windows tự mở lại sau **57,78 giây**, PID thay đổi và API xác thực vẫn trả đúng model/SHA v13. Không gọi Start-ScheduledTask thủ công trong lần phục hồi đạt này. [Báo cáo nghiệm thu](../../.runtime/text-safety/periodic-recovery-verification.json). Đây là phép thử dừng tác vụ; chưa thử lại crash tiến trình đột ngột trên bản sửa và chưa khởi động lại Windows.

## Khởi động cùng Windows

Chạy trên **máy backend có thư mục dự án**, bằng PowerShell **Run as administrator**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\DoAn\Laptopmonitoring\ai-training\text_safety\install-startup.ps1" -ReplaceManualInstance
```

Script kiểm tra model trước, sau đó đăng ký tác vụ `ChildMonitor-TextSafety-v13` và chạy ngay. Tác vụ chạy khi Windows khởi động, không cần cửa sổ terminal; chạy bằng tài khoản đăng ký với quyền thường, S4U, không lưu mật khẩu. Có thêm lịch kích hoạt mỗi phút; nếu tác vụ vẫn Running, IgnoreNew bỏ qua lần kích hoạt để không chạy trùng. Cơ chế này phục hồi cả trường hợp tiến trình dừng mà Windows không xếp vào lỗi. Cấu hình RestartOnFailure sau một phút vẫn được giữ. Đây là tác vụ cho AI; backend, PostgreSQL và đường kết nối Agent vẫn cần chạy riêng.

Nếu cổng 8100 đã có dịch vụ, script chỉ chuyển giao khi xác minh đúng model, khóa API và tiến trình Python text-safety. Dịch vụ không xác minh được sẽ được giữ nguyên. Tham số `-PrepareOnly` chỉ tạo cấu hình và tiền kiểm, không đăng ký hay dừng tiến trình.

Cấu hình được lưu tại `.runtime/text-safety/runtime.json`, chỉ chứa đường dẫn và mã băm. API key được đọc trực tiếp từ `child-monitor-backend/.env`, không ghi vào tác vụ hay câu lệnh. Khi đổi khóa API, khởi động lại cả backend và dịch vụ AI.

Model được khóa ở [query_v13_candidate.lock.json](../school_violence/query_v13_candidate.lock.json):

- Version: `vi-school-violence-recipient-context-v13-query-candidate`.
- SHA-256: `380cf3af9bb677446548af64601f5e98be3f0a07092f2458f3500986fcc0497a`.
- Bộ khởi động từ chối model hoặc lock bị đổi; không tự quay về v5.
- Hai biến `LOCAL_MODERATION_EXPECTED_MODEL` và `LOCAL_MODERATION_EXPECTED_SHA256` trong backend cũng khóa đúng bản này. Backend đang chạy cần được khởi động lại để đọc thay đổi trong `.env`.
- Lấy môi trường từ `NODE_ENV` của backend. V13 vẫn là ứng viên chưa duyệt production; bộ khởi động giữ nguyên kiểm tra từ chối chạy production.

## Kiểm tra và điều khiển

Kiểm tra trạng thái tác vụ trong PowerShell quản trị:

```powershell
Get-ScheduledTask -TaskName 'ChildMonitor-TextSafety-v13' | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName 'ChildMonitor-TextSafety-v13'
```

Kiểm tra dịch vụ đang chạy bằng đúng khóa và mã băm, từ thư mục dự án:

```powershell
Set-Location 'C:\DoAn\Laptopmonitoring\ai-training'
.\.venv\Scripts\python.exe -B -m text_safety.run_pinned --config '..\.runtime\text-safety\runtime.json' --probe
```

Kết quả cần có `status: ok`, version và SHA như trên. Dùng `--check` thay `--probe` để kiểm tra cấu hình và khả năng nạp model khi dịch vụ chưa chạy.

Dừng/bật lại có chủ đích: phải Disable trước khi Stop, nếu không lịch mỗi phút sẽ mở lại dịch vụ.

```powershell
Disable-ScheduledTask -TaskName 'ChildMonitor-TextSafety-v13'
Stop-ScheduledTask -TaskName 'ChildMonitor-TextSafety-v13'
# Khi cần chạy lại:
Enable-ScheduledTask -TaskName 'ChildMonitor-TextSafety-v13'
Start-ScheduledTask -TaskName 'ChildMonitor-TextSafety-v13'
```

Disable cũng ngừng lịch khởi động cùng Windows. Khi cài lại bằng script, tác vụ được bật lại. Việc dừng có chủ đích không phải phép thử tự phục hồi sau sự cố.

Log dịch vụ nằm tại `.runtime/text-safety/logs/service.log`, xoay vòng 2 MiB, giữ tối đa ba bản cũ. Access log HTTP bị tắt; không ghi câu tìm kiếm hay API key. Nếu cấu hình sai trước lúc mở HTTP, chạy `--check` để nhận lỗi đã lược bỏ nội dung nhạy cảm.

## Phép thử vận hành

Đã kiểm tra trên cổng và database thử tách biệt, dùng model v13 thật. Push ra ngoài được thay bằng bộ ghi nhận trong kiểm thử; không gửi cảnh báo thử tới phụ huynh thật.

- 206 unit test AI đạt, gồm bảy ca dành cho bộ khởi động mới.
- Sáu phép thử tiến trình thật đạt: nạp đúng bản, xác thực khóa, từ chối mở trùng cổng, dừng, mở lại giữ dự đoán, từ chối mã băm sai. Báo cáo tại [runtime-verification.json](../../.runtime/text-safety/runtime-verification.json).
- Luồng alerts: 16 kiểm tra đạt; bảy sự kiện thử, hai cảnh báo, hai lần gọi bộ ghi nhận push. [Báo cáo alerts](../artifacts/school_violence/v13_stability_alerts_20261007_run3/verification_report.json).
- Luồng shadow: 19 kiểm tra đạt; bảy sự kiện, không tạo cảnh báo hay gọi push. [Báo cáo shadow](../artifacts/school_violence/v13_stability_shadow_20261007_run2/verification_report.json).

Phạm vi gồm mất kết nối AI/backend, mở lại bộ lắng nghe HTTP của backend, gửi lại cùng ID, chống lặp theo từng loại cảnh báo, tắt quyền trên backend/Agent, bật lại và xử lý câu SAFE mới. Các kiểm tra này xác nhận vận hành, không phải phép đo độ chính xác độc lập.

**Giới hạn hàng đợi hiện tại:** mất mạng giữ câu đã mã hóa để gửi lại khi quyền phân tích còn hiệu lực. Khi Agent service khởi động lại, hàng đợi văn bản cũ bị xóa vì chưa xác nhận lại quyền; phép thử đã xác nhận đúng hành vi này. Không cam kết giữ toàn bộ câu chưa gửi qua lần khởi động lại Agent. Không đổi hành vi hay đóng gói lại Agent trong đợt này.

## Các kiểm tra còn cần trên máy thật

Sáu phép thử tiến trình AI riêng biệt và phép thử phục hồi bằng lịch mỗi phút đã đạt. [Báo cáo cấu hình ban đầu thất bại](../../.runtime/text-safety/scheduled-task-verification-initial-failure.json) được giữ làm lịch sử; kết quả bản sửa nằm trong báo cáo nghiệm thu mới ở trên. Chưa khởi động lại Windows hay điều khiển máy Agent từ xa trong đợt này. Các bước còn lại:

1. Khởi động lại máy backend khi thuận tiện, xác minh tác vụ Running và `--probe` trả đúng v13. Đảm bảo backend/PostgreSQL cũng đang chạy.
2. Trên máy Agent, tắt mạng rồi bật lại trong khi quyền phân tích còn hiệu lực; kiểm tra câu đang chờ được gửi lại một lần. Lease quyền hết hạn thì Agent xóa hàng đợi theo thiết kế.
3. Tắt phân tích trên trang quản lý, đợi Agent nhận cấu hình; câu mới không sinh sự kiện/cảnh báo. Bật lại, thử câu mới rồi xác nhận luồng phục hồi.
4. Kiểm tra SAFE không báo, RISK nhắc quan sát, HIGH_RISK báo có dấu hiệu bị bạo lực. Chống lặp áp dụng theo thiết bị và từng loại cảnh báo trong năm phút.

Giữ bản Agent 1.0.15 đang dùng. Chỉ đổi model sau một đợt đánh giá chất lượng riêng; không dùng kết quả các phép thử vận hành này để tăng số liệu accuracy.

## Tham khảo cấu hình Windows

Thiết kế dùng [nhiều trigger của Task Scheduler](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger) và [MultipleInstances IgnoreNew](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset). Kết quả vận hành ở trên lấy từ phép thử trên máy này; không suy ra đã phục hồi chỉ từ việc khai báo cấu hình.
