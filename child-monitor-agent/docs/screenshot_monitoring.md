# Giám sát màn hình — Agent 1.0.17

Khi phụ huynh bật **Xem xét ảnh chụp màn hình** cho hồ sơ trẻ, Companion chụp
màn hình chính trong phiên Windows của trẻ mỗi **5 phút**. Ảnh xuất hiện tại
**Hoạt động → Giám sát màn hình**, có lọc thiết bị, thời gian, phân trang và
xem ảnh lớn. Dashboard tự làm mới danh sách mỗi 30 giây khi tab đang hiển thị
và người dùng không thao tác bộ lọc hoặc đang xem ảnh lớn.

Nút **Bắt đầu chụp ảnh** yêu cầu Agent chụp một ảnh mới, không cần chờ hết chu kỳ
5 phút. Chọn thiết bị trong bộ lọc rồi nhấn nút; nếu chỉ có một thiết bị, trang
tự chọn thiết bị đó. Trang hiển thị **Đang chờ ảnh…** và bỏ bộ lọc ngày để ảnh
vừa chụp không bị ẩn. Không còn nút dẫn về Điều khiển thiết bị ở trạng thái trống.
Trang đọc cờ giám sát thật để phân biệt đang bật, chưa bật và đang chờ ảnh.

## Nâng cấp và sử dụng

1. Với database đã có các migration trước đó, chạy migration ảnh từ thư mục
   `child-monitor-backend` rồi khởi động lại backend:

   ```powershell
   node scripts/migrate-screenshots.js
   node server.js
   ```

   Script đọc cấu hình DB trong `.env`, dùng tài khoản admin có quyền tạo bảng
   và cấp quyền cho các role đang cấu hình. Có thể chạy lại an toàn. Migration
   v25 và v26 đã được áp dụng cho database local trong đợt triển khai này. Database
   mới tạo bằng `Data.sql` cũng có sẵn bảng ảnh.

2. Chép `build\output\ChildMonitorSetup-1.0.17.exe` vào máy ảo VMware và chạy
   **Run as administrator**. Nhập Backend URL mà máy ảo truy cập được và
   Device Secret của đúng thiết bị. Bộ cài yêu cầu nhập lại hai thông tin này
   khi nâng cấp. Nếu đã mất secret, dùng chức năng xoay secret trên Dashboard
   và nhập secret mới. Setup dừng Agent cũ trước khi thay file và khởi động
   Service mới; không cần gỡ bản cũ trước.

3. Đăng nhập Windows trong máy ảo, mở khóa màn hình và kiểm tra Agent trực
   tuyến. Khởi động web bằng `node server.js` trong `child-monitor-web`, tải
   lại Dashboard bằng **Ctrl+F5** để nhận JavaScript mới.

4. Bật **Xem xét ảnh chụp màn hình** trong phần điều khiển của đúng hồ sơ trẻ.
   Mở **Hoạt động → Giám sát màn hình** và chọn thiết bị. Lần chụp đầu diễn ra
   sau khi Service nhận cấu hình mới và Companion đến lượt kiểm tra; các lần
   tiếp theo cách nhau ít nhất 5 phút. Companion hiển thị thông báo trước
   mỗi lần chụp.

5. Để yêu cầu ảnh ngay, nhấn **Bắt đầu chụp ảnh**. Service nhận yêu cầu ở lần
   heartbeat tiếp theo (khoảng 60 giây), Companion kiểm tra mỗi 10 giây, rồi
   Dashboard nhận ảnh ở lần làm mới. Nút mới cần Agent **1.0.17 trở lên**;
   1.0.16 chỉ hỗ trợ chụp định kỳ. Nút không tự bật quyền giám sát đang tắt.
   Khi thiết bị ngoại tuyến, trang báo rõ; yêu cầu hết hiệu lực sau 3 phút và
   có thể thử lại. Nhấn lặp trong lúc chờ dùng cùng một yêu cầu, không tạo chụp
   trùng. Sau khi chụp theo yêu cầu, chu kỳ tự động tiếp tục mỗi 5 phút.

## Điều kiện trên VMware

- Agent chụp màn hình bên trong máy ảo Windows, không chụp desktop của máy host.
- Cần có phiên người dùng đã đăng nhập, đang mở khóa và desktop truy cập được.
  Khi guest ngủ, tắt, khóa màn hình hoặc đang ở desktop UAC, Agent bỏ qua lần
  chụp. Ứng dụng có bảo vệ nội dung có thể hiện vùng đen trong ảnh.
- Máy ảo cần kết nối được Backend URL. Nếu backend chạy trên máy host thì
  `localhost` trong guest không trỏ đến host; dùng địa chỉ IP host mà guest
  truy cập được. Kiểm tra kết nối mạng VMware và firewall khi Agent ngoại tuyến.
- Không cần webcam để chụp màn hình.

## Lưu trữ và bật/tắt

- Mặc định tắt; Service chỉ cấp quyền chụp dựa trên cấu hình backend còn hiệu
  lực. Quyền này hết hạn sau tối đa 180 giây nếu không nhận được cấu hình mới.
  Khi tắt trên Dashboard, backend từ chối ảnh theo cấu hình cũ ngay; Companion
  ngừng chụp khi nhận trạng thái tắt hoặc quyền hiện tại hết hạn.
- Chỉ giữ tối đa một ảnh đang chờ gửi trong RAM. Không ghi ảnh vào SQLite hay
  file offline; gửi thất bại thì bỏ ảnh, không gửi bù khi có mạng lại.
- Ảnh JPEG có cạnh dài tối đa 1920 px, tối đa 400 KiB; ảnh nhỏ tối đa 480 px,
  40 KiB. Chỉ phụ huynh sở hữu thiết bị được đọc ảnh qua API có xác thực và RLS.
- Ảnh chỉ được xem trong 7 ngày. Backend xóa ảnh hết hạn khi khởi động và mỗi
  giờ; nếu backend đang dừng thì việc xóa tiếp tục ở lần khởi động sau.
- Có thể đặt `SCREENSHOT_INTERVAL_SECONDS` trên backend trong khoảng
  60–3600 giây; để mặc định 300 giây theo yêu cầu hiện tại.

## API

- Agent: `POST /api/logs/screenshots`, xác thực bằng `X-Device-Secret`;
  yêu cầu UUID bản ghi, thời gian chụp, revision cấu hình và hai ảnh JPEG base64.
- Phụ huynh: `POST /api/logs/screenshots/request` với `{ "device_id": 123 }`.
  Trả 202 khi đã ghi nhận yêu cầu, không có nghĩa là đã nhận ảnh. UUID yêu cầu
  đi qua heartbeat/config và được dùng làm UUID ảnh để xác nhận hoàn tất.
- Phụ huynh: `GET /api/logs/screenshots?device_id=&start=&end=&limit=12&offset=0`.
- Phụ huynh: `GET /api/logs/screenshots/:id` để tải ảnh lớn. API trả
  `Cache-Control: private, no-store`; ID ngoài quyền sở hữu trả 404.

## Kiểm chứng bản 1.0.17

- 144 test Python của Agent đạt, gồm chu kỳ, yêu cầu chụp một lần, quyền hết hạn/bị thu hồi,
  hàng đợi RAM, dữ liệu pipe lớn và thao tác capture bằng GDI giả lập.
- 75 test unit/middleware và 13 test tích hợp backend đạt, gồm bật/tắt,
  gửi trùng, giới hạn gửi, RLS, phân trang và hết hạn ảnh.
- 34 test Dashboard đạt, gồm nút chụp, thiết bị đích, trạng thái chờ, bộ lọc,
  phản hồi đến muộn và làm mới.
- Bundle Service/Companion qua self-test native và kiểm tra module đóng gói;
  `text-capabilities.json` xác nhận module ảnh có trong executable 1.0.17.
  SHA-256 của installer được ghi ở file `.exe.sha256` bên cạnh bộ cài.
- Chưa cài/chạy thử bản này trên máy ảo của người dùng. Chưa có kiểm tra giao
  diện trực tiếp desktop/mobile vì phiên làm việc không kết nối trình duyệt.
  Cần xác nhận một ảnh guest thực tế xuất hiện trên Dashboard sau khi nâng cấp.
