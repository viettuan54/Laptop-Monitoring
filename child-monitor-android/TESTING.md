# Xác minh bản Android 0.1.0

## Cập nhật ảnh màn hình — 0.2.0 (09/11/2026)

- Build `assembleDebug`, 9/9 unit tests, Android Lint 0 lỗi / 18 cảnh báo: `.runtime/android-tools/screenshots-final-build.log`.
- Unit test mới xác minh token xác thực, bộ lọc laptop, offset/limit, ID ảnh lớn dạng chuỗi từ PostgreSQL, endpoint tải ảnh và xóa đúng ID.
- Luồng thiết bị cuối đạt `OK (1 test)` trong 31,605 giây: xem ảnh, retry ảnh 404, phóng to/đặt lại, hủy/bật/tắt chụp, đổi trẻ không giữ ảnh cũ, hủy xóa, lỗi xóa 500 giữ ảnh và thử lại thành công; tiếp tục kiểm tra cảnh báo, lưu giới hạn và đăng xuất. Log: `.runtime/android-tools/screenshots-device-final.log`. Test chờ request/thông báo tạm kết thúc trước khi bấm nút tiếp theo; nút lưu giới hạn được kích hoạt qua semantics để tránh bàn phím che tọa độ.
- Kiểm thử thiết bị dùng package riêng `vn.laptopchildren.parent.qa` và MockWebServer; không đọc, xóa ảnh thật hoặc thay đổi chính sách thật. Phiên đăng nhập của package chính được giữ nguyên khi cập nhật.
- Màn hình sáng/font 1.0: `.impeccable/review/android/screenshots/`. Màn hình tối/font 1.3: `.impeccable/review/android/screenshots-dark-large/`. Ảnh trong gallery là fixture do test tạo, không phải dữ liệu trẻ thật hoặc asset đóng gói trong app.
- MIUI khóa lệnh đổi night mode. Bản test dùng `-e darkTheme true` để override `LocalConfiguration.uiMode` trong composition kiểm thử, chạy đúng bảng màu tối của app. Bằng chứng này xác minh nội dung app ở chế độ tối; không xác minh chuyển theme hệ thống hay màu thanh trạng thái. Font scale hệ thống được khôi phục về 1.0 sau kiểm thử.
- Reviewer độc lập trả `ship` cho yêu cầu bổ sung bằng chứng tối/chữ lớn: nội dung xuống dòng, vùng ảnh, nút phóng to/đặt lại/đóng đọc được. Đây là verdict cho mục đã yêu cầu kiểm chứng, không phải tuyên bố kiểm thử mọi thiết bị.
- Documenter xác nhận phần mới tiếp tục dùng hệ thống Material hiện có; giữ nguyên DESIGN.md và sidecar. Phạm vi extension được ghi trong DIRECTION.md.
- APK cài thử: versionCode 2, versionName 0.2.0; chưa ký khóa phát hành. Không thay backend hoặc Agent. Chưa kiểm thử đường đi từ Agent thật gửi ảnh đến app; test thiết bị kiểm chứng bằng fixture.

Phần bên dưới là bằng chứng lịch sử của bản 0.1.0.

Ngày: 09/11/2026. Thiết bị thật: Redmi K30, Android 10 (API 29), 1080 × 2400, density override 388. Package `vn.laptopchildren.parent`.

## Kết quả

| Kiểm tra | Kết quả | Phạm vi bằng chứng |
|---|---|---|
| Build APK debug | Đạt | `:app:assembleDebug` |
| Unit tests | 8/8 đạt | Refresh token và xoay vòng, request đồng thời, token hết hạn, endpoint công khai, response sau đăng xuất, phạm vi thiết bị/phân trang, HTTPS, thời lượng |
| Android Lint | 0 lỗi, 18 cảnh báo | Cảnh báo chủ yếu về phiên bản thư viện và cách dùng SharedPreferences; không tắt kiểm tra lỗi |
| Kiểm thử trên Redmi K30 | Đạt | Đăng nhập fixture, chuyển hai hồ sơ, ứng dụng/website, đánh dấu cảnh báo đã đọc, lưu giới hạn, đăng xuất |
| Cỡ chữ 130% | Đạt luồng kiểm thử | Bảy màn hình được chụp từ thiết bị; đã sửa và chụp lại lỗi lệch baseline biểu đồ |
| Rà soát giao diện độc lập | `ship` cho lỗi biểu đồ đã yêu cầu sửa | Reviewer xác nhận cùng baseline cho bảy cột/ngày, số liệu đọc được, không thấy hồi quy do sửa lỗi này |
| Backend hiện tại | HTTPS 200; endpoint bảo vệ 401 khi chưa đăng nhập | Chỉ kiểm tra kết nối và yêu cầu xác thực, không thay thế kiểm thử tài khoản thật |
| Khôi phục sau kiểm thử | Đạt | Máy chủ thật `https://api.tuansosad.id.vn/`, không lưu phiên fixture, fontScale trở về 1.0 |

Test thiết bị dùng MockWebServer loopback và tài khoản `parent@example.test`. Mọi tên trẻ/laptop đều ghi rõ kiểm thử. Không tạo trẻ, thay đổi chính sách hay xóa dữ liệu trong backend thật. Máy chủ fixture chỉ được thay trong RAM, không ghi cấu hình kết nối của người dùng.

## Giới hạn kiểm chứng

- Các capture là chế độ tối. MIUI báo `mNightModeLocked=true`, nên lệnh chuyển sáng không có hiệu lực. Theme sáng có trong mã nguồn nhưng chưa có bằng chứng hình ảnh trên máy này.
- FCM chưa kiểm thử đầu cuối vì chưa có dự án/cấu hình Firebase. Người dùng đã chọn hoàn thiện app trước và cấu hình Firebase sau.
- Chưa đăng nhập bằng tài khoản thật của người dùng. Khi bàn giao, app mở màn hình đăng nhập để người dùng tự nhập thông tin.
- Đây là APK debug cài thử, chưa ký bằng khóa phát hành hoặc đưa lên Google Play. Chưa kiểm thử tablet và các phiên bản Android khác.

## Bằng chứng trong workspace

- `.runtime/android-tools/final-verification.log`: build, unit tests, lint cuối.
- `.runtime/android-tools/device-test-dark.log`: luồng kiểm thử ở cỡ chữ ban đầu.
- `.runtime/android-tools/device-test-final.log`: luồng cuối với cỡ chữ 130%.
- `.impeccable/review/android/dark/`: các capture ban đầu.
- `.impeccable/review/android/large/`: các capture sau sửa, trên Redmi K30 ở cỡ chữ 130%.
- Báo cáo máy đọc được: `app/build/test-results/testDebugUnitTest/` và `app/build/reports/lint-results-debug.*`.

Các đường dẫn bắt đầu bằng `.runtime`/`.impeccable` ở trên tính từ root repository; báo cáo trong `app/build` tính từ thư mục Android.
