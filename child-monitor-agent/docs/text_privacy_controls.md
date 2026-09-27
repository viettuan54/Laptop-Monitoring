# Phần 2 — Bật/tắt và bảo vệ dữ liệu

Ngày triển khai code: 2026-09-26. Phân loại phía backend, giữ nguyên ba nhãn
`SAFE`, `RISK`, `HIGH_RISK`. Không huấn luyện lại model trong bước này.

## Đã triển khai

- Công tắc phụ huynh hiện có `enable_text_moderation` vẫn mặc định tắt.
  Dashboard giải thích dữ liệu được gửi, nguồn đang/chưa hoạt động và độ trễ
  đồng bộ. Không tự bật công tắc trên hồ sơ nào.
- Companion lấy cấu hình từ Service trước mỗi lượt quét, chỉ trích xuất query
  nếu lease còn hiệu lực và thời điểm truy cập thuộc phiên bật hiện tại.
  Cấu hình thiếu, phản hồi pipe lỗi hoặc lease hết hạn → không trích xuất text.
- Service chỉ gia hạn lease 180 giây từ cấu hình backend thành công. Cấu hình
  cache cũ chỉ có boolean không đủ để bật; cấu hình thiếu cờ phải tắt. Backend
  gửi `settings.updated_at`; phản hồi cũ không được ghi đè phản hồi mới.
- Thay đổi phiên bản settings bắt đầu một cửa sổ mới, xóa dữ liệu trước đó.
  Đây là xử lý thận trọng để không bỏ sót phiên tắt/bật giữa hai lần đồng bộ;
  thay đổi settings khác cũng có thể làm bỏ các query đang chờ, không chỉ cờ text.
- Service kiểm tra lại cờ/thời gian khi nhận từ pipe, khi vào hàng đợi và trước
  từng lần gửi HTTP/retry. Tắt/hết lease → xóa hàng đợi, kể cả khi API suspended.
- Backend kiểm tra cờ và `occurred_at` so với phiên bản settings trước mỗi lần
  gọi model/retry. Sau inference, transaction khóa chia sẻ hàng settings rồi
  kiểm tra lại trước khi lưu sự kiện/cảnh báo. Kết quả đã mất quyền xử lý bị bỏ
  và trả ACK để Agent xóa local. PostgreSQL không lưu trường text gốc.
- Lọc NFKC/Unicode, ký tự điều khiển; từ chối cả query có email, số điện thoại
  Việt Nam phổ biến, secret có tiền tố, Bearer/JWT hoặc URL. Không tự cắt chuỗi
  rồi làm mất phủ định/trích dẫn. Lỗi không chứa nguyên văn bị từ chối.
- Hàng đợi text dùng Windows DPAPI machine-scope. DACL của thư mục `db`, file
  database và sidecar hiện có được thay bằng chỉ SYSTEM/Administrators;
  sidecar mới kế thừa từ thư mục. ACL/mã hoá lỗi → không thu thập/lưu text.
  Không dùng thư mục database tuỳ ý cho lưu văn bản production; `secure_file=False`
  chỉ dành cho test. DPAPI machine-scope không thay thế ACL: người có ciphertext
  trên cùng máy có thể giải mã; quản trị viên/SYSTEM không nằm trong threat model.
- Tối đa 1.000 bản ghi query, 1.000 ký tự/bản ghi, 20 bản ghi/batch. Khi model
  lỗi nhưng lease còn được gia hạn, query được giữ tối đa 7 ngày. ACK, bị từ chối
  400/403, tắt, hết lease hoặc khởi động lại Service → loại dữ liệu tương ứng.
- SQLite bật `secure_delete`; plaintext chỉ tồn tại trong RAM khi xử lý/gửi.
  Không tuyên bố xóa pháp chứng trên SSD, bản sao lưu hoặc crash dump.
- Log web mới ở Companion/Service/backend chỉ chứa origin/tên miền. Path,
  query, fragment, credentials và tiêu đề bị bỏ, ngay cả khi text đang tắt.
  Khi Service khởi động, metadata web cũ trong SQLite local cũng được làm sạch
  và hàng đợi text cũ bị xóa. Không xóa lịch sử gốc của trình duyệt; không sửa/xóa
  dữ liệu lịch sử đã có trong PostgreSQL ở bước này.
- Endpoint Agent chỉ cho `search_query`/`page_content`, không nhận chat.
  Agent/hàng đợi hiện chỉ hỗ trợ `search_query`; chưa triển khai page collector.

## Độ trễ và giới hạn

Heartbeat Service thông thường 60 giây; Companion quét/kiểm tra mỗi 15 giây.
Lease tối đa 180 giây. Việc dọn hàng đợi xảy ra khi nhận cấu hình, trả cấu hình
pipe hoặc trước lượt sync (thông thường 60 giây), không phải một timer xóa tại
chính xác giây hết hạn. Text không được trích xuất/gửi với lease đã hết hạn.

HTTP/model request đã rời máy trước khi tắt không thể thu hồi. Không giữ khóa
database suốt thời gian inference; backend kiểm tra lại và bỏ kết quả mất quyền.
Push cũng được kiểm tra trước gửi, nhưng push đã gửi không thể thu hồi. Không
bảo đảm công tắc truyền tức thì khi Agent offline hoặc các đồng hồ lệch giờ.

Bộ lọc mẫu không bảo đảm phát hiện mọi định danh/secret, không thay thế giới
hạn nguồn, quyền truy cập và thông báo minh bạch. Reverse proxy/APM/crash dump
và chính sách lưu log tại môi trường triển khai phải được kiểm tra riêng để không
ghi request body. Snapshot History tạm phục vụ theo dõi domain vẫn là dữ liệu
trình duyệt của người dùng, được gỡ trong `finally` sau quét; chưa có cam kết xóa
pháp chứng snapshot sau crash. Không gọi cơ chế này là ẩn danh hoàn toàn.

## Kiểm thử và bàn giao

Chạy tự động:

```powershell
# Trong child-monitor-agent
.\.venv-edge\Scripts\python.exe -m unittest discover -s tests -p test_*.py
# Trong child-monitor-backend
npm.cmd run test:unit
# Trong child-monitor-web
npm.cmd test
npm.cmd run check
```

Bao phủ: cờ mặc định/thiếu/hết hạn; config lệch thứ tự; không hồi tố; dữ liệu
nhạy cảm; query không lọt qua URL/title; DPAPI round-trip và ciphertext trong
SQLite; DACL chỉ hai SID (mock API ACL, chưa kiểm thử Standard User thực tế);
tắt trước retry/khi API suspended; TTL/dung lượng; bỏ plaintext/ciphertext hỏng;
khởi động lại; tắt hoặc phiên bản settings đổi trong lúc inference; RISK không
tạo alert và event không chứa raw text.

Không cần migration SQL mới; dùng `settings.updated_at` và schema queue sẵn có.
Migration v22 của model ba nhãn vẫn là điều kiện từ bước trước cho DB triển khai;
không tự chạy migration hoặc sửa dữ liệu production trong bước này.

Trước nghiệm thu trên thiết bị thật: build/cài lại Agent (source installer và
PyInstaller đã được cập nhật cho module dùng chung), thử bật/tắt với tài khoản
Standard User, kiểm tra DACL database/WAL, mất mạng và lưu lượng thật; kiểm tra
backend/PostgreSQL/Redis/service model trên DB thử nghiệm đã migrate v22. Bộ
test unit không thay thế nghiệm thu xuyên hệ thống này. Model dữ liệu tổng hợp
hiện chưa được phê duyệt production, không tự bật cảnh báo thật.

Bước tiếp theo: thiết kế extension Chrome/Edge, quyền và kênh local được xác
thực, allowlist nguồn công khai; sau đó mới triển khai `page_content`, chia đoạn
giữ ngữ cảnh và TTL 24 giờ. Chat tiếp tục ngoài phạm vi.
