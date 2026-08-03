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
- `*.profile.json`: profile tuyến tính đơn điệu phiên bản 3.0.0.

Có thể tạo profile v3 từ một hoặc nhiều session mà không cần mở webcam:

```powershell
python .\ai-training\data_collection\build_profile.py `
  .\ai-training\datasets\calibration\<session-1>.session.json `
  .\ai-training\datasets\calibration\<session-2>.session.json
```

Profile v3 dùng công thức đơn điệu `slope*x + intercept`, với
`x = 1 / eye_separation_normalized`. Builder từ chối slope âm và từ chối gộp
session khác camera, subject hoặc độ phân giải. Metric trong profile được tính
trên dữ liệu huấn luyện và không thay thế đánh giá bằng session khác.

Đánh giá profile cố định trên session độc lập:

```powershell
python .\ai-training\evaluation\evaluate_distance_profile.py `
  .\ai-training\datasets\calibration\<profile-v3>.json `
  .\ai-training\datasets\calibration\validation-run\<session>.session.json
```

Công cụ báo cáo MAE/RMSE/bias tổng thể, MAE vùng 30–40 cm, kết quả từng khoảng
cách, confusion matrix, policy ba vùng và mẫu nằm ngoài miền hiệu chỉnh.

```text
distance < 33 cm       -> warning
33 <= distance < 37 cm -> uncertain, continue_sampling
distance >= 37 cm      -> safe
```

Sau khi validation đạt, đóng băng candidate trước khi thu final test:

```powershell
python .\ai-training\evaluation\freeze_distance_candidate.py `
  <profile-v3> `
  <validation-report>
```

Không dùng session final test để fit lại profile candidate.

Thu final test ở chế độ chỉ tạo session:

```powershell
python .\ai-training\data_collection\calibration_ui.py `
  --subject-id subject-001 `
  --distances 30,32,34,35,36,38,40 `
  --capture-seconds 10 `
  --method tape_measure `
  --session-only `
  --output-dir .\ai-training\datasets\calibration\final-test
```

Nếu báo cáo final test đạt, cập nhật manifest mà không thay đổi profile:

```powershell
python .\ai-training\evaluation\finalize_distance_candidate.py `
  <candidate-manifest> `
  <final-test-report>
```

## Thu landmark tư thế cho pilot

`capture_landmarks.py` dùng trực tiếp `analyze_posture` từ Agent để trạng thái
quan sát, góc và gợi ý feature trong preview không lệch khỏi runtime. Công cụ
không có đường ghi ảnh; chỉ ghi landmark đã validate vào JSONL và metadata phiên
thu vào manifest.

Phiên tư thế không đo khoảng cách:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\data_collection\capture_landmarks.py `
  --subject-id subject-001 `
  --max-records 300
```

Phiên có khoảng cách đã đo cố định:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\data_collection\capture_landmarks.py `
  --subject-id subject-001 `
  --distance-cm 35 `
  --method tape_measure `
  --uncertainty-cm 1
```

Phím điều khiển:

- `Space`: bắt đầu/dừng ghi record.
- `G`: tư thế tốt, xóa các nhãn đang chọn.
- `1`: `forward_head`.
- `2`: `trunk_lean`.
- `3`: `shoulder_tilt_left`.
- `4`: `shoulder_tilt_right`.
- `T`: bật/tắt frame chuyển tiếp.
- `Q` hoặc `Esc`: kết thúc và ghi manifest.

`slouching` được dẫn xuất tự động khi có cả `forward_head` và `trunk_lean`.
Trái/phải luôn theo giải phẫu người tham gia dù preview được lật gương. Kết quả
mặc định nằm trong `datasets/pilot/` và được `.gitignore` để tránh commit dữ liệu
landmark cá nhân.
