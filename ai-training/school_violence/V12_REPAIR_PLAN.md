# V12 bước 2–3: sửa biểu diễn ngữ cảnh

Chốt ngày 2026-10-06 **sau ablation**, trước chấm bản sửa. Báo cáo ablation
được giữ riêng; không coi đây là lựa chọn được thiết kế trước khi xem dữ liệu.

Không nhóm nào bị bỏ hoàn toàn làm v11 tốt hơn tổng thể. Bỏ vai trò tăng
RISK lên HIGH 38 → 43,2; bỏ học tập tăng SAFE cảnh báo 10,8 → 11,6; bỏ áp lực
tăng RISK lên HIGH 38 → 38,8. Các nhóm tương tác, không thể cộng hiệu ứng.

Chỉ thử **một** bản sửa, không tìm thêm trọng số/ngưỡng/seed:

1. Giữ phân biệt cụm học tập và hành vi thật. Giữ vai trò gắn với hành vi;
   phân biệt chỉ/chị, ảnh/anh, bàn/bạn có dấu khi xác định người bị tác động.
2. Khôi phục các kết hợp ngữ cảnh cũ của trêu chọc/cô lập để không mất tín
   hiệu RISK chỉ vì bộ gắn vai trò chưa đủ chắc. Không khôi phục kết hợp
   bản thân + hành vi thể chất theo đồng xuất hiện ở bất kỳ đâu trong câu.
3. Giữ feature áp lực chung, thay các kết hợp áp lực cũ bằng mô tả loại câu:
   yêu cầu/thúc ép, ép buộc, làm theo, chưa nhận rõ loại. Thêm các kết hợp
   loại với đối tượng và hậu quả được nói đến. Nhóm hậu quả gồm đe dọa,
   tác động thể chất, vũ khí, tiền/tài sản, hạn chế di chuyển, tước nhu cầu,
   làm nhục và thông tin riêng tư. Không nhận ra hậu quả là trạng thái chưa
   rõ của bộ trích xuất, không phải kết luận câu an toàn.
4. Không có feature/quy tắc tự trả nhãn, tra ID hoặc nguyên câu. Nhãn giữ
   nguyên; mọi hệ số được học từ phần học trong fold.

Giữ 282 câu và đúng 25 fold. Giữ cấu hình v10 cuối: min_df=1, context scale=2,
SAFE/RISK/HIGH=1,5/1/3, L2=0,001, 200 lượt tối ưu, argmax. Dùng runtime mới,
giữ nguyên các runtime/artifact v10/v11/v11.1 và báo cáo ablation.

Chỉ chọn khi: HIGH nhận đúng không giảm, HIGH về SAFE không tăng, macro-F1
không giảm, SAFE cảnh báo/RISK lên HIGH/RISK về SAFE không tăng, và giảm ít
nhất một loại cảnh báo sai. Riêng Dulieu4 cũng không tăng các lỗi trên hoặc
giảm HIGH nhận đúng. Theo dõi 30/35/57/82/66/83/90/32/50 cùng mọi lỗi mới.
Chấm lại sau học không thay cổng ngoài phần học.

Nếu đạt, kiểm tra chức năng/API/luồng cảnh báo rồi khóa ứng viên, chuẩn bị
test mới độc lập. Nếu không đạt, giữ v10 và ghi rõ lỗi/giới hạn. Không thử thêm
biến thể trong vòng sửa này. Không lấy lại bộ hiện tại làm test độc lập;
mọi artifact giữ deployment_eligible=false, service mặc định vẫn v5.
