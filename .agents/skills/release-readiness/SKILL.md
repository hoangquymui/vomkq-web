---
name: release-readiness
description: Checks engineering and simulation readiness before a release.
---

# Release Readiness

1. Kiểm tra intended working tree.
2. Chạy typecheck/lint/unit/integration/e2e phù hợp.
3. Chạy golden scenarios.
4. Kiểm tra no silent stale results.
5. Kiểm tra 2D/3D/Inspector consistency.
6. Kiểm tra simulation repeatability/provenance.
7. Kiểm tra data-quality warnings.
8. Kiểm tra performance.
9. Ghi known limitations và versions.
10. Kết luận READY / READY WITH KNOWN ISSUES / NOT READY.

Không tự git push.
