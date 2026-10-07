# LaptopChildren

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người dùng chính là phụ huynh hoặc người giám hộ có con sử dụng máy tính.
Họ cần theo dõi thời gian sử dụng máy, website đã truy cập, lịch sử hoạt động
và các cảnh báo liên quan đến nội dung hoặc hành vi có nguy cơ.

## Product Purpose

LaptopChildren là hệ thống giám sát máy tính dành cho phụ huynh. Sản phẩm giúp
phụ huynh dễ dàng nắm được tình hình sử dụng máy của con và nhanh chóng nhận
biết những vấn đề cần chú ý.

Thành công của việc cải thiện UI/UX là giúp người dùng hiểu thông tin và thực
hiện các tác vụ hiện có dễ dàng hơn, đồng thời giữ nguyên chức năng của hệ thống
đang hoạt động.

## Operating Context

- Đây là project đã có sẵn và đang hoạt động, không phải một ứng dụng cần xây mới.
- Frontend hiện tại nằm trong `child-monitor-web/`, sử dụng HTML, CSS và
  JavaScript thuần. Giao diện hiện có sử dụng tiếng Việt.
- Theo mã nguồn và tài liệu hiện tại, dashboard kết nối với backend qua API;
  Windows Agent thu thập hoạt động trên máy của trẻ và đồng bộ với backend.
- Các luồng hiện có gồm quản lý hồ sơ trẻ và thiết bị, xem tổng quan và lịch sử,
  điều chỉnh chính sách, xem cảnh báo, phân tích và báo cáo. Các chức năng quản
  trị hiện có cũng phải được bảo toàn khi cải thiện giao diện.
- Dev server của frontend chạy bằng `node server.js` trong `child-monitor-web/`,
  mặc định tại `http://localhost:5173`, và proxy `/api/*` tới backend. Đây là
  thông tin phát triển lấy từ repository, không phải cam kết triển khai sản phẩm.

## Capabilities and Constraints

### Phạm vi được người dùng xác nhận

- Dashboard tổng quan.
- Theo dõi hoạt động sử dụng máy.
- Lịch sử website.
- Cảnh báo an toàn.
- Phân loại nội dung.
- Báo cáo.
- Các chức năng quản lý liên quan.

### Ràng buộc bắt buộc khi cải thiện UI/UX

Cải thiện trực tiếp trên frontend hiện có. Giữ nguyên mọi chức năng và hành vi
nghiệp vụ đang hoạt động. Không tạo ứng dụng hoàn toàn mới, thay thế kiến trúc
hiện tại hoặc tự chuyển sang framework khác.

Không thay đổi:

- Backend logic.
- API endpoints và hợp đồng dữ liệu hiện có.
- Database.
- Routes.
- Authentication và phân quyền hiện có.
- Monitoring logic.
- ML classification.
- Report generation.
- Business logic.

Các thay đổi về bố cục, trình bày, khả năng đọc và tương tác giao diện phải giữ
nguyên luồng tác vụ, liên kết dữ liệu và kết quả thao tác hiện có. Việc đổi cách
hiển thị báo cáo không được đổi cách tạo báo cáo hoặc tính toán số liệu. Việc
trình bày cảnh báo không được đổi ngưỡng, nhãn phân loại hoặc logic phát hiện.

### Các quyết định chưa được xác nhận

Chưa xác định nhóm tuổi cụ thể của trẻ, mục tiêu triển khai thương mại hoặc một
chuẩn chứng nhận khả năng tiếp cận. Không biến các giả định này thành yêu cầu
sản phẩm hoặc tuyên bố với người dùng.

## Brand Commitments

- Tên sản phẩm được người dùng xác nhận là **LaptopChildren**.
- `SafeNest`, `Laptop Monitor` và `Laptop Monitoring` xuất hiện trong mã nguồn
  và tài liệu cũ; chúng không thay thế tên sản phẩm đã được xác nhận ở đây.
- Ghi nhận tên mới trong ngữ cảnh sản phẩm không đồng nghĩa với việc đổi tên
  package, đường dẫn, API, database hoặc các định danh kỹ thuật.
- Tài liệu này không xác lập một phong cách thị giác mới.

## Evidence on Hand

- Người dùng đã xác nhận đối tượng, mục đích, tên sản phẩm, phạm vi hiện tại và
  các giới hạn thay đổi nêu trên trong quá trình `/impeccable init`.
- `README.md`: mô tả hệ thống và ranh giới giữa dashboard, backend, Windows Agent
  và workspace AI. Những tên gọi hoặc định hướng cũ không ghi đè xác nhận mới
  của người dùng.
- `child-monitor-web/README.md`, `child-monitor-web/package.json`: cách chạy
  frontend và mô tả các chức năng hiện có.
- `child-monitor-web/index.html`, `child-monitor-web/app.js`,
  `child-monitor-web/styles.css`: giao diện và các luồng đã được triển khai.
- `child-monitor-web/assets/`: các tài nguyên hình ảnh và favicon hiện có.
- `child-monitor-agent/README.md` và
  `child-monitor-agent/docs/text_privacy_controls.md`: mô tả vận hành và giới hạn
  dữ liệu giám sát; cần đối chiếu mã nguồn khi diễn giải chi tiết cho người dùng.
- `TESTING.md` và `child-monitor-web/test/`: hướng dẫn và kiểm thử hiện có;
  sự tồn tại của chúng không phải bằng chứng rằng mọi kiểm thử đang đạt.

Không tự tạo số liệu hiệu quả, độ chính xác AI, lời chứng thực, số lượng người
dùng hoặc cam kết bảo vệ tuyệt đối khi chưa có bằng chứng được xác nhận.

## Product Principles

1. Ưu tiên công việc của phụ huynh: nắm tình hình và nhận biết vấn đề cần chú ý.
2. Bảo toàn chức năng: chất lượng giao diện không được đánh đổi bằng thay đổi
   logic nghiệp vụ hoặc mất khả năng đang có.
3. Trình bày trung thực: phân biệt dữ liệu hoạt động, kết quả phân loại và cảnh
   báo; giữ nguyên ý nghĩa dữ liệu và các giới hạn của hệ thống.
4. Phát triển trên nền tảng hiện có: cải tiến từng phần trong frontend và kiến
   trúc đang hoạt động.
5. Giữ thông tin gắn với đúng trẻ, thiết bị và thời điểm trong mọi luồng theo dõi.

## Accessibility & Inclusion

Frontend hiện có hỗ trợ tiếng Việt, điều hướng bằng bàn phím, trạng thái focus,
nhãn hỗ trợ công nghệ trợ giúp và chế độ giảm chuyển động. Giữ các khả năng này
khi cải thiện giao diện. Đây là mô tả cơ chế hiện có trong mã nguồn, không phải
tuyên bố đạt chứng nhận khả năng tiếp cận.
