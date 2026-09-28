# Tiền kiểm nhãn cho bộ dữ liệu v2.2

`review_queue.jsonl` là hàng đợi để **một người** đọc và quyết định nhãn.
Nó không phải tập nhãn được phê duyệt; `audit_report.json` lưu số liệu kiểm tra,
SHA-256 hai CSV nguồn và giới hạn của phép kiểm tự động. Không sửa CSV v2.2.

| Ưu tiên | Mẫu | Việc cần làm |
| --- | ---: | --- |
| 1 | 100 | Query ngắn/mơ hồ: phân biệt tìm hướng dẫn với tự cầu cứu hoặc báo đe dọa thật. |
| 2 | 393 | Câu phủ định: kiểm tra ngữ cảnh tai nạn vô ý (`SAFE`) hoặc vẫn đang nói về bạo lực (`RISK`). |
| 3 | 51 | Mẫu đối chứng theo nhãn, trích dẫn, ngữ cảnh bài viết và tập dữ liệu. |

Trong 100 query đầu: 31 có dấu hiệu hỏi cách xử lý/cầu cứu cần ưu tiên đọc kỹ;
8 câu hỏi khái niệm; 11 câu nhắc đe dọa nhưng không rõ đích nhắm; 50 mảnh
ngắn khác. Ví dụ `Q_002005` “bị bắt nạt phải làm sao” chưa chứng minh người
tìm kiếm là nạn nhân. `Q_002059` “bị lấy đồ trên mạng” thiếu ngữ cảnh về vật
thật hay tài sản số. Không tự đổi sang `HIGH_RISK` hoặc `SAFE` chỉ từ các cụm này.

Phép kiểm tự động đối chiếu 211 câu phủ định gán `RISK` và 182 câu mô tả
ngã/va chạm vô ý gán `SAFE` với hướng dẫn hiện có; không phát hiện lệch khuôn
trong hai nhóm. Trích dẫn của bài giáo dục được phân biệt với lời đe dọa thật
trong lời kể cá nhân. Metadata `contains_quote`/`quote_type` khớp nội dung trên
bộ đang kiểm tra. Đây **không** phải xác nhận mọi nhãn đúng ngữ nghĩa.

## Cách ghi quyết định thực tế

Người đánh giá đọc câu `text`, thêm `text_normalized` và trang đầy đủ khi cần.
Nếu thiếu ngữ cảnh, giữ mẫu `unreviewed`; có thể ghi chú ngoài file quyết định
hoặc loại khỏi lần train/đánh giá tiếp theo sau khi thống nhất quy trình.
Đừng lấy `review_queue.jsonl` làm file quyết định: những dòng đó chứa câu hỏi
cho người đánh giá, không chứa nhãn đã được con người xác nhận.

Tạo file JSONL quyết định riêng, **chỉ** chứa các ID đã xem và đúng ba trường:

```json
{"id":"Q_002005","label":"RISK","annotator_id":"reviewer-001"}
```

Ví dụ này chỉ minh họa cú pháp; nhãn ví dụ không phải quyết định cho ID đó.
Sau khi thực sự có quyết định, chạy từ `ai-training`:

```powershell
.\.venv\Scripts\python.exe -B -m text_safety.review `
  --input '..\Mô tả\laptopmonitoring_query_dataset_v2_2.csv' `
  --decisions '<file_quyết_định_thực_tế.jsonl>' `
  --output '..\Mô tả\laptopmonitoring_query_dataset_v2_3.csv' `
  --dataset-version v2.3
```

Chỉ mẫu trong file quyết định mới chuyển thành `reviewed`. Mẫu khác giữ
`unreviewed`. Không cần hai người đánh giá. Công cụ từ chối thay đổi gây xung
đột nhãn giữa các biến thể văn bản tương đương; khi đó hãy duyệt toàn bộ các
biến thể có liên quan trước. Cuối cùng kiểm tra bộ query mới cùng bộ webpage
bằng `school_violence.training --validate-only`. Nếu chỉ webpage được duyệt,
chạy lệnh tương tự với file webpage và version mới.
