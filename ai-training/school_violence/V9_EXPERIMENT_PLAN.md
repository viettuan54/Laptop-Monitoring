# Vòng sửa v9 sau Dulieu4

Chốt ngày 2026-10-05, trước khi chạy các phương án v9. Người dùng yêu cầu
thực hiện kế hoạch sửa model bằng 20 lỗi Dulieu4 và kiểm tra luồng cảnh báo.
Giữ nguyên nhãn và nội dung đã xác nhận, kể cả ID 82 là `RISK`.

## Dữ liệu và nguyên nhân cần kiểm tra

Dùng đủ 192 câu phát triển trước và 90 câu Dulieu4, tổng 282 câu:
79 `SAFE`, 108 `RISK`, 95 `HIGH_RISK`. Dulieu4 chuyển thành dữ liệu phát triển
của v9. Không lấy điểm học lại trên 90 câu làm điểm kiểm thử độc lập.
CSV Dulieu4 phải khớp SHA-256
`e504cc10089cc135d19e59fe4d4ea3407abb7de028d68d9031899c71023f7587`.

V8 bỏ đặc trưng chỉ xuất hiện một lần (`min_df=2`). Phân tích trước thử nghiệm
cho thấy ID 66 chỉ có 17/38 đặc trưng từng học, ID 83 có 18/39 và ID 90 có
20/48. Một số cụm chỉ nguy hiểm xuất hiện một lần trong dữ liệu cũ đã bị bỏ;
một số cụm khác chưa xuất hiện. Đây là giới hạn từ vựng, không phải lỗi vận
chuyển nhãn. Không thêm quy tắc gắn nhãn theo ID hoặc chép nguyên câu vào mã.

## Sáu cấu hình cố định

| Tên | Đặc trưng | min_df | Trọng số SAFE/RISK/HIGH_RISK |
| --- | --- | ---: | --- |
| word_df2 | Từ đơn và cặp từ như v8 | 2 | 1,5 / 1 / 3 |
| word_df1 | Giữ cả đặc trưng xuất hiện một lần | 1 | 1,5 / 1 / 3 |
| hybrid_df2 | Từ và chuỗi 3–5 ký tự, hệ số ký tự 0,25 | 2 | 1,5 / 1 / 3 |
| hybrid_df1 | Từ và chuỗi 3–5 ký tự, hệ số ký tự 0,25 | 1 | 1,5 / 1 / 3 |
| word_df1_safe2 | Từ đơn và cặp từ | 1 | 2 / 1 / 3 |
| hybrid_df1_safe2 | Từ và chuỗi 3–5 ký tự, hệ số ký tự 0,25 | 1 | 2 / 1 / 3 |

Giữ L2=0,001, 200 lượt tối ưu, chọn nhãn bằng argmax, không thử thêm ngưỡng.
Từ vựng, IDF và trọng số được học chỉ từ phần huấn luyện của từng fold.

## Cách so sánh và chọn

Chạy 5 fold ngoài ở 5 seed `20261002`–`20261006`, nhóm các câu gần trùng
ký tự từ 0,85 trở lên. Trong từng fold ngoài, chọn cấu hình bằng 5 fold trong
của riêng phần huấn luyện. So với công thức v8 được huấn luyện lại trên
**cùng phần dữ liệu**, chỉ chọn phương án khi không giảm số mức cao nhận đúng,
không tăng mức cao về `SAFE`, không tăng cảnh báo `SAFE`, `RISK` lên mức cao
hoặc `RISK` về `SAFE`, và không giảm macro-F1. Phải cải thiện ít nhất một chỉ
số; ưu tiên giảm mức cao về `SAFE`, tăng mức cao đúng, rồi giảm cảnh báo nhầm.
Không có phương án đạt thì giữ công thức v8.

Áp dụng cùng điều kiện trên trung bình kết quả ngoài fold để chấp nhận quy
trình chọn cấu hình. Chọn cấu hình cuối bằng CV trên cả 282 câu với seed
`20261007` nếu quy trình đạt; nếu không đạt, học v9 bằng công thức v8 và dữ
liệu mở rộng. Cả hai trường hợp chỉ tạo ứng viên cục bộ chưa được triển khai.
Không sửa cấu hình để đuổi theo điểm ngoài fold sau lượt thử này.

Ghi riêng kết quả ngoài fold của Dulieu4, trạng thái ID 66/83/90 và kết quả
học lại các lỗi cũ. V8 đã khóa vẫn được chấm lại như mốc lịch sử, nhưng đã học
192 câu cũ nên không so điểm của nó trên 282 câu với điểm ngoài fold của v9.
Kiểm tra test tổng hợp cũ chỉ là hồi quy, không phải kiểm thử thực tế độc lập.

## Luồng ứng dụng và đánh giá cuối

Sau khi khóa artifact, kiểm tra suy luận/HTTP API nhất quán, hàng đợi Agent,
gửi lại khi lỗi kết nối, chống trùng và API phụ huynh. Kiểm tra web bằng bộ
smoke hiện có. Dùng database và tài khoản kiểm thử, ghi nhận push cục bộ.

Các tiêu chí trên là tiêu chí **chọn ứng viên phát triển**, không phải cổng
duyệt production. Chỉ đánh giá cuối khi có bộ thực tế chưa dùng học/chọn
cấu hình, đã chốt nhãn trước dự đoán. Không gọi dữ liệu cũ hoặc câu tự tạo là
bộ độc lập. Nếu workspace chưa có bộ đáp ứng, ghi rõ bước này còn chờ và
hoàn thành việc khóa, kiểm chứng ứng viên trước; không tự bật cảnh báo thật.
