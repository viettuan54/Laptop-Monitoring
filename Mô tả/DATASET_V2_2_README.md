# Bộ dữ liệu phân loại văn bản v2.2

Hai file CSV UTF-8 có BOM dùng một nhãn cho mỗi mẫu: `SAFE`, `RISK`, `HIGH_RISK`.
Bản `v2_1_6000.csv` được giữ nguyên. Chưa huấn luyện hoặc thay thế model đang chạy.

| File | Số mẫu | SAFE | RISK | HIGH_RISK |
| --- | ---: | ---: | ---: | ---: |
| `laptopmonitoring_query_dataset_v2_2.csv` | 6000 | 1789 | 2211 | 2000 |
| `laptopmonitoring_webpage_dataset_v2_2.csv` | 5986 | 2000 | 1986 | 2000 |

## Quy tắc và thay đổi

- Theo `ai-training/school_violence/ANNOTATION_GUIDE.md`, phủ định bị đánh,
  đe dọa hoặc bắt nạt vẫn là thảo luận chủ đề bạo lực: `RISK`, không phải
  `HIGH_RISK`. Đã sửa 211 mẫu query từ `SAFE` sang `RISK`.
- Tai nạn vô ý, ngã không bị ai xô hoặc va chạm có lời xin lỗi vẫn có thể là
  `SAFE` theo toàn bộ ngữ cảnh; không gán nhãn chỉ vì xuất hiện một từ khóa.
- Sửa 91 trường hợp `hok sinh` thành `hoc sinh`; không thay toàn bộ từ `hok`.
- Sửa lỗi ghép mẫu và cụm từ lặp liền nhau trong 677 query. Sửa riêng mẫu
  `Q_003401`: xô đẩy vật lý không thể xảy ra trên mạng.
- 100 query ngắn chưa rõ ý định giữ nhãn tạm thời và được ghi
  `annotation_status=needs_human_context_review`. Không tự suy người tìm kiếm
  đang bị bạo lực khi văn bản chưa thể hiện đủ thông tin.
- 630 mẫu trang có biến thể tổng hợp diễn đạt gián tiếp thay vì trích nguyên
  văn lời đe dọa, không đổi nhãn. Thống kê này tính trước khi loại trùng.
  14 mẫu trùng đúng văn bản sau biến đổi đã bị loại; ID của mẫu được giữ lại
  có trong `dataset_v2_2_corrections.json`. Đây không phải 630 trang thực tế mới.
- Không ép đủ 2000 mẫu/nhãn hoặc chèn số/câu đệm chỉ để giữ đủ 6000 mẫu.

## Nhóm và chia tập

Gom thành phần liên thông theo nhóm diễn đạt tương đương có sẵn, văn bản
chuẩn hóa runtime, bản chuẩn đối chiếu query và nội dung trang trùng (cả trước
và sau sửa). `page_id` cũng được giữ cùng tập. Nhóm có nhiều nhãn vẫn phải
nằm trong một tập. Nhóm không chứng minh là ID người dùng/hội thoại thực tế.

Chia train/validation/test xấp xỉ 70/15/15 theo nhóm và phân bố nhãn, seed
`school-violence-dataset-v2.2`. Không tách câu trong cùng nhóm để đạt số lượng
chính xác. Kiểm tra không phát hiện khóa nhóm, câu nguyên văn, câu chuẩn hóa
runtime, query chuẩn đối chiếu hoặc thân trang trùng đi qua nhiều tập.
Kiểm tra này không bảo đảm phát hiện mọi dạng gần trùng ngữ nghĩa chưa biết.

| Dataset | Train | Validation | Test |
| --- | ---: | ---: | ---: |
| Query | 4200 | 901 | 899 |
| Webpage | 4190 | 898 | 898 |

**Trainer v3 `school_violence.training` đã giữ `group_id` và `split` trong CSV.**
Nó nhận nhiều CSV, kiểm tra rò rỉ trên bộ kết hợp và lưu manifest/cấu hình
phiên bản. Trainer v2 cũ bỏ qua nhóm và chia lại tập; không dùng cách chia
đó để đánh giá hai file này. Ghi chú trong CSV và báo cáo sửa dữ liệu được
giữ nguyên như provenance lịch sử của bước chuẩn bị dữ liệu. Xem lệnh
`--validate-only` trong `ai-training/school_violence/README.md`. Chưa train
artifact v3 hoặc thay model v2 đang chạy khi sửa trainer.

## Ý nghĩa cột và kiểm duyệt

- `text`: đầu vào model; query giữ biến thể có/không dấu, teencode, emoji,
  lỗi gõ và viết cách ký tự. Webpage dùng `title + '\n' + content`.
- `text_raw`: query đã sửa dùng để train, bằng `text`; văn bản trước sửa nằm
  ở `original_text`, không dùng như một mẫu train bổ sung.
- `text_normalized`: bản chuẩn lý tưởng để đối chiếu query, KHÔNG phải đầu
  vào train. Không tự khôi phục dấu hoặc sửa lỗi gõ tại runtime bằng cột này.
- `text_runtime_normalized`: đầu ra thực tế của bộ chuẩn hóa hiện tại.
- `original_label`, `original_group_id`, `original_split`, `original_text`
  và `correction_reason`: truy vết thay đổi; không đưa vào đặc trưng model.
- `contains_quote`, `quote_type`, `query_type`, `context_type`, ID, split và
  thông tin nguồn cũng chỉ là metadata, không phải đặc trưng phân loại.
- `review_status=unreviewed`, `evaluation_status=provisional_unreviewed` và
  `source=synthetic` được giữ đúng sự thật. Việc sửa tự động theo policy không
  tương đương kiểm duyệt nhãn bởi con người; không yêu cầu hai người đánh giá.

## Giới hạn

Dữ liệu vẫn tổng hợp và lặp khuôn; trang dài, nội dung đa chủ đề và tình huống
thực tế chưa được bao phủ đủ. Cần kiểm duyệt nhãn và tập test độc lập thực tế
đã ẩn danh, có quyền sử dụng. Không dùng metric trên bộ này để tuyên bố sẵn
sàng cảnh báo cho trẻ hoặc suy nhãn thành xác nhận trẻ là nạn nhân.

`dataset_v2_2_corrections.json` lưu SHA-256 nguồn/đầu ra, từng ID đã sửa,
nhãn trước/sau, lý do, ID loại trùng và thống kê kiểm tra. Script tái lập là
`ai-training/school_violence/prepare_datasets_v2_2.py`; script từ chối ghi đè
đầu ra đã tồn tại. Chạy trên bản sao thư mục chỉ chứa hai CSV nguồn:

```powershell
cd C:\DoAn\Laptopmonitoring\ai-training
.\.venv\Scripts\python.exe -B -m school_violence.prepare_datasets_v2_2 --directory '<thư mục bản sao nguồn>'
```
