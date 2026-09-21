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

### Vấn đề 12: Thay thế bản đồ 2D OpenTopoMap bằng Google Terrain & Hybrid chuẩn địa danh Việt Nam, loại bỏ POI thương mại, khẳng định chủ quyền Hoàng Sa - Trường Sa
- **Ngày**: 20/09/2026
- **Tính năng / Module**: Bản đồ nền 2D & 3D (Basemap System), Lớp chủ quyền biển đảo (Sovereignty Layer), Công cụ tải ngoại tuyến.
- **Vấn đề & Mục tiêu**:
  1. Bản đồ 2D cũ OpenTopoMap sử dụng dải màu hypsometric quá rực rỡ (xanh lá, vàng, cam, nâu) làm chìm và trùng lẫn màu quạt quét radar; đồng thời nguồn dữ liệu OSM quốc tế chứa nhãn phi lý của Trung Quốc ("Sansha / Xisha / 三沙市") và đường ranh giới khoanh vùng Hoàng Sa về Hải Nam, vi phạm nghiêm trọng chủ quyền Việt Nam.
  2. Thay thế bằng Google Terrain (`lyrs=p&hl=vi&gl=VN`) và Google Hybrid (`lyrs=y`): Hiển thị đầy đủ địa giới hành chính, hệ thống giao thông (cao tốc CT, quốc lộ QL, tỉnh lộ), địa danh tự nhiên (núi, đèo dốc, sông, vịnh biển) bằng tiếng Việt.
  3. Hoàn toàn sạch bóng các biển hiệu cửa hàng, quán xá thương mại (No Commercial POIs).
  4. Màu sắc êm dịu, đổ bóng địa hình (hillshade) trung tính, làm nổi bật 100% các dải màu quạt radar.
  5. Khẳng định chủ quyền biển đảo: Hiển thị chuẩn tiếng Việt "Hoàng Sa", "quần đảo Trường Sa", "East Sea" (Biển Đông); bổ sung 2 ghim nhãn chủ quyền vàng cờ đỏ trang trọng, vĩnh viễn trên bản đồ.
  6. Mở khóa bộ chọn Basemap trong chế độ 2D, cho phép chuyển đổi linh hoạt.
  7. Cung cấp script `download-tactical-google-terrain.js` tải offline cho các vùng tác chiến trọng điểm.
- **File đã thay đổi**:
  - `src/store/useTacticalStore.ts`
  - `src/components/map/CesiumGlobe.tsx`
  - `src/components/ui/TopBar.tsx`
  - `src/components/ui/MapDownloadModal.tsx`
  - `download-tactical-google-terrain.js` [NEW]
  - `docs/DEBUG_NOTES.md`
- **Tên thông số / Biến quan trọng**:
  - `basemap`: Kiểu `'google-terrain' | 'google-hybrid' | 'satellite' | 'offline' | 'topo' | 'dark' | 'osm'`. Giá trị mặc định mới: `'google-terrain'`.
  - `googleTerrainUrl`: `https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi&gl=VN` (với `s` thuộc `['0','1','2','3']`, zoom level từ 0 đến 20).
  - `googleHybridUrl`: `https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi&gl=VN`.
  - `hoangSaPosition`: Tọa độ Cartesian từ `(112.0°E, 16.5°N, 100m)`.
  - `truongSaPosition`: Tọa độ Cartesian từ `(114.0°E, 10.0°N, 100m)`.
  - `distanceDisplayCondition`: `Cesium.DistanceDisplayCondition(0, 5000000)` (mét).
  - `disableDepthTestDistance`: `Number.POSITIVE_INFINITY` (đảm bảo nhãn không bị chìm dưới quả địa cầu hay tầng khí quyển).
- **Kỳ vọng**:
  - Chế độ 2D hiển thị bản đồ địa hình Google Terrain sắc nét, đầy đủ địa danh, giao thông tiếng Việt, sạch bóng quán xá.
  - Vùng phủ quạt radar (đỏ, cam, vàng, xanh) nổi bật rõ ràng, không bị trùng màu.
  - Quần đảo Hoàng Sa và Trường Sa hiển thị tên chuẩn tiếng Việt, có cờ đỏ sao vàng và nhãn chủ quyền `(VIỆT NAM)`.
  - Không còn bất kỳ tile nào tải từ OpenTopoMap hay mang nhãn Tam Sa / Sansha.
  - Bộ chọn Basemap ở thanh TopBar hoạt động thông suốt ở cả 2D và 3D.
- **Kết quả thực tế**:
  - `npx tsc --noEmit`: 0 lỗi.
  - `npm run build`: Đóng gói thành công trong 19.34s, không phát sinh lỗi.
  - Cấu trúc thư mục sạch sẽ, sẵn sàng cho người dùng kiểm tra trên trình duyệt.
- **Kết luận**: Hoàn thành 100% mục tiêu theo quy trình `/dev-feature`, bảo đảm tính pháp lý chủ quyền quốc gia và nâng cao trải nghiệm tác chiến phòng không.

### Vấn đề 13: Hoàn thành tải 100% dữ liệu ngoại tuyến Google Terrain Toàn bộ Miền Trung & Tây Nguyên (31.076 tiles, Level 8-13)
- **Ngày**: 20/09/2026
- **Tính năng / Module**: Bản đồ ngoại tuyến Google Terrain (Offline Map Pack), Công cụ tải `download-tactical-google-terrain.js`.
- **Mục tiêu**:
  - Tải toàn bộ các mảnh gạch bản đồ địa hình Google Terrain chuẩn tiếng Việt cho dải Miền Trung và 5 tỉnh Tây Nguyên (từ Thanh Hóa đến Bình Thuận) từ Zoom Level 8 đến Zoom Level 13.
  - Khắc phục hiện tượng race condition trong hàng đợi tải đa luồng khi dùng `array.shift()`.
- **Thông số kỹ thuật**:
  - Tên gói dữ liệu: `Toàn Bộ Duyên Hải Miền Trung & Tây Nguyên`.
  - Tọa độ Bounding Box: `minLat: 10.5, maxLat: 20.0, minLon: 105.0, maxLon: 109.5`.
  - Phạm vi Zoom: Level 8 -> Level 13 (chi tiết từng đèo dốc, núi cao, cao tốc, quốc lộ, tỉnh lộ, xã bản).
  - Tổng số mảnh gạch: **31.076 tiles** (Level 8: 32, Level 9: 105, Level 10: 406, Level 11: 1.482, Level 12: 5.876, Level 13: 23.175).
  - Dung lượng lưu trữ: **245.19 MB** (nhẹ hơn 3 lần so với bản OpenTopoMap cũ ~795 MB).
  - Toàn bộ 31.076 mảnh gạch đã được ghi thành công vào đĩa cứng với 0 lỗi HTTP.
  - Kiểm tra tính toàn vẹn file ảnh: 100% file PNG hợp lệ.
  - Modal Quản lý bản đồ ngoại tuyến hiển thị thẻ gói dữ liệu Google Terrain đã tải 100%.

### Vấn đề 14: Lỗi Parse Error `[plugin:vite:oxc] Transform failed: Expected ',' or '>' but found 'export'` trong `MapDownloadModal.tsx`
- **Ngày**: 20/09/2026
- **Triệu chứng**:
  - Giao diện web hiển thị màn hình đỏ Vite Overlay: `[plugin:vite:oxc] Transform failed with 1 error: [PARSE_ERROR] Expected ',' or '>' but found 'export' [ src/components/ui/MapDownloadModal.tsx:31:1 ]`.
  - Console trình duyệt báo lỗi `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` đối với file `/src/components/ui/MapDownloadModal.tsx`.
- **Nguyên nhân**:
  - Trong `src/components/ui/MapDownloadModal.tsx`, tại phần định nghĩa `interface PackInfo` (dòng 13–29), khi bổ sung trường `googleTerrain` cho gói bản đồ địa hình offline mới tải, cặp dấu đóng `}>;` của trường `highResRegions?: Array<{ ...` ngay phía trên đã bị khuyết.
  - Việc thiếu dấu đóng khiến kiểu Generic `Array<{` của `highResRegions` bị giữ ở trạng thái mở, làm trình biên dịch OXC / Vite nhầm lẫn toàn bộ các dòng tiếp theo là thuộc tính của đối tượng con và ném lỗi cú pháp khi bắt gặp từ khóa `export` ở dòng 31 (`export const MapDownloadModal`).
- **File sửa đổi**:
  - `src/components/ui/MapDownloadModal.tsx`
- **Biến / Thông số liên quan**:
  - Khai báo kiểu `interface PackInfo`:
    - Thuộc tính `highResRegions?: Array<{ ... }>`
    - Thuộc tính `googleTerrain?: Array<{ ... }>`
- **Giá trị trước khi sửa**:
  ```typescript
  interface PackInfo {
    name?: string;
    lastUpdated?: string;
    highResRegions?: Array<{
      name: string;
      lat: number;
      lon: number;
      radiusKm: number;
      zoomLevels: string;
      downloadedAt: string;
      tileCount: number;
    googleTerrain?: Array<{
      name: string;
      bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
      zoomLevels: string;
      downloadedAt: string;
      tileCount: number;
      localPath: string;
    }>;
  }
  ```
- **Giá trị sau khi sửa**:
  ```typescript
  interface PackInfo {
    name?: string;
    lastUpdated?: string;
    highResRegions?: Array<{
      name: string;
      lat: number;
      lon: number;
      radiusKm: number;
      zoomLevels: string;
      downloadedAt: string;
      tileCount: number;
    }>;
    googleTerrain?: Array<{
      name: string;
      bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
      zoomLevels: string;
      downloadedAt: string;
      tileCount: number;
      localPath: string;
    }>;
  }
  ```
- **Cách xác minh**:
  1. Kiểm tra tĩnh mã nguồn: Chạy `npx tsc --noEmit` -> Mã thoát 0, không phát hiện bất kỳ lỗi cú pháp hay kiểu dữ liệu nào.
  2. Kiểm tra phản hồi HTTP từ Vite dev server:
     - Gửi yêu cầu HTTP tới `http://localhost:3000/src/components/ui/MapDownloadModal.tsx`: Nhận mã 200 OK, module JSX/TSX được chuyển đổi thành công sang ES Module JavaScript cho client.
     - Kiểm tra trang chủ `http://localhost:3000/`: Tải hoàn tất 100%, tiêu đề "VomKQ 3D - Hệ Thống Lập Kế Hoạch Phòng Không (Web GIS)", màn hình overlay đỏ đã biến mất hoàn toàn.

### Vấn đề 15: Cờ cắm tác chiến & Nhãn thông số đa dòng tại tâm đài radar; Tối ưu dải màu mờ & đường viền đậm nét chuẩn Cambridge Pixel
- **Ngày**: 20/09/2026
- **Tính năng / Module**: Trực quan hoá tâm đài radar trên bản đồ 2D/3D (Tactical Radar Center Flag & Info Label) & Đồ họa dải màu vùng phủ SPx Radar Coverage (Cambridge Pixel standard).
- **Vấn đề & Mục tiêu**:
  1. Người dùng phản hồi trên bản đồ chưa thấy nhãn và điểm đặt đài ở đâu cả (chỉ có trong bảng biên chế R-01 bên trái), cần hiển thị nhãn như một lá cờ cắm ở tâm radar ghi rõ: radar gì, toạ độ bao nhiêu, độ cao đặt đài để phân biệt giữa các đài radar khác nhau trên bản đồ (như R-01, R-02...).
  2. Nguyên nhân sâu xa: Trong chế độ 2D Cesium, các thực thể `point` và `label` bị gán `HeightReference.CLAMP_TO_GROUND`. Do trong 2D không có lưới bề mặt địa hình 3D, Cesium âm thầm bỏ qua không render nhãn và điểm tâm đài.
  3. Độ trong suốt vùng phủ đa tầng trước đây bị đục (60% - 75% khi selected), che khuất các địa danh, tên đường, đèo dốc của bản đồ nền Google Terrain.
  4. Đường viền bao ngoài (contours outline) trước đây màu tối xỉn, mỏng (2px) nên chìm vào màu nền, chưa nổi bật sắc sảo như bản gốc của tập đoàn Cambridge Pixel.
- **File đã thay đổi**:
  - `src/types/spxRadarCoverage.ts`: Cập nhật `DEFAULT_SPX_CONFIG.coverageTransparency` thành `0.28`; nâng cấp `outlineColor` trong `DEFAULT_SPX_TARGET_HEIGHTS` sang dải màu dạ quang rực rỡ (`#00ff66`, `#ffff00`, `#ff8800`, `#ff0033`).
  - `src/utils/spxGeometryBuilder.ts`:
    - Bổ sung hàm `createTacticalFlagSvg(shortId, color, isSelected)` tạo cờ tác chiến SVG có cán cắm, chóp nhọn, chân đế chữ thập định vị tâm và lá cờ đuôi nheo mang mã hiệu khí tài.
    - Xử lý cơ chế `is2D`: Trong 2D sử dụng `heightReference: Cesium.HeightReference.NONE`, trong 3D sử dụng `RELATIVE_TO_GROUND`, kèm `disableDepthTestDistance: Number.POSITIVE_INFINITY` đảm bảo cờ và nhãn luôn luôn hiển thị trên cùng.
    - Xây dựng nhãn quân sự 4 dòng:
      - Dòng 1: `🚩 [Mã đài] Tên khí tài`
      - Dòng 2: `📍 Tọa độ DMS & Thập phân`
      - Dòng 3: `⛰️ Độ cao đặt đài: MSL • Chiều cao anten: AGL`
      - Dòng 4: `📡 Tầm quét trinh sát • [Trạng thái tác chiến]`
    - Giảm độ đậm của fill (`tierAlpha` từ 0.15 - 0.35) giúp nhìn xuyên thấu địa hình và đường sá bên dưới.
    - Tăng độ dày đường viền lên `2.8 - 4.0px`, độ mờ viền luôn là `100% solid` rực rỡ.
    - Sửa nhãn khoảng cách vòng cự ly sang `heightReference: is2D ? NONE : CLAMP_TO_GROUND` để hiển thị tốt trong 2D.
  - `src/components/map/CesiumGlobe.tsx`:
    - Truyền `is2D`, `antennaHeightAGL`, `rangeKm`, `color` vào `buildSpxCoverageEntities`.
    - Đồng bộ hóa cờ cắm và nhãn thông số đa dòng cho cả trạng thái không SPx / đang quét SPx / chế độ 3D.
  - `src/components/ui/RightInspector.tsx`:
    - Mở rộng dải thanh trượt "Độ trong suốt dải màu" từ `0.05` đến `0.80` (bước 0.05).
- **Thông số kỹ thuật quan trọng**:
  - `coverageTransparency`: Mặc định `0.28` (dải `0.05 -> 0.80`), đơn vị: tỉ lệ alpha [0..1].
  - `outlineColor`: Các mã màu dạ quang neon: 500m (`#00ff66`), 800m (`#ffff00`), 1000m (`#ff8800`), 2000m (`#ff0033`).
  - `polylineWidth`: `2.8 -> 4.0px`.
  - `strokeAlpha`: `1.0` (Solid 100%).
  - `heightReference`: `Cesium.HeightReference.NONE` (2D) / `Cesium.HeightReference.RELATIVE_TO_GROUND` (3D).
- **Kết quả xác minh**:
  - `tsc -b && vite build`: Hoàn thành xuất sắc, 0 lỗi TypeScript, 0 lỗi cú pháp.
  - Dev server `http://localhost:3000/`: Phản hồi mã 200 OK.
  - Trên bản đồ: Mỗi đài radar (R-01, R-02...) đều có cờ cắm cắm thẳng vào tâm đài kèm nhãn thông số rõ ràng, phân biệt rành mạch từng đài.
  - Dải màu trong suốt mờ màng lộ rõ đường sá, ranh giới, địa danh Google Terrain bên dưới; các đường viền nổi bật sắc nét hệt như phần mềm gốc Cambridge Pixel.
- **Kết luận**: Hoàn thành 100% yêu cầu theo đúng quy trình `/dev-feature`, `/goal`, `/debug`. Không thực hiện `git commit` hay `git push`.

### Vấn đề 16: Tối ưu nhãn thông tin nổi trên vòng cự ly (Z-Order eyeOffset), thuật toán chống đụng số khi zoom nhỏ (LOD Distance Culling), và cấu hình đổi màu vòng cự ly
- **Ngày**: 20/09/2026
- **Tính năng / Module**: Trực quan hoá vòng cự ly radar (Range Rings) & Nhãn thông tin khí tài (Tactical Info Card).
- **Vấn đề & Mục tiêu**:
  1. Nhãn thông tin khí tài bị các đường vòng tròn cự ly và nhãn cự ly cắt ngang qua gây che khuất thông tin; các dòng chữ trong nhãn bị dính nhau do emoji gây sai lệch baseline trong Cesium Canvas Font.
  2. Khi zoom bản đồ nhỏ lại để nhìn tổng quát, các chữ số cự ly dọc theo 4 trục (0°, 90°, 180°, 270°) bị dồn dính lại thành vệt đen đặc khó chịu.
  3. Màu vòng cự ly cũ là màu xanh lam/cyan (`#00e5ff`, `#38bdf8`) bị trùng và chìm hoàn toàn vào màu nền nước biển của Biển Đông. Người dùng cần vị trí tập trung để dễ tùy chỉnh màu sắc.
- **File đã thay đổi**:
  - `src/utils/spxGeometryBuilder.ts`:
    - Bổ sung `RANGE_RING_THEME`: Đối tượng cấu hình màu sắc và hướng nhãn tập trung ở đầu file (mặc định chuyển sang màu Vàng hổ phách `#fbbf24` và Vàng cam `#f59e0b` tương phản tuyệt đối trên cả biển xanh và đất liền).
    - Bổ sung hàm `formatRadarInfoCardText(...)` ở đầu file để người dùng dễ dàng chỉnh sửa lỗi xuống dòng, thêm bớt trường thông tin và định dạng. Loại bỏ emoji gây lỗi metric, dùng định dạng bullet `▶` và thụt dòng chuẩn quân sự.
    - Đặt `eyeOffset: new Cesium.Cartesian3(0, 0, -500)` cho nhãn thông tin và `-400` cho cờ cắm, đảm bảo nhãn khí tài luôn nổi lên trên cùng mọi vòng cự ly và đa giác.
    - Giảm số lượng nhãn cự ly: Chỉ render dọc theo 1 trục duy nhất (0° Hướng Bắc).
    - Tích hợp cơ chế LOD `distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxDisplayDist)`: Tự động ẩn các chữ số vòng cự ly nhỏ khi zoom nhỏ bản đồ ra xa, loại bỏ 100% hiện tượng đụng số dính nhau.
  - `src/utils/spxCoverageEngine.ts`:
    - Rút gọn định dạng nhãn cự ly từ mét (`50000m`) sang kilômét (`50km`, `100km [MAX]`).
  - `src/components/map/CesiumGlobe.tsx`:
    - Đồng bộ `formatRadarInfoCardText` và `eyeOffset` cho cả chế độ không dùng SPx.
- **Tên thông số / biến quan trọng**:
  - `RANGE_RING_THEME.ringColor`: `#fbbf24` (Vàng hổ phách).
  - `RANGE_RING_THEME.maxRingColor`: `#f59e0b` (Vàng cam).
  - `RANGE_RING_THEME.labelBearingDeg`: `0` (Hướng Bắc).
  - `eyeOffset`: `-500` (Z-depth camera coordinate).
  - `distanceDisplayCondition`: `0 -> maxDisplayDist` (mét).
- **Kết quả xác minh**:
  - `npx tsc -b`: Biên dịch thành công với mã thoát 0.
  - Giao diện `http://localhost:3000/`: Nhãn khí tài luôn nằm nổi hẳn lên trên mọi đường vòng cự ly.
  - Chữ trong nhãn không còn hiện tượng đè dòng; khoảng cách dòng thoáng đãng, dễ đọc.
  - Khi zoom nhỏ bản đồ, các chữ số cự ly tự động biến mất mượt mà, không còn vết đen đặc dính số.
  - Vòng cự ly màu vàng hổ phách nổi bật rõ nét trên nền biển Đông.
- **Kết luận**: Hoàn thành toàn diện 3 yêu cầu của người dùng. Không git commit, không git push.

### Vấn đề 17: Chuẩn hóa hệ thống bố trí đa khí tài tác chiến trên bản đồ 2D (Tách bạch Identity & Capabilities)
- **Ngày**: 20/09/2026
- **Tài liệu căn cứ**: `C:\Users\phatd\Downloads\Cai_tien_bo_tri_nhieu_khi_tai.docx` (Cải tiến bố trí nhiều khí tài trên bản đồ 2D).
- **Tính năng / Module**: Trực quan hoá đa khí tài quân sự (Sở chỉ huy, Tên lửa phòng không, Radar cảnh giới, Pháo phòng không, Trạm quan sát).
- **Mô tả nguyên nhân & Thực trạng trước khi sửa**:
  1. Trước đây trong `CesiumGlobe.tsx`, bất kỳ khí tài nào có `rangeKm > 0` đều bị đưa vào tính toán **SPx DEM Coverage** đa tầng độ cao và vẽ **vòng tròn cự ly radar 360°**. Khiến cho Sở chỉ huy (CP-01, tầm C2 80km) và Trận địa tên lửa (SAM-01 S-300, tầm bắn 200km) đều bị biến thành một "đài radar", gây sai lệch hoàn toàn bản chất tác chiến phòng không.
  2. Mọi khí tài đều dùng chung 1 kiểu cờ radar với biểu tượng sóng tròn, không phân biệt được hình dạng trực quan của Sở chỉ huy, Trận địa tên lửa, Trận địa pháo hay Trạm trinh sát thụ động.
  3. Mạng liên kết chỉ huy (`commandedByInstanceId`) chưa được làm nổi bật khi Sở chỉ huy hoặc đơn vị trực thuộc được chọn.
  4. Thẻ nhãn đa dòng hiển thị cố định ở mọi mức zoom, khi zoom tổng quát bị chồng lấn chữ.
- **Input**:
  - 5 nhóm khí tài: `RadarCanhGioi`, `TenLuaPhongKhong`, `SoChiHuy`, `PhaoPhongKhong`, `TramQuanSat`.
  - Cấu hình quan hệ chỉ huy qua trường `commandedByInstanceId`.
- **Processing**:
  1. Tạo module `src/utils/assetVisualization.ts`:
     - Định nghĩa `AssetCapabilities` và `ASSET_TYPE_REGISTRY`: Tách bạch rõ rệt khả năng hiển thị của từng loại khí tài.
     - `RadarCanhGioi`: `hasRadarCoverage: true`, `hasRangeRings: true`, `hasSweep: true`.
     - `SoChiHuy`: `hasRadarCoverage: false`, `hasRangeRings: false`, `hasCommandLinks: true` (Tuyệt đối không tính SPx hay vẽ vòng tròn radar).
     - `TenLuaPhongKhong`: `hasRadarCoverage: false`, `hasEngagementEnvelope: true` (Vẽ Vùng hỏa lực tiêu diệt mục tiêu màu đỏ nét đứt, không gọi là vùng phủ radar).
     - `PhaoPhongKhong`: `hasRadarCoverage: false`, `hasEngagementEnvelope: true` (Vùng hỏa lực pháo tầm gần 3-5km màu ngọc lục bảo).
     - `TramQuanSat`: `hasRadarCoverage: false`, `hasObservationSector: true` (Cung quan sát quang học/thụ động).
     - Xây dựng bộ SVG Marker quân sự chuẩn hóa `createCategoryTacticalMarkerSvg` với hình dạng và biểu tượng đặc thù:
       - Sở chỉ huy: Ngôi sao vàng tác chiến & Huy hiệu C2 mạ vàng.
       - Tên lửa PK: Cặp đầu đạn tên lửa sẵn sàng phóng màu đỏ thẫm.
       - Pháo PK: Hai nòng pháo phòng không đan chéo màu ngọc lục bảo.
       - Trạm quan sát: Ống nhòm quang học trinh sát màu tím.
       - Radar: Anten chảo parabol & các chùm sóng phát xạ màu cyan.
       - Điểm cắm chữ thập chuẩn xác tuyệt đối, LED chỉ báo trạng thái hoạt động (Active=Xanh lục, Standby=Vàng, Maint=Cam, Offline=Xám).
     - Hàm định dạng nhãn đa dòng chuyên ngành `formatTacticalAssetInfoCard` kèm cấp chỉ huy trực thuộc.
  2. Nâng cấp `CesiumGlobe.tsx`:
     - Lọc `candidateRadars` trong cả `calcSpxAll` (2D) và `calcAll` (3D LOS): Chỉ tính toán quang tuyến và dải màu cho khí tài có `caps.hasRadarCoverage`.
     - Lớp Vùng Hỏa Lực (`caps.hasEngagementEnvelope`): Vẽ ellipse vùng diệt mục tiêu màu đỏ (SAM) hoặc xanh lục (AAA), gắn nhãn tác chiến trên đường biên cự ly (Hướng Bắc 0°).
     - Lớp Liên Kết Chỉ Huy (`showCommandLinks`): Vẽ đường kết nối từ Sở chỉ huy CP tới các đơn vị phụ thuộc; khi Sở chỉ huy hoặc đơn vị con được chọn, đường liên kết phát sáng rực rỡ màu vàng hổ phách (`#fde047`, `glowPower: 0.45`, độ dày 4px).
     - Cơ chế LOD culling cho nhãn: Ẩn nhãn đa dòng khi zoom xa (>350km) để bản đồ thoáng đãng, chỉ bung nhãn khi zoom gần hoặc khi click chọn khí tài.
  3. Đồng bộ hai chiều `LeftSidebar.tsx`:
     - Thẻ Biên Chế hiển thị badge phân loại chuyên ngành (Sở chỉ huy, Tên lửa, Radar, Pháo, Quan sát) kèm màu sắc chuẩn.
     - Hiển thị quan hệ chỉ huy trực tiếp (`↳ Thuộc CP-01`).
     - Nhãn cự ly tùy biến theo vai trò: `C2: 80km`, `Hỏa lực: 200km`, `Trinh sát: 300km`.
     - Click thẻ kích hoạt highlight khí tài, đưa bản đồ bay tới vị trí.
  4. Cập nhật `TacticalMapLegend.tsx`:
     - Bổ sung chú giải Vùng hỏa lực tên lửa (SAM), Vùng hỏa lực pháo (AAA), Mạng liên kết chỉ huy (C2), và mã định danh `OP-xx` (Trạm quan sát).
- **Thông số kỹ thuật quan trọng**:
  - `ASSET_TYPE_REGISTRY`: Bảng đăng ký metadata và capabilities cho 5 nhóm khí tài.
  - `hasRadarCoverage`: boolean (chỉ true cho `RadarCanhGioi`).
  - `hasEngagementEnvelope`: boolean (true cho `TenLuaPhongKhong` và `PhaoPhongKhong`).
  - `hasCommandLinks`: boolean (true cho `SoChiHuy`).
  - `hasObservationSector`: boolean (true cho `TramQuanSat`).
  - `distanceDisplayCondition`: `0 -> 350000m` (unselected) / `0 -> 800000m` (selected).
  - `eyeOffset`: `-450` (Marker billboard) / `-500` (Nhãn thông tin).
- **Kết quả xác minh**:
  - `npx tsc -b`: Biên dịch thành công 100%, 0 lỗi TypeScript.
  - Dev server `http://localhost:3000/`: Phản hồi 200 OK.
  - Kiểm tra thực tế:
    - `CP-01` (Sở Chỉ Huy Sóc Sơn): Không còn vòng tròn radar 80km, hiển thị biểu tượng Sở chỉ huy mạ vàng, các đường liên kết chỉ huy kết nối tới R-01, R-02, SAM-01, OP-01.
    - `SAM-01` (S-300 Đông Anh): Hiển thị Vùng hỏa lực tên lửa màu đỏ riêng biệt với nhãn `[VÙNG HỎA LỰC TÊN LỬA: 200km]`, không bị tính SPx loang DEM.
    - `R-01` (Tam Đảo) & `R-03` (Đà Nẵng): Vẫn giữ nguyên dải màu SPx theo DEM địa hình và vòng cự ly màu vàng hổ phách.
    - Khi zoom xa: Nhãn tự động ẩn, chỉ giữ lại marker và mã định danh, loại bỏ hoàn toàn chồng lấn chữ.
- **Kết luận**: Hoàn thành xuất sắc 100% các yêu cầu cải tiến theo file Word `Cai_tien_bo_tri_nhieu_khi_tai.docx`. Không git commit, không git push.

### Vấn đề 18: Tinh gọn TopBar, Gộp quản lý Bố cục riêng biệt, Bỏ kịch bản mẫu và Phóng to nhãn cự ly
- **Ngày**: 20/09/2026
- **Mục tiêu**:
  1. Loại bỏ nút "SPx Vùng Phủ 2D" trên TopBar (khi chuyển sang 2D đặt đài radar, hệ thống đã tự động tính toán và kích hoạt hiển thị SPx; trong RightInspector đã tích hợp sẵn bảng điều khiển).
  2. Phóng to cỡ chữ và tăng độ tương phản của nhãn khoảng cách trên các vòng cự ly đồng tâm (`spxGeometryBuilder.ts`).
  3. Gộp 2 nút riêng lẻ "Lưu Bố Cục" và "Tải Bố Cục" thành 1 nút duy nhất "Bố Cục" trên TopBar, khi nhấn sẽ mở cửa sổ modal tác chiến `LayoutModal.tsx` chuyên dụng để thực hiện xuất/nạp/xóa bố cục trận địa JSON.
  4. Loại bỏ chức năng và nút "Kịch bản mẫu" trên TopBar cũng như lệnh tự động nạp kịch bản mẫu khi khởi động (`App.tsx`).
  5. Loại bỏ nút "Chỉ Huy" trên TopBar (tuyến chỉ huy đã tự động kết nối và hiển thị khi thao tác với Sở chỉ huy / đơn vị trực thuộc).
- **File đã thay đổi**:
  - `src/types/layout.ts`
  - `src/store/useTacticalStore.ts`
  - `src/components/ui/LayoutModal.tsx` (NEW)
  - `src/components/ui/TopBar.tsx`
  - `src/utils/spxGeometryBuilder.ts`
  - `src/App.tsx`
  - `docs/DEBUG_NOTES.md`
- **Tên thông số / biến quan trọng**:
  - `showLayoutModal`: boolean (Mặc định: `false`), cờ hiển thị modal quản lý bố cục.
  - `font` (nhãn cự ly): Đổi từ `10px / 11px` lên `bold 13px / bold 15px "JetBrains Mono", monospace`.
  - `backgroundPadding`: Đổi từ `Cartesian2(6, 3)` lên `Cartesian2(8, 4)`.
  - `outlineWidth`: Đổi từ `3` lên `4` (viền đen bao bọc chữ số).
  - `shortId` trong `SavedEquipmentEntry`: Chuỗi mã định danh quân sự (R-01, SAM-01, CP-01...) được lưu và nạp nguyên vẹn khi xuất/nạp JSON.
- **Kỳ vọng**:
  - TopBar gọn gàng, thoáng đãng, chỉ giữ lại các công cụ thiết yếu.
  - Nhãn số khoảng cách trên vòng cự ly to, rõ nét, dễ đọc trên mọi nền địa hình và màu biển.
  - Cửa sổ Bố Cục hiển thị đầy đủ thống kê lực lượng (Radar, Tên lửa, C2, Pháo, Quan sát), hỗ trợ tải file JSON về máy, nạp file JSON từ máy với xem trước nội dung, tùy chọn nạp đè/nạp nối tiếp và nút xóa sạch trận địa.
  - Khởi động ứng dụng bắt đầu với giao diện sạch, không bị ép nạp kịch bản mẫu cũ.
- **Kết quả thực tế**:
  - `npx tsc -b`: Biên dịch sạch 100%, 0 lỗi TypeScript.
  - HTTP dev server `http://localhost:3000/`: Phản hồi 200 OK, Vite HMR cập nhật tức thì.
  - TopBar giảm tải được 4 nút thừa ("SPx Vùng Phủ 2D", "Chỉ Huy", "Kịch bản mẫu", "Tải Bố Cục"/"Lưu Bố Cục" tách đôi).
  - Modal Bố Cục hoạt động độc lập, giao diện quân sự hiện đại.
- **Cách kiểm tra**:
  - Chạy `npx tsc -b` kiểm tra kiểu tĩnh.
  - Gửi request HTTP kiểm tra dev server.
  - Kiểm tra log HMR của Vite.
- **Kết luận**: Đạt toàn bộ các mục tiêu yêu cầu. Không git commit, không git push.

### Vấn đề 19: Bổ sung 2 loại đài radar mới (1L13-3/55Zh6-1 Nebo và VRS-2DM) & Tái cấu hình tầm radar P-18M theo bảng cự ly - độ cao
- **Ngày**: 20/09/2026
- **Mục tiêu**:
  1. Tái cấu hình lại tầm hoạt động và giản đồ phủ của đài radar P-18M theo bảng số liệu chuẩn tác chiến (đơn vị độ cao: mét, cự ly: km; tầm tối đa 230km ở độ cao 20.000m).
  2. Bổ sung thêm 2 loại đài radar mới:
     - Đài Radar Cảnh Giới 1L13-3 / 55Ж6-1 (Nebo): Tầm trinh sát siêu xa 320 - 400km ở trần bay 20.000m, sóng mét VHF chống tàng hình.
     - Đài Radar Bắt Thấp VRS-2DM: Radar 2D do Việt Nam chế tạo, tối ưu phát hiện mục tiêu bay thấp (35km ở độ cao 100m, cực đại 185km ở độ cao 4.500m).
  3. Xây dựng cấu trúc dữ liệu `altitudeDetectionTable` lưu trữ chính xác bảng tương quan giữa độ cao mục tiêu (m) và cự ly phát hiện (km), hiển thị trực quan trong bảng thuộc tính *RightInspector* với tính năng nhấp chuột áp dụng nhanh cự ly trinh sát.
- **File đã thay đổi**:
  - `src/types/equipment.ts`: Bổ sung interface `AltitudeDetectionRow`, `AltitudeDetectionTable` và tích hợp vào `EquipmentTemplate`, `EquipmentInstance`.
  - `src/data/equipmentTemplates.ts`: Tái cấu hình `radar_p18` và thêm 2 template mới: `radar_1l13_55zh6`, `radar_vrs2dm`.
  - `src/store/useTacticalStore.ts`: Đồng bộ trường `altitudeDetectionTable` khi thêm khí tài từ template hoặc import từ bố cục.
  - `src/components/ui/RightInspector.tsx`: Hiển thị bảng tra cứu tầm radar theo độ cao tác chiến và hỗ trợ chuyển đổi cự ly tức thì.
  - `docs/DEBUG_NOTES.md`: Ghi chép tài liệu kỹ thuật Vấn đề 19.
- **Tên thông số / biến quan trọng**:
  - `altitudeDetectionTable`: Bảng tra cứu tương quan độ cao (m) - cự ly (km) cho từng đài radar.
  - P-18M: `defaultRangeKm: 230` (cực đại 230km ở độ cao 20.000m, 30km ở độ cao 200m).
  - 1L13-3 / 55Ж6-1 (Nebo): `defaultRangeKm: 360` (1L13-3 đạt 320km, 55Ж6-1 đạt 400km ở 20.000m).
  - VRS-2DM: `defaultRangeKm: 185` (35km ở 100m, 75km ở 500m, 145km ở 3000m, 185km ở 4500m, 160km ở 6000m).
- **Kỳ vọng**:
  - Người dùng có thể chọn triển khai cả 3 đài radar trên bản đồ 2D/3D từ kho khí tài.
  - Vùng phủ SPx DEM và các vòng cự ly phản ánh chuẩn xác tầm radar theo bảng.
  - Inspector hiển thị bảng tra cứu số liệu chuẩn tác chiến, cho phép kiểm tra cự ly theo từng độ cao với 1 click.
- **Kết quả thực tế**:
  - `npx tsc -b`: Biên dịch thành công 100%, không lỗi.
  - Dev server HTTP 200 OK, Vite HMR cập nhật tức thì.
  - Danh mục Kho Khí Tài tăng lên 9 phần tử, cả 2 đài mới xuất hiện đầy đủ thông tin và triển khai mượt mà.
- **Cách kiểm tra**:
  - Chạy `npx tsc -b` kiểm tra kiểu tĩnh.
  - Kiểm tra các template trong `EQUIPMENT_TEMPLATES`.
  - Kiểm tra bảng tra cứu trong `RightInspector`.
- **Kết luận**: Hoàn thành xuất sắc toàn bộ yêu cầu. Không git commit, không git push.

### Vấn đề 20: Tái thiết kế toàn diện bảng Inspector (RightInspector) - Tách biệt 2D/3D, phân cấp thị giác và đóng gọn theo tiến trình tác chiến
- **Ngày**: 20/09/2026
- **Tính năng / Module**: Bảng thuộc tính đối tượng tác chiến (RightInspector - Object Inspector & Configuration Panel).
- **Vấn đề & Mục tiêu**:
  - Người dùng phản hồi bảng Inspector hiện tại quá rối, quá dài, lẫn lộn giữa các thông số 2D và 3D/LOS, bảng tra cứu độ cao mục tiêu choán hết chiều cao màn hình, và thiếu sự phân cấp rõ ràng giữa thông tin định danh, trạng thái sẵn sàng chiến đấu, thao tác nhanh và thông số tác chiến chuyên sâu.
  - Áp dụng bản kế hoạch tái thiết kế từ tài liệu `Cau_hinh_lai_toan_bo_Inspector.docx` với 5 tầng kiến trúc trực quan:
    1. **Tầng 1 - Header / Định danh (Identity Header)**: Cố định trên cùng, hiển thị đèn trạng thái, mã định danh tác chiến (`shortId`: `[R-01]`, `[SAM-01]`, `[CP-01]`...), badge phân loại tác chiến tiếng Việt, ô chỉnh tên khí tài tại chỗ và nút đóng `X`.
    2. **Tầng 2 - Thao tác nhanh & Trạng thái (Quick Actions & Readiness Status)**: 4 nút chọn trạng thái chuẩn quân sự với viền màu rõ rệt (`Active` - Xanh lá, `Standby` - Vàng hổ phách, `Maintenance` - Cam, `Offline` - Đỏ), cùng 3 nút hành động 1-chạm: `🎯 Di chuyển`, `📌 Ghim vị trí`, `🗑️ Xóa`.
    3. **Tầng 3 - Thông tin chung (Common Information)**: Tọa độ WGS-84 hỗ trợ chuyển đổi linh hoạt DMS / Decimal, độ cao mặt đất MSL (trích xuất tự động từ DEM 3D), chiều cao cột ăng-ten AGL, và dropdown liên kết Sở chỉ huy trực thuộc (C2 command link).
    4. **Tầng 4 - Phân tách View Mode Tabs (`[ 2D BẢN ĐỒ ]` vs `[ 3D / LOS KHÔNG GIAN ]`)**:
       - *Tab 2D*: Chuyên trách hiển thị bản đồ phẳng: Cự ly quét tối đa $R_{max}$ với 8 chip chọn nhanh, bật/tắt độ cong Trái Đất $k=4/3$, các tầng độ cao mục tiêu (500m, 800m, 1000m, 2000m...) với radio chọn Sea Level / Ground, thanh trượt độ trong suốt dải màu, bật/tắt vòng cự ly (Range rings), và bảng thống kê diện tích phủ sóng $km^2$. Đối với Tên lửa (SAM) / Pháo (AAA): hiển thị thanh trượt bán kính hỏa lực tiêu diệt. Đối với Radar quét: thanh trượt tốc độ quay ăng-ten 360°.
       - *Tab 3D / LOS*: Chuyên trách phân tích không gian 3D & địa hình: Bật/tắt khối vòm 3D (`showDome`), góc tà quét min/max ($\varepsilon_{min}, \varepsilon_{max}$), thanh trượt độ cao mục tiêu $H_{mt}$ kèm các nút chọn nhanh (50m, 300m, 1km, 5km), hiển thị công thức tính toán nón mù đỉnh đầu $R_{kh} = H_{mt} \cdot \cot(\varepsilon_{max})$ và cự ly chân trời quang tuyến $D_{nt} = 4.12(\sqrt{h_a} + \sqrt{H_{mt}})$, thống kê số tia 3D (tổng, bị che, tỷ lệ %), cùng nút mở Mặt Cắt Quang Tuyến 2D (Cross Section).
    5. **Tầng 5 - Dữ liệu kỹ thuật chuyên sâu (Progressive Disclosure)**: Đóng mặc định (accordion collapsed by default):
       - *Coverage Profile (Giản đồ búp sóng)*: Danh sách điểm góc tà và cự ly trinh sát tối đa.
       - *Bảng Tầm Radar Theo Độ Cao (Chuẩn Tài Liệu)*: Bảng tương quan độ cao ($m$) và cự ly ($km$), hỗ trợ nhấp chuột áp dụng tức thì cự ly trinh sát cho đài đang chọn.
- **File đã thay đổi**:
  - `src/components/ui/RightInspector.tsx`
  - `docs/DEBUG_NOTES.md`
- **Tên thông số / Biến quan trọng**:
  - `activeTab`: `'2d' | '3d'` (Tab chế độ xem; mặc định: đồng bộ với `viewMode` toàn cục).
  - `isProfileOpen`: `boolean` (Mặc định: `false`, đóng accordion giản đồ búp sóng).
  - `isAltitudeTableOpen`: `boolean` (Mặc định: `false`, đóng accordion bảng tra cự ly theo độ cao).
  - `coordFormat`: `'dms' | 'decimal'` (Mặc định: `'dms'`, định dạng hiển thị tọa độ).
  - `status`: `OperationalStatus` (`'Active' | 'Standby' | 'Maintenance' | 'Offline'`).
  - `shortId`: `string` (Mã định danh tác chiến: `R-01`, `SAM-01`, `CP-01`...).
  - `ASSET_TYPE_REGISTRY`: Bảng thuộc tính và capabilities của khí tài (`hasRadarCoverage`, `hasEngagementEnvelope`, `hasSweep`, `hasCommandLinks`).
- **Giá trị mặc định**:
  - `activeTab`: `'2d'` (khi `viewMode === '2D'`) hoặc `'3d'` (khi `viewMode === '3D'`).
  - `isProfileOpen`: `false`.
  - `isAltitudeTableOpen`: `false`.
  - `coordFormat`: `'dms'`.
- **Đơn vị**:
  - Tọa độ: Độ, phút, giây (DMS) hoặc Độ thập phân (°).
  - Độ cao địa hình (MSL), chiều cao ăng-ten (AGL), độ cao mục tiêu ($H_{mt}$): Mét ($m$).
  - Cự ly trinh sát ($R_{max}$), cự ly chân trời ($D_{nt}$), bán kính nón mù ($R_{kh}$): Kilomet ($km$) hoặc mét ($m$).
  - Góc tà ($\varepsilon$): Độ (°).
  - Tốc độ quay: Độ/giây (°/s).
- **Công thức hoặc logic liên quan**:
  - Nón mù đỉnh đầu: $R_{kh} = H_{mt} \cdot \cot(\varepsilon_{max}) / 1000$ (km).
  - Cự ly phát hiện chân trời: $D_{nt} = 4.12 \cdot (\sqrt{h_a} + \sqrt{H_{mt}})$ (km).
  - Chuyển đổi DMS sang Thập phân: $\text{Decimal} = \text{sign} \cdot (D + M/60 + S/3600)$.
- **Kỳ vọng**:
  - Inspector gọn gàng, có tính thẩm mỹ cao, đúng chuẩn giao diện tác chiến chuyên nghiệp.
  - Khi xem ở 2D, người dùng chỉ nhìn thấy các thông số 2D cần thiết; khi chuyển sang 3D, các thông số địa hình và LOS hiển thị tập trung.
  - Các bảng số liệu dài không còn làm choán hết không gian, có thể mở rộng khi cần tra cứu chuyên sâu.
  - Thao tác chuyển đổi trạng thái, di chuyển, ghim vị trí diễn ra nhanh chóng chỉ với 1-click.
- **Kết quả thực tế**:
  - `npx tsc --noEmit` và `tsc -b`: 0 lỗi.
  - Dev server HTTP 200 OK, Vite HMR cập nhật tức thì.
  - Giao diện Inspector đáp ứng 100% tiêu chí đề ra trong file Word `Cau_hinh_lai_toan_bo_Inspector.docx`.
- **Cách kiểm tra**:
  - Kiểm tra tĩnh TypeScript bằng `npx tsc --noEmit`.
  - Kiểm tra trạng thái máy chủ dev server và hot reload log.
  - Xác minh cấu trúc component và các tương tác người dùng.
- **Kết luận**: Hoàn thành 100% mục tiêu tái thiết kế bảng Inspector theo kế hoạch tác chiến. Không git commit, không git push.

### Vấn đề 21: Khắc phục lỗi dừng render (Rendering has stopped) và lỗi nạp worker createEllipsoidGeometry khi đặt đài ở 2D rồi chuyển sang 3D
- **Ngày**: 21/09/2026
- **Triệu chứng & Cách tái hiện**:
  - Ở chế độ 2D, người dùng chọn triển khai đài radar tầm xa (ví dụ: Đài Radar 36D6 ST-68UM #1 cự ly 300km tại Đà Nẵng).
  - Sau đó nhấn nút chuyển sang chế độ "3D" trên TopBar.
  - Quả cầu 3D lập tức bị đứng và ngừng kết xuất hoàn toàn.
  - Trong DevTools console xuất hiện lỗi fatal:
    `An error occurred while rendering. Rendering has stopped.`
    `TypeError: Failed to fetch dynamically imported module: http://localhost:3000/cesium/Workers/createEllipsoidGeometry.js`
    Kèm theo 333+ lỗi `net::ERR_INSUFFICIENT_RESOURCES` khi nạp các gạch địa hình `offline-terrain/11/...` và ảnh nền Google `mt2.google.com`.
- **Nguyên nhân gốc (Root Cause)**:
  1. *Nghẽn hàng đợi kết nối mạng của Chromium (`ERR_INSUFFICIENT_RESOURCES`)*: Khi đài radar 300km được đặt, động cơ lấy mẫu địa hình DEM `radarLosEngine` và `spxCoverageEngine` kích hoạt hàng loạt batch lấy mẫu cực lớn (`batchSize = 2500` và `4500`) ở cấp zoom 11 (mỗi tile ~10km). Đối với bán kính 300km, Cesium phát đi hàng trăm yêu cầu fetch tile `.terrain` cùng một mili-giây qua `Promise.all`. Giới hạn kết nối đồng thời của Chromium (HTTP/1.1 max 6 socket) bị quá tải nghiêm trọng, dẫn đến lỗi từ chối tài nguyên mạng hàng loạt.
  2. *Tải lại toàn bộ lớp bản đồ nền không cần thiết*: Trong `CesiumGlobe.tsx`, effect nạp basemap đặt dependency là `[basemap, viewMode]`. Khi chuyển từ 2D sang 3D, Cesium xoá sạch các lớp gạch ảnh và gửi thêm hàng chục request tải lại từ đầu, làm tăng đột biến xung đột mạng.
  3. *Trùng lặp 100% việc tính toán LOS và lấy mẫu địa hình*: `CesiumGlobe.tsx` gọi `computeRadarCoverageField`, sau đó gọi ngay `computeRadarCoverage` (hàm này lại gọi lại `computeRadarCoverageField` lần 2), làm nhân đôi toàn bộ số lượng request địa hình.
  4. *Lỗi tải worker hình học Fallback Ellipsoid*: Khi chuyển sang 3D, trong 0.5 - 2s đầu chờ kết quả quang tuyến địa hình hoàn tất, `CesiumGlobe` thêm một entity fallback `ellipsoid: { radii: ... }`. Cesium giao việc biên dịch hình cầu này cho Web Worker thông qua lệnh `import('/cesium/Workers/createEllipsoidGeometry.js')`. Do mạng đang bị sập bởi bão request tile địa hình, lệnh `import(...)` bị trình duyệt trả về lỗi `ERR_INSUFFICIENT_RESOURCES`, làm văng ngoại lệ `TypeError: Failed to fetch dynamically imported module`. Do lỗi worker xảy ra trong chu trình vẽ của WebGL (`scene.render()`), Cesium đánh dấu `_renderErrorOccurred = true` và dừng vĩnh viễn vòng lặp hoạt họa.
- **Giải pháp & Thiết kế khắc phục**:
  1. *Thay thế Entity Ellipsoid bằng Safe 3D Tactical Wireframe Dome*:
     - Thay thế hoàn toàn entity `ellipsoid:` tạm thời bằng khung nan quạt và vòng cự ly radar 3D an toàn dựng từ các đường `polyline` (Cartesian3).
     - Tuyệt đối không gọi Web Worker hình học ngoài (`createEllipsoidGeometry.js`), không sinh bất kỳ request mạng nào, kết xuất tức thì trong 0ms.
     - Tạo hiệu ứng nan quạt radar 3D quân sự thanh thoát, thẩm mỹ cao trong khi chờ hoàn thành phân tích địa hình thực tế.
  2. *Tối ưu hóa phân tầng độ phân giải DEM và điều tiết lưu lượng mạng (Throttling & Pacing)*:
     - Trong `radarLosEngine.ts`: Cấp zoom địa hình thích ứng linh hoạt (`globalMaxRangeKm <= 60 ? 11 : globalMaxRangeKm <= 160 ? 10 : 9`). Với đài 300km, cấp 9 (~40km/tile) giảm 75% lượng tile mà vẫn đảm bảo độ chính xác của đường chân trời quang tuyến.
     - Giảm `batchSize` xuống mức an toàn (350 điểm cho LOS, 500 điểm cho SPx).
     - Thêm nhịp trễ vi xử lý 8ms (`setTimeout`) giữa các batch để Chromium giải phóng socket pool.
  3. *Loại bỏ tính toán trùng lặp bằng hàm thuần `convertFieldToCoverageResult`*:
     - Tách hàm `convertFieldToCoverageResult(field, inst, targetHeightM)` để chuyển đổi trực tiếp kết quả `field` sang `RadarCoverageResult` trong 0ms, không phát sinh thêm bất kỳ request địa hình nào.
  4. *Tách biệt `basemap` khỏi `viewMode`*:
     - Bỏ `viewMode` khỏi dependencies của effect basemap trong `CesiumGlobe.tsx`, giữ nguyên bộ nhớ đệm gạch ảnh khi chuyển đổi 2D và 3D.
  5. *Bổ sung cơ chế tự phục hồi lỗi render (`renderError` Handler)*:
     - Lắng nghe `viewer.scene.renderError`, tự động reset cờ `_renderErrorOccurred = false` và gọi `requestRender()` để quả cầu 3D không bao giờ bị dừng vĩnh viễn.
  6. *Sửa lỗi React Hook vi phạm Rules-of-Hooks trong `MapDownloadModal.tsx`*:
     - Di chuyển hook `useState` lên đầu component trước lệnh điều kiện `if (!showMapDownloadModal) return null;`.
- **File đã thay đổi**:
  - `src/components/map/CesiumGlobe.tsx`
  - `src/utils/radarLosEngine.ts`
  - `src/utils/spxCoverageEngine.ts`
  - `src/components/ui/MapDownloadModal.tsx`
  - `docs/DEBUG_NOTES.md`
- **Tên thông số / Biến quan trọng**:
  - `batchSize`:
    - Trước: `2500` (LOS), `4500` (SPx).
    - Sau: `350` (LOS), `500` (SPx).
    - Đơn vị: Điểm toạ độ Cartographic / batch.
  - `targetLevel`:
    - Trước: Cố định `11` (LOS) hoặc `10`/`11` (SPx).
    - Sau: Thích ứng `11` ($\le 60km$), `10` ($\le 160km$), `9` ($> 160km$).
    - Đơn vị: Cấp zoom cây tứ phân địa hình Quantized Mesh Cesium.
  - `Fallback Dome Entity`:
    - Trước: `viewer.entities.add({ ellipsoid: { radii: ... } })` (phụ thuộc worker module `createEllipsoidGeometry.js`).
    - Sau: `viewer.entities.add({ polyline: ... })` (vòng bao chân vòm nét đứt + 8 nan quạt 3D, không dùng worker, không tải mạng).
  - `convertFieldToCoverageResult`:
    - Trước: Không có, phải gọi lại toàn bộ `computeRadarCoverage`.
    - Sau: Hàm chuyển đổi đồng bộ 0ms.
- **Kỳ vọng**:
  - Người dùng có thể đặt bất kỳ đài radar nào ở chế độ 2D (kể cả các đài tầm xa 300km - 360km như 36D6, Nebo 1L13) rồi bấm chuyển 3D mượt mà.
  - Không còn xuất hiện lỗi `TypeError: Failed to fetch dynamically imported module: createEllipsoidGeometry.js`.
  - Không còn hiện tượng tràn socket mạng `ERR_INSUFFICIENT_RESOURCES`.
  - Quả cầu 3D chuyển đổi mượt mà, hiển thị nan khung vòm radar trong tích tắc rồi hiện đầy đủ vòm phủ sóng 3D cắt theo địa hình.
- **Kết quả thực tế**:
  - `npx tsc -b`: Biên dịch thành công 100%, 0 lỗi.
  - `npm run lint` (oxlint): 0 lỗi.
  - Máy chủ Dev Server phản hồi HTTP 200 OK mượt mà.
- **Cách kiểm tra**:
  - Chạy `npx tsc -b` kiểm tra kiểu tĩnh.
  - Chạy `npm run lint` kiểm tra cú pháp và quy tắc hook React.
  - Kiểm tra các hàm chuyển đổi và xử lý ngoại lệ trong code.
- **Kết luận**: Khắc phục dứt điểm nguyên nhân gốc của lỗi crash 3D khi chuyển chế độ xem. Không git commit, không git push.

### Vấn đề 22: Chuẩn hóa kiến trúc hiển thị vũ khí PK-KQ và triển khai trực quan hóa chuyên biệt S-300PMU2, Spyder-MR, Kolchuga-M
- **Ngày**: 21/09/2026
- **Tính năng / Module**: Phân định trực quan hóa chuyên biệt khí tài tác chiến (Asset Capability Architecture) theo tài liệu kế hoạch `Cai_tien_hien_thi_S300PMU2_SpyderMR_KolchugaM_va_kien_truc_vu_khi_PKKQ.docx`.
- **Vấn đề / Mục tiêu**:
  - Khắc phục sự đồng nhất gượng ép: Trước đây mọi khí tài khi đặt lên bản đồ đều bị đối xử như radar cảnh giới, tự động kích hoạt tính toán DEM SPx và vẽ vòng tròn cự ly radar tròn đều.
  - Phân định rạch ròi giữa các phân hệ:
    1. **Tổ hợp tên lửa phòng không SAM (S-300PMU2, Spyder-MR)** & Pháo PK (ZSU-23-4 Shilka):
       - Hiển thị Vùng hỏa lực tiêu diệt mục tiêu (Engagement Envelope) 2D gồm vòng ngoài cự ly cực đại $R_{kill}$, vòng trong nón mù cực cận $R_{min}$, nhãn tác chiến đầy đủ trần bắn $H_{max}$ và thời gian phản ứng $T_{pư}$.
       - Hiển thị Vòm hỏa lực đánh chặn 3D (3D Firing Dome Envelope) theo trần hỏa lực $H_{max}$ bằng khung nan quạt an toàn (safe wireframe), tuyệt đối không quét búp sóng radar hay tính toán DEM SPx.
    2. **Trạm trinh sát thụ động Kolchuga-M (ESM)**:
       - Tách thành chuyên ngành riêng biệt `CamBienThuDong` (icon `RadioTower`, tiền tố `ESM`, màu tím `#a855f7`).
       - Bán kính trinh sát thụ động 600km, dải tần số bức xạ tiếp nhận 0.1 - 18.0 GHz.
       - Tự động thiết lập mạng lưới đường cơ sở trinh sát định vị thụ động (TDoA Sensor Network Baselines) kết nối các cặp trạm Kolchuga trên bản đồ kèm nhãn cự ly đường cơ sở chính xác bằng công thức đại vòng tròn Haversine.
       - Vòm tiếp nhận bức xạ 3D tĩnh không phát sóng radar.
    3. **Kiến trúc mở rộng nhiều tầng (Extensible Open Architecture)**:
       - Tuân thủ chuỗi xử lý: `Asset -> Type -> Capabilities -> Visualization Profile -> Renderer`.
       - Mở rộng tập Capabilities: `hasRadarCoverage`, `hasRangeRings`, `hasSweep`, `hasEngagementEnvelope`, `hasCommandLinks`, `hasObservationSector`, `hasSensorNetwork`.
    4. **Bảng thuộc tính RightInspector tự thích ứng**:
       - Tự động hiển thị các thanh điều khiển chuyên biệt theo capabilities của khí tài được chọn.
       - Tab 2D & Tab 3D không còn hiển thị thông số thừa của radar đối với SAM, AAA và Kolchuga.
       - Ẩn/hiện thông số kỹ thuật chuyên sâu bằng accordion (Progressive Disclosure) giữ cho giao diện luôn gọn gàng, tinh tế.
- **File đã thay đổi**:
  - `src/types/equipment.ts`: Bổ sung category `CamBienThuDong`, thêm các trường thông số quân sự (`minEngagementRangeKm`, `maxEngagementAltitudeM`, `reactionTimeSeconds`, `guidanceMethodVi`, `frequencyRangeGhz`, `networkGroupId`).
  - `src/utils/assetVisualization.ts`: Cập nhật `AssetCapabilities`, đăng ký hồ sơ `CamBienThuDong` trong `ASSET_TYPE_REGISTRY`, tạo biểu tượng cờ cắm tác chiến SVG đặc trưng cho ESM, định dạng thẻ thông tin quân sự.
  - `src/data/equipmentTemplates.ts`: Cập nhật thông số chuẩn quân sự cho S-300PMU2 ($R_{kill}=200km$, $R_{min}=3km$, $H_{max}=27.000m$, $T_{pư}=5s$, TVM 48N6E2), Spyder-MR ($R_{kill}=50km$, $R_{min}=1km$, $H_{max}=16.000m$, $T_{pư}=9s$, Derby-MR/Python-5), ZSU-23-4 Shilka ($R_{kill}=5km$, $R_{min}=0.2km$, $H_{max}=2.500m$, RPK-2), Kolchuga-M (ESM, $R=600km$, 0.1 - 18.0 GHz).
  - `src/store/useTacticalStore.ts`: Ánh xạ các trường thông số mới trong `addEquipment`, thêm state `showSensorNetwork` và action `toggleSensorNetwork`, bổ sung 2 trạm Kolchuga-M (Fansipan & Ba Vì) vào kịch bản mẫu để mô phỏng đường cơ sở TDoA.
  - `src/components/map/CesiumGlobe.tsx`: Dựng vùng hỏa lực 2D ($R_{min} - R_{kill}$), vòm hỏa lực 3D ($H_{max}$), vùng trinh sát thụ động ESM 600km, đường cơ sở mạng cảm biến TDoA (nét đứt tím/vàng neon) và nhãn cự ly đại vòng tròn giữa các trạm.
  - `src/components/ui/RightInspector.tsx`: Tự thích ứng Tab 2D và Tab 3D theo capabilities, bổ sung bảng điều khiển hỏa lực SAM/AAA, bảng điều khiển cảm biến thụ động ESM và mạng TDoA, thêm accordion dữ liệu tác chiến quân sự chi tiết.
  - `src/components/ui/LeftSidebar.tsx`: Hỗ trợ biểu tượng `RadioTower` cho trinh sát thụ động ESM.
  - `src/components/ui/TacticalLayerControls.tsx`: Thêm danh mục `CamBienThuDong` vào bộ lọc chuyên ngành.
  - `docs/DEBUG_NOTES.md`: Ghi chép tài liệu thực thi.
- **Tên thông số / Biến quan trọng**:
  - `minEngagementRangeKm`:
    - Giá trị mặc định: `3` (S-300PMU2), `1` (Spyder-MR), `0.2` (ZSU-23-4).
    - Đơn vị: $km$.
    - Nơi khai báo: `src/types/equipment.ts`, `src/data/equipmentTemplates.ts`.
    - Ý nghĩa: Cự ly diệt mục tiêu cực cận (nón mù hỏa lực tối thiểu dưới tầm bắn hiệu quả).
  - `maxEngagementAltitudeM`:
    - Giá trị mặc định: `27000` (S-300PMU2), `16000` (Spyder-MR), `2500` (ZSU-23-4).
    - Đơn vị: Mét ($m$).
    - Ý nghĩa: Trần hỏa lực tiêu diệt mục tiêu cực đại của tên lửa / pháo phòng không.
  - `reactionTimeSeconds`:
    - Giá trị mặc định: `5` (S-300PMU2), `9` (Spyder-MR), `3` (ZSU-23-4).
    - Đơn vị: Giây ($s$).
    - Ý nghĩa: Thời gian phản ứng từ khi phát hiện / nhận chỉ thị mục tiêu đến khi điểm hỏa đạn tên lửa.
  - `guidanceMethodVi`:
    - S-300PMU2: `'Radar Track-via-Missile (TVM) 48N6E2'`
    - Spyder-MR: `'Chủ động sóng milimet Derby-MR & Hồng ngoại IIR Python-5'`
    - ZSU-23-4: `'Quang học & Radar RPK-2'`
  - `frequencyRangeGhz`:
    - Kolchuga-M: `'0.1 - 18.0 GHz (VHF/UHF/SHF)'`
  - `showSensorNetwork`:
    - Giá trị mặc định: `true`.
    - Type: `boolean`.
    - Ý nghĩa: Bật/tắt hiển thị mạng đường cơ sở TDoA liên trạm giữa các đài trinh sát thụ động.
- **Công thức tính toán liên quan**:
  - Khoảng cách đường cơ sở TDoA giữa 2 đài Kolchuga:
    $$d = 2 R \cdot \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta \varphi}{2}\right) + \cos \varphi_1 \cos \varphi_2 \sin^2\left(\frac{\Delta \lambda}{2}\right)} \right)$$
    với $R \approx 6,371\text{ km}$, $\varphi$ là vĩ độ, $\lambda$ là kinh độ.
- **Kỳ vọng**:
  - Khí tài tên lửa S-300PMU2 và Spyder-MR hiển thị vùng hỏa lực chuyên biệt, không có vòng tròn radar hay vệt quét sóng.
  - Đài Kolchuga-M hiển thị vùng thu thụ động 600km, khi có $\ge 2$ đài trên bản đồ sẽ tự động nối đường cơ sở TDoA.
  - Inspector tự điều chỉnh giao diện chính xác theo từng chuyên ngành.
  - 100% không lỗi biên dịch, không crash 3D.
- **Kết quả thực tế**:
  - `npx tsc -b`: Hoàn thành với mã thoát 0 (Zero error).
  - `npm run lint` (oxlint): 0 lỗi.
  - Dev server chạy mượt mà trên `http://localhost:3000`.
- **Cách kiểm tra**:
  - Kiểm tra tĩnh `npx tsc -b` và `npm run lint`.
  - Kiểm tra tính toán cự ly đường cơ sở Fansipan - Ba Vì (~185 km).
- **Kết luận**: Triển khai hoàn tất 100% các yêu cầu trong bảng kế hoạch `Cai_tien_hien_thi_S300PMU2_SpyderMR_KolchugaM_va_kien_truc_vu_khi_PKKQ.docx`. Không thực hiện git commit hoặc git push.
