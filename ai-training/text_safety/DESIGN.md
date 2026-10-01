# Thiết kế phân loại văn bản ba nhãn

Phạm vi thu thập đã chốt tại
[đặc tả Agent](../../child-monitor-agent/docs/text_collection_scope.md):
chỉ `search_query` trong giai đoạn hiện tại. `page_content` để giai đoạn sau;
chưa triển khai chat.

Hệ thống hiện dùng **single-label classification** cho bạo lực học đường:
`SAFE` (không thấy nguy cơ trong phạm vi tập huấn luyện), `RISK` (cần xem xét),
`HIGH_RISK` (nguy cơ cao). Tên và thứ tự chuẩn ở
`../school_violence/labels.json`. Mỗi câu nhận đúng một nhãn; không còn
phân loại theo các danh mục kiểm duyệt cũ.

Luồng: CSV nguồn → loại câu trùng → chia theo nhóm văn bản chuẩn hóa → train
Naive Bayes ký tự 3–5 gram → báo cáo per-label precision/recall/F1 và confusion
matrix → artifact → service local → backend. API trả `label`, `scores`,
`confidence`, `flagged`, `action`. `SAFE` không cảnh báo. `RISK` tạo cảnh báo
“Cần quan sát bé trong thời gian này” (`text_risk`); `HIGH_RISK` tạo cảnh báo
“Bé có dấu hiệu bị bạo lực” (`text_violence`). Cooldown năm phút tách theo
loại cảnh báo. Migration v23 thêm `text_risk`; v22 thêm `classification_label` và
`label_scores` cho sự kiện mới; các cột moderation cũ chỉ giữ để đọc lịch sử.

Model hiện tại train từ câu tổng hợp chưa được kiểm duyệt. Test tổng hợp đạt
điểm rất cao do câu lặp khuôn, nhưng không đo khả năng tổng quát trên câu tìm kiếm thực tế.
Artifact có `deployment_eligible=false`; service production từ chối khởi động
với artifact này. Điểm `confidence` là score chuẩn hóa của Naive Bayes, chưa
được hiệu chuẩn xác suất. Không dùng một mình để ra quyết định kỷ luật hoặc
chẩn đoán. Ba nhãn không thay thế đánh giá chuyên biệt cho tự hại.

Privacy: raw text không được lưu vào PostgreSQL, không in trong lỗi kiểm tra
request; tập train/model được lưu local và Git bỏ qua. Dữ liệu mới phải được
ẩn danh, có quyền sử dụng và chia theo người dùng/hội thoại nếu có ID trước
khi xem xét triển khai.

Service mặc định nạp v5-query, train trên query v2.4 sau khi loại 393 câu phủ định
và 13 câu khỏi test. Người dùng xác nhận model dự đoán `HIGH_RISK` đúng cho 13
câu dù nhãn test cũ là `RISK`; trọng số v5 không đổi và test sau lọc không độc
lập. Duyệt nhãn chỉ yêu cầu `id,label`, không thu mã người duyệt. Kiểm thử thực
tế cần đủ ba nhãn cho `search_query`.
