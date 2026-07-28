# Edge AI training workspace

Thư mục này dành cho thu thập dữ liệu, xử lý đặc trưng và huấn luyện model.
Nó được tách khỏi code chạy thật trong `child-monitor-agent`.

Mọi công cụ thu thập và huấn luyện phải dùng:

- `datasets/schema/posture_taxonomy.json` làm nguồn chuẩn cho tên và quy tắc nhãn.
- `datasets/schema/distance_standard.json` làm nguồn chuẩn cho phép đo khoảng cách.
- `datasets/schema/landmark_record.schema.json` để kiểm tra từng bản ghi.
- `datasets/README.md` làm hướng dẫn gán nhãn.

Không lưu ảnh, tên, email, token, device secret hoặc face embedding nhận dạng
trong dataset mặc định.

## Chạy hiệu chỉnh khoảng cách

Kích hoạt môi trường và chạy:

```powershell
.\ai-training\.venv\Scripts\Activate.ps1
python .\ai-training\data_collection\calibration_ui.py `
  --subject-id subject-001 `
  --method tape_measure
```

Tại mỗi khoảng cách, đo bằng thước từ tâm ống kính đến điểm giữa hai mắt rồi
nhấn Space. Giữ đầu ổn định và nhìn về webcam trong thời gian thu. Nhấn `R` để
thu lại khoảng cách hiện tại, `Q` hoặc `Esc` để hủy.

Mặc định công cụ thu tại 25, 30, 35, 40, 50, 60 và 80 cm, 20 giây mỗi khoảng
cách, 5 mẫu/giây. Kết quả nằm trong `datasets/calibration/`:

- `*.session.json`: scalar feature và metadata phiên thu; không chứa ảnh.
- `*.profile.json`: hệ số hiệu chỉnh được Agent sử dụng.
