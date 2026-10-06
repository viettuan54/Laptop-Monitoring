# Kết quả kiểm tra nhóm đặc trưng và chọn v12.1

**Ứng viên mới hơn:** [v13 đã được chọn và kiểm tra Agent cục bộ](V13_QUERY_CANDIDATE_STATUS.md)
ngày 2026-10-06. Báo cáo này giữ nguyên kết quả lịch sử của v12.1.

**Cập nhật Dulieu5, 2026-10-06:** đã chốt sáu nhãn theo xác nhận người dùng
trước dự đoán và [chấm đủ 90 câu](DULIEU5_V12_1_EVALUATION.md). Đúng 75/90;
HIGH_RISK đúng 26/26, SAFE bị cảnh báo 4/30, RISK lên HIGH_RISK 9/34,
RISK về SAFE 2/34. Chưa đạt các mốc kỹ thuật đặt trước. Thông tin nguồn mới
chưa xác nhận riêng, nên chưa công bố đây là kiểm thử thực tế độc lập.
Model/khóa v12.1 và mặc định v5 giữ nguyên, chưa triển khai.
Phần bên dưới giữ lịch sử thời điểm chọn ứng viên, khi chưa có Dulieu5.

Ngày 2026-10-06. Đã thực hiện bước 1–3: kiểm tra riêng nhóm đặc trưng, sửa
biểu diễn, huấn luyện và so sánh. **V12.1 đạt tiêu chí phát triển**, được khóa
làm ứng viên mới để kiểm thử độc lập. Model mặc định vẫn v5; chưa triển khai
thật. Bước 4 chưa chấm vì chưa tìm thấy bộ thực tế mới đủ điều kiện trong
workspace. Không dùng các bộ cũ để thay thế bộ mới.

## Nguồn và phạm vi

Giữ đủ 282 câu: SAFE 79, RISK 108, HIGH_RISK 95; nội dung/nhãn CSV và
provenance giữ nguyên. ID 82 vẫn RISK. Không thêm câu tổng hợp, đổi nhãn theo
model hoặc loại lỗi khỏi phép chấm. Đối chứng là cấu hình cuối v10 cố định,
không phải quy trình chọn lồng nhau của v10.

Giữ đúng 25 fold của v9/v10, 5 seed x 5 fold. Từ vựng, IDF và trọng số chỉ
học trong phần học mỗi fold. Các cách chia dùng lại cùng 282 câu đã xem;
đặc trưng được sửa sau xem lỗi. Những số dưới đây là kiểm tra phát triển
có phản hồi từ dữ liệu, không ước lượng chất lượng độc lập trên trẻ mới.

## Bước 1: kiểm tra từng nhóm

[Kế hoạch ablation](V12_ABLATION_PLAN.md) chốt trước khi chạy. Bốn profile:
v11 đầy đủ và lần lượt tắt nhóm học tập, vai trò, áp lực. Tắt các cột đặc
trưng, giữ bộ nhận cụm từ/mệnh đề. Nhóm không trùng nhau; các feature từ giữ
nguyên. V10 và v11 đầy đủ tái lập đúng kết quả đã khóa.

| Trung bình mỗi lượt /282 | V10 cố định | V11 đầy đủ | Bỏ học tập | Bỏ vai trò | Bỏ áp lực |
| --- | ---: | ---: | ---: | ---: | ---: |
| Macro-F1 | 0,81254 | 0,81064 | 0,80764 | 0,78170 | 0,80452 |
| HIGH nhận đúng /95 | 92,8 | 92,6 | 92,6 | 93,0 | 92,6 |
| SAFE cảnh báo /79 | 12,4 | 10,8 | 11,6 | 11,6 | 12,2 |
| RISK lên HIGH /108 | 36,0 | 38,0 | 38,0 | 43,2 | 38,8 |
| RISK về SAFE /108 | 3,8 | 3,8 | 3,8 | 5,8 | 3,4 |

HIGH về SAFE bằng 0 ở tất cả profile. Không profile tắt nhóm nào cải thiện
tổng thể. Vai trò giúp phân biệt RISK; cụm học tập giúp giảm cảnh báo SAFE.
Bỏ áp lực cả nhóm không chữa được lỗi. Các nhóm tương tác qua chuẩn hóa
và quá trình học; không diễn giải hiệu ứng này là nguyên nhân độc lập hoặc
cộng các mức thay đổi để dự đoán một tổ hợp mới.

## Bước 2: sửa biểu diễn, giữ kết quả chưa đạt

[V12](V12_REPAIR_PLAN.md) được thiết kế sau ablation, chốt trước lượt chấm:

- Giữ cụm học tập/hành vi thật và gắn vai trò theo hành vi; phân biệt
  chỉ/chị, ảnh/anh, bàn/bạn khi có dấu, tránh nhận vật/từ chỉ mức độ thành người.
- Khôi phục các tương tác ngữ cảnh trêu chọc/cô lập hữu ích từ v10; giữ cách
  gắn vai trò mới cho hành vi thể chất, không ghép mọi từ “mình” với hành vi.
- Giữ áp lực chung, mô tả riêng yêu cầu/thúc ép, ép buộc, làm theo và loại
  chưa nhận rõ, cùng đối tượng và hậu quả được nói đến. Không nhận ra hậu quả
  không được hiểu là câu an toàn. Mọi hệ số được học, không tự trả nhãn.

V12 giảm hai loại cảnh báo sai và tăng macro-F1, nhưng HIGH nhận đúng giảm
92,8 → 92,4. Chỉ seed 20261002 có hai lỗi HIGH mới về RISK, liên quan nghĩa
vụ mua đồ và giữ tài sản để buộc làm theo yêu cầu. **V12 không được chọn**.
Báo cáo và kế hoạch được giữ nguyên.

Sau đó chốt riêng [vòng sửa v12.1](V12_1_RECOVERY_PLAN.md), chỉ mở rộng khái
niệm ép tiền/tài sản hiện có cho nghĩa vụ mua khi có áp lực từ bạn/nhóm và
giữ tài sản không trả đi kèm yêu cầu. Nghĩa vụ mua thông thường không tự tạo
khái niệm này. Có kiểm tra bản thân chứng kiến để không tự biến người nói
thành người bị tác động. Không tra ID/nguyên câu hoặc tự gán HIGH_RISK.

Hai vòng không thay trọng số, ngưỡng hoặc seed: min_df=1, context scale=2,
SAFE/RISK/HIGH=1,5/1/3, L2=0,001, epochs=200, argmax. Runtime/algorithm có
phiên bản riêng, các model v10/v11/v11.1/v12 cũ giữ nguyên.

## Bước 3: so sánh và khóa v12.1

| Trung bình mỗi lượt trên cùng 282 câu | V10 cố định | V12 chưa đạt | V12.1 |
| --- | ---: | ---: | ---: |
| Macro-F1 | 0,81254 | 0,82340 | 0,83938 |
| HIGH nhận đúng /95 | 92,8 | 92,4 | 94,2 |
| HIGH về SAFE /95 | 0 | 0 | 0 |
| SAFE cảnh báo /79 | 12,4 | 10,8 | 10,2 |
| RISK lên HIGH /108 | 36,0 | 34,4 | 32,0 |
| RISK về SAFE /108 | 3,8 | 3,6 | 3,6 |

V12.1 đạt tiêu chí đã chốt: HIGH nhận đúng không giảm, HIGH về SAFE không
tăng, các loại cảnh báo sai/RISK về SAFE không tăng, macro-F1 tăng và giảm
cảnh báo sai. Các chỉ số tổng thể này không xấu hơn v10 ở từng seed, nhưng
không chứng minh ổn định trên một bộ trẻ/phiên mới.

| Seed | V10 macro-F1 | V12.1 macro-F1 | V10 HIGH đúng | V12.1 HIGH đúng | V10 RISK→HIGH | V12.1 RISK→HIGH |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20261002 | 0,80620 | 0,83093 | 94 | 94 | 38 | 33 |
| 20261003 | 0,82179 | 0,84156 | 93 | 95 | 36 | 33 |
| 20261004 | 0,82578 | 0,85668 | 93 | 94 | 36 | 31 |
| 20261005 | 0,81039 | 0,83837 | 92 | 94 | 36 | 33 |
| 20261006 | 0,79854 | 0,82935 | 92 | 94 | 34 | 30 |

Riêng Dulieu4 ngoài phần học: HIGH đúng giữ 29/29, HIGH về SAFE giữ 0;
SAFE cảnh báo 4,8 → 4,4/30, RISK lên HIGH 7,0 → 5,4/31, RISK về SAFE giữ
0,4/31. Đạt giới hạn không làm xấu riêng bộ này đã chốt trước lượt chấm.

## Lỗi còn lại

ID 30 đúng SAFE ở 5/5 lượt ngoài phần học. ID 66/83/90 giữ HIGH đúng 5/5.
Hai câu HIGH bị mất ở v12 (DuLieuThat2:67, DuLieuThat3:63) đúng HIGH 5/5 ở
v12.1. ID 32 giữ đúng RISK 5/5.

**ID 35/57/82 vẫn sai HIGH ở cả 5 lượt**, dù nhãn người cung cấp là RISK.
**ID 50 là hồi quy riêng:** v10 đúng 4/5, v12.1 sai HIGH 5/5. Không sửa nhãn,
lọc câu hoặc giấu lỗi này để chọn model. Cổng chọn kiểm tra chỉ số tổng thể
và Dulieu4, không đảm bảo mọi câu đều cải thiện.

Sau học đủ dữ liệu, chấm lại Dulieu4 đạt 87/90, sai 35/57/82. Trên toàn bộ
282 câu, SAFE có 1 câu về RISK, RISK có 1 câu về SAFE và 20 câu lên HIGH,
HIGH đúng 95/95. V10 sau học có 18 RISK lên HIGH; v12.1 chấm lại tăng loại
lỗi này dù ngoài phần học giảm. Điểm chấm lại không phải test mới và không
thay cổng ngoài phần học. Tỷ lệ cảnh báo mức cao sai ở RISK vẫn đáng kể trong
benchmark phát triển; không gọi model đã hoàn thiện hoặc sẵn sàng production.

Hồi quy tổng hợp validation/test macro-F1 v12.1=0,48058/0,50190; chỉ là kiểm
tra lịch sử, không làm tiêu chí phát hành. Điểm softmax có trọng số chưa
được hiệu chỉnh thành xác suất nguy cơ.

## Kiểm chứng chức năng

**121 test đạt, không bỏ qua:** 82 AI, 20 backend, 19 web. Có 19 test mới/
mở rộng về phân nhóm ablation, kiểu áp lực, lỗi bỏ dấu, hành vi tài sản,
runtime, khóa phiên bản và từ chối holdout không hợp lệ trước dự đoán.
Đã kiểm tra 75 phân vùng ngoài học ở ablation/v12/v12.1; giữ mọi câu/nhãn.

V12 và v12.1 mỗi bản qua **12 kiểm tra** Agent thật → API model → backend/
PostgreSQL kiểm thử → API phụ huynh → renderer cảnh báo thực tế. DPAPI và
queue, lỗi khóa provider/mất kết nối, gửi lại/chống trùng, RLS, quyền phụ
huynh, bật/tắt đồng ý và loại page/chat đều được kiểm tra. SAFE không tạo
cảnh báo; RISK nhắc quan sát; HIGH gửi “Bé có dấu hiệu bị bạo lực”. Push
được ghi nhận cục bộ và tài khoản/thiết bị thử dọn sau chạy. Chưa thử bố cục
trong browser hoặc Redis phân tán. Kiểm tra chức năng không chứng minh
nhãn dự đoán đúng trên câu mới.

CLI/engine/API khớp điểm và nhãn trên cả 282 câu, kể cả batch. Chọn nhãn
argmax, tổng điểm bằng 1, confidence bằng điểm nhãn chọn. Khởi động
production bằng model chưa duyệt và dùng lại dữ liệu đã học làm holdout
đều bị từ chối. Trainer hiện tại tạo lại đúng head đã khóa của v12.1.

Đo tuần tự cục bộ v12.1: suy luận trung bình 0,718 ms, P95 1,350 ms; API đơn
trung bình 13,15 ms, P95 16,63 ms; RAM khoảng 52,9 MiB. Không phải thử tải.

## Bước 4: trạng thái kiểm thử độc lập

Chưa tìm thấy bộ thực tế mới đủ điều kiện. `Mô tả/holdout.jsonl` có 600 câu,
nhưng permission_reference=not_applicable_synthetic nên bị từ chối. Archive
DuLieuThat3 cũng bị từ chối vì trùng phần dữ liệu đã học. Không chạy dự đoán
v12.1 trên hai tập này để công bố test độc lập, không sửa metadata cho qua.

Đã chuẩn bị evaluator nhận **CSV chỉ gồm id,text,label**, khóa đúng v12.1,
không thêm mã người duyệt hoặc group_id. `--require-independent` từ chối
trước dự đoán nếu thiếu xác nhận nguồn/nhãn hoặc còn trùng/gần trùng. Khóa
chứa archive tham chiếu của toàn bộ 364 câu từng được xem trong bốn CSV,
gồm cả 82 câu DuLieuThat1 không dùng huấn luyện. Các nhãn archive chỉ dùng
đối chiếu đã xem, không được coi là nhãn huấn luyện đã xác nhận cho 82 câu đó.
Train/validation/test của artifact cũng được kiểm tra. Những kiểm tra này
không chứng minh độc lập về ý nghĩa hoặc theo trẻ/phiên.

Khi có file mới và thông tin nguồn/ẩn danh/được phép/nhãn chốt trước dự
đoán đã được xác nhận, từ `ai-training` dùng:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.evaluate_query_csv `
  --csv '..\Mô tả\TEN_FILE_MOI.csv' `
  --candidate-lock .\school_violence\query_v12_1_candidate.lock.json `
  --output-dir .\artifacts\school_violence\v12_1_independent_test `
  --origin real_world --metadata-confirmed --require-independent
```

Evaluator không huấn luyện, chọn ngưỡng hoặc sửa nhãn; ghi snapshot trước
dự đoán, báo mọi lỗi theo ID và không tự duyệt deployment. Chưa đặt ngưỡng
phát hành thực tế chỉ bằng các phép đo phát triển này.

## Khóa và tái lập

[Khóa v12.1](query_v12_1_candidate.lock.json) ghi model, báo cáo phát triển/
chức năng/chất lượng và archive đối chiếu dữ liệu đã xem. Artifact:
`ai-training/artifacts/school_violence/v12_1_financial_context_experiment_20261006/vi-school-violence-financial-context-v12-1-query-candidate/model.json.gz`.
SHA-256: `cfc5f953afdaf8bce621ee0ba2f8d6da57b45467449e774464b0a434ef1dc8cb`.
V12.1 là ứng viên phát triển đã chọn; model/báo cáo giữ deployment_eligible=false.
Model mặc định v5 và artifact/lock cũ giữ nguyên.

Các báo cáo riêng ngoài Git:

- `v12_context_ablation_20261006/ablation_report.json`: các nhóm và lỗi.
- `v12_typed_context_experiment_20261006/evaluation_report.json`: v12 chưa đạt.
- `v12_1_financial_context_experiment_20261006/evaluation_report.json`: v12.1.
- `v12_1_financial_context_experiment_20261006/quality_verification.json`: test/nguồn/khóa.
- `v12_1_financial_context_experiment_20261006/independent_dataset_availability.json`: kiểm tra tập có sẵn.
- `v12_1_financial_context_runtime_20261006/verification_report.json`: luồng chức năng.

Tái lập theo thứ tự, output mới/rỗng, nguồn đúng checksum:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe -B -m school_violence.analyze_context_components_v12 `
  --source-dir '..\Mô tả' --output-dir .\artifacts\school_violence\v12_ablation_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.experiment_typed_context_v12 `
  --source-dir '..\Mô tả' --output-dir .\artifacts\school_violence\v12_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.experiment_financial_context_v12_1 `
  --source-dir '..\Mô tả' --output-dir .\artifacts\school_violence\v12_1_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v12_1_recheck\evaluation_report.json `
  --output-dir .\artifacts\school_violence\v12_1_flow_recheck
```

Các script khóa nguồn và tham chiếu ablation/v12 gốc để kiểm toán; output
recheck không thay tham chiếu lịch sử. Dispatch runtime được bổ sung qua
các bước; hash mã ghi trong từng báo cáo là lịch sử lúc chạy. Không thay
các runtime cũ; fingerprint artifact tái chạy thay theo audit mã mới.
