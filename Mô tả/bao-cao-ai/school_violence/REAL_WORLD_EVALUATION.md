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

## Tập thực tế độc lập còn thiếu

Trong workspace hiện chưa có tập query thực tế độc lập đã ẩn danh,
được phép sử dụng và được người đánh giá gán nhãn. CSV 6.000 câu ban đầu và hai
CSV v2.2 đều ghi nguồn `synthetic`; không đổi tên nguồn để giả làm tập thực.
Phạm vi hiện tại chỉ là câu tìm kiếm. Không cần chờ dữ liệu `page_content`
để đánh giá nhánh này; việc đọc và đánh giá nội dung trang làm sau.

Khi có dữ liệu, lưu file JSONL **ngoài Git** tại
`ai-training/datasets/school_violence/real_world_holdout_v1.jsonl` (thư mục
đã bị `.gitignore` bỏ qua). Mỗi dòng cần đúng một JSON object với các trường:

`id`, `text`, `label`, `source_type`, `group_id`, `split`, `source`,
`review_status`, `pii_removed`, `permission_reference`,
`dataset_version`.

- `label`: một trong `SAFE`, `RISK`, `HIGH_RISK`; `source_type="search_query"`,
  đủ cả ba nhãn. Công cụ vẫn có thể đánh giá thêm `page_content` khi có dữ
  liệu sau này; nếu đưa vào thì nguồn bổ sung cũng phải có đủ ba nhãn.
- `source="real_world"`, `split="test"`, `review_status="reviewed"`,
  `pii_removed=true`. Chỉ ghi `reviewed` cho câu đã được một người thực sự xem;
  không yêu cầu hai người hoặc mã người duyệt. `permission_reference` là mã hồ sơ quyền sử dụng,
  không lưu dữ liệu định danh trong trường này.
- `group_id` phải là mã ẩn danh ổn định để nhận biết các câu cùng người/hội
  thoại hoặc cùng nguồn trang; không dùng ID thật. Giữ toàn bộ nhóm khỏi
  train/validation và các tập test tổng hợp cũ.
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
mỗi nguồn, trùng ID/nhóm/văn bản với train, validation hoặc test cũ, và một số
dạng PII rõ ràng. Báo cáo chứa precision, recall, F1, ma trận nhầm lẫn, FP/FN
theo nhãn và theo loại nguồn; `high_risk_false_negatives` ghi **ID và nhãn dự
đoán**, không sao chép nội dung câu. Metadata về nguồn/quyền/kiểm duyệt là lời
khai và vẫn cần kiểm tra thủ công. Công cụ không phát hiện mọi bản gần trùng
ngữ nghĩa và không tự đặt `deployment_eligible=true`.

Trước khi bật cảnh báo: người phụ trách phải xem trực tiếp mọi trường hợp
`HIGH_RISK` bị bỏ sót, thống nhất ngưỡng chấp nhận recall và tỷ lệ cảnh báo
nhầm cho từng loại nguồn, xác minh provenance/quyền sử dụng/ẩn danh, rồi ra
quyết định triển khai riêng. Nếu dùng holdout để cải thiện model, phải khóa
model mới và thu một holdout mới cho đánh giá cuối. Hiện model v3 vẫn
`deployment_eligible=false` và service production từ chối nạp.
