# Phân loại bạo lực học đường: ba nhãn

Luồng này dùng **một nhãn cho mỗi câu**: `SAFE`, `RISK`, hoặc `HIGH_RISK`.
`labels.json` là hợp đồng nhãn chung cho trainer, service `text_safety` và
backend. Ba nhãn không mã hóa loại hành vi hoặc ý định tự hại.

**Hiện tại:** service mặc định dùng `vi-school-violence-char-nb-v5-query`,
train chỉ trên query v2.4 gồm 5.594 câu. Từ v2.2 đã loại 393 câu phủ định
tổng hợp, rồi từ v2.3 loại đúng 13 câu khỏi tập test: nhãn cũ `RISK`, model
đoán `HIGH_RISK` và người dùng xác nhận model đúng. Xem
`Mô tả/DATASET_QUERY_V2_4_README.md` và hai script lọc để tái lập.
CSV v2.2/v2.3 và model v3/v4 là bản lịch sử. Trọng số v5 giống v4; điểm test
sau lọc không độc lập. V5-query chưa được duyệt production.

Quy tắc gán nhãn ở `ANNOTATION_GUIDE.md`: trang phòng chống bạo lực là `RISK`;
báo cáo bị bạo lực cá nhân, cầu cứu liên quan hoặc đe dọa trực tiếp là
`HIGH_RISK`. Không thêm nhãn mới. Model v2 chưa được huấn luyện lại theo các
đối chứng trong hướng dẫn này.

Tiền kiểm nhãn v2.2, **không** tự ghi `reviewed`:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.audit_labels_v2_2
```

Kết quả lịch sử `Mô tả/label_review_v2_2/audit_report.json` và `review_queue.jsonl`
ưu tiên 100 query ngắn, sau đó 393 câu phủ định và 51 mẫu đối chứng. Toàn bộ
393 dòng phủ định đã bị loại khỏi bản query v2.3, nên không cần duyệt chúng
cho lần train v4-query.
Đây chỉ là hàng đợi/quan sát tự động. Người đánh giá xem từng câu cùng ngữ cảnh,
ghi quyết định trong JSONL riêng theo hướng dẫn ở `datasets/text_safety/README.md`.
Không đưa hàng đợi hay cột metadata vào đặc trưng model và không tuyên bố dữ
liệu đã kiểm duyệt khi chưa có quyết định thực tế của người đánh giá.

Trainer mặc định vẫn đặt version `vi-school-violence-char-nb-v3` cho lệnh cũ;
lệnh train v5-query phải truyền `--model-version` rõ ràng theo README dữ liệu
v2.4. Bản thử nghiệm v3 từng được train trên hai CSV v2.2. Luồng
Agent hiện chỉ phân loại câu tìm kiếm: `SAFE` không cảnh báo, `RISK` nhắc quan sát,
`HIGH_RISK` cảnh báo bé có dấu hiệu bị bạo lực. Nội dung trang làm sau.
Chạy từ `ai-training` với Python 3.11; không cần tải
package/model từ Internet.

Kiểm tra hai nguồn v2.2 lịch sử, không train và không ghi artifact:

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

Để lặp lại thí nghiệm, bỏ `--validate-only` và dùng thư mục output mới, trống.
Lệnh train tạo:

- `train.jsonl`, `validation.jsonl`, `test.jsonl`: đúng tập trong CSV, giữ nhóm
  và nguồn gốc (file, số bản ghi, ID, phiên bản nguồn).
- `model.json.gz`: version model, version bộ kết hợp, dấu vân tay dataset và
  cấu hình huấn luyện, bên cạnh các trọng số baseline.
- `dataset_manifest.json`: SHA-256 từng CSV, schema, số mẫu, phiên bản nguồn,
  thống kê nhóm, loại trùng và kiểm tra rò rỉ.
- `training_config.json`: chỉ đầu vào `text`, n-gram, các alpha thử nghiệm,
  alpha được chọn, cách giữ split và SHA-256 code trainer/bộ chuẩn hóa.
- `evaluation_report.json`: kết quả từng alpha trên validation, cấu hình được
  chọn, precision/recall/F1 từng nhãn, FP/FN, confusion matrix, recall
  `HIGH_RISK` và kết quả riêng query/webpage trên test.

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

Kết quả lịch sử lần train v3 trên 11.986 mẫu v2.2: train 8.390, validation 1.799, test
1.797. Trong ba alpha `0.5`, `1.0`, `2.0`, validation macro-F1 chọn `0.5`
(0,98897). Test macro-F1 là 0,98791; recall `HIGH_RISK` là 600/600, nhưng
22 mẫu khác bị dự đoán nhầm thành `HIGH_RISK` (7 `SAFE`, 15 `RISK`); precision
`HIGH_RISK` là 0,96463. Riêng query test macro-F1 0,97607, webpage test 1,0.
Điểm hoàn hảo ở webpage tổng hợp là dấu hiệu dễ khớp mẫu, không phải chứng cứ
hoạt động tốt trên web thực tế. Tất cả 11.986 mẫu vẫn `unreviewed`.

Trước khi bỏ ví dụ query phủ định, v3 đối chiếu thêm 12 câu tổng hợp (không
phải test độc lập) cho 10/12 câu đúng. Model dự đoán `HIGH_RISK` sai ở câu
`SAFE` "Bạn bè cùng nhau ôn bài và giúp đỡ nhau trong lớp." và câu phủ định
`RISK` "Tôi không bị bạn đánh". Không dùng điểm test tổng hợp để bỏ qua hai
lỗi này hoặc bật cảnh báo production.
File `policy_examples.example.jsonl` hiện còn 11 ví dụ, không chứa câu phủ định
đã loại. V4-query đúng 6/6 ví dụ query còn lại, nhưng sai một ví dụ trang;
đây không phải bằng chứng đạt chất lượng thực tế.

Ma trận nhầm lẫn, FP/FN từng nhãn và quy trình kiểm thử trên tập thực tế độc
lập được ghi ở [REAL_WORLD_EVALUATION.md](../../Mô%20tả/bao-cao-ai/school_violence/REAL_WORLD_EVALUATION.md). Công cụ
`python -m school_violence.evaluate_real_world` chỉ nhận tập đã ẩn danh,
được phép dùng và thực sự gán nhãn; không tự tạo hoặc giả định tập này đã có.

Thử suy luận cục bộ (PowerShell):

```powershell
'Bạn bè liên tục đe dọa đánh em' | .\.venv\Scripts\python.exe -m school_violence.predict `
  --model .\artifacts\school_violence\vi-school-violence-char-nb-v5-query\model.json.gz
```

Artifact v5-query đã được tạo cục bộ; đường dẫn mặc định của service trỏ đến v5-query.
Biến `TEXT_SAFETY_MODEL_PATH` vẫn có thể ghi đè đường dẫn này; service cần
khởi động lại để nạp cấu hình mới. Dữ liệu webpage cũ được giữ để tái lập lần train trước,
không có nghĩa tính năng đọc trang đã được triển khai.

Trước tích hợp sản phẩm cần tập câu thực tế đã ẩn danh, có quyền sử dụng và
được gán nhãn; chia theo người dùng/hội thoại; đánh giá sai sót `HIGH_RISK`
trên tập độc lập. Không suy `HIGH_RISK` thành cảnh báo khẩn tự động.
