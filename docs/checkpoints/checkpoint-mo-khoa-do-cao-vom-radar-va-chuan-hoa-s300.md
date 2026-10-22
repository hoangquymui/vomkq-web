# Checkpoint: Mở Khóa Tương Tác Độ Cao Vòm Radar Hữu Cơ & Chuẩn Hóa Vùng Hỏa Lực S-300PMU1

- **Ngày thực hiện**: 20/10/2026
- **Trạng thái**: ✅ Hoàn thành xuất sắc, biên dịch `npm run build` thành công (exit code 0).

---

## 1. Mục tiêu & Vấn đề xử lý

1. **Khắc phục vòm radar bị khóa cứng khi đổi độ cao:**
   - Trước đó, khi người dùng bấm chọn các mốc độ cao trong Bảng tính năng tham số radar trinh sát (TAR) của tổ hợp tên lửa (100m, 500m, 1000m, 5000m, 10000m...), vòm 3D trên bản đồ đứng im không phản ứng vì mã nguồn render gọi hàm `buildRadarDomeGeometry` tĩnh trần 30km cố định và không truyền tham số `selectedAltitudeM`.
   - Vòng lặp tính toán SPx và SAM coverage không đồng bộ đầy đủ dependency độ cao mục tiêu dẫn đến độ phủ không được re-calculate khi đổi mốc độ cao.

2. **Làm rõ và chuẩn hóa tính năng khí tài S-300PMU1 (Giải quyết thắc mắc cự ly hỏa lực):**
   - **Đài trinh sát 96L6E (TAR đi kèm S-300):** Cự ly phát hiện trinh sát cực đại lên đến **300 km** (hiển thị bằng Vòng/Vòm xanh dương).
   - **Vùng hỏa lực tiêu diệt WEZ (Đạn 48N6E):** Cự ly tiêu diệt cực đại thiết kế là **150 km** đối với mục tiêu khí động (máy bay, tên lửa bay hành trình cao) và **40 km** đối với mục tiêu đạn đạo cơ động. $R_{launch\_max} = 180 km$.
   - **Hiện tượng "vùng hỏa lực ngắn" ở độ cao thấp:** Khi bay ở độ cao thấp ($H_{tgt} \le 500m$), do giới hạn cong của Trái Đất và địa hình che khuất theo công thức $D_{LOS} \approx 4.12 \times (\sqrt{h_{ant}} + \sqrt{H_{tgt}})$, cự ly phát hiện và dẫn bắn bị ép xuống còn khoảng 38-45km. Vì vòm trước đó bị khóa cứng không phản ứng khi chọn mốc 5.000m hay 10.000m nên người dùng thấy vùng hỏa lực bị kẹt ở cự ly thấp. Khi mở khóa độ cao, chọn $H \ge 5.000m$ thì vùng hỏa lực bung trọn 150km.

---

## 2. Các thay đổi đã thực hiện

### 1. `src/utils/missileVolumeEngine.ts`
- Cập nhật hàm `buildSamLayerGeometry`:
  - Thêm tham số `selectedAltitudeM?: number | null` vào options.
  - Cắt lát đỉnh phẳng (Flat top slicing) tại độ cao khảo sát `maxAlt = selectedAltitudeM`, chỉ dựng các band $\le maxAlt$ và nội suy vành đỉnh chính xác tại $maxAlt$.
  - Đóng nắp đỉnh bằng `addCap(..., isTop = true)` để vòm 3D WEZ cắt ngang trực quan, sắc nét như vòm radar trinh sát.

### 2. `src/components/map/CesiumGlobe.tsx`
- **Tính toán bao phủ 2D/3D phản hồi tức thì (`calcSpxAll` & `calcSamCoverageAll`):**
  - Gắn `targetAltitudeM: effectiveTargetAlt` trực tiếp vào `spxRadarCoverage.ts` cho các đài radar trinh sát hữu cơ TAR (`${inst.instanceId}_tar`).
  - Thêm `selectedAltitudeM` và `targetHeightMeters` vào dependency array của `useMemo` tính toán SPx và SAM coverage, giúp hệ thống tự động tái tính toán ma trận ngay khi click chọn tầng độ cao.
- **Render Vòm 3D TAR:**
  - Chuyển sang sử dụng `buildRadarVolumeGeometry(tarVol, { mode: dome3DMode, showInnerCone: showConeOfSilence, selectedAltitudeM: effectiveAltitudeM })` khi đã có ma trận `tarVol`.
  - Bổ sung **Altitude Slice Ring** (Vòng lát cắt độ cao màu xanh dương có hiệu ứng phát sáng mờ polyline glow) tại đúng độ cao $safeAlt + effectiveAltitudeM$.
- **Render Vòm 3D WEZ:**
  - Truyền `selectedAltitudeM: effectiveAltitudeM` vào `buildSamLayerGeometry`.
  - Bổ sung **WEZ Altitude Slice Ring** (Vòng lát cắt độ cao hỏa lực màu đỏ/cam) tại cao độ mục tiêu.
- **Render 2D WEZ:**
  - Bổ sung thêm Vòng danh nghĩa hỏa lực tối đa lý thuyết (150km đối với S-300PMU1) dạng viền mờ (faint outline) để người chỉ huy luôn quan sát được đường biên trần lý thuyết của khí tài ngay cả khi đang khảo sát mục tiêu bay thấp.

### 3. `src/components/ui/RightInspector.tsx`
- **Nâng cấp bảng chọn Profile mục tiêu SAM:**
  - Tự động đọc danh mục `samProfiles` từ cấu hình tổ hợp: hỗ trợ chuyển đổi giữa **Bắn đón khí động (150km)**, **Đánh chặn đạn đạo (40km)**, **Bắn đuổi**, **Nhiễu**, **Quang học TBK**.
  - Bổ sung chú thích tính năng kỹ chiến thuật chuẩn mực của tổ hợp S-300PMU1 (Đài 96L6E trinh sát 300km, đạn 48N6E diệt mục tiêu khí động 150km, đạn đạo 40km) và giải thích hiện tượng giới hạn chân trời vô tuyến đối với tên lửa hành trình bay bám địa hình.

---

## 3. Danh sách tệp tin đã chỉnh sửa

1. [src/utils/missileVolumeEngine.ts](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts)
2. [src/components/map/CesiumGlobe.tsx](file:///e:/code/du_an/3D/vkq/vompk/src/components/map/CesiumGlobe.tsx)
3. [src/components/ui/RightInspector.tsx](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx)

---

## 4. Kết quả xác minh & Build

- Kiểm tra TypeScript và Vite bundle qua lệnh:
  ```bash
  npm run build
  ```
- Kết quả: **Thành công 100% (exit code 0)**, không còn bất kỳ lỗi compile nào (`tsc -b && vite build` hoàn tất sạch sẽ).
- Máy chủ dev server (`npm run dev`) duy trì hoạt động liên tục.
