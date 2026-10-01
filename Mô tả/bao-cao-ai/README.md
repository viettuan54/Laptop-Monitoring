# Báo cáo AI

Các báo cáo độc lập được gom theo nhóm, giữ nguyên nội dung:

- [school_violence/](school_violence/): kết quả đánh giá model và trạng thái tập holdout.
- [content_classification/](content_classification/): báo cáo thu thập, kiểm tra dữ liệu và đánh giá model ứng dụng/website.
- [pilot/](pilot/): báo cáo kiểm tra dữ liệu tư thế pilot.
- [calibration/](calibration/): các báo cáo thử nghiệm hiệu chỉnh khoảng cách độc lập.

Các báo cáo sinh tự động vẫn được Git bỏ qua như trước khi chuyển.
Các công cụ vẫn xuất báo cáo mới về đường dẫn mặc định được ghi trong hướng dẫn chạy.

Các file sau được giữ tại chỗ vì là đầu vào của chương trình hoặc được manifest tham chiếu:

- `ai-training/artifacts/school_violence/*/evaluation_report.json`: dịch vụ AI và công cụ đánh giá đọc cùng model.
- `ai-training/datasets/calibration/model-development/strict-combined-v3.validation.json`.
- `ai-training/datasets/calibration/final-test/distance-v3-candidate.final-test.json`.

Mã nguồn, model, dataset, manifest, cấu hình và hướng dẫn chạy vẫn ở thư mục chức năng tương ứng.
