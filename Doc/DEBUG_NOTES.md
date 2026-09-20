# Debug Notes

## [2026-09-17] Radar 3D - Cắt vòm theo địa hình, khuyết nón mù đỉnh đầu & sửa slider độ cao H_mt

### Mục tiêu
Khắc phục hiện tượng vòm radar bị biến thành khối cầu tròn xoe tĩnh (không khuyết nón mù đỉnh đầu, không cắt lồi lõm theo địa hình núi chắn, kéo thanh trượt H_mt không thay đổi).

### Files
- `src/utils/radarGeometryBuilder.ts`
- `src/utils/radarLosEngine.ts`
- `src/types/radarCoverage.ts`
- `src/components/ui/RightInspector.tsx`

### Parameters
| Name | Type | Value | Unit | Source | Meaning |
|------|------|-------|------|--------|---------|
| `targetHeightMeters` | `number` | `50 - 15000` | meters | `useTacticalStore.ts` | Độ cao mục tiêu khảo sát H_mt |
| `coneRadiusM` | `number` | `H_mt · cotg(ε_max)` | meters | `radarMath.ts` | Bán kính lỗ khuyết nón vùng mù đỉnh đầu |
| `maxDetectionDistanceM` | `number` | `min(R_profile, D_nt)` | meters | `radarMath.ts` | Cự ly phát hiện xa nhất ở độ cao H_mt |
| `cacheKey` | `string` | `..._H${targetH}_B${blind}` | - | `radarLosEngine.ts` | Khóa phân biệt cache theo từng độ cao khảo sát |

### Data Flow
Slider H_mt change -> RightInspector (setTargetHeightMeters) -> store update -> CesiumGlobe useEffect -> generateCoverageCacheKey (mới theo H_mt) -> computeRadarCoverageField -> buildRadarCoverageFieldEntities -> Render vòm khoét nón uốn lượn theo núi.

### Problem
1. Vòm radar hiển thị một khối bán cầu tròn xoe tĩnh, không có lỗ khuyết vùng mù đỉnh đầu (Cone of Silence) theo góc $\varepsilon_{max}$.
2. Vòm không cắt theo sườn núi thực tế mà phủ tròn ra ngoài.
3. Kéo slider độ cao mục tiêu $H_{mt}$ (50m, 300m, 1km, 5km, 14970m) nhưng vòm không có bất kỳ thay đổi nào.

### Root Cause
1. Trong `radarLosEngine.ts`: `generateCoverageCacheKey` **không chứa `targetHeightMeters` và `showBlindZones`**, khiến khi người dùng kéo slider thì `cacheKey` không đổi, engine coi là đã có và bỏ qua (`continue`), không tính toán lại!
2. Trong `RightInspector.tsx`: Slider đọc qua `useTacticalStore.getState().targetHeightMeters` mà không dùng hook selector, khiến component không phản ứng theo React lifecycle.
3. Trong `radarGeometryBuilder.ts`: Lượt trước dùng bán cầu cố định `ellipsoid`, không xây dựng mặt vòm động từ vòng khuyết đỉnh đầu $R_{cone} = H_{mt} \cdot \cot(\varepsilon_{max})$ ra cự ly chạm núi $D_{occlusion}$ và chân trời $D_{nt}$.

### Fix
1. **Thêm `targetHeightMeters` và `showBlindZones` vào `generateCoverageCacheKey`**: Chuỗi key phân biệt rành rọt theo từng độ cao khảo sát.
2. **Kích hoạt reactive hook trong `RightInspector.tsx`**: Destructure `targetHeightMeters`, `setTargetHeightMeters` từ `useTacticalStore()` giúp slider và các nút bấm 50m/300m/1km/5km re-render mượt mà.
3. **Tái thiết kế hình học vòm 3D chuẩn tác chiến trong `radarGeometryBuilder.ts`**:
   - **Lỗ khuyết đỉnh đầu (Cone of Silence)**: Bán kính $R_{cone} = H_{mt} \cdot \cot(\varepsilon_{max})$. Ở $H_{mt} = 14.970\text{m}$, lỗ khuyết rộng $25.93\text{km}$; ở $300\text{m}$, lỗ khuyết co về $0.52\text{km}$.
   - **Mặt vòm 3D (Canopy Mesh)**: Tứ giác nối từ vòng khuyết đỉnh đầu ra mép ngoài cắt theo địa hình (`perPositionHeight: true`, `outline: false`), tạo bề mặt vòm trong suốt, bóng bẩy, không rối mắt.
   - **Biên ngoài cắt theo địa hình**: Nơi có núi chắn thì vòm dừng ngay ở sườn núi ($D_{occlusion}$), nơi thoáng thì vòm vươn dài ra chân trời ($D_{nt}$).
   - **Vùng mù địa hình (Shadow)**: Khối màu đỏ cam (`#ef4444`, `outline: false`) tiếp nối phía sau núi cùng mảng bóng sườn núi bám đất.
   - **2 đường viền tinh tế**: Vành khuyết đỉnh đầu (Inner Ring) màu vàng hổ phách và đường biên ngoài (Outer Ring) phát quang màu khí tài.

### Verification
- `npm run build` thành công, Exit Code 0.
- Kéo slider $H_{mt}$: vòm lập tức co giãn, nâng hạ độ cao, mở rộng/thu nhỏ lỗ khuyết đỉnh đầu và tầm quét chân trời tức thì.
- Quan sát đỉnh Tam Đảo: Vòm radar bị sườn núi chắn lại và xuất hiện vùng bóng đỏ cam phía sau rõ ràng.

---

## [2026-09-17] Trực quan hóa 3D Radar - Tinh giản vòm cầu mượt mà & phân biệt vùng khuất

### Mục tiêu
Loại bỏ các lớp nan vòm 3D (Canopy Mesh), tường ngoài (Outer Wall) và polyline bám đất dày đặc gây rối mắt người dùng; thay thế bằng một khối bán cầu màu hơi trong (alpha thấp) mượt mà, và hiển thị vùng khuất/vùng mù bằng màu sắc & bề mặt riêng biệt (màu đỏ cam và bóng đổ sườn núi bám đất).

### Files
- `src/utils/radarGeometryBuilder.ts`
- `src/components/map/CesiumGlobe.tsx`

### Parameters
| Name | Type | Value | Unit | Source | Meaning |
|------|------|-------|------|--------|---------|
| `domeRadiusM` | `number` | `maxRangeKm * 1000` | meters | `field.maxRangeKm` | Bán kính khối bán cầu radar |
| `domeHeightM` | `number` | `maxHeightM - radarAltM` | meters | `field.maxHeightM` | Chiều cao đỉnh vòm radar |
| `material.alpha` | `number` | `0.12 - 0.22` | [0..1] | `baseColor.withAlpha` | Độ trong suốt của khối cầu radar |
| `shadowTerrainColor` | `Cesium.Color` | `#ef4444` (alpha 0.3 - 0.45) | RGBA | Hex code | Màu bóng đổ địa hình bám đất |
| `shadowSpaceColor` | `Cesium.Color` | `#f97316` (alpha 0.2 - 0.32) | RGBA | Hex code | Màu khối nêm không gian vùng mù |

### Data Flow
RadarCoverageField (azimuthRays, maxRangeKm) -> buildRadarCoverageFieldEntities:
- Visible -> 1 thực thể Cesium.Entity (ellipsoid) bán cầu mượt mà, trong suốt
- Shadow -> Cesium.Entity (polygon CLAMP_TO_GROUND / classificationType: TERRAIN) bóng đổ sườn núi màu đỏ & khối nêm 3D màu cam đỏ
- ConeOfSilence -> Nón cảnh báo đỉnh đầu màu vàng nhẹ

### Problem
Hàng trăm nan quạt lưới 3D (`PolygonHierarchy`), tường ngoài và hàng ngàn polyline bám đất đan xen với nhau tạo thành "mạng nhện" hoặc "lồng sắt" chằng chịt các đường outline, khiến người dùng bị rối mắt, che khuất địa hình và mục tiêu tác chiến.

### Root Cause
Cách dựng hình cũ chia nhỏ không gian $Azimuth \times Elevation$ thành hàng nghìn ô đa giác độc lập có đường viền outline viền quanh từng ô, dẫn đến mật độ đường nét quá dày đặc trên quả cầu 3D.

### Fix
1. **Loại bỏ hoàn toàn**: Lớp 1 (nan vòm lưới 3D), Lớp 2 (tường chắn tia ngoài), Lớp 3 (polyline bám đất dày đặc).
2. **Khối vòm chính**: Chỉ dùng 1 khối `ellipsoid` bán cầu mượt mà, độ alpha thấp hơi trong (`0.12 - 0.22`), giữ màu riêng của khí tài, có đường viền mỏng thanh thoát.
3. **Vùng khuất địa hình**: Tô bóng đỏ cảnh báo trên sườn núi bám sát địa hình (`classificationType: TERRAIN`) và các khối nêm không gian màu cam đỏ mờ, không bật outline mắt lưới, giúp người dùng nhận diện ngay điểm mù mà không bị rối mắt.
4. **Bảo tồn tính toàn vẹn 2D**: Dữ liệu chi tiết từng tia trong `CoverageField` vẫn được bảo toàn nguyên vẹn cho Bảng Mặt cắt 2D và Modal Chỉ số.

### Verification
- `npm run build` thành công, Exit Code 0.
- Khối vòm 3D trên quả cầu Cesium hiển thị trơn tru, trong suốt, nhìn rõ địa hình bên dưới.
- Các sườn núi bị khuất hiển thị màu đỏ cam trực quan, tách biệt hoàn toàn với màu vòm chính.

---

## [2026-09-17] Cesium 3D Rendering - RangeError: Invalid typed array length (WallGeometry)

### Mục tiêu
Sửa lỗi crash Cesium Web Worker trong quá trình render hình học 3D của trường phủ radar (`An error occurred while rendering. Rendering has stopped. RangeError: Invalid typed array length: 38569606938156`).

### Files
- `src/utils/radarGeometryBuilder.ts`
- `src/components/map/CesiumGlobe.tsx`

### Parameters
| Name | Type | Value | Unit | Source | Meaning |
|------|------|-------|------|--------|---------|
| `positions` | `Cartesian3[]` | `[pTop1, pTop2]` | meters (ECEF) | `radarGeometryBuilder.ts` | Đỉnh mép ngoài của tia sóng radar cao nhất |
| `minimumHeights` | `number[]` | `[sBot1.terrainAltM, sBot2.terrainAltM]` | meters | `radarLosEngine.ts` | Độ cao địa hình tại cự ly xa nhất của tia đáy |
| `granularity` | `number` | `CesiumMath.RADIANS_PER_DEGREE` | radians | Cesium WallGeometryLibrary | Khoảng cách góc chia nhỏ giữa các đỉnh |

### Data Flow
RadarCoverageField (azimuthRays) -> buildRadarCoverageFieldEntities -> Cesium.Entity({ wall: ... }) -> Web Worker (createWallGeometry.js) -> WallGeometryLibrary.computePositions -> Crash!

### Problem
Khi khởi tạo quả cầu 3D hoặc bật vòm radar, console báo lỗi dừng render hoàn toàn:
```text
cesium.js:244665 An error occurred while rendering.  Rendering has stopped.
RangeError: Invalid typed array length: 38569606938156
    at new Float64Array (<anonymous>)
    at WallGeometryLibrary.computePositions (chunk-M6W46OAP.js:155:20)
    at WallGeometry.createGeometry (createWallGeometry.js:262:43)
    at createWallGeometry (createWallGeometry.js:482:31)
```

### Root Cause
1. **Sai lệch hình học của Cesium Wall**:
   - Thành phần `Cesium.Entity.wall` được Cesium thiết kế cho các bức tường thẳng đứng theo phương trọng lực tại **cùng tọa độ kinh vĩ độ** từ `minimumHeights` lên `positions`.
   - Trong code cũ (`radarGeometryBuilder.ts`), `positions` lấy từ `topRay` (ví dụ góc $65^\circ$, cự ly chỉ $35\text{km}$), trong khi `minimumHeights` lại lấy từ `bottomRay` (góc $3^\circ$, cự ly $200\text{km}$). Hai vị trí lệch nhau hơn $165\text{km}$.
2. **Khoảng cách góc tiến về 0 & tràn buffer (Buffer Overflow)**:
   - Ở các góc tà cao hoặc nan quạt hẹp, khoảng cách giữa `pTop1` và `pTop2` rất nhỏ hoặc vector hướng bị suy biến (`Cartesian3.ZERO`), khiến phép tính `distance / granularity` hoặc phân đoạn trong `WallGeometryLibrary.computePositions` chia cho số gần 0 hoặc tạo ra giá trị không xác định (`NaN`).
   - Phép ép kiểu sang kích thước mảng `Float64Array` dẫn đến con số rác khổng lồ `38569606938156`, gây ra `RangeError: Invalid typed array length`.
3. **Thừa thãi hình học**:
   - Toàn bộ bề mặt ngoài của vòm từ góc tà thấp nhất đến góc tà cao nhất vốn đã được dựng hoàn chỉnh bởi các ô lưới đa giác `polygon` (`PolygonHierarchy` với `perPositionHeight: true`) ở phần A. Khối `wall` ở phần C vừa vẽ đè một vách ngăn méo mó, vừa làm sập renderer của Cesium.

### Fix
1. **Loại bỏ khối `wall` gây lỗi**:
   - Xóa bỏ hoàn toàn việc tạo thực thể `wall: { positions, minimumHeights }` trong `src/utils/radarGeometryBuilder.ts`.
   - Giữ nguyên cấu trúc mặt bao ngoài bằng các ô tứ giác 3D `polygon` (`PolygonHierarchy`) vốn đã chạy ổn định và chính xác.
2. **Bổ sung hàm kiểm tra an toàn tọa độ (`isValidCartesian`)**:
   ```ts
   function isValidCartesian(p: Cesium.Cartesian3 | null | undefined): boolean {
     return (
       p !== null &&
       p !== undefined &&
       Number.isFinite(p.x) &&
       Number.isFinite(p.y) &&
       Number.isFinite(p.z)
     );
   }
   ```
   Kiểm tra tính hợp lệ và hữu hạn của tất cả các tọa độ 3D trước khi thêm vào `PolygonHierarchy` và `polyline` (cho cả Visible, Shadow và Ground Footprint).

### Verification
- Chạy `npm run build`: `tsc -b && vite build` thành công, exit code 0 trong 2.40s.
- Khởi động dev server: Web Worker của Cesium không còn gọi `createWallGeometry`, không còn xảy ra lỗi `RangeError`, Cesium Globe render 3D mượt mà.

---

## [2026-09-17] React State & LOS Effect - Maximum update depth exceeded

### Mục tiêu
Khắc phục vòng lặp re-render vô tận khi tính toán Coverage Field giữa `CesiumGlobe.tsx` và Zustand Store `useTacticalStore.ts`.

### Files
- `src/store/useTacticalStore.ts`
- `src/components/map/CesiumGlobe.tsx`

### Parameters
| Name | Type | Value | Unit | Source | Meaning |
|------|------|-------|------|--------|---------|
| `isCalculatingLOS` | `boolean` | `true / false` | - | `useTacticalStore.ts` | Cờ báo hiệu đang chạy thuật toán tính LOS |
| `coverageFieldCache` | `Record<string, RadarCoverageField>` | `{ [cacheKey]: field }` | - | `useTacticalStore.ts` | Bảng tra lưu trường phủ theo tham số |
| `coverageFields` | `Record<string, RadarCoverageField>` | `{ [instanceId]: field }` | - | `useTacticalStore.ts` | Trường phủ hiện tại của từng khí tài |

### Data Flow
instances/params change -> useEffect (CesiumGlobe) -> setIsCalculatingLOS(true) -> setCoverageField -> store update -> re-render loop -> Crash!

### Problem
```text
react-dom_client.js:2787 Maximum update depth exceeded. This can happen when a component calls setState inside useEffect...
react-dom_client.js:2786 Uncaught Error: Maximum update depth exceeded...
    at setIsCalculatingLOS (useTacticalStore.ts:214:41)
    at CesiumGlobe.tsx:401:7
```

### Root Cause
1. `coverageFieldCache` nằm trong dependency array của `useEffect` tính toán LOS trong `CesiumGlobe.tsx`.
2. Khi tính toán xong một đài, `setCoverageField` tạo mới reference cho `coverageFieldCache`, kích hoạt React cleanup effect trước đó.
3. Trong cleanup function có lệnh `setIsCalculatingLOS(false)` $\rightarrow$ gọi setState trong cleanup.
4. Effect mới chạy lại $\rightarrow$ gọi `setIsCalculatingLOS(true)` $\rightarrow$ lấy từ cache $\rightarrow$ lại gọi `setCoverageField` $\rightarrow$ lặp vô hạn.

### Fix
1. Thêm **Equality / Reference Guards** cho `setIsCalculatingLOS`, `setCoverageField`, `setCoverageResult` trong `useTacticalStore.ts`.
2. Loại bỏ `coverageFieldCache` khỏi store subscription và dependency array trong `CesiumGlobe.tsx`.
3. Xóa `setIsCalculatingLOS(false)` khỏi cleanup function của `useEffect`.

### Verification
- `npm run build` đạt Exit Code 0.
- Không còn bất kỳ cảnh báo hoặc lỗi vòng lặp React nào trong console.

---

## [2026-09-20] Tái thiết kế toàn diện bảng Inspector (RightInspector) - Tách biệt 2D/3D, phân cấp thị giác và đóng gọn theo tiến trình tác chiến

### Mục tiêu
Tái cấu trúc và thiết kế lại toàn diện bảng Inspector (`RightInspector.tsx`) theo kế hoạch tại `Cau_hinh_lai_toan_bo_Inspector.docx`, khắc phục sự rối mắt và lộn xộn giữa 2D và 3D, áp dụng 5 tầng kiến trúc trực quan.

### Files
- `src/components/ui/RightInspector.tsx`
- `docs/DEBUG_NOTES.md`
- `Doc/DEBUG_NOTES.md`

### Parameters
| Name | Type | Value | Unit | Source | Meaning |
|---|---|---|---|---|---|
| `activeTab` | `'2d' \| '3d'` | `'2d' / '3d'` | - | `RightInspector.tsx` | Tab chuyển đổi chế độ xem 2D hoặc 3D |
| `isProfileOpen` | `boolean` | `false` | - | `RightInspector.tsx` | Trạng thái mở accordion Giản đồ búp sóng |
| `isAltitudeTableOpen` | `boolean` | `false` | - | `RightInspector.tsx` | Trạng thái mở accordion Bảng tra cự ly theo độ cao |
| `coordFormat` | `'dms' \| 'decimal'` | `'dms'` | - | `RightInspector.tsx` | Định dạng hiển thị tọa độ WGS-84 |
| `status` | `OperationalStatus` | `'Active' \| 'Standby' \| 'Maintenance' \| 'Offline'` | - | `equipment.ts` | Trạng thái sẵn sàng chiến đấu |
| `shortId` | `string` | `R-01, SAM-01...` | - | `equipment.ts` | Mã định danh quân sự ngắn |

### Verification
- `npx tsc --noEmit` đạt Exit Code 0.
- Dev server Vite hot reload cập nhật tức thì.
- Thử nghiệm các thao tác: đổi trạng thái, chỉnh tọa độ DMS, chuyển tab 2D/3D, mở/đóng accordion.

