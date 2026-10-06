# Service phân loại văn bản ba nhãn

Service local phục vụ model `SAFE`, `RISK`, `HIGH_RISK` đã train trong
`../school_violence/`; xem hướng dẫn train ở `../school_violence/README.md`.

[Kiểm tra API ngày 2026-10-04](API_TEST_STATUS_20261004.md) đã chạy đủ ba test
trước đây thiếu thư viện; toàn bộ 131 test hiện đều đạt trong môi trường `.venv`.

Lượt [hoàn thiện v8 và kiểm tra luồng thật](../school_violence/V8_ROLLOUT_READINESS.md)
tiếp theo đã đạt 137 test AI/service và 11 kiểm tra Agent tới API phụ huynh.
`/health.engine` trả thuật toán của artifact đang nạp, gồm TF-IDF/tuyến tính
của v8. V8 được khóa để kiểm thử độc lập; model mặc định vẫn là v5.

Chạy từ thư mục gốc dự án:

```powershell
$env:TEXT_SAFETY_ENV = "development"
$env:TEXT_SAFETY_API_KEY = "replace-with-a-long-random-secret"
.\.runtime\text-safety-venv\Scripts\python.exe -m uvicorn `
  text_safety.main:app --app-dir .\ai-training --host 127.0.0.1 --port 8100 --no-access-log
```

Mặc định service nạp
`ai-training/artifacts/school_violence/vi-school-violence-char-nb-v5-query/model.json.gz`.
Artifact này tạo từ 5.594 câu tìm kiếm v2.4 sau khi loại 393 câu phủ định
và 13 câu ngắn mơ hồ; xem `Mô tả/DATASET_QUERY_V2_4_README.md` để tái lập.
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

Luồng sản phẩm hiện chỉ nhận `search_query` từ Agent, chưa đọc nội dung trang.
Backend ánh xạ `SAFE` thành không cảnh báo; `RISK` (`action=review`) thành
“Cần quan sát bé trong thời gian này”; `HIGH_RISK` (`action=alert`) thành
“Bé có dấu hiệu bị bạo lực”. Cần migration backend v23 cho loại cảnh báo `text_risk`.
V5-query vẫn là baseline tổng hợp; 13 câu được loại khỏi test sau khi người dùng
xác nhận dự đoán `HIGH_RISK` đúng, khác nhãn `RISK` cũ. Trọng số model không
đổi và điểm test v5 không độc lập. File quyết định nhãn chỉ cần `id,label`.

Response và `/health` đều có `deploymentEligible`; backend production từ chối
response của artifact chưa được phê duyệt, kể cả khi service được khởi động
nhầm trong chế độ development.

Trong `production`, phải đặt API key dài ít nhất 16 ký tự và artifact phải
có `evaluation_report.json` với `deployment_eligible=true`. Artifact hiện tại
không đạt điều kiện này, nên không thể chạy production; cần tập kiểm thử thực
tế độc lập và phê duyệt trước. Không tự bật cảnh báo sản phẩm dựa trên metric
từ dữ liệu tổng hợp.
