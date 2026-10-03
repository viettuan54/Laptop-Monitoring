# Phân tích lỗi trên `DuLieuThat3` trước ứng viên v8

Ngày 2026-10-03. Dùng đúng bản CSV SHA-256
`a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1`.
Không đổi nhãn hoặc nội dung câu trong lần phân tích này. Đối chiếu đầy đủ
v5/v6/v7 theo ID nằm ở file cục bộ ngoài Git
`Mô tả/DuLieuThat3_model_comparison.csv`; ma trận ở
[báo cáo kiểm thử](DULIEUTHAT3_V5_V6_V7_EVALUATION.md).

- v7 hạ ba câu `HIGH_RISK` xuống `RISK`: ID `31`, `56`, `65`. Chúng liên quan
  đến trải nghiệm bắt nạt/ép buộc của trẻ, nên nhầm lẫn này làm mất cảnh báo
  mức cao dự kiến cho phụ huynh. V5/v6 chỉ hạ ID `37` (đe dọa đánh trực tiếp).
- v7 cảnh báo 31/39 câu `SAFE`, trong đó 11 câu bị nâng thẳng lên
  `HIGH_RISK`. Nhiều câu chỉ hỏi việc học, bạn bè, đồ dùng hoặc sinh hoạt ở
  trường. Từ chung trong các ngữ cảnh này không đủ để suy ra bạo lực.
- v7 nâng 13/33 câu `RISK` lên `HIGH_RISK`; các câu quan sát, phòng tránh hoặc
  áp lực chưa có bạo lực/ép buộc rõ vẫn khó tách khỏi trường hợp trẻ là nạn
  nhân. V5 và v6 còn nâng 25/33 và 31/33 câu `RISK`.
- ID `22` nói đến bạo lực với động vật, chưa phải trẻ bị bạo lực. ID `50`
  mô tả bị bắt đổi chỗ nhưng gán `RISK`; ID `55` gán `HIGH_RISK` dù câu chỉ
  nêu việc phải xin lỗi thường xuyên, chưa nói rõ ai ép hoặc đe dọa. Đây là
  ranh giới nhãn cần diễn giải thận trọng, không tự sửa theo dự đoán model.

Ứng viên v8 dùng dữ liệu đã duyệt để học đặc trưng từ/cụm từ thay cho cập
nhật Naive Bayes ký tự. Trên lượt kiểm tra chéo phát triển cố định, riêng 81
câu `DuLieuThat3`, v8 nhận đúng 9/9 `HIGH_RISK`, cảnh báo 8/39 câu `SAFE`
và nâng 10/33 câu `RISK` lên mức cao. Các lỗi `SAFE` ở ID `5`, `7`, `15`,
`25`, `33`, `42`, `71`, `81`. Khi đổi cách chia nhóm, v8 nhận đúng từ 7 đến
9/9 câu mức cao và cảnh báo từ 8 đến 14/39 câu `SAFE`; kết quả này chưa ổn
định đủ để triển khai. Các dự đoán v8 là ngoài fold tương ứng, nhưng chính
`DuLieuThat3` đã tham gia chọn cách làm và tham số; không so như một phép
kiểm thử mù độc lập với v5/v7.

Xem [trạng thái v8](../../../ai-training/school_violence/V8_QUERY_CANDIDATE_STATUS.md)
để biết toàn bộ ma trận, checksum model và cách tái tạo. Những câu có nhãn
khó phân biệt vẫn được giữ theo quyết định hiện tại của người cung cấp;
không dùng lỗi dự đoán để tự động đổi nhãn.
