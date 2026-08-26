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

## Chạy test

```powershell
.\.runtime\text-safety-venv\Scripts\python.exe -m unittest discover `
  -s .\ai-training\tests `
  -p "test_text_safety*.py" `
  -v
```
