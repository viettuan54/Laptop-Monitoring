# Kiểm tra đầu vào `DuLieuThat1.csv`

Trạng thái hiện tại: **94/94 câu có nhãn sau rà soát; đây là bộ chẩn đoán lỗi,
không phải holdout độc lập**. Xem `DULIEUTHAT1_REVIEWED_DIAGNOSTIC.md` để biết
12 trường hợp model sai theo quyết định của người cung cấp. Câu ID `57` trong
file gốc đã được đồng bộ với bản người cung cấp sửa trong bảng duyệt. Bảng duyệt
nằm tại `Mô tả/DuLieuThat1_review.csv`;
cả hai CSV đều bị `.gitignore` loại trừ, không đưa nguyên văn câu tìm kiếm vào Git.

- SHA-256 file gốc hiện tại: `81cf4eb8cdad956ad9c0691143ec412df77f7c5ba5aab33bee180ffdb8a9a1e2`.
- SHA-256 bảng duyệt hiện tại: `6f664dafafde038b636831e00cdd81f1b3963402deba1dc21ff5acb91c3a4462`.
- UTF-8 hợp lệ; 94 dòng `id,text`, 94 ID khác nhau, không có ô trống, không có
  ký tự thay thế `�`, ký tự điều khiển hoặc câu vượt quá 1.000 ký tự.
- Không thấy câu trùng nhau sau chuẩn hóa runtime; không trùng ID hoặc văn bản
  với train/validation/test của artifact v5-query. Đây là kiểm tra trùng chính xác
  sau chuẩn hóa, chưa loại trừ mọi câu gần trùng về ngữ nghĩa.
- Không thấy mẫu email, số điện thoại, URL, token hoặc bí mật theo các bộ lọc
  hiện có. Kiểm tra tự động không phát hiện được mọi tên riêng/địa chỉ; người
  duyệt vẫn cần kiểm tra và bỏ thông tin nhận dạng trước khi chốt tập test.
- Bộ nhãn hiện tại gồm 7 `SAFE`, 20 `RISK`, 67 `HIGH_RISK`. Có 12 bất đồng
  với model; 81 nhãn khác được xác nhận theo dự đoán model và ID `69` được
  chốt riêng là `RISK`. Không dùng tỷ lệ khớp nhãn trên bộ này làm độ chính xác
  độc lập.

Trong `DuLieuThat1_review.csv`, toàn bộ nhãn đã được điền. Quy tắc nhãn ở
`ai-training/school_violence/ANNOTATION_GUIDE.md`. Bảng duyệt chỉ có
`id,text,label`; không cần mã người duyệt hoặc mã nhóm.
Vì không có thông tin để biết những câu nào thuộc cùng trẻ/phiên, kết quả đánh
giá sau này không thể kiểm tra tính độc lập ở cấp trẻ/phiên. Đồng thời xác nhận
nguồn là câu tìm kiếm thật của trẻ, quyền sử dụng cho đánh giá, và kiểm tra ẩn
danh thủ công.
Vì phần lớn nhãn được xác nhận sau khi xem dự đoán model, không chuyển bộ này
thành holdout cuối để chạy `evaluate_real_world.py`. Nếu dùng bộ này cải thiện
model, cần thu tập kiểm thử mới chưa xem dự đoán. Chưa đưa 94 câu vào train và
chưa thay đổi trạng thái `deployment_eligible=false` của model.

## Lịch sử

Bản đầu có SHA-256 `9d625ffc46074cf7345577d9c5503112ba95c9fd4b0ca6765e77d8e8b6350e01`
không giải mã được bằng UTF-8; 94 câu có tổng cộng 666 dấu `?` do lỗi xuất/mã
hóa nên không thể gán nhãn an toàn. Người cung cấp đã sửa file thành bản UTF-8
có SHA-256 `dedd31c077297029feea1204bad5078702b86cd16bb34be474db6761f9f102a9`.
Sau đó ID `57` được sửa và đồng bộ, tạo SHA-256 hiện tại như ở trên. Trạng thái
93/94 nhãn trước rà soát được lưu trong `DULIEUTHAT1_PRELIMINARY_EVALUATION.md`.
