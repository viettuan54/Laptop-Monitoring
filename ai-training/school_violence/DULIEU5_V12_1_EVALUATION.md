# Kết quả v12.1 trên Dulieu5 sau chốt sáu nhãn

**Cập nhật:** đã dùng phân tích lỗi này để thiết kế
[v13](V13_QUERY_CANDIDATE_STATUS.md). Điểm v13 trên Dulieu5 là so sánh phát
triển, không phải kiểm thử độc lập mới. Kết quả v12.1 bên dưới giữ nguyên.

Ngày 2026-10-06. Đã đổi đúng sáu nhãn theo xác nhận của người dùng **trước
dự đoán**, rồi chấm đủ 90 câu bằng v12.1 đã khóa. Kết quả: **75/90 đúng
(83,33%)**, macro-F1 **0,83405**. Nhận đúng HIGH_RISK **26/26**, nhưng còn
4 SAFE bị cảnh báo, 9 RISK bị nâng HIGH_RISK và 2 RISK bị trả SAFE.
**Chưa đạt các mốc kỹ thuật đặt trước**, chưa thay model mặc định v5.

## Dữ liệu, lịch sử nhãn và phạm vi kết luận

- Nguồn: `Mô tả/Dulieu5.csv`, giữ nguyên ba cột `id,text,label` và đủ 90 câu.
- ID 43: RISK → HIGH_RISK. ID 66, 71, 74, 77, 84: HIGH_RISK → RISK.
- Sau sửa: SAFE 30, RISK 34, HIGH_RISK 26. Chỉ sáu ô nhãn thay đổi;
  nguyên văn câu, ID, thứ tự, 84 nhãn khác và định dạng file giữ nguyên.
- SHA-256 trước sửa:
  `0569b01184d31ba2b776ac44e951f95c55d0cbf80a2070da98819771c1c7fc53`.
- SHA-256 sau sửa:
  `0d292e9ad186f9af9a7d8bcfa3670475989df2865f550eea57c63ff1e46e7be5`.
- Model: `vi-school-violence-financial-context-v12-1-query-candidate`.
- SHA-256 model:
  `cfc5f953afdaf8bce621ee0ba2f8d6da57b45467449e774464b0a434ef1dc8cb`.

Người dùng xác nhận **đổi sáu nhãn**; câu trả lời chưa xác nhận riêng nguồn
thực tế/tự soạn, ẩn danh và quyền sử dụng của Dulieu5. Có yêu cầu đánh giá
cục bộ trong cuộc trao đổi, nên chấm với `origin=unspecified` và
`metadata_confirmed=false`. Không tự suy lời xác nhận nguồn từ việc đồng ý
sửa nhãn hoặc từ xác nhận dành cho các bộ cũ.

Không thấy trùng chính xác/gần trùng với 2.308 bản ghi tham chiếu hoặc
trong 90 câu mới, theo ngưỡng giống ký tự 0,85. Kiểm tra bao gồm toàn bộ
364 câu đã xem ở bốn CSV trước cùng các split của artifact. Điều này
không xác minh độc lập về nghĩa hoặc theo trẻ/phiên. Lượt chấm này là
**đánh giá trên bộ mới do người dùng cung cấp, nguồn chưa xác nhận**;
`independent_real_world_evaluation_completed=false`, chưa chạy nhánh
đánh giá chính thức dành cho holdout thực tế có đủ khai báo nguồn.

## Ma trận nhầm lẫn

Hàng là nhãn người cung cấp đã chốt, cột là dự đoán model:

| Nhãn chuẩn / Dự đoán | SAFE | RISK | HIGH_RISK | Tổng |
| --- | ---: | ---: | ---: | ---: |
| SAFE | 26 | 1 | 3 | 30 |
| RISK | 2 | 23 | 9 | 34 |
| HIGH_RISK | 0 | 0 | 26 | 26 |
| Tổng | 28 | 24 | 38 | 90 |

| Nhãn | Precision | Recall | F1 |
| --- | ---: | ---: | ---: |
| SAFE | 92,86% | 86,67% | 0,89655 |
| RISK | 95,83% | 67,65% | 0,79310 |
| HIGH_RISK | 68,42% | 100,00% | 0,81250 |

Nhận đủ 26 câu HIGH_RISK không có nghĩa cảnh báo mức cao đều đúng: model
trả HIGH_RISK cho 38 câu, trong đó 12 câu sai (3 SAFE và 9 RISK).
Các tỷ lệ này chỉ mô tả Dulieu5, không ước lượng tần suất cảnh báo thật.

## So với mốc đặt trước dự đoán

[Kế hoạch](DULIEU5_V12_1_EVALUATION_PLAN.md) được giữ nguyên; bản snapshot
có SHA-256 `44b1249638f4086de2a1af56bba08f9956d6a205d5e2dc5409ea5fd7d64a2671`.

| Chỉ số | Kết quả | Mốc | Đạt |
| --- | ---: | ---: | --- |
| HIGH_RISK → SAFE | 0/26 | 0 câu | Có |
| Recall HIGH_RISK | 26/26 = 100% | >= 95% | Có |
| SAFE bị cảnh báo | 4/30 = 13,33% | <= 10% | Không |
| RISK → HIGH_RISK | 9/34 = 26,47% | <= 15% | Không |
| RISK → SAFE | 2/34 = 5,88% | <= 10% | Có |
| Macro-F1 | 0,83405 | >= 0,85 | Không |

Chỉ đạt 3/6 mốc. Đây là mốc kỹ thuật được đặt trước, chưa phải ngưỡng
phát hành được người dùng phê duyệt. Không giảm mốc sau khi nhìn điểm.

Khoảng Wilson 95% theo câu: recall HIGH_RISK **87,13–100%**;
SAFE bị cảnh báo **5,31–29,68%**; RISK → HIGH_RISK **14,60–43,12%**;
RISK → SAFE **1,63–19,09%**. HIGH_RISK → SAFE và HIGH_RISK → RISK đều
0/26, khoảng **0–12,87%** cho từng tỷ lệ. Các khoảng giả định câu độc lập;
độc lập theo trẻ/phiên chưa được xác minh. Vì mẫu nhỏ, kết quả 26/26
không bảo đảm model sẽ không bỏ sót nguy hiểm khi sử dụng thật.

## Toàn bộ 15 lỗi

| Nhãn chuẩn → Dự đoán | ID | Số câu |
| --- | --- | ---: |
| SAFE → RISK | 3 | 1 |
| SAFE → HIGH_RISK | 12, 21, 30 | 3 |
| RISK → SAFE | 32, 58 | 2 |
| RISK → HIGH_RISK | 34, 38, 41, 52, 57, 66, 74, 77, 84 | 9 |

Trong sáu ID vừa chốt, ID 43 và 71 được nhận đúng; ID 66, 74, 77, 84 vẫn
bị nâng HIGH_RISK. Đây là lỗi model ở vai trò chứng kiến theo hướng dẫn
đã chốt, không phải lý do đổi nhãn trở lại. Giữ toàn bộ lỗi trong báo cáo.

## Kiểm chứng và bước tiếp theo

CLI và engine service khớp nhãn/điểm trên cả 90 câu; điểm hữu hạn và tổng
bằng 1. Đã đối chiếu lại ma trận từ danh sách dự đoán và nhãn nguồn.
10 test hiện có của evaluator và runtime v12.1 đạt bằng `unittest`, không
bỏ qua test. Lệnh thử bằng `pytest` ban đầu thiếu runner; dùng đúng runner
`unittest` của các test hiện có, không cài thêm thư viện.

Snapshot trước/sau sửa, quyết định sáu nhãn, kế hoạch, nguồn lúc chấm và
toàn bộ kết quả được lưu cục bộ. Kiểm tra checksum sau chấm xác nhận nguồn,
model v12.1, khóa, archive tham chiếu và model mặc định v5 giữ nguyên.
Không huấn luyện lại, chọn ngưỡng, loại câu hoặc đổi nhãn sau dự đoán.
Không chạy lại toàn bộ luồng Agent/backend trong lượt đánh giá dữ liệu này.

Ưu tiên sửa tiếp là phân biệt vai trò chứng kiến ở bốn ID nêu trên,
giảm cảnh báo trên các câu SAFE và rà hai RISK bị mất cảnh báo. Chưa tạo
v13 hoặc sửa trọng số trong lượt này. Nếu dùng Dulieu5 để phát triển bản
sửa, phải ghi rõ bộ này đã được xem và không gọi điểm của bản sửa trên
chính bộ này là kiểm thử độc lập. Giữ `deployment_eligible=false`.

Artifact cục bộ:
`ai-training/artifacts/school_violence/dulieu5_v12_1_evaluation_20261006/`:

- `confirmed_label_changes.json`: xác nhận, sáu thay đổi và checksum.
- `source_before_label_review.csv`, `source_after_label_review.csv`: hai bản nguồn.
- `scoring/evaluation_report.json`: toàn bộ dự đoán/điểm theo ID.
- `diagnostic_assessment.json`: đối chiếu mốc và khoảng Wilson.
- `evaluation_plan_snapshot.md`: tiêu chí trước dự đoán.

SHA-256 báo cáo chấm:
`bc815e28713e2da7db3f3c1b7b6def4c2c39e8b7c4f77842c8b58a45ba4b4432`.
