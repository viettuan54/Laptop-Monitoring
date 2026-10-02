# Phân tích lỗi trên `DuLieuThat2` trước khi sửa model

**Lưu ý:** phân tích này dùng bản nhãn trước các lần sửa CSV.
Xem [lần rà nhãn mới nhất](DULIEUTHAT2_LABEL_CONSISTENCY_RECHECK_V2.md) để biết
những trường hợp còn cần xem lại.

Ngày 2026-10-02. Phân tích này dùng cùng bản CSV 99 câu đã khóa bằng SHA-256
`bad03989d235cf44df75256a55b17421decb7a8a47476bd732dd4383a27774c2`.
Các ID dưới đây dùng tiền tố `DuLieuThat2:` để tránh trùng ID của bộ cũ.
Nguyên văn câu chỉ nằm trong CSV cục bộ bị Git bỏ qua; nhận định dưới đây là
phân tích lỗi, chưa phải quyết định đổi nhãn của người cung cấp.

## Lỗi có ảnh hưởng đến cảnh báo

- V6 hạ 8/50 câu `HIGH_RISK` xuống `RISK`: ID `8`, `9`, `17`, `27`, `33`,
  `56`, `63`, `74`. Các câu này mô tả trải nghiệm hoặc sức ép cá nhân; một số
  còn hỏi liệu có nên báo giáo viên. Đây là lỗi bỏ lỡ cảnh báo mức cao, dù vẫn
  tạo cảnh báo quan sát. Cả 8 câu cũng bị v5 hạ mức.
- V6 nâng 36/40 câu `RISK` lên `HIGH_RISK`; v5 đã nâng 30/40 câu. Một nhóm
  câu là phòng tránh, lo lắng hoặc tình huống chưa rõ có bạo lực; nhóm khác
  kể việc trẻ bị trêu chọc, chế giễu, lấy đồ hoặc cô lập. Nhóm thứ hai cần
  chốt lại ranh giới nhãn trước khi huấn luyện, vì hướng dẫn hiện tại xếp
  trải nghiệm bị bắt nạt cá nhân vào `HIGH_RISK` nhưng CSV gán `RISK` cho
  nhiều câu như vậy. ID cần đối chiếu chính sách gồm `44`, `46`, `47`, `48`,
  `49`, `50`, `52`, `53`, `82`, `93`; ID `98` cũng cần xem ngữ cảnh.
  Sự khác nhau xuất hiện ngay trong bộ mới: ID `10` là `HIGH_RISK` khi trẻ
  kể bị gọi biệt danh không thích, trong khi ID `44` là `RISK` khi kể bị chê
  về ngoại hình; ID `36` là `HIGH_RISK` khi kể bị lấy bút, còn ID `53` là
  `RISK` khi kể bị lấy đồ lặp lại. Đây là các cặp cần người cung cấp quyết
  định theo cùng một quy tắc, không thể coi toàn bộ 36 dự đoán là lỗi model.
- V6 cảnh báo 6/9 câu `SAFE`: ID `1`, `2`, `4`, `28`, `29`, `30`. Đây là những
  tìm kiếm học tập hoặc hoạt động học đường thông thường. V5 cảnh báo 5/9;
  v6 làm sai thêm ID `29`. Chỉ có 9 câu `SAFE` nên chưa suy ra tỷ lệ cảnh báo
  nhầm ngoài thực tế.

Model là Naive Bayes dựa trên cụm ký tự 3–5 ký tự, được học chủ yếu từ câu
tổng hợp; v6 chỉ bổ sung 12 câu lỗi của bộ trước. Kết quả gợi ý model phụ
thuộc nhiều vào từ/cụm liên quan trường học và bạo lực, chưa tách tốt lời
phòng tránh, lời kể cá nhân và câu học tập bình thường. Đây là giả thuyết
từ ma trận lỗi, không phải kết luận nhân quả đã được kiểm định.
Các điểm số đầu ra cũng rất cực đoan: trung vị điểm của nhãn được chọn là
gần 1,0 ngay cả ở 8 câu `HIGH_RISK` bị hạ mức và 36 câu `RISK` bị nâng mức.
Điểm số này chưa được hiệu chuẩn thành xác suất thực; chỉ tăng ngưỡng cảnh
báo dựa trên bộ 99 câu khó khắc phục lỗi và sẽ làm mất tính độc lập của bộ.

## Điều kiện trước khi huấn luyện ứng viên kế tiếp

Giữ nguyên các nhãn đã chốt trong CSV gốc. Trước khi dùng `DuLieuThat2` làm
dữ liệu phát triển, cần quyết định rõ các câu trẻ kể mình bị trêu chọc,
chế giễu, lấy đồ hoặc cô lập lặp lại nhưng không có đánh/đe dọa rõ ràng là
`RISK` hay `HIGH_RISK`; sau đó cập nhật hướng dẫn hoặc tạo bản nhãn mới có
nguồn gốc thay đổi. Không sửa âm thầm CSV đã dùng để báo cáo v5/v6.

Nếu dùng `DuLieuThat2` để chọn cách sửa hoặc trọng số huấn luyện, kết quả
trên chính 99 câu chỉ là số đo phát triển, không còn là kiểm thử cuối độc
lập. Phải khóa ứng viên trước khi kiểm thử trên một bộ câu mới chưa xem dự
đoán. Model mặc định và `deployment_eligible=false` giữ nguyên.
