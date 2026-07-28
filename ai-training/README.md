# Edge AI training workspace

Thư mục này dành cho thu thập dữ liệu, xử lý đặc trưng và huấn luyện model.
Nó được tách khỏi code chạy thật trong `child-monitor-agent`.

Mọi công cụ thu thập và huấn luyện phải dùng:

- `datasets/schema/posture_taxonomy.json` làm nguồn chuẩn cho tên và quy tắc nhãn.
- `datasets/schema/landmark_record.schema.json` để kiểm tra từng bản ghi.
- `datasets/README.md` làm hướng dẫn gán nhãn.

Không lưu ảnh, tên, email, token, device secret hoặc face embedding nhận dạng
trong dataset mặc định.
