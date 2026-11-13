# LaptopChildren — Android cho phụ huynh

App native Kotlin + Jetpack Compose dùng API hiện có của `child-monitor-backend`. Package: `vn.laptopchildren.parent`. Phiên bản: `0.5.0`, Android 8 trở lên, target SDK 35. Điện thoại mục tiêu ban đầu: Redmi K30 / Android 10.

## Phiên camera (0.5.0)

Chọn riêng tư thế/khoảng cách mắt, đặt 1–60 phút và bấm **Bắt đầu phiên mới**.
Agent 1.0.27 tắt camera khi hết giờ hoặc đã lưu cảnh báo đầu tiên; không tự chạy lại.
Cần backend với migration V31. Xem [hướng dẫn triển khai và kiểm thử](../child-monitor-agent/docs/agent_1_0_27_vision_sessions.md).

## Chức năng đã triển khai

- Đăng nhập bằng tài khoản phụ huynh hiện có; đăng ký, xác minh/gửi lại email, quên/đặt lại mật khẩu.
- Token mã hóa bằng AES-GCM với khóa Android Keystore; tự refresh một lần khi nhiều request đồng thời bị 401; không refresh chéo phiên tài khoản.
- Chọn trẻ; thêm và sửa hồ sơ; danh sách laptop, online/offline và lần liên lạc cuối.
- Thống kê hôm nay/tháng và biểu đồ các ngày gần đây theo API `usage-summary`.
- Lịch sử ứng dụng/website theo laptop và khoảng hôm nay/7 ngày; phân trang.
- Cảnh báo theo laptop, lọc chưa đọc, đánh dấu đã đọc, phân trang.
- Khóa/mở, giới hạn hằng ngày, khung giờ, nhắc nghỉ, bật/tắt phân loại, phân tích truy vấn, tư thế và chính sách nhóm nội dung.
- Tài khoản, đổi mật khẩu, xóa tài khoản có xác nhận bằng mật khẩu, đăng xuất.
- Tích hợp FCM có điều kiện: đăng ký token, token thay đổi, thông báo thử, mở mục cảnh báo. Bản không có Firebase vẫn build được và hiển thị rõ chưa cấu hình push.
- Giao diện tiếng Việt, màu sáng/tối theo hệ thống, cuộn khi bàn phím hoặc cỡ chữ lớn, trạng thái lỗi/rỗng/đang tải.

Đăng ký laptop và cấu hình Agent hiện dùng website. App không thực hiện thu thập dữ liệu trên điện thoại; Windows Agent tiếp tục chịu trách nhiệm giám sát laptop. Quản trị viên chỉ dùng dashboard web.

## Bật riêng tư thế và khoảng cách mắt

Trong **Chính sách sử dụng → Giám sát tư thế & Khoảng cách**, hai công tắc
**Theo dõi tư thế** và **Cảnh báo khoảng cách mắt** được lưu độc lập. Bật mỗi
chức năng có xác nhận sử dụng webcam; tắt một chức năng không đổi chức năng còn
lại. Tắt cả hai sẽ dừng webcam sau khi Agent nhận cấu hình mới.

Cần backend đã áp dụng migration V30 và Agent hỗ trợ hai trường cấu hình riêng
(xem `../child-monitor-backend/VISION_CONTROLS.md`). App đọc được cấu hình cũ để
hiển thị, nhưng cần cập nhật backend để lưu lựa chọn riêng. Lưu thành công chỉ
xác nhận cấu hình trên máy chủ, chưa xác nhận laptop đã áp dụng.

## Lịch sử nhắc nghỉ (0.4.0)

Vào **Gia đình → Lịch sử nhắc nghỉ**, hoặc **Chính sách sử dụng → Nhắc nghỉ giải lao → Lịch sử**. Chọn hồ sơ trẻ để xem 10 phản hồi gần nhất từ tất cả laptop của trẻ, gồm lời nhắc đã hiển thị, trẻ chọn nghỉ ngay và nhắc lại sau 5 phút. Chọn nghỉ ngay chưa chứng minh trẻ đã thực sự nghỉ.

Mỗi phản hồi có tên laptop, thời điểm và khoảng nhắc/thời lượng nghỉ đã cấu hình. Màn hình tự tải lại mỗi 15 giây khi đang mở, có nút làm mới thủ công. Khi lỗi mạng, dữ liệu lần tải thành công được giữ kèm thông báo; đổi trẻ sẽ xóa dữ liệu cũ. Lịch sử vẫn xem được khi tắt nhắc nghỉ. Backend hiện trả tối đa 10 mục, chưa hỗ trợ phân trang hoặc lọc ngày.

## AI Advisor (0.3.0)

Mở **Gia đình → AI Advisor** (hoặc liên kết trong Tổng quan).

- **Phân tích:** chọn hồ sơ/laptop, chạy phân tích mới, xem kết quả mới nhất và lịch sử phân trang 20 mục. Nếu POST hết thời gian chờ, app không tự gửi lại; tải lịch sử để kiểm tra trước khi chạy lại. Nếu phân tích đã thành công nhưng GET lịch sử lỗi, app báo rõ hai trạng thái này.
- **Tổng hợp:** báo cáo ngày/tuần theo laptop đang chọn; đổi laptop sẽ xóa báo cáo cũ. Lỗi có nút thử lại.
- **Trò chuyện:** tư vấn chung như dashboard, không gửi device_id hoặc tự đính kèm log. Lỗi giữ nguyên câu hỏi để gửi lại. Mỗi câu hỏi tối đa 2.000 ký tự; context gửi tối đa 9 cặp hỏi/đáp và câu hỏi mới, mỗi nội dung giới hạn 2.000 ký tự theo API. Câu trả lời đầy đủ vẫn hiển thị trong app. App giữ tối đa 40 tin nhắn gần nhất trong RAM, không lưu lịch sử chat xuống đĩa. Cuộc trò chuyện dùng chung trong phiên tài khoản, không gắn với trẻ đang chọn. “Cuộc trò chuyện mới”, đăng xuất hoặc đóng tiến trình sẽ xóa lịch sử cục bộ.

Kết quả AI chỉ tham khảo; cần đối chiếu với hoạt động thực tế. App dùng backend hiện có; Gemini credential và model thuộc cấu hình backend, không đưa khóa AI vào APK. Client AI có timeout riêng: đọc 90 giây, toàn yêu cầu 100 giây; các API khác giữ timeout cũ. Firebase không cần thiết cho AI Advisor.

Kiểm thử thiết bị AI dùng `-PisolatedQa=true` và lớp `vn.laptopchildren.parent.AiAdvisorFlowTest`; MockWebServer trả kết quả có nhãn kiểm thử, không gọi provider thật. Có thể truyền `-e darkTheme true` cho instrumentation để kiểm tra bảng màu tối khi MIUI khóa lệnh đổi theme.

## Ảnh màn hình (0.2.0)

Vào **Hoạt động → Ảnh màn hình**, chọn hồ sơ trẻ và laptop. Danh sách tải 12 ảnh mỗi trang; bấm **Tải thêm ảnh** hoặc **Tải lại ảnh**. API giữ ảnh tối đa 7 ngày. Chạm ảnh để mở toàn màn hình; dùng hai ngón để phóng/kéo hoặc nút **Phóng to**, **Đặt lại**, **Đóng ảnh**.

**Xóa ảnh** yêu cầu xác nhận laptop và thời điểm chụp. Khi xóa thất bại, ảnh vẫn ở danh sách để thử lại. Bản này xóa từng ảnh, chưa có xóa hàng loạt. Ảnh chỉ nằm trong RAM, không có bộ nhớ đệm trên đĩa hoặc tự lưu vào thư viện.

**Bật chụp/Tắt chụp** thay đổi chính sách cho **tất cả laptop thuộc hồ sơ trẻ**, theo API hiện có. Hộp thoại nêu rõ phạm vi này; bật chụp nhắc trao đổi với con vì ảnh có thể chứa thông tin riêng tư. Lưu thành công không có nghĩa Agent đã áp dụng; laptop cần kết nối và đồng bộ. Tắt chụp không xóa ảnh cũ. App không tự yêu cầu chụp ngay hoặc làm mới nền; dùng Tải lại ảnh để xem ảnh mới.

Để kiểm thử thiết bị mà không đụng phiên thật, build với `-PisolatedQa=true`; application ID sẽ là `vn.laptopchildren.parent.qa`. Cài APK app và test tương ứng rồi chạy instrumentation trên `vn.laptopchildren.parent.qa.test`. Khi build bản bàn giao phải bỏ cờ này.

## Build

Mở thư mục này trong Android Studio, dùng JDK 17, Android SDK 35, Build Tools 35.0.0. Gradle wrapper và dependency được cố định phiên bản.

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. Đây là bản ký bằng debug key dành cho phát triển/cài thử, chưa phải bản phát hành Google Play.

Trên workspace hiện tại, toolchain được đặt riêng trong `../.runtime/android-tools/`; script sau thiết lập biến môi trường cho tiến trình hiện tại và có thể cài lên thiết bị được chỉ định:

```powershell
.\build-local.ps1 -Install -Serial cb5760fb
```

`local.properties` là cấu hình đường dẫn SDK riêng từng máy, không commit. `google-services.json`, cache build và keystore cũng được ignore.

## Kết nối

Máy chủ mặc định: `https://api.tuansosad.id.vn/`. Có thể đổi trong **Thiết lập kết nối** trước khi đăng nhập. Chỉ chấp nhận HTTPS ở release. Debug cho phép HTTP trên loopback để kiểm thử bằng ADB reverse hoặc MockWebServer; không cho phép HTTP tới máy chủ Internet.

```powershell
adb -s cb5760fb reverse tcp:3000 tcp:3000
```

Sau đó bản debug có thể dùng `http://127.0.0.1:3000/`. URL trỏ tới gốc server, không thêm `/api`.

App lấy dữ liệu mới khi điều hướng, tải lại và khi trở về foreground sau ít nhất một phút. Không polling nền. Dữ liệu đang xem chỉ giữ trong RAM; không có cache lịch sử offline. Mất mạng giữ dữ liệu đã tải của đúng ngữ cảnh và hiển thị lỗi/thời điểm cập nhật. Không xếp hàng lệnh thay đổi chính sách khi offline.

API hiện chỉ xác nhận lưu cấu hình trên backend. Vì chưa có xác nhận phiên bản cấu hình từ Agent cho toàn bộ chính sách, app chỉ báo **đã lưu, chờ laptop đồng bộ**, không khẳng định đã thực thi.

## Bật thông báo FCM

1. Trong dự án Firebase của hệ thống, đăng ký Android app với package `vn.laptopchildren.parent`.
2. Đặt cấu hình client `google-services.json` vào `app/google-services.json`, build lại. Không đưa service-account private key vào app.
3. Backend cần `PUSH_NOTIFICATIONS_ENABLED=true`, `PUSH_PROVIDERS` có `fcm`, `FIREBASE_PROJECT_ID` và credential service account theo hướng dẫn backend.
4. Đăng nhập, mở **Gia đình → Tài khoản phụ huynh → Bật nhận thông báo**, rồi gửi thông báo thử.
5. Kiểm thử foreground, background, token rotation, đăng xuất/chuyển tài khoản, quyền bị từ chối và tùy chọn pin của MIUI trên thiết bị thật.

Google Play Services đã được kiểm tra có trên Redmi K30. Cấu hình Firebase Android và backend hiện chưa được cung cấp nên chưa xác minh end-to-end FCM. Không diễn giải HTTP được provider chấp nhận thành thông báo chắc chắn đã tới thiết bị.

Người dùng đã xác nhận hoàn thiện app trước, cấu hình Firebase sau. Kênh Android `alerts` khớp kênh backend gửi. Khi chạm thông báo có `device_id`, app tra lại danh sách thiết bị được phép truy cập rồi chuyển sang đúng hồ sơ và laptop; nếu thiết bị không còn thuộc tài khoản, app báo lỗi thay vì mở dữ liệu khác.

Đăng ký/khôi phục tài khoản phụ thuộc cấu hình email của backend. Nếu backend ở chế độ development và chưa cấu hình SMTP, email có thể chỉ được ghi vào console theo hành vi backend hiện tại.

## Kiểm thử

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug
.\gradlew.bat :app:connectedDebugAndroidTest
```

Unit tests dùng MockWebServer: refresh token, yêu cầu đồng thời, hết phiên, đăng xuất trong khi request đang chạy, không gửi token vào endpoint công khai, bộ lọc thiết bị/phân trang, HTTPS, định dạng thời lượng.

Instrumentation test dùng **máy chủ fixture loopback trên chính điện thoại**, dữ liệu có nhãn kiểm thử; không ghi database thật. Test từ chối chạy nếu đang có phiên đăng nhập thật. Luồng kiểm tra: đăng nhập → đổi trẻ → ứng dụng/website → đọc cảnh báo → lưu giới hạn → đăng xuất. Test khôi phục URL gốc sau khi xong. Ảnh QA được lưu vào external files của app, thư mục `qa`.

Trước khi test, giữ máy mở khóa và chấp thuận cài app/test APK qua USB nếu MIUI hỏi. Không tắt các cơ chế bảo vệ thiết bị để vượt qua xác nhận này.

## Cấu trúc

```text
app/src/main/java/vn/laptopchildren/parent/
  MainActivity.kt              # Vòng đời, edge-to-edge, mở từ thông báo
  ParentApplication.kt         # AppGraph, phiên, vòng đời push
  ParentViewModel.kt           # Dữ liệu từng màn hình, hủy request cũ
  ParentMessagingService.kt    # Nhận FCM
  data/                       # API, DTO, Keystore, refresh token
  ui/                         # Material 3, các màn hình và theme
```

Không sửa backend, database hay Windows Agent để phục vụ bản app đầu tiên. Các thay đổi chưa commit sẵn trong website được giữ nguyên.
