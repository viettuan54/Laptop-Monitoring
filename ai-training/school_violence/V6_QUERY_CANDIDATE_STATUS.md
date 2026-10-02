# Ứng viên v6 từ 12 lỗi query đã xác nhận

Ngày 2026-10-02. Người cung cấp xác nhận 94 câu đã ẩn danh và được phép dùng để
huấn luyện trong dự án. Script `adapt_confirmed_errors_v6.py` chỉ lấy **12 câu
được người cung cấp sửa nhãn trực tiếp** theo `DuLieuThat1_label_provenance.csv`.
81 nhãn xác nhận theo model và ID `69` không vào tập học hay tập kiểm thử.
Script khóa checksum của bảng nhãn, nguồn gốc nhãn và nội dung model v5; từ chối
câu trùng với train/validation/test cũ hoặc mẫu dữ liệu nhạy cảm rõ ràng.

Ứng viên `vi-school-violence-char-nb-v6-query-candidate` được lưu cục bộ tại
`ai-training/artifacts/school_violence/vi-school-violence-char-nb-v6-query-candidate/`
(thư mục bị Git bỏ qua). SHA-256 `model.json.gz` là
`610207001150ead8b5db1d5ee438872509e319b05c32b205d091ddd57c29088d`.
Model gốc v5 và đường dẫn mặc định của service không thay đổi. Ứng viên vẫn có
`deployment_eligible=false`; production từ chối nạp.

Phương pháp: cập nhật thống kê Naive Bayes ký tự từ v5 bằng 12 câu đã sửa,
trọng số 2. Đây là trọng số nguyên nhỏ nhất khiến model nhận đúng cả 12 câu
**đã đưa vào học**. Validation/test tổng hợp của v5 giữ nguyên byte trong
artifact v6 để kiểm tra hồi quy:

| Phép kiểm tra | v5 | v6 ứng viên |
| --- | ---: | ---: |
| 12 câu đưa vào học, nhận đúng | 0/12 | 12/12 |
| Bỏ từng câu lỗi ra khỏi phần cập nhật rồi thử lại | 0/12 | 4/12 |
| Macro-F1 trên validation tổng hợp cũ | 0,9899 | 0,9866 |
| Macro-F1 trên test tổng hợp lịch sử | 1,0000 | 1,0000 |

Kết quả 12/12 là độ khớp **trên chính dữ liệu huấn luyện**, không phải bằng
chứng model hiểu tốt câu mới. Trong phép bỏ từng câu, v6 nhận đúng 4/10 lỗi
`HIGH_RISK` và 0/2 lỗi `RISK`; validation tổng hợp giảm nhẹ. Test tổng hợp
lịch sử đã bị ảnh hưởng bởi các quyết định ở phiên bản trước, nên cũng không
chứng minh chất lượng thực tế. Bản v6 này là ứng viên thử nghiệm, chưa đủ cơ sở
thay thế v5 trong luồng cảnh báo.

Bản query thực tế mới `DuLieuThat2_review.csv` tại thời điểm kiểm thử v5/v6
đã được người cung cấp xác nhận quyền sử dụng, ẩn danh và gán nhãn trước khi
xem dự đoán. Trên cùng 99 câu ở bản nhãn ban đầu,
v6 nhận đúng 42/50 câu `HIGH_RISK` so với 25/50 ở v5, nhưng chỉ nhận đúng
4/40 câu `RISK` so với 10/40 ở v5; 36 câu `RISK` bị nâng thành `HIGH_RISK`.
V6 vẫn là ứng viên thử nghiệm, chưa thay service mặc định. Xem ma trận nhầm
lẫn, kiểm tra nguồn và giới hạn của phép thử tại
[`DULIEUTHAT2_V5_V6_EVALUATION.md`](../../Mô%20tả/bao-cao-ai/school_violence/DULIEUTHAT2_V5_V6_EVALUATION.md).
Nếu dùng 99 câu này để chỉnh v6, phải thu một bộ mới chưa xem model để kiểm
thử cuối trước quyết định triển khai.
Người cung cấp sau đó đã sửa nhãn/nội dung bộ này và dùng nó để phát triển
ứng viên v7; xem [`V7_QUERY_CANDIDATE_STATUS.md`](V7_QUERY_CANDIDATE_STATUS.md).

Tái tạo ứng viên từ thư mục `ai-training` sau khi có file gốc và xác nhận quyền
sử dụng (đường dẫn output phải trống và nằm trong `artifacts/school_violence`):

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.adapt_confirmed_errors_v6 `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v6-query-candidate `
  --authorized
```
