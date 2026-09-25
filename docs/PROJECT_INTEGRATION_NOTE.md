# PROJECT INTEGRATION NOTE: 3D RADAR TERRAIN VISIBILITY

**Dự án:** vomkq-web (React 19 + Cesium 1.145 + Vite + Zustand)  
**Ngày thực hiện:** 2026-09-23  
**Mục tiêu:** Đánh giá mức độ phù hợp và tích hợp đặc tả kỹ thuật "Radar 3D Terrain Visibility" vào hệ thống hiện hữu.

---

## 1. ĐÁNH GIÁ MỨC ĐỘ PHÙ HỢP VỚI DỰ ÁN

Tài liệu kỹ thuật đặc tả **HOÀN TOÀN PHÙ HỢP 100%** với mục tiêu của dự án `vomkq-web` và đáp ứng chính xác tiêu chí của khách hàng:
- **Tiêu chí khách hàng:** Vòm radar phải được chắn đúng theo địa hình thực tế (terrain masking), trực quan hóa rõ ràng vùng phủ sóng nhìn thấy (Visible) và vùng bị che khuất / bóng râm sau núi (Occluded/Shadow), giúp người chỉ huy lập kế hoạch bố trí trận địa tác chiến phòng không chính xác.
- **Hiện trạng dự án:**
  - Dự án đã có mô hình `CoverageProfile` (giản đồ góc tà - cự ly) và `RadarCoverageField` trong `src/types/radarCoverage.ts`.
  - Dự án đã có `radarVolumeGeometry.ts` dựng mesh 3D theo các tầng độ cao và `radarDomeGeometry.ts` port từ Unity.
  - Tuy nhiên, hiện tại việc xử lý chắn địa hình chủ yếu co rút bán kính mép ngoài (`effectiveDistM`) mà chưa dựng khối thể tích bóng râm che khuất (`Occluded shell`) phía sau sườn núi một cách đồng bộ trong cùng mesh/volume 3D, chưa có adapter `TerrainSampler` chuẩn hóa tách rời khỏi renderer, chưa có camera preset quan sát từ phía sau núi (`Behind Terrain`), và chưa có bộ kiểm thử hình học độc lập (Synthetic Terrain Tests).
- **Kết luận:** Triển khai theo đặc tả sẽ nâng cấp vòm 3D từ mức bán co rút hình học lên thành **chuẩn mô phỏng 3D Terrain Masking quân sự chuyên nghiệp**, kế thừa toàn bộ cấu trúc mã nguồn hiện tại mà không phá vỡ bất kỳ tính năng nào.

---

## 2. KẾT QUẢ KHẢO SÁT HỆ THỐNG HIỆN TẠI (PHASE 0 AUDIT)

### 2.1 Cấu trúc & Module liên quan
1. `src/types/radarCoverage.ts`: Định nghĩa `CoverageProfile`, `CoverageProfilePoint`, `RayCoverageData`, `RadarCoverageField`, `RadarCoverageResult`.
2. `src/types/radarVolume.ts`: Định nghĩa `RadarCoverageVolume`, `VolumeVisibilityState` ('VISIBLE' | 'TERRAIN_LIMITED' | 'OUTSIDE_ENVELOPE' | 'NO_DATA'), `AltitudeBandInfo`.
3. `src/utils/radarMath.ts`: Công thức vật lý & hình học vô tuyến (độ cong Trái Đất $h_z = \frac{D^2}{2 R_{td}}$, góc che khuất $\tan(\alpha_{ck})$, nón mù $R_{kh} = H_{mt} \cot(\varepsilon_{max})$, chân trời radar $D_{nt} = 4.12(\sqrt{h_a} + \sqrt{H_{mt}})$, nội suy profile `getProfileMaxRange`).
4. `src/utils/radarLosEngine.ts`: Tính toán lấy mẫu địa hình từ `Cesium.sampleTerrain` và dựng các tia quét LOS `RayCoverageData`.
5. `src/utils/radarVolumeEngine.ts`: Tính toán ma trận độ cao × phương vị `computeRadarCoverageVolume`.
6. `src/utils/radarVolumeGeometry.ts`: Dựng lưới tam giác Cesium `RadarVolumeGeometry` với hệ tọa độ ENU cục bộ.
7. `src/utils/radarDomeGeometry.ts`: Dựng vỏ vòm tham chiếu theo phương vị và góc tà.
8. `src/components/map/CesiumGlobe.tsx`: Component bản đồ chính, quản lý Cesium Viewer, nạp địa hình `./offline-terrain`, tính toán bất đồng bộ và render Primitives / Entities.
9. `src/store/useTacticalStore.ts`: Store Zustand lưu trữ trạng thái `instances`, `coverageFields`, `coverageVolumes`, `dome3DMode`, `showBlindZones`, `showCrossSection`, v.v.

### 2.2 Module đang dựng Dome hiện tại
- Trong `CesiumGlobe.tsx` (dòng 1386–1500):
  - Khi có `volume`: Dùng `buildRadarVolumeGeometry(volume, { mode: dome3DMode, showInnerCone: showConeOfSilence })` kết hợp vật liệu shader `createRadarDomeMaterial`.
  - Khi chưa có `volume`: Dùng `buildRadarDomeGeometry(domeInstance, field, ...)` làm fallback danh nghĩa.
  - Vùng mù địa hình (nếu bật `showBlindZones`): Dùng `buildRadarCoverageFieldEntities` tạo entities Cesium.

### 2.3 Hệ tọa độ đang dùng
- **Toàn cục:** WGS-84 Geographic (Kinh độ/Vĩ độ độ thập phân, Cao độ mét so với Ellipsoid).
- **Cục bộ phân tích & dựng mesh:** Hệ trục Đông - Bắc - Lên (East-North-Up / ENU) với tâm đặt tại anten radar:
  - $X = \text{East} = R \sin(\text{Az}) \cos(\text{Elev})$
  - $Y = \text{North} = R \cos(\text{Az}) \cos(\text{Elev})$
  - $Z = \text{Up} = R \sin(\text{Elev})$ hoặc $\Delta H = H_{target} - H_{radar}$
- **GPU Rendering:** Dùng `Cesium.Transforms.eastNorthUpToFixedFrame(center)` làm `modelMatrix` và thuộc tính `position` kiểu `Cesium.ComponentDatatype.DOUBLE` để GPU Cesium giải mã RTE (Relative To Eye), triệt tiêu hiện tượng rung lắc (jitter) ở cự ly hàng trăm km.

### 2.4 Terrain Provider hiện tại
- Mặc định khởi tạo: `Cesium.CesiumTerrainProvider.fromUrl('./offline-terrain')` với fallback phẳng (flat ellipsoid) khi chưa tải xong hoặc lỗi tile.
- Cần có adapter `TerrainSampler` thống nhất có cache và cho phép inject `SyntheticTerrainSampler` phục vụ kiểm thử đơn vị độc lập.

---

## 3. NGUYÊN TẮC THIẾT KẾ & TÍCH HỢP

1. **Tuân thủ quy tắc người dùng & đặc tả:**
   - Tuyệt đối không tự ý viết lại toàn bộ hệ thống; tái sử dụng các kiểu dữ liệu và utility sẵn có.
   - Giữ nguyên vẹn giao diện người dùng và API của các module hiện có (`useTacticalStore`, `CesiumGlobe`, `RadarCrossSectionPanel`).
   - Phân tách rõ 4 lớp kiến trúc:
     1. `CoverageProfile`: Giới hạn envelope lý thuyết.
     2. `TerrainSampler`: Lớp adapter trừu tượng hóa việc lấy mẫu địa hình (hỗ trợ cả Cesium thật và Synthetic Test).
     3. `HorizonAnalyzer` & `RadarLosEngine`: Tính góc chân trời $\theta_{horizon} = \max \arctan(\frac{H_t - H_0}{d})$ và gán trạng thái `Visible`, `Boundary`, `Occluded`.
     4. `CoverageMeshBuilder`: Dựng 3D volume gồm cả `visible shell` và `occluded shadow volume` với độ trong suốt tối ưu, không che khuất địa hình thực tế.
2. **Preset Camera kiểm tra tác chiến:**
   - Bổ sung camera preset:
     - `Observer Side`: Nhìn từ radar hướng ra chiến trường theo phương vị khảo sát.
     - `Behind Terrain`: Đặt camera phía sau dãy núi nhìn ngược về radar để chỉ huy quan sát trực tiếp khoảng mù sau núi.
     - `Top-Down`: Nhìn thẳng góc từ trên xuống đánh giá toàn diện vùng phủ.
3. **Hiệu năng & Không block UI:**
   - Tính toán bất đồng bộ theo lượt, gắn `cacheKey` và cờ hủy bỏ (`isCancelled` / versioning) khi người dùng di chuyển hoặc thay đổi tham số radar liên tục.
   - Tuyệt đối không tính toán lại khi người dùng chỉ xoay / zoom camera.
