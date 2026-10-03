# Kiểm thử `DuLieuThat3` trên v5, v6 và v7

Ngày 2026-10-03. Người cung cấp đã sửa nhãn rồi yêu cầu thực hiện bước tiếp
theo. Bản CSV được khóa trước lần dự đoán đầu tiên trong dự án có SHA-256
`a962a3d3e6b14bfe710d4fa57af05d43740c50c2fc512522dcc69a3c228b87a1`.
Bộ có 81 câu tìm kiếm: 39 `SAFE`, 33 `RISK`, 9 `HIGH_RISK`; không có ID,
câu hay nhãn trống/trùng, hoặc mẫu định danh rõ ràng qua rà thủ công và bộ
kiểm tra hiện có. Hai ID `37`, `77` đã được đổi thành `HIGH_RISK` trước khi
chạy model. Xem [tiền kiểm](DULIEUTHAT3_PRE_EVAL_AUDIT.md) để biết các ranh
giới nhãn còn cần diễn giải thận trọng, đặc biệt ID `22`, `50`, `55`.

Lời yêu cầu kiểm thử của người cung cấp là căn cứ sử dụng dữ liệu trong lần
chạy này; chưa có xác nhận riêng về quyền dùng và ẩn danh của bộ `DuLieuThat3`.
Kiểm tra thủ công/tự động không thể chứng minh đã loại mọi thông tin định danh.
Nhãn được chốt trước dự đoán **trong quy trình dự án này**; không thể xác minh
người cung cấp đã hoặc chưa xem dự đoán ở nơi khác. Do đó kết quả là đánh giá
có điều kiện, không phải xác nhận provenance tuyệt đối.

Chuyển CSV thành JSONL cục bộ ngoài Git với ID tiền tố `DuLieuThat3:`;
SHA-256 JSONL là
`4611200f00cadcabf33dcadd2c15387ee8aa579e3492a4f4c8d69358cad54c10`.
Công cụ `evaluate_real_world.py` xác nhận không trùng ID hoặc văn bản chuẩn
hóa với train/validation/test của từng artifact: v5 5.594 dòng, v6 5.606
dòng, v7 5.705 dòng. So khớp gần bằng ký tự không thấy cặp từ 0,85 trở lên
với `DuLieuThat1`, `DuLieuThat2` hoặc nội bộ bộ mới. Kiểm tra này không loại
trừ mọi câu trùng nghĩa. Không có mã trẻ/phiên nên không thể xác minh độc lập
ở cấp đó.

Ba model được chấm **một lần trên cùng bản CSV**, không huấn luyện hay chọn
ngưỡng theo nhãn của bộ này. SHA-256 model: v5
`8c9c9642f796a596ce091ee8cf3ebe564be859862f115f22c985faba58f2bc7b`,
v6 `610207001150ead8b5db1d5ee438872509e319b05c32b205d091ddd57c29088d`,
v7 `d13383b8c620ae2de4ff6ee7208e481a799da0ddb58bd723ee98c5e8f14dc9ae`.
JSON báo cáo và bảng đối chiếu ID/dự đoán không chứa câu tìm kiếm, nằm ngoài
Git tại `ai-training/artifacts/school_violence/DuLieuThat3_{v5,v6,v7}_eval_a962a3d3.json`
và `Mô tả/DuLieuThat3_model_comparison.csv`.

| Chỉ số trên 81 câu | v5 mặc định | v6 ứng viên | v7 ứng viên |
| --- | ---: | ---: | ---: |
| Dự đoán đúng | 20/81 | 15/81 | 34/81 |
| Macro-F1 | 0,2467 | 0,1781 | 0,3915 |
| `HIGH_RISK` đúng | 8/9 | 8/9 | 6/9 |
| `HIGH_RISK` bị hạ xuống `RISK` | 1 | 1 | 3 |
| Không phải `HIGH_RISK` bị nâng lên mức cao | 46/72 | 57/72 | 24/72 |
| `SAFE` bị cảnh báo ở bất kỳ mức nào | 33/39 | 34/39 | 31/39 |

Ma trận nhầm lẫn: hàng là nhãn đã chốt, cột là dự đoán.

| Model / nhãn thật | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| v5 / SAFE | 6 | 12 | 21 |
| v5 / RISK | 2 | 6 | 25 |
| v5 / HIGH_RISK | 0 | 1 | 8 |
| v6 / SAFE | 5 | 8 | 26 |
| v6 / RISK | 0 | 2 | 31 |
| v6 / HIGH_RISK | 0 | 1 | 8 |
| v7 / SAFE | 8 | 20 | 11 |
| v7 / RISK | 0 | 20 | 13 |
| v7 / HIGH_RISK | 0 | 3 | 6 |

V5/v6 cùng bỏ sót mức cao ở ID `37`; v7 nhận đúng ID đó nhưng hạ mức ở ID
`31`, `56`, `65`. Không model nào hạ `HIGH_RISK` thẳng xuống `SAFE`; hạ xuống
`RISK` vẫn làm mất cảnh báo mức cao mà sản phẩm định gửi cho phụ huynh. V7
giảm cảnh báo mức cao sai từ 46 xuống 24 so với v5, nhưng tăng số bỏ sót mức
cao từ 1 lên 3. Cả ba đều cảnh báo phần lớn câu `SAFE`.

**Quyết định:** giữ model mặc định v5 như hiện tại, không đưa v7/v6 vào luồng
cảnh báo thật và không coi v5 đã đạt chất lượng triển khai. Cả ba artifact
vẫn `deployment_eligible=false`. Chỉ có 9 câu mức cao, nên một lỗi làm recall
đổi 11,1 điểm phần trăm; phân bố nhãn của 81 câu cũng chưa chứng minh tỷ lệ
ngoài thực tế. Cần xem lỗi theo ID, thống nhất các ranh giới nhãn còn mơ hồ,
thu thêm câu mới đa dạng (đặc biệt `HIGH_RISK` và `SAFE`) rồi mới chỉnh model.
Nếu dùng `DuLieuThat3` để chỉnh model hoặc chọn ngưỡng, nó trở thành dữ liệu
phát triển; phải dùng một bộ khác chưa xem dự đoán để đánh giá cuối.

**Cập nhật sau phép thử:** `DuLieuThat3` đã được dùng để chọn và kiểm tra
ứng viên [v8](../../../ai-training/school_violence/V8_QUERY_CANDIDATE_STATUS.md),
nên từ thời điểm đó là dữ liệu phát triển, không còn là holdout độc lập cho
v8. Phân tích lỗi theo ID ở
[`DULIEUTHAT3_ERROR_ANALYSIS_V8.md`](DULIEUTHAT3_ERROR_ANALYSIS_V8.md).
