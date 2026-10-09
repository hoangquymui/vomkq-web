---
name: implement-feature
description: Implements a planned feature incrementally with tests and regression checks.
---

# Implement Feature

1. Đọc North Star + applicable rules + feature plan.
2. Kiểm tra `git status` và không đụng unrelated changes.
3. Sửa domain contract trước.
4. Sửa application/state transition.
5. Sửa analysis/simulation engine nếu có.
6. Nối UI/2D/3D vào shared state/result.
7. Thêm incomplete/stale/error states.
8. Thêm tests/regression.
9. Trong lúc sửa: focused tests + TypeScript; khi code ổn định: full suite + một production build cuối, trừ khi thay đổi sau đó đòi validation lại. Không lặp build khi chưa có thay đổi mang ý nghĩa.
10. Kiểm tra provenance + debug context.
11. Review diff.
12. Báo cáo files changed, tests, limitations, important parameters.

Không tự stage/commit/push, checkout/restore/reset/clean; không vô hiệu hóa test/typecheck để lấy PASS. Code review package dùng workflow `/evidence-package`, không dùng simulation `/review-readiness` thay thế.
