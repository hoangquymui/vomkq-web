---
description: "Lập kế hoạch feature theo North Star, domain contracts, provenance và regression."
---

# Feature Plan

1. Viết user outcome.
2. Chỉ rõ feature nằm ở bước nào: Model / Scenario / Simulate / Assess / Compare / Review / Replay.
3. Xác định domain/state/lifecycle.
4. Xác định input/output/provenance.
5. Xác định affected layers/files.
6. Xác định scenario/regression impact.
7. Xác định 2D/3D/Inspector impact.
8. Xác định debug parameters.
9. Xác định stale/error/incomplete handling.
10. Tạo Definition of Done.
11. Chỉ sau đó mới implementation.

Nếu feature là simulation/what-if: ghi rõ baseline, variables changed và variables held constant.

## Definition of Done / Repository Hygiene Gate

- Scope and allowed files are identified.
- Relevant tests and build checks are defined.
- Untracked new files are included in review evidence.
- Final staged changes must be explicitly reviewed.
- git diff --cached --check must pass before commit.
- Temporary logs/scripts should be outside the repo.
- Cleanup is limited to verified agent-owned files.
- Unknown artifacts remain untouched.
- No implicit git add ., git clean -fd, commit or push.
- Commit requires explicit human authorization.
