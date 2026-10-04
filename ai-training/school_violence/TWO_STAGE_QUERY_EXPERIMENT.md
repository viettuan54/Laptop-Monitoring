# Thử mô hình hai tầng cho câu tìm kiếm

Ngày 2026-10-03. Đã thực hiện rà ranh giới nhãn và thử kiến trúc hai tầng
trên 192 câu phát triển hiện có. Mô hình hai tầng giảm một số cảnh báo nhầm
nhưng bỏ sót mức cao nhiều hơn v8. Không cấu hình nào đạt điều kiện thay v8;
service vẫn mặc định dùng v5, các artifact thử đều `deployment_eligible=false`.

## Ranh giới nhãn

Đã bổ sung cách đọc **ai bị tác động**, **hành vi được nói rõ** và
**trải nghiệm thật hay giả định** vào [hướng dẫn gán nhãn](ANNOTATION_GUIDE.md).
[Bản rà nhãn](LABEL_BOUNDARY_REVIEW_20261003.md) giữ `DuLieuThat3:22` và
`DuLieuThat3:50` là `RISK`. ID `DuLieuThat3:55` vẫn giữ `HIGH_RISK` theo nhãn
người cung cấp; còn chờ làm rõ bị người khác ép xin lỗi hay tự lo lắng rồi
xin lỗi. Không đổi CSV hoặc tự thêm ngữ cảnh để khớp dự đoán.

## Kiến trúc và cách thử

- Tầng 1 học phân biệt `SAFE` với `ALERT` (gộp `RISK` và `HIGH_RISK`).
- Tầng 2 chỉ học trên câu `RISK`/`HIGH_RISK`, rồi phân biệt hai mức này.
- Thử hai cách quyết định: `hard_route` đi lần lượt qua hai tầng với ngưỡng
  0,5; `joint_argmax` ghép điểm hai tầng rồi chọn nhãn có điểm lớn nhất.

Mỗi tầng dùng TF-IDF từ đơn/cặp từ và bộ phân loại tuyến tính. Từ vựng,
IDF và trọng số chỉ học từ phần train của từng fold; tầng 2 không dùng
câu `SAFE` để học từ vựng. Giữ `min_df=2`, L2 `0.001`, 200 lượt tối ưu như v8.
Thử sáu bộ trọng số `(SAFE tầng 1, ALERT tầng 1, HIGH_RISK tầng 2)`:
`(1.5,1,2)`, `(1.5,1,3)`, `(2,1,2)`, `(2,1,3)`, `(1.5,1.5,3)`, `(2,1.5,3)`.
Kết hợp hai cách quyết định thành 12 cấu hình; các ngưỡng không được điều
chỉnh sau khi xem kết quả.

Dữ liệu gồm 12 lỗi đã xác nhận của `DuLieuThat1`, 99 câu `DuLieuThat2`,
81 câu `DuLieuThat3`: 49 `SAFE`, 77 `RISK`, 66 `HIGH_RISK`. Cùng năm cách
chia với v8, seed `20261002`–`20261006`; mỗi cách gồm năm fold, giữ 188 nhóm
câu gần giống cùng fold. Kiểm tra không có trùng ID/văn bản chuẩn hóa với
5.594 câu tham chiếu của v5. Không có metadata để xác nhận độc lập theo
trẻ/phiên; các nhóm gần giống không bảo đảm phát hiện mọi câu trùng ngữ nghĩa.

## Kết quả

Các số đếm sau là **trung bình của năm cách chia**, không phải số câu trong
một lượt chạy hoặc kết quả trên một bộ kiểm thử độc lập mới.

| Cấu hình | Macro-F1 | HIGH_RISK đúng / 66 | HIGH_RISK bị hạ SAFE | SAFE bị cảnh báo / 49 | RISK bị nâng HIGH_RISK / 77 |
| --- | ---: | ---: | ---: | ---: | ---: |
| v8 tham chiếu | 0,7465 | 60,0 | 0,0 | 13,6 | 27,8 |
| Hai tầng `(2,1,2)`, `hard_route` | 0,7724 | 54,8 | 0,0 | 12,8 | 20,2 |
| Hai tầng `(2,1,3)`, `hard_route` | 0,7599 | 58,6 | 0,0 | 12,8 | 26,4 |

Bản `(2,1,2)` có Macro-F1 cao nhất nên được lưu làm artifact thử để kiểm
tra lại, **không phải bản được đề nghị thay v8**. Số mức cao đúng dao động
53–57/66, trong khi v8 là 59–61/66. Bản `(2,1,3)` giữ được nhiều mức cao
hơn (57–60/66), nhưng trung bình vẫn kém v8 1,4 câu. Không cấu hình nào đạt
đồng thời: Macro-F1 không giảm, số mức cao đúng không giảm, lỗi mức cao
bị hạ `SAFE` không tăng, và hai loại cảnh báo nhầm không tăng.

Các bản dùng `joint_argmax` còn có thể hạ `HIGH_RISK` thành `SAFE`:
trung bình tối đa 0,8 câu mỗi cách chia. Ba ID xuất hiện trong loại lỗi
này qua các cấu hình là `DuLieuThat1:53`, `DuLieuThat1:67`, `DuLieuThat3:77`.
Các bản `hard_route` đã thử không có lỗi đó trong lần kiểm tra này; điều
này chưa chứng minh tầng 1 luôn an toàn trên câu mới.

Ba lỗi mức cao lặp của v8 (`DuLieuThat2:16`, `:64`, `:67`) vẫn bị bỏ sót
ở cả năm cách chia của hai bản `hard_route` trong bảng. Tách hai tầng
chưa giải quyết được các ranh giới ngữ nghĩa khó này.

Toàn bộ 192 câu đã được dùng cho phát triển. Chọn kiến trúc/trọng số/cách
quyết định trên chính các fold này tạo thiên lệch chọn cấu hình; không dùng
điểm trên dữ liệu train hoặc lượt tốt nhất để tuyên bố model đã hoàn thiện.

## Artifact, suy luận và tái lập

Artifact cục bộ ngoài Git:
`ai-training/artifacts/school_violence/vi-school-violence-two-stage-query-experiment-v1/`.
Model version là `vi-school-violence-two-stage-query-experiment-v1`, thuật
toán `tfidf_two_stage_query_v1`. Bản được lưu dùng `(2,1,2)`, `hard_route`.

- SHA-256 `model.json.gz`:
  `16def84b997f7d106916330c176e3da2b1a86dd7419876a0c85f9d3c4cf51255`.
- SHA-256 `evaluation_report.json`:
  `011669f4ff9e92dedc2bc4d772c8126664426af873708847d48f25aee7ec3ddb`.
- Dấu vân tay nguồn/cấu hình:
  `cdfaca3abf9e58eba3dcaad4296272d5c92288db3c9bfd987a071a401afbe1ab`.

Checksum ba CSV review giữ đúng bản trong
[báo cáo v8](V8_QUERY_CANDIDATE_STATUS.md); provenance `DuLieuThat1` là
`944faf9aa8d9ec1c785776d2bb3ebabfd921f52acd2b366b5e251d0b7952eb81`.
JSON ghi đủ 12 cấu hình, ma trận từng seed và ID lỗi, không sao chép câu
nguyên văn. `train.jsonl` và đặc trưng trong model chỉ nằm ở thư mục bị Git
bỏ qua. `validation.jsonl`/`test.jsonl` được sao chép từ v5 để kiểm tra trùng
với dữ liệu tham chiếu; chúng không phải bộ câu thật mới cho phép thử này.

Runtime `predict` và `ThreeLabelEngine` hỗ trợ cách quyết định của artifact.
Ba điểm trả về có tổng bằng 1: `SAFE=P(SAFE)`,
`RISK=P(ALERT)*P(RISK|ALERT)`, `HIGH_RISK=P(ALERT)*P(HIGH_RISK|ALERT)`.
Với `hard_route`, nhãn được chọn có thể khác nhãn có điểm ghép lớn nhất.
`confidence` vẫn là điểm ghép của nhãn được chọn, chưa được hiệu chỉnh thành
xác suất đúng thực tế. Client phải dùng nhãn trả về để xử lý hành động.

Kiểm tra hoàn tất: chạy 124 unit test, 121 đạt và ba test API bỏ qua vì
thiếu thư viện service trong môi trường này. Bản model đã lưu trả nhãn/điểm
nhất quán giữa `predict` và `ThreeLabelEngine` trên cả 192 câu; điểm có tổng
bằng 1. Bộ kiểm tra độc lập từ chối dùng lại `DuLieuThat3` vì đã nằm trong
train, và cấu hình production từ chối artifact chưa được duyệt. Checksum
của v5/v8 không đổi; thư mục artifact mới được Git bỏ qua.

Chạy từ `ai-training` với thư mục output mới/trống và các CSV đúng checksum:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -B -m school_violence.experiment_two_stage_queries `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-two-stage-query-experiment-v1 `
  --authorized
```

Quyết định: giữ kết quả hai tầng làm thí nghiệm đã hoàn tất, tiếp tục giữ
v8 làm ứng viên phát triển. Chưa thay mặc định v5 hoặc bật cảnh báo thực tế.
Nếu tiếp tục vòng cải thiện bằng dữ liệu hiện có, ưu tiên khả năng phân biệt
vai trò/ngữ cảnh của ba lỗi mức cao lặp; việc chia hai tầng đơn thuần chưa đủ.
