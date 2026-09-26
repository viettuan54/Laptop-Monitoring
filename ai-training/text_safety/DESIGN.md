# Thiết kế phân loại văn bản ba nhãn

Phạm vi thu thập đã chốt tại
[đặc tả Agent](../../child-monitor-agent/docs/text_collection_scope.md):
`search_query` và `page_content`, chưa triển khai chat. Bộ thu thập nội dung
trang và tổng hợp đoạn chưa có trong code hiện tại.

Hệ thống hiện dùng **single-label classification** cho bạo lực học đường:
`SAFE` (không thấy nguy cơ trong phạm vi tập huấn luyện), `RISK` (cần xem xét),
`HIGH_RISK` (nguy cơ cao). Tên và thứ tự chuẩn ở
`../school_violence/labels.json`. Mỗi câu nhận đúng một nhãn; không còn
phân loại theo các danh mục kiểm duyệt cũ.

Luồng: CSV nguồn → loại câu trùng → chia theo nhóm văn bản chuẩn hóa → train
Naive Bayes ký tự 3–5 gram → báo cáo per-label precision/recall/F1 và confusion
matrix → artifact → service local → backend. API trả `label`, `scores`,
`confidence`, `flagged`, `action`. `RISK` được lưu để xem xét, `HIGH_RISK`
cho phép tạo cảnh báo. Migration v22 thêm `classification_label` và
`label_scores` cho sự kiện mới; các cột moderation cũ chỉ giữ để đọc lịch sử.

Model hiện tại train từ câu tổng hợp chưa được kiểm duyệt. Test tổng hợp đạt
điểm rất cao do câu lặp khuôn, nhưng không đo khả năng tổng quát trên chat thật.
Artifact có `deployment_eligible=false`; service production từ chối khởi động
với artifact này. Điểm `confidence` là score chuẩn hóa của Naive Bayes, chưa
được hiệu chuẩn xác suất. Không dùng một mình để ra quyết định kỷ luật hoặc
chẩn đoán. Ba nhãn không thay thế đánh giá chuyên biệt cho tự hại.

Privacy: raw text không được lưu vào PostgreSQL, không in trong lỗi kiểm tra
request; tập train/model được lưu local và Git bỏ qua. Dữ liệu mới phải được
ẩn danh, có quyền sử dụng và chia theo người dùng/hội thoại nếu có ID trước
khi xem xét triển khai.
