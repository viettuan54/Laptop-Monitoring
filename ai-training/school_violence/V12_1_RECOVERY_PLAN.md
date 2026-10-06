# V12.1: bổ sung nhận diện ép chi tiêu và giữ tài sản

Chốt ngày 2026-10-06 sau v12, trước chấm v12.1. Giữ nguyên kế hoạch/báo cáo
v12. Đây là vòng sửa tiếp theo, không thay kết quả đã biết.

V12 tăng macro-F1 0,81254 → 0,82340, giảm SAFE cảnh báo 12,4 → 10,8 và RISK
lên HIGH 36 → 34,4. HIGH nhận đúng giảm 92,8 → 92,4 nên không đạt. Hai mất
mức cao mới chỉ ở seed 20261002: nghĩa vụ mua đồ lặp lại khi đi cùng nhóm,
và giữ tài sản để buộc đáp ứng yêu cầu. Giữ nguyên các nhãn xác nhận.

Chỉ một vòng sửa, không thử thêm trọng số/ngưỡng/seed: mở rộng khái niệm
money_coercion hiện có bằng hai cách diễn đạt hành vi:

- Phải/bị ép/bắt mua, có ngữ cảnh bạn/nhóm và yếu tố lặp lại hoặc ép buộc.
- Giữ/lấy tài sản không trả, đi kèm yêu cầu/làm theo/ép buộc.

Nghĩa vụ mua trong học tập/sinh hoạt thông thường không tự tạo khái niệm
ép tiền. Gắn bản thân với hành vi chỉ khi có chủ thể gần nghĩa vụ hoặc chủ
thể của yêu cầu có điều kiện. Không tra ID/nguyên câu và không tự gán HIGH;
chỉ tạo feature cùng nhóm hành vi đã được học. Giữ mọi feature v12 khác.

Giữ 282 câu, cùng 25 fold, cấu hình và tiêu chí v12. Báo cáo bổ sung đầy đủ
lỗi mới/giới hạn và Dulieu4; chấm lại sau học không thay kiểm tra ngoài học.
Nếu không đạt thì giữ v10; không thêm biến thể nữa trong vòng này. Nếu đạt,
kiểm tra chức năng và khóa ứng viên để thử bộ mới độc lập. Mọi artifact chưa
qua test độc lập giữ deployment_eligible=false; service mặc định vẫn v5.
