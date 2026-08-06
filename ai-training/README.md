# Edge AI training workspace

Thư mục này dành cho thu thập dữ liệu, xử lý đặc trưng và huấn luyện model.
Nó được tách khỏi code chạy thật trong `child-monitor-agent`.

Mọi công cụ thu thập và huấn luyện phải dùng:

- `datasets/schema/posture_taxonomy.json` làm nguồn chuẩn cho tên và quy tắc nhãn.
- `datasets/schema/distance_standard.json` làm nguồn chuẩn cho phép đo khoảng cách.
- `datasets/schema/landmark_record.schema.json` để kiểm tra từng bản ghi.
- `datasets/README.md` làm hướng dẫn gán nhãn.

Phân loại nội dung ứng dụng/website dùng taxonomy riêng tại
`datasets/schema/content_classification_taxonomy.json`. Trước khi train, bắt
buộc chạy `content_classification/validate_dataset.py`; chỉ dataset có exit code
`0` mới được chuyển sang bước chia train/validation/test.

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
thu vào manifest. Luồng MediaPipe không nạp Matplotlib vì collector tự vẽ bằng
OpenCV; điều này tránh DLL Matplotlib không cần thiết bị Windows Application
Control chặn.

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

Collector áp dụng quality gate phiên bản `2.0.0` cho các nhãn tư thế tĩnh:

- `forward_head`: góc cổ phải lớn hơn 25 độ.
- `trunk_lean`: cả hai hông phải nhìn thấy và góc thân phải lớn hơn 18 độ.
- `shoulder_tilt_left/right`: độ nghiêng phải lớn hơn 12 độ và đúng phía giải
  phẫu của nhãn đã chọn.
- `slouching`: phải đồng thời đạt điều kiện của `forward_head` và `trunk_lean`.

Mọi record tĩnh, kể cả `good` và `forward_head`, phải thấy đủ hai tai, hai vai
và hai hông. Tư thế `good` không được vi phạm luật hình học và mọi vi phạm rõ
theo luật phải được chọn nhãn. Các session `pre-v1`/`1.0.0` cũ vẫn được giữ để
audit nhưng trainer chủ động từ chối; cần thu lại bằng collector hiện tại.

Đặt webcam sao cho khung hình thấy từ đầu đến ít nhất cả hai hông khi thu
`trunk_lean` hoặc `slouching`. Chỉ frame có dòng `Capture quality: READY` mới
được ghi; frame `BLOCKED` bị bỏ qua và lý do khắc phục được hiển thị ngay trên
preview. `records` đếm mẫu hợp lệ, còn `rejected` đếm lần lấy mẫu bị chặn. Các
tổng này cùng số lần từ chối theo từng lý do được ghi vào manifest. Frame bật
`T` là chuyển tiếp nên không áp dụng ngưỡng của tư thế tĩnh.

## Báo cáo dataset pilot

`datasets/pilot/accepted_sessions.json` đóng băng danh sách session được dùng,
primary class, số mẫu và SHA-256 mong đợi. Các session thử hoặc đã được thu lại
vẫn được giữ nguyên nhưng phải nằm trong `excluded_sessions` kèm lý do.

Chạy lại báo cáo sau mỗi lần thay đổi danh sách accepted:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\evaluation\report_pilot_dataset.py
```

Công cụ kiểm tra checksum, JSON Schema, identity/timestamp, phân bố nhãn,
subject/camera/khoảng cách, landmark bị thiếu, visibility của tai/vai/hông và
xung đột nhãn. Kết quả được ghi vào `datasets/pilot/pilot_dataset_report.json`
và `datasets/pilot/pilot_dataset_report.md`.

## Quy trình ba subject và baseline classifier

Không tạo subject giả. Dùng ba mã ẩn danh, ví dụ `subject-001`, `subject-002`,
`subject-003`. Mỗi người thu ít nhất hai session riêng cho từng lớp; mỗi session
chỉ ghi một lớp và nên thực hiện khác thời điểm hoặc ánh sáng. Riêng `good` bắt
buộc ít nhất hai session để tạo profile cá nhân.

Ví dụ thu 100 record cho một session:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\data_collection\capture_landmarks.py `
  --subject-id subject-002 `
  --max-records 100
```

Chọn nhãn trước khi bật ghi. Lặp cho `good`, `forward_head`, `trunk_lean`, hai
hướng vai và `slouching`. Sau khi kiểm tra từng session, thêm nó vào
`datasets/pilot/accepted_sessions.json` kèm `primary_class`, sample count và
SHA-256 như cấu trúc hiện tại. Không đưa session thử hoặc session nhiều lớp vào
danh sách accepted.

Trainer lấy lại mẫu ở đúng 2 Hz như Agent, gom sáu mẫu thành cửa sổ ba giây và
bắt buộc leave-one-subject-out. Nó dừng với lỗi nếu ít hơn ba subject, thiếu lớp
ở bất kỳ subject nào hoặc còn session dùng quality gate cũ:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\training\train_posture_baseline.py
```

Kết quả không chứa ảnh:

- `artifacts/posture_baseline_v1.json`.
- `artifacts/posture_loso_report.json` với từng fold giữ riêng một subject.

Model chỉ được đánh dấu `deployment_approved` khi LOSO đạt đồng thời macro
recall tối thiểu 70%, accuracy trên các dự đoán đủ confidence tối thiểu 80% và
conclusive coverage tối thiểu 50%. Agent từ chối model không qua gate này và
tiếp tục dùng rule-based.

Tạo profile trung tính riêng từ ít nhất hai session `good` đã accepted:

```powershell
.\ai-training\.venv\Scripts\python.exe `
  .\ai-training\data_collection\build_posture_profile.py `
  --subject-id subject-001
```

Profile được ghi cạnh dataset và phải được cài đúng máy/camera của subject.
Model hoặc profile thiếu/không hợp lệ không làm mất rule-based safety fallback.
