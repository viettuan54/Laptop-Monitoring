# Hoàn thiện ứng viên v8 và kiểm tra luồng cảnh báo

Ngày 2026-10-04. Đã hoàn tất bước 1–4 của kế hoạch: rà lỗi, thử điều chỉnh có
giới hạn, chốt ứng viên để đo hiệu năng, và thử Agent tới API phụ huynh.
Giữ nguyên v8 vì đợt điều chỉnh không đạt tiêu chí bảo toàn nhận diện mức cao.
Service mặc định vẫn là v5; cả hai artifact vẫn `deployment_eligible=false`.
Bước 5 còn lại là kiểm thử độc lập với ứng viên đã khóa.

**Cập nhật 2026-10-05:** đã [kiểm tra bộ Dulieu4](DULIEU4_V8_EVALUATION.md)
gồm 90 câu mới. Sau người dùng sửa nhãn ID 82, v8 đúng 70/90; có hai câu
mức cao trả `SAFE` và một câu mức cao trả `RISK`. Đã hoàn tất lượt đánh giá
bộ mới, nhưng chưa đủ cơ sở triển khai v8. Các trạng thái cần holdout bên
dưới là ghi nhận tại mốc 2026-10-04.

## Rà lỗi và kết thúc đợt điều chỉnh

192 câu phát triển và nhãn người dùng đã xác nhận được giữ nguyên. Trong cả
năm cách chia, v8 có 3 câu `HIGH_RISK` luôn bị hạ xuống `RISK`:
`DuLieuThat2:16`, `:64`, `:67`; có 10 câu `SAFE` và 21 câu `RISK` luôn dự đoán sai.
Các nhóm lỗi và bối cảnh đã được ghi trong
[báo cáo lỗi v8](V8_ERROR_STABILITY_AND_VARIANTS.md); báo cáo mới thống kê bằng
ID, không chép câu tìm kiếm vào Git và không đổi nhãn theo dự đoán.

[`tune_v8_decisions.py`](tune_v8_decisions.py) thử ba cặp trọng số
`(SAFE,HIGH_RISK)=(1.5,3),(2,3),(2,4)` cùng chín cặp hệ số quyết định:
`SAFE=1,1.15,1.3`, `HIGH_RISK=0.9,1,1.1`; `RISK` giữ hệ số 1.
Hệ số quyết định nhân điểm trước khi chọn nhãn; khi lưu có thể biểu diễn bằng
cộng log hệ số vào bias và chuẩn hóa lại prior cho câu không có đặc trưng đã học.
Điểm softmax của mô hình có trọng số không được xem là xác suất đã hiệu chỉnh.

Mỗi fold ngoài chỉ dùng phần huấn luyện để tạo năm fold trong, học từ vựng/IDF,
chọn trọng số và hệ số quyết định. Có 27 lựa chọn bên trong mỗi fold, một quy
trình chọn duy nhất, đánh giá trên cùng năm seed ngoài `20261002`–`20261006`.
Chọn phương án giảm tổng lỗi `SAFE` cảnh báo và `RISK` lên mức cao, đồng thời
không giảm nhận đúng mức cao, không tăng mức cao xuống `SAFE`, không tăng từng
loại cảnh báo nhầm và không giảm macro-F1 trên fold trong; nếu không có phương
án đáp ứng thì giữ cấu hình v8. Sau đánh giá ngoài, áp dụng cùng tiêu chí để
quyết định có thay v8 hay không.

| Trung bình trên 192 câu mỗi seed | v8 hiện tại | Quy trình điều chỉnh |
| --- | ---: | ---: |
| Macro-F1 | 0,7465 | 0,7403 |
| `HIGH_RISK` nhận đúng /66 | 60,0 | 59,4 |
| `HIGH_RISK` thành `SAFE` /66 | 0,0 | 0,6 |
| `SAFE` bị cảnh báo /49 | 13,6 | 11,4 |
| `RISK` thành `HIGH_RISK` /77 | 27,8 | 27,2 |

Quy trình điều chỉnh không đạt tiêu chí ngoài fold; không tạo v9. Đợt tìm cấu
hình này kết thúc. Số liệu là trung bình trên cùng bộ câu, không phải 960 câu
độc lập. Tách chọn ngưỡng bằng fold trong không biến dữ liệu đã xem và đã dùng
trong các thử nghiệm trước thành bộ kiểm thử độc lập.

Báo cáo cục bộ:
`ai-training/artifacts/school_violence/v8_nested_adjustment_20261004/evaluation_report.json`.
SHA-256: `9933cb79af071401ccb9030fbda6df7971686c2596dca5301c57c16ad229f390`.
Nhãn, ID từng fold và lựa chọn bên trong được lưu để kiểm tra việc tách dữ liệu.

## Hiệu năng và API của artifact đã khóa

Ứng viên: `vi-school-violence-word-linear-v8-query-candidate`.
SHA-256 `model.json.gz`:
`ab55715bb011c4735349b3d340bd0aa6502286f29c08a5fc2f8a1fc35d9d9134`.
[File khóa ứng viên](query_v8_candidate.lock.json) ghi checksum model, hai báo
cáo và cấu hình. Không tiếp tục chỉnh trọng số hoặc ngưỡng của ứng viên này
trong vòng hiện tại trước khi kiểm thử độc lập.

Đo trên Windows, Python 3.11, CPU có 12 luồng logic, dùng 192 câu hiện có dài
21–104 ký tự. Lượt hoàn chỉnh cuối `v3` có bộ test AI chạy đồng thời trên máy;
đây là phép đo cục bộ tham khảo, chưa phải kiểm tra tải nhiều người dùng.

| Phép đo | Kết quả |
| --- | ---: |
| Nạp artifact, không tính khởi động Python/import | 2,21 ms |
| Suy luận trực tiếp, trung bình 1.536 lần | 0,079 ms/câu |
| Suy luận trực tiếp, P95 | 0,140 ms/câu |
| API HTTP loopback, trung bình 192 yêu cầu đơn | 8,22 ms/yêu cầu |
| API HTTP loopback, P95 yêu cầu đơn | 26,32 ms/yêu cầu |
| Khởi động tới khi API sẵn sàng | 1,07 giây |
| RAM RSS tiến trình suy luận riêng | 21,64 MiB |
| RAM RSS tiến trình API thật | 51,84 MiB |

RAM API đo bằng PID Python phục vụ thật, không dùng PID launcher của virtualenv
Windows. Kết quả của API và suy luận trực tiếp khớp cả nhãn lẫn điểm trên 192
câu, cũng khớp khi gửi batch tối đa 20. Kiểm tra 401, 422 không phản chiếu câu
nhạy cảm và kiểm tra từ chối artifact chưa duyệt trong production đều đạt.
Đã sửa `/health` để trả đúng thuật toán của artifact đang nạp; trước đó trường
`engine` luôn ghi Naive Bayes dù có thể đang dùng mô hình tuyến tính.

## Agent và cảnh báo phụ huynh

[`verify_query_candidate.py`](verify_query_candidate.py) khởi động API model
thật trên loopback rồi chạy
[`queryCandidate.acceptance.js`](../../child-monitor-backend/test/queryCandidate.acceptance.js).
Phép thử dùng mã `APIClient`, `OfflineQueue` của Agent thật, DPAPI Windows,
HTTP Express thật, PostgreSQL riêng `child_monitor_test` và RLS thật.
Ba câu mẫu lấy từ dữ liệu phát triển chỉ dùng kiểm tra luồng, không được tính
là đánh giá độ chính xác độc lập.

11 kiểm tra luồng đều đạt:

- Hàng đợi Agent mã hóa câu bằng DPAPI.
- Khóa API model sai: backend trả lỗi, Agent giữ hàng đợi, không lưu kết quả/cảnh báo.
- Mất kết nối với API model: giữ hàng đợi và gửi lại được khi kết nối phục hồi.
- `SAFE` không tạo cảnh báo; `RISK` và `HIGH_RISK` tạo đúng hai loại cảnh báo.
- Backend xác nhận nhận câu thì Agent xóa nội dung thô khỏi hàng đợi.
- Gửi lại cùng mã bản ghi không tạo sự kiện trùng.
- Gửi câu mới trong khoảng chờ không tạo cảnh báo trùng ở từng mức.
- API phụ huynh trả đúng thông điệp; phụ huynh khác không thấy cảnh báo nhờ RLS.
- Secret Agent sai: 401, giữ hàng đợi và ngừng gửi.
- Phụ huynh tắt chức năng: bỏ câu đang chờ mà không tạo sự kiện mới.
- Backend từ chối nội dung trang và chat, giữ phạm vi câu tìm kiếm.

| Nhãn | Tiêu đề thông báo được ghi nhận |
| --- | --- |
| `SAFE` | Không tạo thông báo |
| `RISK` | Cần quan sát bé trong thời gian này |
| `HIGH_RISK` | Bé có dấu hiệu bị bạo lực |

Thông báo đẩy được ghi nhận cục bộ, không gửi tới tài khoản bên ngoài. Do Redis
kiểm thử ở cổng 6380 chưa chạy, lần thử dùng MemoryStore của chế độ test cho
giới hạn tần suất. Không kiểm tra Redis phân tán hay trình duyệt hiển thị trang
phụ huynh trong lần này; đã kiểm tra HTTP API phụ huynh và bộ smoke test web.
Người dùng/tài khoản/thiết bị giả trong database kiểm thử được xóa sau khi chạy.

Báo cáo cục bộ hoàn chỉnh:
`ai-training/artifacts/school_violence/v8_runtime_acceptance_20261004_v3/verification_report.json`.
SHA-256: `1dabb52683a6ab84ac752976a46ff9b3732c77f6b98d122c2372a0ef3182cb85`.
Lượt đầu chưa hoàn thành do bộ kiểm tra hiểu sai giá trị `None` khi HTTP client
hết lần thử sau lỗi 5xx. Lượt `v2` đạt 10 kiểm tra; `v3` bổ sung mất kết nối và
đạt đủ 11. Các lượt trước giữ cục bộ để truy vết; dùng `v3` làm kết quả hiện tại.

## Kiểm tra hồi quy

207 test đạt, không bỏ qua:

- AI/service: 137 test, gồm 5 test tách dữ liệu/chọn quyết định và 4 test API.
- Agent: 25 test hàng đợi, 6 test riêng tư và 2 test HTTP client.
- Backend: 20 test moderation, đồng ý sử dụng và riêng tư.
- Web: 17 smoke test.

Ngoài số test trên, 11 kiểm tra luồng thật đã đạt. Bộ tùy chọn Torch từ thử nghiệm
MiniLM trước không cần chạy lại vì đợt này không thay mã encoder/tinh chỉnh.

## Bước còn lại trước triển khai

Chưa có bộ câu độc lập mới trong workspace. `DuLieuThat1/2/3` đã tham gia phát
triển; công cụ đã xác nhận không cho dùng lại chúng làm holdout của v8.
V8 và ngưỡng hiện tại đã khóa, nên việc tiếp theo là đánh giá trên bộ câu chưa
dùng huấn luyện/chọn cấu hình, có cả ba nhãn được chốt trước khi xem dự đoán.
Dùng công cụ sẵn có `evaluate_real_world.py`; không đổi nhãn theo kết quả,
không dùng lượt đánh giá cuối để chọn thêm ngưỡng. Công cụ trả ma trận nhầm
nhãn và ID bỏ sót, vẫn giữ `deployment_eligible=false` để kết quả được rà soát
trước khi quyết định triển khai. Không yêu cầu `group_id` hay mã người duyệt.

Định dạng holdout JSONL có hướng dẫn tại [README](README.md); các trường được
kiểm tra trực tiếp trong [`evaluate_real_world.py`](evaluate_real_world.py).
Nhãn cần được gán trước, dữ liệu phải được phép sử dụng và đã ẩn danh.
Các khai báo này không thể được
công cụ tự xác thực hoàn toàn.

Chạy từ `ai-training`, sau khi bộ holdout đã qua rà soát và checksum model
khớp file khóa:

```powershell
.\.venv\Scripts\python.exe -B -m school_violence.evaluate_real_world `
  --holdout .\artifacts\school_violence\query_final_holdout.jsonl `
  --artifact-dir .\artifacts\school_violence\vi-school-violence-word-linear-v8-query-candidate `
  --output .\artifacts\school_violence\v8_final_holdout_evaluation.json
```

## Tái lập bước 1–4

Yêu cầu Windows để chạy DPAPI, Node.js và database kiểm thử đã cấu hình trong
`child-monitor-backend/.env.test`. Cài thư viện bằng
`python -m pip install -r school_violence/query_acceptance_requirements.txt`.
Chạy từ `ai-training`, chọn thư mục output mới hoặc rỗng:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
.\.venv\Scripts\python.exe -B -m school_violence.tune_v8_decisions `
  --base-artifact .\artifacts\school_violence\vi-school-violence-char-nb-v5-query `
  --v8-artifact .\artifacts\school_violence\vi-school-violence-word-linear-v8-query-candidate `
  --review2 '..\Mô tả\DuLieuThat2_review.csv' `
  --review3 '..\Mô tả\DuLieuThat3_review.csv' `
  --legacy-review '..\Mô tả\DuLieuThat1_review.csv' `
  --provenance '..\Mô tả\DuLieuThat1_label_provenance.csv' `
  --output-dir .\artifacts\school_violence\v8_nested_adjustment_recheck --authorized

.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v8_nested_adjustment_recheck\evaluation_report.json `
  --output-dir .\artifacts\school_violence\v8_runtime_acceptance_recheck
```

Hai công cụ không ghi đè artifact/báo cáo đã có và không sửa dữ liệu gốc.
