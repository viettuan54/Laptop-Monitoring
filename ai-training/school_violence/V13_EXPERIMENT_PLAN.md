# V13: sửa biểu diễn sau phân tích 15 lỗi Dulieu5

Ngày 2026-10-06. Người dùng yêu cầu thực hiện lần lượt phân tích lỗi, tạo
v13, so sánh và chạy thử Agent. Kế hoạch này được ghi **trước khi huấn luyện
hoặc xem dự đoán v13**. Chỉ thử một cấu hình; giữ cả kết quả khi không đạt.

## Phân tích v12.1 đã hoàn tất

Đã đối chiếu đóng góp logit của 15 lỗi, không chỉ nhìn từ khóa:

- SAFE ID 12/21: `ctx:affected` nhận sai “chuẩn bị”; RISK ID 57 cũng nhận
  sai “bí mật” sau bỏ dấu. Đây là lỗi tách nghĩa của đặc trưng.
- SAFE ID 30: so cụm đã bỏ dấu làm nhận “dõi tiến” thành “đòi tiền”.
- RISK ID 66/74/77/84: bỏ sót danh từ chỉ người, mất vai trò ở hành vi cách
  xa từ bị, hoặc để tín hiệu hành vi không gắn người lấn át vai trò chứng kiến.
- RISK ID 38/52: đối tượng của yêu cầu/áp lực tạo chung `self_affected` như
  đối tượng bị đánh. Cả 15 ví dụ có kiểu cưỡng ép được nhận ra trong tập học
  hiện tại đều HIGH_RISK; model thiếu khả năng khái quát ranh giới này.
- RISK ID 32/58: chưa biểu diễn rõ tự ý/không đồng ý và “gây áp lực”; cụm
  học tập ảnh hưởng mạnh đến quyết định SAFE.
- ID 3/34/41: các từ phổ biến và ngữ cảnh quan hệ chưa đủ phân biệt. Không
  bảo đảm một lần sửa sẽ chữa đủ các câu này.

Chi tiết theo ID, điểm và đóng góp đặc trưng nằm ngoài Git trong
`artifacts/school_violence/v13_context_repair_20261006/baseline_error_analysis.json`.

## Phạm vi một bản sửa

Tạo thuật toán/runtime có phiên bản riêng; giữ mọi runtime cũ nguyên trạng.

1. Nhận cụm có kiểm tra dấu khi dấu hiện diện; vẫn hỗ trợ câu không dấu.
   Tách trợ từ bị khỏi chuẩn bị/thiết bị/bí mật và các nghĩa khác có dấu.
2. Mở rộng danh từ chỉ người, nối vai trò trong cùng mệnh đề thay vì cửa sổ
   ngắn. Gắn hành vi/khẩn cấp với người được nói đến; hành vi chỉ tác động
   người khác tạo đặc trưng chứng kiến thay cho tín hiệu nguy hiểm không
   phân vai. Câu có cả tác động trực tiếp lên trẻ vẫn giữ đặc trưng đó.
3. Tách người nhận yêu cầu/áp lực khỏi `self_affected` của hành vi gây hại.
   Nhận cụm “gây áp lực”; thêm biểu diễn ranh giới/đồng ý/quan điểm trong
   ngữ cảnh quan hệ. Tất cả hệ số được học từ nhãn, không tự trả nhãn.
4. Giữ đặc trưng tiền/tài sản của v12.1 và tương tác lời nói/cô lập hữu ích.
   Không tra ID, nguyên câu, đổi nhãn hay dùng luật ghi đè kết quả softmax.

## Dữ liệu và cấu hình

Huấn luyện trên đúng 282 câu đã được phép dùng ở Dulieu1–4, không thêm
Dulieu5 vào học từ vựng, IDF hoặc trọng số. Nguồn Dulieu5 chưa có khai báo
thực tế/ẩn danh riêng; chỉ dùng phân tích lỗi và so sánh phát triển cục bộ.
Giữ cả 90 câu và sáu nhãn đã được chốt trước dự đoán v12.1.
SHA Dulieu5: `0d292e9ad186f9af9a7d8bcfa3670475989df2865f550eea57c63ff1e46e7be5`.

Giữ nguyên min_df=1, context_scale=2, weights SAFE/RISK/HIGH=1,5/1/3,
L2=0,001, epochs=200, argmax. Không thử trọng số, ngưỡng hoặc seed khác.
Giữ 25 fold/5 seed đã khóa. Từ vựng/IDF/trọng số chỉ học trong phần học
của mỗi fold. Đối chứng là v12.1, phải tái lập đúng mọi dự đoán ngoài fold
và dự đoán Dulieu5 của báo cáo đã lưu. Không dùng v10 làm cổng chọn thay thế.

## Cổng chọn ứng viên phát triển

Chỉ chọn v13 khi **đồng thời**:

- Trung bình 5 lượt ngoài fold trên 282 câu: HIGH đúng/macro-F1 không giảm;
  HIGH→SAFE, SAFE cảnh báo, RISK→HIGH, RISK→SAFE không tăng so v12.1.
- Riêng Dulieu4 ngoài fold: HIGH đúng không giảm, bốn loại lỗi trên không tăng.
- Trên cả Dulieu5: giữ HIGH đúng 26/26, HIGH→SAFE=0; SAFE cảnh báo <=4,
  RISK→HIGH <=9, RISK→SAFE <=2, macro-F1 >=0,834051724137931;
  giảm nghiêm ngặt ít nhất một trong SAFE cảnh báo hoặc RISK→HIGH.

Báo từng seed, từng ID cải thiện và hồi quy; không chỉ báo trung bình.
Không yêu cầu mọi ID phải cải thiện, nhưng không giấu lỗi phát sinh.
Chấm lại phần học chỉ là chẩn đoán, không thay cổng ngoài fold.

Giữ các mốc kỹ thuật đã đặt trước ở kế hoạch Dulieu5: HIGH→SAFE=0,
recall HIGH>=95%, SAFE cảnh báo<=10%, RISK→HIGH<=15%, RISK→SAFE<=10%,
macro-F1>=0,85. Báo thêm accuracy>=90% như mục tiêu triển khai vừa đề xuất,
không coi đây là mốc lịch sử hoặc được duyệt production. Chọn ứng viên
phát triển không đồng nghĩa đạt mọi mốc này.

## Chạy thử và giới hạn

Sau so sánh, khóa artifact/báo cáo. Kiểm tra runtime/API và Agent trong
môi trường cục bộ với tài khoản/DB kiểm thử, push được thu cục bộ; không
gửi cảnh báo đến phụ huynh thật, không đổi cấu hình Agent đang sử dụng.
Kiểm tra chức năng của bản thử không chứng minh chất lượng nhãn.

Nếu v13 không đạt, giữ v12.1 làm ứng viên đã chọn, lưu bản v13 bị loại
và vẫn kiểm tra chức năng bản thử để phát hiện lỗi triển khai. Không mở
vòng v13.1 hoặc tìm cấu hình mới sau xem kết quả trong lượt này.

Dulieu5 đã được xem để thiết kế v13 nên điểm v13 trên đó là kiểm tra phát
triển, dù các câu không tham gia học trọng số. Không công bố test thực tế
độc lập hoặc cải thiện tổng quát chỉ từ bộ này. Model mặc định v5 và
`deployment_eligible=false` giữ nguyên.
