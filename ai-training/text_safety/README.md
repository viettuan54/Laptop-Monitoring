# Service phân loại văn bản ba nhãn

Service local phục vụ model `SAFE`, `RISK`, `HIGH_RISK` đã train trong
`../school_violence/`; xem hướng dẫn train ở `../school_violence/README.md`.

Chạy từ thư mục gốc dự án:

```powershell
$env:TEXT_SAFETY_ENV = "development"
$env:TEXT_SAFETY_API_KEY = "replace-with-a-long-random-secret"
.\.runtime\text-safety-venv\Scripts\python.exe -m uvicorn `
  text_safety.main:app --app-dir .\ai-training --host 127.0.0.1 --port 8100 --no-access-log
```

Mặc định service nạp
`ai-training/artifacts/school_violence/vi-school-violence-char-nb-v2/model.json.gz`.
Có thể đặt `TEXT_SAFETY_MODEL_PATH` tới artifact khác. `GET /health` trả phiên
bản model và label; `POST /v1/moderate` nhận batch tối đa 20 câu với
`X-Local-Moderation-Key` và trả mỗi câu:

```json
{"id":"one","label":"RISK","scores":{"SAFE":0.1,"RISK":0.8,"HIGH_RISK":0.1},"confidence":0.8,"flagged":true,"action":"review"}
```

`sourceType`, `direction`, `context` vẫn được nhận để Agent cũ gửi request
không lỗi, nhưng model ba nhãn hiện chỉ học từ `text`; không dùng các trường
đó làm đặc trưng. Không gọi OpenAI Moderation vì kết quả của dịch vụ đó
không có hợp đồng ba nhãn này.

Response và `/health` đều có `deploymentEligible`; backend production từ chối
response của artifact chưa được phê duyệt, kể cả khi service được khởi động
nhầm trong chế độ development.

Trong `production`, phải đặt API key dài ít nhất 16 ký tự và artifact phải
có `evaluation_report.json` với `deployment_eligible=true`. Artifact hiện tại
không đạt điều kiện này, nên không thể chạy production; cần tập kiểm thử thực
tế độc lập và phê duyệt trước. Không tự bật cảnh báo sản phẩm dựa trên metric
từ dữ liệu tổng hợp.
