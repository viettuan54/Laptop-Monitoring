# Quy tắc gán nhãn bạo lực học đường

Giữ đúng ba nhãn `SAFE`, `RISK`, `HIGH_RISK`, một nhãn cho mỗi mẫu.
Áp dụng cho `search_query` và `page_content`; chưa triển khai thu thập chat.
Nhãn phản ánh tín hiệu trong văn bản, không xác nhận tình trạng của người đọc.

| Nội dung | Nhãn | Ví dụ |
| --- | --- | --- |
| Không có tín hiệu nguy cơ bạo lực học đường | `SAFE` | “Cách ôn tập môn toán” |
| Hướng dẫn phòng chống, phòng tránh hoặc hỗ trợ về bạo lực | `RISK` | “Hướng dẫn phòng chống bạo lực học đường” |
| Thảo luận chung, bài học hoặc tin tức về bạo lực; chưa có lời cầu cứu cá nhân hay đe dọa trực tiếp | `RISK` | “Bài thuyết trình về tác hại của bắt nạt” |
| Trải nghiệm bị bạo lực/bắt nạt/ép buộc của người nói, hoặc cầu cứu gắn với trải nghiệm đó | `HIGH_RISK` | “Em bị bạn đánh phải làm sao?” |
| Đe dọa bạo lực trực tiếp trong ngữ cảnh thật | `HIGH_RISK` | “Tao sẽ đánh mày sau giờ học” |

## Cách xử lý ngữ cảnh

- “Cách phòng tránh bạo lực học đường” là `RISK`; “Em bị bạn đánh, làm sao
  phòng tránh lần sau?” là `HIGH_RISK`. Chi tiết trải nghiệm cá nhân có ưu tiên
  cao hơn từ ngữ phòng tránh.
- “Tôi không bị bạn đánh” không được gán `HIGH_RISK` chỉ vì có cụm “bị bạn đánh”;
  nếu chỉ có câu này, gán `RISK` vì vẫn đang đề cập chủ đề bạo lực nhưng không
  xác nhận nguy cơ cá nhân. Người đánh giá cần đọc đủ ngữ cảnh khi có thêm câu.
- “Em bị bạn dọa ‘tao sẽ đánh mày’” là lời báo lại một đe dọa thật: `HIGH_RISK`.
  Một ví dụ câu đe dọa trong bài phòng chống bạo lực không tự làm cả bài thành
  `HIGH_RISK`; nếu chỉ mang tính giáo dục, gán `RISK`.
- Không suy tình trạng của trẻ từ lịch sử đọc trang nếu không có bằng chứng
  hoặc quy tắc tổng hợp đã được kiểm định. Không xem nhãn là căn cứ kỷ luật.

Các mẫu ở `policy_examples.example.jsonl` là đối chứng tổng hợp minh họa quy
tắc, không phải tập test độc lập đã kiểm duyệt. Không đưa chúng vào train rồi
dùng chính chúng để tuyên bố model đã đạt quy tắc.

## Trạng thái áp dụng

Hướng dẫn này là quy tắc cho gán nhãn và đánh giá tiếp theo. Model v2 hiện
được train từ dataset cũ, chưa bảo đảm áp dụng đúng các đối chứng này. Cần bổ
sung dữ liệu, đánh giá trên tập độc lập và huấn luyện phiên bản mới trước khi
cho phép cảnh báo thực tế. Không dùng luật từ khóa để ép nhãn thay cho kiểm định.
