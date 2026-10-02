# Rà lại nhãn `DuLieuThat2` sau lần sửa thứ hai

**Lưu ý:** đây là bản rà lịch sử. CSV đã được sửa tiếp; xem
[`V7_QUERY_CANDIDATE_STATUS.md`](../../../ai-training/school_violence/V7_QUERY_CANDIDATE_STATUS.md)
để biết checksum và trạng thái mới nhất.

Ngày 2026-10-02. Bản CSV hiện có SHA-256
`c573a4ab9fcd0c7536833df1bc65d45357335b1076d8ffaddc98f5568bbd49a5`.
File có 99 ID không trùng, ba cột `id,text,label`, gồm 9 `SAFE`, 43 `RISK`
và 47 `HIGH_RISK`. Không có nhãn/ô trống, câu trùng sau chuẩn hóa hoặc mẫu
định danh rõ ràng theo bộ kiểm tra hiện có. Không sửa CSV trong lần rà này.

So với lần rà trước, nhãn ID `38` và `41` đổi từ `HIGH_RISK` sang `RISK`,
còn ID `53` đổi từ `RISK` sang `HIGH_RISK`. ID `10` và `36` vẫn là `RISK`.
Các câu ID `36`, `38`, `41` cùng mô tả bị lấy đồ dùng học tập trong giờ học
và hiện đã cùng nhãn `RISK`. ID `53` nói việc bị lấy đồ lặp lại và không trả,
nên nhãn cao hơn có thể hợp lý nếu quy tắc dựa trên sự lặp lại/chiếm giữ.
**Mâu thuẫn gần như cùng câu của lần trước đã được xử lý.**

## Những trường hợp vẫn nên rà thủ công

| ID | Nhãn hiện tại | Lý do cần xem |
| --- | --- | --- |
| `21`, `39`, `40`, `42`, `64` | `HIGH_RISK` | Cũng liên quan đồ dùng, chỗ ngồi hoặc trêu chọc; khác với ID `36`, `38`, `41` ở hành vi/lặp lại/tác động. Cần ghi rõ khi nào phá hoại, giấu hoặc chuyền đồ để trêu đạt mức cao. Chưa đủ căn cứ gọi các nhãn này sai. |
| `93` | `RISK` | Câu kể ảnh của trẻ đã bị đăng lên nhóm chat để chê bai, trong khi ID `63`, `68` là `HIGH_RISK` cho lời dọa tiết lộ chuyện riêng/làm trẻ mất mặt. Có thể phân biệt đe dọa, ép buộc với chê bai, nhưng cần chốt trường hợp ảnh đã được đăng. |
| `43` | `RISK` | Câu chỉ hỏi về việc dọn vệ sinh, chưa nêu bạo lực, đe dọa hay ép buộc. Có thể là `SAFE` nếu không có ngữ cảnh khác. |
| `11` | `HIGH_RISK` | Câu đã được sửa chữ so với lần rà trước nhưng vẫn khó hiểu ở phần mô tả sự việc; cần xác nhận ý câu trước khi dùng để huấn luyện. |

Hướng dẫn `ANNOTATION_GUIDE.md` hiện vẫn ghi mọi trải nghiệm bị bắt nạt cá
nhân là `HIGH_RISK`, trong khi CSV dùng `RISK` cho một số hành vi trêu chọc
hoặc lấy đồ. Để các lần gán nhãn sau nhất quán, cần viết rõ ranh giới giữa
trêu chọc/lấy đồ mức quan sát và bạo lực, đe dọa, ép buộc hoặc chiếm giữ
nghiêm trọng ở mức cảnh báo cao.

Báo cáo v5/v6 trước đó dùng bản nhãn có SHA-256
`bad03989d235cf44df75256a55b17421decb7a8a47476bd732dd4383a27774c2`.
CSV hiện tại đã sửa nhãn sau khi xem dự đoán và có thay đổi nội dung ít nhất
ở ID `11`; vì vậy các số liệu cũ chỉ là lịch sử của bản trước. Nếu tính lại
trên bản hiện tại, đó là phân tích phát triển, không phải phép thử mù độc
lập. Chưa huấn luyện hoặc thay model trong lần rà này.
