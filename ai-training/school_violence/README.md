# Phân loại bạo lực học đường: ba nhãn

Luồng này dùng **một nhãn cho mỗi câu**: `SAFE`, `RISK`, hoặc `HIGH_RISK`.
`labels.json` là hợp đồng nhãn chung cho trainer, service `text_safety` và
backend. Ba nhãn không mã hóa loại hành vi hoặc ý định tự hại.

Quy tắc gán nhãn ở `ANNOTATION_GUIDE.md`: trang phòng chống bạo lực là `RISK`;
báo cáo bị bạo lực cá nhân, cầu cứu liên quan hoặc đe dọa trực tiếp là
`HIGH_RISK`. Không thêm nhãn mới. Model v2 chưa được huấn luyện lại theo các
đối chứng trong hướng dẫn này.

Chạy từ `ai-training` với Python 3.11; không cần tải package/model từ Internet:

```powershell
.\.venv\Scripts\python.exe -m school_violence.training `
  --input '..\Mô tả\du_lieu_bao_luc_hoc_duong_tieng_viet_6000.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v2
```

Thêm `--validate-only` để chỉ kiểm tra file và chia tập, không ghi artifact.
Trainer hiện chỉ nhận nguồn `synthetic` và từ chối một số mẫu định danh cá nhân
cơ bản; dữ liệu nội bộ/real-world cần quy trình nhập liệu và chia theo ID riêng.
Chương trình không sửa CSV gốc. Nó tạo `train.jsonl`, `validation.jsonl`,
`test.jsonl`, `model.json.gz`, và `evaluation_report.json` trong thư mục output
(phải trống trước khi chạy). Các câu trùng sau chuẩn hóa được gom vào cùng tập;
trùng đúng câu/case/khoảng trắng được loại. Mỗi record giữ `source_ids` để truy vết.
`review_status` vẫn là `unreviewed` — không tự nhận đã được con người duyệt.

Model baseline là Naive Bayes ký tự 3–5 gram, chọn hệ số làm mượt trên validation;
test chỉ dùng cho báo cáo cuối. Đây là model đã train thật nhưng **chỉ để thử
nghiệm**. Dữ liệu nguồn toàn câu tổng hợp lặp mẫu, thiếu user/conversation ID,
chưa có kiểm duyệt nhãn hoặc bộ kiểm thử thực tế độc lập. Vì vậy mọi artifact
được đánh dấu `deployment_eligible: false` kể cả khi metric test rất cao.
Service local có thể dùng artifact này trong môi trường phát triển, nhưng
production từ chối nạp khi `deployment_eligible` còn là `false`.

Thử suy luận cục bộ (PowerShell):

```powershell
'Bạn bè liên tục đe dọa đánh em' | .\.venv\Scripts\python.exe -m school_violence.predict `
  --model .\artifacts\school_violence\vi-school-violence-char-nb-v2\model.json.gz
```

Trước tích hợp sản phẩm cần tập câu thực tế đã ẩn danh, có quyền sử dụng và
được gán nhãn; chia theo người dùng/hội thoại; đánh giá sai sót `HIGH_RISK`
trên tập độc lập. Không suy `HIGH_RISK` thành cảnh báo khẩn tự động.
