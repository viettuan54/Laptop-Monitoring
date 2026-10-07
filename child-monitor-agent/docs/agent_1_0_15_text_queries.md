# Agent 1.0.15: bổ sung phần gửi câu tìm kiếm vào bản đóng gói

Ngày 2026-10-07, kiểm tra tình trạng Agent online nhưng bảng
`text_moderation_events` trống cho thấy:

- Backend nhận heartbeat, quyền phân tích văn bản đã bật và migration v24 đã có.
- API trên cổng 8100 chạy đúng v13, mã băm khớp lock; dùng khóa của backend
  gọi API thành công.
- Bộ cài 1.0.14 trong workspace được tạo ngày 2026-08-24. Kiểm tra bytecode
  các executable trong release 1.0.14 cho thấy chưa có `text_privacy`,
  `extract_search_query`, `post_text_moderation` hoặc `_sync_text_moderation`.

Vì vậy mã nguồn hiện tại có chức năng phân tích văn bản không đồng nghĩa
bộ cài 1.0.14 cũ có chức năng đó. Tìm kiếm trên bản Agent cũ có thể chỉ tạo
lịch sử web, không gửi câu sang API AI. Cài lại chính bộ cài cũ không sửa được.

## Bản sửa

Đóng gói lại mã hiện tại thành `ChildMonitorSetup-1.0.15.exe`, tăng phiên bản
trong installer và trạng thái collector. Thêm bước
`build/verify-text-capabilities.py` vào quy trình build: kiểm tra trực tiếp
bytecode executable, bắt buộc có bộ thu, kiểm tra quyền, hàng đợi DPAPI và
hàm gửi văn bản. Bộ cài cũ bị bước kiểm tra này từ chối.

45 test về collector, HTTP client, hàng đợi và bảo vệ dữ liệu đạt. Test dữ
liệu trước thời điểm đồng ý được sửa fixture để nằm rõ ràng trước mốc quyền,
tránh hai thời điểm trùng một nhịp đồng hồ Windows. Không đổi quy tắc quyền.
Build còn chạy self-test Service và Companion với thư viện native thật.

## Nâng cấp trên máy Agent

1. Chép `build/output/ChildMonitorSetup-1.0.15.exe` sang máy Agent.
2. Chạy bằng **Run as administrator**, nhập Backend URL và Device Secret
   của thiết bị hiện tại; giữ Subject ID nếu đang dùng profile cá nhân.
3. Sau khi cài, chờ khoảng một phút để nhận cấu hình. Đảm bảo chức năng
   phân tích văn bản vẫn bật ở tài khoản phụ huynh.
4. Tìm kiếm lại bằng Chrome/Edge/Cốc Cốc trong cửa sổ thông thường, nhấn
   Enter để mở trang kết quả Google/Bing hoặc nguồn tìm kiếm được hỗ trợ.
   Không dùng lịch sử cũ làm phép thử: Agent không lấy lại query trước quyền.
5. Chờ khoảng một phút để hàng đợi đồng bộ, rồi kiểm tra các bản ghi mới
   trong `text_moderation_events` của đúng database backend.

Collector quét mỗi 15 giây, Service đồng bộ mỗi 60 giây khi hoạt động bình
thường. Trạng thái trên máy Agent ở
`%LOCALAPPDATA%\ChildMonitorAgent\web_tracker_status.json` phải ghi
`agent_version: 1.0.15`. Log Service nằm trong `logs/service.log` của thư mục
cài; log Companion ở `%LOCALAPPDATA%\ChildMonitorAgent\logs\companion.log`.
Không chia sẻ Device Secret hoặc toàn bộ file cấu hình khi gửi chẩn đoán.

Model v13 vẫn chạy phía backend, không được nhúng vào bộ cài Agent. Chế độ
shadow/alerts do backend quyết định. Shadow chỉ lưu nhãn; alerts có thể tạo
cảnh báo RISK/HIGH_RISK. Nút bật phân tích của phụ huynh không tự đổi chế độ.

Cập nhật sau đóng gói ngày 2026-10-07: người dùng đã xác nhận Agent phân loại
và gửi cảnh báo thành công. Xem [kiểm tra phục hồi và vận hành AI](../../ai-training/text_safety/V13_OPERATIONS.md).

Ở thời điểm đóng gói, đây là kiểm tra cục bộ; chưa cài hay nghiệm thu Windows service
trên máy Agent của người dùng. Cần thực hiện các bước nâng cấp trên để xác
nhận luồng đang chạy thực tế.
