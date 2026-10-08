---
description: "Audit kiến trúc và trạng thái dự án trước thay đổi, đối chiếu North Star."
---

# Project Audit

Mục tiêu: hiểu project hiện tại trước khi sửa.

1. Đọc `docs/NORTH_STAR/NORTH_STAR.md` và rules.
2. Scan repo: domain, stores, scenario, analysis, simulation, 2D, 3D, Inspector, tests, config.
3. Vẽ dependency: Domain → Application → Analysis/Simulation → Visualization.
4. Tìm nơi đang gộp PLAN/OBSERVED/SIMULATED.
5. Tìm thiếu provenance, versioning, debug metadata.
6. Tìm analysis/simulation logic nằm trong UI.
7. Tìm duplicate state giữa 2D/3D/Inspector.
8. Đánh giá Scenario Campaign / SimulationRun / Assessment / Review support: GOOD/RISK/MISSING.
9. Không sửa code trong audit.
10. Kết thúc bằng đúng một `NEXT RECOMMENDED STEP`.

## Rules for PRE-AUDIT
- PRE-AUDIT is read-only for application code.
- Inspect existing documentation before proposing changes.
- Report missing documents rather than inventing content.
- Distinguish observed evidence from assumptions.
- Identify canonical authority, ownership and provenance.
- Include Git status, relevant tests and affected files.
- Recommend one next checkpoint or next action.
- Do not automatically implement, stage, commit or push.

Không commit/push.
