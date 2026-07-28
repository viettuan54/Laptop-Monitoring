# Quy chuẩn nhãn dataset Edge AI

Phiên bản taxonomy hiện tại: `1.0.0`.

## 1. Tách khả năng quan sát và tư thế

`visibility_state` mô tả camera có đủ dữ liệu để đánh giá hay không:

- `visible`: thấy đủ tai, vai và các điểm cần thiết; được phép gán nhãn tư thế.
- `partially_visible`: thấy người nhưng thiếu hoặc che khuất landmark cần thiết.
- `not_visible`: không phát hiện được người phù hợp trong khung hình.

Khi `visibility_state` khác `visible`, `posture_labels` bắt buộc phải rỗng và
`posture_state` phải là `unknown`. Không dùng `body_not_visible` như một nhãn
tư thế.

## 2. Nhãn tư thế

`posture_labels` là danh sách đa nhãn, chỉ gồm:

- `forward_head`: đầu/cổ đưa hoặc gập về trước so với trục thân trong một tư
  thế được giữ ổn định. Không gán cho thao tác nhìn xuống ngắn hạn.
- `trunk_lean`: trục từ trung điểm hông đến trung điểm vai lệch rõ khỏi tư thế
  thân thẳng. Nhãn hiện tại không phân biệt trước, sau hoặc sang bên.
- `shoulder_tilt_left`: vai trái giải phẫu của người tham gia thấp hơn vai phải.
- `shoulder_tilt_right`: vai phải giải phẫu của người tham gia thấp hơn vai trái.
- `slouching`: nhãn dẫn xuất, chỉ xuất hiện khi cùng bản ghi có cả
  `forward_head` và `trunk_lean`.

Trái/phải luôn tính theo cơ thể người tham gia, không tính theo phía trái/phải
của người xem ảnh. Công cụ preview có lật gương cũng không được đổi ý nghĩa
landmark trái/phải.

Hai nhãn `shoulder_tilt_left` và `shoulder_tilt_right` loại trừ lẫn nhau.

## 3. Trạng thái tư thế dẫn xuất

Không lưu `good_posture` trong `posture_labels`.

- `posture_state = good`: `visibility_state = visible` và `posture_labels` rỗng.
- `posture_state = bad`: `visibility_state = visible` và có ít nhất một nhãn.
- `posture_state = unknown`: `visibility_state` khác `visible`.

`posture_state` có thể được tính lại từ hai trường còn lại và chỉ được lưu để
kiểm tra tính nhất quán.

## 4. Khoảng cách

`actual_distance_cm` là nhãn hồi quy, không phải nhãn gần/xa:

- Đo vuông góc từ mặt phẳng camera tới điểm giữa hai mắt.
- Chỉ nhập khi đã đo bằng thước; không ước lượng bằng quan sát.
- Dùng `null` nếu frame không thuộc phiên hiệu chỉnh khoảng cách.
- Giá trị hợp lệ cho bộ thu hiện tại là 20–200 cm.

Ngưỡng cảnh báo như 35 cm thuộc policy của Agent, không được ghi thành nhãn
`near` hoặc `far` trong dataset.

## 5. Quy trình gán nhãn

1. Xác định `visibility_state`.
2. Nếu không phải `visible`, để danh sách nhãn rỗng.
3. Nếu thấy đủ cơ thể, chọn từng lỗi quan sát được.
4. Công cụ phải tự thêm hoặc xóa `slouching` theo hai nhãn thành phần.
5. Công cụ tự tính `posture_state`.
6. Người gán nhãn đánh dấu `transition` cho đoạn chuyển động giữa hai tư thế.

Frame `transition=true` được giữ lại nhưng mặc định không dùng làm mẫu huấn
luyện nhãn tư thế tĩnh.
