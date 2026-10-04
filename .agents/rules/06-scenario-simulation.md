---
trigger: always_on
description: "Quy tắc cho Scenario, SimulationRun, what-if, alternative và replay."
---
# Scenario & Simulation Rules

## Scenario
Scenario phải có version/snapshot rõ ràng.

## Campaign
Cho phép nhiều alternatives từ cùng baseline. Ghi rõ `what changed`, `why`, `held constant`, `intentionally varied`.

## SimulationRun
Mỗi run phải lưu scenarioVersion + configSnapshot + simulationVersion + result status.

## World vs Render
Simulation state không được phụ thuộc vào Cesium camera/entity state.

## Replay
Nếu tính năng yêu cầu replay, lưu event/state snapshots đủ để tái hiện.

## Fair comparison
Cảnh báo khi dataset/model/config khác khiến so sánh không công bằng.
