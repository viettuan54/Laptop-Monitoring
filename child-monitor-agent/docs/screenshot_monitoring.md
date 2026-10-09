# Giám sát màn hình — Agent 1.0.19

Khi phụ huynh bật **Xem xét ảnh chụp màn hình** cho hồ sơ trẻ, Companion chụp
màn hình chính trong phiên Windows của trẻ mỗi **5 phút**. Ảnh xuất hiện tại
**Hoạt động → Giám sát màn hình**, có lọc thiết bị, thời gian, phân trang và
xem ảnh lớn. Dashboard kiểm tra metadata mỗi 2 giây khi đang chờ ảnh, mỗi
15 giây khi rảnh, chỉ tải lại thumbnail nếu có thay đổi. Trang tạm ngừng cập
nhật khi đang sửa bộ lọc, còn bộ lọc chưa áp dụng, thao tác bằng bàn phím trên
một nút, mở hộp thoại hoặc chuyển sang tab trình duyệt khác.

Nút **Bắt đầu chụp ảnh** yêu cầu Agent chụp một ảnh mới, không cần chờ hết chu kỳ
5 phút. Chọn thiết bị trong bộ lọc rồi nhấn nút; nếu chỉ có một thiết bị, trang
tự chọn thiết bị đó. Trang hiển thị **Đang chờ ảnh…** và bỏ bộ lọc ngày để ảnh
vừa chụp không bị ẩn. Không còn nút dẫn về Điều khiển thiết bị ở trạng thái trống.
Trang đọc cờ giám sát thật để phân biệt đang bật, chưa bật và đang chờ ảnh.

## Tăng tốc và xóa ảnh trong 1.0.19

- Heartbeat giảm từ 60 xuống 5 giây; Companion kiểm tra từ 10 xuống 1 giây.
  Giữ thông báo trước khi chụp trong 3 giây. Tổng các bước chờ theo lịch giảm
  từ tối đa khoảng 103 giây xuống 11 giây, **chưa tính mạng, xử lý và retry**.
  Đây là tính toán từ chu kỳ, chưa phải số đo độ trễ trên máy ảo của người dùng.
- Khi pipe tạm bận, Companion thử lại cùng ảnh và UUID trong RAM, tối đa
  120 giây và không vượt thời hạn quyền chụp. Không chụp lại hoặc hiện lại
  thông báo chỉ vì gửi qua pipe thất bại. Mất kết nối tạm thời không gia hạn
  quyền; trạng thái tắt vẫn có hiệu lực ngay. HTTP retry giữ cùng UUID.
- Web có ngân sách đọc ảnh riêng theo phụ huynh, không dùng chung 100 request
  của các thao tác khác. Khi kết nối lỗi, giữ ảnh đã tải và thử lại sau 30 giây.
- **Xóa ảnh** dưới mỗi thumbnail mở hộp xác nhận cho đúng ảnh đó.
  **Xóa tất cả ảnh** dùng thiết bị đang chọn ở bộ lọc; khi chọn Tất cả thiết bị,
  phạm vi là toàn bộ thiết bị thuộc tài khoản. Bộ lọc thời gian không giới hạn
  thao tác này; hộp thoại nêu rõ phạm vi và số ảnh. Ảnh đến sau lúc lấy phạm vi
  xóa được giữ lại. Xóa ảnh không tắt lịch chụp tự động.
- Khi xóa, backend đặt cả ảnh gốc và thumbnail thành NULL ngay trong cùng
  transaction. Giữ UUID/metadata nhận ảnh tối đa thời hạn lưu 7 ngày để yêu
  cầu chụp đã hoàn tất không bị phát lại, và retry muộn không khôi phục ảnh
  đã xóa (HTTP 410). Mọi truy vấn hiển thị loại bỏ bản ghi đã xóa; RLS giới
  hạn cả thao tác xóa vào thiết bị của phụ huynh đang đăng nhập.

Kiểm chứng 1.0.19: 148 test Agent, 75 unit/middleware và 15 integration backend
(database/Redis test riêng), 41 test dashboard và kiểm tra cú pháp đạt.
Schema V27 đã áp dụng cho database local và test, giữ nguyên ảnh hiện có.
Bundle qua kiểm tra tĩnh; Windows Application Control trên máy build chặn
bước chạy self-test Service executable, nên chưa xác minh executable hay độ
trễ thực tế trên VMware. Bộ cài được tạo riêng bằng Inno Setup mà không đổi
chính sách Windows. Chưa kiểm tra giao diện bằng trình duyệt trong phiên này.

## Bản sửa 1.0.18

Bộ cài 1.0.17 chứa `win32ui.pyd` nhưng không có `mfc140u.dll` mà module này
phụ thuộc. Máy build có MFC trong Windows nên kiểm thử trên máy build không
phát hiện; máy Windows/VMware thiếu MFC có thể lỗi ngay sau thông báo chụp.
Bản 1.0.18 dùng `win32gui` và GDI trực tiếp, bỏ phụ thuộc MFC ở đường chụp ảnh.
Bitmap được đọc dưới dạng BGR 32-bit từ trên xuống, xử lý rõ cả độ sâu màu
của màn hình và hướng ảnh theo
[hợp đồng GetDIBits của Windows](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdibits).

Self-test của executable nay tạo bitmap màu trong RAM, đọc qua GDI và mã hóa
JPEG; không chụp desktop thật. Bản sửa đạt 146 test Agent, gồm kiểm thử GDI
native khi không thể import `win32ui`, hướng/màu ảnh và giải phóng handle khi lỗi.
Companion ghi traceback khi chụp lỗi; Service ghi mã HTTP nếu backend không
xác nhận đã nhận ảnh. Thông báo trước khi chụp tự đóng sau 3 giây là bình thường,
không phải xác nhận rằng ảnh đã gửi lên thành công.

Giới hạn xác minh của bộ cài 1.0.18 tạo ngày 08/10/2026: 146 test mã nguồn đạt;
JPEG giả lập từ GDI mới được bộ kiểm tra backend chấp nhận; Service self-test
và kiểm tra tĩnh bundle đạt. Windows Application Control trên máy build chặn
chạy Companion `.exe`, nên self-test của executable này chưa chạy được.
Installer được đóng gói riêng bằng Inno Setup sau kiểm tra tĩnh, không thay
đổi chính sách Application Control. Chưa xác nhận ảnh thật từ máy ảo của người dùng.

Đọc lỗi chụp trên máy chạy Companion (không giới hạn tìm kiếm trong 100 dòng cuối):

```powershell
Select-String -LiteralPath (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ChildMonitorAgent\logs\companion.log') -Pattern 'Screen monitoring|Screenshot' | Select-Object -Last 15
```

## Nâng cấp và sử dụng

1. Với database đã có các migration trước đó, chạy migration ảnh từ thư mục
   `child-monitor-backend` rồi khởi động lại backend:

   ```powershell
   node scripts/migrate-screenshots.js
   node server.js
   ```

   Script đọc cấu hình DB trong `.env`, dùng tài khoản chủ sở hữu có quyền tạo/sửa bảng
   và cấp quyền cho các role đang cấu hình. Có thể chạy lại an toàn. Migration
   v25–v27 đã được áp dụng cho database local trong đợt triển khai này. Database
   mới tạo bằng `Data.sql` cũng có sẵn bảng ảnh.

2. Chép `build\output\ChildMonitorSetup-1.0.19.exe` vào máy ảo VMware và chạy
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
   heartbeat tiếp theo (chu kỳ 5 giây trên 1.0.19), Companion kiểm tra mỗi giây,
   rồi Dashboard kiểm tra ảnh mới mỗi 2 giây. Nút cần Agent **1.0.17 trở lên**;
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
- Trạng thái trực tuyến ở trang Thiết bị, Giám sát màn hình và khi yêu cầu
  chụp đều dùng cùng ngưỡng heartbeat trong **5 phút**, tính theo đồng hồ
  database. Yêu cầu chụp vẫn hết hạn sau 3 phút. Dịch vụ Windows có trạng thái
  Running nhưng không gửi được heartbeat thì thiết bị vẫn được báo ngoại tuyến.
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
- Thêm `metadata=1` vào API danh sách để chỉ nhận số ảnh, ID mới nhất, phạm vi
  xóa và trạng thái yêu cầu; không trả thumbnail.
- Phụ huynh: `DELETE /api/logs/screenshots/:id` để xóa một ảnh.
- Phụ huynh: `DELETE /api/logs/screenshots?device_id=` với JSON
  `{ "confirm_all": true, "through_id": "<scope_latest_id>" }` để xóa ảnh
  trong phạm vi thiết bị/tài khoản đến ID đã xác nhận. Mọi endpoint đều giữ
  xác thực và RLS; Agent không có quyền xóa ảnh.

## Kiểm chứng bản 1.0.17

- 144 test Python của Agent đạt, gồm chu kỳ, yêu cầu chụp một lần, quyền hết hạn/bị thu hồi,
  hàng đợi RAM, dữ liệu pipe lớn và thao tác capture bằng GDI giả lập.
- 75 test unit/middleware và 14 test tích hợp backend đạt, gồm bật/tắt,
  gửi trùng, giới hạn gửi, RLS, phân trang và hết hạn ảnh.
- 35 test Dashboard đạt, gồm trạng thái trực tuyến thống nhất, nút chụp, thiết bị đích, trạng thái chờ, bộ lọc,
  phản hồi đến muộn và làm mới.
- Bundle Service/Companion qua self-test native và kiểm tra module đóng gói;
  `text-capabilities.json` xác nhận module ảnh có trong executable 1.0.17.
  SHA-256 của installer được ghi ở file `.exe.sha256` bên cạnh bộ cài.
- Chưa cài/chạy thử bản này trên máy ảo của người dùng. Chưa có kiểm tra giao
  diện trực tiếp desktop/mobile vì phiên làm việc không kết nối trình duyệt.
  Cần xác nhận một ảnh guest thực tế xuất hiện trên Dashboard sau khi nâng cấp.
