# Phân loại bạo lực học đường: ba nhãn

Luồng này dùng **một nhãn cho mỗi câu**: `SAFE`, `RISK`, hoặc `HIGH_RISK`.
`labels.json` là hợp đồng nhãn chung cho trainer, service `text_safety` và
backend. Ba nhãn không mã hóa loại hành vi hoặc ý định tự hại.

Quy tắc gán nhãn ở `ANNOTATION_GUIDE.md`: trang phòng chống bạo lực là `RISK`;
báo cáo bị bạo lực cá nhân, cầu cứu liên quan hoặc đe dọa trực tiếp là
`HIGH_RISK`. Không thêm nhãn mới. Model v2 chưa được huấn luyện lại theo các
đối chứng trong hướng dẫn này.

Trainer mới mặc định tạo model version `vi-school-violence-char-nb-v3` khi được
chạy huấn luyện. Việc sửa trainer không tự train hoặc thay artifact v2 mà service
đang nạp. Chạy từ `ai-training` với Python 3.11; không cần tải package/model từ Internet.

Kiểm tra hai nguồn kết hợp, không train và không ghi artifact:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.training `
  --input '..\Mô tả\laptopmonitoring_query_dataset_v2_2.csv' `
          '..\Mô tả\laptopmonitoring_webpage_dataset_v2_2.csv' `
  --output-dir .\artifacts\school_violence\vi-school-violence-char-nb-v3 `
  --validate-only
```

`--input` nhận một hoặc nhiều file, cũng có thể lặp lại cờ `--input`.
CSV bắt buộc có `id,text,label,group_id,split,source,review_status,dataset_version`.
File cũ thiếu nhóm/phiên bản cần chuẩn bị lại, không tự gán nhóm giả hoặc chia lại.
ID bản ghi phải duy nhất trên toàn bộ các nguồn; `group_id` và `page_id` được
kiểm tra trên toàn bộ bộ kết hợp, không chỉ từng file.

Trainer giữ nguyên `group_id` và `split` đã ghi trong CSV. Một nhóm có thể có
nhiều nhãn theo ngữ cảnh nhưng không được đi qua nhiều tập. Trainer dừng khi
phát hiện trùng khác nhãn hoặc rò rỉ, không tự chuyển mẫu để sửa lỗi. Kiểm tra
được thực hiện trước khi loại trùng, gồm câu nguyên văn/case/khoảng trắng,
chuẩn hóa runtime, bản chuẩn đối chiếu query, thân trang và ID trang. Vì vậy
đổi tiêu đề không che được thân trang trùng; query trùng thân trang cũng bị
kiểm tra. Đây không phải bộ phát hiện mọi dạng gần trùng ngữ nghĩa.

Trùng nguyên văn cùng nhãn và cùng tập được giữ một mẫu, gộp `source_ids`,
`source_refs` và `group_ids` để không mất nguồn gốc. Không loại chỉ vì không dấu
và có dấu chuẩn hóa về cùng khóa: các biến thể này vẫn là mẫu train khác nhau
trong cùng tập. Mỗi tập phải có đủ ba nhãn; không tự chia lại để bù nhãn thiếu.

Chỉ `text` được dùng để tạo đặc trưng ký tự. `text_normalized`, nhãn gốc, ID,
nhóm, split, loại nguồn và các cột metadata khác chỉ dùng kiểm tra/truy vết.

Trainer hiện chỉ nhận nguồn `synthetic` và từ chối một số mẫu định danh cá nhân
cơ bản; dữ liệu nội bộ/real-world cần quy trình nhập liệu và chia theo ID riêng.
Chương trình không sửa CSV gốc. Giữ đúng trạng thái duyệt, không tự nhận đã được
con người duyệt; mẫu gộp chỉ là `reviewed` nếu mọi bản nguồn đều đã được duyệt.

Sau khi rà soát nhãn và quyết định train thử nghiệm, bỏ `--validate-only`.
Thư mục output phải trống. Lệnh train sẽ tạo:

- `train.jsonl`, `validation.jsonl`, `test.jsonl`: đúng tập trong CSV, giữ nhóm
  và nguồn gốc (file, số bản ghi, ID, phiên bản nguồn).
- `model.json.gz`: version model, version bộ kết hợp, dấu vân tay dataset và
  cấu hình huấn luyện, bên cạnh các trọng số baseline.
- `dataset_manifest.json`: SHA-256 từng CSV, schema, số mẫu, phiên bản nguồn,
  thống kê nhóm, loại trùng và kiểm tra rò rỉ.
- `training_config.json`: chỉ đầu vào `text`, n-gram, các alpha thử nghiệm,
  alpha được chọn, cách giữ split và SHA-256 code trainer/bộ chuẩn hóa.
- `evaluation_report.json`: cấu hình, provenance và precision/recall/F1 từng
  nhãn, FP/FN, confusion matrix và recall `HIGH_RISK`.

`--model-version` đổi version model; `--dataset-version` đặt tên phiên bản bộ
kết hợp (không thay phiên bản nguồn trong manifest). Mặc định hai CSV v2.2
cho version `school-violence-combined-v2.2`. `--alpha-candidates 0.5 1 2` có
thể đặt các alpha hữu hạn dương. Chọn alpha chỉ trên validation, không dùng
test để chọn cấu hình. `--validate-only` vẫn trả cấu hình và manifest dự kiến
nhưng không tạo file, không gọi fit và không đánh giá model.

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
  --model .\artifacts\school_violence\vi-school-violence-char-nb-v3\model.json.gz
```

Lệnh inference v3 chỉ dùng được sau khi thực sự tạo artifact v3; không đổi
đường dẫn mặc định của service trong bước sửa trainer.

Trước tích hợp sản phẩm cần tập câu thực tế đã ẩn danh, có quyền sử dụng và
được gán nhãn; chia theo người dùng/hội thoại; đánh giá sai sót `HIGH_RISK`
trên tập độc lập. Không suy `HIGH_RISK` thành cảnh báo khẩn tự động.
