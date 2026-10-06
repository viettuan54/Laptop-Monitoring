# Giảm bỏ sót và cảnh báo sai sau v9

Ngày 2026-10-05. Đã chọn ứng viên v10 có đặc trưng ngữ cảnh sau một vòng thử
có giới hạn. Trên đúng các fold phát triển của v9, quy trình chọn v10 giảm
cả `HIGH_RISK → SAFE` và `RISK → HIGH_RISK`, đồng thời không làm xấu các chỉ
số tổng thể đã chốt. V10 được khóa làm ứng viên phát triển, chưa triển khai.

## Thay đổi

Giữ đủ 282 câu và toàn bộ nhãn/nội dung người dùng đã xác nhận: SAFE 79,
RISK 108, HIGH_RISK 95. ID 82 vẫn có nhãn RISK. Không thêm dữ liệu tự tạo,
đổi nhãn theo dự đoán hoặc loại câu sai khỏi kết quả. Nguồn, provenance và
artifact v9 khớp checksum trong [file khóa v9](query_v9_candidate.lock.json).
Dulieu4 tiếp tục là dữ liệu phát triển, không phải test độc lập của v10.

V10 bổ sung đặc trưng mô tả vai trò và hành vi: câu nhắc đến bản thân, bị tác
động, chứng kiến, tìm hiểu chung, hành vi thể chất, đe dọa, ép tiền, áp lực,
trêu chọc, cô lập, tiết lộ, lặp lại và khẩn cấp. Có các đặc trưng kết hợp giữa
vai trò/ngữ cảnh và hành vi. Những đặc trưng này là đầu vào cho mô hình học;
không từ/cụm nào tự gắn nhãn và không có tra cứu theo ID hoặc nguyên câu.
Trọng số vẫn được học từ các nhãn đã xác nhận, chỉ dùng phần học trong fold.

[Kế hoạch thử](V10_EXPERIMENT_PLAN.md) chốt trước kết quả: tám phương án,
gồm bộ ba nhãn có ngữ cảnh và kiến trúc HIGH_RISK trước rồi SAFE/RISK. Không
thử lại sáu cấu hình v9 hoặc chọn thêm ngưỡng sau khi nhìn điểm ngoài fold.

## So sánh trên cùng cách chia

Dùng đúng 25 fold ngoài trong báo cáo v9 đã khóa, 5 seed x 5 fold. Trong từng
fold ngoài, chọn cấu hình bằng 5 fold trong của riêng phần học. Từ vựng, IDF,
trọng số và chọn ngưỡng không dùng câu giữ ngoài fold. V9 được học lại trên
cùng phần dữ liệu làm đối chứng; ma trận đối chứng khớp báo cáo v9 ở cả 5 seed.

| Trung bình mỗi lượt trên 282 câu | V9 | Quy trình chọn v10 |
| --- | ---: | ---: |
| Macro-F1 | 0,77098 | 0,80647 |
| HIGH_RISK nhận đúng /95 | 91,8 | 92,0 |
| HIGH_RISK về SAFE /95 | 0,4 | 0,2 |
| SAFE bị cảnh báo /79 | 13,6 | 12,2 |
| RISK lên HIGH_RISK /108 | 43,6 | 36,2 |
| RISK về SAFE /108 | 5,4 | 4,6 |

Quy trình đạt tiêu chí phát triển đã chốt: giảm cả hai lỗi mục tiêu, không
giảm số mức cao nhận đúng, không tăng hai loại cảnh báo nhầm/RISK về SAFE
hoặc giảm macro-F1. Chưa có cơ sở diễn giải những thay đổi nhỏ ở mức cao là
bằng chứng ổn định trên người dùng thật; năm lượt lặp dùng lại cùng dữ liệu.

| Seed | V9 macro-F1 | V10 macro-F1 | V9 HIGH→SAFE | V10 HIGH→SAFE | V9 RISK→HIGH | V10 RISK→HIGH |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261002 | 0,78354 | 0,80319 | 0 | 0 | 42 | 40 |
| 20261003 | 0,78206 | 0,78585 | 1 | 1 | 40 | 39 |
| 20261004 | 0,77943 | 0,82882 | 0 | 0 | 44 | 34 |
| 20261005 | 0,76641 | 0,80256 | 1 | 0 | 46 | 37 |
| 20261006 | 0,74345 | 0,81192 | 0 | 0 | 46 | 31 |

Trong 25 fold: 10 giữ v9, 3 chọn bộ ba nhãn ngữ cảnh trọng số HIGH=2,
12 chọn bộ ba nhãn ngữ cảnh HIGH=3. Phương án nhận diện HIGH trước không
được chọn vì giảm cảnh báo sai đi kèm bỏ sót mức cao nhiều hơn.

Sau khi quy trình đạt, chọn cấu hình cuối bằng cùng CV trong fold trên 282
câu với seed 20261007. Kết quả: **flat_context_high3**, TF-IDF từ/cặp từ
min_df=1, đặc trưng ngữ cảnh hệ số 2, SAFE/RISK/HIGH=1,5/1/3, L2=0,001,
200 lượt tối ưu, chọn nhãn argmax. Giữ đúng hợp đồng ba nhãn/điểm/flag/action.

Các thử nghiệm HIGH-first là đối chứng offline và không được triển khai.
Điểm điều kiện cùng ngưỡng của chúng có thể chọn nhãn khác argmax; hợp đồng
backend hiện yêu cầu argmax. V10 được chọn là bộ ba nhãn argmax, đã qua
kiểm tra backend thật, không cần nới kiểm tra tính nhất quán của backend.

## Các giới hạn và lỗi còn lại

Kết quả ngoài fold của **quy trình chọn** đối với ID 66 thay đổi từ 3/5 đúng
ở v9 thành 4/5 đúng; còn một lượt giữ v9 và trả SAFE. ID 83 và 90 đều đúng
HIGH_RISK ở 5/5 lượt. ID 32 giảm sai từ 4/5 xuống 2/5; ID 50 giảm từ 5/5
xuống 1/5. ID 35 và 57 vẫn sai mức cao ở cả năm lượt.

Audit bổ sung giữ cố định cấu hình cuối `flat_context_high3` trên cùng 25
fold cho HIGH→SAFE=0, HIGH đúng trung bình 92,8/95 và RISK→HIGH=36,0/108;
ID 66/83/90 đúng cả năm cách chia. **Đây là audit sau chọn cấu hình trên toàn
bộ dữ liệu**, không dùng chọn lại model và không thay điểm quy trình chọn
trong bảng chính. Không gọi audit này là kiểm thử độc lập.

Riêng Dulieu4 ngoài fold: RISK lên HIGH giảm từ 10,8 xuống 7,6/31 và HIGH về
SAFE giảm 0,4 xuống 0,2/29, nhưng SAFE bị cảnh báo tăng từ 3,6 lên 3,8/30.
Điều kiện chọn đã chốt kiểm tra toàn bộ 282 câu, không bảo đảm từng nguồn
đều cải thiện. Cần giữ riêng chỉ số này khi đánh giá tiếp theo.

Sau học đủ 282 câu, chấm lại Dulieu4 đúng 86/90 như v9, nhưng lỗi thay đổi:

| ID | Nhãn đúng giữ nguyên | V10 sau học |
| --- | --- | --- |
| 30 | SAFE | HIGH_RISK |
| 35 | RISK | HIGH_RISK |
| 57 | RISK | HIGH_RISK |
| 82 | RISK | HIGH_RISK |

ID 32/50 đã đúng RISK ở lượt chấm lại; ID 30/82 là lỗi mới so với v9 sau học.
Model còn nhầm ngữ nghĩa của từ dùng trong học tập và câu bản thân chứng
kiến người khác bị bạo lực. Đặc trưng vai trò hiện chỉ mô tả dấu hiệu/ngữ cảnh,
chưa phân tích đầy đủ quan hệ giữa người thực hiện và người bị tác động.
Điểm học lại không phải bằng chứng đạt chất lượng trên câu mới.

Hồi quy tổng hợp validation/test macro-F1 đạt 0,48231/0,50271, so với v9
0,45387/0,48698. Chỉ là hồi quy lịch sử, không làm cổng duyệt sản phẩm.

## Kiểm chứng chức năng

88 test liên quan đạt, không bỏ qua: 49 AI (7 test ngữ cảnh mới, 5 toán học
v9, 14 huấn luyện cũ, 2 engine, 4 API, 9 holdout, 3 CSV, 5 hai tầng cũ),
20 backend, 19 web. Đã kiểm tra riêng việc loại câu giữ ngoài phần học/chọn
ở cả 25 fold ngoài, giữ tất cả câu và nhãn.

Ngoài số test trên, 12 kiểm tra Agent/API/DB/API phụ huynh và web renderer
đạt bằng đúng artifact v10. DPAPI, giữ queue khi provider sai khóa/mất kết
nối, gửi lại và chống trùng, RLS, bật/tắt tính năng và loại page/chat được
kiểm tra. SAFE không tạo cảnh báo; RISK nhắc quan sát; HIGH_RISK gửi thông
điệp “Bé có dấu hiệu bị bạo lực”. Push ghi nhận cục bộ, tài khoản/thiết bị
kiểm thử xóa sau chạy. Chưa thử bố cục trong browser hoặc Redis phân tán.

CLI/engine/API khớp nhãn và điểm trên cả 282 câu, kể cả batch tối đa 20.
API trả `context_word_softmax_v1` và `deploymentEligible=false`. Khởi động
production với model chưa duyệt và dùng lại Dulieu4 làm holdout v10 đều bị
từ chối như yêu cầu. Model mặc định v5, artifact v8/v9 và mọi CSV giữ nguyên.

Đo tuần tự cục bộ: suy luận trung bình 0,145 ms/câu, P95 0,191 ms; API đơn
trung bình 9,69 ms, P95 26,86 ms; RAM API 53,91 MiB. Không phải kiểm tra tải.

## Khóa và tái lập

[Khóa v10](query_v10_candidate.lock.json) ghi model và checksum các báo cáo.
Artifact cục bộ:
`ai-training/artifacts/school_violence/v10_context_experiment_20261005/vi-school-violence-context-v10-query-candidate/model.json.gz`.
SHA-256: `7e6612203fd0898171fb21c6e0e8dbdb5a336bbf7b2059baeea584db70581616`.
V10 là ứng viên phát triển cải thiện hai mục tiêu trên benchmark hiện có,
chưa được duyệt bật cảnh báo thật. Model và báo cáo giữ `deployment_eligible=false`.

Báo cáo trong `ai-training/artifacts/school_violence/` ngoài Git:

- `v10_context_experiment_20261005/evaluation_report.json`: fold, lựa chọn,
  ID sai, cấu hình cuối và hồi quy.
- `v10_context_experiment_20261005/fixed_recipe_development_audit.json`: audit
  cấu hình cố định sau lựa chọn, không dùng chọn model.
- `v10_context_experiment_20261005/quality_verification.json`: test và checksum.
- `v10_runtime_acceptance_20261005/verification_report.json`: luồng thực tế.

Tái lập từ `ai-training` với output mới/rỗng và các nguồn đúng checksum:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -B -m school_violence.experiment_context_queries_v10 `
  --source-dir '..\Mô tả' `
  --output-dir .\artifacts\school_violence\v10_recheck --authorized

.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v10_recheck\evaluation_report.json `
  --output-dir .\artifacts\school_violence\v10_flow_recheck
```

Những câu đã biết, đặc trưng được thiết kế sau khi xem lỗi và các lượt lặp
không tạo bằng chứng độc lập. Nhóm gần trùng ký tự không chứng minh độc lập
theo trẻ, phiên hoặc ý nghĩa. Các điểm softmax có trọng số là điểm phân loại,
không được xem là xác suất nguy cơ đã hiệu chỉnh. Giữ báo cáo lỗi còn lại và
đánh giá độc lập trước quyết định triển khai.
