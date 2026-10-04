---
name: project-audit
description: Audits the current project against the North Star before code changes.
---

# Project Audit

Mục tiêu: hiểu project hiện tại trước khi sửa.

1. Đọc `KE_HOACH_KIM_CHI_NAM_PHAN_MEM_MO_PHONG_PHONG_KHONG.md` và rules.
2. Scan repo: domain, stores, scenario, analysis, simulation, 2D, 3D, Inspector, tests, config.
3. Vẽ dependency: Domain → Application → Analysis/Simulation → Visualization.
4. Tìm nơi đang gộp PLAN/OBSERVED/SIMULATED.
5. Tìm thiếu provenance, versioning, debug metadata.
6. Tìm analysis/simulation logic nằm trong UI.
7. Tìm duplicate state giữa 2D/3D/Inspector.
8. Đánh giá Scenario Campaign / SimulationRun / Assessment / Review support: GOOD/RISK/MISSING.
9. Không sửa code trong audit.
10. Kết thúc bằng đúng một `NEXT RECOMMENDED STEP`.

Không commit/push.
