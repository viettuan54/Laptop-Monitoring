# Trạng thái tập holdout ứng viên

`Mô tả/holdout.jsonl` hiện chỉ là **tập chẩn đoán**, không phải holdout thực tế
độc lập để quyết định bật cảnh báo. Kiểm tra ngày 2026-09-29 trên file có SHA-256
`5be7a2865c37b5202d4b53219971b6897a54d8dce04b1b8b36d4e423efd4fcfa`:

- 600 câu: 218 `SAFE`, 198 `RISK`, 184 `HIGH_RISK`.
- Cả 600 câu là `search_query`; chưa có `page_content`.
- Cả 600 câu ghi `reviewed` nhưng `annotator_id` trống.
- Cả 600 câu ghi `source=real_world` nhưng `permission_reference=not_applicable_synthetic`.
- Có 9 câu trùng sau chuẩn hóa với câu khác trong cùng tập.

Không sửa metadata để ép tập này qua bộ kiểm tra. Nếu đây là câu tổng hợp,
đánh dấu đúng là tổng hợp và chỉ dùng để tìm lỗi model; không dùng điểm số của
nó làm bằng chứng sẵn sàng triển khai. Các nhãn có thể được rà soát để hiểu
lỗi, nhưng sau khi dùng tập này để chọn/sửa model thì cần một holdout mới.

Chạy kiểm tra lại từ `ai-training` (không ghi đè dữ liệu):

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.audit_holdout_candidate `
  --candidate '..\Mô tả\holdout.jsonl'
```

Để hoàn thành holdout cuối, cần cung cấp các câu thực tế thu thập đúng phạm vi
đã bật/tắt, có quyền sử dụng, được ẩn danh và một người thực sự duyệt nhãn.
Tập mới cần cả `search_query` và `page_content`, đủ ba nhãn ở mỗi loại,
`group_id` ẩn danh ổn định theo người/hội thoại/trang, và không trùng nhóm hay
văn bản với train/validation/test cũ. Đặt tập thực tế ngoài Git tại
`ai-training/datasets/school_violence/real_world_holdout_v1.jsonl` theo schema
và lệnh đánh giá trong `REAL_WORLD_EVALUATION.md`. Không tự tạo dữ liệu thực,
mã người duyệt hoặc mã quyền sử dụng.

Kiểm tra bằng mã chỉ xác minh cấu trúc và một số dạng trùng/PII rõ ràng; bằng
chứng về quyền sử dụng, nguồn thu thập và việc duyệt nhãn phải xác minh ngoài mã.
