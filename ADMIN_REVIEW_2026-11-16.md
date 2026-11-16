# Rà soát Admin — 16/11/2026

## Phạm vi và bằng chứng

Rà soát mã nguồn 6 trang Admin, API quản trị, xác thực tài khoản/thiết bị, xác thực khuôn mặt và đường đồng bộ blacklist với Agent. Truy vấn cơ sở dữ liệu chỉ đọc trong lần rà soát này. Không thay đổi nghiệp vụ hoặc dữ liệu.

- Cơ sở dữ liệu hiện có 1 Admin, đang hoạt động và đã xác minh email; 0 hồ sơ trẻ thuộc Admin.
- Múi giờ PostgreSQL là Asia/Bangkok (UTC+7), hiện phù hợp ranh giới ngày Việt Nam của thống kê `CURRENT_DATE`.
- 6/6 kiểm thử `adminUser.unit.test.js`, `adminFaceLogin.unit.test.js` đạt.
- 17/17 kiểm thử `child-monitor-web/test/smoke.test.js` đạt.
- Chưa thử tương tác bằng trình duyệt, chưa kiểm chứng giao diện mobile hoặc xác thực khuôn mặt với camera thật. Không chấm điểm độ tương phản, hiệu năng hoặc tuân thủ accessibility khi chưa đo.
- Giữ nguyên các thay đổi đã có trong app.js, styles.css và smoke.test.js.

## P1 — Cần sửa trước

### 1. Admin duy nhất có thể tự xóa tài khoản

`child-monitor-backend/src/controllers/admin.controller.js:404` chặn tự xóa qua API quản lý người dùng. Tuy nhiên `src/routes/auth.routes.js:36` và `src/controllers/auth.controller.js:775` vẫn cho tài khoản đã xác thực gọi DELETE /auth/account, kiểm tra mật khẩu rồi xóa mà không kiểm tra vai trò hoặc Admin cuối cùng. Trang Tài khoản & bảo mật của Admin có nút gọi luồng này.

Ảnh hưởng: Admin duy nhất hiện tại có thể tự xóa, làm mất khả năng quản trị qua ứng dụng. Không thực hiện thao tác này trên dữ liệu thật.

Đề xuất: thống nhất chính sách ở Backend, bảo vệ Admin cuối cùng trong giao dịch; nếu không cho Admin tự xóa, loại bỏ chức năng đó trên giao diện Admin. Cần kiểm thử đồng thời với các thao tác khóa/hạ quyền.

### 2. Có thể tự bỏ xác minh email và mất khả năng đăng nhập lại

`src/controllers/admin.controller.js:307` chỉ cấm tự hạ quyền và tự khóa. `is_verified=false` vẫn được phép; giao diện chỉnh sửa tài khoản cho phép thay đổi trường này. Login và xác thực khuôn mặt yêu cầu email đã xác minh. Thay đổi xác minh cũng không nằm trong điều kiện thu hồi phiên tại dòng 327.

Ảnh hưởng: Admin hiện tại có thể còn dùng phiên cũ nhưng không đăng nhập lại được cho đến khi xác minh lại email. Với chỉ một Admin, không có Admin khác để sửa trạng thái.

Đề xuất: chặn tự bỏ xác minh đối với Admin; áp dụng quy tắc bảo vệ ít nhất một Admin đủ điều kiện đăng nhập. Xác định thống nhất hiệu lực của việc bỏ xác minh đối với phiên đang tồn tại.

### 3. Nâng phụ huynh lên Admin vẫn giữ trẻ và thiết bị

`src/controllers/admin.controller.js:282` cập nhật role mà không kiểm tra children/devices. Vì vậy tình trạng vừa dọn có thể tái diễn. Các route children đã yêu cầu role parent; nhưng điều này không giải quyết dữ liệu có sẵn khi đổi vai trò.

Đề xuất theo yêu cầu Admin chỉ quản trị hệ thống: từ chối nâng quyền khi tài khoản còn trẻ/thiết bị, trả thông báo rõ để chuyển quyền sở hữu trước. Không tự xóa dữ liệu khi nâng quyền. Bổ sung kiểm thử ràng buộc này.

### 4. Xác thực khuôn mặt kiểm tra nhãn chung, chưa gắn với từng Admin

`src/controllers/auth.controller.js:690` gọi verifyAdminFace(frames), sau đó dòng 707 chỉ so sánh nhãn `admin` với role. `src/services/faceAuth.service.js:107` không nhận user_id để so khớp danh tính riêng.

Ảnh hưởng: khi có nhiều Admin, bước khuôn mặt chưa phân biệt khuôn mặt thuộc tài khoản nào. Mật khẩu vẫn được kiểm tra trước đó; đây không phải bằng chứng có thể đăng nhập không cần mật khẩu. Checkbox chuẩn bị đăng ký khuôn mặt ở giao diện cấp quyền không xác nhận được tình trạng đăng ký thật.

Đề xuất: gắn dữ liệu nhận diện với user_id, có trạng thái đăng ký và luồng đăng ký/thu hồi rõ ràng trước khi mở rộng nhiều Admin. Chưa đánh giá khả năng chống giả mạo bằng ảnh/video trong lần rà soát này.

## P2 — Cần cải thiện chức năng và tính chính xác

### 5. Danh sách chặn thiếu trạng thái áp dụng thực tế

`child-monitor-agent/service/main_service.py:220` tải blacklist mỗi 600 giây; heartbeat 5 giây không cập nhật blacklist toàn cục. `child-monitor-web/app.js:4016` chỉ thông báo sẽ đồng bộ và trang blacklist hiển thị Backend → Agent mà không có xác nhận thiết bị đã áp dụng.

Đề xuất: ghi rõ độ trễ hiện tại; hiển thị tên miền đã chuẩn hóa trước/sau lưu và giải thích chặn cả tên miền, không chặn riêng đường dẫn. Bổ sung phiên bản cấu hình, thời điểm đồng bộ, xác nhận áp dụng/lỗi từ từng Agent; cải thiện cơ chế truyền thay đổi nếu cần hiệu lực nhanh. Phân biệt đã lưu ở Backend, Agent đã nhận và đã áp dụng thành công.

### 6. Tổng quan có chỉ báo trạng thái được ghi cố định

`child-monitor-web/app.js:3659` hiển thị JWT & RLS “Đang bật”, Audit Log “Đang ghi” bằng chuỗi cố định, không từ kết quả kiểm tra riêng các thành phần đó.

Ảnh hưởng: người quản trị có thể hiểu nhầm đây là kết quả theo dõi sức khỏe trực tiếp.

Đề xuất: dùng dữ liệu kiểm tra sức khỏe thực tế kèm thời gian kiểm tra; hoặc đổi thành thông tin mô tả cơ chế bảo mật, không dùng làm trạng thái vận hành. Không coi backend kết nối được là mọi thành phần đều khỏe.

### 7. Khóa tài khoản chưa có chính sách rõ cho thiết bị đang gửi dữ liệu

`src/middlewares/deviceAuth.middleware.js:44` xác thực bằng device_secret trong bảng devices, không kiểm tra trạng thái/role của chủ sở hữu. Khóa tài khoản chỉ chặn phiên người dùng; credential của Agent vẫn hợp lệ.

Đây là hành vi đã xác định từ mã nguồn, không tự kết luận là lỗi: có thể hệ thống muốn tiếp tục bảo vệ trẻ khi khóa đăng nhập phụ huynh.

Đề xuất: quy định rõ “khóa đăng nhập” hay “đình chỉ toàn bộ tài khoản và thiết bị”, ghi đúng tác dụng trên giao diện. Nếu cần đình chỉ Agent, bổ sung trạng thái riêng và chính sách khi Agent mất kết nối.

### 8. Một số đầu vào API trả lỗi máy chủ thay vì lỗi người dùng

`src/controllers/admin.controller.js:14`: limit âm vẫn lọt đến LIMIT SQL. `:186`/`:197`: reason không phải chuỗi có thể lỗi ở .trim(). `:448`: ID blacklist chưa kiểm tra số nguyên dương trước truy vấn.

Đề xuất: chuẩn hóa giới hạn phân trang, kiểm tra kiểu reason, ID và trả 400 rõ ràng. Các trường hợp này được xác định bằng đọc mã, chưa gửi dữ liệu không hợp lệ tới production.

### 9. Khả năng sử dụng biểu mẫu bằng công nghệ hỗ trợ

`child-monitor-web/app.js:3740`, `:3778`, `:3807`, `:4518`: nhiều label nằm cạnh input/select/textarea nhưng không có for/id hoặc cơ chế đặt tên tương đương. Có nhãn nhìn thấy không đồng nghĩa trình đọc màn hình liên kết được nhãn với ô nhập.

Đề xuất: bổ sung liên kết label/control và kiểm tra bàn phím, thông báo lỗi. Nút biểu tượng tại `styles.css:6744` có kích thước 34×34; cân nhắc vùng chạm lớn hơn trên mobile. Không khẳng định 34px tự động vi phạm WCAG.

## Bổ sung nên cân nhắc

- Nhật ký kiểm toán: lọc theo khoảng ngày, đối tượng bị tác động; xuất kết quả phục vụ tra cứu. Hiện chỉ có action và actor_user_id.
- Agent API: ghi rõ gửi dữ liệu thật, hiển thị thiết bị/môi trường đích trước khi gửi các request ghi dữ liệu; có thiết bị thử nghiệm riêng để tránh lẫn dữ liệu vận hành.
- Thao tác xóa người dùng: hiển thị số hồ sơ/thiết bị và dữ liệu sẽ bị xóa trước khi xác nhận.
- Khi đổi vai trò, cần kiểm chứng cả ràng buộc dữ liệu lẫn khả năng đăng nhập sau cấp quyền, không chỉ lưu role thành công.

## Điểm đang làm tốt

- Các route /admin đều kiểm tra xác thực và role ở Backend.
- Middleware đọc quyền và trạng thái tài khoản từ DB; kiểm tra token_version để thực thi thu hồi phiên.
- Các thao tác quản trị chính sử dụng giao dịch và ghi audit.
- Đăng nhập Admin có challenge khuôn mặt trước cấp token; challenge được tiêu thụ trước cấp phiên; refresh token luân phiên.
- Các giá trị văn bản người dùng trong bảng Admin chủ yếu được escape; có trạng thái tải, lỗi, thử lại, lọc và phân trang.

## Kết quả detector giao diện

Impeccable detector báo 3 điểm trên styles.css: transition height tại 1238/1316 và border-left tại 2881. Hai animation thuộc biểu đồ sử dụng của phần phụ huynh, không phải bằng chứng lỗi Admin. Border trái của guide-note là lựa chọn trình bày; không đưa vào lỗi chức năng. Không biến kết quả detector thành kết luận hiệu năng hay accessibility khi chưa kiểm tra trực tiếp.

## Thứ tự triển khai đề xuất

1. Bảo vệ Admin cuối cùng và trạng thái xác minh; thêm kiểm thử các đường API thay thế.
2. Ràng buộc dữ liệu khi cấp quyền Admin; gắn xác thực khuôn mặt với tài khoản nếu dùng nhiều Admin.
3. Minh bạch trạng thái đồng bộ blacklist và trạng thái sức khỏe hệ thống.
4. Chốt chính sách khóa tài khoản/thiết bị; sửa validation và nhãn biểu mẫu.
5. Bổ sung công cụ tra cứu audit và cảnh báo request thật trong Agent API; cuối cùng rà soát giao diện bằng trình duyệt.

Đối với phần giao diện, có thể dùng Impeccable harden cho trạng thái lỗi/biểu mẫu, clarify cho thông báo đồng bộ và hiệu lực thao tác, adapt cho vùng chạm mobile, rồi polish sau khi sửa chức năng. Các kiểm thử hiện có đạt không chứng minh các trường hợp thiếu nêu trên đã được bảo vệ.
