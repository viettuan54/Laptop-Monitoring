# Dữ liệu phân loại văn bản ba nhãn

Hợp đồng record JSONL ở `../schema/text_safety_record.schema.json`; danh sách
nhãn chuẩn ở `../../school_violence/labels.json`: `SAFE`, `RISK`, `HIGH_RISK`.
Mỗi câu có đúng một `label`, không có mảng multi-label. CSV gốc 6.000 dòng
được giữ nguyên ở `Mô tả/du_lieu_bao_luc_hoc_duong_tieng_viet_6000.csv`.
Người gán nhãn áp dụng `../../school_violence/ANNOTATION_GUIDE.md`; trang hướng
dẫn phòng chống là `RISK`, không tự suy người đọc đang bị bạo lực. Báo cáo bị
bạo lực cá nhân hoặc đe dọa trực tiếp là `HIGH_RISK`.

Chạy `python -m text_safety.training --input <csv> --output-dir <thư_mục>`
trong `ai-training`; lệnh này dùng trainer ba nhãn. Thêm `--validate-only`
để xem báo cáo loại trùng và chia tập mà không ghi file. Output gồm
`train.jsonl`, `validation.jsonl`, `test.jsonl`, `model.json.gz` và
`evaluation_report.json`. Không ghi đè output đã tồn tại.

Với dữ liệu mới, mỗi ID cần một quyết định đánh giá từ **một người** trong
JSONL dạng `{"id":"...","label":"RISK","annotator_id":"reviewer-001"}`.
Lệnh `python -m text_safety.review --input <csv> --decisions <jsonl>
--output <csv_mới>` tạo CSV được duyệt, không sửa file nguồn. Công cụ chỉ
kiểm tra đủ quyết định và nhãn hợp lệ; không thể xác nhận danh tính reviewer.

Dữ liệu tổng hợp hiện tại có `review_status` trống/chưa duyệt. Điểm đánh giá
trên dữ liệu lặp khuôn không đủ để cho phép triển khai. Khi có user hoặc
conversation ID, phải cập nhật chiến lược chia theo những ID đó, rồi đánh
giá riêng trên tập thực tế đã ẩn danh và được phép sử dụng.
