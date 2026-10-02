# Ứng viên v7 sau khi rà lại `DuLieuThat2`

Ngày 2026-10-02. Người cung cấp đã sửa nhãn và làm rõ một số câu trong
`Mô tả/DuLieuThat2_review.csv`. SHA-256 bản dùng để huấn luyện là
`5672f8379aaf309234df0382d5986d1e9210dbbe913daaa7e47413900e23b349`.
Bộ này có 99 câu: 10 `SAFE`, 42 `RISK`, 47 `HIGH_RISK`; không có ID trùng,
nhãn/ô trống, văn bản trùng sau chuẩn hóa hoặc mẫu định danh rõ ràng theo
bộ kiểm tra hiện có. Không trùng văn bản chuẩn hóa với dữ liệu tham chiếu
của v6 hoặc 94 câu `DuLieuThat1`. Không có mã trẻ/phiên để kiểm tra độc lập
theo cấp đó. Các câu gần giống (độ tương tự ký tự ≥0,85) được giữ cùng nhóm
trong kiểm tra chéo.

Các nhãn đã chỉnh sau khi xem dự đoán v5/v6, nên `DuLieuThat2` **nay là dữ
liệu phát triển**, không phải tập kiểm thử cuối độc lập. Những cặp lấy đồ
dùng học tập một lần đã cùng nhãn `RISK`; câu nêu việc lấy đồ lặp lại và
không trả là `HIGH_RISK`. Nội dung ID `11` và các trường hợp cố ý/lặp lại
đã được người cung cấp làm rõ. Hướng dẫn nhãn đã được cập nhật theo ranh
giới này. Đây là kiểm tra nhất quán nội bộ, không chứng minh nhãn đúng ở
mọi ngữ cảnh.

Script [`adapt_reviewed_queries_v7.py`](adapt_reviewed_queries_v7.py) lấy
ứng viên v6 (SHA-256 model
`610207001150ead8b5db1d5ee438872509e319b05c32b205d091ddd57c29088d`),
bổ sung một lượt 12 câu sửa nhãn của `DuLieuThat1` để giữ kết quả cũ, rồi
cập nhật Naive Bayes ký tự bằng 99 câu đã rà. Trọng số cập nhật được chọn
trên 5 fold phát triển, giữ các câu gần giống trong cùng fold; các trọng số
thử là `1,2,4,8,16,32,64,128,256`, chọn `128` theo macro-F1. Chọn trọng
số trên chính 99 câu này làm điểm kiểm tra chéo có thiên lệch chọn mô hình;
không dùng nó làm ước lượng cuối cho sản phẩm.

| Chỉ số trên bản 99 câu hiện tại | v6 cố định | v7 kiểm tra chéo phát triển |
| --- | ---: | ---: |
| `SAFE` đúng | 3/10 | 4/10 |
| `RISK` đúng | 3/42 | 28/42 |
| `HIGH_RISK` đúng | 39/47 | 42/47 |
| Câu không phải `HIGH_RISK` bị nâng lên mức cao | 42 | 15 |
| Macro-F1 | 0,3921 | 0,6930 |

Ma trận v7 kiểm tra chéo, hàng là nhãn thật, cột là dự đoán:

| Nhãn thật | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 4 | 5 | 1 |
| RISK | 0 | 28 | 14 |
| HIGH_RISK | 0 | 5 | 42 |

Khi huấn luyện trên toàn bộ 99 câu, v7 nhận đúng 99/99; đây chỉ là độ khớp
trên tập học. Cả 12 câu sửa nhãn cũ vẫn đúng trên tập học. Macro-F1 trên
validation tổng hợp lịch sử là `0,9864`, trên test tổng hợp lịch sử là
`0,9966`; hai bộ tổng hợp này chỉ để kiểm tra hồi quy. V7 vẫn bỏ sót cảnh
báo mức cao ở 5/47 câu và cảnh báo 6/10 câu `SAFE` trong kiểm tra chéo; mẫu
`SAFE` quá ít để ước lượng tỷ lệ cảnh báo nhầm ngoài thực tế.

Artifact nằm cục bộ ngoài Git tại
`ai-training/artifacts/school_violence/vi-school-violence-char-nb-v7-query-candidate/`.
SHA-256 `model.json.gz` là
`d13383b8c620ae2de4ff6ee7208e481a799da0ddb58bd723ee98c5e8f14dc9ae`.
JSON báo cáo và cấu hình không chứa nguyên văn câu tìm kiếm; `train.jsonl`
và model chứa dữ liệu huấn luyện trong thư mục bị Git bỏ qua. Model mặc định
vẫn là v5. V7 có `deployment_eligible=false`; chưa có tập kiểm thử cuối mới
chưa xem dự đoán và chưa đủ cơ sở bật cảnh báo production.

Tái tạo ứng viên từ `ai-training` khi cả hai CSV nguồn còn đúng checksum và
thư mục output trống:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.adapt_reviewed_queries_v7 `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v6-query-candidate `
  --real-review '..\Mô tả\DuLieuThat2_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v7-query-candidate `
  --authorized
```
