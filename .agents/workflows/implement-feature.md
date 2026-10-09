# Implement Feature

1. Đọc North Star + applicable rules + feature plan.
2. Kiểm tra `git status` và không đụng unrelated changes.
3. Sửa domain contract trước.
4. Sửa application/state transition.
5. Sửa analysis/simulation engine nếu có.
6. Nối UI/2D/3D vào shared state/result.
7. Thêm incomplete/stale/error states.
8. Thêm tests/regression.
9. Local loop: typecheck + focused tests. Chỉ khi code ổn định mới chạy full suite + production build cuối; tránh build lặp không có lý do. Không vô hiệu hóa test hoặc gán PASS không có log.
10. Kiểm tra provenance + debug context.
11. Xuất review evidence theo `/evidence-package` (Git HEAD-aware; staged/unstaged/untracked), không dùng `/review-readiness` của simulation để nghiệm thu code.
12. Báo cáo files changed, tests, limitations, important parameters.

Không tự stage/commit/push; không checkout/restore/reset/clean hoặc xóa untracked để xử lý dirty tree.
