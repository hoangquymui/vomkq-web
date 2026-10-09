---
name: analysis-validation
description: >-
  Validates analysis and simulation integrity, provenance, edge cases and
  repeatability.
---

# Analysis / Simulation Validation

1. Xác định contract và units/CRS.
2. Xác định assumptions.
3. Tạo fixture deterministic nhỏ.
4. Test normal/boundary/missing/invalid/degraded.
5. Kiểm tra result metadata/provenance.
6. Kiểm tra renderer không thay đổi result.
7. Nếu là simulation, kiểm tra repeatability hoặc ghi rõ nondeterminism.
8. Thêm golden scenario.
9. So sánh baseline/new result.
10. Ghi known limitations.
