---
trigger: always_on
description: "Bảo vệ ranh giới Domain/Application/Analysis/Simulation/Visualization và trạng thái dùng chung."
---
# Architecture Rules

```text
UI / Presentation
      ↓
Application / Orchestration
      ↓
Domain Model
      ↓
Analysis + Simulation
      ↓
Infrastructure / Data
```

## Domain
Chứa entity, value object, lifecycle, invariants và schema.

## Application
Điều phối scenario, plan, simulation run, assessment, review và state transitions.

## Analysis / Simulation
Độc lập với renderer. Nhận input snapshot rõ ràng, trả result có metadata.

## Presentation
React/Cesium chỉ render và phát command; không tính nghiệp vụ cốt lõi.

## Data
- Snapshot lịch sử phải bất biến về mặt ý nghĩa.
- ID ổn định, version rõ.
- Units/CRS/vertical reference rõ ràng.
- Không nhân đôi model chỉ cho 2D/3D.

## Simulation-specific
- Simulation world state ≠ render state.
- SimulationRun phải tồn tại độc lập với camera/UI.
- Event/timeline phải có thể replay nếu workflow yêu cầu.
