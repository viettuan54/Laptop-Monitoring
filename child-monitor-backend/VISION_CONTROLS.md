# Bật riêng tư thế và khoảng cách mắt

Trang **Điều khiển thiết bị** trên web có hai lựa chọn độc lập:

- `enable_posture_monitoring`: phát hiện và cảnh báo tư thế.
- `enable_eye_distance_monitoring`: ước lượng và cảnh báo khoảng cách mắt.

Backend trả hai trường qua API settings và cấu hình Agent. Camera hoạt động khi
ít nhất một chức năng bật; Companion chỉ chạy phân tích của chức năng đang bật.
Tắt cả hai sẽ đóng camera khi Agent nhận được cấu hình mới. Backend cũng từ chối
cảnh báo của từng chức năng đã tắt.

## Cập nhật bản đang chạy

1. Chạy migration trước khi khởi động backend mới:
   `node scripts/migrate-vision-controls.js` trong thư mục `child-monitor-backend`.
   Dùng `--test` nếu cập nhật database thử nghiệm.
2. Cập nhật backend, web và bản Agent có thay đổi trong `pipe_server.py` và
   `edge_vision.py`. Agent đóng gói cũ cần được build/cài lại để hỗ trợ bật riêng;
   chỉ cập nhật web không thay đổi hành vi của Agent cũ.
3. Kiểm tra bốn tổ hợp trên máy con: chỉ tư thế, chỉ khoảng cách, cả hai, tắt cả hai.
   Chờ Agent đồng bộ trước khi xác nhận. Cần kiểm tra webcam và cảnh báo thực tế.

Migration V30 giữ nguyên sự đồng ý trước đó: công tắc chung bật thì hai lựa chọn
mới đều bật; công tắc chung tắt thì cả hai đều tắt. Chạy lại migration không ghi
đè các lựa chọn riêng đã lưu.

`enable_webcam_monitoring` được giữ để tương thích ứng dụng cũ và bằng OR của
hai lựa chọn. Gửi trường cũ qua API sẽ đặt cả hai chức năng cùng trạng thái;
trường riêng được gửi cùng yêu cầu sẽ được ưu tiên. Web mới chỉ gửi hai trường
riêng. Android mới cũng gửi từng trường riêng; công tắc chung trên bản Android
cũ vẫn điều khiển đồng thời cả hai.

## Kiểm thử

- Web: `node --test test/*.test.js` trong `child-monitor-web`.
- Backend: `node --test test/visionConsent.unit.test.js test/visionControls.integration.test.js test/agentPolicy.unit.test.js`.
- Integration test chỉ dùng `TEST_DB_*` và các bảng tạm trong phiên PostgreSQL;
  không cập nhật cấu hình phụ huynh hoặc schema đang chạy.
- Agent: các test `test_edge_vision.py` và `test_pipe_lifecycle.py` trong `child-monitor-agent/tests`.
