---
trigger: always_on
description: "Giữ project bám North Star: model → scenario → simulate → assess → compare → human review → replay."
---

## Documentation Authority

Documentation priority:

1. docs/NORTH_STAR/NORTH_STAR.md
2. Existing architecture documentation, if present
3. Current approved feature specifications
4. Validation and test documents
5. Research and reference documents
6. Historical and legacy documents

Never treat legacy or historical documents as authoritative
when they conflict with the North Star or current architecture.

## Mandatory Invariants

- Model before render.
- Simulate before conclude.
- Human before action.
- Canonical domain registries are authoritative.
- Sau Checkpoint 1K, `instances[]` không phải trường state lưu trữ: chỉ được tạo projection tương thích `EquipmentInstance` qua `selectActiveEquipment(state)`. Nếu 1K chưa commit/verify, không tự giả định cutover hoàn tất.
- PLANNED, OBSERVED and SIMULATED state are distinct.
- Scenario, Plan and SimulationRun must have explicit ownership and provenance.
- Significant canonical changes require validation, revision and audit according to their applicable scope.
- Historical observations/simulations must not be silently removed merely because a Placement is deleted.
- Domain/analysis logic must not be placed in UI, Cesium or renderer components.
- Important results must disclose their inputs, assumptions, data quality and limitations.
- No autonomous operational decision or weapon control.
- Human review precedes any Decision Record.
- AI agents do not stage, commit or push without explicit human authorization.
