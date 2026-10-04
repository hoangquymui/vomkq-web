---
trigger: always_on
description: "Bắt buộc lưu thông tin cần thiết để debug, tái hiện simulation/analysis và truy nguyên decision record."
---
# Debug & Observability Rules

Mỗi analysis/simulation run nên có:

```text
runId
scenarioId
scenarioVersion
campaignId
terrainVersion
objectSnapshotVersion
analysisType / simulationType
algorithmVersion
simulationVersion
configSnapshot
inputSummary
resultStatus
warnings
startedAt
completedAt
```

## Bug workflow
- Có reproduction case.
- Xác định layer lỗi.
- So sánh expected vs actual.
- Kiểm tra input/version/config.
- Viết regression test khi có thể.
- Ghi root cause.

## Comment cho hằng số
Luôn ghi ý nghĩa + unit + source/assumption + lý do.
