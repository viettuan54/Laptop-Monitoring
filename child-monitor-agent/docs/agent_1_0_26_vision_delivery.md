# Agent 1.0.26 — gửi cảnh báo webcam ngay

Popup trên máy con xác nhận Service đã lưu cảnh báo vào SQLite, chưa xác nhận
backend đã nhận. Trước 1.0.26, việc gửi chờ vòng đồng bộ 60 giây và nằm sau log
ứng dụng/website. Nếu phụ huynh tắt chức năng trước khi gửi, backend có thể trả
403; bản ghi bị bỏ theo chính sách đồng ý hiện tại, không xuất hiện ở phụ huynh.
Đây là tình huống có thể tái hiện từ luồng mã nguồn, chưa phải kết luận về một
lần thử cụ thể khi chưa có log máy con.

## Thay đổi

- Ghi cảnh báo xong sẽ đánh thức luồng `VisionAlertSync` riêng.
- Khi mất mạng, giữ bản ghi và thử lại mỗi 5 giây sau khi lần gửi trước kết thúc.
- Khóa đồng bộ ngăn hai luồng gửi cùng bản ghi đồng thời.
- Giữ nguyên chống trùng 5 phút, ngưỡng đo, đồng ý của phụ huynh và payload không ảnh.
- Log chỉ ghi loại cảnh báo và HTTP, không ghi nội dung nhạy cảm hay credential.

## Kiểm tra trên máy Agent

Sau khi cập nhật 1.0.26, bật chức năng khoảng cách mắt, chờ đồng bộ rồi tạo cảnh
báo. Giữ chức năng bật trong khi kiểm tra mục Cảnh báo trên web/Android, chọn đúng
laptop và bỏ bộ lọc đã đọc/chưa đọc nếu cần.

Trong `logs/service.log` của thư mục cài đặt:

- `Vision alert delivery acknowledged: type=eye_distance_warning HTTP=201`: backend đã tạo cảnh báo.
- `HTTP=200`: backend đã nhận; có thể bỏ qua vì cùng loại đã có trong 5 phút.
- `Vision alert rejected ... HTTP=403`: backend từ chối, thường do chức năng đã tắt.
- `Vision alert delivery deferred`: chưa gửi thành công, bản ghi còn chờ thử lại.

Nếu HTTP=201 mà phụ huynh vẫn không thấy, kiểm tra backend, tài khoản, thiết bị
và bộ lọc đang xem. Không cần chỉnh ngưỡng phát hiện để sửa lỗi vận chuyển cảnh báo.

## Kiểm thử

207 test Agent đạt, gồm đánh thức worker, thử lại khi offline, chống gửi đồng
thời, và xử lý từ chối. Backend được kiểm tra INSERT cả hai loại vào PostgreSQL
tạm và đọc lại qua controller danh sách; không gửi thông báo thật cho phụ huynh.
Kết quả self-test bộ cài ghi ở file verification trong thư mục build/output.

Build ngày 13/11/2026: Windows Application Control vẫn chặn chạy self-test
executable. Bộ cài được biên dịch riêng từ bundle đã kiểm tra bytecode; 5 module
khớp nguồn, gồm worker Service. Đây là bản để kiểm thử, chưa được xác nhận trên
máy con. Không thay đổi chính sách bảo vệ của Windows để vượt qua bước kiểm tra.
