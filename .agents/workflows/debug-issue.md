# Debug Issue

1. Thu reproduction case.
2. Đọc debug context/run metadata.
3. Xác định layer.
4. So sánh expected/actual state.
5. Nếu analysis/simulation, kiểm tra snapshot/version/config.
6. Nếu 2D/3D mismatch, truy shared domain state.
7. Viết regression test nếu khả thi.
8. Sửa root cause.
9. Trong lúc sửa: typecheck + focused tests; full tests và build chỉ khi sửa ổn định. Dừng sau hai vòng sửa không tiến triển cùng nguyên nhân; không biến test thành no-op hoặc tắt typecheck.
10. Ghi root cause + prevention, raw exit codes và changed-files scope. Không checkout/restore/reset/clean/stage/commit/push; bảo toàn file lạ và thay đổi chưa commit.
