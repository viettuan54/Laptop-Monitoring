# Agent 1.0.29 — cập nhật danh sách chặn Admin khi đang chạy

Trước đây `/api/agent/heartbeat` chỉ gửi chính sách theo trẻ. Danh sách chặn
toàn cục chỉ được lấy khi khởi động hoặc qua vòng cập nhật 600 giây.

Backend mới gửi `blacklisted_domains` trong mỗi heartbeat. Agent 1.0.29 áp dụng
snapshot này qua cơ chế lưu cache và cập nhật hosts/chính sách tiện ích hiện có.
Danh sách rỗng gỡ toàn bộ mục chặn toàn cục; quy tắc theo danh mục vẫn được giữ.
Backend cũ không gửi trường này hoặc lỗi mạng không làm xóa danh sách đã lưu.

## Cập nhật và kiểm tra

**Trạng thái đóng gói:** mã nguồn và Service đã được build, Service self-test đạt.
Windows Application Control chặn chạy Companion self-test trên máy build, nên
chưa tạo bộ cài 1.0.29 hoàn chỉnh. Các bước cài dưới đây áp dụng sau khi build
thành công trên máy được phép chạy các executable này; không dùng bộ cài cũ
để kiểm tra bản sửa mới.

1. Triển khai Backend mới và khởi động lại tiến trình Backend một lần.
2. Cài `build/output/ChildMonitorSetup-1.0.29.exe` bằng quyền quản trị trên máy Agent.
   Bộ cài cập nhật dịch vụ; không cần restart thủ công mỗi lần sửa danh sách.
3. Giữ Agent và trình duyệt chạy, thêm một tên miền tại Admin → Danh sách chặn.
   Với mạng bình thường, Agent nhận ở heartbeat kế tiếp (chu kỳ 5 giây, cộng
   thời gian request). Tiện ích trình duyệt nhận tiếp trong khoảng 2 giây.
4. Xóa tên miền, chờ nhịp cập nhật rồi truy cập lại. Nếu tên miền vẫn thuộc
   danh mục bị chặn của trẻ, nó vẫn bị chặn đúng chính sách đó.
5. Ngắt mạng: danh sách gần nhất vẫn được áp dụng. Kết nối lại: heartbeat thành
   công tiếp theo nhận danh sách mới.

Để chặn cả tab đang mở/kết nối trình duyệt đã có, cần bật tiện ích SafeNest
theo [hướng dẫn 1.0.28](agent_1_0_28_web_blocking.md). Chỉ dùng hosts không
đảm bảo ngắt ngay nội dung đang tải qua kết nối đã mở. Đây là đồng bộ theo
heartbeat, không phải cam kết tức thời khi thiết bị ngoại tuyến.

## Kiểm thử

- Backend: heartbeat trả danh sách hiện tại, bao gồm thêm và xóa mục cuối.
- Agent: chạy heartbeat trên cùng instance, kiểm tra file hosts tạm và snapshot
  trình duyệt sau thêm/xóa/thêm lại; giữ cache khi thiếu trường, sai kiểu hoặc lỗi HTTP.
- Kiểm thử chính sách trình duyệt hiện có: cập nhật lại sau lỗi ghi, giữ chính sách
  mới nhất, kiểm tra Named Pipe và giao thức native messaging.
- Chưa nghiệm thu trực tiếp trên máy Agent của người dùng.
