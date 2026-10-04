---
trigger: model_decision
description: "Áp dụng khi code thay đổi analysis, terrain, visibility, geometry, simulation, statistics hoặc comparison."
---
# Analysis & Simulation Integrity

Mọi run phải khai báo rõ:

```text
scenarioVersion
terrainVersion
objectSnapshotVersion
configSnapshot
algorithmVersion
simulationVersion
coordinateReference / units
```

## Outputs
Result phải phân biệt:
- `VALID`
- `PARTIAL`
- `INCOMPLETE`
- `INVALID`
- `ERROR`

Không biến thiếu dữ liệu thành `0`, `false`, geometry rỗng hoặc kết luận “không có vấn đề” mà không có reason.

## Reproducibility
Cùng snapshot + config + environment phải cho kết quả ổn định hoặc nêu rõ nondeterminism.

## Comparison
Chỉ gọi A/B “so sánh được” khi biết input nào giống và input nào khác.
