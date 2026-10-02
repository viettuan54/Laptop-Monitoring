# Rà lại tính nhất quán nhãn `DuLieuThat2` — bản trước

**Lưu ý:** CSV đã được sửa lần nữa. Kết quả rà mới nằm ở
[`DULIEUTHAT2_LABEL_CONSISTENCY_RECHECK_V2.md`](DULIEUTHAT2_LABEL_CONSISTENCY_RECHECK_V2.md).

Ngày 2026-10-02. Bản `Mô tả/DuLieuThat2_review.csv` tại lần rà này có SHA-256
`b49310c839c2c6cff22f0f2f771fb9a71e5f861ebbe9fbb7b1980a24ea84a2ca`.
File có 99 ID không trùng, đủ `id,text,label`, gồm 9 `SAFE`, 42 `RISK` và
48 `HIGH_RISK`. So với bản đã dùng để kiểm thử v5/v6, chỉ có ID `10` và `36`
đổi từ `HIGH_RISK` sang `RISK`; nội dung câu không đổi. Không sửa CSV khi rà.

## Cặp còn mâu thuẫn rõ

| ID hiện là `RISK` | ID hiện là `HIGH_RISK` | Lý do cần xem lại |
| --- | --- | --- |
| `36` | `38`, `41` | Cùng cấu trúc câu kể bị bạn lấy đồ dùng trong giờ học và hỏi có báo giáo viên không; chỉ khác loại đồ dùng (bút chì màu, vở, thước kẻ). Không có chi tiết đe dọa hay ép buộc để giải thích vì sao nhãn khác nhau. |
| `53` | `38`, `41` | ID `53` còn nói việc lấy đồ lặp lại và không trả. Nếu lấy vở/thước đơn lẻ là `HIGH_RISK`, cần giải thích vì sao trường hợp lặp lại lại là `RISK`. |

Theo cách sửa ID `36` thành `RISK`, ID `38` và `41` là hai nhãn cần được
người cung cấp rà trước tiên. Không tự đổi chúng vì có thể người cung cấp
định phân biệt thêm theo ngữ cảnh chưa ghi trong câu.

## Ranh giới cần xác định, chưa thể gọi chắc là gán sai

- ID `21`, `39`, `40`, `42` được gán `HIGH_RISK` cho việc làm bẩn, giấu hoặc
  lấy đồ/ghế ở trường; ID `36`, `53` là `RISK` cho việc lấy đồ dùng. Những
  hành vi này khác nhau về mức tác động, nhưng CSV chưa ghi quy tắc nào để
  phân biệt nhất quán. ID `64` (`HIGH_RISK`) có thêm yếu tố chuyền đồ để
  trêu, nên cũng cần xét theo cùng quy tắc.
- ID `63`, `68` là `HIGH_RISK` khi có lời dọa làm lộ chuyện riêng hoặc làm
  trẻ mất mặt; ID `50`, `52`, `93` là `RISK` cho việc chê bai/chửi trên mạng,
  trong đó ID `93` kể ảnh đã bị đăng. Có thể phân biệt đe dọa/ép buộc với
  chế giễu, nhưng cần viết rõ ranh giới để xử lý trường hợp đã đăng ảnh.
- ID `43` gán `RISK` nhưng câu hiện không nói rõ bị bắt nạt, đe dọa hay ép
  buộc; có thể là `SAFE` nếu chỉ hỏi về việc dọn vệ sinh thông thường.
  ID `11` gán `HIGH_RISK` nhưng câu có đoạn diễn đạt khó hiểu, cần sửa văn
  bản hoặc xác nhận ý trước khi dùng để học/đánh giá.

Hướng dẫn `ANNOTATION_GUIDE.md` hiện vẫn ghi mọi trải nghiệm bị bắt nạt cá
nhân là `HIGH_RISK`, trong khi bộ mới gán `RISK` cho nhiều câu trêu chọc hoặc
lấy đồ, gồm ID `10` và `36` vừa sửa. Sau khi chốt các ID trên, cần cập nhật
hướng dẫn để phản ánh đúng ranh giới nhãn đã chọn.

Báo cáo v5/v6 trước đó dùng SHA-256 `bad03989d235cf44df75256a55b17421decb7a8a47476bd732dd4383a27774c2`;
đó là bản nhãn cũ. Nếu tính lại trên nhãn hiện tại, các số chỉ là phân tích
sau khi đã xem dự đoán, không còn là kiểm thử mù độc lập. Chưa huấn luyện
hoặc thay model trong lần rà này.
