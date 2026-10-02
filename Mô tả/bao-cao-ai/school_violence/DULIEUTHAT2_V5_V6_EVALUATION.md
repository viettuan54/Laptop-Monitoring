# Kiểm thử v5 và ứng viên v6 trên `DuLieuThat2`

**Lưu ý:** báo cáo này giữ nguyên kết quả trên bản nhãn ban đầu. CSV hiện
đã được sửa nhãn và nội dung ở các lần rà sau; xem
[`DULIEUTHAT2_LABEL_CONSISTENCY_RECHECK_V2.md`](DULIEUTHAT2_LABEL_CONSISTENCY_RECHECK_V2.md)
trước khi dùng các số liệu dưới đây.

Ngày 2026-10-02. Người cung cấp xác nhận 99 câu trong `DuLieuThat2_review.csv`
được phép dùng để kiểm thử, đã ẩn danh và được gán nhãn **trước khi xem dự đoán
v5/v6**. Đây là lời xác nhận của người cung cấp, không phải điều mã nguồn tự
chứng minh. SHA-256 của CSV đã khóa trước lần dự đoán là
`bad03989d235cf44df75256a55b17421decb7a8a47476bd732dd4383a27774c2`.
File có 9 `SAFE`, 40 `RISK`, 50 `HIGH_RISK`; không có ô trống hay nhãn sai.

Kiểm tra tự động không thấy mẫu dữ liệu nhạy cảm rõ ràng, câu trùng sau chuẩn
hóa trong bộ mới, hoặc câu trùng chính xác sau chuẩn hóa với 94 câu cũ hay các
split của v5/v6. Không thấy cặp câu giữa hai bộ có độ tương tự ký tự từ 0,85
trở lên; trong bộ mới có 5 cặp gần giống ở mức này. ID số được đánh lại từ
đầu, nên báo cáo dùng tiền tố `DuLieuThat2:`. Không có mã trẻ/phiên để kiểm
tra sự phụ thuộc ở cấp đó; tỷ lệ các nhãn trong bộ này cũng không chứng minh
phân bố tìm kiếm thực tế của mọi trẻ.

Hai model được đánh giá một lần trên **cùng bản CSV**, không cập nhật trọng số
hay chọn ngưỡng bằng các nhãn này. Model v5 có SHA-256 artifact
`8c9c9642f796a596ce091ee8cf3ebe564be859862f115f22c985faba58f2bc7b`;
ứng viên v6 có SHA-256
`610207001150ead8b5db1d5ee438872509e319b05c32b205d091ddd57c29088d`.
Báo cáo JSON chỉ chứa thống kê và ID lỗi nằm cục bộ ngoài Git tại
`ai-training/artifacts/school_violence/DuLieuThat2_v5_eval.json` và
`DuLieuThat2_v6_eval.json`. Bảng đối chiếu ID và dự đoán nằm ở
`Mô tả/DuLieuThat2_model_comparison.csv`, cũng bị Git bỏ qua; không có nguyên
văn câu tìm kiếm trong các báo cáo này.

| Chỉ số trên bộ 99 câu | v5 | v6 ứng viên |
| --- | ---: | ---: |
| Nhận đúng `SAFE` | 4/9 | 3/9 |
| Nhận đúng `RISK` | 10/40 | 4/40 |
| Nhận đúng `HIGH_RISK` | 25/50 | 42/50 |
| `HIGH_RISK` bị hạ xuống `RISK` | 25 | 8 |
| `RISK` bị nâng lên `HIGH_RISK` | 30 | 36 |
| Câu `SAFE` bị cảnh báo ở bất kỳ mức nào | 5/9 | 6/9 |
| Tổng câu nhận đúng | 39/99 | 49/99 |
| Macro-F1 | 0,4460 | 0,4289 |

Ma trận nhầm lẫn (hàng là nhãn người cung cấp gán, cột là dự đoán):

| Model / nhãn thật | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| v5 / SAFE | 4 | 2 | 3 |
| v5 / RISK | 0 | 10 | 30 |
| v5 / HIGH_RISK | 0 | 25 | 25 |
| v6 / SAFE | 3 | 3 | 3 |
| v6 / RISK | 0 | 4 | 36 |
| v6 / HIGH_RISK | 0 | 8 | 42 |

Không có câu `HIGH_RISK` nào bị đoán `SAFE` ở cả hai model, nhưng nhầm thành
`RISK` vẫn bỏ lỡ cảnh báo mức cao mà sản phẩm dự kiến gửi cho phụ huynh. V6 sửa
đúng 17 trường hợp mức cao này và không làm sai thêm câu `HIGH_RISK` đã đúng ở
v5. Trên toàn bộ bộ test, 18 câu chuyển từ sai thành đúng và 8 câu chuyển từ
đúng thành sai. Đồng thời, v6 đưa 39 câu không phải `HIGH_RISK` vào mức cảnh
báo cao (v5: 33), nên việc giảm bỏ sót đi kèm tăng cảnh báo quá mức. Tám ID
`HIGH_RISK` vẫn bị v6 hạ mức là `DuLieuThat2:8`, `:9`, `:17`, `:27`, `:33`,
`:56`, `:63`, `:74`.

**Quyết định hiện tại:** chưa thay model mặc định hoặc bật ứng viên v6 trong
production. V6 cải thiện rõ việc nhận `HIGH_RISK` trên bộ này nhưng phân biệt
`RISK` và `HIGH_RISK` còn kém; mẫu `SAFE` chỉ có 9 câu nên chưa đủ để tin vào
tỷ lệ cảnh báo nhầm. Cần thêm dữ liệu thật đa dạng và đánh giá lại theo mục tiêu
cảnh báo đã thống nhất. Nếu dùng 99 câu này để chỉnh v6 hoặc chọn ngưỡng, bộ
này không còn là phép kiểm thử cuối độc lập; phải thu một bộ mới chưa xem model
để quyết định triển khai. Cả hai artifact vẫn `deployment_eligible=false`.

Phân tích lỗi theo ID và những trường hợp cần chốt lại quy tắc nhãn được ghi ở
[`DULIEUTHAT2_ERROR_ANALYSIS.md`](DULIEUTHAT2_ERROR_ANALYSIS.md).
