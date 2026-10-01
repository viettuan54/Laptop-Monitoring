# Bộ câu tìm kiếm v2.4: loại 13 câu ngắn, mơ hồ

Tạo `laptopmonitoring_query_dataset_v2_4.csv` từ v2.3 bằng cách loại **đúng 13 ID**
trong [báo cáo lọc](query_dataset_v2_4_filter_report.json). Chúng đều thuộc
tập `test`, có `query_type=very_short_or_ambiguous` và nhãn lưu cũ `RISK`.
Model v4-query dự đoán `HIGH_RISK` cho cả 13 câu; người dùng đã xác nhận dự đoán
này là đúng. Vì vậy đây là các nhãn test không phù hợp, không phải cảnh báo nhầm.
Theo yêu cầu, chỉ loại 13 câu khỏi tập test, không sửa nhãn trong CSV lịch sử.
Script [`exclude_ambiguous_queries.py`](../ai-training/school_violence/exclude_ambiguous_queries.py)
kiểm tra SHA-256 của CSV nguồn, ID, nhãn cũ, split, loại query và nhóm đơn lẻ.
CSV v2.3 và artifact v4 được giữ lại để truy vết.

| Tập | v2.3 | Loại | v2.4 |
| --- | ---: | ---: | ---: |
| Train | 3.932 | 0 | 3.932 |
| Validation | 839 | 0 | 839 |
| Test | 836 | 13 | 823 |
| Tổng | 5.607 | 13 | 5.594 |

Chạy lại từ thư mục `ai-training`:

```powershell
python -B -m school_violence.exclude_ambiguous_queries
python -B -m school_violence.training `
  --input '..\Mô tả\laptopmonitoring_query_dataset_v2_4.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --model-version vi-school-violence-char-nb-v5-query `
  --dataset-version school-violence-query-v2.4
```

Thêm `--validate-only` vào lệnh train để kiểm tra dữ liệu mà không tạo artifact.
Hai lệnh tạo file/thư mục mới và từ chối ghi đè. Artifact nằm ngoài Git; checkout
mới cần tạo lại trước khi chạy service. Có thể dùng Python trong
`.runtime/text-safety-venv/Scripts` ở gốc dự án nếu không có `python` trên PATH.

V5-query chọn `alpha=0.5` trên validation. Ma trận nhầm lẫn test v2.4 là đường
chéo hoàn toàn (238 `SAFE`, 285 `RISK`, 300 `HIGH_RISK`), macro-F1 = 1,0.
**Đây không phải điểm kiểm thử độc lập:** 13 câu đã được chọn sau khi xem bất
đồng giữa nhãn test cũ và dự đoán v4. Train/validation không đổi nên trọng số,
dự đoán của v5 giống v4. Việc loại 13 nhãn test không phù hợp không phải cải
thiện model. Những câu còn lại vẫn là dữ liệu tổng hợp chưa được duyệt nhãn;
`deployment_eligible=false`. Cần tập câu tìm kiếm thực tế độc lập để đánh giá
trước khi quyết định dùng trong production.
