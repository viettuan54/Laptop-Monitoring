# Agent 1.0.28 — bật lại chặn website khi trình duyệt đang mở

## Cài trên máy của trẻ

1. Chạy `ChildMonitorSetup-1.0.28.exe` bằng quyền quản trị để cập nhật Agent.
2. Trong **Cốc Cốc của máy ảo**, mở trang quản lý tiện ích (menu → Tiện ích;
   thường là `coccoc://extensions`). Bật **Chế độ dành cho nhà phát triển**,
   chọn **Tải tiện ích đã giải nén / Load unpacked** và chọn thư mục:
   `C:\Program Files\ChildMonitorAgent\browser-extension`.
3. Kiểm tra ID tiện ích là `ekdafhciefhbphafelindkdobljpkcaf`.
   Ghim tiện ích SafeNest. Sau khi kết nối, tiêu đề biểu tượng phải là
   **SafeNest — chính sách đã áp dụng**, không có dấu `!`.
4. Làm tương tự trên từng trình duyệt/profile cần bảo vệ. Chrome dùng
   `chrome://extensions`, Edge dùng `edge://extensions`.
   Nếu cho phép trẻ dùng chế độ ẩn danh, bật quyền **Cho phép ở chế độ ẩn danh**
   trong chi tiết tiện ích của từng trình duyệt.

Không cần khởi động lại trình duyệt mỗi lần đổi chính sách. Tiện ích là phần
bắt buộc của cơ chế mới; chỉ cập nhật exe Agent thì vẫn chỉ có lớp chặn hosts.
Đây là bản triển khai cục bộ bằng Load unpacked, chưa phải tiện ích được phát hành
trên cửa hàng hoặc cài cưỡng chế. Người dùng có thể vô hiệu hóa/gỡ tiện ích;
chưa thể coi đây là cơ chế chống vượt chặn hoàn chỉnh.

## Kiểm thử đúng tình huống lỗi

1. Lưu chính sách Giải trí → Chặn. Mở `https://gamevui.vn`, kiểm tra bị chặn.
2. Lưu Giải trí → Cho phép, chờ Agent nhận chính sách rồi nhập lại URL để mở.
3. Giữ tab gamevui đang mở, lưu Giải trí → Chặn.
4. Với kết nối bình thường, sau heartbeat Agent (5 giây) và lần nhận của tiện ích
   (2 giây), tab gamevui phải chuyển sang thông báo **Website đang bị chặn**.
   Tab website được cho phép phải giữ nguyên, trình duyệt không bị đóng.
5. Lặp lại bước 2–4; thử F5, nút Back, tab mới và tên miền con.
6. Tắt phân loại web: quy tắc theo danh mục được gỡ; blacklist quản trị vẫn áp dụng.
7. Ngắt backend: chính sách đã lưu vẫn áp dụng. Dừng Agent: tiện ích giữ quy tắc
   gần nhất và hiển thị `!`; khởi động Agent lại thì phải tự kết nối.

Khi bỏ chặn, tiện ích không tự mở lại nội dung trước đó; nhập lại URL để truy cập.
Việc chặn domain mới vẫn phụ thuộc phân loại có sẵn hoặc dữ liệu lịch sử của Agent.

## Cơ chế và giới hạn

- Service trả snapshot chỉ đọc qua Named Pipe, xác minh tài khoản và phiên người
  dùng đang được giám sát. Không đưa Device Secret cho tiện ích.
- Native host chỉ cho phép ID tiện ích cố định; không mở HTTP port hay nhận lệnh shell.
- Tiện ích dùng Manifest V3 `declarativeNetRequest` để chặn yêu cầu theo domain
  và tên miền con, không phụ thuộc DNS/kết nối cũ. Tab đang mở được điều hướng
  sang trang thông báo, giải phóng phiên trang và nội dung cache đang hiển thị.
- Quy tắc được thay nguyên bộ theo thứ tự; lỗi cập nhật không được coi là bỏ chặn.
- Mất kết nối giữ chính sách gần nhất. Không mặc định chặn tất cả khi chưa từng
  nhận chính sách. Không khẳng định đã chặn từ nhãn trên dashboard.
- `hosts` vẫn là lớp dự phòng. Agent thử lại khi ghi thất bại và tuần tự hóa
  các lần ghi để luồng cũ không ghi đè chính sách mới.
- Dữ liệu đã tải trước khi chặn không thể bị thu hồi khỏi máy. Tab chỉ bị chuyển
  sau khi tiện ích nhận chính sách; không cam kết độ trễ nếu Agent mất mạng.
- Cần kiểm thử bản Cốc Cốc thực tế trên máy ảo. Nếu biểu tượng có `!`, xem lỗi
  service worker trong trang tiện ích và log Service; installer đăng ký native host
  cho Chrome, Chromium, Edge và CocCoc\Browser trong cả registry 32/64 bit.

## Build

Trong thư mục `child-monitor-agent`:

```powershell
.\build\build-agent.ps1 -Version 1.0.28 -SkipDependencyInstall
```

Installer tự đăng ký native host. Chỉ khi cần sửa đăng ký, chạy PowerShell quản trị:

```powershell
& 'C:\Program Files\ChildMonitorAgent\browser-host\SafeNestBrowserHost.exe' --register
```

Khi gỡ Agent, gỡ cả tiện ích trong trình duyệt; tiện ích cố ý giữ quy tắc gần nhất
khi Service ngừng nên gỡ Service đơn lẻ không tự gỡ quy tắc của tiện ích.
