# Phạm vi thu thập văn bản — phiên bản 1

Ngày chốt: 2026-09-26. Phương án: phân loại phía backend.
Phạm vi được người dùng chọn: `search_query` và `page_content`; không triển
khai chat trong phiên bản này. Chỉ dùng ba nhãn `SAFE`, `RISK`, `HIGH_RISK`.

Đây là đặc tả cho bước xây bộ thu thập và kiểm thử, không phải thông báo rằng
Agent đã đọc được nội dung trang. Chrome/Edge trên Windows được chọn làm mặc
định ban đầu vì Agent đã hỗ trợ lịch sử hai trình duyệt này. Các giới hạn mới
dưới đây phải được thực thi trước thử nghiệm với dữ liệu của người dùng.

## 1. Nguồn và giới hạn

| Nguồn | Được thu thập | Không được thu thập | Trạng thái code |
| --- | --- | --- | --- |
| `search_query` | Truy vấn trong URL kết quả tìm kiếm thuộc công cụ/path đã được hỗ trợ | Toàn bộ URL, mọi tham số URL, chuỗi nhập chưa gửi, lịch sử trước khi bật | Đã có bộ trích xuất; cần kiểm thử bật/tắt và loại dữ liệu nhạy cảm |
| `page_content` | Tiêu đề bài viết và các đoạn văn bản chính đang hiển thị trên trang công khai được cho phép | Toàn bộ HTML/DOM, biểu mẫu, chat, email, tài khoản, nội dung ẩn, trang nền | Chưa có bộ thu thập |
| Chat | Không | Tin nhắn nhận/gửi, kể cả widget chat trên trang | Ngoài phạm vi |

Tìm kiếm: giữ bộ nhận diện URL hiện có cho Google (các host đã khai báo),
Bing, Yahoo, DuckDuckGo, Cốc Cốc, YouTube và Brave Search. Đây là tên công cụ
tìm kiếm, không có nghĩa Agent hỗ trợ tất cả trình duyệt cùng tên. Không
quét hồi tố dữ liệu có trước thời điểm bật tính năng.

Trang web: thí điểm trên Chrome và Edge; chỉ tab đang hoạt động trong cửa sổ
trình duyệt đang ở foreground. Không lấy các tab nền, nội dung không hiển thị
hoặc chế độ Incognito/InPrivate. Chỉ nhận HTTP/HTTPS; bỏ `file:`, `data:`,
`chrome:`, `edge:` và các trang nội bộ khác. Không vượt paywall, không tự tải
trang bằng cookie của trẻ và không giải mã/chặn HTTPS.

Domain thu thập nội dung trang phải nằm trong allowlist cấu hình cho thử
nghiệm. Allowlist rỗng nghĩa là chưa thu thập trang nào; chọn danh sách domain
thử nghiệm ở bước tích hợp, không bật mặc định cho toàn bộ web. Trang không
nằm trong allowlist phải bị bỏ qua. Allowlist không được ghi đè các loại trừ
nhạy cảm ở mục 2.

## 2. Nội dung bắt buộc loại bỏ

- Mọi trường `input`, `textarea`, vùng `contenteditable`, password, clipboard,
  phím gõ và nội dung biểu mẫu chưa gửi.
- Chat, bình luận, tin nhắn riêng, hộp thư, dashboard tài khoản, trang quản trị,
  đăng nhập, thanh toán/ngân hàng và hồ sơ y tế hoặc tài liệu cá nhân.
- Menu điều hướng, footer, quảng cáo, gợi ý bài khác, cookie banner, script,
  style, HTML comment và phần tử ẩn. Không chụp màn hình, OCR hoặc lấy media.
- Email, số điện thoại, mã truy cập, token và tham số định danh trong URL.
  Làm sạch trước khi đưa vào hàng đợi; nếu không xác định được phần nội dung
  công khai/an toàn, bỏ qua trang thay vì lấy toàn bộ văn bản.

Các bộ lọc định danh tự động chỉ là bảo vệ bổ sung, không bảo đảm ẩn danh hoàn
toàn. Không lấy nội dung riêng tư rồi kỳ vọng bộ lọc sẽ làm sạch hết.

## 3. Bật/tắt và tính minh bạch

Giữ công tắc `enable_text_moderation` của phụ huynh; mặc định tắt. Agent phải
nhận cấu hình trước khi thu thập, không chỉ kiểm tra ở bước gửi. Bộ thu thập
trang phải kiểm tra cấu hình còn hiệu lực trước mỗi lần trích xuất.

- Tắt: không tạo bản ghi mới, không gọi model; xóa văn bản chưa gửi khi Agent
  nhận được cấu hình tắt. Backend kiểm tra lại công tắc để xử lý tình huống
  Agent chưa kịp đồng bộ và xác nhận bỏ qua cho Agent xóa hàng đợi.
- Bật: chỉ bắt đầu từ thời điểm cấu hình có hiệu lực; không thu gom lại lịch
  sử tìm kiếm hoặc nội dung trang cũ.
- Không có cấu hình hoặc quyền truy cập trình duyệt hợp lệ: không thu thập.
  Khi bật lại, không khôi phục những bản ghi đã bị xóa.
- Cần thông báo minh bạch về phạm vi thu thập và truyền văn bản lên server;
  công tắc phụ huynh không thay thế việc cấp quyền trình duyệt và các yêu cầu
  đồng ý sử dụng phù hợp. Không xây cơ chế thu thập ngầm hoặc vượt quyền.

## 4. Dữ liệu truyền và lưu

Luồng mục tiêu:

```text
Trình duyệt được cấp quyền
  → kiểm tra bật/tắt + nguồn + domain + loại trừ nhạy cảm
  → lấy truy vấn hoặc văn bản chính, làm sạch và chia đoạn
  → hàng đợi Agent có ID chống trùng
  → HTTPS đến backend → service model trong mạng riêng
  → lưu nhãn/score/metadata → xác nhận → xóa văn bản khỏi Agent
```

Backend nhận cả câu an toàn và câu nguy cơ trong phạm vi đã cho phép; Agent
không phân loại trước. Không gửi toàn bộ lịch sử, HTML hoặc mọi dữ liệu chat.

Contract hiện có dùng `client_record_id`, `source_type`, `text`, `occurred_at`,
`domain`; mỗi record tối đa 1.000 ký tự, mỗi batch tối đa 20 record. Không gửi
full URL, tên profile trình duyệt, cookie, tên tài khoản hoặc văn bản dưới
dạng metadata. Tiêu đề bài viết nếu cần là một phần của `text`, không phải
window title của ứng dụng.

Giới hạn mặc định cho bộ thu thập trang: tối đa 10.000 ký tự đã làm sạch trên
mỗi lần xử lý trang, chia thành không quá 20 đoạn tối đa 1.000 ký tự. Chia tại
ranh giới câu/đoạn; không làm mất phủ định hay tách lời trích dẫn khỏi ngữ cảnh.
Phần vượt giới hạn phải được ghi nhận bằng metadata truncation, không âm
thầm xem là toàn bộ trang. Schema page/segment ID và truncation sẽ được bổ
sung ở bước triển khai; hiện API chưa có những trường này.

Chống lặp: cùng lần truy cập và cùng nội dung đã làm sạch không tạo sự kiện
mới khi retry/refresh hoặc DOM cập nhật quảng cáo; ID giữ nguyên khi retry.
Không dùng hash nội dung như ID người dùng hoặc làm bằng chứng trẻ đã đọc
hết nội dung trang.

Không log text ở Agent, backend, reverse proxy hay hệ thống theo dõi lỗi.
Backend không lưu text trong PostgreSQL và không tái sử dụng request để train.
Hàng đợi local phải có giới hạn dung lượng và bảo vệ truy cập; xóa ngay sau
ACK hoặc khi tắt. Với bộ thu thập trang, mặc định giữ bản ghi chưa gửi tối đa
24 giờ; đây là thay đổi cần triển khai, không phải thời hạn 7 ngày hiện có của
hàng đợi truy vấn. Metadata kết quả giữ theo chính sách hiện hành 30 ngày.

## 5. Ý nghĩa nhãn và tổng hợp trang

Áp dụng [hướng dẫn gán nhãn](../../ai-training/school_violence/ANNOTATION_GUIDE.md):

- `SAFE`: không thấy tín hiệu nguy cơ trong văn bản được xử lý; không chứng
  minh toàn bộ trang hoặc tình trạng của trẻ là an toàn.
- `RISK`: hướng dẫn phòng chống/hỗ trợ, thảo luận hay tin tức chung về bạo lực.
- `HIGH_RISK`: báo cáo cá nhân đang bị bạo lực, cầu cứu liên quan hoặc đe dọa
  trực tiếp trong ngữ cảnh thật. Từ ngữ phòng tránh không phủ định một lời
  cầu cứu rõ ràng. Ví dụ đe dọa minh họa trong bài học vẫn cần ngữ cảnh.

Không dùng duy nhất `max(label)` của những đoạn mất ngữ cảnh để tự nâng cả
bài phòng chống lên `HIGH_RISK`. Bước tổng hợp trang phải giữ được đoạn gốc,
ngữ cảnh trích dẫn/mục đích bài và kiểm định riêng. Model v2 chỉ nhận một câu,
chưa xử lý ngữ cảnh trang hoặc tổng hợp nhiều đoạn; chưa được huấn luyện lại
theo các đối chứng này. Chạy thử chỉ ghi nhận, chưa gửi cảnh báo thật cho đến
khi có kiểm định và cơ chế chạy thử không cảnh báo.

## 6. Cách tích hợp và công việc kế tiếp

Lịch sử URL không chứa DOM; bộ theo dõi lịch sử hiện có không đủ để lấy nội
dung trang. Hướng tích hợp cho Chrome/Edge là extension được cấp quyền, đọc
phần văn bản công khai theo các giới hạn trên và gửi tới Agent qua kênh local
được xác thực. Không mở HTTP endpoint localhost nhận văn bản từ mọi website.
Chi tiết quyền extension, xác thực sender và kênh truyền phải được thiết kế/
kiểm thử ở bước triển khai; hiện chưa có extension trong repository.

Thứ tự công việc:

1. Thiết kế extension/kênh local và allowlist domain; xác thực đúng nguồn.
2. Xây trích xuất/làm sạch, loại trang nhạy cảm, kiểm soát tab/quyền/bật-tắt.
3. Nâng contract cho page ID/segment ID/truncation; giới hạn và chống trùng.
4. Nâng hàng đợi để hỗ trợ `page_content`, xóa khi tắt và TTL 24 giờ cho trang.
5. Bổ sung dữ liệu/đánh giá ngữ cảnh trang, cơ chế tổng hợp và chạy thử không
   cảnh báo. Hoàn tất migration v22 trên DB thử nghiệm, test xuyên toàn luồng.

Không triển khai bộ thu thập chat, không thêm nhãn hoặc tự bật production ở
bước chốt phạm vi này. Không cần sửa thêm SQL chỉ để ghi nhận phạm vi; thay
đổi contract nhiều đoạn có thể cần migration riêng ở bước sau.

## 7. Tiêu chí nghiệm thu phạm vi và kiểm thử bộ thu thập

Phạm vi đã xác định đủ: nguồn vào, nền tảng ban đầu, phần được lấy/phải bỏ,
công tắc điều khiển, dữ liệu truyền/lưu, giới hạn, nguyên tắc nhãn và việc
ngoài phạm vi. Các chức năng chưa có được đánh dấu rõ, không tuyên bố đã làm.

Bộ thu thập chỉ được nghiệm thu sau khi có bằng chứng cho các ca sau:

- Tắt/thiếu quyền/allowlist rỗng → không có bản ghi văn bản mới.
- Chrome/Edge tab foreground đủ điều kiện → đúng văn bản chính; tab nền,
  chế độ riêng tư, chat/email/form/trang nhạy cảm → không thu thập.
- Truy vấn đúng host/path → lấy đúng truy vấn; URL khác không bị đoán là query.
- Quảng cáo/menu/ô nhập liệu và định danh bị loại; log không chứa text.
- Trang dài được giới hạn/chia đoạn có đánh dấu cắt; giữ phủ định và trích dẫn.
- Mất mạng/retry/refresh → không ghi trùng; ACK/tắt/TTL → xóa đúng dữ liệu tạm.
- Trang phòng chống `RISK` và lời cầu cứu cá nhân `HIGH_RISK` được kiểm tra
  trên dữ liệu đối chứng độc lập trước khi bật cảnh báo.
