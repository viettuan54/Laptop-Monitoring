# Kết quả sửa model sau Dulieu4

**Vòng cải thiện tiếp 2026-10-05:** [ứng viên v10](V10_QUERY_CANDIDATE_STATUS.md)
đã giảm cả hai lỗi mục tiêu trên cùng fold phát triển, qua 88 test và 12
kiểm tra luồng. Artifact v9 giữ nguyên để đối chiếu; v10 cũng chưa triển khai.

Ngày 2026-10-05. Đã phân tích lỗi, học ứng viên v9, so sánh theo nhóm câu và
kiểm tra luồng Agent/API/phụ huynh. V9 sửa được 16/20 lỗi Dulieu4 sau khi học
bộ này, nhưng ID 66 vẫn trả `SAFE` ở 2/5 cách chia ngoài phần học. Ứng viên
đã khóa để đối chiếu, **chưa được triển khai**. Bước kiểm thử thực tế độc lập
của v9 chưa thực hiện vì workspace chưa có bộ mới đáp ứng điều kiện.

## Dữ liệu và nguyên nhân

Giữ đủ 282 câu: 12 sửa nhãn có xác nhận trực tiếp của DuLieuThat1, 99 câu
DuLieuThat2, 81 câu DuLieuThat3 và 90 câu Dulieu4. Nhãn gồm 79 `SAFE`,
108 `RISK`, 95 `HIGH_RISK`. Giữ nguyên toàn bộ nhãn/nội dung và ID 82 là
`RISK`; không thêm mã người duyệt hay `group_id` vào CSV. SHA-256 Dulieu4:
`e504cc10089cc135d19e59fe4d4ea3407abb7de028d68d9031899c71023f7587`.
Dulieu4 trở thành dữ liệu phát triển của v9 từ vòng này. Lịch sử sửa nhãn
trước đó nằm trong [báo cáo v8](DULIEU4_V8_EVALUATION.md).

V8 bỏ từ/cặp từ xuất hiện một lần (`min_df=2`). ID 66 có 17/38 đặc trưng đã
học, ID 83 có 18/39, ID 90 có 20/48. Cụm “bóp cổ”, “đe dọa” có một mẫu trong
dữ liệu cũ nhưng bị loại; các cụm nguy hiểm khác chưa xuất hiện. Từ chung về
học sinh/lớp học/hỏi cách xử lý vẫn ảnh hưởng dự đoán. Không thêm quy tắc
gắn nhãn theo ID hoặc chép câu tìm kiếm vào mã. Báo cáo chẩn đoán chỉ lưu ID
và số đặc trưng. Các nhãn người dùng giữ nguyên, không đổi theo dự đoán.

## Thử cấu hình và chọn v9

[Kế hoạch thử](V9_EXPERIMENT_PLAN.md) được lưu và kiểm tra checksum trước
khi chấm v9: sáu cấu hình giữ từ hiếm, bổ sung chuỗi ký tự và trọng số SAFE;
không thử thêm ngưỡng. Năm seed `20261002`–`20261006`, mỗi seed có 5 fold
ngoài; mỗi fold ngoài chọn cấu hình bằng 5 fold trong của riêng phần học.
Từ vựng, IDF và trọng số không học từ câu giữ ngoài fold. Các câu tương tự
ký tự từ 0,85 cùng fold: 282 câu thành 278 nhóm. Nhóm này không chứng minh
độc lập theo trẻ/phiên hoặc gần nghĩa.

So công thức v8 học lại trên **cùng phần dữ liệu** với quy trình chọn cấu hình:

| Trung bình trên 282 câu, 5 seed | Công thức v8, dữ liệu mở rộng | Chọn cấu hình trong fold |
| --- | ---: | ---: |
| Macro-F1 | 0,77098 | 0,76881 |
| HIGH_RISK nhận đúng /95 | 91,8 | 91,8 |
| HIGH_RISK về SAFE /95 | 0,4 | 0,4 |
| SAFE bị cảnh báo /79 | 13,6 | 14,0 |
| RISK lên HIGH_RISK /108 | 43,6 | 43,8 |
| RISK về SAFE /108 | 5,4 | 5,4 |

Quy trình chọn cấu hình không đạt điều kiện đã chốt. **V9 giữ công thức v8
và học thêm đủ 90 câu**: TF-IDF từ/cặp từ, min_df=2, trọng số SAFE/RISK/HIGH_RISK
=1,5/1/3, L2=0,001, 200 lượt tối ưu, argmax. Không chọn biến thể ký tự/từ
hiếm và không tiếp tục tìm cấu hình theo điểm ngoài fold.

Audit giải thích riêng, sau lựa chọn, giữ cùng 25 fold ngoài và cùng công
thức, chỉ thay việc có/không thêm Dulieu4 vào phần học:

| Trung bình trên 282 câu | Học phần dữ liệu cũ | Học phần dữ liệu mở rộng |
| --- | ---: | ---: |
| Macro-F1 | 0,75941 | 0,77098 |
| HIGH_RISK nhận đúng /95 | 85,6 | 91,8 |
| HIGH_RISK về SAFE /95 | 2,2 | 0,4 |
| SAFE bị cảnh báo /79 | 17,6 | 13,6 |
| RISK lên HIGH_RISK /108 | 37,6 | 43,6 |
| RISK về SAFE /108 | 4,8 | 5,4 |

Thêm dữ liệu cải thiện mức cao và cảnh báo SAFE, nhưng tăng hai loại lỗi ở
RISK. Audit này không dùng để chọn cấu hình hoặc phê duyệt triển khai. Cột
dữ liệu cũ học lại sau khi bỏ câu giữ ngoài fold, không phải artifact v8 đã
khóa. Các lượt lặp dùng cùng bộ câu, không phải 1.410 mẫu độc lập.

## Các lỗi cũ được xử lý đến đâu

V8 trước khi học Dulieu4 đúng 70/90. V9 **sau khi học Dulieu4** đúng 86/90:
SAFE 30/30, RISK 27/31, HIGH_RISK 29/29. Đây là điểm trên dữ liệu huấn luyện,
không phải độ chính xác trên câu mới. Không có câu trước đây đúng thành sai.

Đã sửa 16/20 lỗi cũ; bốn lỗi còn lại đều là `RISK` bị trả `HIGH_RISK`:

| ID Dulieu4 | Nhãn người dùng | V9 sau học |
| --- | --- | --- |
| 32 | RISK | HIGH_RISK |
| 35 | RISK | HIGH_RISK |
| 50 | RISK | HIGH_RISK |
| 57 | RISK | HIGH_RISK |

Riêng phần Dulieu4 giữ ngoài học, trung bình năm seed đúng 74,8/90 (83,11%),
macro-F1 0,83108, mức cao đúng 28,6/29; SAFE bị cảnh báo 3,6/30 và RISK lên
mức cao 10,8/31. Số thập phân là trung bình trên cùng bộ câu.

| ID HIGH_RISK ưu tiên | 20261002 | 20261003 | 20261004 | 20261005 | 20261006 |
| --- | --- | --- | --- | --- | --- |
| 66 | HIGH_RISK | SAFE | HIGH_RISK | SAFE | HIGH_RISK |
| 83 | HIGH_RISK | HIGH_RISK | HIGH_RISK | HIGH_RISK | HIGH_RISK |
| 90 | HIGH_RISK | HIGH_RISK | HIGH_RISK | HIGH_RISK | HIGH_RISK |

**ID 66 chưa được giải quyết ổn định khi không nằm trong phần học**. Trong
corpus cũ cụm tương ứng chỉ có một mẫu; khi bỏ ID 66 khỏi học, min_df=2 lại
có thể loại cụm hiếm. Artifact cuối nhận đúng ID 66 không xóa giới hạn này.
ID 83/90 ổn định hơn trong các cách chia đã thử.

Kiểm tra tổng hợp lịch sử chỉ là hồi quy: macro-F1 validation/test v8 là
0,36721/0,38770, v9 là 0,45387/0,48698. V9 vẫn nhận RISK kém trên bộ tổng
hợp; mức cải thiện này không đủ để phê duyệt triển khai.

## Kiểm tra Agent/API/phụ huynh

Đúng artifact v9 khởi động trên HTTP loopback. CLI/engine/API khớp nhãn và
điểm trên cả 282 câu, yêu cầu đơn và batch tối đa 20. `/health` trả đúng
model, thuật toán và `deploymentEligible=false`. Khóa API sai, validation
không phản chiếu query và từ chối model chưa duyệt trong production đều đạt.

12 kiểm tra luồng đạt, dùng APIClient/OfflineQueue thật, DPAPI Windows,
Express, PostgreSQL riêng `child_monitor_test`, RLS và API phụ huynh thật.
Đã thử gửi lại khi provider sai khóa/mất kết nối, xóa queue sau xác nhận,
không tạo sự kiện trùng/khoảng chờ cảnh báo, secret sai và phụ huynh tắt chức
năng. Backend vẫn từ chối page/chat.

| Nhãn | Kết quả |
| --- | --- |
| SAFE | Không tạo cảnh báo |
| RISK | Cần quan sát bé trong thời gian này |
| HIGH_RISK | Bé có dấu hiệu bị bạo lực |

Hàm dựng danh sách cảnh báo thật của `child-monitor-web/app.js` được thực
thi bằng Node VM với dữ liệu từ API phụ huynh thật. Hiển thị đúng hai thông
điệp và lớp màu warning/danger; RLS ngăn phụ huynh khác đọc cảnh báo. Test web
bổ sung escape nội dung và danh sách rỗng. Chưa kiểm tra bố cục/thao tác trong
trình duyệt. Push ghi nhận cục bộ, MemoryStore test thay Redis; tài khoản và
thiết bị kiểm thử được xóa sau chạy.

Đo tuần tự cục bộ: suy luận trung bình 0,067 ms/câu, P95 0,091 ms; API trung
bình 8,58 ms, P95 25,82 ms; RAM tiến trình API 52,96 MiB. Chưa đo tải nhiều
người dùng.

113 test đạt, không bỏ qua: AI 41, Agent 33, backend 20, web 19. Ngoài ra,
12 kiểm tra luồng đạt. Đã kiểm tra loại câu giữ ngoài học/chọn cấu hình trong
cả 25 fold ngoài; nhãn/nội dung, checksum nguồn, v8 và model mặc định v5 giữ nguyên.

## Khóa ứng viên và bước còn lại

[File khóa v9](query_v9_candidate.lock.json) ghi checksum model và báo cáo.
Artifact ngoài Git:
`ai-training/artifacts/school_violence/v9_dulieu4_development_20261005/vi-school-violence-linear-v9-reviewed-query-candidate/model.json.gz`.
SHA-256: `04c966f9d7ccaa65577e3917e64c1986afe4e1fa379cc30b3c142fae67454760`.

Service mặc định vẫn v5. V9 là ứng viên phát triển đã khóa; chưa đủ cơ sở bật
cảnh báo thật. Tăng nhận diện mức cao đi kèm tăng lỗi RISK và ID 66 còn dao
động. `deployment_eligible=false` trong model và mọi báo cáo.

Workspace có DuLieuThat1/2/3 và Dulieu4 đã tham gia phát triển hoặc xem dự
đoán, chưa có nguồn thực tế mới đáp ứng đánh giá độc lập. Công cụ
`evaluate_real_world.py` đã từ chối dùng lại holdout Dulieu4 cho v9 vì trùng
ID/text dữ liệu học. **Bước 5 chưa hoàn tất**. Không dùng câu giả hoặc điểm
học làm điểm cuối. Tiêu chí số để triển khai cần chốt trước khi xem kết quả
một bộ thực tế độc lập; tiêu chí thử ở vòng này chỉ chọn ứng viên phát triển.

Báo cáo cục bộ trong `ai-training/artifacts/school_violence/`:

- `v9_dulieu4_development_20261005/evaluation_report.json`: fold, lựa chọn,
  ID sai, học lại và hồi quy.
- `v9_dulieu4_development_20261005/paired_data_update_audit.json`: audit thêm dữ liệu.
- `v9_dulieu4_development_20261005/quality_verification.json`: test và checksum mã.
- `v9_runtime_acceptance_20261005/verification_report.json`: API/Agent/DB/web renderer.

Mọi câu thô/từ vựng model chỉ nằm trong artifact cục bộ bị Git bỏ qua.

## Tái lập

Từ `ai-training`, chọn output mới hoặc rỗng, nguồn phải đúng checksum và có
môi trường/database kiểm thử như lượt xác minh v8:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -B -m school_violence.adapt_reviewed_queries_v9 `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --v8-artifact .\artifacts\school_violence\vi-school-violence-word-linear-v8-query-candidate `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --dulieu4 '..\Mô tả\Dulieu4.csv' `
  --output-dir .\artifacts\school_violence\v9_recheck --authorized

.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v9_recheck\evaluation_report.json `
  --output-dir .\artifacts\school_violence\v9_flow_recheck

.\.venv\Scripts\python.exe -B -m school_violence.compare_query_data_update `
  --selection-report .\artifacts\school_violence\v9_recheck\evaluation_report.json `
  --output .\artifacts\school_violence\v9_recheck\paired_data_update_audit.json
```
