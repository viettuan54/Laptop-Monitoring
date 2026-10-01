# Bộ câu tìm kiếm v2.3: loại nhóm phủ định tổng hợp

Theo quyết định ngày 2026-10-01, bản `laptopmonitoring_query_dataset_v2_3.csv`
được tạo từ query v2.2 bằng cách loại toàn bộ dòng có
`query_type=negation_hard_negative` ở cả train, validation và test. Không sửa
CSV v2.2. [Báo cáo lọc](query_dataset_v2_3_filter_report.json) lưu SHA-256
nguồn/đầu ra và toàn bộ ID bị loại.

| Tập | Giữ lại | Đã loại |
| --- | ---: | ---: |
| Train | 3.932 | 268 |
| Validation | 839 | 62 |
| Test | 836 | 63 |
| Tổng | 5.607 | 393 |

Trong 393 câu bị loại có 211 `RISK` và 182 `SAFE`. Đây là quyết định loại
**nhóm ví dụ phủ định tổng hợp**, không phải bộ lọc mọi câu chứa từ “không”.
Các câu cầu cứu thực sự như “có ai giúp em không” vẫn được giữ. Trạng thái
duyệt của các câu còn lại không đổi; không tự gán `reviewed`.

Tạo lại CSV và báo cáo từ thư mục `ai-training` bằng
`python -m school_violence.exclude_negation_queries`. Công cụ từ chối ghi đè
file đã tồn tại. Sau đó xác thực và huấn luyện model chỉ từ câu tìm kiếm:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.training `
  --input '..\Mô tả\laptopmonitoring_query_dataset_v2_3.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v4-query `
  --model-version vi-school-violence-char-nb-v4-query `
  --dataset-version school-violence-query-v2.3
```

Thêm `--validate-only` để kiểm tra dữ liệu trước khi train. Để train lại,
chọn một thư mục artifact mới còn trống. Artifact được lưu cục bộ ngoài Git.
Đây là model v4 lịch sử; service mặc định hiện dùng v5-query từ
[bộ query v2.4](DATASET_QUERY_V2_4_README.md). Lệnh trên vẫn tái lập v4.

Lần train v4 chọn `alpha=0.5` trên validation. Theo **nhãn test v2.3 khi đó**,
836 câu cho macro-F1 0,98550; 13 câu gắn nhãn `RISK` được model dự đoán
`HIGH_RISK`. Người dùng đã xác nhận dự đoán `HIGH_RISK` là đúng cho 13 câu này:
đây là bất đồng với nhãn test cũ, không phải 13 cảnh báo sai của model. Các câu
đều thuộc `very_short_or_ambiguous` và đã được loại **chỉ khỏi tập test** ở v2.4.
Artifact vẫn có `deployment_eligible=false`; cần kiểm thử câu tìm kiếm thực tế
độc lập trước khi quyết định triển khai production.
