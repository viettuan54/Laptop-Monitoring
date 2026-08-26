# Text-safety dataset workspace

Thư mục này dành cho dữ liệu huấn luyện/đánh giá kiểm duyệt văn bản. Git mặc định bỏ
qua mọi file trong thư mục, ngoại trừ README và file `*.example.jsonl` tổng hợp không
chứa dữ liệu người dùng.

## Contract

Mỗi dòng JSONL phải hợp lệ theo
`../schema/text_safety_record.schema.json` và chỉ dùng nhãn có trong
`../schema/text_safety_taxonomy.json`.

Nguyên tắc bắt buộc:

- Không chứa tên, email, số điện thoại, username, token, device secret hoặc URL có
  định danh người dùng.
- `conversation_id` và `annotator_ids` phải là mã giả danh.
- Ghi rõ nguồn, giấy phép và phạm vi sử dụng trong `provenance`.
- Không tự động đưa chat thu được từ Agent vào dataset.
- Mẫu self-harm/đe dọa nghiêm trọng phải được ít nhất hai người duyệt trước khi đưa
  vào tập được chấp nhận.
- Các record cùng `conversation_id` phải nằm chung một split để tránh rò rỉ dữ liệu.

## Quy ước gán nhãn

- Gán nhiều nhãn nếu một câu đồng thời chứa nhiều loại rủi ro.
- `self-harm/intent` chỉ dùng khi có dấu hiệu ý định/kế hoạch của người nói; bài báo
  hoặc nội dung phòng chống không mang nhãn này.
- Lời xúi giục một người tự hại dùng `self-harm/instructions`, đồng thời có thể gán
  `harassment/threatening` nếu nhắm trực tiếp vào nạn nhân.
- `harassment` cần có mục tiêu hoặc hành vi làm nhục/loại trừ; không gán chỉ vì một
  từ đứng riêng ngoài ngữ cảnh.
- `violence/inciting` dùng cho lời kêu gọi hành động bạo lực, khác với mô tả tin tức.
- `requires_immediate_alert` là quyết định an toàn cần người duyệt, không suy ra tự
  động chỉ từ nhãn.

## Cấu trúc thư mục local gợi ý

```text
text_safety/
├── raw/          # dữ liệu nguồn được kiểm soát quyền truy cập
├── review/       # hàng đợi gán nhãn/đối soát
├── accepted/     # record đã đạt quy trình duyệt
└── reports/      # báo cáo phân bố, chất lượng và split leakage
```

Không commit bốn thư mục trên. Artifact model cũng tiếp tục được lưu dưới
`ai-training/artifacts/`, vốn đã nằm trong `.gitignore`.
