# Quy chuẩn nhãn dataset Edge AI

Phiên bản taxonomy hiện tại: `1.0.0`.

## 1. Tách khả năng quan sát và tư thế

`visibility_state` mô tả camera có đủ dữ liệu để đánh giá hay không:

- `visible`: thấy đủ tai, vai và các điểm cần thiết; được phép gán nhãn tư thế.
- `partially_visible`: thấy người nhưng thiếu hoặc che khuất landmark cần thiết.
- `not_visible`: không phát hiện được người phù hợp trong khung hình.

Khi `visibility_state` khác `visible`, `posture_labels` bắt buộc phải rỗng và
`posture_state` phải là `unknown`. Không dùng `body_not_visible` như một nhãn
tư thế.

## 2. Nhãn tư thế

`posture_labels` là danh sách đa nhãn, chỉ gồm:

- `forward_head`: đầu/cổ đưa hoặc gập về trước so với trục thân trong một tư
  thế được giữ ổn định. Không gán cho thao tác nhìn xuống ngắn hạn.
- `trunk_lean`: trục từ trung điểm hông đến trung điểm vai lệch rõ khỏi tư thế
  thân thẳng. Nhãn hiện tại không phân biệt trước, sau hoặc sang bên.
- `shoulder_tilt_left`: vai trái giải phẫu của người tham gia thấp hơn vai phải.
- `shoulder_tilt_right`: vai phải giải phẫu của người tham gia thấp hơn vai trái.
- `slouching`: nhãn dẫn xuất, chỉ xuất hiện khi cùng bản ghi có cả
  `forward_head` và `trunk_lean`.

Trái/phải luôn tính theo cơ thể người tham gia, không tính theo phía trái/phải
của người xem ảnh. Công cụ preview có lật gương cũng không được đổi ý nghĩa
landmark trái/phải.

Hai nhãn `shoulder_tilt_left` và `shoulder_tilt_right` loại trừ lẫn nhau.

## 3. Trạng thái tư thế dẫn xuất

Không lưu `good_posture` trong `posture_labels`.

- `posture_state = good`: `visibility_state = visible` và `posture_labels` rỗng.
- `posture_state = bad`: `visibility_state = visible` và có ít nhất một nhãn.
- `posture_state = unknown`: `visibility_state` khác `visible`.

`posture_state` có thể được tính lại từ hai trường còn lại và chỉ được lưu để
kiểm tra tính nhất quán.

## 4. Khoảng cách

`actual_distance_cm` là nhãn hồi quy, không phải nhãn gần/xa:

- Đo đường thẳng từ tâm ống kính webcam tới điểm giữa hai mắt.
- Người tham gia nhìn về phía camera và giữ điểm giữa hai mắt gần trục camera.
- Chỉ nhập khi đã đo bằng thước; không ước lượng bằng quan sát.
- Dùng `null` nếu frame không thuộc phiên hiệu chỉnh khoảng cách.
- Giá trị hợp lệ cho bộ thu hiện tại là 20–200 cm.
- Ghi với độ chính xác 0,1 cm và khai báo `distance_uncertainty_cm`.
- `distance_measurement_method` chỉ nhận `tape_measure` hoặc `laser_measure`.
- `distance_measurement_status` nhận `measured`, `not_measured` hoặc `invalid`.

Ngưỡng cảnh báo như 35 cm thuộc policy của Agent, không được ghi thành nhãn
`near` hoặc `far` trong dataset.

Các khoảng cách mục tiêu khi hiệu chỉnh là 25, 30, 35, 40, 50, 60 và 80 cm.
Một profile tối thiểu cần sáu mẫu hợp lệ tại ít nhất ba khoảng cách khác nhau.
Chuẩn đầy đủ nằm trong `schema/distance_standard.json`.

## 5. Quy trình gán nhãn

1. Xác định `visibility_state`.
2. Nếu không phải `visible`, để danh sách nhãn rỗng.
3. Nếu thấy đủ cơ thể, chọn từng lỗi quan sát được.
4. Công cụ phải tự thêm hoặc xóa `slouching` theo hai nhãn thành phần.
5. Công cụ tự tính `posture_state`.
6. Người gán nhãn đánh dấu `transition` cho đoạn chuyển động giữa hai tư thế.

Frame `transition=true` được giữ lại nhưng mặc định không dùng làm mẫu huấn
luyện nhãn tư thế tĩnh.

## 6. Định dạng file pilot

Mỗi phiên `capture_landmarks.py` tạo:

- `session-*.landmarks.jsonl`: mỗi dòng là một JSON object độc lập, phải hợp lệ
  theo `schema/landmark_record.schema.json`.
- `session-*.manifest.json`: metadata phiên, số record, phân bố nhãn sơ bộ và
  SHA-256 của file JSONL.

Manifest phải có `image_storage = "disabled"`. Dataset mặc định không chứa ảnh
hoặc pose world landmark; `pose_landmarks` lưu tọa độ chuẩn hóa mà công cụ đã
nhận từ MediaPipe.

## 7. Dataset phân loại ứng dụng và website

Taxonomy chuẩn nằm tại `schema/content_classification_taxonomy.json`:

- ứng dụng: `learning`, `entertainment`, `browsers`, `unknown`;
- website: `education`, `entertainment`, `social`, `unsafe`, `unknown`;
- ngưỡng chấp nhận model tự huấn luyện: `confidence >= 0.70`.

CSV ứng dụng phải có đúng header:

```csv
app_name,display_name,label
```

CSV website phải có đúng header:

```csv
domain,title,label
```

Chỉ lưu domain, không đưa scheme, path, query string, token hoặc thông tin tài
khoản vào dataset. Tên ứng dụng phải là tên file, không phải đường dẫn cài đặt.
Dữ liệu CSV thật trong `datasets/content/` được `.gitignore`; hai file
`*.example.csv` chỉ là mẫu contract, không phải dữ liệu train production.

Kiểm tra cả hai dataset:

```powershell
.\.venv\Scripts\python.exe .\content_classification\validate_dataset.py `
  --apps .\datasets\content\apps.csv `
  --websites .\datasets\content\websites.csv `
  --minimum-samples-per-label 1 `
  --report .\datasets\content\reports\validation.json
```

Tool trả exit code `0` khi đạt, `1` khi dataset có lỗi và `2` khi schema/file
không thể đọc. Các lỗi được kiểm tra gồm header sai, nhãn ngoài taxonomy, dữ
liệu quá độ dài, control character, app path, domain/URL không hợp lệ, key trùng,
xung đột nhãn, thiếu lớp và mất cân bằng lớp từ `5:1` trở lên.

### 7.1. Thu thập dữ liệu ngoài

Nguồn và giấy phép được khai báo tại
`content_classification/external_sources.json`. Pipeline mặc định dùng:

- Wikidata (CC0) để lấy domain có loại thực thể rõ ràng cho `education`,
  `entertainment`, `social` và nhóm âm `unknown` gồm trang tin tức, chợ trực
  tuyến và cổng thông tin tổng hợp;
- PhishDestroy active-domain feed (CC0) cho `unsafe`;
- `reviewed_app_catalog.json` cho tên process Windows phổ biến đã đối chiếu thủ công;
- `reviewed_vietnamese_app_catalog.json` cho process của ứng dụng Việt Nam, bao gồm
  bộ gõ, liên lạc, khai thuế, kế toán và giải trí;
- `reviewed_vietnamese_website_catalog.json` cho các website Việt Nam đã đối chiếu
  thủ công theo mục đích chính và có URL bằng chứng cho từng bản ghi.

Catalog Việt Nam hiện có 15 process ứng dụng và 120 website; phần website được
cân bằng 30 mẫu cho mỗi nhóm `education`, `entertainment`, `social`, `unknown`.

Catalog ứng dụng phiên bản `2.0.0` có 200 process, tương ứng 50 mẫu cho mỗi nhãn
`learning`, `entertainment`, `browsers` và `unknown`. Khi thêm bản ghi phải khai
báo đủ `app_name`, `display_name`, `label`, `evidence_url` HTTPS và
`label_basis`; collector sẽ từ chối toàn bộ catalog nếu thiếu căn cứ nguồn.

Chạy từ thư mục gốc dự án:

```powershell
& .\ai-training\.venv\Scripts\python.exe `
  .\ai-training\content_classification\collect_external_dataset.py `
  --max-per-source 300
```

Kết quả được ghi vào `ai-training/datasets/content/`:

- `apps.csv`, `websites.csv`: dữ liệu sạch đã qua validator;
- `review_queue.csv`: identifier lỗi, nhãn xung đột hoặc bản ghi cần duyệt;
- `record_provenance.jsonl`: nguồn, giấy phép và phương pháp gán nhãn của từng
  bản ghi;
- `reports/collection.json`, `reports/validation.json`: checksum, số lượng và
  trạng thái của lần chạy;
- `raw-cache/`: phản hồi gốc để có thể chạy lại bằng tùy chọn `--offline`.

Pipeline chỉ gán nhãn bằng ánh xạ lớp đã khai báo hoặc catalog đã duyệt. Không
dùng Gemini và cũng không dùng chính model đang train để sinh nhãn train. Domain
trùng nhưng có nhãn khác nhau bị đưa toàn bộ vào `review_queue.csv`, không tự
chọn một nhãn. Không đưa URL đầy đủ, query string, credential hoặc địa chỉ IP
vào CSV train.

Sau khi người duyệt sửa catalog/cấu hình nguồn, chạy lại collector thay vì sửa
trực tiếp file CSV sinh ra. Dùng cache khi không có mạng:

```powershell
& .\ai-training\.venv\Scripts\python.exe `
  .\ai-training\content_classification\collect_external_dataset.py `
  --offline
```

#### Dataset metadata ứng dụng bên ngoài

Nhánh metadata ứng dụng dùng một dataset riêng, không thu lại lịch sử từ Agent.
Nguồn/lớp Wikidata và giấy phép CC0 được khai báo trong
`content_classification/external_app_metadata_sources.json`. Chạy:

```powershell
& .\ai-training\.venv\Scripts\python.exe `
  .\ai-training\content_classification\collect_external_app_metadata.py
```

Collector tạo các file sau trong `ai-training/datasets/content/`:

- `app_metadata.csv` với contract `product_name,label`;
- `app_metadata_provenance.jsonl` để truy vết Wikidata item, nguồn và giấy phép;
- `reports/app_metadata_collection.json` và raw cache để audit/chạy offline.

Dataset này chỉ huấn luyện nhánh `display_name` đại diện cho
`ProductName/FileDescription`. Trainer loại mọi product family trùng với
validation/test trước khi fit và ghi số lượng loại vào evaluation report. Nó
không được dùng để tạo `app_exact_lookup_v1.json`; lookup vẫn chỉ lấy từ catalog
process đã duyệt. Xung đột nhãn bị cách ly, không tự chọn nhãn.

Agent không gửi lịch sử sử dụng để xây dựng hoặc cập nhật dataset. Khi phụ huynh
bật phân loại, Agent chỉ gửi `app_name`, `ProductName` và `FileDescription` cần
cho request inference hiện tại. Khi tắt phân loại, không gọi model/Gemini.

### 7.2. Train và đánh giá hai model

Hai model độc lập dùng Multinomial Naive Bayes trên character n-gram:

- app model là ensemble hai nhánh: `app_name` và metadata không nhạy cảm lấy từ
  executable (`ProductName` hoặc `FileDescription`); tuyệt đối không dùng window
  title, tên tài liệu hay URL đang mở;
- web model chỉ nhận `domain`;
- `display_name` trong catalog và `product_name` trong dataset ngoài được dùng
  để train nhánh metadata ứng dụng;
  `title` website không được dùng làm feature.

Cấu hình feature, hyperparameter search và deployment gate nằm trong
`content_classification/content_model_training_config.json`. Chạy:

```powershell
& .\ai-training\.venv\Scripts\python.exe `
  .\ai-training\training\train_content_models.py
```

Pipeline thực hiện các bước sau:

1. chạy lại validator cho hai CSV catalog/domain và kiểm tra contract
   `app_metadata.csv`;
2. chia `60%/20%/20%` thành train/validation/test bằng seed cố định;
3. gom các subdomain cùng họ vào đúng một split; loại metadata ngoài trùng với
   product family ở validation/test trước khi fit;
4. chọn n-gram/alpha và hiệu chỉnh temperature chỉ trên validation;
5. web model được refit trên `train + validation`; app ensemble giữ train-only
   và dùng validation để calibration vì refit làm mất hiệu lực operating
   temperature; tuyệt đối không đưa test vào bước fit;
6. mở test sau khi đã chọn cấu hình, tính accuracy, macro-F1, confusion matrix,
   calibration, coverage và accuracy tại `confidence >= 0.70`;
7. đặt `deployment_approved` theo toàn bộ gate, không tự hạ gate để model đạt.

Kết quả nằm tại `ai-training/artifacts/content_classification/`:

- `app_content_model_v1.json`;
- `app_exact_lookup_v1.json`;
- `web_content_model_v1.json`;
- `web_exact_lookup_v1.json`;
- `evaluation_report.json`.

Các artifact được `.gitignore`. Không chép model vào Agent khi
`deployment_approved = false`; lúc đó tiếp tục thu thập/gán nhãn dữ liệu và
train lại. Model confidence dưới `0.70` luôn dành cho nhánh Gemini fallback ở
giai đoạn tích hợp inference.

Đối với ứng dụng, thứ tự Hybrid Pipeline là:

1. tên process có trong exact lookup: dùng nhãn catalog với `confidence = 1.0`;
2. không có exact-match: chỉ dùng model nếu artifact đã đạt deployment gate và
   confidence từ `0.70`;
3. model chưa đạt gate hoặc confidence thấp hơn `0.70`: bắt buộc gọi Gemini.

Website dùng cùng thứ tự: domain đã duyệt trong exact lookup, model đã đạt gate
ở confidence từ `0.70`, rồi mới đến Gemini. Nhờ vậy website Việt Nam đã duyệt
không phụ thuộc việc domain đó rơi vào train hay held-out test.

Exact lookup được kiểm tra toàn vẹn trên catalog đã duyệt, không được báo cáo như
độ chính xác tổng quát hóa trên held-out test. Dữ liệu Agent gửi trong request
inference không được nhập ngược vào dataset train.
