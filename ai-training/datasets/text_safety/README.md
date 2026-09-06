# Text-safety dataset workspace

Thư mục này dành cho dữ liệu huấn luyện/đánh giá kiểm duyệt văn bản. Git mặc định bỏ
qua mọi file trong thư mục, ngoại trừ README và file `*.example.jsonl` tổng hợp không
chứa dữ liệu người dùng.

## Contract

Mỗi dòng JSONL phải hợp lệ theo
`../schema/text_safety_record.schema.json` và chỉ dùng nhãn có trong
`../schema/text_safety_taxonomy.json`.

Giai đoạn 4 dùng các nguồn ViHSD, UIT-ViCTSD, ViHOS, dữ liệu nội bộ đã ẩn danh
và tập self-harm được xây dựng/kiểm duyệt riêng. Mẫu manifest tại
`sources.manifest.example.json` là checklist intake; không được coi là giấy phép
cho bất kỳ nguồn nào. Chỉ đưa record vào train sau khi đã xác minh giấy phép và
ghi đúng `provenance.source`, `provenance.license`, `provenance.allowed_use`.

Nguyên tắc bắt buộc:

- Không chứa tên, email, số điện thoại, username, token, device secret hoặc URL có
  định danh người dùng.
- `conversation_id`, `subject_id` và `annotator_ids` phải là mã giả danh.
- Mỗi record phải có ít nhất hai `annotator_ids`, `target`, `direction`,
  `severity` và `requires_immediate_alert`. Công cụ import cũng nhận key UI
  `requiresImmediateAlert` rồi chuẩn hóa thành `requires_immediate_alert`.
- Mỗi record phải có `conversation_id` hoặc `subject_id`; pipeline không cho
  phép một nhóm này xuất hiện ở nhiều split.
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

Các mẫu đối chứng về ngữ cảnh phải xuất hiện ở mọi nguồn phù hợp: teencode
(`dm`, `dmm`, `m`, `cl`, `đell`), tách ký tự (`n g u`, `c.h.ế.t`), lặp ký tự,
emoji, Việt–Anh, phủ định và trích dẫn. Ví dụ “tôi không muốn chết” không phải
ý định tự hại; câu báo lại “nó nói tôi ‘hãy chết đi’” phải được reviewer gán theo
hành vi được báo lại, không nhầm thành ý định của người trích dẫn.

Khi chuyển ViHOS, có thể giữ span đã duyệt ở `offensive_spans` (`start`, `end`,
`source_label`) để audit mapping nhãn. Span chỉ là evidence gán nhãn: không được
đưa vào feature huấn luyện vì lúc inference không có span này.

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

## Huấn luyện multi-label

Sau khi các file canonical JSONL đã ở `accepted/`, chạy từ thư mục gốc dự án:

```powershell
Push-Location .\ai-training
python -m text_safety.training `
  --input .\datasets\text_safety\accepted\vihsd.jsonl `
  --input .\datasets\text_safety\accepted\uit_victsd.jsonl `
  --input .\datasets\text_safety\accepted\vhos.jsonl `
  --input .\datasets\text_safety\accepted\internal.jsonl `
  --input .\datasets\text_safety\accepted\self_harm.jsonl `
  --output-dir .\artifacts\text_safety\vi-text-safety-xlm-r-v1
Pop-Location
```

Trước lệnh trên, cài dependency model vào môi trường riêng:

```powershell
python -m pip install -r .\ai-training\text_safety\requirements.txt
python -m pip install -r .\ai-training\text_safety\requirements-training.txt
```

Mặc định pipeline gán lại split 70/15/15 bằng khóa `conversation_id` trước,
hoặc `subject_id` khi không có hội thoại. Dùng `--preserve-splits` chỉ khi split
đã được reviewer chốt; validator vẫn từ chối group bị chia cắt. Để model, dataset
và config có thể audit lại, output chứa `training_manifest.json`,
`training_config.json`, `thresholds.json`, metadata của model và
`evaluation_report.json`.

Báo cáo test có precision/recall/F1 cho từng nhãn, confusion matrix nhị phân cho
từng nhãn, danh sách false positive/false negative chỉ gồm `record_id` và nhãn,
và recall riêng cho `self_harm_intent` cùng các nhãn đe dọa nghiêm trọng. Ngưỡng
được chọn chỉ từ validation; test không được dùng để chỉnh ngưỡng. Artifact chỉ
được đánh dấu `deployment_approved=true` khi vượt toàn bộ gate macro-F1, support
và recall critical đã cấu hình — không dựa vào accuracy.
