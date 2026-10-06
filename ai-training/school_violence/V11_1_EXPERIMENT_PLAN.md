# V11.1: giữ riêng bản sửa cụm từ

Chốt ngày 2026-10-06, **sau** khi đã thấy v11 đầy đủ không đạt, **trước** khi
chấm bản v11.1. Đây là vòng sửa tiếp theo, không sửa kế hoạch hoặc báo cáo
v11 ban đầu. Báo cáo v11 và snapshot mã gốc được giữ ở artifact riêng.

V11 đầy đủ: SAFE cảnh báo 12,4 → 10,8, nhưng RISK lên HIGH 36 → 38 và HIGH
nhận đúng 92,8 → 92,6. ID 30 cải thiện ngoài fold; ID 82 chỉ cải thiện sau
học. Vì vậy không thay v10 bằng toàn bộ bộ đặc trưng vai trò/áp lực v11.

Chỉ thử **một** bản sửa hẹp: giữ toàn bộ đặc trưng v10, chỉ bỏ đặc trưng
physical và các kết hợp physical khi câu có cụm học tập/thể thao xác định
và không có hành vi thể chất thật ở vị trí khác. Không thêm vai trò/áp lực
mới vào bản này. Câu có cả học tập và hành vi thật vẫn giữ tín hiệu physical.
Không có trả nhãn theo cụm từ, ID hay nguyên câu.

Giữ nguyên trọng số, min_df, context scale, tối ưu, 25 fold và tiêu chí của
[v11](V11_EXPERIMENT_PLAN.md). Không thử thêm cấu hình/ngưỡng/seed. So với
v10 cố định; không so với quy trình chọn lồng nhau như cùng phép đo. Việc
chọn sửa hẹp dựa trên kết quả cũ làm phép đo này tiếp tục là phát triển đã
được xem, không phải kiểm thử độc lập. Ghi tất cả lỗi và đối chiếu Dulieu4.

Kiểm tra chức năng thực tế nếu bản hẹp đạt; giữ các runtime/algorithm cũ.
Không thay model mặc định v5 hoặc duyệt production trong vòng này.
