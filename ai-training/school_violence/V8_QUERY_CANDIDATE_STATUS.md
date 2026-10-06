# Ứng viên v8 từ các câu tìm kiếm đã duyệt

Ngày 2026-10-03. Sau khi xem lỗi [trên `DuLieuThat3`](../../Mô%20tả/bao-cao-ai/school_violence/DULIEUTHAT3_ERROR_ANALYSIS_V8.md),
đã tạo ứng viên v8 **cục bộ, không được triển khai**. Service vẫn mặc định
dùng v5. Dữ liệu phát triển gồm 12 câu sửa nhãn được xác nhận của
`DuLieuThat1`, 99 câu `DuLieuThat2` và 81 câu `DuLieuThat3`: tổng 192 câu,
49 `SAFE`, 77 `RISK`, 66 `HIGH_RISK`. SHA-256 của ba file review tương ứng:

- `DuLieuThat1_review.csv`: `6f664dafafde038b636831e00cdd81f1b3963402deba1dc21ff5acb91c3a4462`
  (chỉ dùng 12 dòng có provenance sửa nhãn trực tiếp).
- `DuLieuThat2_review.csv`: `5672f8379aaf309234df0382d5986d1e9210dbbe913daaa7e47413900e23b349`.
- `DuLieuThat3_review.csv`: `a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1`.

V8 dùng đặc trưng từ đơn/cặp từ TF-IDF và phân loại tuyến tính softmax với
trọng số cao hơn cho lỗi `HIGH_RISK`; chỉ văn bản query là đầu vào. Khi
không gặp đặc trưng nào từng học, model dùng tỷ lệ nhãn chưa nhân trọng số
trong tập huấn luyện, tránh mặc định gắn `HIGH_RISK` chỉ vì trọng số cảnh báo.
Cấu hình cố định trong `adapt_reviewed_queries_v8.py`: `min_df=2`, L2
`0.001`, trọng số `SAFE=1.5`, `RISK=1`, `HIGH_RISK=3`, 200 lượt tối ưu.
Các lựa chọn đặc trưng/trọng số đã được thử trên chính dữ liệu phát triển;
điểm kiểm tra chéo sau đây **có thiên lệch chọn cấu hình**.
Người cung cấp đã yêu cầu dùng bộ này cho vòng cải thiện model; xác nhận
riêng về nguồn gốc/quyền sử dụng/ẩn danh của `DuLieuThat3` chưa có. Kiểm tra
nội dung không thấy định danh rõ nhưng không thể chứng minh provenance tuyệt đối.

Năm fold phát triển giữ các câu gần giống ký tự mức 0,85 trở lên cùng fold;
không có mã trẻ/phiên để kiểm tra nhóm ở cấp đó. Ở seed chính `20261002`:

| Nhãn thật / v8 dự đoán | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 39 | 9 | 1 |
| RISK | 3 | 49 | 25 |
| HIGH_RISK | 0 | 5 | 61 |

Macro-F1 phát triển là 0,7848; `HIGH_RISK` đúng 61/66, có 5 câu bị hạ
xuống `RISK`. Có 10/49 câu `SAFE` bị cảnh báo, và 26/126 câu không phải mức
cao bị nâng lên `HIGH_RISK`. Riêng `DuLieuThat3` ngoài fold: 9/9 mức cao
đúng, 8/39 câu `SAFE` bị cảnh báo. Đây **không phải điểm kiểm thử cuối** vì
`DuLieuThat3` đã được xem dự đoán v5/v6/v7 và dùng để chọn cách làm v8.

Thử lại năm cách chia nhóm (seed `20261002`–`20261006`) cho macro-F1 từ
0,7205 đến 0,7848, số `HIGH_RISK` đúng từ 59 đến 61/66 và số `SAFE` bị cảnh
báo từ 10 đến 16/49. Riêng `DuLieuThat3`, số mức cao đúng từ 7 đến 9/9 và
cảnh báo `SAFE` từ 8 đến 14/39. Những khoảng dao động này cho thấy chưa thể
lấy lượt tốt nhất làm cam kết hiệu năng.

Artifact cục bộ ngoài Git:
`ai-training/artifacts/school_violence/vi-school-violence-word-linear-v8-query-candidate/`.
SHA-256 `model.json.gz` là
`ab55715bb011c4735349b3d340bd0aa6502286f29c08a5fc2f8a1fc35d9d9134`.
Model và `train.jsonl` chứa đặc trưng/câu tìm kiếm nên chỉ lưu trong thư mục
bị Git bỏ qua. JSON báo cáo ghi thống kê và ID lỗi, không sao chép nguyên
văn câu. Runtime `predict` và `ThreeLabelEngine` đã được kiểm tra dùng cùng
artifact; bộ `DuLieuThat3` bị công cụ đánh giá từ chối nếu dùng lại làm
holdout độc lập cho v8. Artifact và report đều có `deployment_eligible=false`.

Chạy lại từ `ai-training` khi bốn CSV nguồn còn đúng checksum và thư mục
output chưa tồn tại hoặc rỗng:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -B -m school_violence.adapt_reviewed_queries_v8 `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-word-linear-v8-query-candidate `
  --authorized
```

Quyết định hiện tại: giữ v8 làm ứng viên phát triển. Không thay model mặc
định hoặc bật cảnh báo production. Nếu cần tiếp tục cải thiện, dùng phân
tích lỗi và 192 câu hiện có; khi quyết định triển khai mới cần đánh giá
trên một bộ chưa xem dự đoán, có xác nhận nguồn/quyền sử dụng/ẩn danh và
tiêu chí chấp nhận cho cả bỏ sót mức cao lẫn cảnh báo nhầm.

**Rà tiếp 2026-10-03:** [báo cáo lỗi lặp và thử biến thể](V8_ERROR_STABILITY_AND_VARIANTS.md)
chỉ ra ba ID mức cao bị bỏ sót trong cả năm cách chia. Những thay đổi nhỏ
đã thử đều làm xấu ít nhất một loại lỗi quan trọng, nên chưa tạo v9 và
không thay artifact v8.

**Thử kiến trúc hai tầng 2026-10-03:**
[báo cáo và lệnh tái lập](TWO_STAGE_QUERY_EXPERIMENT.md) so 12 cấu hình trên
cùng năm cách chia. Điểm tổng thể/cảnh báo nhầm có cải thiện ở một số bản,
nhưng số `HIGH_RISK` nhận đúng đều giảm; tiếp tục giữ v8 làm ứng viên phát triển.

**Thử encoder ngữ nghĩa 2026-10-04:** [báo cáo](SEMANTIC_QUERY_EXPERIMENT.md)
so 16 cấu hình encoder giữ nguyên trọng số/đầu phân loại trên cùng fold.
Không cấu hình nào giữ được số mức cao đúng của v8 hoặc tránh tăng lỗi
mức cao hạ `SAFE`, nên tiếp tục giữ nguyên v8.

**Tinh chỉnh một phần encoder 2026-10-04:**
[báo cáo](FINETUNED_QUERY_EXPERIMENT.md) so bốn cấu hình học lại hai lớp cuối
MiniLM. Nhận đúng mức cao tốt nhất trung bình 55,4/66, kém v8 và tăng lỗi
hạ mức cao thành `SAFE`, nên không chọn thay v8.

**Hoàn thiện ứng viên 2026-10-04:** [báo cáo triển khai thử](V8_ROLLOUT_READINESS.md)
đã chọn trọng số/ranh giới quyết định trong fold huấn luyện, đánh giá ngoài
trên cùng năm seed. Giảm cảnh báo nhầm nhưng nhận đúng mức cao giảm 60 xuống
59,4/66 và xuất hiện mức cao xuống `SAFE`; kết thúc đợt chỉnh và giữ v8.
[Ứng viên đã khóa](query_v8_candidate.lock.json) đạt 11 kiểm tra Agent/API/DB/API
phụ huynh. Đã đo thời gian/RAM; bước còn lại là bộ kiểm thử độc lập.

**Đánh giá Dulieu4 ngày 2026-10-05:** [báo cáo](DULIEU4_V8_EVALUATION.md)
chấm 90 câu mới bằng đúng artifact đã khóa. Sau xác nhận sửa nhãn ID 82,
nhận đúng 70/90, mức cao 26/29; ID 66 và 83 bị trả `SAFE`, ID 90 bị hạ `RISK`.
Giữ `deployment_eligible=false`; không huấn luyện lại hoặc chỉnh ngưỡng.

**Vòng sửa tiếp ngày 2026-10-05:** [v9](V9_QUERY_CANDIDATE_STATUS.md) học đủ
282 câu, gồm Dulieu4, và giữ công thức v8 sau thử cấu hình. V8 gốc không đổi.
V9 chưa được triển khai: ID 66 còn sai ngoài phần học và lỗi nâng RISK vẫn
cao. Kết quả học lại không thay thế kiểm thử thực tế độc lập của phiên bản mới.
