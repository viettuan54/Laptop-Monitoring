# Dữ liệu phân loại văn bản ba nhãn

Hợp đồng record JSONL ở `../schema/text_safety_record.schema.json`; danh sách
nhãn chuẩn ở `../../school_violence/labels.json`: `SAFE`, `RISK`, `HIGH_RISK`.
Mỗi câu có đúng một `label`, không có mảng multi-label. Hai CSV v2.2 hiện có
6.000 query và 5.986 webpage trong `Mô tả/`; CSV bạo lực học đường 6.000 câu
gốc được giữ riêng ở `Mô tả/du_lieu_bao_luc_hoc_duong_tieng_viet_6000.csv`.
Người gán nhãn áp dụng `../../school_violence/ANNOTATION_GUIDE.md`; trang hướng
dẫn phòng chống là `RISK`, không tự suy người đọc đang bị bạo lực. Báo cáo bị
bạo lực cá nhân hoặc đe dọa trực tiếp là `HIGH_RISK`.

Chạy `python -m text_safety.training --input <query.csv> <webpage.csv>
--output-dir <thư_mục> --validate-only` trong `ai-training` để kiểm tra bộ
kết hợp mà không train/ghi file. Trainer ba nhãn giữ `group_id` và `split`
trong CSV, không chia lại. Khi bỏ `--validate-only`, output gồm các tập
JSONL, `model.json.gz`, `dataset_manifest.json`, `training_config.json`
và `evaluation_report.json`. Không ghi đè output đã tồn tại. Xem thêm
`../../school_violence/README.md`.

Với dữ liệu mới, **một người** có thể đánh giá từng mẫu; không bắt buộc hai
người. Chỉ gửi quyết định cho ID thực sự đã được người đó xem, JSONL dạng
`{"id":"...","label":"RISK","annotator_id":"reviewer-001"}`. Hàng đợi
`Mô tả/label_review_v2_2/review_queue.jsonl` là báo cáo tiền kiểm tự động,
**không** phải file quyết định và không được nạp thẳng vào lệnh review.

Lệnh `python -m text_safety.review --input <csv> --decisions <quyết_định.jsonl>
--output <csv_mới> --dataset-version v2.3` tạo CSV riêng, không sửa file nguồn.
Chỉ các ID có quyết định mới được ghi `review_status=reviewed` và `annotator_id`;
cột `annotation_status` (nếu có) chỉ đổi thành `human_reviewed` cho các ID đó;
các mẫu còn lại vẫn `unreviewed`. Nếu nguồn có `dataset_version`, phải đặt
version mới khác version nguồn. Công cụ từ chối ID lạ, quyết định lặp và nhãn
xung đột giữa các câu tương đương; không thể xác thực danh tính reviewer bên
ngoài file quyết định. Sau khi áp dụng, chạy `school_violence.training
--validate-only` trên cả hai nguồn để kiểm tra rò rỉ và nhãn lại.

Dữ liệu tổng hợp hiện tại có `review_status` trống/chưa duyệt. Điểm đánh giá
trên dữ liệu lặp khuôn không đủ để cho phép triển khai. Khi có user hoặc
conversation ID, phải cập nhật chiến lược chia theo những ID đó, rồi đánh
giá riêng trên tập thực tế đã ẩn danh và được phép sử dụng.
