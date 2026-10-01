# Chẩn đoán sơ bộ `DuLieuThat1_review.csv`

Ngày 2026-10-02. Đây là phép đối chiếu cục bộ, **chưa phải kết quả holdout cuối**.
Không có câu tìm kiếm nào được chép vào báo cáo này.
Báo cáo này ghi lại trạng thái **trước** khi người cung cấp rà soát lại nhãn;
kết quả hiện hành ở `DULIEUTHAT1_REVIEWED_DIAGNOSTIC.md`.

- File gốc `DuLieuThat1.csv`: SHA-256
  `dedd31c077297029feea1204bad5078702b86cd16bb34be474db6761f9f102a9`.
- Bảng duyệt `DuLieuThat1_review.csv`: SHA-256
  `1651d61240070e717b23ff0b0e48ffcd765bef5315b6f29d28d41dfd5442e139`.
- Model `vi-school-violence-char-nb-v5-query`: SHA-256 artifact
  `8c9c9642f796a596ce091ee8cf3ebe564be859862f115f22c985faba58f2bc7b`.
- Có 94 dòng, trong đó 93 dòng đã có nhãn hợp lệ: 76 `HIGH_RISK`, 17 `RISK`,
  0 `SAFE`. ID `69` còn trống nhãn.
- ID `2` và `79` đổi cách viết nhưng giống nhau sau chuẩn hóa runtime. Văn bản
  ID `57` đổi cả sau chuẩn hóa; cần xác nhận đây là chỉnh sửa có chủ ý. ID và thứ
  tự của 94 dòng vẫn khớp file gốc. Ba chỉnh sửa này không làm đổi dự đoán của
  model trên các ID đó.
- Không thấy câu trùng sau chuẩn hóa, trùng ID/văn bản với ba split của model,
  hoặc mẫu dữ liệu nhạy cảm theo bộ lọc hiện có. Kiểm tra tự động không bảo đảm
  đã loại mọi thông tin nhận dạng.

Ma trận dưới đây dùng **hàng là nhãn người dùng điền, cột là dự đoán model**,
chỉ trên 93 dòng có nhãn:

| Nhãn đã điền / model | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 0 | 0 | 0 |
| RISK | 2 | 3 | 12 |
| HIGH_RISK | 5 | 24 | 47 |

Model khớp 50/93 nhãn (53,8%). Trong 76 câu được gán `HIGH_RISK`, model nhận
đúng 47 (recall 61,8%) và bỏ sót 29: 5 dự đoán `SAFE`, 24 dự đoán `RISK`.
Với `RISK`, model nhận đúng 3/17 (recall 17,6%). Có 43 bất đồng; danh sách
`id,review_label,model_prediction` được lưu riêng tại
`Mô tả/DuLieuThat1_disagreements_before_correction.csv` và bị loại khỏi Git. Không có nhãn `SAFE`
nên chưa thể đo chất lượng trên câu an toàn hoặc tỷ lệ cảnh báo nhầm tương ứng.

Để hoàn tất đánh giá: điền nhãn ID `69`, xác nhận chỉnh sửa ở ID `57`, kiểm tra
ẩn danh thủ công và xác nhận nguồn/quyền sử dụng. Nếu có sửa nhãn sau khi xem
dự đoán model, tập này chỉ còn phù hợp để phân tích lỗi hoặc cải thiện model;
đánh giá cuối cần một tập mới chưa dùng để chọn/sửa model. Không có mã trẻ/phiên
nên không kiểm tra được độc lập ở cấp đó. Chưa huấn luyện lại model, chưa bật
cảnh báo production; artifact vẫn `deployment_eligible=false`.
