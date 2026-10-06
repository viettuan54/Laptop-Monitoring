# Thử giảm bỏ sót và cảnh báo sai sau v9

Chốt ngày 2026-10-05 trước khi chạy v10. Giữ đủ 282 câu và nhãn đã xác nhận;
không thêm dữ liệu tự tạo, đổi nhãn hoặc loại các lỗi khỏi kết quả. V9 đã khóa
là mốc đối chiếu. Đây là dữ liệu phát triển đã được xem, không phải test độc lập.

## Thay đổi có mục tiêu

Bổ sung đặc trưng mô tả vai trò và hành vi: trải nghiệm bản thân, bị tác động,
chứng kiến, câu hỏi chung, hành vi thể chất/đe dọa/ép tiền/ép buộc, tiết lộ,
trêu chọc, cô lập, lặp lại và khẩn cấp. Đặc trưng chỉ là đầu vào học: không
cụm nào tự gắn nhãn, không có luật hoặc tra cứu theo ID/câu đầy đủ. Trọng số
và từ vựng vẫn học riêng trong phần huấn luyện mỗi fold. Các khái niệm được
thiết kế từ hướng dẫn gán nhãn và lỗi đã xem, nên kết quả vẫn có thiên lệch
phát triển; không gọi phần giữ ngoài fold là dữ liệu chưa từng được biết.

Thử bộ ba nhãn có đặc trưng ngữ cảnh và kiến trúc nhận diện HIGH_RISK trước,
sau đó SAFE/RISK. Cách này khác thử cũ SAFE/ALERT rồi RISK/HIGH_RISK. Mục tiêu
là tránh để từ chung về học tập che hành vi nguy hiểm và học riêng ranh giới
giữa áp lực nhẹ với nguy cơ cao.

## Tám phương án cố định

Tất cả giữ L2=0,001, 200 lượt tối ưu. Đặc trưng từ đơn/cặp từ, min_df=1 ở
đầu ba nhãn/đầu HIGH_RISK, min_df=2 ở đầu SAFE/RISK; đặc trưng ngữ cảnh có
hệ số 2, được lưu trong IDF để runtime dùng đúng phép chuẩn hóa.

| Phương án | Trọng số | Ngưỡng HIGH_RISK |
| --- | --- | ---: |
| flat_context_high2 | SAFE/RISK/HIGH=1,5/1/2 | Argmax |
| flat_context_high3 | SAFE/RISK/HIGH=1,5/1/3 | Argmax |
| high_context_1.5_045 | OTHER/HIGH=1/1,5; SAFE/RISK=1,5/1 | 0,45 |
| high_context_1.5_050 | Như trên | 0,50 |
| high_context_1.5_055 | Như trên | 0,55 |
| high_context_2_050 | OTHER/HIGH=1/2; SAFE/RISK=1,5/1 | 0,50 |
| high_context_2_055 | Như trên | 0,55 |
| high_words_1.5_050 | OTHER/HIGH=1/1,5; SAFE/RISK=1,5/1; chỉ từ | 0,50 |

Đối chứng cuối giúp phân biệt ảnh hưởng của thứ tự phân loại và đặc trưng
ngữ cảnh. Ngưỡng là điểm quyết định, không được hiểu là xác suất đã hiệu chỉnh.

## Chọn và kiểm tra

Dùng lại đúng 25 fold ngoài của báo cáo v9 đã khóa: 5 seed, 5 fold mỗi seed,
nhóm gần trùng ký tự 0,85. Trong mỗi fold ngoài, 5 fold trong của riêng phần
học chọn cấu hình. V9 học lại trên cùng phần dữ liệu làm đối chứng. Câu giữ
ngoài không được tham gia học từ vựng/IDF/trọng số hoặc chọn cấu hình/ngưỡng.

Trong fold trong: không giảm HIGH nhận đúng, không tăng HIGH về SAFE, cảnh
báo SAFE, RISK lên HIGH, RISK về SAFE hoặc giảm macro-F1; phải giảm ít nhất
một trong HIGH về SAFE/RISK lên HIGH. Ưu tiên giảm HIGH về SAFE, tăng HIGH
đúng, rồi giảm RISK lên HIGH và cảnh báo SAFE. Không có phương án đạt thì
giữ v9 cho fold đó.

Chỉ chấp nhận quy trình khi trung bình ngoài fold **giảm cả HIGH về SAFE và
RISK lên HIGH**, đồng thời giữ các điều kiện không làm xấu khác. Chọn cấu
hình cuối bằng cùng quy trình trong fold trên cả 282 câu, seed 20261007.
Chỉ tạo ứng viên v10 khi quy trình đạt và cấu hình cuối khác v9. Không chọn
một phương án theo riêng điểm ngoài fold hoặc tiếp tục tìm ngưỡng sau kết quả.

Ghi riêng ID 66/83/90 và 32/35/50/57 ngoài phần học, không dùng chúng làm
luật dự đoán. Kiểm tra artifact lưu/nạp/API/Agent/phụ huynh nếu chọn được
v10; giữ model mặc định và trạng thái chưa triển khai. Dữ liệu hiện tại đủ
chạy vòng sửa này; một test thực tế độc lập vẫn cần trước khi bật cảnh báo thật.
