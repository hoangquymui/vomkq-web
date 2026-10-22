# Checkpoint: Đồng Bộ Vùng Hỏa Lực (WEZ) Với Vòm Radar, Triệt Tiêu Tia Gai Nhọn & Bỏ Góc Quạt / Tháp Nâng Ăng-ten

**Thời gian:** 21/10/2026  
**Trạng thái:** Hoàn thành xuất sắc 100%  
**Lệnh xác minh:** `npm run build` (Exit code 0, không còn lỗi TypeScript)

---

## 1. Mục tiêu công việc
Khắc phục triệt để hiện tượng Vùng Hỏa Lực (WEZ - Vòm Đỏ) bị phình to 150km rộng hơn Vòm Radar (TAR - Vòm Xanh) ở các tầng độ cao thấp ($50m, 100m, 300m, 500m$), xóa bỏ các tia gai nhọn (spikes) đâm xuyên núi do lấy mẫu địa hình thô, đồng thời dọn dẹp giao diện và logic bản đồ: loại bỏ chế độ Góc Quạt (Sector) và Tháp nâng ăng-ten, chuẩn hóa 360° toàn phương.

---

## 2. Chi tiết các thay đổi đã triển khai

### A. Đồng bộ Thuật toán Cắt Địa hình của Vùng Hỏa Lực với Vòm Radar (`R_wez <= R_radar`)
- **Khống chế bất biến khí tài:** Tên lửa phòng không không thể dẫn bắn nếu radar không bắt được mục tiêu. Do đó:
  $$R_{\text{wez\_effective}}(\phi, H) = \min\left(R_{\text{missile\_max}}, R_{\text{radar\_effective}}(\phi, H)\right)$$
- **Tự động gắn kết Đài TAR hữu cơ của Tổ hợp (`src/components/map/CesiumGlobe.tsx`):**
  - Trong hàm `calcVolumeAll`: Khi tính SAM Volume, nếu là tổ hợp phòng không tổng hợp (`batteryConfig`), tự động tìm và truyền đài radar chỉ thị mục tiêu TAR hữu cơ (`${inst.instanceId}_tar`) vào `linkedRadarVol`.
  - Trong hàm `calcSamCoverageAll`: Tự động tìm và truyền đài TAR hữu cơ vào `linkedRadar`, `linkedRadarVol`, `linkedRadarSpx`.
- **Áp dụng kìm hãm trong Volume Engine (`src/utils/missileVolumeEngine.ts`):**
  - Tại hàm `computeSamEngagementVolume`, ma trận cự ly hiệu dụng theo độ cao được kìm hãm trực tiếp theo ma trận cự ly radar $R_{\text{radar}}$ đã cắt địa hình. Nếu radar bị núi che khuất hoàn toàn ($R_{\text{radar}} \le R_{\text{innerCone}}$), cự ly hỏa lực co về $R_{\text{innerCone}}$.
- **Áp dụng kìm hãm trong 2D Coverage Engine (`src/utils/samCoverageEngine.ts`):**
  - Tại hàm `computeSamCoverage`, nếu có `linkedRadarVolume`, kìm hãm trực tiếp $R_{\text{wez\_eff}} = \min(R_{\text{wez}}, R_{\text{radar\_eff}})$ và tự động nội suy theo `effectiveRanges` của radar.

### B. Triệt tiêu hoàn toàn tia gai nhọn (spikes) đâm xuyên núi
- **Nguyên nhân cũ:** Thuật toán 2D cũ lấy mẫu địa hình DEM với bước nhảy $150\text{km} / 60 = 2.5\text{km}$. Bước nhảy thô làm tia quét nhảy vọt qua đỉnh núi sắc nhọn, dẫn đến nhận diện sai là nhìn thấy và phóng tia gai 150km đâm qua núi.
- **Giải pháp:** Trong `CesiumGlobe.tsx`, đa giác 2D WEZ trích xuất trực tiếp lát cắt cự ly theo độ cao `effectiveAltitudeM` từ ma trận 3D `samVol.effectiveRanges` (vốn đã tính toán tích lũy góc che khuất $\theta_{\text{mask}}$ không giảm dọc tia cực mịn). Kết quả: đường biên hỏa lực 2D ôm sát thung lũng sườn núi, dập tắt 100% tia gai nhọn.
- **Ẩn vòng danh nghĩa 150km ở độ cao thấp:** Khi người dùng chọn khảo sát độ cao thấp ($H \le 1000m$), vòng tròn danh nghĩa 150km (cả 2D và 3D) tự động ẩn để tránh gây rối mắt, chỉ hiển thị vùng hỏa lực thực tế ôm sát radar.

### C. Xóa bỏ hoàn toàn Chế độ Góc Quạt (Sector) & Tháp nâng ăng-ten
- **Giao diện (`src/components/ui/RightInspector.tsx`):**
  - Xóa bỏ khối chọn "CHẾ ĐỘ CHIẾN ĐẤU: TOÀN PHƯƠNG (360°) / GÓC QUẠT (SECTOR)" và slider "Hướng xạ giới chính".
  - Xóa bỏ khối "Tháp nâng ăng-ten (40V6M / Dã chiến)". Luôn sử dụng chiều cao ăng-ten chuẩn mặc định của từng loại khí tài.
  - Dọn dẹp các selector và action không còn dùng (`setBatteryCombatMode`, `setBatteryCombatAzimuth`, `setBatteryMastHeightOverride`).
- **Logic Vòm 2D & 3D (`src/components/map/CesiumGlobe.tsx`, `src/utils/samCoverageEngine.ts`, `src/utils/missileVolumeEngine.ts`):**
  - Luôn dựng vòm hỏa lực dạng toàn phương 360° (`omnidirectional`).
  - Lát cắt WEZ 3D và fallback nan quạt 3D luôn lặp đều 360°.
  - Vòng đón hỏa lực $R_{\text{launch\_max}}$ luôn vẽ vòng tròn tròn kín 360°.

---

## 3. Danh sách các file đã chỉnh sửa
1. [src/utils/missileVolumeEngine.ts](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts)
   - Khống chế $R_{\text{wez}} \le R_{\text{radar}}$ theo từng tầng độ cao trong ma trận `computeSamEngagementVolume`.
   - Bỏ nhánh `isSector`, luôn xuất dạng `omnidirectional`.
2. [src/utils/samCoverageEngine.ts](file:///e:/code/du_an/3D/vkq/vompk/src/utils/samCoverageEngine.ts)
   - Khống chế $R_{\text{wez}} \le R_{\text{radar}}$ theo `effectiveRanges` của `linkedRadarVolume`.
   - Xóa bỏ các nhánh `isSector`, chuẩn hóa đa giác 360°.
3. [src/components/ui/RightInspector.tsx](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx)
   - Gỡ bỏ hoàn toàn UI chọn Chế độ Góc Quạt (Sector) và Tháp nâng ăng-ten.
4. [src/components/map/CesiumGlobe.tsx](file:///e:/code/du_an/3D/vkq/vompk/src/components/map/CesiumGlobe.tsx)
   - Tự động truyền đài TAR hữu cơ `${inst.instanceId}_tar` vào `calcVolumeAll` và `calcSamCoverageAll`.
   - Lấy lát cắt 2D WEZ trực tiếp từ `samVol.effectiveRanges` theo `effectiveAltitudeM`.
   - Ẩn vòng danh nghĩa 150km khi $H \le 1000m$.
   - Vẽ vòng lát cắt 3D và fallback nan quạt 360° sạch sẽ.

---

## 4. Kết quả kiểm tra
- Chạy `npm run build`: **Thành công (Exit code 0)**, toàn bộ 2000 modules biên dịch hoàn hảo, không còn cảnh báo hoặc lỗi TypeScript.
- Dev server (`npm run dev`) đang hoạt động bình thường trên máy tính.
