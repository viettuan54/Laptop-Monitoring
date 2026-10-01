# Đối chiếu hàng đợi duyệt với CSV nguồn

Cập nhật quy trình 2026-09-30: quyết định duyệt chỉ cần `id,label`, không cần
`annotator_id`. Các số liệu đối chiếu bên dưới vẫn giữ nguyên; việc bỏ mã
người duyệt không tự chuyển thay đổi trong hàng đợi thành quyết định cuối.

Kiểm tra ngày 2026-09-29. `review_queue.jsonl` có 536 dòng: 100 ưu tiên 1,
385 ưu tiên 2, 51 ưu tiên 3. Tất cả vẫn ghi `review_status=unreviewed`.

So với hai CSV v2.2, có 68 dòng khác nhãn (`current_label` so với `label`):
66 dòng ưu tiên 1 và hai dòng `Q_001710`, `Q_001765` ở ưu tiên 2.
Có thêm 18 dòng khác cả `text`. Những thay đổi trong hàng đợi không phải là
quyết định duyệt cuối: `current_label` vốn mô tả nhãn trong CSV. Cần ghi
nhãn đã chọn vào trường `label` của file quyết định riêng.

Hai ID `Q_001710` và `Q_001765` được người dùng nêu rõ là dự đoán
`HIGH_RISK` đúng. Tuy nhiên câu trong CSV chứa phủ định “em không bị bạn đánh”,
trái với quy tắc mặc định trong `ANNOTATION_GUIDE.md`; cần làm rõ ngữ cảnh hoặc
quy tắc trước khi ghi đè nhãn `RISK` của CSV. Không dùng dự đoán model làm
quyết định nhãn.

20 ID còn lại trong 22 lỗi test v3 được người dùng mô tả là “bỏ vì câu không
rõ ràng”, nhưng hiện vẫn ở CSV nguồn. Chưa rõ “bỏ” nghĩa là loại khỏi toàn bộ
train/validation/test của phiên bản mới hay chỉ bỏ khỏi hàng đợi. Vì vậy chưa
loại dữ liệu hay sửa split/group âm thầm.

Các ID đó là `Q_000056`, `Q_000087`, `Q_000151`, `Q_000375`, `Q_000429`,
`Q_000583`, `Q_001436`, `Q_001447`, `Q_002005`, `Q_002013`, `Q_002029`,
`Q_002043`, `Q_002044`, `Q_002053`, `Q_002057`, `Q_002058`, `Q_003407`,
`Q_003415`, `Q_003708`, `Q_003709`. Tám ID đầu đã biến mất khỏi hàng đợi;
12 ID sau vẫn ở đó. Tất cả 20 ID vẫn có trong CSV query v2.2.

Để phát hành CSV mới, cần file quyết định riêng cho các câu đã duyệt, theo
schema ở `README.md`: `id`, `label`; đồng thời cần danh sách ID
loại khỏi dữ liệu model được xác nhận rõ. Chỉ mẫu thực sự được duyệt mới có
`review_status=reviewed`. Giữ nguyên hai CSV v2.2 và model v3 hiện có để
truy vết; xuất phiên bản mới sau khi xác nhận, rồi chạy `--validate-only` để
kiểm tra trùng, rò rỉ, nhóm và split.

SHA-256 tại thời điểm đối chiếu:

- `review_queue.jsonl`: `3a08a64bcbed0f87760b2205a1c672255a58c2e10ca5c0a139d14030b464e911`
- `laptopmonitoring_query_dataset_v2_2.csv`: `7dc0ab8d687a2a4830f301cb09459a89ef9939742cc29e006dca8abd334d6c3f`
- `laptopmonitoring_webpage_dataset_v2_2.csv`: `3180218c75711db0273d7336355a6153bf5a612d8e97926f4859ebb9740f0eca`
