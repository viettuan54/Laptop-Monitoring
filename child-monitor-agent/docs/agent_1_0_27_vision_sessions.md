# Agent 1.0.27 — phiên camera có thời hạn

Phụ huynh chọn riêng Theo dõi tư thế và Cảnh báo khoảng cách mắt trên web hoặc
Android 0.5.0, đặt thời lượng 1–60 phút (mặc định 5 phút), rồi bật chức năng hoặc
bấm **Bắt đầu phiên mới**. Camera dừng khi hết hạn hoặc khi cảnh báo đầu tiên đã
được lưu an toàn vào hàng đợi của Service. Không tự bắt đầu phiên tiếp theo.

Hai công tắc là lựa chọn bộ phát hiện, không phải chỉ báo camera đang mở. Sau khi
phiên kết thúc, công tắc vẫn giữ lựa chọn để phụ huynh bắt đầu lại. Lưu các cài đặt
khác hoặc đổi thời lượng không gia hạn hay khởi động lại phiên hiện tại. Tắt cả
hai chức năng sẽ dừng phiên khi Agent nhận được thay đổi.

Mỗi laptop tính hạn từ lúc Service nhận lệnh phiên mới. Laptop offline sẽ bắt đầu
khi nhận được lệnh; các laptop cùng hồ sơ có thời điểm kết thúc độc lập. Trạng thái
“đã nhận lệnh” không xác nhận camera mở thành công. Dùng tải lại trên web/app để
xem trạng thái mới. Camera bị chiếm hoặc thiếu quyền không được báo là thành công.

SQLite lưu mã phiên, hạn chót và trạng thái kết thúc. Đồng bộ lặp, đổi thời lượng
hoặc khởi động lại Agent không tạo lại phiên đã kết thúc. Cảnh báo được lưu cùng
trạng thái kết thúc trong một transaction; gửi backend bằng worker của 1.0.26.
Backend chống trùng theo thiết bị và mã phiên, nên hai phiên liên tiếp vẫn có thể
hiện hai cảnh báo dù cách nhau dưới 5 phút. Khung hình không được lưu hoặc gửi đi.

## Triển khai

1. Nâng Agent trên các laptop lên 1.0.27. Agent cũ không bảo đảm tự tắt theo phiên.
2. Áp dụng migration V30 nếu chưa có; sau đó chạy V31 từ `child-monitor-backend`:
   `node scripts/migrate-vision-sessions.js`. Sao lưu database theo quy trình triển khai.
3. Triển khai backend và web cùng thay đổi này, cài Android 0.5.0.
4. Bắt đầu một phiên mới từ web/app; các lựa chọn đã bật trước migration không
   tự tạo phiên trên Agent 1.0.27.

Migration và triển khai production chưa được thực hiện trong lần sửa mã này.

## Xác nhận trên máy Agent

- Chọn 1 phút, không gây cảnh báo: camera tắt khi hết giờ và không tự bật lại.
- Bắt đầu phiên mới, tạo điều kiện cảnh báo khoảng cách: camera tắt, cảnh báo
  xuất hiện trong mục Cảnh báo của web và Android khi mạng hoạt động.
- Thử riêng tư thế, riêng khoảng cách, và bật cả hai. Khi bật cả hai, cảnh báo
  đầu tiên kết thúc phiên; không chờ cả hai loại cùng xảy ra.
- Sau khi phiên kết thúc, khởi động lại Agent và tải lại web/app: camera vẫn tắt.
- Bắt đầu hai phiên sát nhau và tạo cảnh báo ở mỗi phiên: cả hai đều được lưu.

Kiểm thử tự động dùng camera giả; không thay thế kiểm thử webcam/Service thực tế.
Nếu Windows Application Control chặn executable, bộ cài chỉ là bản ứng viên đã
đóng gói, chưa xác nhận runtime. Không thay đổi chính sách Windows trong quy trình build.

Kết quả tại workspace ngày 2026-11-13: Agent 214/214, web 319/319, backend 88/88,
Android 22/22 và lintDebug đạt. Bytecode đóng gói của offline_queue, pipe_server,
edge_vision, pipe_client và web_tracker khớp mã nguồn. Self-test executable bị
Application Control chặn; chưa kiểm thử camera thật hoặc UI trên điện thoại.
Không có phiên trình duyệt kết nối để kiểm tra giao diện trực quan trong lần sửa này.
