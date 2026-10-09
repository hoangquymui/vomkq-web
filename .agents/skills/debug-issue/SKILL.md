---
name: debug-issue
description: Investigates bugs across domain, state, analysis, simulation and visualization layers.
---

# Debug Issue

1. Thu reproduction case.
2. Đọc debug context/run metadata.
3. Xác định layer.
4. So sánh expected/actual state.
5. Nếu analysis/simulation, kiểm tra snapshot/version/config.
6. Nếu 2D/3D mismatch, truy shared domain state.
7. Viết regression test nếu khả thi.
8. Sửa root cause.
9. Chạy focused tests + TypeScript trong vòng sửa; full suite + production build một lần khi bản sửa đã ổn định. Nếu 2 lần sửa liên tiếp không tiến triển cùng root cause: STOP, ghi blocker; không loop build.
10. Ghi root cause + prevention. Không xóa/skip/return test, không `@ts-nocheck` toàn file để lấy green, không chạy lệnh Git phá hủy changes, không tự stage/commit/push.
