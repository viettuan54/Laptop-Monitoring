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
đưa chấm biểu diễn điểm giữa hai mắt vào khung hướng dẫn. Khi khung chuyển
xanh, nhấn Space. Giữ đầu thẳng, hai mắt ngang và nhìn về webcam trong thời
gian thu. Nhấn `R` để thu lại khoảng cách hiện tại, `Q` hoặc `Esc` để hủy.

Công cụ không cho bắt đầu khi mặt chưa đúng vị trí. Trong ba giây ổn định, nếu
người tham gia lệch khỏi khung, cúi/ngửa, nghiêng hoặc quay đầu thì bộ đếm được
khởi động lại. Mẫu không đạt quality gate không được ghi vào session.

Mặc định công cụ thu tại 25, 30, 35, 40, 50, 60 và 80 cm, 20 giây mỗi khoảng
cách, 5 mẫu/giây. Kết quả nằm trong `datasets/calibration/`:

- `*.session.json`: scalar feature và metadata phiên thu; không chứa ảnh.
- `*.profile.json`: profile hồi quy bậc hai phiên bản 2.0.0.

Có thể tạo lại profile v2 từ một session cũ mà không cần mở webcam:

```powershell
python .\ai-training\data_collection\build_profile.py `
  .\ai-training\datasets\calibration\<session>.session.json
```

Profile v2 dùng công thức `a*x² + b*x + c`, với
`x = 1 / eye_separation_normalized`. Các metric trong profile được tính trên
chính session huấn luyện và không thay thế kết quả đánh giá bằng session khác.

Đánh giá profile cố định trên session độc lập:

```powershell
python .\ai-training\evaluation\evaluate_distance_profile.py `
  .\ai-training\datasets\calibration\<profile-v2>.json `
  .\ai-training\datasets\calibration\validation-run\<session>.session.json
```

Công cụ báo cáo MAE/RMSE/bias tổng thể, MAE vùng 30–40 cm, kết quả từng khoảng
cách, confusion matrix tại ngưỡng 35 cm và mẫu nằm ngoài miền hiệu chỉnh.
