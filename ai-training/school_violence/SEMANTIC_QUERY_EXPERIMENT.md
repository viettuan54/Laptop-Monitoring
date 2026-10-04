# Thử biểu diễn ngữ nghĩa cho câu tìm kiếm

Ngày 2026-10-04. Đã tạo và thử ứng viên dùng encoder câu huấn luyện sẵn
trên 192 câu hiện có, rồi so với v8 theo cùng năm cách chia dữ liệu.
Không cấu hình nào đạt điều kiện thay v8: giảm cảnh báo nhầm nhưng bỏ sót
mức cao nhiều hơn. Service vẫn mặc định dùng v5; v8 tiếp tục là ứng viên
phát triển. Không sửa nhãn/CSV và không yêu cầu thu thêm dữ liệu trong vòng này.

## Công việc theo thứ tự

| Việc | Trạng thái và kết quả |
| --- | --- |
| Tạo ứng viên ngữ nghĩa | Hoàn tất: encoder chạy CPU cục bộ, giữ nguyên trọng số; huấn luyện bộ phân loại ba nhãn. |
| So với v8 | Hoàn tất: 16 cấu hình hợp lệ trên cùng 192 câu, năm seed và năm fold mỗi seed. |
| Chọn ứng viên đạt tiêu chí | Hoàn tất đánh giá: không cấu hình nào đạt, nên chưa chọn bản thay v8. |
| Đo tốc độ/bộ nhớ và kiểm thử toàn luồng cảnh báo | Chưa chuyển sang, vì kế hoạch yêu cầu ứng viên đạt tiêu chí trước. Đã kiểm tra riêng việc nạp artifact và tính nhất quán của suy luận. |
| Kiểm thử độc lập để quyết định triển khai | Chưa thực hiện; dữ liệu hiện tại đã được dùng cho phát triển. |

## Model và cách huấn luyện

Dùng `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, một
encoder đa ngôn ngữ hỗ trợ tiếng Việt theo
[tài liệu Sentence Transformers](https://www.sbert.net/docs/sentence_transformer/pretrained_models.html#multilingual-models).
[Model card của tác giả](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
mô tả vector 384 chiều, mean pooling và độ dài tối đa 128 token.
Khóa revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, giấy phép Apache-2.0;
tải bản ONNX `model_quint8_avx2.onnx` và tokenizer về thư mục artifact bị
Git bỏ qua. Không gọi dịch vụ suy luận bên ngoài hoặc gửi query để tạo vector.

Encoder được giữ nguyên, không fine-tune với nhãn của dự án. Văn bản qua
NFKC và chuẩn hóa khoảng trắng; tính trung bình token theo attention mask
rồi chuẩn hóa vector L2. Bộ phân loại tuyến tính softmax dự đoán trực tiếp
`SAFE`, `RISK`, `HIGH_RISK`. Mean/std của đặc trưng và trọng số phân loại
chỉ được học trên phần train của từng fold.

Đã khai báo 16 cấu hình trước khi xem dự đoán: L2 `0.0001` hoặc `0.001`,
trọng số `SAFE=1` hoặc `1.5`, `RISK=1`, `HIGH_RISK=1/2/3/4`, 1.000 lượt tối ưu.
Không thêm luật từ khóa theo ID lỗi, không điều chỉnh ngưỡng sau khi xem kết quả.

Các bản nguồn giữ đúng checksum trong
[báo cáo v8](V8_QUERY_CANDIDATE_STATUS.md): 12 câu sửa nhãn trực tiếp của
`DuLieuThat1`, 99 câu `DuLieuThat2`, 81 câu `DuLieuThat3`; tổng 49 `SAFE`,
77 `RISK`, 66 `HIGH_RISK`. Seed `20261002`–`20261006`, mỗi seed gồm năm fold,
giữ 188 nhóm câu gần giống cùng fold. V8 được chấm lại trên đúng các fold này.
Không có trùng ID/văn bản chuẩn hóa với 5.594 câu tham chiếu của v5.

ID `DuLieuThat3:55` vẫn giữ `HIGH_RISK` theo nhãn người cung cấp; việc bị ép
xin lỗi hay tự lo lắng rồi xin lỗi chưa được làm rõ. Không tự đổi nhãn.

## Kết quả hợp lệ cuối cùng

Số đếm là **trung bình trên năm cách chia**, không phải số câu trong một
lượt hoặc trên một bộ test mới độc lập.

| Cấu hình | Macro-F1 | HIGH_RISK đúng /66 | HIGH_RISK hạ SAFE | SAFE cảnh báo /49 | RISK nâng HIGH_RISK /77 |
| --- | ---: | ---: | ---: | ---: | ---: |
| v8 tham chiếu | 0,7465 | 60,0 | 0,0 | 13,6 | 27,8 |
| Ngữ nghĩa có Macro-F1 cao nhất `(0.001,1.5,1)` | 0,7756 | 48,4 | 2,6 | 7,4 | 15,4 |
| Ngữ nghĩa nhận đúng mức cao nhiều nhất `(0.001,1,4)` | 0,7426 | 57,6 | 1,0 | 13,0 | 28,0 |

Bộ ba tham số trong bảng là `(L2, trọng số SAFE, trọng số HIGH_RISK)`.
Bản có Macro-F1 cao nhất được lưu để kiểm tra lại, không được đề nghị thay v8.
Trong năm lượt, bản này nhận đúng 46–50/66 mức cao và hạ 1–4 câu mức cao
thành `SAFE`. Bản nhận nhiều mức cao nhất đúng 57–59/66, nhưng cả năm lượt
đều có một câu mức cao bị hạ `SAFE`.

Điều kiện chọn đã được kiểm tra: Macro-F1 và số mức cao đúng không giảm,
lỗi mức cao hạ `SAFE` không tăng, hai loại cảnh báo nhầm không tăng,
và ít nhất một loại cảnh báo nhầm giảm. Có **0/16 cấu hình đạt**.

Với bản ưu tiên mức cao `(0.001,1,4)`, `DuLieuThat2:67` nhận đúng ở cả năm
lượt, ID `64` đúng 4/5, nhưng ID `16` vẫn bị hạ `RISK` ở cả năm lượt.
Đây là cải thiện ở vài lỗi cụ thể, chưa bù được các lỗi khác trên toàn bộ tập.
Không kết luận khả năng phân biệt vai trò/ngữ cảnh đã đạt chỉ vì một ID được sửa.

Tất cả dữ liệu và các lựa chọn cấu hình đều thuộc vòng phát triển, nên kết
quả có thiên lệch chọn cấu hình. Không có thông tin nhóm trẻ/phiên để xác
nhận độc lập theo nhóm đó; nhóm gần giống ký tự không phát hiện mọi câu
trùng ngữ nghĩa. Phép thử này đánh giá encoder giữ nguyên với đầu phân loại,
chưa đánh giá một encoder được fine-tune cho tác vụ của dự án.

## Sửa khác biệt giữa huấn luyện và suy luận

Ở lượt đầu, encoder lượng tử hóa tạo vector theo batch 16, còn runtime
xử lý từng query. Kiểm tra 192 câu phát hiện bốn nhãn khác nhau và chênh
lệch điểm tối đa 0,1318. Vì thế kết quả lượt đầu đã được đánh dấu không hợp
lệ trong artifact `vi-school-violence-semantic-query-experiment-v1` và không
dùng trong bảng so sánh cuối cùng.

Đã khóa xử lý một câu mỗi lần cho cả tạo vector huấn luyện và runtime,
thêm kiểm tra hồi quy, rồi chạy lại toàn bộ cấu hình thành
`vi-school-violence-semantic-query-experiment-v2`. Trên cả 192 câu, nhãn
runtime khớp vector huấn luyện và `predict` khớp `ThreeLabelEngine`;
chênh lệch điểm tối đa chỉ còn `4.44e-16`. Đây là kiểm tra tích hợp trên
dữ liệu phát triển, không phải điểm đánh giá chất lượng độc lập.

## Artifact và kiểm tra

Artifact cuối cùng ngoài Git:
`ai-training/artifacts/school_violence/vi-school-violence-semantic-query-experiment-v2/`.
Thư mục chứa đầu phân loại, encoder cục bộ, vector phát triển, dữ liệu
tham chiếu và báo cáo của đủ 16 cấu hình. JSON chỉ ghi ID, nhãn và thống kê;
nguyên văn query và vector được giữ trong thư mục bị Git bỏ qua.

- SHA-256 `model.json.gz`:
  `eedd83659cab1434e289dca0499b73f69d2b0a3083d6416f7bed71de921ad94d`.
- SHA-256 `evaluation_report.json`:
  `075d592be5c94ed8f48d25575a719dc3ab9f60fe5c9f0bea7e6517abfe6ea9a3`.
- SHA-256 manifest encoder:
  `15ef3534a307a40634783afb3e542948663c13db64323dbaffae92669b2dcd74`.
- SHA-256 trọng số ONNX công khai:
  `98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f`.

Môi trường riêng `.venv-semantic` đã cài NumPy `2.4.6`, ONNX Runtime
`1.30.0`, Tokenizers `0.23.2`; môi trường `.venv` cũ không bị thay thư viện.
Runtime kiểm tra checksum encoder trước khi dùng và không tự tải model.
Checksum v5/v8 không đổi. Model/report mới vẫn `deployment_eligible=false`;
cấu hình production từ chối bản chưa duyệt, bộ kiểm tra độc lập từ chối
dùng lại `DuLieuThat3` đã nằm trong train.

Bộ unit test hiện chạy 131 test: 128 đạt, ba test API bỏ qua vì thiếu
thư viện service trong môi trường `.venv`. Các kiểm tra mới bao gồm padding,
phép biến đổi chỉ học từ train fold, xử lý từng câu, nạp encoder cục bộ,
checksum, đường dẫn và tiêu chí từ chối ứng viên bỏ sót mức cao.

Các file `validation.jsonl`/`test.jsonl` trong artifact được sao chép từ
v5 để kiểm tra trùng dữ liệu tham chiếu; chúng không phải bộ câu thật mới
dùng chứng minh model ngữ nghĩa đạt yêu cầu. Các điểm softmax chưa được
hiệu chỉnh thành xác suất dự đoán đúng thực tế.

## Tái lập

Chạy từ `ai-training`; tải encoder là bước có kết nối mạng, còn huấn luyện
và suy luận sau đó chạy hoàn toàn cục bộ. Thư mục output phải mới hoặc rỗng.

```powershell
.\.venv\Scripts\python.exe -B -m venv .venv-semantic
.\.venv-semantic\Scripts\python.exe -m pip install -r .\school_violence\semantic_requirements.txt
.\.venv-semantic\Scripts\python.exe -B -m school_violence.prepare_semantic_encoder `
  --output-dir .\artifacts\school_violence\semantic-encoder-minilm-e8f8c211
$env:OPENBLAS_NUM_THREADS='1'
.\.venv-semantic\Scripts\python.exe -B -m school_violence.experiment_semantic_queries `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --encoder-dir .\artifacts\school_violence\semantic-encoder-minilm-e8f8c211 `
  --output-dir .\artifacts\school_violence\vi-school-violence-semantic-query-experiment-v2 `
  --authorized
```

Phiên bản thư viện thực tế được ghi trong report/training config để đối
chiếu; dùng đúng các phiên bản trên nếu cần tái lập môi trường đã chạy.
Lệnh huấn luyện tái lập kết quả các cấu hình. Mục `runtime_verification`
trong báo cáo đã lưu là kết quả kiểm tra riêng sau khi huấn luyện.
