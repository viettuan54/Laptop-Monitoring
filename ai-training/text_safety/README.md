# Local Text Safety Service

Service nội bộ phân tích văn bản tiếng Việt mà không gửi dữ liệu tới OpenAI. Bản hiện
tại là baseline `vi-context-rules-v1`; xem quyết định thiết kế và giới hạn trong
`DESIGN.md`.

## Cài đặt

Tạo môi trường riêng để không ảnh hưởng các dependency MediaPipe hiện có:

```powershell
python -m venv .\.runtime\text-safety-venv
.\.runtime\text-safety-venv\Scripts\python.exe -m pip install `
  -r .\ai-training\text_safety\requirements.txt
```

## Chạy local

```powershell
$env:TEXT_SAFETY_ENV = "development"
$env:TEXT_SAFETY_API_KEY = "replace-with-a-long-random-secret"
.\.runtime\text-safety-venv\Scripts\python.exe -m uvicorn `
  text_safety.main:app `
  --app-dir .\ai-training `
  --host 127.0.0.1 `
  --port 8100 `
  --no-access-log
```

Kiểm tra:

```powershell
Invoke-RestMethod http://127.0.0.1:8100/health
```

## Kết nối Backend

Trong `child-monitor-backend/.env`, chọn provider local và dùng cùng shared secret
đã đặt ở `TEXT_SAFETY_API_KEY`:

```env
TEXT_MODERATION_PROVIDER=local
LOCAL_MODERATION_URL=http://127.0.0.1:8100
LOCAL_MODERATION_API_KEY=replace-with-the-same-long-random-secret
LOCAL_MODERATION_TIMEOUT_MS=15000
```

Backend chỉ gọi OpenAI khi cấu hình rõ `TEXT_MODERATION_PROVIDER=openai`; không có
fallback ngầm từ local sang dịch vụ bên ngoài.

Moderate một batch:

```powershell
$headers = @{ "X-Local-Moderation-Key" = $env:TEXT_SAFETY_API_KEY }
$body = @{
  items = @(
    @{
      id = "demo-1"
      text = "Nội dung cần kiểm tra"
      sourceType = "search_query"
      direction = "unknown"
      context = @()
    }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8100/v1/moderate `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `TEXT_SAFETY_ENV` | `development` | `production` bắt buộc phải có API key |
| `TEXT_SAFETY_API_KEY` | rỗng | Shared secret cho Backend gọi service |
| `TEXT_SAFETY_MODEL_VERSION` | `vi-context-rules-v1` | Version được trả trong response |

Không chạy Uvicorn với `--reload` trong production và không bind `0.0.0.0` nếu service
không nằm sau private network/firewall.

## Huấn luyện encoder multi-label (giai đoạn 4)

Pipeline huấn luyện nằm trong `text_safety.training`. Nó dùng XLM-R base đa ngôn
ngữ đã pin revision trong `text_safety_training_config.json`; model card công bố
giấy phép MIT. Đây là default phù hợp để đánh giá dữ liệu nội bộ, còn từng dataset
vẫn bắt buộc được kiểm tra license/provenance riêng trước khi được phép train.

Xem contract, hướng dẫn gán nhãn và lệnh train ở
`../datasets/text_safety/README.md`. Pipeline chưa tự động thay baseline runtime:
chỉ artifact đạt deployment gate mới là ứng viên cho bước tích hợp/inference tiếp
theo. `--validate-only` kiểm tra tính hợp lệ, leakage và phân bố nhãn trước khi
tải encoder. Model dùng cùng định dạng đầu vào với API moderation thông qua
`format_model_input(text, source_type, direction, context)`.

## Chạy test

```powershell
.\.runtime\text-safety-venv\Scripts\python.exe -m unittest discover `
  -s .\ai-training\tests `
  -p "test_text_safety*.py" `
  -v
```
