# V11: sửa đặc trưng cụm từ và vai trò

Chốt ngày 2026-10-06 trước khi chấm v11. Dùng đúng 282 câu và nhãn đã được
xác nhận, không thêm câu, đổi nhãn, loại lỗi hoặc dùng lại dữ liệu phát triển
làm test độc lập. Mục tiêu sửa ngữ cảnh học tập, chứng kiến người khác bị tác
động và áp lực chưa mô tả đe dọa/hành vi trực tiếp. Đây là bộ trích xuất đặc
trưng có giới hạn, không phải bộ phân tích ngữ nghĩa đầy đủ.

Chỉ thử **một** biến thể đặc trưng v11. Giữ cấu hình cuối v10:
TF-IDF từ/cặp từ min_df=1, đặc trưng ngữ cảnh hệ số 2,
SAFE/RISK/HIGH_RISK=1,5/1/3, L2=0,001, 200 lượt tối ưu, argmax.
Không tìm thêm trọng số, ngưỡng hoặc seed sau khi thấy kết quả.

- Loại ý nghĩa bạo lực của từ nằm trong cụm học tập/thể thao đã xác định;
  vẫn nhận hành vi thật ở vị trí khác trong cùng câu.
- Gắn vai trò với hành vi trong phạm vi cụm/mệnh đề: bản thân bị tác động,
  người khác bị tác động, chứng kiến. Có “mình” ở đầu câu không tự tạo
  đặc trưng bản thân là nạn nhân của mọi hành vi.
- Mô tả áp lực cùng đối tượng/yếu tố hậu quả, giữ đặc trưng nguy hiểm trực
  tiếp khi có. Tất cả hệ số được học; không có quy tắc trả nhãn hay tra ID.
- Dùng algorithm/version mới; giữ nguyên bộ trích xuất và artifact v10.

Đối chứng là **cấu hình cuối v10 cố định**, học lại trên cùng phần học của
25 fold ngoài đã khóa (5 seed x 5 fold). Kiểm tra tái lập với audit cấu hình
cố định v10. Không so điểm này với điểm quy trình chọn lồng nhau v10 như
thể đó là cùng phép đo. Từ vựng/IDF/trọng số chỉ học trong phần học mỗi fold.

Chỉ chọn v11 khi trung bình trên cùng 282 câu:

1. HIGH_RISK nhận đúng không giảm; HIGH_RISK về SAFE không tăng
   (đối chứng hiện bằng 0 nên chỉ yêu cầu giữ 0).
2. SAFE bị cảnh báo và RISK về SAFE không tăng; macro-F1 không giảm.
3. RISK lên HIGH_RISK giảm, hoặc SAFE bị cảnh báo giảm.
4. Riêng Dulieu4: không tăng SAFE bị cảnh báo/HIGH về SAFE/RISK về SAFE,
   không giảm HIGH nhận đúng; RISK lên HIGH không tăng.

Theo dõi riêng ID 30/35/57/82 và 66/83/90 cả ngoài fold lẫn sau học. Lượt
chấm sau học chỉ giúp rà lỗi, không thay tiêu chí ngoài fold. Giữ cả kết quả
thất bại và mọi lỗi mới. Nếu không đạt, giữ v10 làm ứng viên hiện hành.

Sau chấm: kiểm tra artifact và API/luồng Agent → backend → phụ huynh bằng
model thử v11, dù ứng viên có đạt tiêu chí phát triển hay không. Luồng chức
năng đúng không chứng minh chất lượng phân loại. Giữ deployment_eligible=false
và model mặc định v5. Chưa có test thực tế mới độc lập; không triển khai thật
chỉ dựa trên các lượt dùng lại dữ liệu này.
