# Kiểm tra API phân loại văn bản ngày 2026-10-04

Đã bổ sung thư viện service vào `ai-training/.venv` và chạy lại các test.
Ba test API trước đây bị bỏ qua đều đạt; toàn bộ 131 test trong `tests/`
đều chạy và đạt, không còn test bị bỏ qua trong lượt này.

| Test | Nội dung |
| --- | --- |
| `test_health_and_batch_use_three_labels` | `/health` và `POST /v1/moderate` trả đúng hợp đồng ba nhãn, điểm dự đoán và trạng thái chưa duyệt triển khai. |
| `test_auth_and_validation_do_not_echo_text` | Kiểm tra khóa API, dữ liệu không hợp lệ và việc lỗi không trả lại nội dung riêng tư. |
| `test_unapproved_artifact_cannot_start_in_production` | Từ chối cấu hình production khi artifact chưa được duyệt. |

Các test dùng `TestClient` trong tiến trình và model tạm từ ba câu tổng hợp.
Chúng kiểm tra hợp đồng HTTP/cấu hình service; không chứng minh độ chính xác
của model và không phải kiểm thử toàn luồng Agent đến trang phụ huynh.

Thư viện thực tế đã cài: FastAPI `0.142.2`, Starlette `1.7.0`, Pydantic
`2.13.5`, HTTPX2 `2.13.1`, Uvicorn `0.54.0`, cùng các phụ thuộc của chúng.
Giữ nguyên `text_safety/requirements.txt`: mục `httpx2` là phù hợp với
[TestClient của Starlette mới](https://starlette.dev/testclient/).
Nhận định trước rằng phải đổi mục này thành `httpx` đã được kiểm tra lại
và sửa; tài liệu FastAPI về testing chưa phản ánh đầy đủ thay đổi đó.

Tái lập từ `ai-training`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\text_safety\requirements.txt
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_text_safety_api.py -v
.\.venv\Scripts\python.exe -B -m unittest discover -s tests
```

Các báo cáo model ghi ba test bị bỏ qua vẫn phản ánh kết quả lịch sử tại
thời điểm chạy chúng. Bản ghi này cập nhật tình trạng sau khi bổ sung thư viện.
Không thay model mặc định hoặc trạng thái cho phép triển khai.
