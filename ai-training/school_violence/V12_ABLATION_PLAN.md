# V12 bước 1: kiểm tra từng nhóm đặc trưng

Chốt ngày 2026-10-06 trước khi chạy ablation. Giữ 282 câu, nhãn, CSV,
provenance và 25 fold đã khóa; dùng lại dữ liệu phát triển đã xem.
Không thêm câu, đổi nhãn, bỏ lỗi hoặc gọi đây là test độc lập.

Bốn profile: v11_full, omit_academic, omit_roles, omit_pressure. Học lại
từng profile trên phần học mỗi fold; giữ min_df=1, context scale=2,
SAFE/RISK/HIGH=1,5/1/3, L2=0,001, epochs=200, argmax. Không tìm thêm trọng số,
ngưỡng hoặc seed. Đối chứng v10 cố định và v11 đầy đủ phải tái lập các báo
cáo đã khóa. Đây là kiểm tra nhóm feature, chưa chọn model để triển khai.

Các nhóm tắt là nhóm **đặc trưng đầu vào**, không tắt bộ tách mệnh đề hoặc
nhận cụm từ. Phân nhóm không trùng nhau, ưu tiên pressure, academic, roles:

- pressure: ctx:pressure, mọi kết hợp +pressure, các ctx:pressure+*.
- academic: ctx:academic_action và mọi kết hợp +academic_action.
- roles: ctx:self_reference/affected/witness/self_affected/other_affected,
  các kết hợp bắt đầu bằng những vai trò này chưa thuộc nhóm trên.
- Những feature khác và từ/cặp từ giữ nguyên.

Theo dõi macro-F1, HIGH nhận đúng/về SAFE, SAFE cảnh báo, RISK lên HIGH/
về SAFE; riêng Dulieu4 và ID 30/35/57/82/66/83/90/32/50. Giữ danh sách mọi
lỗi phát sinh. Kiểm tra sự tách biệt phần học/ngoài học trên từng fold.

Sau khi có kết quả, chốt **riêng** kế hoạch sửa nhóm gây nhầm, trước khi
chấm bản sửa. Không chọn trọng số/ngưỡng từ ablation. Tiêu chí phát triển
vẫn như v11: không giảm HIGH nhận đúng/macro-F1 hoặc tăng HIGH về SAFE,
SAFE cảnh báo, RISK lên HIGH/về SAFE, đồng thời giảm ít nhất một loại cảnh
báo sai; kiểm tra các giới hạn tương ứng trên Dulieu4.

Nếu có bản sửa đạt, kiểm tra chức năng và chuyển sang test thực tế độc lập
khi có bộ mới hợp lệ. Không sử dụng lại CSV hiện tại làm test mới và không
duyệt production chỉ bằng ablation này.
