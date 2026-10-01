# Kết quả rà soát nhãn `DuLieuThat1`

Cập nhật 2026-10-02. Người cung cấp xác nhận model sai tại 12 ID trong
`Mô tả/DuLieuThat1_disagreements.csv`, xác nhận dự đoán của model đúng ở các
ID còn lại, và chốt riêng ID `69` là `RISK`. Câu ID `57` trong file gốc đã được
đồng bộ với câu người cung cấp sửa ở bảng duyệt. Không có nguyên văn câu tìm
kiếm trong báo cáo này.

- File gốc `DuLieuThat1.csv`: SHA-256
  `81cf4eb8cdad956ad9c0691143ec412df77f7c5ba5aab33bee180ffdb8a9a1e2`.
- Bảng `DuLieuThat1_review.csv`: SHA-256
  `6f664dafafde038b636831e00cdd81f1b3963402deba1dc21ff5acb91c3a4462`.
- Nguồn gốc quyết định nhãn (chỉ ID và loại quyết định) ở
  `DuLieuThat1_label_provenance.csv`: 12 nhãn sửa trực tiếp theo danh sách người
  cung cấp, 81 nhãn xác nhận theo dự đoán model, 1 nhãn ID `69` được chốt riêng.
- Đủ 94 nhãn: 7 `SAFE`, 20 `RISK`, 67 `HIGH_RISK`. Không còn nhãn trống.
- Artifact model v5-query: SHA-256
  `8c9c9642f796a596ce091ee8cf3ebe564be859862f115f22c985faba58f2bc7b`.

Sau khi cập nhật theo quyết định trên, còn đúng **12 bất đồng** với model:
10 câu được chốt `HIGH_RISK` nhưng model đoán `RISK`; 2 câu được chốt `RISK`
nhưng model đoán `HIGH_RISK`. Ma trận mô tả của bộ nhãn hiện tại (hàng là nhãn
đã chốt, cột là dự đoán):

| Nhãn đã chốt / model | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 7 | 0 | 0 |
| RISK | 0 | 18 | 2 |
| HIGH_RISK | 0 | 10 | 57 |

**Không dùng 82/94 câu trùng nhãn hoặc bất kỳ metric nào từ bảng này làm ước
lượng độ chính xác độc lập**: 81 nhãn được xác nhận theo dự đoán model sau khi
đã xem kết quả, và 12 lỗi được chọn để sửa. Bộ này là dữ liệu chẩn đoán lỗi;
nếu dùng để cải thiện model, cần một tập kiểm thử mới chưa xem dự đoán để đánh
giá phiên bản tiếp theo. Đặc biệt 10 trường hợp `HIGH_RISK` bị hạ xuống `RISK`
cho thấy model hiện tại vẫn có rủi ro bỏ sót cảnh báo mức cao.

Kiểm tra tự động hiện không thấy câu trùng sau chuẩn hóa, trùng ID/văn bản với
train/validation/test v5, hoặc mẫu dữ liệu nhạy cảm theo bộ lọc. Điều này không
xác minh được quyền sử dụng, ẩn danh thủ công hoặc độc lập theo trẻ/phiên vì
không có thông tin nhóm. Câu ID `2` và `79` ở file gốc khác cách viết so với
bảng duyệt nhưng giống sau chuẩn hóa runtime. Chưa huấn luyện lại model hoặc
bật cảnh báo production; artifact vẫn `deployment_eligible=false`.
