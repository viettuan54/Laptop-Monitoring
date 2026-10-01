# Baseline câu tìm kiếm v2.4 / model v5

Mốc kỹ thuật cố định: `school-violence-query-v2.4-v5`. Phạm vi chỉ là câu tìm
kiếm (`search_query`) và ba nhãn `SAFE`, `RISK`, `HIGH_RISK`. Các checksum và
thống kê chính xác nằm trong
[`query_v2_4_v5_baseline.lock.json`](query_v2_4_v5_baseline.lock.json).

- CSV v2.4 có 5.594 câu: train 3.932, validation 839, test 823. Báo cáo
  [lọc v2.4](../../Mô%20tả/query_dataset_v2_4_filter_report.json) ghi 13 ID
  chỉ bị loại khỏi test. Nhãn cũ của chúng là `RISK`; người dùng xác nhận dự
  đoán `HIGH_RISK` của model là đúng. Train và validation không thay đổi.
- Model là Naive Bayes ký tự 3–5 gram, `alpha=0.5`, chỉ học từ `text`. Artifact
  cục bộ nằm ở `ai-training/artifacts/school_violence/vi-school-violence-char-nb-v5-query/`
  và không đưa lên Git. File lock giữ SHA-256 của CSV, báo cáo lọc, mã lọc,
  trainer, bộ chuẩn hóa, hợp đồng nhãn, cấu hình service, các split và nội dung
  model đã giải nén. SHA-256 của file gzip gốc là dấu mốc tham khảo; gzip mới
  có thể khác byte dù trọng số giống nhau.
- Test tổng hợp còn lại có macro-F1 1,0. **Đây không phải kết quả độc lập** vì
  13 dòng đã được chọn sau khi xem bất đồng nhãn trên test. Dữ liệu còn lại
  chủ yếu là tổng hợp và chưa được duyệt toàn bộ. Artifact giữ
  `deployment_eligible=false`; mốc này không cho phép triển khai production.

Kiểm tra mốc hiện có từ thư mục `ai-training`:

```powershell
python -B -m school_violence.verify_query_baseline_v5 --retrain --api-smoke
```

Công cụ kiểm tra checksum và từng bản ghi so với v2.3, xác nhận chỉ 13 dòng
test bị loại, kiểm tra các split của artifact, huấn luyện lại trong thư mục tạm
và so sánh model theo nội dung sau giải nén. `--api-smoke` thử `/health` và
`/v1/moderate` trong chế độ development với ví dụ của cả ba nhãn. Bỏ
`--api-smoke` nếu môi trường chỉ có thư viện Python chuẩn; để chạy API cần các
phụ thuộc của service. Cùng lượt thử xác nhận cấu hình production từ chối
artifact chưa được duyệt. Lệnh không ghi đè CSV hoặc artifact gốc.

Trên checkout mới, trước tiên tạo artifact vào thư mục trống bằng lệnh train
trong [hướng dẫn v2.4](../../Mô%20tả/DATASET_QUERY_V2_4_README.md), sau đó
chạy lệnh kiểm tra trên. Không chạy `--create-lock` để thay thế một mốc cũ;
cờ đó chỉ dùng một lần để tạo file lock mới khi chưa tồn tại. Nếu dữ liệu,
mã hoặc model được thay đổi có chủ đích, tạo phiên bản baseline mới.
