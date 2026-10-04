# Rà ranh giới nhãn trước thử kiến trúc hai tầng

Ngày 2026-10-03. Giữ nguyên các CSV nguồn và nhãn người cung cấp đã chốt.
`DuLieuThat3_review.csv` có SHA-256
`a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1`.
Dữ liệu thử vẫn là 192 câu: 49 `SAFE`, 77 `RISK`, 66 `HIGH_RISK`.

Đã bổ sung cách đọc vai trò, hành vi và tính thực tế/giả định vào
[`ANNOTATION_GUIDE.md`](ANNOTATION_GUIDE.md). Các quyết định hiện có được
giữ như sau; không lấy dự đoán model làm căn cứ đổi nhãn.

| ID | Nhãn giữ khi thử | Ranh giới / tình trạng |
| --- | --- | --- |
| `DuLieuThat3:22` | `RISK` | Chứng kiến bạo lực với động vật; nhãn quan sát không xác nhận chính trẻ là nạn nhân. Ghi rõ trường hợp này trong phạm vi nhãn. |
| `DuLieuThat3:50` | `RISK` | Yêu cầu đổi chỗ lặp lại nhưng chưa có chi tiết đe dọa/gây hại. Từ chỉ yêu cầu tự nó không đủ nâng mức cao. |
| `DuLieuThat3:55` | `HIGH_RISK` | Người cung cấp đã chọn nhãn cao. Nội dung chưa nói rõ người ép/đe dọa; đang chờ làm rõ việc bị ép xin lỗi hay tự lo lắng rồi xin lỗi. Giữ nhãn hiện tại trong thí nghiệm. |

Các câu kể trải nghiệm bản thân có dấu hiệu đánh/đe dọa/cưỡng ép rõ là
`HIGH_RISK`; câu hỏi về chứng kiến hoặc giả định với người khác là `RISK`
khi chưa nói trẻ bị tác động. Câu sinh hoạt/học tập bình thường là `SAFE`.
Không có mâu thuẫn do câu trùng chính xác trong 192 câu theo bộ kiểm tra
nguồn hiện có; điều đó không chứng minh mọi nhãn đều đúng về ngữ nghĩa.

Nếu người cung cấp thay nhãn/ngữ cảnh ID `55`, phải khóa checksum mới và
ghi phiên bản thử riêng. Không trộn hai bản nhãn trong bảng so với v8.

Đã hoàn tất phép thử hai tầng với bản nhãn giữ nguyên này; kết quả và quyết
định không thay model ở [`TWO_STAGE_QUERY_EXPERIMENT.md`](TWO_STAGE_QUERY_EXPERIMENT.md).
