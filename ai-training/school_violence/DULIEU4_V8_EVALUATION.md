# Kiểm tra v8 trên Dulieu4

Ngày 2026-10-05. Đã đánh giá đủ 90 câu với đúng artifact v8 đã khóa, không
huấn luyện lại, không chỉnh ngưỡng và không loại câu khỏi kết quả. Sau khi
người dùng yêu cầu sửa ID 82 từ `HIGH_RISK` thành `RISK`, model nhận đúng
70/90 câu (77,78%); macro-F1 0,77595. V8 còn hai lỗi mức cao thành `SAFE`,
nên chưa nên đưa ứng viên này vào cảnh báo thực tế. Model mặc định vẫn là v5,
v8 và báo cáo đánh giá đều giữ `deployment_eligible=false`.

## Dữ liệu và bản model

- File nguồn: `Mô tả/Dulieu4.csv`, UTF-8, ba cột `id,text,label`.
- Sau sửa: 30 `SAFE`, 31 `RISK`, 29 `HIGH_RISK`.
- SHA-256 CSV hiện tại: `e504cc10089cc135d19e59fe4d4ea3407abb7de028d68d9031899c71023f7587`.
- SHA-256 CSV ban đầu: `23180db4a5b4204b112808440d56fd00c2f1645cf0613e803d4ac1dbd1a1cb27`.
- Artifact: `vi-school-violence-word-linear-v8-query-candidate`.
- SHA-256 model: `ab55715bb011c4735349b3d340bd0aa6502286f29c08a5fc2f8a1fc35d9d9134`,
  khớp [file khóa ứng viên](query_v8_candidate.lock.json).

Người dùng đã xác nhận đây là câu thực tế được phép sử dụng, đã ẩn danh và
nhãn ban đầu được chốt trước khi xem dự đoán v8. Kiểm tra trên toàn bộ 1.854
bản ghi tham chiếu train/validation/test của artifact không thấy câu trùng
chính xác hoặc gần trùng theo ngưỡng ký tự 0,85. Trong bộ mới cũng không có
cặp gần trùng theo ngưỡng này, không thiếu nhãn và không thấy dấu hiệu định
danh rõ theo bộ lọc hiện có. Các kiểm tra không chứng minh được mọi trường
hợp gần giống về nghĩa hoặc độc lập theo trẻ/phiên tìm kiếm.

ID 82 kể việc chứng kiến người khác bị đánh. Điểm không khớp nhãn với
[hướng dẫn hiện tại](ANNOTATION_GUIDE.md) đã được nêu và hỏi người dùng **trước
khi chạy dự đoán**. Người dùng trả lời đổi thành `RISK` sau lượt chấm đầu.
Đã sửa đúng ô nhãn của ID 82, giữ nguyên nội dung và 89 nhãn khác; lưu cả bản
CSV ban đầu, kết quả ban đầu và lịch sử sửa để đối chiếu. Vì vậy báo cáo nhãn
cuối không được mô tả là hoàn toàn mù: một nhãn được xác nhận lại sau lượt
chấm đầu, theo vấn đề đã phát hiện trước khi chấm.

Kết quả trước sửa là 69/90 câu đúng, mức cao 26/30; sau sửa là 70/90 câu đúng,
mức cao 26/29. Mọi dự đoán đều giữ nguyên; thay đổi điểm số tổng hợp đến từ
nhãn chuẩn của ID 82, không đến từ thay model.

## Kết quả sau chốt nhãn

Hàng là nhãn chuẩn, cột là dự đoán của v8:

| Nhãn chuẩn / Dự đoán | SAFE | RISK | HIGH_RISK | Tổng |
| --- | ---: | ---: | ---: | ---: |
| SAFE | 24 | 4 | 2 | 30 |
| RISK | 3 | 20 | 8 | 31 |
| HIGH_RISK | 2 | 1 | 26 | 29 |
| Tổng | 29 | 25 | 36 | 90 |

| Nhãn | Nhận đúng / Tổng | Recall | Precision | F1 |
| --- | ---: | ---: | ---: | ---: |
| SAFE | 24/30 | 80,00% | 82,76% | 0,81356 |
| RISK | 20/31 | 64,52% | 80,00% | 0,71429 |
| HIGH_RISK | 26/29 | 89,66% | 72,22% | 0,80000 |

Sáu câu `SAFE` bị cảnh báo nhầm (20% số câu `SAFE`). Tám câu `RISK` bị nâng
lên `HIGH_RISK` (25,81% số câu `RISK`), khiến thông điệp quan sát bị nâng
thành thông điệp dấu hiệu bạo lực. Ba câu `RISK` và hai câu `HIGH_RISK` bị
trả `SAFE`, nghĩa là không tạo cảnh báo. Một câu mức cao bị hạ xuống `RISK`.

## Danh sách 20 câu dự đoán sai

Danh sách chỉ ghi ID và nhãn. Đối chiếu nội dung trong CSV nguồn hoặc bản
snapshot cục bộ; không đưa nguyên văn câu tìm kiếm vào báo cáo Git.

| ID | Nhãn chuẩn | v8 dự đoán |
| --- | --- | --- |
| 5 | SAFE | HIGH_RISK |
| 10 | SAFE | RISK |
| 11 | SAFE | HIGH_RISK |
| 20 | SAFE | RISK |
| 27 | SAFE | RISK |
| 30 | SAFE | RISK |
| 31 | RISK | HIGH_RISK |
| 32 | RISK | HIGH_RISK |
| 35 | RISK | HIGH_RISK |
| 39 | RISK | SAFE |
| 40 | RISK | HIGH_RISK |
| 42 | RISK | HIGH_RISK |
| 43 | RISK | HIGH_RISK |
| 44 | RISK | SAFE |
| 50 | RISK | HIGH_RISK |
| 54 | RISK | HIGH_RISK |
| 57 | RISK | SAFE |
| 66 | HIGH_RISK | SAFE |
| 83 | HIGH_RISK | SAFE |
| 90 | HIGH_RISK | RISK |

Ưu tiên xử lý lỗi bỏ sót ID 66 và 83, rồi lỗi hạ mức ID 90 và các câu
`RISK` bị trả `SAFE`. ID 82 hiện khớp `RISK` với dự đoán v8; giữ các nhãn
khác do người dùng cung cấp, không tự sửa theo dự đoán.

## Kiểm chứng và kết luận

Công cụ [`evaluate_query_csv.py`](evaluate_query_csv.py) lưu snapshot và tiền
kiểm trước khi dự đoán, kiểm tra model đúng checksum, chấm đủ câu và so kết
quả với `ThreeLabelEngine`. Nhãn/điểm của CLI và engine service khớp trên cả
90 câu. Sau xác nhận nguồn và sửa nhãn, JSONL đã qua công cụ đánh giá thật
`evaluate_real_world.py`; ma trận kết quả khớp với phép chấm CSV. ID trong
JSONL được thêm tiền tố `Dulieu4:` để phân biệt nguồn, không thêm `group_id`
hay mã người duyệt.

12 test liên quan đều đạt: 9 test công cụ holdout và 3 test CSV/checksum/trùng
dữ liệu. Không có test bỏ qua trong các bộ đã chạy ở lượt này. SHA-256 CSV
và model được kiểm tra lại sau chấm. CSV, snapshot, JSONL và JSON kết quả nằm
ngoài Git; `.gitignore` đã bổ sung đúng tên `Dulieu4.csv`.

Chưa có giới hạn số cụ thể cho cảnh báo nhầm được chốt trước lượt này, nên
không tạo một cổng duyệt tự động sau khi nhìn kết quả. Hai lỗi mức cao thành
`SAFE` là lý do cụ thể để giữ trạng thái chưa triển khai. Bộ 90 câu gần cân
bằng không đại diện tỷ lệ nhãn hoặc tần suất cảnh báo khi trẻ sử dụng thật.

Đã hoàn tất việc kiểm tra v8 trên bộ mới. Kết quả không đủ cơ sở chuyển v8
sang cảnh báo thật. Nếu tiếp tục sửa model bằng các lỗi Dulieu4, bộ này sẽ
trở thành dữ liệu phát triển của phiên bản sửa, không thể dùng lại như bộ
kiểm thử độc lập của chính phiên bản đó.

## Báo cáo cục bộ và tái lập

Kết quả theo từng ID, điểm ba nhãn, kết quả công cụ holdout và lịch sử sửa:
`ai-training/artifacts/school_violence/dulieu4_v8_evaluation_20261005_e504cc10/evaluation_report.json`.
Bản snapshot CSV và `holdout.jsonl` nằm trong cùng thư mục. Bản ban đầu được
giữ tại thư mục `dulieu4_v8_evaluation_20261005_23180db4`.

Chạy từ `ai-training`, chọn output mới hoặc rỗng, với các xác nhận dữ liệu
đã có trong cuộc trao đổi:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.evaluate_query_csv `
  --csv '..\Mô tả\Dulieu4.csv' `
  --output-dir .\artifacts\school_violence\dulieu4_v8_evaluation_recheck `
  --origin real_world --metadata-confirmed
```

Lịch sử xác nhận ID 82 được lưu riêng trong `annotation_history.json`; lần
chạy lại CLI chỉ chấm nhãn hiện tại, không tự tạo lại lịch sử cuộc trao đổi.
