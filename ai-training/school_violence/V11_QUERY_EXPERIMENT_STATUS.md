# Kết quả sửa ngữ cảnh sau v10

Cập nhật sau vòng này: [v12.1](V12_QUERY_CANDIDATE_STATUS.md) đã đạt tiêu chí
phát triển và được khóa để thử bộ mới độc lập. Các kết quả v11 dưới đây giữ
nguyên như lịch sử; service vẫn mặc định v5, chưa triển khai ứng viên mới.

Ngày 2026-10-06. Đã sửa, huấn luyện và kiểm tra lần lượt v11 đầy đủ rồi
v11.1 sửa hẹp. **Cả hai chưa đạt tiêu chí thay v10**. V10 tiếp tục là ứng viên
phát triển; service mặc định vẫn dùng v5. Không có model mới được duyệt
production trong vòng này. Đây là kết quả chưa đạt, không phải lỗi chạy test.

## Các việc đã thực hiện

Giữ đủ 282 câu, nội dung và nhãn nguồn: SAFE 79, RISK 108, HIGH_RISK 95.
Giữ ID 82=RISK theo xác nhận của người cung cấp. CSV và provenance khớp
checksum v9/v10; không thêm câu tổng hợp hoặc bỏ lỗi khỏi phép chấm.

V11 bổ sung bộ trích xuất phiên bản riêng: nhận cụm học tập/thể thao,
phân biệt người bị tác động với người chứng kiến trong phạm vi mệnh đề,
mô tả áp lực và đối tượng/hậu quả đi kèm. Câu có hành vi thật ngoài cụm học
tập vẫn giữ đặc trưng physical. Có kiểm tra vai trò chủ động/bị động, người
bạn của bé, nhiều nạn nhân và hành vi ở mệnh đề khác. Đặc trưng không tự trả
nhãn; hệ số được học bằng softmax. Bộ suy luận và artifact v10 giữ nguyên.

[Kế hoạch v11](V11_EXPERIMENT_PLAN.md) được chốt trước khi chấm. Giữ cấu
hình cuối v10: TF-IDF từ/cặp từ min_df=1, context scale=2, trọng số lớp
SAFE/RISK/HIGH=1,5/1/3, L2=0,001, 200 lượt tối ưu, argmax. Chỉ thử một bộ
đặc trưng đầy đủ, không tìm thêm trọng số hoặc ngưỡng.

Sau khi v11 đầy đủ không đạt, chốt riêng [kế hoạch v11.1](V11_1_EXPERIMENT_PLAN.md)
trước lượt chấm thứ hai. Bản này chỉ gỡ ý nghĩa physical sai ở cụm học tập/
thể thao, giữ mọi đặc trưng còn lại của v10. Đây là vòng phát triển tiếp theo
dựa trên kết quả đã xem, không nằm trong kế hoạch v11 ban đầu. Báo cáo cũ
và snapshot mã trainer gốc được giữ, không ghi đè kết quả thất bại.

## So sánh cùng 25 fold

Hai bản dùng đúng 5 seed x 5 fold đã khóa của v9/v10. Trong từng fold,
từ vựng, IDF và trọng số chỉ học từ phần học. Cả 282 câu được chấm ngoài
phần học ở mỗi seed. Đối chứng là **cấu hình cuối v10 cố định** học lại;
kết quả đối chứng khớp chính xác audit cấu hình cố định v10 đã khóa.

| Trung bình mỗi lượt trên 282 câu | V10 cố định | V11 đầy đủ | V11.1 sửa hẹp |
| --- | ---: | ---: | ---: |
| Macro-F1 | 0,81254 | 0,81064 | 0,81108 |
| HIGH_RISK nhận đúng /95 | 92,8 | 92,6 | 92,8 |
| HIGH_RISK về SAFE /95 | 0 | 0 | 0 |
| SAFE bị cảnh báo /79 | 12,4 | 10,8 | 12,0 |
| RISK lên HIGH_RISK /108 | 36,0 | 38,0 | 36,8 |
| RISK về SAFE /108 | 3,8 | 3,8 | 3,8 |

V11 đầy đủ giảm cảnh báo SAFE nhưng tăng cảnh báo mức cao sai ở RISK,
giảm nhẹ mức cao nhận đúng và macro-F1. Bản hẹp giữ mức cao nhận đúng,
nhưng vẫn tăng RISK lên HIGH và giảm macro-F1. Cả hai bị loại theo tiêu chí
đã chốt; không dùng lượt chấm sau học để thay quyết định này.

| Riêng Dulieu4 ngoài phần học | V10 cố định | V11 đầy đủ | V11.1 sửa hẹp |
| --- | ---: | ---: | ---: |
| HIGH_RISK nhận đúng /29 | 29 | 29 | 29 |
| HIGH_RISK về SAFE /29 | 0 | 0 | 0 |
| SAFE bị cảnh báo /30 | 4,8 | 4,4 | 5,0 |
| RISK lên HIGH_RISK /31 | 7,0 | 8,6 | 7,2 |
| RISK về SAFE /31 | 0,4 | 0,4 | 0,4 |

Những số này dùng lại cùng các câu ở năm cách chia, không phải 1.410 mẫu
độc lập. Cấu hình v10 và thiết kế đặc trưng dựa trên dữ liệu đã xem; phép đo
v11/v11.1 là đánh giá phát triển. Không so bảng này trực tiếp với điểm của
**quy trình chọn lồng nhau** v10 (macro-F1 0,80647) như cùng một phép đo.

## Lỗi mục tiêu và lỗi mới

| ID Dulieu4 | Nhãn giữ nguyên | V10 đúng ngoài học | V11 đúng ngoài học | V11.1 đúng ngoài học |
| --- | --- | ---: | ---: | ---: |
| 30 | SAFE | 0/5 | 5/5 | 0/5 |
| 35 | RISK | 0/5 | 0/5 | 0/5 |
| 57 | RISK | 0/5 | 0/5 | 0/5 |
| 82 | RISK | 0/5 | 0/5 | 0/5 |
| 66 | HIGH_RISK | 5/5 | 5/5 | 5/5 |
| 83 | HIGH_RISK | 5/5 | 5/5 | 5/5 |
| 90 | HIGH_RISK | 5/5 | 5/5 | 5/5 |

ID 30 (đánh giá việc học) đã đúng ngoài học ở v11 đầy đủ. Bản sửa hẹp trả
RISK 3 lượt, HIGH 2 lượt, vẫn chưa trả SAFE khi giữ ngoài học. Sửa đặc trưng
physical không tự bảo đảm quyết định cuối đúng vì các trọng số còn lại cũng
được học lại. ID 82 được nhận vai trò người khác bị tác động, nhưng dự đoán
ngoài học vẫn HIGH. ID 35/57 vẫn HIGH ở mọi cách chia. ID 32/50 cũng xấu hơn
ở v11 đầy đủ: ID 32 từ đúng 5/5 còn 3/5; ID 50 từ 4/5 còn 0/5.

Sau học đủ 282 câu, chấm lại Dulieu4:

- V10: 86/90, sai 30, 35, 57, 82.
- V11: 86/90, sửa 30/82, nhưng sai mới 31/48; còn sai 35/57.
- V11.1: 87/90, sửa 30; còn sai 35/57/82.

Đây là chấm lại dữ liệu đã học, **không phải test mới**. Không chọn v11.1
chỉ vì điểm 87/90 cao hơn 86/90.

Audit hỗ trợ đặc trưng cho thấy trong 282 câu, đặc trưng người khác bị tác
động thể chất/chứng kiến thể chất chỉ xuất hiện ở 2 câu RISK. Đặc trưng
áp lực chưa nhận ra hậu quả trực tiếp xuất hiện ở 14 HIGH và 8 RISK; bản thân
bị áp lực ở 10 HIGH và 4 RISK. Tại ID 35/57 sau học, phần ngữ cảnh đóng góp
về phía HIGH lớn hơn phần từ đóng góp về phía RISK. Những thống kê này mô
tả tập hiện có và cách học, không chứng minh nhãn người cung cấp sai.

Hướng sửa tiếp theo là tách ảnh hưởng của từng nhóm đặc trưng vai trò/áp lực
và kiểm tra nhóm đang đẩy RISK lên HIGH, trước khi thử thêm cấu hình. Dữ liệu
hiện có dùng được cho việc phân tích đó. Không yêu cầu thu thêm dữ liệu để
hoàn thành vòng thử vừa thực hiện. Một bộ thực tế mới độc lập vẫn cần cho
quyết định triển khai, sau khi có ứng viên đạt các tiêu chí phát triển.

## Kiểm chứng chức năng và trạng thái

**102 test đạt, không bỏ qua:** 63 AI (14 test mới về vai trò/cụm từ và các
test hồi quy liên quan), 20 backend, 19 web. Từ v10/v11/v11.1 qua CLI, engine
và API vẫn giữ hợp đồng SAFE/RISK/HIGH, argmax, tổng điểm 1, confidence bằng
điểm nhãn được chọn. Trainer dùng chung sau lần thử đầu tạo lại đúng toàn bộ
head đã lưu của cả v11 và v11.1; có snapshot trainer trước thay đổi để kiểm toán.

Mỗi bản thử qua **12 kiểm tra** Agent thật → API model → Express/PostgreSQL
kiểm thử → API phụ huynh → renderer cảnh báo thực tế. DPAPI/queue, lỗi khóa
provider/mất kết nối, gửi lại/chống trùng, RLS, quyền phụ huynh, tắt đồng ý
và loại page/chat được kiểm tra. SAFE không tạo cảnh báo; RISK nhắc quan sát;
HIGH gửi “Bé có dấu hiệu bị bạo lực”. Push được ghi nhận cục bộ, dữ liệu
tài khoản thử được dọn sau chạy. Không thử bố cục trong browser hoặc Redis.

API/engine/CLI khớp nhãn và điểm trên cả 282 câu mỗi bản, kể cả batch.
Khởi động production với ứng viên chưa duyệt và dùng lại dữ liệu phát triển
làm holdout đều bị từ chối. Chức năng chạy đúng không thay kết luận chất lượng.

Đo tuần tự cục bộ: suy luận v11 trung bình 0,447 ms, P95 0,809 ms; v11.1
trung bình 0,719 ms, P95 1,373 ms. API đơn lần lượt trung bình 11,04/10,36 ms,
P95 26,53/27,21 ms; RAM khoảng 53 MiB. Đây không phải thử tải đồng thời.
Hồi quy tổng hợp validation/test macro-F1 v11=0,47878/0,49719,
v11.1=0,47970/0,50338; không dùng làm cổng duyệt sản phẩm.

[Khóa các thử nghiệm](query_v11_experiment.lock.json) ghi artifact, kế hoạch,
báo cáo và checksum; trạng thái experimental_only_rejected. V10 tiếp tục là
ứng viên hiện hành; model mặc định v5 và các artifact cũ không thay đổi.
Các bản thử giữ deployment_eligible=false, chưa kiểm thử thực tế độc lập.

Artifact cục bộ ngoài Git:

- `v11_role_context_experiment_20261006/evaluation_report.json`: vòng v11.
- `v11_1_phrase_context_experiment_20261006/evaluation_report.json`: vòng sửa hẹp.
- `v11_1_phrase_context_experiment_20261006/context_feature_support_audit.json`: hỗ trợ/đóng góp nhóm đặc trưng.
- `v11_1_phrase_context_experiment_20261006/quality_verification.json`: kết quả test và kiểm tra khóa/nguồn.
- `v11_role_context_runtime_20261006/verification_report.json` và
  `v11_1_phrase_context_runtime_20261006/verification_report.json`: kiểm tra chức năng.

Tái lập từ `ai-training`, dùng output mới/rỗng và nguồn đúng checksum:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe -B -m school_violence.experiment_role_context_v11 `
  --source-dir '..\Mô tả' --output-dir .\artifacts\school_violence\v11_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.experiment_phrase_context_v11_1 `
  --source-dir '..\Mô tả' --output-dir .\artifacts\school_violence\v11_1_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v11_1_recheck\runtime_check_selection.json `
  --output-dir .\artifacts\school_violence\v11_1_flow_recheck
```

Mã trainer được mở rộng để dùng chung sau v11, thêm dispatch v11.1 sau lần
thử đầu; không thay đặc trưng/suy luận v11 đã lưu. Hash mã cũ trong báo cáo
v11 là lịch sử tại lúc chạy, snapshot khớp hash đó. Tái chạy bằng mã hiện tại
giữ head/số đo nhưng fingerprint/artifact checksum thay theo audit mã mới.
