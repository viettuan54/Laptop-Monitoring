# Thiết kế phân tích an toàn văn bản

## Phạm vi giai đoạn 1–2

Local Moderation Service nhận tối đa 20 đoạn văn bản mỗi request, phân tích tại máy
chủ của dự án và trả về kết quả chuẩn hóa để Backend lưu vào
`text_moderation_events`. Service không ghi nội dung gốc xuống đĩa và không phụ thuộc
OpenAI.

Bản đầu dùng engine `vi-context-rules-v1`. Đây là baseline luật-ngữ-cảnh để kiểm tra
kiến trúc, quyền riêng tư và luồng cảnh báo; điểm số của nó là heuristic, không phải
xác suất đã được hiệu chỉnh. Nó không được coi là model production hoặc công cụ chẩn
đoán. Engine PhoBERT/ONNX sẽ thay thế hoặc kết hợp với baseline sau khi có dataset đã
được duyệt và báo cáo đánh giá.

## Taxonomy

Nguồn chuẩn là `datasets/schema/text_safety_taxonomy.json`. Các nhãn chi tiết được
gom vào ba nhóm tương thích `migration_v21.sql`:

| Nhóm lưu DB | Nhãn chi tiết |
| --- | --- |
| `self_harm` | `self-harm`, `self-harm/intent`, `self-harm/instructions` |
| `harassment` | `harassment`, `harassment/threatening`, `hate`, `hate/threatening` |
| `violence` | `violence`, `violence/inciting`, `violence/graphic` |

Mức độ theo thứ tự `low < medium < high < critical`. Kết quả có ba hành động:

- `allow`: không có tín hiệu đạt ngưỡng.
- `review`: tín hiệu yếu hoặc cần thêm ngữ cảnh, chưa gửi cảnh báo khẩn cấp.
- `alert`: tín hiệu high/critical đạt ngưỡng và được phép tạo cảnh báo phụ huynh.

Backend hiện tại chỉ lưu `safe/flagged`; khi tích hợp, `alert` ánh xạ thành `flagged`,
còn `allow/review` chưa tạo push. Việc lưu riêng review sẽ được cân nhắc ở migration
sau, không sửa migration v21 đã chạy.

## API contract

`POST /v1/moderate` nhận JSON:

```json
{
  "items": [
    {
      "id": "event-123",
      "text": "Nội dung cần kiểm tra",
      "sourceType": "chat_received",
      "direction": "received",
      "context": ["Tối đa năm câu gần nhất"]
    }
  ]
}
```

Response:

```json
{
  "provider": "local",
  "model": "vi-context-rules-v1",
  "taxonomyVersion": "1.0.0",
  "results": [
    {
      "id": "event-123",
      "flagged": true,
      "action": "alert",
      "riskType": "harassment",
      "severity": "critical",
      "primaryCategory": "harassment/threatening",
      "confidence": 0.93,
      "categoryScores": {},
      "matchedSignals": ["targeted_threat"]
    }
  ]
}
```

`matchedSignals` chỉ chứa mã quy tắc, không chứa đoạn văn bản khớp. Backend không cần
lưu trường này trong giai đoạn MVP.

Giới hạn contract:

- 1–20 items/request.
- `text`: 1–4000 ký tự.
- Tối đa 5 context items, mỗi item tối đa 1000 ký tự.
- Chỉ chấp nhận bốn `sourceType` trong taxonomy.
- Field lạ bị từ chối.

## Phân tích theo ngữ cảnh baseline

Engine chuẩn hóa Unicode, chữ hoa/thường, một số teencode và cách chèn dấu để né bộ
lọc. Một tín hiệu chỉ tăng điểm khi xuất hiện trong mẫu câu có chủ thể/hành động, thay
vì chặn mọi văn bản chứa một từ riêng lẻ.

Điểm được điều chỉnh bởi:

- Ngôi thứ nhất kết hợp ý định tự hại.
- Mệnh lệnh hoặc đe dọa nhắm vào ngôi thứ hai.
- Tin nhắn trẻ nhận hoặc soạn.
- Tín hiệu lặp lại trong các câu context.
- Ngữ cảnh báo chí, giáo dục, phòng chống hoặc trích dẫn.
- Cụm bảo vệ rõ ràng như phủ nhận ý định tự hại.

Luật khẩn cấp không được dùng để tự động kết luận hoặc xử phạt trẻ. Nó chỉ là mạng
an toàn tăng recall trong lúc chưa có model đã được đánh giá.

## Quyền riêng tư và bảo mật

- Service xử lý hoàn toàn trong bộ nhớ, không có database và không ghi raw text.
- Lỗi validation không phản hồi lại raw input.
- Chạy mặc định trên `127.0.0.1`, không expose trực tiếp ra Internet.
- `TEXT_SAFETY_API_KEY` bảo vệ endpoint; production từ chối khởi động nếu thiếu key.
- Log chỉ được chứa request ID, số lượng item, thời gian và mã lỗi.
- Backend tiếp tục chỉ lưu metadata theo migration v21.
- Dataset huấn luyện phải ẩn danh và tuân theo
  `text_safety_record.schema.json`; không đưa chat thật vào Git.

## Dataset và chia tập

- Mỗi record phải có provenance và quyền sử dụng rõ ràng.
- Tối thiểu hai người duyệt đối với mẫu self-harm hoặc đe dọa nghiêm trọng.
- Tách train/validation/test theo `conversation_id`, không tách các câu trong cùng hội
  thoại sang nhiều tập.
- Dataset research-only không được đưa vào artifact thương mại khi chưa có quyền.
- Không dùng dữ liệu cảnh báo của người dùng để train tự động.

## Acceptance criteria giai đoạn 2

- Service chạy khi không có `OPENAI_API_KEY`.
- `/health` và `/model-info` không tiết lộ nội dung người dùng.
- Batch giữ nguyên thứ tự và ID của input.
- Câu trực tiếp nguy hiểm được phát hiện; câu báo chí/phòng chống không bị đánh đồng
  với ý định trực tiếp trong các test baseline.
- Input vượt giới hạn hoặc field lạ bị trả 422 mà không echo raw text.
- Unit test không cần tải model hoặc truy cập Internet.

## Ngoài phạm vi hiện tại

- Tải và fine-tune PhoBERT/XLM-R.
- Hiệu chỉnh ngưỡng trên validation set thật.
- Tích hợp provider local vào Node Backend.
- Realtime blocking hoặc tự động can thiệp khẩn cấp.
