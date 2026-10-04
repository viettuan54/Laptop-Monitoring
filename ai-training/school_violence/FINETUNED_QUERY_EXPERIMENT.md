# Tinh chỉnh hai lớp cuối MiniLM cho câu tìm kiếm

Ngày 2026-10-04. Đã tinh chỉnh một phần encoder trên 192 câu hiện có và
so sánh với v8 trên cùng năm cách chia dữ liệu. Bốn cấu hình đều giảm
một số cảnh báo nhầm nhưng nhận đúng mức cao ít hơn v8, đồng thời có lỗi
`HIGH_RISK` bị hạ thành `SAFE`. Không chọn bản nào thay v8; model mặc định
vẫn là v5 và artifact thử vẫn `deployment_eligible=false`.

## Công việc đã thực hiện

| Việc | Kết quả |
| --- | --- |
| Tinh chỉnh encoder | Hoàn tất: học lại hai lớp cuối và bộ phân loại; giữ embeddings và mười lớp đầu cố định. |
| So với v8 | Hoàn tất: bốn cấu hình, năm seed, năm fold mỗi seed, cùng bản nhãn đã dùng cho v8. |
| Bổ sung thư viện/chạy test API | Hoàn tất: cả ba test API đạt; toàn bộ 131 test chung đạt, không có test bỏ qua. |
| Kiểm tra mã tinh chỉnh | Năm test riêng đạt; bản lưu suy luận nhất quán trên 192 câu. |
| Đo tốc độ, bộ nhớ và kiểm thử toàn luồng cảnh báo | Chưa chuyển sang, vì điều kiện có ứng viên đạt tiêu chí chưa được đáp ứng. |
| Kiểm thử độc lập để quyết định triển khai | Chưa thực hiện; dữ liệu hiện có thuộc vòng phát triển. |

## Phạm vi tinh chỉnh

Dùng trọng số gốc Float32/Safetensors của
[`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2),
khóa revision `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, giấy phép Apache-2.0.
Đây là bước tiếp sau [phép thử encoder giữ nguyên](SEMANTIC_QUERY_EXPERIMENT.md).

Máy có khoảng 7,78 GiB RAM tổng và ít RAM trống khi bắt đầu, nên chọn chạy
CPU với hai luồng, batch bốn câu và chỉ tinh chỉnh hai lớp cuối. Tổng
3.550.083 tham số được học: 3.548.928 của encoder và 1.155 của bộ phân loại.
Đây là tinh chỉnh một phần, không phải học lại toàn bộ encoder.

Mười lớp đầu cố định được dùng để tạo cache biểu diễn token. Chúng không
nhận nhãn hoặc cập nhật trọng số, nên có thể tạo cache trước các fold.
Sau khi tạo cache, giải phóng phần encoder lớn trong quá trình huấn luyện.
Hai lớp cuối tiếp tục biến đổi biểu diễn token, rồi mean pooling theo
attention mask và chuẩn hóa L2 để dự đoán ba nhãn.

Đầu phân loại được khởi tạo bằng bộ phân loại tuyến tính học từ chính
phần train của từng fold. Mean/std và trọng số khởi tạo đó chỉ dùng các
câu train. Sau đó AdamW cập nhật hai lớp encoder cuối và đầu phân loại
bằng nhãn của phần train; không đưa câu ngoài fold vào việc học.

Bốn cấu hình được khai báo trước: learning rate encoder `1e-5` hoặc
`3e-5`, trọng số `HIGH_RISK=3` hoặc `5`; `SAFE=1.5`, `RISK=1`.
Giữ bốn epoch, learning rate đầu phân loại `1e-4`, gradient clip `1.0`.
Không chọn epoch tốt nhất trên phần đánh giá ngoài fold và không thay
ngưỡng quyết định sau khi xem dự đoán. Các seed cho shuffle/dropout được
ghi cố định theo seed/fold; chạy trên CPU Float32 với thuật toán xác định.

Không sửa CSV hoặc nhãn. Dữ liệu vẫn là 12 câu sửa nhãn trực tiếp của
`DuLieuThat1`, 99 câu `DuLieuThat2`, 81 câu `DuLieuThat3`: 49 `SAFE`,
77 `RISK`, 66 `HIGH_RISK`. Checksum nguồn giữ đúng
[bản v8](V8_QUERY_CANDIDATE_STATUS.md). ID `DuLieuThat3:55` giữ `HIGH_RISK`
theo nhãn người cung cấp, ngữ cảnh ép xin lỗi vẫn chưa được làm rõ.

Năm seed `20261002`–`20261006`, mỗi seed năm fold, giữ 188 nhóm câu gần
giống cùng fold. V8 được chấm lại trên đúng các fold này. Không có trùng
ID/văn bản chuẩn hóa với 5.594 câu tham chiếu của v5. Không có dữ liệu nhóm
trẻ/phiên để xác nhận độc lập theo các nhóm đó.

## Kết quả và quyết định

Các số đếm là **trung bình của năm cách chia**, không phải số câu trong
một lượt hoặc điểm trên một bộ kiểm thử độc lập mới.

| Cấu hình | Macro-F1 | HIGH_RISK đúng /66 | HIGH_RISK hạ SAFE | SAFE cảnh báo /49 | RISK nâng HIGH_RISK /77 |
| --- | ---: | ---: | ---: | ---: | ---: |
| v8 tham chiếu | 0,7465 | 60,0 | 0,0 | 13,6 | 27,8 |
| Encoder LR `1e-5`, HIGH weight `3` | 0,7596 | 53,4 | 1,8 | 9,8 | 21,4 |
| Encoder LR `3e-5`, HIGH weight `3` | 0,7589 | 51,4 | 1,6 | 9,8 | 18,6 |
| Encoder LR `1e-5`, HIGH weight `5` | 0,7545 | 55,4 | 1,6 | 10,2 | 24,2 |
| Encoder LR `3e-5`, HIGH weight `5` | 0,7618 | 53,2 | 1,6 | 10,0 | 20,0 |

Bản cuối bảng có Macro-F1 cao nhất nên được lưu để kiểm tra lại; nó
không được đề nghị thay v8. Bản nhận đúng mức cao nhiều nhất vẫn kém
v8 trung bình 4,6 câu và có trung bình 1,6 câu mức cao bị hạ `SAFE`.

Tiêu chí chọn yêu cầu đồng thời: Macro-F1/số mức cao đúng không giảm,
lỗi mức cao hạ `SAFE` không tăng, hai loại cảnh báo nhầm không tăng và
ít nhất một loại cảnh báo nhầm giảm. Có **0/4 cấu hình đạt**.

Ở bản nhận mức cao tốt nhất, `DuLieuThat2:16` và `:64` chỉ nhận đúng 1/5
lượt; ID `67` đúng 4/5. Một số lượt đã sửa được lỗi cụ thể, nhưng kết quả
chung chưa đạt. Không tự sửa nhãn hoặc thêm luật theo ID để làm đẹp điểm.

Mọi dữ liệu và lựa chọn cấu hình thuộc vòng phát triển. Chọn cấu hình
trên chính các fold này tạo thiên lệch; không xem một lượt tốt nhất hoặc
dự đoán trên tập train là bằng chứng model đã hoàn thiện. Phép thử này
chưa đánh giá việc học lại toàn bộ encoder, nhiều epoch hơn hay dữ liệu mới.
Điểm softmax chưa được hiệu chỉnh thành xác suất dự đoán đúng thực tế.

## Artifact, suy luận và test

Artifact cục bộ ngoài Git:
`ai-training/artifacts/school_violence/vi-school-violence-partial-minilm-query-experiment-v1/`.
Thuật toán `partial_minilm_finetuned_query_v1`. Artifact chứa trọng số
gốc, hai lớp đã tinh chỉnh/đầu phân loại, cache token phát triển và báo cáo.
Runtime nạp file cục bộ đã kiểm tra checksum, không tự tải model hoặc gửi
query ra dịch vụ bên ngoài.

- SHA-256 `model.json.gz`:
  `a0b695bb156f32a34de1f3dcf76d3d37cd3822fed4cf70a5714c28a3f890837b`.
- SHA-256 `adapted_tail.safetensors`:
  `a6664b22a457ec1d0075f227af45c396162af731b02ef380265642ace7518bcc`.
- SHA-256 `evaluation_report.json`:
  `30b73eaf42b3e8b915f475811dce32b89b0950b69652e4009e7c6e76b7f58aa4`.
- SHA-256 manifest trọng số gốc:
  `57003a3a544c14ffe78bf597eae6ccd8e05556631721eeceebbdfa566cadb7d4`.
- SHA-256 Safetensors gốc:
  `eaa086f0ffee582aeb45b36e34cdd1fe2d6de2bef61f8a559a1bbc9bd955917b`.

JSON chỉ ghi thống kê và ID/nhãn. Query nguyên văn và cache biểu diễn chỉ
ở thư mục Git bỏ qua. `validation.jsonl`/`test.jsonl` sao chép từ v5 phục
vụ kiểm tra trùng tham chiếu; chúng không phải bộ câu thật mới của phép thử.

Đã kiểm tra suy luận từng câu trên cả 192 câu: `predict` khớp
`ThreeLabelEngine`, nhãn khớp lúc huấn luyện bản cuối và chênh lệch điểm
giữa cache tiền tố với suy luận lại là 0. Đây là kiểm tra tích hợp dữ liệu
phát triển, không phải phép đo độ chính xác độc lập. Bộ kiểm tra từ chối
dùng lại `DuLieuThat3` làm holdout và cấu hình production từ chối artifact
chưa được duyệt. Checksum v5/v8 không đổi.

131 test chung chạy và đạt trong `.venv`, gồm cả ba test API trước đây
bị bỏ qua; xem [bản kiểm tra API](../text_safety/API_TEST_STATUS_20261004.md).
Năm test riêng chạy và đạt trong `.venv-semantic`: cập nhật tail nhưng
không sửa trọng số khởi tạo, loại câu ngoài fold khỏi train, padding,
roundtrip Safetensors và kiểm tra quyền/phạm vi output. Tổng 136 test
ở hai nhóm kiểm tra, không có test bị bỏ qua trong các lượt này.

## Tái lập

Chạy từ `ai-training`, các CSV phải giữ checksum và output phải mới/rỗng.
Phần tải thư viện/trọng số cần mạng; việc huấn luyện/suy luận chạy cục bộ.

```powershell
.\.venv-semantic\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.\.venv-semantic\Scripts\python.exe -m pip install -r .\school_violence\finetune_requirements.txt
.\.venv-semantic\Scripts\python.exe -B -m school_violence.prepare_finetune_encoder `
  --output-dir .\artifacts\school_violence\finetune-base-minilm-e8f8c211
$env:OPENBLAS_NUM_THREADS='1'
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
.\.venv-semantic\Scripts\python.exe -B -m school_violence.experiment_finetuned_queries `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --encoder-dir .\artifacts\school_violence\finetune-base-minilm-e8f8c211 `
  --output-dir .\artifacts\school_violence\vi-school-violence-partial-minilm-query-experiment-v1 `
  --authorized
.\.venv-semantic\Scripts\python.exe -B -m unittest discover -s tests_finetune -v
```

Phiên bản thực tế: PyTorch `2.14.1+cpu`, Transformers `4.57.6`, Safetensors
`0.8.0`, Tokenizers `0.22.2`, NumPy `2.4.6`. Cài đúng phiên bản nếu cần tái
lập môi trường đã chạy. Transformers giới hạn phiên bản Tokenizers nên
môi trường `.venv-semantic` hiện dùng `0.22.2`; các report cũ vẫn ghi phiên
bản thực tế ở thời điểm của chúng.

Report lưu checksum nguồn, code, thư viện, fold theo ID và đủ bốn cấu hình.
Lệnh huấn luyện tái lập phép so sánh; mục `runtime_verification` và kết quả
unit test trong report đã lưu được bổ sung sau các kiểm tra riêng.
