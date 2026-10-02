# Quy tắc gán nhãn bạo lực học đường

Giữ đúng ba nhãn `SAFE`, `RISK`, `HIGH_RISK`, một nhãn cho mỗi mẫu.
Giai đoạn hiện tại chỉ áp dụng cảnh báo cho `search_query` trẻ gửi từ máy Agent.
Phân tích `page_content` làm sau; ví dụ trang ở đây chỉ dùng cho nghiên cứu tiếp theo.
Nhãn phản ánh dấu hiệu trong câu tìm kiếm, không xác nhận trẻ đã bị bạo lực.

## Kết quả gửi đến phụ huynh

- `SAFE`: không tạo cảnh báo.
- `RISK`: tạo cảnh báo “Cần quan sát bé trong thời gian này”.
- `HIGH_RISK`: tạo cảnh báo “Bé có dấu hiệu bị bạo lực”.

Agent gửi câu tìm kiếm mới khi tính năng được bật; service local phân loại,
backend lưu nhãn và tạo cảnh báo trên trang quản lý phụ huynh. Hai mức cảnh
báo có thời gian chống lặp riêng để `RISK` không che mất `HIGH_RISK`.
Quyết định duyệt nhãn chỉ cần `id` và `label`, không cần mã người duyệt.
Theo quyết định dữ liệu v2.3, 393 câu query phủ định tổng hợp đã được loại
khỏi tập train/validation/test mới. Các quy tắc bên dưới vẫn giúp hiểu kết
quả trên câu thực tế; chỉ riêng sự xuất hiện của từ “không” không làm Agent
bỏ qua câu tìm kiếm.

| Nội dung | Nhãn | Ví dụ |
| --- | --- | --- |
| Không có tín hiệu nguy cơ bạo lực học đường | `SAFE` | “Cách ôn tập môn toán” |
| Hướng dẫn phòng chống, phòng tránh hoặc hỗ trợ về bạo lực | `RISK` | “Hướng dẫn phòng chống bạo lực học đường” |
| Thảo luận chung, bài học hoặc tin tức về bạo lực; chưa có lời cầu cứu cá nhân hay đe dọa trực tiếp | `RISK` | “Bài thuyết trình về tác hại của bắt nạt” |
| Trêu chọc bằng lời, lo lắng hoặc lấy đồ dùng học tập đơn lẻ, chưa có dấu hiệu gây hại, cưỡng ép hay lặp lại rõ | `RISK` | “Bị bạn gọi bằng biệt danh mình không thích thì làm sao?” |
| Trải nghiệm bị đánh, đe dọa, ép buộc, tống tiền, phá hoại cố ý, chiếm giữ đồ lặp lại hoặc tự báo đã bị bắt nạt kéo dài | `HIGH_RISK` | “Em bị bạn đánh phải làm sao?” |
| Đăng ảnh của trẻ để bêu xấu hoặc dọa tiết lộ chuyện riêng của trẻ | `HIGH_RISK` | “Các bạn đăng ảnh mình lên nhóm chat rồi chê mình” |
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
- Hành vi phải được đọc theo mức độ được **nói rõ trong câu**: bị lấy bút/vở
  một lần là `RISK`; bị lấy đồ lặp lại và không trả, bị cố tình phá hỏng đồ
  hoặc bị giấu cặp hằng ngày là `HIGH_RISK`. Không tự suy sự lặp lại hoặc
  ý định gây hại từ một câu chỉ nói “bị lấy đồ”.
- Câu chỉ hỏi về học tập, hoạt động trường hoặc việc dọn vệ sinh, không có
  dấu hiệu bạo lực/ép buộc, là `SAFE`. Câu kể bị chê bằng lời là `RISK` khi
  chưa có đe dọa, ép buộc hoặc tiết lộ thông tin/ảnh riêng tư; chỉ riêng
  việc lời chê lặp lại không tự nâng thành `HIGH_RISK`.
- Không suy tình trạng của trẻ từ lịch sử đọc trang nếu không có bằng chứng
  hoặc quy tắc tổng hợp đã được kiểm định. Không xem nhãn là căn cứ kỷ luật.

Các mẫu ở `policy_examples.example.jsonl` là đối chứng tổng hợp minh họa quy
tắc, không phải tập test độc lập đã kiểm duyệt. Không đưa chúng vào train rồi
dùng chính chúng để tuyên bố model đã đạt quy tắc.

## Trạng thái áp dụng

Hướng dẫn này là quy tắc cho gán nhãn và đánh giá tiếp theo. Các bản model
hiện tại chưa bảo đảm áp dụng đúng mọi đối chứng này. Cần bổ sung dữ liệu và
đánh giá trên tập mới độc lập trước khi cho phép cảnh báo thực tế. Không dùng
luật từ khóa để ép nhãn thay cho kiểm định.
