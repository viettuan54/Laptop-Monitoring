# Xác minh app Android

## Bổ sung Hoạt động — 0.6.0 (20/11/2026)

- Đối chiếu `activityAccessStatus.service.js`, `appEnforcement.controller.js`, `screenshots.controller.js` và Web. Bổ sung trạng thái truy cập, lịch sử kết quả cưỡng chế theo thiết bị/thời gian/phân trang, yêu cầu chụp ngay và xóa ảnh theo thiết bị với mốc `through_id`.
- Build debug và 32/32 unit tests đạt; Android Lint 0 lỗi / 17 cảnh báo. Test API mới kiểm tra Bearer token, POST chụp trả 202/ngoại tuyến, DELETE có body và query thiết bị, ID lớn không mất chính xác, phân trang và nhãn kết quả cưỡng chế. Log: `.runtime/android-tools/activity-tools-build.log`.
- Chụp ngay không tự bật chụp màn hình; cần bật trước. App chỉ báo yêu cầu đang chờ, không khẳng định đã chụp khi nhận 202. Tải lại có giới hạn khi màn hình ở foreground; lỗi dừng tự tải, hỗ trợ tải lại thủ công. Xóa hàng loạt giữ dữ liệu hiển thị khi API thất bại; ảnh mới hơn mốc xác nhận được giữ theo hợp đồng backend.
- Chưa bổ sung các mục tùy chọn: xóa trẻ, đổi tên/xóa thiết bị, kéo để làm mới. Đăng ký thiết bị và xoay secret giữ ở Web.
- Giới hạn: chưa kiểm chứng đầu cuối với Windows Agent thật gửi ảnh; dữ liệu kiểm thử không thay thế xác minh này. Firebase vẫn chưa cấu hình.
- Redmi K30: năm luồng hiện có đạt trong `activity-tools-device.log`. Luồng mới đạt riêng `OK (1 test)` trong 14,084 giây tại `.runtime/android-tools/activity-tools-device-final.log`: badge truy cập, kết quả cưỡng chế, đổi trẻ không giữ kết quả cũ, POST chụp và tự nhận ảnh mới, hủy xóa không gửi DELETE, lỗi 500 giữ ảnh rồi thử lại thành công. Sửa dữ liệu tiếng Việt và cách cuộn LazyColumn trong test sau các lượt đầu thất bại; không thay mã production để bỏ qua assertion.
- Kiểm thử dùng package QA và MockWebServer, không gửi lệnh chụp/xóa tới backend thật. App-op MIUI 10021 của QA đã trả về `default`. Đã xem ảnh xác minh màn hình kết quả chặn, trạng thái chờ ảnh và hộp thoại xóa tại `.runtime/android-tools/activity-tools-captures/`. Chưa kiểm tra lại theme tối/chữ lớn trong đợt này.
- Đã cài cập nhật tại chỗ app chính trên Redmi K30: versionCode 7/versionName 0.6.0, giữ dữ liệu app. APK debug chính: `.runtime/android-tools/laptopchildren-0.6.0-debug.apk` (tách khỏi output QA).

## Sửa lỗi trước demo — 0.5.1 (19–20/11/2026)

- Sửa state dialog máy chủ độc lập với form xác thực; hủy/mở lại bỏ URL chưa lưu.
- Công tắc Vision không cho bật khi thời lượng sai, vẫn cho tắt chức năng đang bật. Kiểm tra mật khẩu phía client khớp backend (8–128 ký tự, A–Z, 0–9, tập ký tự đặc biệt); lỗi mật khẩu cũ sai/mật khẩu yếu có thông báo riêng. Đăng ký email trùng vẫn theo phản hồi 201 chung của backend.
- Tổng quan lấy thêm tháng trước nếu 7 ngày gần đây đi qua ranh giới tháng; tổng tháng không bị cộng lẫn. Cảnh báo có nhãn loại. Notification dùng tag nguyên ID chuỗi, ID thông điệp hoặc UUID dự phòng; PendingIntent có URI riêng theo cùng khóa.
- `API_BASE_URL` đọc Gradle property, kiểm tra gốc HTTPS, giữ mặc định hiện tại. Release tắt debug, build APK chưa ký; chưa có khóa phát hành. Bản cài thử 0.5.1 dùng debug key.
- Build `assembleDebug`, `assembleRelease`, `testDebugUnitTest`, `lintDebug` đạt. 30/30 unit tests đạt, gồm 5 test mới cho mật khẩu/lỗi backend, biểu đồ qua năm mới và ID thông báo. Lint: 0 lỗi, 17 cảnh báo (8 dependency, 8 UseKtx, 1 DataExtractionRules). Log: `.runtime/android-tools/mobile-fixes-build.log`.
- Firebase vẫn chưa có `app/google-services.json`, chưa kiểm thử FCM đầu cuối. App hiển thị trạng thái chưa cấu hình và vẫn đọc cảnh báo qua API.
- Ngày 20/11: 5/5 instrumentation tests đạt trên Redmi K30 trong 36,93 giây, dùng package QA và MockWebServer. Kiểm tra hủy dialog/khôi phục URL/tách lỗi, điều hướng cảnh báo khi dữ liệu gia đình đang tải, công tắc Vision khi thời lượng sai, validation mật khẩu và luồng đăng nhập/chuyển trẻ/ảnh/cảnh báo/chính sách/đăng xuất. Các nhãn cũ trong test chụp ảnh và đăng xuất được cập nhật theo giao diện hiện tại. Log: `.runtime/android-tools/mobile-fixes-device-final.log`.
- MIUI chặn QA mở activity từ nền ở lượt đầu; đã cho phép tạm riêng QA và khôi phục app-op 10021 về `default` sau lượt cuối. Không đổi quyền app chính. Ảnh kiểm thử: `.runtime/android-tools/mobile-fixes-final-captures/`; đã xem ảnh dialog, validation camera/mật khẩu, cảnh báo và tổng quan. Chưa kiểm thử lại theme tối/chữ lớn trong lượt này.
- Đã cập nhật app chính bằng `adb install -r` trên Redmi K30 và mở thành công: package `vn.laptopchildren.parent`, versionCode 6, versionName 0.5.1. APK chính được giữ riêng tại `.runtime/android-tools/laptopchildren-0.5.1-debug.apk` vì build QA dùng chung thư mục output Gradle. Không gỡ app hoặc xóa dữ liệu app chính.

## Lịch sử nhắc nghỉ — 0.4.0 (10/11/2026)

- Build bản chính và bản QA đạt; 19/19 unit tests đạt (8 AI, 11 API/phiên), Android Lint 0 lỗi và 10 cảnh báo. Logs: `.runtime/android-tools/mobile-current-build.log`, `mobile-qa-ready.log`, `mobile-final-build.log`.
- Kiểm thử API bổ sung xác minh child_id, Bearer token, ID lớn dạng chuỗi và ý nghĩa shown/acknowledged/snoozed/unknown.
- Luồng thiết bị Redmi K30 đạt `OK (1 test)` mỗi lần: sáng/font 1.0 (24,298 giây), tối/font 1.3 (24,609 giây). Kiểm tra mở từ Gia đình, ba loại phản hồi, lỗi 503 giữ dữ liệu và thử lại, đổi trẻ không giữ dữ liệu trẻ cũ, trạng thái rỗng, tự tải lại sau 15 giây, vào từ chính sách khi tắt nhắc nghỉ và quay lại đúng trang. Logs: `break-device-light.log`, `break-device-dark-large.log` trong `.runtime/android-tools/`.
- Sáu ảnh bằng chứng: `.impeccable/review/android/break-light/` và `break-dark-large/`. Chế độ tối dùng override LocalConfiguration trong test; không kiểm chứng chuyển theme hệ thống hoặc thanh trạng thái MIUI. Font hệ thống đã trả về 1.0.
- Sau rà soát giao diện: bản ghi dùng đường phân cách, bỏ dấu tích thành công chung cho mọi phản hồi, thông báo dữ liệu cũ dùng cặp màu errorContainer/onErrorContainer. Kiểm thử lại đạt ở sáng (24,077 giây) và tối/chữ lớn (24,772 giây); sáu ảnh trên đã cập nhật. Logs cuối: `break-device-light-final.log`, `break-device-dark-large-final.log`, `break-final-package.log`. Build và lint bản giao cuối đạt.
- Test dùng package `vn.laptopchildren.parent.qa`, MockWebServer và dữ liệu có nhãn kiểm thử; không thay chính sách hoặc dữ liệu tài khoản thật. Chưa kiểm chứng đầu cuối từ Windows Agent thật gửi phản hồi đến API và app.
- APK chính `vn.laptopchildren.parent`, versionCode 4/versionName 0.4.0, đã cài cập nhật bằng `adb install -r` trên Redmi K30, giữ dữ liệu app. Đây là bản debug, Firebase chưa cấu hình theo lựa chọn của người dùng.
- Reviewer kết luận `ship` cho ba sửa đổi nêu trên: cả ba resolved; đây không phải phê duyệt toàn app. Tương phản cảnh báo dữ liệu cũ khoảng 6,80:1 sáng và 6,93:1 tối. Documenter xác nhận dùng token hiện có, giữ nguyên DESIGN.md/sidecar; sai lệch thiết kế chung có từ trước không được sửa trong phạm vi này.

## Cập nhật AI Advisor — 0.3.0 (10/11/2026)

- Build APK và APK instrumentation đạt. 18/18 unit tests đạt (8 kiểm thử trạng thái AI, 10 kiểm thử API/phiên). Android Lint cuối: 0 lỗi, 10 cảnh báo. Logs: `.runtime/android-tools/ai-final-verification.log` và `ai-package.log`.
- Unit tests AI kiểm tra response cũ khi đổi laptop, phân tích POST thành công nhưng GET lỗi, không tự gửi lại POST chưa xác nhận, chat giữ draft khi lỗi và không gửi trùng, context đúng role/giới hạn 2.000 ký tự, đăng xuất chặn response đến muộn, refresh làm hết phiên và phân trang lịch sử. API tests kiểm tra endpoint, xác thực, device_id, period, limit/offset và JSON chat.
- Redmi K30: luồng `AiAdvisorFlowTest` đạt ở sáng/font 1.0 (`ai-device-light.log`, 16,218 giây) và bảng màu tối/font 1.3 (`ai-device-dark-large.log`, 16,984 giây). Luồng gồm đăng nhập, lịch sử, chạy phân tích, báo cáo ngày lỗi rồi thử lại, báo cáo tuần, đổi trẻ không giữ báo cáo cũ, chat lỗi giữ câu hỏi rồi gửi lại, cuộc trò chuyện mới và đăng xuất.
- Thiết bị dùng package riêng `vn.laptopchildren.parent.qa` và MockWebServer. Không dùng tài khoản thật, không gọi Gemini thật hoặc tạo phân tích trên backend thật. API thực tế đã được đối chiếu mã nguồn backend/dashboard; cấu hình, quota và phản hồi provider thật chưa được kiểm thử đầu cuối trong lượt này.
- Captures nằm ở `.impeccable/review/android/ai-light/` và `ai-dark-large/`, mỗi bộ có `phone-ai-analysis.png`, `phone-ai-history.png`, `phone-ai-summary.png`, `phone-ai-chat.png`. Dữ liệu đều ghi nhãn kiểm thử. Bản tối dùng override `LocalConfiguration.uiMode` chỉ trong instrumentation do MIUI khóa night mode; không suy ra đã kiểm tra chuyển theme hệ thống hoặc màu status bar. Font scale được khôi phục về 1.0.
- Documenter so sánh phần mới với hệ thống Material hiện có, xác nhận field 12dp và không cần sửa DESIGN.md/sidecar; DIRECTION.md ghi phạm vi extension. Các mục inventory cũ trong tài liệu vẫn mang tính lịch sử.
- Reviewer độc lập trả **ship** cho toàn bộ extension AI trên phạm vi tám capture điện thoại đã cung cấp và source đã lấy mẫu; không còn material fixes. Phạm vi này không bao gồm tablet, chuyển theme hệ thống hoặc status bar tối trong bản test override.
- Bản bàn giao là APK debug versionCode 3/versionName 0.3.0. Không thêm quyền quản trị vào app; không sửa backend/Agent hoặc đưa khóa AI vào APK. Lịch sử chat chỉ tồn tại trong RAM, tách khỏi phân tích theo laptop.

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

## Chu kỳ chụp và chụp ngay — 20/11/2026

- Bản 0.7.0 (versionCode 8): build debug, unit test và lint thành công.
- Redmi K30: `activityToolsShowResultsCaptureAndDeleteOnlySelectedDevice` đạt (15,238 giây) với MockWebServer trong package riêng `vn.laptopchildren.parent.qa.cadence`. Kiểm tra chu kỳ 0 không lưu được; lưu 12 phút; chụp ngay trong khi định kỳ tắt không gửi PUT bật lịch; polling ảnh mới và xóa đúng phạm vi. Đã xem ảnh chụp giao diện.
- Bộ kiểm thử ban đầu trên package `.qa` dừng vì đang có phiên đăng nhập; không xóa phiên đó. `-PisolatedQa=true -PqaInstance=cadence` tạo app thử độc lập. Quyền MIUI 10021 được trả về `default` sau kiểm thử.
- Backend: 151 unit/middleware đạt; Agent: 19 screenshot tests đạt; Web: 343 tests đạt, sau chỉnh hiển thị chu kỳ chạy lại 74 tests liên quan đều đạt.
- Chưa chạy tích hợp với DB/Redis và laptop thật: Redis test không hoạt động; tài khoản test không sở hữu schema. Migration V34 và Service/Companion mới chưa triển khai lên hệ thống thật; xem `../child-monitor-backend/SCREENSHOT_CADENCE.md`.
