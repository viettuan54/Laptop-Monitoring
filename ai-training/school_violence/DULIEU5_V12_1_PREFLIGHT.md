# Tiền kiểm Dulieu5 trước khi đánh giá v12.1

**Cập nhật sau xác nhận:** người dùng đã đồng ý đổi đúng sáu nhãn. Đã sửa
trước lần dự đoán đầu, rồi [đánh giá đủ 90 câu](DULIEU5_V12_1_EVALUATION.md):
75/90 đúng, HIGH_RISK đúng 26/26, còn cảnh báo sai. Nguồn bộ mới chưa được
xác nhận riêng nên chưa công bố kiểm thử thực tế độc lập. Phần dưới giữ
lịch sử tiền kiểm trước khi nhận xác nhận này.

Ngày 2026-10-06. Đã tìm thấy `Mô tả/Dulieu5.csv` và kiểm tra toàn bộ
90 câu. **Chưa chạy dự đoán**: cần chốt sáu nhãn có điểm không khớp hướng
dẫn hiện tại và xác nhận thông tin nguồn bộ mới. Không sửa CSV hoặc model.

## Kết quả kiểm tra dữ liệu

- Đúng ba cột `id,text,label`, đủ nhãn: SAFE 30, RISK 30, HIGH_RISK 30.
- Không thiếu/đúp ID, không có câu rỗng, nhãn ngoài danh sách, vượt giới
  hạn đầu vào hoặc dấu hiệu định danh rõ theo bộ lọc hiện tại.
- Không có câu trùng chính xác sau chuẩn hóa hoặc gần trùng với 2.308 bản
  ghi tham chiếu của artifact và archive các câu đã xem. Số tham chiếu này
  có thể chứa cùng câu ở nhiều nguồn, không phải 2.308 câu duy nhất.
- Không có cặp gần trùng trong 90 câu mới. Ngưỡng giống ký tự là 0,85;
  kết quả này không chứng minh độc lập về ngữ nghĩa hoặc theo trẻ/phiên.
- Model v12.1 và archive tham chiếu đều khớp checksum trong khóa.

SHA-256 nguồn ban đầu:
`0569b01184d31ba2b776ac44e951f95c55d0cbf80a2070da98819771c1c7fc53`.

Snapshot và kết quả máy nằm ngoài Git:
`ai-training/artifacts/school_violence/dulieu5_v12_1_preflight_0569b01184d3/`.

## Sáu nhãn cần chốt trước dự đoán

| ID Dulieu5 | Nhãn hiện có | Theo hướng dẫn hiện tại | Lý do rà soát |
| --- | --- | --- | --- |
| 43 | RISK | HIGH_RISK | Đe dọa tiết lộ chuyện riêng để buộc làm theo yêu cầu. |
| 66 | HIGH_RISK | RISK | Chứng kiến nguy hiểm với người khác, chưa nói chính trẻ bị tác động. |
| 71 | HIGH_RISK | RISK | Chứng kiến nguy hiểm với người khác, chưa nói chính trẻ bị tác động. |
| 74 | HIGH_RISK | RISK | Nguy hiểm xảy ra với bạn của trẻ, chưa nói chính trẻ bị tác động. |
| 77 | HIGH_RISK | RISK | Phát hiện người khác gặp nguy hiểm, chưa nói chính trẻ bị tác động. |
| 84 | HIGH_RISK | RISK | Chứng kiến nguy hiểm với người khác, chưa nói chính trẻ bị tác động. |

Đây là rà soát ngữ nghĩa theo [hướng dẫn](ANNOTATION_GUIDE.md), không phải
kết quả model và chưa phải quyết định thay nhãn. Quy tắc chứng kiến đã được
người dùng xác nhận cho Dulieu4 ID 82 ở lượt trước. Các tình huống khẩn cấp
với người khác có thể cần một quy tắc sản phẩm khác; không tự thêm ngoại lệ
vào thông điệp hiện tại “Bé có dấu hiệu bị bạo lực”.

Đã gửi câu hỏi về năm ID chứng kiến, ID 43, cùng nguồn thực tế/tự soạn,
ẩn danh, quyền sử dụng và nhãn chốt trước dự đoán. Câu trả lời cho bộ cũ
không được tự gán thành lời xác nhận nguồn cho Dulieu5.

## Bước kế tiếp đã chuẩn bị

[Kế hoạch đánh giá](DULIEU5_V12_1_EVALUATION_PLAN.md) đã ghi trước dự đoán,
gồm mốc kỹ thuật về bỏ sót mức cao, cảnh báo sai và macro-F1. Khi người
cung cấp chốt các điểm trên, lưu quyết định và phiên bản nguồn cuối rồi
chấm đủ 90 câu bằng đúng v12.1 đã khóa. Không cần thêm một bộ dữ liệu khác
để thực hiện lượt kiểm thử này.

Chưa có điểm accuracy/F1 hoặc danh sách dự đoán sai của Dulieu5. Bản này
không thay báo cáo phát triển, khóa ứng viên hoặc model mặc định v5.
