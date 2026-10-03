# Đánh giá model v3 và điều kiện trước cảnh báo

Model service mặc định là `vi-school-violence-char-nb-v5-query`, từ query v2.4
với 5.594 câu sau khi loại 393 câu phủ định và 13 câu khỏi test. Cả 13 câu có
nhãn test cũ `RISK`, nhưng model dự đoán `HIGH_RISK` và người dùng xác nhận dự
đoán đúng. Test v5 còn 823 câu, macro-F1 1,0; điểm này không độc lập vì đã
chọn câu loại sau khi xem bất đồng nhãn. Train/validation và trọng số không đổi.
Artifact vẫn `deployment_eligible=false`; số liệu v3 bên dưới là lịch sử.

## Kết quả v3 lịch sử: chỉ trên dữ liệu tổng hợp

Model `vi-school-violence-char-nb-v3` được chọn `alpha=0.5` trên validation
(macro-F1 `0.9889705`). Test giữ riêng gồm 1.797 câu tổng hợp, macro-F1
`0.9879097`. Ma trận nhầm lẫn dưới đây có **hàng là nhãn thật**, cột là dự đoán:

| Nhãn thật / dự đoán | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 561 | 0 | 7 |
| RISK | 0 | 614 | 15 |
| HIGH_RISK | 0 | 0 | 600 |

| Nhãn | Support | Precision | Recall | F1 | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SAFE | 568 | 1.0000 | 0.9877 | 0.9938 | 0 | 7 |
| RISK | 629 | 1.0000 | 0.9762 | 0.9879 | 0 | 15 |
| HIGH_RISK | 600 | 0.9646 | 1.0000 | 0.9820 | 22 | 0 |

Không có `HIGH_RISK` bị bỏ sót trong **600 câu tổng hợp** ở test này; điều đó
không chứng minh tỷ lệ bỏ sót bằng 0 trên dữ liệu thực. Cả 22 lỗi test đều là
query bị nâng nhầm lên `HIGH_RISK`: 7 câu `SAFE` (chủ yếu câu ngã/vô ý có phủ
định) và 15 câu `RISK` (phủ định hoặc query ngắn, thiếu ngữ cảnh). Webpage tổng
hợp đạt 898/898, dấu hiệu cần kiểm tra độ khái quát trên trang thực.
Vì nhãn nguồn còn `unreviewed`, các bất đồng này cần được người đánh giá xem
lại trước khi kết luận nguyên nhân là model hay nhãn.

Ngoài test, 12 câu đối chứng chính sách tổng hợp khi đó đạt 10/12; hai lỗi đều là dự
đoán `HIGH_RISK` quá mức ở câu an toàn về học nhóm và câu phủ định "Tôi không bị
bạn đánh". Ví dụ phủ định đã được bỏ khỏi file đối chứng hiện tại.
Các đối chứng này **không** phải một tập thực tế độc lập.

## Dữ liệu thực tế và phép thử mới

Trong workspace đã có `Mô tả/DuLieuThat1.csv` gồm 94 câu do người dùng cung cấp,
và `Mô tả/DuLieuThat1_review.csv` với đủ ba nhãn trên 94 câu. Người cung cấp
đã xem dự đoán model, xác nhận phần lớn và chỉ ra 12 lỗi, nên bộ này là dữ liệu
chẩn đoán chứ không còn độc lập để ước lượng chất lượng cuối. Người cung cấp
đã xác nhận 94 câu được ẩn danh và được phép dùng để huấn luyện; xem
`DULIEUTHAT1_REVIEWED_DIAGNOSTIC.md` và
[`V6_QUERY_CANDIDATE_STATUS.md`](../../../ai-training/school_violence/V6_QUERY_CANDIDATE_STATUS.md).
Một bộ mới gồm 99 câu `DuLieuThat2_review.csv` được người cung cấp xác nhận
đã ẩn danh, được phép kiểm thử và gán nhãn trước khi xem dự đoán v5/v6. V6
nhận đúng 42/50 câu `HIGH_RISK` nhưng chỉ 4/40 câu `RISK`, nên chưa được thay
v5. Kết quả, ma trận nhầm lẫn và giới hạn phép thử nằm ở
[`DULIEUTHAT2_V5_V6_EVALUATION.md`](DULIEUTHAT2_V5_V6_EVALUATION.md).
Đó là bản nhãn ban đầu. Người cung cấp sau đó sửa nhãn/nội dung; bộ hiện tại
đã được dùng làm dữ liệu phát triển cho ứng viên v7 và không còn là tập kiểm
thử cuối độc lập. Xem
[`V7_QUERY_CANDIDATE_STATUS.md`](../../../ai-training/school_violence/V7_QUERY_CANDIDATE_STATUS.md).
Sau đó, bộ mới `DuLieuThat3` gồm 81 câu được chấm một lần trên v5/v6/v7:
v7 bỏ sót 3/9 câu `HIGH_RISK` và cảnh báo 31/39 câu `SAFE`, nên chưa được
triển khai. Xem [báo cáo `DuLieuThat3`](DULIEUTHAT3_V5_V6_V7_EVALUATION.md)
về nhãn, ma trận lỗi, checksum và giới hạn nguồn dữ liệu. Sau khi xem lỗi,
`DuLieuThat3` được dùng làm dữ liệu phát triển cho ứng viên
[v8](../../../ai-training/school_violence/V8_QUERY_CANDIDATE_STATUS.md);
không dùng bộ này để tuyên bố hiệu năng cuối của v8. CSV 6.000 câu ban đầu
và hai CSV v2.2 đều ghi nguồn `synthetic`; không đổi tên nguồn để
giả làm tập thực.
Phạm vi hiện tại chỉ là câu tìm kiếm. Không cần chờ dữ liệu `page_content`
để đánh giá nhánh này; việc đọc và đánh giá nội dung trang làm sau.

Để chạy phép thử tương tự trên bộ tiếp theo, lưu file JSONL **ngoài Git** tại
`ai-training/datasets/school_violence/real_world_holdout_v1.jsonl` (thư mục
đã bị `.gitignore` bỏ qua). Mỗi dòng cần đúng một JSON object với các trường:

`id`, `text`, `label`, `source_type`, `split`, `source`,
`review_status`, `pii_removed`, `permission_reference`,
`dataset_version`.

- `label`: một trong `SAFE`, `RISK`, `HIGH_RISK`; `source_type="search_query"`,
  đủ cả ba nhãn. Công cụ vẫn có thể đánh giá thêm `page_content` khi có dữ
  liệu sau này; nếu đưa vào thì nguồn bổ sung cũng phải có đủ ba nhãn.
- `source="real_world"`, `split="test"`, `review_status="reviewed"`,
  `pii_removed=true`. Chỉ ghi `reviewed` cho câu đã được một người thực sự xem;
  không yêu cầu hai người hoặc mã người duyệt. `permission_reference` là mã hồ sơ quyền sử dụng,
  không lưu dữ liệu định danh trong trường này.
- Không yêu cầu mã nhóm trong bảng duyệt hoặc tập JSONL. Khi thiếu thông tin
  trẻ/phiên, chỉ kiểm tra được ID và văn bản trùng với train/validation/test cũ;
  báo cáo phải ghi rõ chưa kiểm tra được trùng nguồn ở cấp trẻ/phiên.
- `text` là phần văn bản mà backend thực sự gửi cho model, không có thông tin
  định danh, URL hoặc token, tối đa 1.000 ký tự sau làm sạch. Không thêm metadata
  vào text. Tập test cần được thu và khóa sau khi chọn cấu hình model; không
  dùng để tiếp tục chọn `alpha`, ngưỡng hoặc sửa nhãn theo dự đoán của model.

Chạy từ `ai-training` (PowerShell):

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.evaluate_real_world `
  --holdout .\datasets\school_violence\real_world_holdout_v1.jsonl `
  --artifact-dir .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --output .\artifacts\school_violence\real_world_holdout_v1_report.json
```

Công cụ từ chối dữ liệu thiếu nhãn/review/khai báo quyền/ẩn danh, thiếu nhãn ở
mỗi nguồn, trùng ID/văn bản với train, validation hoặc test cũ, và một số
dạng PII rõ ràng. Báo cáo chứa precision, recall, F1, ma trận nhầm lẫn, FP/FN
theo nhãn và theo loại nguồn; `high_risk_false_negatives` ghi **ID và nhãn dự
đoán**, không sao chép nội dung câu. Metadata về nguồn/quyền/kiểm duyệt là lời
khai và vẫn cần kiểm tra thủ công. Công cụ không phát hiện mọi bản gần trùng
ngữ nghĩa và không tự đặt `deployment_eligible=true`.

Trước khi bật cảnh báo: người phụ trách phải xem trực tiếp mọi trường hợp
`HIGH_RISK` bị bỏ sót, thống nhất ngưỡng chấp nhận recall và tỷ lệ cảnh báo
nhầm cho từng loại nguồn, xác minh provenance/quyền sử dụng/ẩn danh, rồi ra
quyết định triển khai riêng. Nếu dùng holdout để cải thiện model, phải khóa
model mới và thu một holdout mới cho đánh giá cuối. Các artifact hiện vẫn
`deployment_eligible=false` và service production từ chối nạp.
