# Tiền kiểm bộ câu `DuLieuThat3` trước khi chạy model

Đây là ảnh chụp tiền kiểm trước dự đoán. Kết quả chạy sau đó nằm ở
[`DULIEUTHAT3_V5_V6_V7_EVALUATION.md`](DULIEUTHAT3_V5_V6_V7_EVALUATION.md).

Ngày 2026-10-03. Bản `Mô tả/DuLieuThat3_review.csv` được rà có SHA-256
`a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1`.
File có 81 dòng, 81 ID không trùng, ba cột `id,text,label`; không có câu trống,
câu trùng nhau sau chuẩn hóa hoặc mẫu định danh rõ ràng theo bộ kiểm tra hiện
có. Những kiểm tra tự động này không thay thế việc xác nhận ẩn danh/quyền dùng.
Toàn bộ nhãn hiện hợp lệ: 39 `SAFE`, 33 `RISK`, 9 `HIGH_RISK`. So với lần rà
trước, người cung cấp đã đổi nhãn ID `37` và `77` thành `HIGH_RISK`; không sửa
CSV trong lần này.
Tại thời điểm tiền kiểm chưa chạy dự đoán v5/v6/v7 trên bộ này.

## Tính độc lập cần rà trước khi kiểm thử

- Không có câu trùng chính xác với `DuLieuThat1`, `DuLieuThat2` hoặc các
  split tham chiếu của v7. ID `2`, `6`, `7` đã được thay bằng câu khác.
- So khớp ký tự mức 0,82 trở lên chỉ đánh dấu ID `76` với `DuLieuThat2:4`;
  hai câu hỏi khác chủ đề nên không coi là trùng nghĩa. ID `3` cùng chủ đề
  hoạt động ngoại khóa với một câu cũ nhưng hỏi khía cạnh khác; không coi
  là trùng trực tiếp.

Không thấy câu gần giống mức 0,82 trở lên trong chính bộ mới hoặc với
`DuLieuThat1`. So khớp gần không phát hiện được mọi kiểu trùng ý.

## Câu cần người cung cấp rà nhãn/ngữ cảnh

- ID `14` đã đổi thành `HIGH_RISK` cho lời kể trẻ bị bắt nạt; ID `56` đã nói
  rõ trẻ bị ép làm việc. ID `19`, `20`, `37`, `77` đã được người cung cấp
  viết rõ ngữ cảnh hơn; ID `33` hiện là `SAFE`.
- ID `37` (bị dọa đánh trực tiếp) và `77` (bị ép đưa tài khoản) hiện cùng nhãn
  `HIGH_RISK`, phù hợp quy tắc đe dọa/ép buộc trong hướng dẫn.
- ID `22` nói về bạo lực với động vật, không phải trẻ bị bạo lực. Nếu nhãn
  `RISK` vẫn dùng cho chứng kiến bạo lực ngoài phạm vi trẻ là nạn nhân, cần
  ghi rõ quy tắc để không diễn giải cảnh báo sai.
- ID `50` gán `RISK` cho việc bị bắt đổi chỗ lặp lại, trong khi ID `55` và
  `65` gán `HIGH_RISK` cho các dạng bị buộc làm điều không muốn. Hành vi
  khác mức độ, nên đây chưa chắc là sai nhãn, nhưng quy tắc phân biệt cần
  được xác định trước khi dùng làm thước đo model.
- Riêng ID `55` chỉ nói việc phải xin lỗi thường xuyên, chưa nêu ai ép hoặc
  đe dọa. Nhãn `HIGH_RISK` là cách hiểu theo ngữ cảnh hàm ý, yếu hơn những
  trường hợp mức cao được mô tả trực tiếp. Giữ nhãn người cung cấp đã chốt
  và ghi rõ giới hạn này khi diễn giải phép thử.

Chỉ có 9 câu `HIGH_RISK`, nên một câu bỏ sót sẽ làm recall thay đổi 11,1
điểm phần trăm. Bộ này có thể phát hiện lỗi cụ thể nhưng chưa đủ chắc để
quyết định triển khai hệ thống cảnh báo. Cần thêm câu mới `HIGH_RISK` và
giữ nhãn chốt trước khi xem dự đoán. Việc xác nhận riêng quyền dùng và ẩn danh
của bộ này chưa được người cung cấp trả lời; báo cáo đánh giá ghi rõ giới hạn đó.
