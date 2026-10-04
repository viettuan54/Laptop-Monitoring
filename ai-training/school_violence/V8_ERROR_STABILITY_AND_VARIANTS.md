# Rà lỗi lặp và thử cải thiện ứng viên v8

Ngày 2026-10-03. Giữ nguyên 192 câu và nhãn đã chốt của ba file review;
không thêm dữ liệu hay sửa CSV. Công cụ
[`analyze_v8_error_stability.py`](analyze_v8_error_stability.py) chấm lại v8
ngoài fold trên cùng năm cách chia nhóm gần giống ở
[`V8_QUERY_CANDIDATE_STATUS.md`](V8_QUERY_CANDIDATE_STATUS.md). JSON chi tiết
chỉ chứa ID, nhãn, thống kê và SHA-256, nằm ngoài Git tại
`ai-training/artifacts/school_violence/v8_error_stability_20261003.json`.
SHA-256 báo cáo là
`743c8cec6a7881040ca869de9f08df61bc675f596eba3f7922cb725a9da0b09c`.
Không có nguyên văn câu tìm kiếm trong báo cáo này.

Qua cả năm cách chia, 3/66 câu `HIGH_RISK` luôn bị hạ xuống `RISK`:
`DuLieuThat2:16`, `:64`, `:67`. Chúng mô tả lần lượt bạo lực thể chất,
quấy rối bằng đồ dùng và giữ đồ để ép làm theo; các cách diễn đạt cụ thể
này chưa được v8 khái quát tốt. Hai ID nữa sai ở 4/5 cách chia là
`DuLieuThat1:70` và `DuLieuThat3:63`.

Có 10/49 câu `SAFE` bị cảnh báo trong cả năm cách chia: `DuLieuThat2:28`,
`:43` và `DuLieuThat3:5`, `:7`, `:15`, `:25`, `:33`, `:42`, `:71`, `:81`.
Chúng chủ yếu hỏi việc học hoặc quan hệ bạn bè bình thường; riêng ID `15`
bị nâng thẳng lên `HIGH_RISK` ở cả năm lượt. Có 21/77 câu `RISK` luôn bị
dự đoán sai, phần lớn bị nâng thành `HIGH_RISK`; ví dụ ở `DuLieuThat3` là
ID `18`, `21`, `26`, `28`, `32`, `36`, `51`. Model còn khó phân biệt trẻ là
nạn nhân với câu hỏi về chứng kiến, tìm hiểu hoặc áp lực chưa rõ mức.
Những trường hợp nhãn vốn khó phân biệt như `DuLieuThat3:22`, `:50`, `:55`
được giữ nguyên, không tự sửa theo dự đoán.

Đã thử các thay đổi giới hạn trên **cùng năm cách chia**, không dùng tập test
mới. Các số dưới đây là trung bình mỗi lượt trên cùng 192 câu, không phải
960 câu độc lập. `SAFE` cảnh báo là dự đoán `RISK` hoặc `HIGH_RISK`;
`RISK`→`HIGH_RISK` gây sai thông điệp cảnh báo bạo lực cho phụ huynh.

| Cấu hình phát triển | Macro-F1 | `HIGH_RISK` đúng /66 | `SAFE` cảnh báo /49 | `RISK`→`HIGH_RISK` /77 |
| --- | ---: | ---: | ---: | ---: |
| v8 hiện tại | 0,7465 | 60,0 | 13,6 | 27,8 |
| Giữ từ xuất hiện một lần, giữ trọng số | 0,7322 | 62,0 | 15,6 | 31,8 |
| Giữ từ xuất hiện một lần, tăng trọng số `SAFE` | 0,7375 | 62,6 | 12,4 | 32,2 |
| Đặc trưng ký tự thay đặc trưng từ | 0,7079 | 61,0 | 15,8 | 33,2 |
| Trộn đều điểm từ và ký tự | 0,7459 | 61,0 | 12,8 | 29,8 |
| Thêm cụm ba từ | 0,7500 | 59,2 | 13,2 | 26,8 |
| Thêm cụm ba từ và cặp từ cách một từ | 0,7493 | 59,8 | 13,2 | 27,4 |
| Giảm thiên hướng chọn `HIGH_RISK` sau dự đoán | 0,7637 | 56,4 | 12,6 | 22,2 |

Các biến thể đều đánh đổi theo hướng không phù hợp để thay v8: nhận thêm
`HIGH_RISK` nhưng tăng cảnh báo bạo lực sai ở `RISK`, hoặc giảm cảnh báo sai
nhưng bỏ sót thêm mức cao. Những tham số trên cũng được thử và xem kết quả
trên chính dữ liệu phát triển, nên mọi số liệu đều có nguy cơ lạc quan.
Không có cơ sở gọi một biến thể là cải thiện ổn định hay tạo ứng viên v9.

**Quyết định:** giữ nguyên artifact v8 và model mặc định v5, đều chưa được
duyệt cho cảnh báo production. Bước kỹ thuật tiếp theo nếu tiếp tục tối ưu
là thiết kế cách biểu diễn vai trò/ngữ cảnh và kiểm tra nó bằng cùng bộ
kiểm tra chéo; không thêm luật từ khóa theo các ID lỗi. Chỉ sau khi có ứng
viên đạt tiêu chí lỗi đã thống nhất mới cần kiểm thử độc lập mới để quyết
định triển khai.
