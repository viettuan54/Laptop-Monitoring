# Nhắc nghỉ giải lao — Agent 1.0.23

Thay **Ghi nhận phím bấm** tại **Điều khiển thiết bị**. Tính năng mặc định tắt,
độc lập với webcam, ảnh màn hình, hạn mức ngày và chính sách phân loại.

## Sử dụng

1. Chọn trẻ, bật **Nhắc nghỉ giải lao**, đặt thời gian rồi **Lưu điều khiển**.
   Khoảng nhắc 5–180 phút (mặc định 30), thời gian nghỉ 1–30 phút (mặc định 5).
2. Cửa sổ Windows trên máy trẻ có **Nghỉ ngay** và **Nhắc lại sau 5 phút**.
   Không khóa máy, đóng ứng dụng hoặc thay đổi hạn mức. Đóng cửa sổ hoặc hết
   thời gian hiển thị 2 phút tương đương nhắc lại sau 5 phút.
3. **Lịch sử nhắc nghỉ** hiển thị 10 sự kiện mới nhất của các thiết bị thuộc trẻ.
   **Làm mới** chỉ tải lịch sử, không mất cấu hình đang sửa trong biểu mẫu.

**Đã hiển thị lời nhắc** được ghi khi cửa sổ thực sự xuất hiện. **Trẻ chọn nghỉ
ngay** chỉ ghi nhận lựa chọn, không chứng minh trẻ đã nghỉ.

## Bộ đếm và offline

- Companion đọc thời gian từ lần tương tác gần nhất qua `GetLastInputInfo`
  mỗi 5 giây, không cài hook bàn phím hoặc đọc nội dung gõ.
- Tính thời gian trong desktop mở khóa, chưa có yêu cầu khóa từ chính sách,
  kể cả đọc nội dung/xem video không dùng chuột hoặc bàn phím. Từ 1.0.23,
  thời gian không thao tác không dừng hoặc đưa bộ đếm về 0.
  Nếu rời máy nhưng để phiên mở khóa, bộ đếm vẫn chạy; khóa máy khi nghỉ để
  Agent nhận biết khoảng nghỉ. Đây là thời gian phiên mở khóa, không đo sự chú ý.
- Không cộng thời gian ngủ, khóa máy, mất Companion hay khoảng lấy mẫu gián
  đoạn quá 15 giây. Khoảng nghỉ đủ thời gian cấu hình bắt đầu lại bộ đếm.
- SQLite của Service giữ thời gian đã quan sát qua lần khởi động lại ngắn.
  Đổi phiên Windows, bật/tắt hoặc đổi cấu hình bắt đầu lại bộ đếm. Mỗi máy
  có bộ đếm độc lập.
- **Nghỉ ngay** tạm ngừng nhắc trong thời gian nghỉ đã đặt. Nếu tiếp tục dùng
  máy mà chưa có khoảng nghỉ đủ dài, Agent có thể nhắc lại sau đó.
- Khi có mạng, heartbeat khoảng 5 giây; Companion kiểm tra mỗi 5 giây. Khi
  offline dùng cấu hình đã lưu. Tắt từ Dashboard có hiệu lực khi Agent nhận
  cấu hình mới.

## Dữ liệu và nâng cấp

- Ba trường mới: `enable_break_reminders`, `break_interval_minutes`,
  `break_duration_minutes`. Cột `enable_keylog` chỉ giữ để tương thích lịch sử;
  migration đặt false và config Agent luôn trả false. Không chuyển lựa chọn
  keylog cũ thành đồng ý bật nhắc nghỉ.
- Named Pipe xác minh SID/phiên trước khi nhận mẫu hoạt động hoặc phản hồi.
  Service lưu sự kiện SQLite trước ACK; UUID ổn định chống trùng khi retry.
  Chỉ đánh dấu synced cho ID được backend xác nhận.
- `POST /api/agent/break-reminders/batch` nhận tối đa 100 sự kiện mỗi đợt;
  device_id lấy từ credential. API đọc
  `GET /api/logs/break-reminders?child_id=...` dùng JWT và PostgreSQL RLS.
- Sự kiện gồm `shown`, `acknowledged`, `snoozed`; không có nhãn “đã nghỉ”.

Chạy `node scripts/migrate-break-reminders.js` trong backend trước khi chạy
backend mới. Tài khoản phải sở hữu bảng settings; nếu cần đặt riêng
`DB_MIGRATION_USER/PASSWORD` trong `.env`. DB test dùng `--test` và
`TEST_DB_MIGRATION_USER/PASSWORD`; đích kết nối luôn từ `TEST_DB_*`.

Cập nhật Dashboard và cài `ChildMonitorSetup-1.0.23.exe` trên máy trẻ. Agent trước
1.0.22 bỏ qua cấu hình mới; 1.0.22 có lỗi không nhắc khi ít thao tác.
Nghiệm thu với khoảng nhắc 10 phút, nghỉ 2 phút: mở video/đọc nội dung và giữ
phiên Windows mở khóa, lời nhắc xuất hiện sau khoảng 10 phút kể từ lúc Agent
nhận cấu hình (kiểm tra mỗi 5 giây). Kiểm tra thêm cả hai lựa chọn,
tắt/bật, khóa/ngủ máy, mất mạng/kết nối lại, và lịch sử sau đồng bộ (~60 giây).
Kiểm thử tự động không thay thế bước cài/nghiệm thu trên máy trẻ.

## Sửa lỗi 1.0.23 — 14/10/2026

- Tái hiện trên 1.0.22: cấu hình 10 phút, nghỉ 2 phút; không thao tác trong
  600 giây khiến bộ đếm về 0 và không có lời nhắc. Bỏ điều kiện idle 60 giây;
  vẫn bỏ qua khóa/ngủ máy, mất Companion và khoảng lấy mẫu gián đoạn.
- Khi Named Pipe gián đoạn, hủy cửa sổ phải xóa trạng thái đang hiển thị để
  cùng lời nhắc có thể mở lại lúc kết nối phục hồi. Nếu worker cửa sổ lỗi,
  Companion thử lại; lời nhắc đã trả lời chờ ACK không bị mở lại.
- Log Service có `Break reminder policy`, `Break reminder timer` mỗi phút và
  `Break reminder due` khi đến hạn, giúp phân biệt chưa nhận cấu hình, đang
  tạm dừng và đã tới lúc nhắc. Log không chứa nội dung bàn phím.
- Không cần migration mới; dùng cấu hình và API của migration v29.
- Đạt 192 kiểm thử Agent (19 ca cho nhắc nghỉ). Kiểm thử tích hợp qua Named
  Pipe thật, xác minh phiên Windows thật và cửa sổ native thật đã đạt: với
  đồng hồ mô phỏng 600 giây không thao tác, lời nhắc xuất hiện, nút nhắc lại
  hoạt động và SQLite nhận đúng `shown`, `snoozed`. Không gửi dữ liệu thử lên
  backend. Chạy lại trong phiên Windows mở khóa:

  ```powershell
  .\.venv-edge\Scripts\python.exe -B tests\native_break_reminder_smoke.py
  ```

- Service và Companion 1.0.23 đã qua self-test trên máy build. Chưa cài bản
  sửa lên máy trẻ; cần nâng cấp bộ cài để thay logic của Agent đang chạy.
- Bộ cài `build/output/ChildMonitorSetup-1.0.23.exe` kèm `.exe.sha256` và
  `ChildMonitorSetup-1.0.23.verification.json`: 8 module đóng gói khớp nguồn,
  13 file model giữ nguyên từ 1.0.22, các thư mục dữ liệu runtime trống.
  SHA-256: `2eb722b03b7d7aa7c34122af2b5fcbc4955072f0434d13f7436c044aacf0ce66`.

## Kiểm chứng bản 1.0.22 ngày 12/10/2026

- Đạt 184 kiểm thử Agent, 82 kiểm thử đơn vị backend, 18 kiểm thử tích hợp
  PostgreSQL/Redis và 47 kiểm thử Dashboard.
- Cửa sổ Windows thật đã qua ba phép thử: chọn nghỉ ngay, nhắc lại sau và
  hủy từ cấu hình; kiểm tra đúng sự kiện và cửa sổ đóng được.
- Service/Companion trong bản đóng gói qua self-test, 8 module thay đổi khớp
  bytecode nguồn; 13 file model giữ nguyên so với 1.0.21. Bản phát hành không
  chứa cấu hình thiết bị, secret, log hoặc database của máy build.
- Bộ cài `build/output/ChildMonitorSetup-1.0.22.exe` dài 71.481.116 byte, kèm
  SHA-256 và `ChildMonitorSetup-1.0.22.verification.json`. SHA-256:
  `804f3e11f49f2662e267f881d5f9f4e76e980167674015872c5dab7fedd22451`.
- Migration v29 đã áp dụng cho DB local và DB test. Backend cổng 3000,
  Dashboard cổng 5173 trả HTTP 200; endpoint lịch sử qua proxy trả 401 khi
  không có xác thực.
- Chưa cài trên máy trẻ. Không có trình duyệt kết nối để kiểm tra trực quan
  Dashboard desktop/mobile; kiểm thử renderer và trạng thái dữ liệu đã đạt.
