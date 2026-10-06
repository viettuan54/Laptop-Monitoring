# V13: hoàn tất sửa biểu diễn, so sánh và thử Agent cục bộ

Ngày 2026-10-06. Đã thực hiện lần lượt phân tích 15 lỗi, thử đúng một cấu
hình v13, so sánh với v12.1 và kiểm tra luồng Agent cục bộ. **V13 đạt cổng
chọn ứng viên phát triển** và được khóa. Dulieu5 đúng **85/90 (94,44%)**,
so với v12.1 **75/90 (83,33%)**, giữ HIGH_RISK đúng **26/26**.

**94,44% là điểm trên bộ đã xem để thiết kế bản sửa**, không phải độ chính
xác kiểm thử độc lập hoặc sử dụng thực tế. Kiểm tra chéo trên 282 câu cũ
đạt accuracy trung bình **84,82%**, macro-F1 **0,85258**. Chưa bật cảnh báo
cho phụ huynh thật; model mặc định vẫn v5 và `deployment_eligible=false`.

## Bước 1–2: nguyên nhân và bản sửa

[Kế hoạch](V13_EXPERIMENT_PLAN.md) ghi trước huấn luyện/dự đoán v13. Đã
đối chiếu đóng góp logit của mọi lỗi v12.1 trên Dulieu5:

- “Chuẩn bị” và “bí mật” tạo sai tín hiệu bị tác động; “dõi tiến” bị nhận
  thành “đòi tiền” khi bỏ dấu. V13 kiểm tra dấu hiện có và ngữ cảnh cụm từ.
- Cửa sổ ngắn và thiếu danh từ chỉ người làm mất vai trò người khác.
  V13 gắn người với hành vi trong cùng mệnh đề, giữ tín hiệu trực tiếp
  khi câu có cả trẻ chứng kiến và chính trẻ bị tác động.
- Người nhận yêu cầu trước đây tạo chung tín hiệu với người bị gây hại.
  V13 tách hai loại vai trò và bổ sung cách diễn đạt áp lực/ranh giới.
- Giữ biểu diễn cưỡng ép tiền/tài sản của v12.1; không tra ID, nguyên câu
  hoặc gán nhãn bằng luật. Kết quả vẫn là argmax từ trọng số được học.

Runtime v13 có thuật toán `recipient_context_word_softmax_v1`; các runtime
v12.1 và cũ giữ nguyên. Test đối chứng chỉ kiểm tra đặc trưng/luồng, không
được thêm vào tập huấn luyện hoặc dùng làm điểm chất lượng.

Huấn luyện vẫn trên **282 câu đã được phép dùng** của Dulieu1–4: SAFE 79,
RISK 108, HIGH_RISK 95. D1 chỉ dùng 12 sửa nhãn được xác nhận. Không thêm
Dulieu5 vào học từ vựng, IDF hoặc trọng số. Dulieu5 giữ 90 câu, nhãn đã chốt
và SHA `0d292e9ad186f9af9a7d8bcfa3670475989df2865f550eea57c63ff1e46e7be5`.
Khai báo nguồn Dulieu5 vẫn chưa xác nhận riêng; không tự ghi là dữ liệu thật.

Giữ min_df=1, context_scale=2, class_weights SAFE/RISK/HIGH=1,5/1/3,
L2=0,001, epochs=200, argmax. Không tìm trọng số/ngưỡng/seed sau kết quả.

## Bước 3: kiểm tra dữ liệu cũ và Dulieu5

Giữ nguyên 25 fold thuộc 5 seed đã khóa. Từ vựng/IDF/trọng số chỉ học trên
phần học của mỗi fold. Đối chứng v12.1 tái lập đúng mọi dự đoán ngoài fold,
head sau học đủ dữ liệu và dự đoán Dulieu5 đã lưu. Đây là kiểm tra phát triển
có phản hồi từ dữ liệu; 5 seed lặp cùng câu, không phải 5 tập độc lập.

| Trung bình mỗi lượt ngoài fold trên 282 câu | V12.1 | V13 |
| --- | ---: | ---: |
| Accuracy | 83,48% | 84,82% |
| Macro-F1 | 0,83938 | 0,85258 |
| HIGH_RISK đúng /95 | 94,2 | 94,2 |
| HIGH_RISK → SAFE /95 | 0 | 0 |
| SAFE bị cảnh báo /79 | 10,2 | 8,8 |
| RISK → HIGH_RISK /108 | 32,0 | 29,6 |
| RISK → SAFE /108 | 3,6 | 3,6 |

| Seed | V12.1 macro-F1 | V13 macro-F1 | HIGH đúng, cả hai | V12.1/V13 SAFE cảnh báo | V12.1/V13 RISK→HIGH | V12.1/V13 RISK→SAFE |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 20261002 | 0,83093 | 0,84479 | 94 | 11/9 | 33/31 | 4/4 |
| 20261003 | 0,84156 | 0,85886 | 95 | 10/9 | 33/29 | 3/3 |
| 20261004 | 0,85668 | 0,86690 | 94 | 7/6 | 31/29 | 3/3 |
| 20261005 | 0,83837 | 0,84815 | 94 | 10/9 | 33/30 | 3/4 |
| 20261006 | 0,82935 | 0,84420 | 94 | 13/11 | 30/29 | 5/4 |

Riêng Dulieu4 ngoài fold: macro-F1 **0,88754 → 0,92251**;
HIGH đúng giữ **29/29**; SAFE cảnh báo **4,4 → 2,8/30**;
RISK→HIGH **5,4 → 3,8/31**; RISK→SAFE giữ **0,4/31**.

### So sánh phát triển trên Dulieu5

| Chỉ số | V12.1 | V13 |
| --- | ---: | ---: |
| Đúng /90 | 75 | 85 |
| Accuracy | 83,33% | 94,44% |
| Macro-F1 | 0,83405 | 0,94490 |
| HIGH_RISK đúng /26 | 26 | 26 |
| HIGH_RISK → SAFE /26 | 0 | 0 |
| SAFE bị cảnh báo /30 | 4 | 1 |
| RISK → HIGH_RISK /34 | 9 | 4 |
| RISK → SAFE /34 | 2 | 0 |
| Precision HIGH_RISK | 68,42% | 86,67% |

Ma trận v13, hàng là nhãn chốt và cột là dự đoán:

| Nhãn chuẩn / Dự đoán | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: |
| SAFE | 29 | 1 | 0 |
| RISK | 0 | 30 | 4 |
| HIGH_RISK | 0 | 0 | 26 |

V13 đạt cả cổng so sánh dữ liệu cũ, riêng Dulieu4 và Dulieu5 đã chốt trong
kế hoạch. Trên Dulieu5 cũng đạt 6 mốc kỹ thuật lịch sử cùng mục tiêu đề xuất
accuracy >=90%. Các mốc không phải chứng nhận an toàn hoặc phê duyệt phát
hành. Trên dữ liệu cũ, tỷ lệ RISK→HIGH vẫn khoảng 27,41%, SAFE cảnh báo
khoảng 11,14%; vì vậy không diễn giải kết quả Dulieu5 thành model đã hoàn thiện.

### Những lỗi được giữ công khai

Sửa đúng 10 lỗi Dulieu5: **12, 21, 30, 32, 34, 41, 57, 66, 74, 84**.
Không câu nào đang đúng trên Dulieu5 trở thành sai, nhưng vẫn còn:

| ID Dulieu5 | Nhãn chốt | V13 |
| --- | --- | --- |
| 3 | SAFE | RISK |
| 38 | RISK | HIGH_RISK |
| 52 | RISK | HIGH_RISK |
| 58 | RISK | HIGH_RISK |
| 77 | RISK | HIGH_RISK |

ID 58 trước trả SAFE, nay trả HIGH_RISK: **vẫn sai**, chỉ đổi loại lỗi,
không tính vào 10 lỗi đã sửa đúng. Bốn trường hợp chứng kiến từng sai:
66/74/84 đã đúng, 77 còn sai. ID 71 giữ đúng RISK và ID 43 giữ đúng HIGH_RISK.

Trên dữ liệu cũ có hồi quy riêng dù tổng thể cải thiện:

| ID | Nhãn chốt | Lỗi mới ở bao nhiêu /5 seed |
| --- | --- | --- |
| DuLieuThat2:45 | RISK | HIGH_RISK ở 3 lượt trước đúng |
| DuLieuThat2:75 | RISK | SAFE ở 1 lượt trước đúng |
| DuLieuThat2:92 | RISK | HIGH_RISK ở 1 lượt trước đúng |
| DuLieuThat3:61 | RISK | HIGH_RISK ở 2 lượt trước đúng |
| DuLieuThat3:64 | RISK | HIGH_RISK ở 3 lượt trước đúng |
| DuLieuThat3:70 | SAFE | HIGH_RISK ở 1 lượt trước đúng |
| DuLieuThat3:80 | RISK | HIGH_RISK ở 3 lượt trước đúng |

Seed 20261005 có RISK→SAFE tăng 3 lên 4; trung bình 5 lượt giữ 3,6 như
v12.1. Cổng đã đặt dùng trung bình, không cam kết mọi câu hoặc mọi seed
đều tốt hơn. Dulieu4 ID 82 được sửa đúng RISK cả 5 lượt; ID 35/57/50 vẫn
sai HIGH_RISK cả 5 lượt. Không sửa nhãn hoặc loại các câu này.

Chấm lại phần học đủ 282 câu: RISK→HIGH giảm 20 xuống 13; SAFE cảnh báo
giữ 1, RISK→SAFE giữ 1, HIGH đúng giữ 95/95. Chỉ là chẩn đoán trên phần học.
Macro-F1 hồi quy tổng hợp lịch sử validation/test=0,50945/0,52120;
không dùng các điểm lịch sử này làm bằng chứng test thực tế mới.

## Bước 4: chạy thử Agent cục bộ đã hoàn tất

**134 test đạt, không bỏ qua:** 95 AI, 20 backend, 19 web. Gồm 10 test mới
về nghĩa cụm từ/người nhận/serialization và 3 test bảo vệ cổng chọn ứng viên.
Đã kiểm tra đủ 25 phân vùng, giữ nguồn và tất cả nhãn; mã khớp snapshot lúc học.

**12 kiểm tra luồng đạt** bằng code Agent thật (APIClient, OfflineQueue,
DPAPI), API model v13, Express, PostgreSQL/RLS kiểm thử, API phụ huynh và
renderer cảnh báo. Có thử mất kết nối/sai khóa, giữ hàng đợi để gửi lại,
ACK xóa queue, chống gửi trùng/cooldown, quyền phụ huynh, tắt đồng ý và
từ chối page/chat. Tài khoản/thiết bị thử được dọn; push được thu cục bộ.

Đây là chạy chức năng với tài khoản/DB thử, **không cài hay bật v13 trên
máy trẻ**, không gửi cảnh báo tới phụ huynh thật. Không khẳng định đã kiểm
thử bố cục browser, push ngoài hệ thống hoặc Redis phân tán.

CLI/engine khớp nhãn và điểm trên cả 372 câu (282 cũ +90 Dulieu5).
HTTP API đơn/batch khớp CLI trên 282 câu; kiểm tra khóa API và dữ liệu
không hợp lệ đạt. Dùng lại phần học làm holdout và khởi động production
bằng model chưa duyệt đều bị từ chối như dự kiến.

Đo tuần tự cục bộ: suy luận trung bình **1,735 ms**, P95 **2,888 ms**;
API đơn trung bình **12,79 ms**, P95 **27,60 ms**; RAM khoảng **52,8 MiB**.
Không phải kiểm tra tải đồng thời. Phân tích ngữ cảnh mới tốn thêm thời
gian suy luận; chưa có bằng chứng về độ trễ trên mọi máy Agent.

## Khóa và cách tái lập

[Khóa v13](query_v13_candidate.lock.json) ghi artifact, báo cáo, kiểm chứng,
cấu hình và 454 câu từng xem ở Dulieu1–5. 82 câu D1 không dùng huấn luyện
chỉ có vai trò archive đối chiếu; không tự xác nhận nhãn của chúng.

SHA-256 model:
`380cf3af9bb677446548af64601f5e98be3f0a07092f2458f3500986fcc0497a`.

Artifact gốc nằm trong
`ai-training/artifacts/school_violence/v13_context_repair_20261006/`:

- `baseline_error_analysis.json`: phân tích trước sửa.
- `experiment/evaluation_report.json`: so sánh, mọi dự đoán và cổng chọn.
- `experiment/regression_audit.json`: các lỗi cải thiện/hồi quy theo seed.
- `experiment/code_snapshot/`, `experiment/plan_snapshot.md`: mã và kế hoạch lúc học.
- `runtime/verification_report.json`: luồng Agent và đo hiệu năng.
- `quality_verification.json`: kiểm tra nguồn, fold, test và khóa.

Tái lập từ `ai-training`, chọn thư mục output mới/rỗng:

```powershell
$env:OPENBLAS_NUM_THREADS='1'
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe -B -m school_violence.experiment_recipient_context_v13 `
  --source-dir '..\Mô tả' `
  --output-dir .\artifacts\school_violence\v13_recheck --authorized
.\.venv\Scripts\python.exe -B -m school_violence.verify_query_candidate `
  --selection-report .\artifacts\school_violence\v13_recheck\evaluation_report.json `
  --output-dir .\artifacts\school_violence\v13_runtime_recheck
```

Lệnh luồng yêu cầu PostgreSQL cục bộ và cấu hình `.env.test` sẵn có; không
thay bằng DB thật để chạy kiểm thử. Không cần thu thêm dữ liệu để tái lập
đợt này. Nguồn/khóa cũ và cấu hình mặc định giữ nguyên.
