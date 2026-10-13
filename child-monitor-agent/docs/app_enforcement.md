# Chặn ứng dụng theo danh mục — Agent 1.0.21

Phụ huynh bật **Phân loại và chặn ứng dụng**, rồi chọn **Chặn** cho danh mục
Học tập (`learning`), Giải trí (`entertainment`), Trình duyệt (`browsers`) hoặc
Chưa phân loại (`unknown`). Tính năng này tái sử dụng mô hình phân loại hiện có.

## Luồng thực thi

1. Companion quét các cửa sổ ứng dụng mỗi 2 giây, kể cả cửa sổ thu nhỏ, độc lập
   với việc ghi thời lượng sử dụng. Nó gửi PID và thời điểm tạo tiến trình qua Named Pipe.
2. Service xác minh người gửi thuộc SID và phiên Windows đang được giám sát.
   Service tự đọc đường dẫn, tên executable và ProductName/FileDescription từ Windows;
   không nhận nhãn do Companion tự khai. Tiến trình hệ thống, tiến trình quan trọng
   và các executable của Agent được bỏ qua.
3. Phân loại theo lookup/model đã đóng gói; trường hợp cần Gemini được xử lý nền.
   Chỉ nhãn có nguồn `exact_lookup`, `trained_model` hoặc `gemini` mới được dùng
   để chặn. `pending` không đồng nghĩa với nhãn `unknown` đã được xác nhận.
4. Khi danh mục bị chặn, Companion thông báo và gửi `WM_CLOSE`. Nếu tiến trình còn
   chạy sau 8 giây, Service kiểm tra lại chính sách và phiên sử dụng rồi buộc thoát
   bằng handle đã xác minh. Dữ liệu chưa lưu của ứng dụng có thể bị mất.
5. Service chỉ ghi `closed` khi xác nhận tiến trình đã thoát. Không đủ quyền hoặc
   chưa xác nhận được kết quả sẽ ghi `failed`; đổi chính sách, đổi phiên hoặc dừng
   Service sẽ hủy yêu cầu đang chờ và ghi `cancelled`.
6. Kết quả lưu trong SQLite, đồng bộ mỗi 60 giây qua
   `POST /api/agent/app-enforcement/batch`. UUID giữ nguyên khi gửi lại; backend
   chỉ lưu một lần trên mỗi thiết bị. Mất mạng không xóa bản ghi chưa được xác nhận.

Chính sách cập nhật qua heartbeat khoảng 5 giây khi có mạng. Khi mất mạng, Agent
dùng chính sách đã lưu. Nhãn xác nhận được lưu tối đa 30 ngày, gắn với metadata
và phiên bản model, dùng lại sau khi Service khởi động lại. Ứng dụng chưa có nhãn
và không đủ dữ liệu phân loại local sẽ chờ kết nối để phân loại tiếp.

## Xem kết quả

Trong **Hoạt động → Ứng dụng**, cột **Chính sách hiện tại** hiển thị **Yêu cầu chặn**
hoặc **Cho phép**. Đây là chính sách, không phải bằng chứng tiến trình đã đóng.
Khung **Kết quả chặn ứng dụng** hiển thị kết quả Agent xác nhận và lý do; nhấn
**Làm mới** sau khi Agent đồng bộ. Danh sách hiển thị 10 kết quả phù hợp trong
200 kết quả mới nhất của thiết bị/khoảng thời gian đã chọn.

API đọc `GET /api/logs/app-enforcement` dành cho phụ huynh. PostgreSQL RLS giới hạn
dữ liệu trong các thiết bị thuộc tài khoản; credential thiết bị gửi log quyết định
`device_id`, trường `device_id` trong payload không có hiệu lực.

## Cập nhật

1. Trong `child-monitor-backend`, áp dụng migration trước khi chạy backend mới:

   ```powershell
   node scripts/migrate-app-enforcement.js
   ```

   Script đọc `.env`, dùng `DB_ADMIN_USER` để tạo bảng và cấp quyền. Nếu role chạy
   API không có quyền tạo bảng, khai báo riêng `DB_MIGRATION_USER` và
   `DB_MIGRATION_PASSWORD` cho tài khoản sở hữu schema. Script có thể chạy lại.
   Với DB kiểm thử dùng `--test` và các biến `TEST_DB_*`; không fallback sang DB thật.

2. Khởi động lại backend bằng cơ chế triển khai hiện có, cập nhật file Dashboard.
3. Cài `build/output/ChildMonitorSetup-1.0.21.exe` bằng quyền quản trị trên máy trẻ.
   Cần cập nhật cả Service và Companion; bộ cài cũ chưa có thực thi chặn ứng dụng.
4. Chọn một ứng dụng thử nghiệm không có dữ liệu chưa lưu. Chặn danh mục của nó,
   mở ứng dụng, kiểm tra yêu cầu đóng và kết quả sau đồng bộ. Cho phép lại danh mục
   và xác minh ứng dụng chạy bình thường. Thử mở lại ứng dụng khi vẫn bị chặn để
   xác nhận tiến trình mới được kiểm tra tiếp.

## Phạm vi hiện tại

- Chặn ứng dụng desktop có cửa sổ trong phiên console đang được giám sát; chưa
  quét toàn bộ service/tiến trình nền không có cửa sổ hoặc các phiên RDP khác.
- Đây là phát hiện rồi đóng; ứng dụng có thể xuất hiện trong khoảng thời gian
  phát hiện và chờ đóng. Không phải cơ chế ngăn executable khởi chạy của Windows.
- Chặn nhóm Trình duyệt sẽ đóng cả trình duyệt; chặn từng website vẫn dùng luồng
  chính sách website riêng của dự án.
- Các executable nằm trong thư mục Windows hoặc Agent được bảo vệ, kể cả khi
  danh mục của chúng bị chặn. Không dùng ứng dụng hệ thống để thử tính năng này.
- Lịch sử kết quả được tạo từ Agent mới; log cũ không được suy diễn thành kết quả đóng.

## Kiểm chứng

Agent có kiểm thử chuyển chính sách/phiên, PID tái sử dụng, nhãn đang chờ, retry,
SQLite offline, xử lý `WM_CLOSE` và buộc thoát bằng handle trên tiến trình Node
ẩn do test tự tạo. Backend có kiểm thử batch lặp, xác thực thiết bị và RLS với
hai phụ huynh trên DB test. Dashboard có kiểm thử phân biệt chính sách với kết
quả thực thi, trạng thái lỗi API và escape tên ứng dụng.

Bước kiểm tra bytecode khi build cũng bắt buộc có `AppMonitor`, `AppEnforcer`,
Windows process adapter và queue đồng bộ trong executable đã đóng gói.

### Trạng thái kiểm chứng ngày 10/10/2026

- Đạt 167 kiểm thử Agent, 77 kiểm thử đơn vị backend, 16 kiểm thử tích hợp
  PostgreSQL/Redis và 44 kiểm thử Dashboard.
- Migration v28 đã áp dụng cho DB local và DB test. Backend mới chạy trên cổng
  3000, Dashboard mới trên cổng 5173. Hai endpoint kết quả chặn truy cập được qua
  `https://api.tuansosad.id.vn`, trả 401 đúng khi chưa gửi thông tin xác thực.
- Executable 1.0.20 đã qua kiểm tra module trong bytecode và `--self-test` của
  cả Service và Companion. Lỗi Application Control ban đầu không còn tái hiện
  khi chạy lại cùng executable; không thay đổi chính sách bảo mật Windows.
- Đã tạo `build/output/ChildMonitorSetup-1.0.20.exe` (71.469.292 byte), kèm file
  `.sha256`. SHA-256:
  `71835dd8e03f9fe25777e5a26d4c69cf52b27fa5ff68df31733524a5185fd5a4`.
- Chưa cài Agent mới và chưa nghiệm thu chặn ứng dụng trên máy trẻ. Người dùng
  đã mở máy ảo và chọn tự cài bộ cài; không tự động cài hoặc điều khiển máy trẻ.
- Trình duyệt kiểm thử không khả dụng trong phiên triển khai; chưa kiểm tra trực
  quan giao diện trên desktop/mobile. Các kiểm thử renderer đã qua.

### Sửa lỗi hạn mức 0 (1.0.21, ngày 10/10/2026)

- Dashboard đã quy định `daily_limit_minutes = 0` là không giới hạn, nhưng Agent
  đến 1.0.20 tính thành 0 giây còn lại và khóa máy. Cơ chế này độc lập với chặn
  ứng dụng; migration v28 không thay đổi cài đặt thời gian hoặc model.
- Backend giữ nguyên giá trị 0 trong DB/API phụ huynh. Config và heartbeat gửi
  `daily_limit_minutes: 1440` cùng `daily_limit_unlimited: true` để Agent cũ có
  hạn mức tương đương cả ngày. Bộ đếm cũ vẫn hữu hạn và tính theo từng ngày.
- Agent 1.0.21 nhận cả giá trị 0 từ backend cũ và cờ tương thích từ backend mới.
  `remaining_seconds = -1` biểu thị không giới hạn, nên không bật đếm ngược.
  Khóa thủ công và khung giờ vẫn được kiểm tra trước hạn mức ngày.
- Khi backend cũ gửi lại hạn mức hữu hạn mà thiếu cờ mới, Agent xóa cờ không
  giới hạn đã cache để tránh giữ nhầm chính sách. Chính sách không giới hạn
  vẫn dùng được khi Service khởi động lại offline.
- Đạt 173 kiểm thử Agent, 79 kiểm thử đơn vị backend và 17 kiểm thử tích hợp
  PostgreSQL/Redis. Backend đã khởi động lại với phần tương thích cho Agent cũ.
- Service 1.0.21 qua `--self-test`; cả hai executable qua kiểm tra module đóng
  gói. Windows Application Control chặn chạy `--self-test` của Companion
  1.0.21 (Code Integrity 3033/3077). Chưa tạo bộ cài 1.0.21 được kiểm chứng;
  không thay đổi chính sách bảo mật Windows để bỏ qua bước này.
- Theo lựa chọn của người dùng, đã tạm đổi riêng khung giờ của trẻ gắn với máy
  BimPoP từ 07:00–21:00 sang 00:00:00–23:59:59, lưu cấu hình trước khi đổi và
  audit riêng. Không đổi hạn mức 0, cờ khóa thủ công hoặc các tùy chọn giám sát.
  Máy tiếp tục gửi heartbeat; người dùng chưa thử đăng nhập lại để xác nhận.
  Khung giờ này chưa có lịch tự khôi phục: đặt lại 07:00–21:00 trên Dashboard
  sau khi kiểm tra xong.

### Hoàn tất bộ cài 1.0.21 ngày 12/10/2026

- Đã tạo `build/output/ChildMonitorSetup-1.0.21.exe` (71.471.152 byte), kèm
  `ChildMonitorSetup-1.0.21.exe.sha256` và `ChildMonitorSetup-1.0.21.verification.json`.
  SHA-256: `8ca41f594a84e32bcb0bac1498d2b1c29927e6771f337f0fa46b309f5f154f79`.
- Service và Companion đã chạy `--self-test` thành công trên cùng các executable
  đã tạo ngày 10/10. Lỗi Application Control trước đó không còn tái hiện; không
  thay đổi chính sách bảo mật Windows. Chương trình provisioning chạy được `--help`.
- Chạy lại toàn bộ 173 kiểm thử Agent đều đạt. Đối chiếu bytecode của 28 module,
  gồm entry point Service, Companion và provisioning, khớp mã nguồn hiện tại.
  Bản đóng gói có sửa hạn mức 0, chặn ứng dụng, thu thập truy vấn và chụp ảnh.
- 13 file model giữ nguyên theo SHA-256 so với 1.0.20. Các thư mục cấu hình,
  log, cơ sở dữ liệu và tệp tạm trong bản phát hành đều trống.
- Chưa chạy cài đặt trên máy trẻ. Người dùng tự chép bộ cài sang máy Agent,
  chạy bằng quyền Administrator, nhập Backend URL và Device Secret của thiết
  bị hiện tại. Sau cài đặt kiểm tra hạn mức 0 trong khung giờ cho phép và kết
  quả chặn ứng dụng trên Dashboard. Không giới hạn hạn mức ngày vẫn tuân theo
  khung giờ cho phép và lệnh khóa thủ công.
