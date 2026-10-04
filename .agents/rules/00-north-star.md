---
trigger: always_on
description: "Giữ project bám North Star 2.0: model → scenario → simulate → assess → compare → human review → replay."
---
# North Star 2.0 — Project Guardrail

Mọi thay đổi code phải phục vụ vòng lặp:

```text
MODEL → SCENARIO → SIMULATE → ASSESS → COMPARE → REVIEW → REPLAY
```

## Bất biến
- Tách `PLANNED`, `OBSERVED`, `SIMULATED` state.
- Scenario là context trung tâm; SimulationRun là một lần chạy có provenance.
- 2D/3D/Inspector dùng cùng Domain Model và shared state.
- Analysis/simulation không nằm trong React/Cesium renderer.
- Result phải gắn scenario/version/config/input/model version.
- Thay đổi lớn không ghi đè lịch sử; tạo version/event mới.
- Không có “magic result”; luôn có assumptions, data quality, limitations.
- Human review là bước bắt buộc trước mọi decision record.
- Không tự động chuyển simulation result thành hành động sử dụng vũ khí thực tế.

## Khi nhận feature request
Trước khi code, xác định:
1. Feature phục vụ bước nào của decision loop?
2. Domain object/state nào bị ảnh hưởng?
3. Scenario/SimulationRun nào bị ảnh hưởng?
4. 2D/3D/Inspector cần đồng bộ gì?
5. Provenance/debug nào phải lưu?
6. Regression scenario nào cần cập nhật?

## Không được làm
- Business logic quan trọng trong UI/renderer.
- Hard-code tham số phân tích không có tên/đơn vị/nguồn/assumption.
- Phán “phương án tốt nhất” mà không cho xem bằng chứng/giới hạn.
- Xóa cảnh báo dữ liệu thiếu chỉ để demo đẹp hơn.
