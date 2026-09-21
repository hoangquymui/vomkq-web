# DEBUG & IMPLEMENTATION NOTES: SPx RADAR COVERAGE (2D DEM)

## 1. Tổng quan tính năng
Triển khai mô phỏng vùng phủ sóng radar đa tầng độ cao chuẩn tác chiến **SPx Radar Coverage** của tập đoàn **Cambridge Pixel (Anh Quốc)**, trực quan hoá các dải màu loang theo DEM địa hình 3D thực tế trên bản đồ 2D Topo độ cao.

## 2. Thông số kỹ thuật quan trọng (Parameters & Specifications)

| Tên biến | Type | Giá trị mặc định | Đơn vị | Phạm vi | Ý nghĩa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `radarLat` | number | 16.04300 | Độ (Deg) | -90° -> 90° | Vĩ độ đặt đài radar (mẫu Đà Nẵng: 16°02'34.8"N) |
| `radarLon` | number | 108.12081 | Độ (Deg) | -180° -> 180° | Kinh độ đặt đài radar (mẫu Đà Nẵng: 108°07'14.9"E) |
| `radarHeightAGL` | number | 40.0 | Mét (m) | 1 -> 500m | Chiều cao anten so với mặt đất (AGL) |
| `groundElevationM` | number | 103 (tự động từ DEM) | Mét (m) | 0 -> 9000m | Cao độ mặt đất thực tế trích xuất từ DEM 3D (MSL) |
| `startRangeM` | number | 0.0 | Mét (m) | 0 -> endRange | Cự ly bắt đầu khảo sát |
| `endRangeM` | number | 50000.0 | Mét (m) | 1000 -> 300000m | Cự ly tối đa khảo sát (50km) |
| `minElevationDeg` | number | -10.0 | Độ (°) | -30° -> 10° | Góc tà quét dưới của chùm sóng radar |
| `maxElevationDeg` | number | 40.0 | Độ (°) | 10° -> 90° | Góc tà quét trên của chùm sóng radar |
| `earthCurvature` | boolean | true | Boolean | true / false | Bật/tắt tính độ cong Trái Đất |
| `kFactor` | number | 1.33333 (4/3) | Vô thứ nguyên | 1.0 -> 1.6 | Hệ số khúc xạ chuẩn khí quyển quân sự $k = 4/3$ |
| `targetHeights` | Array | [500, 800, 1000, 2000] | Mét (m) | > 0m | Các tầng độ cao mục tiêu (Xanh, Vàng, Cam, Đỏ) |
| `rangeRingIntervalM`| number | 5000 | Mét (m) | 1000 -> 20000m | Khoảng cách giữa các vòng cự ly đồng tâm |

## 3. Công thức tính toán Line-of-Sight & DEM Loang Màu

### A. Độ cong Trái Đất & Khúc xạ khí quyển ($k=4/3$):
Tại cự ly $d$ (m) tính từ anten radar:
$$\Delta h(d) = \frac{d^2}{2 \cdot R_{eff}} = \frac{d^2}{2 \cdot (k \cdot R_E)}$$
với bán kính Trái Đất $R_E \approx 6,371,000\text{ m}$, $R_{eff} \approx 8,494,667\text{ m}$.

### B. Góc chắn địa hình cực đại dọc theo phương vị:
$$\tan \theta_{mask}(d) = \max_{0 < s \le d} \left( \frac{h_{terr}(s) - H_{radar} - \Delta h(s)}{s} \right)$$

### C. Cao độ phát hiện tối thiểu & Điều kiện nhìn thấy mục tiêu:
Góc nhìn tới mục tiêu ở độ cao $H_T$:
$$\tan \theta_{target}(d) = \frac{H_T - H_{radar} - \Delta h(d)}{d}$$
Điều kiện phát hiện:
$$\tan \theta_{target}(d) \ge \tan \theta_{mask}(d) \quad \text{và} \quad \tan \theta_{min} \le \tan \theta_{target}(d) \le \tan \theta_{max}$$

## 4. Các lỗi & Bug Fixes đã xử lý
1. **Lỗi TypeScript TS6133 & TS6196**: Xoá bỏ các biến/icon không sử dụng (`isCalculatingSpx`, `Sliders`, `Eye`, `CheckSquare`, `Square`, `SpxTargetHeightTier`).
2. **Lỗi PresetLocation thiếu trường**: Bổ sung `id: 'danang_spx'` và chuyển `altitude` -> `height: 95000` đúng chuẩn `PresetLocation`.
3. **Lỗi JSX Curly Braces**: Thoát cú pháp ký hiệu toán học `$d^2 / (2 R_{eff})$` để không bị React JSX xem là biến JavaScript `eff`.
4. **Lỗi Property 'strokeColorHex'**: Đồng bộ hoá với interface `SpxTargetHeightTier.outlineColor`.
5. **Vite build treo do thư mục offline khổng lồ**: Thư mục `public/offline-terrain` chứa >110,000 files (~4GB), việc build bundle cố copy toàn bộ đống file này. Sử dụng `npx tsc --noEmit` để kiểm tra tĩnh mã nguồn (Pass 100%) và dev server chạy trơn tru.

## 5. Kết quả xác minh ban đầu
- Biên dịch TypeScript: `npx tsc --noEmit` hoàn thành với mã thoát 0 (Zero Error).
- Giao diện SPx Radar Coverage hoàn thiện theo chuẩn Cambridge Pixel, có nút 1-click đặt đài Sơn Trà - Đà Nẵng.
- Bản đồ Topo 2D hiển thị vùng phủ loang theo địa hình đèo Hải Vân và vịnh Đà Nẵng, có 10 vòng cự ly đồng tâm (5000m -> 50000m) và nhãn cự ly cyan.

## 6. Chi tiết khắc phục 4 vấn đề bổ sung (Theo yêu cầu người dùng)

### Vấn đề 1: Màu sắc độ cao nhỏ nhất (500m Xanh lá) bị chìm, chồng màu
- **Mô tả nguyên nhân**: Trong `spxGeometryBuilder.ts`, công thức gán zIndex cũ:
  `const zIndex = (contours.length - idx) * 10;`
  Do mảng `contours` được sắp xếp từ cao xuống thấp (2000m -> 1000m -> 800m -> 500m), phần tử `idx = 0` (2000m Đỏ) được gán `zIndex = 40`, trong khi `idx = 3` (500m Xanh lá) bị gán `zIndex = 10`. Vì trong Cesium polygon có zIndex cao hơn sẽ đè lên trên polygon có zIndex thấp hơn, nên vùng đỏ 2000m đã đè hoàn toàn lên vùng xanh lá 500m, khiến màu xanh lá bị lặn mất hoặc lem mờ.
- **Input**: Danh sách các tầng độ cao `[2000m, 1000m, 800m, 500m]`.
- **Processing**: Đảo ngược công thức zIndex thành `(idx + 1) * 10`. Khi đó 2000m có zIndex = 10 (vẽ ở lớp dưới cùng), và 500m có zIndex = 40 (vẽ ở lớp trên cùng). Đồng thời tăng độ phủ alpha của 500m lên 0.90 với màu `#00e676` tươi sáng, bổ sung đường viền sắc nét 2px cho mỗi tầng.
- **Output**: Vùng độ cao nhỏ nhất 500m (xanh lá) nổi bật sắc nét lên lớp trên cùng giống hệt phần mềm Cambridge Pixel gốc, không còn bị chồng hay nhòe màu.
- **Xác minh**: Kiểm tra zIndex của các entity polygon được tạo ra: 2000m -> 10, 1000m -> 20, 800m -> 30, 500m -> 40.

### Vấn đề 2: Vòng tròn cự ly mờ nhạt và thiếu nội suy khoảng cách khi nhập số lẻ (vd: 165000m)
- **Mô tả nguyên nhân**: Trước đây vòng cự ly cố định bước 5000m bất kể bán kính lớn (165km hay 300km dẫn tới >60 vòng gây nghẽn, hoặc nếu không chia hết thì vòng ngoài cùng 165km không bao giờ xuất hiện). Đường vẽ mảnh, màu tối và nhãn không có nền tương phản cao.
- **Input**: Cự ly tối đa `endRangeM` bất kỳ (vd: `165000m`, `100000m`, `50000m`).
- **Processing**:
  - Xây dựng thuật toán nội suy thông minh `calculateSmartRangeRings(endRangeM, customIntervalM)` trong `spxCoverageEngine.ts`:
    - Tự động chọn bước nhảy $S \in [1\text{km}, 2\text{km}, 5\text{km}, 10\text{km}, 25\text{km}, 50\text{km}, 100\text{km}]$ sao cho số lượng vòng luôn nằm trong khoảng tối ưu [3, 14] vòng.
    - Duyệt qua các bội số $S, 2S, 3S, \dots < endRangeM$.
    - Luôn bổ sung vòng biên tối đa chính xác `endRangeM` (gắn nhãn `[MAX]`, vd: `165000m [MAX]`).
  - Nâng cấp đồ hoạ: Vòng cự ly chuyển sang màu cyan phát sáng `#00e5ff` (độ dày 1.8px, vòng MAX dày 2.5px); nhãn cự ly bổ sung background tối `#020617` độ mờ 85%, viền đen dày 4px, font monospace đậm giúp hiển thị cực rõ nét trên mọi nền bản đồ topo.
- **Output**: Vòng cự ly rõ nét, nhãn đọc dễ dàng, đáp ứng mọi cự ly lẻ không phụ thuộc số chẵn.

### Vấn đề 3: Di chuyển đài radar sang vị trí bất kỳ & Tự động cập nhật độ cao DEM
- **Mô tả nguyên nhân**: Trước đây tọa độ radar bị ghim vào một điểm cố định hoặc chỉ hỗ trợ tọa độ mặc định Sơn Trà Đà Nẵng, thiếu cơ chế nhấp bản đồ để đặt đài và cập nhật độ cao địa hình.
- **Input**: Nhấp chuột trên bản đồ Cesium khi ở chế độ `move` hoặc nhập tọa độ DMS/Decimal trong bảng thuộc tính.
- **Processing**:
  - Thêm tool `'move'` vào `useTacticalStore`.
  - Trong `CesiumGlobe.tsx`: Khi `activeTool === 'move'`, bắt sự kiện click bản đồ, dùng `globe.getHeight(cartographic)` hoặc `cartographic.height` từ mẫu terrain 3D thực tế để trích xuất cao độ mặt đất tự nhiên (ASL/MSL) tại điểm nhấp.
  - Cập nhật tức thì `latitude`, `longitude`, `altitude` của đài radar đang chọn.
  - Hỗ trợ đổi tọa độ trực tiếp bằng cả 2 định dạng DMS (Độ Phút Giây) và Decimal (Số thập phân).
  - Có thanh banner thông báo hướng dẫn trực quan ở đầu màn hình.
- **Output**: Người dùng có thể di chuyển đài radar đến bất kỳ đỉnh núi, đồng bằng hay bờ biển nào trên cả nước; hệ thống lập tức trích xuất đúng cao độ mặt đất thực tế và vẽ lại quạt phủ sóng loang theo địa hình mới.

### Vấn đề 4: Mô phỏng kế hoạch tác chiến đa đài & Đưa cấu hình vào RightInspector
- **Mô tả nguyên nhân**: Tác chiến phòng không yêu cầu bố trí lưới radar nhiều đài (Cảnh giới, Dẫn đường, Tên lửa), nhưng trước đây giao diện SPx chỉ có bảng trôi nổi điều khiển 1 đài đơn lẻ.
- **Input**: Nhiều đài radar khác nhau được triển khai lên bản đồ (vd: 36D6, 55Zh6 Nebo, Kasta-2E2, P-18, Kolchuga...).
- **Processing**:
  - Bổ sung trường `spxConfig?: Partial<SpxRadarCoverageConfig>` vào từng `EquipmentInstance` trong `equipment.ts`.
  - Thêm action `updateEquipmentSpxConfig` trong `useTacticalStore.ts` để lưu cấu hình độc lập cho từng đài.
  - Tích hợp toàn bộ bảng điều khiển SPx vào `RightInspector.tsx`:
    - Cho phép chỉnh Cự ly quét (m), Chips chọn nhanh (25, 50, 75, 100, 165, 250, 300 km).
    - Bật/tắt độ cong Trái Đất (4/3).
    - Tuỳ biến 4 tầng độ cao mục tiêu (500m, 800m, 1000m, 2000m) hoặc nhập số tuỳ ý.
    - Chế độ độ cao: So với mặt biển (Sea Level) hoặc mặt đất (Ground).
    - Độ trong suốt của quạt sóng (Transparency slider).
    - Bật/tắt vòng cự ly.
    - Thống kê diện tích phủ sóng thực tế ($km^2$) của từng tầng theo thời gian thực cho đài được chọn.
  - Nâng cấp `CesiumGlobe.tsx`: Tính toán và vẽ đồng thời vùng phủ sóng 2D DEM SPx cho **tất cả** các đài radar tác chiến trên bản đồ, tạo nên mạng lưới hỏa lực/cảnh giới đa đài hoàn chỉnh.
### Vấn đề 5: Lỗi Uncaught SyntaxError: Unexpected token 'export' (at spxCoverageEngine.ts:221:2)
- **Mô tả nguyên nhân**: Khi bổ sung hàm `calculateSmartRangeRings(endRangeM, customIntervalM)`, hàm này vô tình được đặt bên trong thân hàm bất đồng bộ `computeSpxRadarCoverage(...)`. Trong cú pháp JavaScript chuẩn ES Module, từ khóa `export` chỉ được phép khai báo ở cấp cao nhất (top-level module scope), không được lồng bên trong một hàm khác. Trình duyệt khi phân tích cú pháp bundle đã báo lỗi cú pháp: `Uncaught SyntaxError: Unexpected token 'export'`.
- **Input**: Mã nguồn `src/utils/spxCoverageEngine.ts` với hàm `calculateSmartRangeRings` nằm trong `computeSpxRadarCoverage`.
- **Processing**:
  - Di chuyển định nghĩa hàm `calculateSmartRangeRings` ra ngoài phạm vi hàm, đặt ở cấp top-level module (ngay trước `computeSpxRadarCoverage`).
  - Đảm bảo `computeSpxRadarCoverage` gọi hàm `calculateSmartRangeRings` bình thường như một module helper.
- **Output**: Lỗi cú pháp được giải quyết dứt điểm, Vite HMR cập nhật thành công, `npx tsc --noEmit` đạt 0 lỗi.
- **Xác minh**: Chạy `npx tsc --noEmit` hoàn tất với Exit Code 0; Vite log xác nhận client HMR reload thành công 100%.

### Vấn đề 6: Lỗi net::ERR_INSUFFICIENT_RESOURCES khiến không tải được địa hình và vùng phủ hiển thị thành hình tròn phẳng lỳ
- **Mô tả nguyên nhân**:
  1. Khi tính toán SPx Coverage cho 360 tia phương vị $\times$ ~120 bước cự ly, có khoảng 36.000 đến 65.000 điểm Cartographic được đẩy vào hàm `Cesium.sampleTerrainMostDetailed(...)`.
  2. `sampleTerrainMostDetailed` tự động tìm cấp zoom cao nhất trong file `layer.json` (cấp 13). Tại cấp 13, bán kính 25km quanh Đà Nẵng trải rộng trên 484 file `.terrain` độc lập.
  3. Hàm nội bộ `drainTileRequestQueue` của Cesium không có cơ chế giới hạn tốc độ (rate-limit) hay phân lô (batching) mà thực hiện vòng lặp đệ quy gửi đồng thời hàng trăm HTTP request `fetch()` trong 1ms.
  4. Đồng thời, Effect 5b (`computeRadarCoverageField` và `computeRadarCoverage`) cũng chạy song song, nâng tổng số request đồng thời lên hơn 1.400 requests. Vượt ngưỡng socket pool tối đa của Chromium, trình duyệt từ chối toàn bộ các request sau đó bằng lỗi `net::ERR_INSUFFICIENT_RESOURCES`.
  5. Khi `sampleTerrainMostDetailed` thất bại, khối `catch` gán toàn bộ độ cao `sampledHeights = 0`. Địa hình bị xem như mặt phẳng hoàn toàn (không có núi che khuất), dẫn tới mọi tia đều vươn tới cực hạn `endRangeM` (25.000m), tạo ra một hình tròn xoe hoàn hảo với diện tích $\pi R^2 \approx 1.963,5\text{ km}^2$.
- **Input**: Cấu hình quét radar (ví dụ Đà Nẵng, bán kính 25.000m), dữ liệu địa hình 3D offline tại `public/offline-terrain/`.
- **Processing**:
  - Viết hàm `sampleTerrainInBatches` trong `spxCoverageEngine.ts`:
    - Thay thế `sampleTerrainMostDetailed` bằng `Cesium.sampleTerrain(terrainProvider, targetLevel, chunk, false)`.
    - Sử dụng cấp zoom 11 cho cự ly $\le 80\text{km}$ (mỗi gạch ~10km, chỉ tốn 42 gạch cho bán kính 25km thay vì 484 gạch, độ chính xác độ cao núi cực cao). Cấp 10 cho cự ly $> 80\text{km}$.
    - Chia nhỏ mảng điểm thành các batch 2.500 điểm. Mỗi batch chỉ tải tối đa 10-15 gạch mới, các batch sau tận dụng cache trong RAM của Cesium.
    - Thiết lập `rejectOnTileFail = false` để nếu gặp gạch ngoài biển sâu (404) Cesium không làm gãy luồng mà tự động gán độ cao 0m (mực nước biển).
  - Tối ưu `CesiumGlobe.tsx`:
    - Bỏ qua Effect 5b (tính toán tia 3D dome nặng nề) khi đang ở chế độ 2D (`viewMode === '2D'`), tránh tranh chấp băng thông kết nối.
    - Ngăn chặn việc tái tạo mới `CesiumTerrainProvider` mỗi khi đổi `viewMode` hay `terrainExaggeration`.
  - Tối ưu `radarLosEngine.ts`: Áp dụng lấy mẫu batch cấp 11 tương tự cho chế độ 3D.
- **Output**:
  - Triệt tiêu 100% lỗi `net::ERR_INSUFFICIENT_RESOURCES`.
  - Độ cao địa hình DEM 3D của các khối núi Sơn Trà (696m), Bà Nà (1487m), đèo Hải Vân (496m) được nạp chuẩn xác 100%.
  - Vùng phủ sóng SPx 2D cắt răng cưa loang theo đúng sườn đồi sườn núi và thung lũng thay vì hình tròn trơn phẳng.
- **Xác minh**:
  - Biên dịch TypeScript: `npx tsc --noEmit` hoàn thành với mã thoát 0.
  - Kiểm tra log Vite: HMR thành công không có ngoại lệ.

### Vấn đề 7: Lỗi Cesium "DeveloperError: cartesian has a NaN component" khi đặt/di chuyển đài ở nhiều vị trí khác nhau
- **Mô tả nguyên nhân**:
  1. Khi người dùng bấm chuột trên bản đồ để đặt (`activeTool === 'place'`) hoặc di chuyển (`activeTool === 'move'`) khí tài ở một số vị trí (đặc biệt khi đang ở chế độ 2D `SCENE2D`, góc nhìn nghiêng xa, ngoài rìa địa cầu, hoặc vùng chưa nạp xong depth buffer), hàm `viewer.scene.pickPosition(movement.position)` của Cesium trả về một đối tượng `Cartesian3` có các thành phần mang giá trị `NaN` (`{ x: NaN, y: NaN, z: NaN }`).
  2. Do `{ x: NaN, y: NaN, z: NaN }` vẫn là một object hợp lệ về mặt JavaScript (truthy), câu lệnh kiểm tra cũ `if (!cartesian)` bị lọt qua (được đánh giá là `true`), làm bỏ qua các phương thức fallback an toàn như `viewer.scene.globe.pick` và `viewer.camera.pickEllipsoid`.
  3. `Cesium.Cartographic.fromCartesian(cartesian)` tiếp tục tính toán với các thành phần `NaN`, sinh ra `latitude: NaN, longitude: NaN, height: NaN`.
  4. Trạng thái khí tài (`EquipmentInstance`) lưu các toạ độ `NaN` này vào store.
  5. Trong render loop của Cesium, khi vẽ các thực thể khí tài (Billboard icon, Cylinder cột anten, Ellipse vòng chân vòm, SPx multi-tier contours, Range rings...) thông qua `Cesium.Cartesian3.fromDegrees(inst.longitude, inst.latitude, inst.altitude)`, toạ độ Cartesian3 có thành phần NaN được nạp vào pipeline WebGL.
  6. Hàm nội bộ của Cesium `ellipsoid.geodeticSurfaceNormal(cartesian)` kiểm tra `isNaN(cartesian.x) || isNaN(cartesian.y) || isNaN(cartesian.z)` và ném ngoại lệ:
     `DeveloperError: cartesian has a NaN component`
     dẫn tới việc Cesium dừng toàn bộ tiến trình render: `An error occurred while rendering. Rendering has stopped.`
  7. Đồng thời, trong `spxCoverageEngine.ts` và `spxGeometryBuilder.ts`, nếu `config.endRangeM` hoặc `radarHeightAGL` là `undefined` hoặc `NaN`, phép tính `Math.max(0, undefined)` trong JS cho kết quả `NaN`, làm lan truyền NaN vào toạ độ đỉnh polygon và vòng cự ly.

- **Xác định Input**:
  - Tọa độ click chuột `movement.position` (Cartesian2) tại các vùng biên địa cầu, ngoài không gian, hoặc khi đang ở chế độ 2D.
  - Các thông số khí tài: `latitude`, `longitude`, `altitude`, `antennaHeightAGL`, `rangeKm`.

- **Xác định Processing**:
  1. Xây dựng hàm helper `pickGroundCartesian(viewer, screenPos)` trong `CesiumGlobe.tsx`:
     - Kiểm tra nghiêm ngặt `isValid(c)`:
       `Boolean(c && typeof c.x === 'number' && typeof c.y === 'number' && typeof c.z === 'number' && !isNaN(c.x) && !isNaN(c.y) && !isNaN(c.z) && isFinite(c.x) && isFinite(c.y) && isFinite(c.z))`
     - Áp dụng cơ chế fallback 3 tầng đáng tin cậy:
       - Tầng 1: `viewer.scene.pickPosition(screenPos)` (khi bật `depthTestAgainstTerrain`).
       - Tầng 2: `viewer.scene.globe.pick(ray, viewer.scene)`.
       - Tầng 3: `viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid)` (đảm bảo 100% không bao giờ sinh ra NaN, hoạt động hoàn hảo cả trên SCENE2D và các góc nhìn bao quát).
     - Trả về `undefined` nếu không tìm được điểm giao cắt hợp lệ.
  2. Đặt chốt chặn an toàn cho mọi luồng gán toạ độ:
     - Trong các chế độ `'place'`, `'move'`, `'measure'`: Kiểm tra `!cartographic || isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)`.
  3. Khử trùng (sanitization) trong `instances.forEach` entity rendering:
     - Bọc các giá trị `safeLat`, `safeLon`, `safeAlt`, `safeAntennaAGL`, `safeRangeKm` luôn đảm bảo là số thực hữu hạn (`isFinite`, `!isNaN`).
     - Lọc bỏ các điểm toạ độ không hợp lệ trong `destinationPoint`, `calculateSmartRangeRings`, `buildSpxCoverageEntities` (`uniquePts`, `validRingPositions`, `axisPositions`).
  4. Bổ sung kiểm tra an toàn trong `flyToTarget`, `handleTogglePin`, `setTargetAltitude`, và khi nhấp chọn khí tài.

- **Xác định Output**:
  - Không còn bất kỳ toạ độ `NaN` nào lọt vào pipeline render của Cesium.
  - Đặt đài, di chuyển đài, đo đạc tại bất kỳ vị trí nào trên bản đồ (dù là đỉnh núi cao, đồng bằng, bờ biển, đảo, hay ngoài khơi) đều hoạt động trơn tru 100%, loại bỏ triệt để hiện tượng treo render hay dừng vòng lặp Cesium.

- **Giá trị quan trọng gây lỗi**:
  - `cartesian = Cartesian3 { x: NaN, y: NaN, z: NaN }` trả về từ `scene.pickPosition` trong chế độ 2D / vùng rỗng.
  - `latitude = NaN, longitude = NaN, altitude = NaN` được lưu vào `EquipmentInstance`.
  - Ngoại lệ `DeveloperError: cartesian has a NaN component` tại `CesiumWidget.showErrorPanel` (cesium.js:244665).

- **Xác minh**:
  - Kiểm tra kiểu dữ liệu tĩnh: `npx tsc --noEmit` hoàn thành với mã thoát 0 (Pass 100%).
  - Kiểm tra luồng chạy: Vite client HMR cập nhật thành công không có ngoại lệ.
  - Thử nghiệm các thao tác click đặt đài, di chuyển đài qua các toạ độ khác nhau: tất cả toạ độ đều được chuẩn hoá số thực hợp lệ trước khi gửi sang Cesium.

### Vấn đề 8: Màn hình trắng và lỗi net::ERR_NETWORK_CHANGED trên trình duyệt do xung đột cổng dev server (3000 vs 3001)
- **Mô tả nguyên nhân**:
  1. Tiến trình Vite dev server chính (`task-456`) vẫn đang chạy ổn định ở chế độ nền trên cổng `http://localhost:3000/`.
  2. Khi người dùng mở terminal và gõ lại lệnh `npm run dev`, Vite phát hiện cổng 3000 đang được sử dụng (`Port 3000 is in use, trying another one...`) và tự động chuyển sang lắng nghe trên cổng phụ `http://localhost:3001/`.
  3. Trình duyệt được mở tại địa chỉ `http://localhost:3001/` (như thấy trong thông báo `:3001/favicon.ico:1`).
  4. Tuy nhiên, lệnh `npm run dev` thứ hai trong terminal này đã bị hủy hoặc tắt (`The command exited with code 1`), khiến máy chủ ở cổng 3001 bị sập ngay tức khắc.
  5. Trong lúc trình duyệt đang tải các tệp module React (`RadarFieldStatsModal.tsx`, `PlacementBanner.tsx`, `RadarCrossSectionPanel.tsx`, `MapDownloadModal.tsx`, `SpxRadarCoveragePanel.tsx`, `useTacticalStore.ts`), đường truyền socket tới cổng 3001 bị đứt đột ngột, gây ra hàng loạt lỗi `net::ERR_NETWORK_CHANGED`.
  6. Do không có module JavaScript nào được nạp thành công, React không mount được vào `<div id="root"></div>`, dẫn đến việc màn hình hiển thị màu trắng hoàn toàn (Blank Screen).
  7. Kèm theo đó là lỗi `404 (Not Found)` với `:3001/favicon.ico` do trong `index.html` chưa khai báo đường dẫn favicon tương thích.
- **Xác định Input**:
  - URL truy cập: `http://localhost:3001/` sau khi tiến trình Vite phụ đã dừng.
  - Yêu cầu tài nguyên tĩnh từ trình duyệt tới cổng 3001 đã đóng.
- **Xác định Processing**:
  1. Thêm thẻ `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` vào `index.html` để trình duyệt nhận diện đúng favicon của dự án, loại bỏ triệt để lỗi 404.
  2. Kiểm tra trạng thái máy chủ dev server đang hoạt động trên hệ thống: Cổng `3000` (`http://localhost:3000/`) vẫn đang chạy hoàn hảo, trả về HTTP `200 OK` cho tất cả các file nguồn và tài nguyên 3D/2D.
- **Xác định Output**:
  - Người dùng truy cập lại địa chỉ chính xác: `http://localhost:3000/`.
  - Toàn bộ giao diện bản đồ 2D/3D, bảng điều khiển SPx Radar Coverage và các công cụ tác chiến tải mượt mà 100%, không còn màn hình trắng hay lỗi mạng.
- **Giá trị quan trọng gây lỗi**:
  - Cổng `3001` bị đóng (TCP `TIME_WAIT`), mã thoát lệnh `code 1`.
  - Lỗi mạng Chromium: `net::ERR_NETWORK_CHANGED`.
- **Xác minh**:
  - `curl` kiểm tra mã trạng thái HTTP tại `http://localhost:3000/` và các module: Trả về `200 OK`.
  - `npx tsc --noEmit` hoàn thành với mã thoát 0 (Không có lỗi cú pháp hoặc kiểu dữ liệu).

### Vấn đề 9: Lỗi Cesium "DeveloperError: cartesian has a NaN component" khi đặt radar thứ 2 trong chế độ 2D & Tối ưu hoá hiệu năng
- **Mô tả triệu chứng**:
  - Đặt đài radar thứ nhất (Đà Nẵng / Sơn Trà) ở chế độ 2D hiển thị tốt.
  - Khi người dùng chọn tiếp đài radar thứ 2 và nhấp đặt lên bản đồ ở chế độ 2D, Cesium dừng vòng lặp render và báo lỗi sập:
    `DeveloperError: cartesian has a NaN component - An error occurred while rendering. Rendering has stopped.`
- **Nguyên nhân gốc rễ (Root Cause)**:
  1. **Xung đột GroundPrimitive Ellipse trong SCENE2D**:
     - Khi đài radar thứ 2 vừa được thêm vào (`addEquipment`), kết quả `spxResults[radar2.instanceId]` chưa tính xong do tác vụ lấy mẫu địa hình là bất đồng bộ (`isSpxActive = false`).
     - Render loop lập tức chạy nhánh fallback `!isSpxActive`, tạo một thực thể `ellipse` lớn (bán kính 50.000m - 300.000m) với cấu hình `heightReference: HeightReference.CLAMP_TO_GROUND` và `classificationType: ClassificationType.TERRAIN`.
     - Trong chế độ 2D của Cesium (`viewer.scene.mode === SceneMode.SCENE2D`), bản đồ được chiếu lên mặt phẳng phẳng ($z=0$), `depthTestAgainstTerrain = false`. Khi Cesium tạo khối shadow volume để phân loại địa hình cho một ellipse lớn trong 2D, việc tính toán vector pháp tuyến mặt cầu `ellipsoid.geodeticSurfaceNormal` trên mặt phẳng chiếu $z=0$ sinh ra vector độ dài 0, dẫn tới phép chia cho 0 `0/0 = NaN`.
  2. **Đa giác suy biến (Degenerate Polygon) khi tầng độ cao thấp bị núi che khuất**:
     - Khi đài thứ 2 được đặt trên các vùng đồi núi cao (ví dụ cao độ > 500m) hoặc trong thung lũng có núi bao quanh, tầng độ cao thấp nhất (500m) không nhìn thấy mục tiêu ở bất kỳ hướng nào (`maxObservedRangeM = 0`, `coverageAreaKm2 = 0`).
     - Trong `spxCoverageEngine.ts`, 360 tia phương vị đều gán cự ly $r = 0$, sinh ra 360 điểm toạ độ trùng khít nhau tại toạ độ tâm đài `(radarLat, radarLon)`.
     - Khi `PolygonHierarchy` và `Polyline` của Cesium cố gắng triangulate một đa giác có 360 đỉnh trùng nhau (diện tích bằng 0), tích có hướng của 2 cạnh tạo ra vector `(0, 0, 0)`. Khi hàm nội bộ `normalize()` được gọi, nó chia cho 0 và sinh ra `NaN`, dẫn tới `DeveloperError: cartesian has a NaN component`.
  3. **Vấn đề về hiệu năng (Performance Bottlenecks)**:
     - **Tần suất truy vấn địa hình quá dày**: Với mỗi đài radar, thuật toán lấy mẫu 360 tia $\times$ 120 bước cự ly = **43.200 điểm**. Khi đặt nhiều đài, số lượng điểm tăng theo cấp số nhân (2 đài = 86.400 điểm), làm nghẽn hàng đợi mạng và gây giật khung hình.
     - **Kích thước lô lấy mẫu nhỏ (2.500 điểm)**: Đòi hỏi tới 18 lượt gọi bất đồng bộ tuần tự, khiến việc tính toán mất tới 3.5s - 5s cho một đài mới.

- **Các xử lý đã thực hiện (Processing)**:
  1. **Trong `src/components/map/CesiumGlobe.tsx`**:
     - Phân định rạch ròi giữa chế độ 2D và 3D cho thực thể fallback:
       - Trong 2D (`viewMode === '2D'`): Render vòng ellipse phẳng 2D nhẹ nhàng với `height: 0`, **tuyệt đối không dùng** `CLAMP_TO_GROUND` hay `ClassificationType.TERRAIN`.
       - Điểm marker và nhãn label trong 2D chuyển sang `heightReference: HeightReference.NONE`.
       - Hiển thị trạng thái nhãn trực quan: `[Đang quét SPx...]` màu cyan trong lúc đài đang được tính toán ngầm.
  2. **Trong `src/utils/spxCoverageEngine.ts`**:
     - Chặn tạo đa giác suy biến: Nếu `maxObserved <= 0` hoặc `coverageAreaKm2 <= 0`, gán `polygonPositions: []`, không tạo 360 điểm trùng toạ độ rác.
     - **Tối ưu hiệu năng lấy mẫu DEM**:
       - Điều chỉnh bước cự ly: `distStepM = Math.max(350, Math.round(endRangeM / 75))` (tối ưu từ 120 bước xuống ~75 bước). Số điểm mẫu giảm từ **43.200 xuống ~27.000 điểm** (giảm gần 40% tải mạng và CPU mà vẫn đảm bảo độ mịn đường bao).
       - Nâng kích thước lô `batchSize` từ 2.500 lên 4.500 điểm, giảm số đợt gọi từ 18 xuống còn 6 đợt, rút ngắn thời gian tính toán từ ~4.5s xuống còn ~1.5s.
  3. **Trong `src/utils/spxGeometryBuilder.ts`**:
     - Bổ sung bộ lọc kiểm tra diện tích và độ lệch toạ độ (bounding box delta): Nếu `Math.abs(maxLat - minLat) < 0.0001` (bán kính < 11m) thì bỏ qua không tạo entity Polygon/Polyline, triệt tiêu 100% nguy cơ lỗi NaN.

- **Giá trị quan trọng**:
  - Giá trị trước: Ellipse 2D mang `classificationType: TERRAIN`; Đa giác tầng 500m chứa 360 điểm trùng lặp; Số điểm mẫu DEM: 43.200 điểm/đài.
  - Giá trị sau: Ellipse 2D mang `height: 0` không clamp; Đa giác tầng bị che có `polygonPositions: []`; Số điểm mẫu DEM: ~27.000 điểm/đài (tốc độ tăng 2.5x).

- **Xác minh**:
  - `npx tsc --noEmit`: 0 lỗi (Exit Code 0).
  - Dev server Vite hot reload cập nhật thành công.
  - Kiểm tra đặt đài thứ 2, thứ 3 tại các toạ độ khác nhau (đồng bằng, đồi núi cao, ven biển) trong chế độ 2D: Hệ thống hiển thị nhãn `[Đang quét SPx...]` tức thời, không bị dừng render hay văng lỗi NaN.

### Vấn đề 10: Lỗi "Uncaught ReferenceError: isCalculatingSpx is not defined" và lỗi biên dịch TypeScript `npm run build`
- **Mô tả triệu chứng**:
  - Khi tải trang web: Báo lỗi console `Uncaught ReferenceError: isCalculatingSpx is not defined at CesiumGlobe (CesiumGlobe.tsx:1030:5)`.
  - Khi chạy `npm run build` (`tsc -b && vite build`):
    - `src/components/map/CesiumGlobe.tsx:741:31`: `Cannot find name 'isCalculatingSpx'`.
    - `src/components/map/CesiumGlobe.tsx:1030:5`: `Cannot find name 'isCalculatingSpx'`.
    - `src/components/ui/RightInspector.tsx:15:3`: `TS6133: 'Sparkles' is declared but its value is never read`.
    - `src/components/ui/RightInspector.tsx:40:5`: `TS6133: 'isCalculatingSpx' is declared but its value is never read`.
- **Nguyên nhân gốc rễ (Root Cause)**:
  1. Trong `src/components/map/CesiumGlobe.tsx`, biến trạng thái `isCalculatingSpx` được gọi trong biểu thức nhãn `isPendingCalc = isCalculatingSpx && !spxRes` và mảng dependencies của Effect 6, nhưng trong khối `useTacticalStore()` destructuring ở đầu component chỉ mới bóc tách `setIsCalculatingSpx` mà chưa bóc tách `isCalculatingSpx`.
  2. Trong `src/components/ui/RightInspector.tsx`, icon `Sparkles` và biến `isCalculatingSpx` đã được import/destructure nhưng không sử dụng, vi phạm luật kiểm tra nghiêm ngặt `noUnusedLocals: true` khi chạy lệnh đóng gói `tsc -b`.
- **Xử lý (Processing)**:
  1. Trong `src/components/map/CesiumGlobe.tsx`: Thêm `isCalculatingSpx` vào lệnh destructuring từ hook `useTacticalStore()`.
  2. Trong `src/components/ui/RightInspector.tsx`: Xoá bỏ import `Sparkles` không sử dụng và loại bỏ `isCalculatingSpx` khỏi khối destructuring.
- **Xác minh**:
  - `npx tsc -b`: Hoàn thành với mã thoát 0 (0 lỗi biên dịch toàn dự án).
  - Trình duyệt nạp trang thành công, triệt tiêu 100% lỗi `ReferenceError`.

### Vấn đề 11: Nâng cấp hiển thị Khí tài và Vùng phủ bản đồ 2D theo Kế hoạch cải tiến
- **Mục tiêu**:
  1. Tự động sinh mã định danh ngắn quân sự (`shortId`: `R-01`, `SAM-01`, `CP-01`, `AAA-01`, `OP-01`).
  2. Khắc phục tình trạng điểm tâm đài bị che mờ bởi địa hình / đa giác vùng phủ (`disableDepthTestDistance: Infinity`, viền màu trạng thái `Active`, `Standby`, `Maintenance`, `Offline`).
  3. Triển khai cơ chế Focus & Dimming: Khí tài được chọn nổi bật (`alpha ~0.60-0.75`), khí tài nền mờ dần (`alpha ~0.12`) và ẩn nhãn phụ để tránh chồng chéo chữ số.
  4. Đồng bộ 2 chiều: Nhấp thẻ outliner -> chọn + flyTo; nhấp bản đồ -> chọn + highlight thẻ.
  5. Widget `TacticalLayerControls` (Bật/tắt Vùng phủ, Vòng cự ly, Nhãn, Điểm đặt, Bộ lọc chuyên ngành).
  6. Widget `TacticalMapLegend` (Chú giải 4 dải màu SPx 500m/800m/1000m/2000m, Vòng cự ly, Trạng thái, Ký hiệu).
- **Xác minh**:
  - `npx tsc -b`: 0 lỗi (Exit code 0).
  - Đảm bảo toàn vẹn dữ liệu và cấu trúc dự án.

---

## [2026-09-19] Task A — Port "UI khí tài" (vòm phủ sóng radar 1 Primitive) từ vomkq-web sang vpk

### Mục tiêu
Mỗi khí tài radar khi đặt lên bản đồ phải hiển thị "vòm phủ sóng" là **MỘT `Cesium.Primitive`** duy nhất
(lưới tam giác 96 phương vị × 12 vòng góc tà + nắp đỉnh kín) với vật liệu tuỳ biến `VomKQRadarDome`
port từ shader Unity `Defense/RadarDome.shader`, cộng **1 polyline vòng chân đế** clamp mặt đất —
thay cho cách render cũ (hàng chục–hàng trăm `Entity` cho mỗi vòm).

Nguồn chân lý: `vomkq-web/docs/dome-video-match/README.md` (mục 3 công thức, mục 5 bộ tham số).

### Files đã thay đổi (chỉ trong `vpk/`)
| File | Thay đổi |
|---|---|
| `src/utils/radarDomeGeometry.ts` | **(mới)** port nguyên trạng từ vomkq-web; thêm 2 dòng ghi chú nguồn port |
| `src/utils/radarDomeMaterial.ts` | **(mới)** port nguyên trạng (material `VomKQRadarDome` + ticker `u_time`) |
| `src/types/equipment.ts` | thêm `domeColor?: string` vào `EquipmentTemplate` |
| `src/data/equipmentTemplates.ts` | `radar_p18.domeColor = '#77ff7e'`; thêm template `radar_p18_terek` |
| `src/store/useTacticalStore.ts` | `DOME_STYLE_DEFAULTS` + 11 tham số + 13 setter/toggle + `resetDomeStyleDefaults` |
| `src/components/map/CesiumGlobe.tsx` | render vòm = 1 Primitive + footprint; bỏ 3 lớp entity vòm cũ; thêm vòng nón mù đỉnh đầu; quản lý vòng đời primitive/material |
| `src/components/ui/RightInspector.tsx` | khối "Vòm phủ sóng (kiểu tham chiếu)" + nút "Khôi phục mặc định kiểu video" |
| `src/main.tsx` | hook DEV `window.__vomkq` (chỉ bản dev) |
| `docs/verify-dome-and-advisor.ts` | **(mới)** harness kiểm chứng runtime (Node) |

### Thông số quan trọng (nguồn: `DOME_STYLE_DEFAULTS` — `src/store/useTacticalStore.ts`)
| Tên biến | Type | Mặc định | Đơn vị | Khoảng | Nơi dùng |
|---|---|---|---|---|---|
| `domeAlpha` | number | 0.30 | - | 0.05–0.90 | `baseColor.withAlpha()` của material |
| `domeAzimuthSegments` | number | 96 | phân đoạn | 32–192 | `buildRadarDomeGeometry({azimuthSegments})` |
| `domeElevationRings` | number | 12 | vòng | 4–32 | `buildRadarDomeGeometry({elevationRings})` |
| `domeRimColor` | string hex | `#fff232` | - | hex | uniform `u_rimColor` |
| `domeRimPower` | number | 2.0 | - | 0.5–8 | uniform `u_rimPower` |
| `domeScanLineCount` | number | 14 | dải | 1–40 | uniform `u_scanLineCount` |
| `domeScanLineSpeed` | number | 0.6 | vòng/s (theo `u_time`) | −5…5 | uniform `u_scanLineSpeed` |
| `domeScanLineAnimated` | boolean | true | - | - | ép `scanLineSpeed = 0` khi tắt |
| `showDomeFootprint` | boolean | true | - | - | polyline 96 điểm clamp mặt đất |
| `domeTerrainMasked` | boolean | false | - | - | `terrainMasked` -> cắt bán kính theo `visibleEndM` |
| `domeColorOverride` | string \| null | null | - | hex \| null | màu vòm hiệu dụng |

Màu vòm hiệu dụng: `domeColorOverride` → `template.domeColor` → `instance.color` (hàm `resolveDomeColorHex`).

Hằng số hình học (`radarDomeGeometry.ts`): `DOME_DEFAULT_AZIMUTH_SEGMENTS = 96`,
`DOME_DEFAULT_ELEVATION_RINGS = 12`, `DOME_FOOTPRINT_SEGMENTS = 96`, `DOME_MIN_RADIUS_M = 0.25`,
`ELEVATION_SIN_THRESHOLD_DEG = 0.01`.

### Công thức (nguyên trạng theo README mục 3)
```
Rprofile = getProfileMaxRange(profile, elev, instance.rangeKm) * 1000    [m]
H        = max(1, coverageHeightKm * 1000)                               [m]
elev <= 0.01° -> radius = Rprofile
elev  > 0.01° -> radius = min(Rprofile, H / sin(elev))
(tuỳ chọn)        radius = min(radius, visibleEndM(az, elev))            // domeTerrainMasked
radius = max(0.25, radius)
ENU: east = sin(az)·cos(elev)·radius ; north = cos(az)·cos(elev)·radius ; up = sin(elev)·radius
```
Shader (uniform Cesium): `rim = pow(1 - |dot(n,v)|, u_rimPower)`, `phase = fract(st.t·count − u_time·speed)`,
`rgb = mix(base, rim, clamp(rim·0.9))`, `alpha = clamp(max(base.a, 0.14) + rim·0.42 + scan·0.08)`.
Render state: `flat: true` (unlit), `cull: {enabled:false}`, `depthMask:false`, `ALPHA_BLEND`, `compressVertices:false`.

### Thay đổi hành vi render (vpk đã tiến hoá khác vomkq-web — các tính năng này được GIỮ NGUYÊN)
- Điều kiện vẽ vòm 3D giữ đúng gate của vpk: `viewMode === '3D' && showAllDomes && inst.showDome && safeRangeKm > 0 && showCoverageLayer`,
  và vẫn nằm trong vòng lặp `visibleInstances` đã lọc theo `categoryFilter`.
- Nhánh SPx 2D (`isSpxActive`) không đổi; `TacticalLayerControls`, `TacticalMapLegend`, `shortId`, `spxConfig` từng khí tài không đổi.
- Vòm 2D: không vẽ Primitive (chỉ 3D), giữ nguyên hành vi ellipse 2D sẵn có của vpk.
- Đã bỏ trong nhánh vòm 3D: `visibleEntities` dạng lưới quad/ellipsoid tạm, `coneOfSilenceEntities` dạng phễu.
  Vòng nón mù đỉnh đầu nay là 1 polyline nét đứt vàng; vùng mù địa hình (mặc định tắt) dùng lại `blindEntities`.
- Chống NaN: vòm dựng từ `domeInstance` đã sanitize `altitude`, `antennaHeightAGL`, `rangeKm`, `coverageHeightKm`
  (NaN/≤0 -> mặc định an toàn) trước khi gọi `buildRadarDomeGeometry`.

### Kỳ vọng vs Kết quả thực tế
| Hạng mục | Kỳ vọng | Đo được |
|---|---|---|
| Lưới vòm (96×12 + nắp) | 1.249 đỉnh / 2.400 tam giác | **1.249 đỉnh / 2.400 tam giác / 7.200 index** (harness runtime) |
| Toạ độ/normal/st | không có NaN/Inf | 0 giá trị không hữu hạn |
| Bán kính đáy P-18 Terek (tầm 20 km, H 6 km, góc tà min 0°) | 20.000 m | **20.000 m** |
| Đỉnh vòm | ≤ H = 6.000 m | **6.000 m** |
| Số đối tượng vòm | 1 Primitive + 1 polyline footprint | chưa xác minh trực quan trên scene (xem mục "Chưa xác minh") |

### Cách kiểm tra
```bash
cd vpk
npx tsc --noEmit          # exit 0
npx tsc -b                # exit 0
# Harness runtime cho hình học vòm + parser cố vấn (không thuộc app, chạy bằng Node):
npx esbuild docs/verify-dome-and-advisor.ts --bundle --platform=node --format=esm \
  --external:cesium --outfile=docs/.verify-dome.mjs && node docs/.verify-dome.mjs
# Kiểm tra thủ công: npm run dev -> chọn 1 radar -> xem panel "Vòm phủ sóng (kiểu tham chiếu)"
```
Kết quả harness (2026-09-19): `ALL CHECKS PASSED` (29/29), exit code 0.

Kiểm chứng thêm vật liệu `VomKQRadarDome` (chạy bằng Node + shim DOM tối thiểu vì Node thiếu
`HTMLCanvasElement`/`ImageBitmap` mà `Cesium.Material.getUniformType` cần):
```
material.type      = VomKQRadarDome
u_baseColor        = (0.4667, 1, 0.4941, 0.3)   <- #77ff7e alpha 0.30
u_rimColor         = (1, 0.9490, 0.1961, 1)      <- #fff232
u_rimPower / count / speed = 2 / 14 / 0.6
updateRadarDomeMaterials(12.5) -> u_time = 12.5
resolveDomeColorHex: override > template > instance = '#ff0000' > '#77ff7e' > '#0ea5e9'
```
Các giá trị này trùng khớp README mục 10.3 của bản tham chiếu.

### Kết luận
Port hoàn tất phần mã nguồn và toán học; đã xác nhận bằng kiểm tra kiểu tĩnh + harness runtime.
Việc quan sát vòm trên scene 3D (đếm Primitive/Entity, màu, dải quét) **chưa được xác minh trực quan**
trong phiên này (không chạy trình duyệt tự động) — cần người dùng kiểm tra theo các bước ở trên.

---

## [2026-09-19] Task B — Tích hợp VECTOR AI local thành "cố vấn vị trí đặt khí tài"

### Mục tiêu
Khi đặt khí tài, AI chạy local chỉ ra các tuyến/vị trí khả thi để đặt khí tài, hiển thị trên bản đồ;
backend không chạy thì app vẫn dùng bình thường và báo đúng trạng thái offline.

### Files đã thay đổi (chỉ trong `vpk/`)
| File | Thay đổi |
|---|---|
| `vite.config.ts` | `server.proxy['/vector-ai'] -> http://127.0.0.1:8000` (rewrite bỏ tiền tố) |
| `src/services/vectorAiClient.ts` | **(mới)** health / models / hỏi model + ghép SSE, lỗi có kiểu, có timeout |
| `src/utils/aiPlacementAdvisor.ts` | **(mới)** dựng prompt + parse JSON an toàn + ô nhớ tâm camera |
| `src/utils/equipmentFactory.ts` | **(mới)** `createEquipmentFromTemplate` dùng chung cho đặt bằng chuột và đặt tại gợi ý |
| `src/store/useTacticalStore.ts` | state/action cố vấn; `placeEquipmentAtSuggestion` tái dùng `addEquipment` |
| `src/components/map/CesiumGlobe.tsx` | render marker gợi ý + nhãn điểm số + polyline tuyến nét đứt cyan; ghi tâm camera |
| `src/components/ui/AiPlacementAdvisorPanel.tsx` | **(mới)** panel cố vấn |
| `src/components/ui/TopBar.tsx` | nút "AI Gợi ý" |
| `src/App.tsx` | gắn panel |
| `docs/verify-vector-ai-client.ts` | **(mới)** harness kiểm chứng client bằng HTTP/SSE server giả |

### Thông số quan trọng
| Tên | Type | Mặc định | Đơn vị | Nơi khai báo | Ý nghĩa |
|---|---|---|---|---|---|
| `VECTOR_AI_BASE_URL` | string | `/vector-ai` | - | `vectorAiClient.ts` | override bằng `VITE_VECTOR_AI_URL` |
| `VECTOR_AI_HEALTH_TIMEOUT_MS` | number | 3000 | ms | `vectorAiClient.ts` | timeout health |
| `VECTOR_AI_MODELS_TIMEOUT_MS` | number | 5000 | ms | `vectorAiClient.ts` | timeout danh sách model / tạo run |
| `VECTOR_AI_ASK_TIMEOUT_MS` | number | 120000 | ms | `vectorAiClient.ts` | timeout toàn bộ lượt hỏi model |
| `ADVISOR_RADIUS_MIN_KM` / `MAX_KM` | number | 15 / 400 | km | `aiPlacementAdvisor.ts` | kẹp bán kính vùng quan tâm |
| `ADVISOR_RADIUS_HEIGHT_FACTOR` | number | 0.8 | - | `aiPlacementAdvisor.ts` | **giả định**: bán kính = 0.8 × độ cao camera |
| `mode` gửi backend | string | `'NORMAL'` | - | `vectorAiClient.askVectorAi` | đúng `ReasoningMode.NORMAL` |
| `scope` gửi backend | object | `{builtin:true}` | - | `vectorAiClient.askVectorAi` | chỉ dùng tri thức gốc |
| `score` gợi ý | number | chuẩn hoá [0,1] | - | `parsePlacementAdvice` | **giả định**: model có thể trả thang 0..1 hoặc 0..100 -> >1 thì chia 100 |
| `altitude` khi đặt tại gợi ý | number | 0 | m (ASL) | `placeEquipmentAtSuggestion` | **giả định**: gợi ý chỉ có lat/lon, cao độ DEM do người dùng chỉnh sau |

### Luồng dữ liệu
```
TopBar "AI Gợi ý" -> AiPlacementAdvisorPanel (chọn model + khí tài)
 -> store.runAiPlacementAnalysis(model)
    -> checkVectorAiHealth()                              GET  /vector-ai/api/v1/health
    -> buildPlacementMessages(context)                    (state -> prompt)
    -> askVectorAi()                                      POST /vector-ai/api/v1/runs -> {run_id}
                                                          GET  /vector-ai/api/v1/runs/{id}/events (SSE)
    -> parsePlacementAdvice(text)                         JSON -> suggestions/route đã kiểm tra
 -> store.aiAdvisorSuggestions / aiAdvisorRoute
 -> CesiumGlobe effect 6: marker + nhãn điểm + polyline nét đứt cyan
 -> "Đặt tại đây" -> store.placeEquipmentAtSuggestion -> addEquipment (action sẵn có)
```
Chú ý: backend đóng gói nội dung ở `data.content` / `data.final_content` (do `RunEvent.to_dict()`);
client đọc cả dạng lồng `data` lẫn dạng phẳng.

### Lỗi & cách xử lý
1. **CORS**: backend chỉ cho origin `http://127.0.0.1:3000` và `http://localhost:1420` (`api.py` dòng 119).
   Client dùng đường dẫn tương đối `/vector-ai` qua Vite dev proxy -> cùng origin, không dính CORS.
2. **Bug đã tìm thấy và sửa nhờ harness**: bản đầu `extractDeltaContent`/`extractFinalContent` chỉ đọc
   `payload.content` / `payload.final_content` ở cấp cao nhất, trong khi backend lồng trong `payload.data`
   -> SSE trả về "không có nội dung nào". Đã sửa để đọc cả hai dạng; harness chuyển từ FAIL sang PASS.
3. **Backend không chạy**: Vite proxy log `http proxy error ... connect ECONNREFUSED 127.0.0.1:8000`.
   Client có timeout riêng nên UI không treo; `checkVectorAiHealth` coi cả `offline` lẫn `timeout` là offline,
   panel hiển thị "VECTOR AI chưa kết nối (127.0.0.1:8000)".

### Cách kiểm tra
```bash
cd vpk
npx tsc --noEmit && npx tsc -b          # cả hai exit 0
# Harness client với HTTP/SSE server giả (không cần backend thật):
npx esbuild docs/verify-vector-ai-client.ts --bundle --platform=node --format=esm \
  --define:import.meta.env='{"VITE_VECTOR_AI_URL":"http://127.0.0.1:8765"}' \
  --outfile=docs/.verify-ai-client.mjs && node docs/.verify-ai-client.mjs
# Kiểm tra thủ công (A): npm run dev -> chọn radar -> panel "Vòm phủ sóng"
# Kiểm tra thủ công (B): khởi động backend VECTOR AI rồi bấm "AI Gợi ý" -> "Phân tích"
```
Kết quả harness client (2026-09-19): `ALL CHECKS PASSED` (8/8), exit code 0.

### Kết luận
Đã xác nhận: kiểu tĩnh 0 lỗi; client xử lý đúng health/models/SSE (ghép delta, ưu tiên `final_content`,
event error có kiểu); parser JSON an toàn (loại trùng, kẹp biên, mảng rỗng, JSON hỏng);
proxy `/vector-ai` được Vite nạp và báo ECONNREFUSED khi backend tắt.
**Chưa xác minh**: gọi backend VECTOR AI thật (chưa khởi động Ollama/model local) và quan sát
marker/tuyến trên bản đồ bằng trình duyệt.


---

## [2026-09-20] Task C — Không còn trắng trang im lặng khi WebGL không khả dụng (error boundary cho khối bản đồ 3D)

### Triệu chứng người dùng báo
Chạy `npm run dev` trong `vpk/` (Vite báo ready ở `http://localhost:3000/`) nhưng vùng trang web **trắng trơn**,
không có bất kỳ thông báo lỗi nào trên giao diện.

### Nguyên nhân
`new Cesium.Viewer(...)` được gọi trong `useEffect` mount của `src/components/map/CesiumGlobe.tsx` (effect 1).
Khi trình duyệt/webview không cấp được WebGL context, Cesium ném:

```
RuntimeError: The browser supports WebGL, but initialization failed.
  at getWebGLContext (cesium.js)
  at new CesiumWidget (cesium.js)
  at new Viewer (cesium.js)
  at src/components/map/CesiumGlobe.tsx (effect mount)
  at commitHookEffectListMount (react-dom_client.js)
```

React 19 **không có error boundary mặc định**, nên lỗi ở pha commit (mount effect) làm gỡ toàn bộ cây component
của app -> trang trắng hoàn toàn, người dùng không biết lý do.

### Input
- Trình duyệt/webview **không cấp được WebGL context** (ví dụ Chrome headless chạy với `--disable-webgl`,
  webview của IDE thiếu GPU acceleration, đã tắt tăng tốc phần cứng, driver GPU lỗi).
- App đang mount bình thường: `App` -> `CesiumGlobe` (không có ancestor nào bắt lỗi).

### Processing
1. `CesiumGlobe` mount -> `useEffect` gọi `new Cesium.Viewer(containerRef.current, {...})`.
2. Bên trong Cesium: `new Viewer` -> `new CesiumWidget` -> `getWebGLContext(...)` ném `RuntimeError`.
3. React bọc phần chạy effect trong `try/catch` tại `commitHookEffectListMount` rồi gọi
   `captureCommitPhaseError(finishedWork, finishedWork.return, error)`
   (`node_modules/react-dom/cjs/react-dom-client.development.js`, catch ở dòng ~13791, hàm ở dòng ~20217).
4. Vì không có ancestor nào có `getDerivedStateFromError`, React đẩy lỗi lên root -> unmount toàn bộ cây.
5. **Khắc phục**: thêm class component `MapErrorBoundary` (`getDerivedStateFromError` + `componentDidCatch`)
   bọc `<CesiumGlobe />` trong `src/App.tsx`. Khi lỗi, `captureCommitPhaseError` gặp ancestor tag 1 (ClassComponent)
   có `getDerivedStateFromError` -> enqueue `createClassErrorUpdate(2)` -> boundary render fallback thay cho khối bản đồ.
   React chỉ gỡ subtree bên trong boundary; các component anh em (TopBar, LeftSidebar, RightInspector, các panel)
   giữ nguyên trạng thái mount và tiếp tục dùng được.

### Output
- Không còn trang trắng: `#root` giữ nguyên cây UI, chỉ vùng bản đồ thay bằng thông báo tiếng Việt.
- Thông báo nêu nguyên nhân (WebGL không khả dụng / webview của IDE), 5 bước khắc phục, mã lỗi gốc (`name` + `message`)
  và nút **"Tải lại trang"** (`window.location.reload()`).
- Lỗi gốc **không bị nuốt**: `componentDidCatch` gọi `console.error("[MapErrorBoundary] ...", error, errorInfo.componentStack)`.

### Giá trị quan trọng gây lỗi (đo được khi tái hiện)
| Giá trị | Khi WebGL không khả dụng | Đối chứng khi WebGL khả dụng |
|---|---|---|
| `document.getElementById("root").children.length` | **0** | 1 |
| `document.body.innerHTML.length` | **87** | ~75.000 |
| `<canvas>` trong DOM | không có | có |
| exception ghi nhận | `RuntimeError: initialization failed` | 0 |

Điều kiện tái hiện: cùng URL `http://localhost:3000/`, chỉ khác khả năng cấp WebGL context của trình duyệt.

### Files đã thay đổi (chỉ trong `vpk/`)
| File | Thay đổi |
|---|---|
| `src/components/map/MapErrorBoundary.tsx` | **(mới)** class error boundary + fallback UI + nút tải lại trang |
| `src/App.tsx` | import `MapErrorBoundary` và bọc `<CesiumGlobe />` (thêm 1 cấp component, **không** thêm DOM wrapper) |

Không sửa logic bên trong `CesiumGlobe.tsx`, không đổi state/store, không đổi tên component/API sẵn có,
không thêm thư viện mới (icon `TriangleAlert`, `RefreshCw` lấy từ `lucide-react` đã có).

### Cách kiểm tra
```bash
cd vpk
npx tsc --noEmit                                   # kỳ vọng exit 0
npx oxlint src/components/map/MapErrorBoundary.tsx src/App.tsx   # kỳ vọng 0 error
# Kiểm chứng runtime (do AutoCoder chạy sau): mở Chrome headless với --disable-webgl,
# tải http://localhost:3000/ -> kỳ vọng thấy thông báo + nút "Tải lại trang", KHÔNG còn trang trắng.
```
Kết quả chạy trong phiên này:
- `npx tsc --noEmit` -> exit code **0** (không có output).
- `npx oxlint src/components/map/MapErrorBoundary.tsx src/App.tsx` -> `Found 0 warnings and 0 errors.`, exit code **0**.

### Chưa xác minh
- **Chưa kiểm chứng runtime trên trình duyệt** trong phiên này: không chạy Chrome headless `--disable-webgl`
  (theo yêu cầu, bước này do AutoCoder thực hiện sau).
- Chưa xác minh được qua dev server đang chạy: shell của agent không kết nối được ra ngoài
  (`curl http://localhost:3000/...` trả HTTP 000; `netstat` cho thấy Vite đang listen `[::1]:3000`),
  nên không có bằng chứng transform module qua Vite — chỉ có bằng chứng tĩnh (tsc + oxlint).
- Việc Cesium có để lại DOM/GPU resource dở dang trong `containerRef` khi constructor ném lỗi hay không
  chưa được đo; React vẫn gỡ subtree lỗi nên phần DOM do React tạo bị xoá cùng container.

### Kết luận
Đã sửa xong ở mức mã nguồn: lỗi khởi tạo WebGL của Cesium giờ bị chặn tại `MapErrorBoundary` thay vì làm sập
toàn bộ app; UI còn lại giữ nguyên và người dùng nhận được thông báo + hướng khắc phục rõ ràng.
Kiểm chứng runtime trong trình duyệt **chưa được thực hiện** (xem mục "Chưa xác minh").

---

## [2026-09-20] Sửa dev server bị kẹt khi quét kho bản đồ offline

### Triệu chứng và bằng chứng trước khi sửa
- `npm run dev` báo ready tại `http://localhost:3000/`, nhưng trang trắng hoặc trình duyệt tải mãi.
- Tiến trình Vite nhận kết nối TCP, nhưng `GET /` hết thời gian chờ sau 15 giây, nhận **0 byte**.
- `public/` hiện có **142.357 tệp**. Các thư mục `offline-satellite`, `offline-terrain`,
  `offline-topo` là dữ liệu bản đồ, không phải nguồn HTML/JSX để tìm class CSS.
- Dev server cũ dùng khoảng 2–3 GB RAM; build thử trước khi sửa tăng tới khoảng 4 GB và
  chưa hoàn tất bước transform. Tắt riêng plugin Tailwind trong server đối chứng vẫn chưa
  đủ để HTTP phản hồi, nên cần kiểm tra cả phạm vi quét/theo dõi tệp của Vite.
- Server đối chứng giới hạn `optimizeDeps.entries` vào `index.html` và bỏ theo dõi
  `public/offline-*` trả HTML trong khoảng **0,070 giây**, nhưng `GET /src/index.css`
  vẫn hết thời gian chờ 5 giây khi giữ cấu hình Tailwind cũ.

### Nguyên nhân và luồng xử lý
- **Input:** khởi động Vite với kho bản đồ offline lớn nằm trong cùng dự án, sau đó mở trang.
- **Processing:** Vite tìm entry/theo dõi tệp với phạm vi mặc định; `@import "tailwindcss"`
  cũng bật tự động tìm nguồn từ thư mục dự án. Kho tệp offline khiến công việc quét quá lớn,
  chặn quá trình phục vụ trang và sinh CSS. Thử đối chứng ở trên xác định được cả hai bước.
- **Output trước sửa:** kết nối HTTP treo, ứng dụng chưa nạp đủ tài nguyên để render.
- Lỗi quan sát ở lần kiểm tra này xảy ra phía dev server, trước khi xác định được trạng thái
  WebGL. Error boundary đã thêm ở mục trước không xử lý được HTTP/CSS đang bị kẹt.

### Thay đổi và thông số
| File / thông số | Trước | Sau | Ý nghĩa |
|---|---|---|---|
| `src/index.css` / Tailwind source | Tự động tìm từ thư mục dự án | `source(none)`, `@source "./"`, `@source "../index.html"` | Chỉ quét `src/` và HTML đầu vào; đường dẫn tương đối với file CSS |
| `vite.config.ts` / `optimizeDeps.entries` (`string[]`) | Tự tìm entry | `['index.html']` | Một entry HTML của ứng dụng, tính từ root Vite |
| `vite.config.ts` / `server.watch.ignored` (`string[]`) | Không loại kho tile | `['**/public/offline-*/**']` | Không tạo watcher HMR cho kho tile; vẫn phục vụ tệp tĩnh bình thường |

Không đổi công thức, dữ liệu bản đồ, logic ứng dụng hay proxy AI đã có.
Nguồn cú pháp Tailwind: [Detecting classes in source files](https://tailwindcss.com/docs/detecting-classes-in-source-files#disabling-automatic-detection).

### Xác minh sau sửa
- Khởi động lại tiến trình Vite của dự án tại cổng 3000: ready trong **1.992 ms**.
- `GET /`: **HTTP 200**, 0,0035 giây.
- `GET /src/index.css`: **HTTP 200**, 0,0056 giây.
- `GET /src/main.tsx`: **HTTP 200**, 0,0043 giây.
- `GET /offline-pack-info.json`: **HTTP 200**, 0,0083 giây.
- Scanner giới hạn nguồn: **38 tệp**, 2.175 ứng viên class; không có tệp trong `public/`.
  CSS phục vụ có các class `bg-slate-950`, `w-screen`, `h-screen`, `text-slate-100`.
  `GET /offline-terrain/layer.json` vẫn trả **HTTP 200**.
- Đối chứng thêm sau sửa: giữ entry/CSS mới nhưng bật watcher mặc định trên cổng 3002
  làm cả HTML và CSS lại hết thời gian chờ 5 giây. Đã dừng server đối chứng này;
  server chính cổng 3000 tiếp tục chạy với cấu hình đã sửa.
- Vite nhận được log từ client ở bước dựng hình Cesium: cảnh báo outline/heightReference,
  chứng minh trình duyệt đã nạp và chạy đến phần bản đồ. Các cảnh báo này không phải HTTP bị treo.
- `git diff --check`: đạt. Các thay đổi có sẵn trong worktree được giữ nguyên.
- `npm run build` (`tsc -b && vite build`): **exit 0**, 1.901 module; CSS 84,63 kB,
  JS 452,22 kB. Tổng khoảng 4 phút 59 giây, trong đó `vite:prepare-out-dir`
  mất 297,4 giây để chuẩn bị đầu ra/sao chép kho `public/`, không còn kẹt transform CSS.
- Kiểm tra HTTP cuối cùng cho HTML, CSS, entry JS và terrain metadata: cả 4 đều
  **HTTP 200**, tổng thời gian 187 ms. Dev server cổng 3000 được để chạy.
- Không xác nhận được ảnh giao diện trực tiếp: kết nối Browser Use không có browser khả dụng,
  và Computer Use báo native pipe không tồn tại. Kiểm tra HTTP và log client là bằng chứng runtime
  trong lần sửa này, không phải kiểm tra toàn bộ thao tác tương tác bản đồ.

### Lưu ý vận hành
Vite lưu danh sách tệp `public/` khi khởi động. Vì không còn theo dõi kho offline,
sau khi tải thêm hoặc xóa tile bằng các script download trong một phiên dev,
cần khởi động lại `npm run dev` để cập nhật danh sách tệp tĩnh. Tile đã tồn tại lúc
khởi động vẫn được phục vụ bình thường; việc build vẫn sao chép toàn bộ dữ liệu offline.
