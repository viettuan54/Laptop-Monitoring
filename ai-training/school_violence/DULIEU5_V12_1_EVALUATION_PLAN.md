# Kiểm thử v12.1 trên Dulieu5 — kế hoạch trước dự đoán

Ngày 2026-10-06. Kế hoạch được ghi sau khi đọc nội dung/nhãn và trước khi
chạy bất kỳ dự đoán v12.1 nào trên Dulieu5. Mục tiêu là đo bỏ sót nguy hiểm
và cảnh báo sai trên bộ mới, không dùng bộ này để chọn cấu hình hoặc ngưỡng.

## Dữ liệu và model cố định

- Nguồn ban đầu: `Mô tả/Dulieu5.csv`, 90 câu, ba cột `id,text,label`;
  SAFE/RISK/HIGH_RISK mỗi nhãn 30 câu.
- SHA-256 ban đầu: `0569b01184d31ba2b776ac44e951f95c55d0cbf80a2070da98819771c1c7fc53`.
- Model: `vi-school-violence-financial-context-v12-1-query-candidate`.
- SHA-256 model: `cfc5f953afdaf8bce621ee0ba2f8d6da57b45467449e774464b0a434ef1dc8cb`.
- Dùng [khóa v12.1](query_v12_1_candidate.lock.json), giữ nguyên thuật toán,
  đặc trưng, trọng số và cách chọn argmax. Không chạy các ứng viên khác để
  chọn model theo kết quả trên Dulieu5.
- Snapshot nguồn và tiền kiểm nằm trong artifact cục bộ, không đưa nguyên
  văn câu tìm kiếm vào báo cáo được theo dõi bằng Git.

## Chốt dữ liệu trước chấm

Kiểm tra đủ ba nhãn, ID duy nhất, câu không rỗng, giới hạn đầu vào service,
dấu hiệu định danh rõ và câu trùng sau chuẩn hóa. Đối chiếu các split của
artifact cùng toàn bộ 364 câu đã xem ở Dulieu1–4, kể cả 82 câu Dulieu1 không
được dùng huấn luyện. Gần trùng được đánh dấu khi độ giống ký tự >= 0,85;
kiểm tra này không chứng minh độc lập về nghĩa hoặc theo trẻ/phiên.

Xác nhận nguồn thực tế/tự soạn và việc ẩn danh, quyền sử dụng, nhãn chốt
trước dự đoán là thông tin người cung cấp khai báo, không do code xác thực.
Chỉ gọi là kiểm thử thực tế độc lập khi đủ thông tin và không còn vấn đề
trùng lặp/nhãn chờ chốt. Nếu là bộ tự soạn, ghi đúng nguồn đó trong kết quả.

Trước dự đoán đã phát hiện sáu nhãn cần người cung cấp chốt theo
[hướng dẫn hiện tại](ANNOTATION_GUIDE.md):

- ID 66, 71, 74, 77, 84: đang HIGH_RISK, vai trò chứng kiến/nguy hiểm với
  người khác; hướng dẫn hiện tại là RISK khi chưa nói chính trẻ bị tác động.
- ID 43: đang RISK, có đe dọa tiết lộ chuyện riêng để buộc làm bài hộ;
  hướng dẫn hiện tại xếp đe dọa như vậy vào HIGH_RISK.

Không tự thay các nhãn này. Lưu quyết định và checksum phiên bản chốt trước
khi chấm. Giữ đủ 90 câu; không bỏ câu khó hoặc câu trái dự đoán. Nếu người
cung cấp giữ ngoại lệ, ghi rõ ngoại lệ và giới hạn diễn giải theo chính sách.

## Tiêu chí đo và mốc kỹ thuật đặt trước

Ưu tiên báo số lượng thực tế cùng mẫu số, theo nhãn người cung cấp chốt:

| Chỉ số | Mốc kỹ thuật cho lượt kiểm thử này |
| --- | ---: |
| HIGH_RISK bị trả SAFE, mất toàn bộ cảnh báo | 0 câu |
| Recall HIGH_RISK, nhận đúng mức cao / toàn bộ mức cao | >= 95% |
| SAFE bị trả RISK hoặc HIGH_RISK / toàn bộ SAFE | <= 10% |
| RISK bị nâng HIGH_RISK / toàn bộ RISK | <= 15% |
| RISK bị trả SAFE / toàn bộ RISK | <= 10% |
| Macro-F1, trung bình F1 ba nhãn | >= 0,85 |

Đây là mốc kỹ thuật do người thực hiện đặt **trước khi xem dự đoán**, nhằm
tránh đổi tiêu chí theo điểm số. Chúng chưa phải ngưỡng phát hành được
người dùng phê duyệt hoặc tiêu chuẩn bảo đảm an toàn. Tất cả mốc phải đạt
mới ghi “đạt mốc kỹ thuật của bộ này”; không tự duyệt triển khai khi đạt.
Với khoảng 30 câu mỗi nhãn, chỉ một lỗi đã thay đổi tỷ lệ khoảng 3 điểm
phần trăm. Báo khoảng Wilson 95% cho các tỷ lệ theo câu, kèm giới hạn rằng
độc lập theo trẻ/phiên chưa được xác minh. Không suy tỷ lệ cảnh báo ngoài
thực tế từ bộ dữ liệu cân bằng ba nhãn này.

## Cách chạy và báo cáo

1. Lưu nguyên bản CSV, quyết định chốt nhãn/nguồn và kế hoạch này; kiểm tra
   checksum trước khi dự đoán. Nếu có sửa nguồn, giữ cả lịch sử ban đầu.
2. Chạy `evaluate_query_csv` với `--candidate-lock` trỏ đúng khóa v12.1;
   dùng `--require-independent` khi nguồn thực tế đủ điều kiện.
3. Chấm toàn bộ câu một lần bằng model cố định; kiểm tra dự đoán/điểm CLI
   khớp engine service. Đánh giá chính thức phải khớp ma trận CSV khi áp dụng.
4. Báo ma trận ba nhãn, accuracy, precision/recall/F1, các mốc trên, từng ID
   sai và loại lỗi. Tách bỏ sót mức cao về RISK với bỏ sót về SAFE.
5. Kiểm tra lại checksum nguồn/model/khóa. Giữ model mặc định và
   `deployment_eligible=false`; ghi kết luận tiếp theo theo lỗi quan sát được.

Không huấn luyện lại hoặc chỉnh ngưỡng trong lượt kiểm thử này. Nếu sau đó
dùng Dulieu5 để sửa model, bộ này trở thành dữ liệu phát triển cho bản sửa;
không tiếp tục gọi điểm trên chính bộ đó là kiểm thử độc lập của bản sửa.

Evaluator hiện ghi `formal_acceptance_thresholds_predeclared=false` vì chưa
có ngưỡng phát hành được phê duyệt. Báo cáo bổ sung phải ghi rõ các **mốc
kỹ thuật của kế hoạch này** và kết quả từng mốc; không đổi ý nghĩa trường
duyệt phát hành hoặc sửa kết quả gốc để coi model đã được phép triển khai.
