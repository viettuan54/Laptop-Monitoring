# V13: chế độ quan sát và kiểm thử Agent cục bộ

Cập nhật 2026-10-07. Đã triển khai `TEXT_MODERATION_MODE=shadow`: Agent gửi
câu tìm kiếm qua luồng hiện có, backend lưu kết quả SAFE/RISK/HIGH_RISK,
nhưng **không tạo bản ghi cảnh báo và không gọi push**.

Đã kiểm thử trong môi trường cô lập với lịch sử trình duyệt giả lập, bộ thu
Agent và v13 thật. Chưa bật theo dõi trên máy trẻ hoặc triển khai production.
Model mặc định vẫn v5; v13 giữ `deployment_eligible=false`.

## Phần đã hoàn thành

- API trả `modelSha256` của đúng các byte model đã nạp; thay file sau khi nạp
  không làm API báo nhầm mã băm của model mới.
- Shadow bắt buộc cấu hình tên model và SHA-256. Backend kiểm tra cả hai trên
  từng phản hồi; sai/thiếu pin hoặc lỗi dịch vụ không được ACK thành công.
- Migration v24 thêm `moderation_mode`, `model_sha256`, `batch_inference_ms`
  vào bảng kết quả. Không thêm cột lưu nguyên câu tìm kiếm.
- Lưu đủ ba nhãn, điểm số, model, domain, thời điểm và chế độ xử lý. Điểm số
  chưa được hiệu chỉnh thành xác suất đúng của dự đoán.
- Quyền thu thập, mã hóa hàng đợi DPAPI, ACK/xóa hàng đợi, chống trùng UUID,
  thời hạn lưu và cơ chế tắt thu thập vẫn được áp dụng.
- Bản ghi shadow đã xử lý không tạo cảnh báo khi gửi lại cùng ID sau khi đổi
  sang `alerts`. Bản ghi còn nằm trong hàng đợi được xử lý theo cấu hình server
  tại lúc gửi; vì vậy không đổi sang alerts khi kết thúc đợt quan sát.

`flagged_count=0` trong shadow. `observed_count` đếm bản ghi mới đã lưu của
lần xử lý, không tính bản ghi trùng. `status=flagged` trong database chỉ nói
model dự đoán RISK/HIGH_RISK, không có nghĩa đã cảnh báo phụ huynh.
`batch_inference_ms` là thời gian chờ cả lô, bao gồm kiểm tra quyền và retry;
không dùng nó như thời gian suy luận riêng cho từng câu.

## Kết quả xác minh

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ test AI | 199 đạt, 0 bỏ qua |
| Unit/middleware backend | 72 đạt, 0 bỏ qua |
| Agent: collector, privacy, queue, HTTP client | 45 đạt, 0 bỏ qua |
| Luồng shadow qua HTTP và PostgreSQL thật | 15/15 đạt |
| Hồi quy luồng cảnh báo và trang phụ huynh | 12/12 đạt |
| Shadow: kết quả lưu / cảnh báo / lần gọi push | 6 / 0 / 0 |
| 282 câu phát triển qua API và suy luận trực tiếp | Nhãn và điểm số khớp |

Các ca shadow gồm đọc query từ History tạm, checkpoint chống đọc lại, DPAPI,
mất kết nối Agent–backend và backend–model, sai khóa API, sai tên/hash model,
retry/ACK, gửi trùng, đổi chế độ rồi phát lại ID, sai khóa thiết bị, tắt quyền,
và từ chối nguồn trang/chat. Parent API không trả cảnh báo shadow.

Trong lần shadow đạt: API một câu trung bình **15,37 ms**, P95 **27,86 ms**;
RAM dịch vụ khoảng **53,16 MiB**. Đây là kiểm tra tuần tự cục bộ, chưa đo tải
đồng thời. Named-pipe I/O được thay bằng adapter trong tiến trình; bộ xử lý
message thật vẫn chạy. Không khởi chạy trình duyệt hoặc Windows service đã
cài, không gửi push ra bên ngoài, không đọc lịch sử duyệt web thật.

Báo cáo đầy đủ trong thư mục artifacts được bỏ qua bởi Git:

- `artifacts/school_violence/v13_shadow_20261007_run3/verification_report.json`
- `artifacts/school_violence/v13_alerts_regression_20261007/verification_report.json`

Hai lần thử đầu phát hiện quyền migration và lỗi thiết lập fixture collector;
đã sửa, kết quả nghiệm thu là lần `run3`. Các báo cáo/model đã khóa trước đó
và model v5 đều giữ nguyên mã băm.

Đây là kiểm tra chức năng, **không phải một phép đo độ chính xác độc lập mới**.
Không huấn luyện lại hoặc đổi nhãn dữ liệu trong bước này.

## Chạy lại phép thử cô lập

Từ thư mục `child-monitor-backend`, dùng `.env.test` hiện có:

```powershell
node test/migrateQueryShadow.local.js
```

Script chạy migration v24 (bao gồm loại cảnh báo RISK của v23) trên database loopback có tên chứa `test` từ
`TEST_DB_*`. Tài khoản sở hữu schema lấy từ `TEST_DB_MIGRATION_USER` và
`TEST_DB_MIGRATION_PASSWORD`, hoặc thông tin DB admin trong `.env` cục bộ.
Chỉ dùng lại thông tin đăng nhập; không lấy tên database ứng dụng từ `.env`.
Migration đã được áp dụng vào database test trong lần nghiệm thu này.

Từ thư mục `ai-training`:

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$env:OPENBLAS_NUM_THREADS = '1'
.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate --shadow-lock school_violence/query_v13_candidate.lock.json --output-dir artifacts/school_violence/v13_shadow_local_repeat
```

Chọn thư mục output mới/trống cho mỗi lần chạy. Công cụ tự mở dịch vụ model
loopback, backend test, tạo tài khoản/thiết bị thử, chạy kiểm tra rồi dọn tài
khoản thử và dừng tiến trình. Không sửa `.env` hay thiết bị đã cài.

## Cấu hình cho một môi trường quan sát riêng

Áp dụng migration v24 trước khi chạy backend mới trên môi trường thử.
V24 đã được bổ sung điều kiện v23 (`text_risk`) để nâng cấp từ v22 không bị
thiếu loại cảnh báo. Nếu đã chạy bản v24 cũ, chạy `migration_v23.sql` hoặc
chạy lại v24 hiện tại. Thiếu `text_risk` làm cả lô có nhãn RISK bị rollback,
kể cả khi bật phân tích; không phải cơ chế chống lặp 5 phút.
Thiết lập backend như sau; chế độ này áp dụng cho **toàn bộ backend đó**, nên
dùng backend thử riêng khi chỉ kiểm tra một Agent:

```dotenv
TEXT_MODERATION_PROVIDER=local
TEXT_MODERATION_MODE=shadow
LOCAL_MODERATION_EXPECTED_MODEL=vi-school-violence-recipient-context-v13-query-candidate
LOCAL_MODERATION_EXPECTED_SHA256=380cf3af9bb677446548af64601f5e98be3f0a07092f2458f3500986fcc0497a
LOCAL_MODERATION_URL=http://127.0.0.1:8100
```

`LOCAL_MODERATION_API_KEY` phải khớp `TEXT_SAFETY_API_KEY` của dịch vụ AI.
Chọn `TEXT_SAFETY_MODEL_PATH` từ `artifact_relative_to_ai_training` trong
[lock v13](query_v13_candidate.lock.json), đối chiếu SHA-256 trước khi mở
dịch vụ và kiểm tra `/health` trả đúng `model`/`modelSha256`.
Chạy môi trường thử development/test có kiểm soát; v13 chưa được phép chạy
production và shadow không bỏ qua chốt này.

Agent thử phải trỏ về backend thử, có thiết bị đã ghép đôi và phụ huynh đã
bật thu thập câu tìm kiếm. Chỉ thu các câu phát sinh trong cửa sổ quyền hợp
lệ. Không bật lại quyền tự động. Khi kết thúc, tắt thu thập trên thiết bị
thử và giữ backend ở shadow; không đổi sang alerts để dọn hàng đợi.

Có thể tổng hợp kết quả bằng truy vấn chỉ đọc trên database thử:

```sql
SELECT moderation_model, model_sha256, classification_label, COUNT(*) AS queries
FROM text_moderation_events
WHERE moderation_mode = 'shadow'
GROUP BY moderation_model, model_sha256, classification_label
ORDER BY moderation_model, classification_label;
```

Số lượng nhãn và độ trễ dùng để đánh giá vận hành. Muốn tính bỏ sót/cảnh báo
sai phải đối chiếu với nhãn chuẩn được chốt độc lập; không lấy dự đoán làm
nhãn chuẩn. Bước tiếp theo trên máy Agent thử là nghiệm thu hoạt động qua
trình duyệt/Windows service thực tế, giữ v13 cố định và vẫn chưa bật cảnh báo.
