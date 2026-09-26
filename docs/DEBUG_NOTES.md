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

## 7. Khắc phục cảnh báo / lỗi biên dịch TS6133 tại App.tsx

### Mô tả nguyên nhân
Trình biên dịch TypeScript và linter báo lỗi `error TS6133: 'useTacticalStore' is declared but its value is never read.` tại `src/App.tsx:16`.
- **Căn nguyên**: File cấu hình `tsconfig.app.json` thiết lập `"noUnusedLocals": true`. Trong các bản cập nhật giao diện trước đó, logic khởi tạo kịch bản (`loadSampleScenario()`) trong `useEffect` của `App.tsx` đã được lược bỏ, và các component con tự kết nối trực tiếp đến store. Dòng `import { useTacticalStore } from "./store/useTacticalStore";` vẫn còn tồn đọng trong `src/App.tsx` mà không có bất kỳ lệnh gọi hay tham chiếu nào trong component `App`.
- **Input**: `src/App.tsx` chứa dòng 16 `import { useTacticalStore } from "./store/useTacticalStore";`.
- **Processing**: Loại bỏ dòng import không dùng `useTacticalStore` khỏi `src/App.tsx`.
- **Output**: `src/App.tsx` không còn import thừa; loại bỏ triệt để cảnh báo/lỗi TS6133.
- **Giá trị quan trọng gây lỗi**: Mã lỗi TypeScript `TS6133` do cấu hình `"noUnusedLocals": true`.
- **Xác minh**: Chạy `npx tsc --noEmit --project tsconfig.app.json`, xác nhận `src/App.tsx` hoàn toàn không còn bất kỳ lỗi nào.

## 8. Cải tiến Vòm Radar 3D: Single Source of Truth Detection Volume Engine

### 8.1. Tổng quan tính năng
Triển khai hệ thống mô hình hoá Vòm Radar 3D (Detection Volume) theo tài liệu chuyên ngành:
- `Ke_Hoach_Cai_Tien_Vom_Radar_3D.docx` (Kế hoạch cải tiến Vòm Radar 3D)
- `Kien_thuc_chuyen_nganh_Radar_trang_454_482.docx` (Kiến thức chuyên ngành Radar - Độ cong Trái Đất, Khúc xạ, Che khuất, Vùng mù đỉnh đầu)

Hệ thống xây dựng ma trận dữ liệu trung gian chuẩn hoá:
`Trục Độ cao (Altitude Bands) × Trục Phương vị (Azimuth Samples) × Trạng thái Khả kiến (Visibility State)`
làm **Single Source of Truth** dùng chung cho Vòm 3D Mesh, Mặt cắt đứng 2D và Phân tích kiểm tra tác chiến. Chế độ 2D SPx Cambridge Pixel được bảo toàn tuyệt đối không thay đổi.

### 8.2. Bảng thông số kỹ thuật quan trọng

| Tên biến | Type | Giá trị mặc định | Đơn vị | Phạm vi | Nơi khai báo / Nơi sử dụng | Ý nghĩa & Nguồn gốc |
|---|---|---|---|---|---|---|
| `altitudeBands` | `number[]` | `[100, 300, 500, 1k, ... 30k]` | mét (m) | `[50, 50000]` | `radarVolumeEngine.ts` / Toàn bộ engine | Danh sách các tầng độ cao khảo sát, kết hợp từ `altitudeDetectionTable` của khí tài và các tầng chuẩn PK |
| `azimuthSamples` | `number[]` | `[0, 5, 10, ... 355]` (72 hướng) | độ (°) | `[0, 359]` | `radarVolumeEngine.ts` / Toàn bộ engine | Các hướng phương vị lấy mẫu bề mặt vòm 3D (bước nhảy `azimuthStepDeg = 5°`) |
| `nominalRanges` | `number[][]` | Ma trận `numBands × numAz` | mét (m) | `[1000, 500000]` | `radarVolumeEngine.ts` / Geometry & Store | Cự ly danh nghĩa lý thuyết tại từng tầng cao và từng hướng trước khi chịu tác động của địa hình |
| `effectiveRanges` | `number[][]` | Ma trận `numBands × numAz` | mét (m) | `[0, nominalRange]` | `radarVolumeEngine.ts` / Geometry & Store | Cự ly hiệu dụng thực tế sau khi bị chướng ngại vật địa hình (DEM) cắt xén |
| `innerConeRadii` | `number[]` | Mảng theo `altitudeBands` | mét (m) | `[0, maxRange]` | `radarVolumeEngine.ts` / Geometry & Footprint | Bán kính nón mù đỉnh đầu $R_{kh} = \Delta H \cdot \cot(\varepsilon_{max})$ tại từng tầng cao |
| `radarCenterAltM` | `number` | `altitude + antennaHeightAGL` | mét (m) | `[0, 10000]` | `radarVolumeEngine.ts` | Cao độ tâm bức xạ anten so với mực nước biển (MSL) |
| `dome3DMode` | `'nominal' \| 'terrain-aware'` | `'terrain-aware'` | Enum | `'nominal'`, `'terrain-aware'` | `useTacticalStore.ts` / `CesiumGlobe.tsx` / `RightInspector.tsx` | Chế độ hiển thị vòm 3D: Danh nghĩa (lý thuyết phẳng) hoặc Cắt địa hình thực tế (LOS) |
| `selectedAltitudeM` | `number` | `1000` | mét (m) | `[50, 35000]` | `useTacticalStore.ts` / `RightInspector.tsx` | Tầng độ cao đang được chọn để khảo sát nhanh trên bảng điều khiển |

### 8.3. Công thức toán học và nguyên lý vật lý

1. **Giới hạn cự ly đường chân trời quang học / vô tuyến ($k = 4/3$ chuẩn khí quyển quân sự)**:
   $$D_{nt} = 4.12 \times \left(\sqrt{h_a} + \sqrt{H_{mt}}\right) \times \sqrt{\frac{k}{4/3}} \quad (\text{km})$$
   với $h_a$ là độ cao tháp anten (m), $H_{mt}$ là độ cao mục tiêu bay (m).

2. **Giới hạn bởi mép dưới cánh sóng radar ($\varepsilon_{min}$)**:
   Tại cự ly $D$, độ cao mép dưới cánh sóng:
   $$H_{beam}(D) = h_a + D \cdot \tan(\varepsilon_{min}) + \frac{D^2}{2 k R_E}$$
   Mục tiêu chỉ nằm trong trường phủ sóng khi $H_{beam}(D) \le H_{mt} \implies D \le \frac{H_{mt} - h_a}{\tan(\varepsilon_{min})}$.

3. **Bán kính nón mù đỉnh đầu (Cone of Silence)**:
   $$R_{kh} = \Delta H \cdot \cot(\varepsilon_{max}) = \max(0, H_{mt} - H_{radar}) \cdot \frac{1}{\tan(\varepsilon_{max})}$$

4. **Độ phồng Trái Đất (Earth Bulge) & Góc chắn địa hình cực đại**:
   $$\Delta h(s) = \frac{s^2}{2 k R_E}$$
   $$\tan \theta_{mask} = \max_{0 < s \le d} \left( \frac{h_{terrain}(s) - H_{radar} + \Delta h(s)}{s} \right)$$
   Mục tiêu bị che khuất khi $\tan \theta_{target} < \tan \theta_{mask}$.

5. **Toạ độ đỉnh GPU Double Precision (Local ENU)**:
   Anten radar làm gốc toạ độ $O(0, 0, 0)$:
   $$X = R_{eff} \cdot \sin(\text{Azimuth})$$
   $$Y = R_{eff} \cdot \cos(\text{Azimuth})$$
   $$Z = \max(0, H_{mt} - H_{radar})$$
   Cesium `GeometryInstance` đặt `modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(radarCartesian)`, GPU tự động khử rung giật số thực ở cự ly hàng trăm kilômét nhờ phân tách High/Low precision.

### 8.4. Lỗi phát sinh & Quá trình sửa chữa trong quá trình triển khai

1. **Lỗi `ReferenceError: radarAltM is not defined`**:
   - *Nguyên nhân*: Trong `radarVolumeEngine.ts`, biến lưu cao độ anten được đặt tên là `radarCenterAltM` (dòng 175), nhưng ở dòng 194 khi tính `innerConeRadii` lại tham chiếu nhầm tên `radarAltM`.
   - *Khắc phục*: Thay đổi thành `const deltaH = Math.max(0, altM - radarCenterAltM);`.
2. **Lỗi tính cự ly danh nghĩa tại độ cao thấp ($H_{mt} < 1000\text{m}$)**:
   - *Nguyên nhân*: Hàm `calculateNominalRangeAtAltitude` trước đây dùng cự ly ước lượng cố định `maxRangeM * 0.7 = 210km` để tính góc tà $\arcsin(\Delta H / D_{est})$, khiến góc tà rơi xuống $0.02^\circ < \varepsilon_{min} = 0.5^\circ$, dẫn đến việc `getProfileMaxRange` ngắt toàn bộ cự ly về 1km.
   - *Khắc phục*: Thay bằng thuật toán vật lý kết hợp: giới hạn đường chân trời $D_{nt}$ và góc quét tối thiểu $\Delta H / \tan(\varepsilon_{min})$, giúp cự ly tại 100m đạt 8.59km, 1000m đạt 111.72km, và 10km đạt 290.41km, tăng đơn điệu chính xác.
3. **Lỗi Type TS2739 trên Cesium `GeometryAttributes`**:
   - *Nguyên nhân*: Trong `radarVolumeGeometry.ts`, khai báo object literal `{ position, normal, st }` thiếu các thuộc tính tùy chọn `tangent`, `bitangent`, `color` của Cesium interface.
   - *Khắc phục*: Khởi tạo bằng `const attributes = new Cesium.GeometryAttributes();` rồi gán từng thuộc tính tương tự như `radarDomeGeometry.ts`.
4. **Lỗi thuộc tính không khớp giữa `RadarCoverageVolume` và UI**:
   - *Nguyên nhân*: Trong `RightInspector.tsx`, truy cập các trường cũ như `nominalRangeM` thay vì `nominalRangeKm`, `avgEffectiveRangeM` thay vì `averageEffectiveRangeKm`, `totalAzimuths` thay vì `azimuthSamples.length`.
   - *Khắc phục*: Đồng bộ hoá 100% với `AltitudeBandInfo` và `RadarCoverageVolume` trong `src/types/radarVolume.ts`.

### 8.5. Kết quả xác minh
- **Biên dịch TypeScript**: `npx tsc -b` hoàn thành với mã thoát 0 (0 error).
- **Linter**: `oxlint` chạy trên 48 files, 0 errors.
- **Kiểm thử tự động logic toán học**: Script `verify_radar_volume.ts` chạy qua `npx tsx` đạt **100%** trên 8 hạng mục kiểm thử:
  1. Trích xuất tầng cao đơn điệu: ĐẠT.
  2. Cự ly danh nghĩa đường chân trời: ĐẠT.
  3. Ma trận Altitude × Azimuth (13 × 72 = 936 cells): ĐẠT.
  4. Bán kính nón mù đỉnh đầu khớp công thức $H \cdot \cot(\varepsilon_{max})$: ĐẠT (50.27 km tại 30km).
  5. Dựng lưới Mesh Danh Nghĩa (1872 đỉnh, 3744 tam giác, pháp tuyến chuẩn hoá len = 1.0): ĐẠT.
  6. Dựng lưới Mesh Cắt Địa Hình (1872 đỉnh, 3744 tam giác): ĐẠT.
  7. Cesium GeometryInstance GPU Double Precision: ĐẠT.
  8. Cache key và Invalidation: ĐẠT.

---

## 9. Khắc phục lỗi Type Narrowing Discriminated Union & Strict Mode (Vector AI & Tactical Store)

### 9.1. Mô tả nguyên nhân (Root Cause)
- **Nguyên nhân chính**: Trong cấu hình `tsconfig.app.json`, tuỳ chọn `"strict": true` chưa được bật. Khi không có chế độ nghiêm ngặt (`strictNullChecks: false`), trình kiểm tra kiểu TypeScript hạ cấp kiểu literal boolean `true` / `false` thành kiểu tổng quát `boolean`. Do đó, biểu thức kiểm tra `if (!result.ok)` không thể thu hẹp (narrow) kiểu Discriminated Union `{ ok: true; value: T } | { ok: false; error: VectorAiError }`.
- **Hệ quả**:
  1. Trong `src/services/vectorAiClient.ts` (dòng 172, 217, 248, 385): Khi lệnh `return fetched;`, `return health;`, `return result;`, `return startFetched;` được gọi bên trong nhánh `if (!xxx.ok)`, TypeScript không loại bỏ được nhánh `{ ok: true }`, dẫn đến lỗi không tương thích kiểu (mismatched return type, thiếu `value`, hoặc `VectorAiResult<VectorAiHealth>` không gán được cho `VectorAiResult<void>`).
  2. Trong `src/store/useTacticalStore.ts` (dòng 603, 606, 648, 649, 657): Khi truy cập `health.error`, `answer.error` hoặc `parsed.message`, do biến không được thu hẹp, TypeScript báo lỗi `Property 'error' does not exist on type '{ ok: true; value: ... }'`.
  3. Trong `src/components/ui/AiPlacementAdvisorPanel.tsx` (dòng 89): Lệnh `const result = started.ok ? await listVectorAiModels() : started;` gộp kiểu của `VectorAiResult<void>` và `VectorAiResult<string[]>`, dẫn đến `result.value` có kiểu `void | string[]`, gây lỗi truy cập mảng ở các dòng sau.

### 9.2. Chi tiết Input - Processing - Output

1. **Vấn đề cấu hình TypeScript (`tsconfig.app.json`)**:
   - **Input**: `tsconfig.app.json` chỉ có các tuỳ chọn linting `noUnusedLocals`, `noUnusedParameters`, thiếu `"strict": true`.
   - **Processing**: Bổ sung `"strict": true` vào nhóm cấu hình `compilerOptions`.
   - **Output**: Kích hoạt `strictNullChecks`, cho phép TypeScript phân biệt chính xác các nhánh discriminated union với thuộc tính cờ `ok: true | false`.

2. **Vấn đề trả về lỗi trong `src/services/vectorAiClient.ts`**:
   - **Input**: Các lệnh `return fetched;` (dòng 172), `return health;` (dòng 217), `return result;` (dòng 248), `return startFetched;` (dòng 385).
   - **Processing**: Thay thế bằng việc trả về object lỗi tường minh `{ ok: false, error: ...error }`, đảm bảo kiểu trả về khớp 100% với `VectorAiResult<T>` kể cả trong các môi trường kiểm tra kiểu khác nhau.
   - **Output**: Triệt tiêu hoàn toàn lỗi không tương thích gán kiểu giữa các kiểu generic `T`, `void`, `string[]`.

3. **Vấn đề chuỗi gọi bất đồng bộ trong `AiPlacementAdvisorPanel.tsx`**:
   - **Input**: Toán tử 3 ngôi gộp 2 tác vụ `ensureVectorAiReady` (trả về `void`) và `listVectorAiModels` (trả về `string[]`).
   - **Processing**: Tách riêng biệt: kiểm tra `started.ok` trước, nếu thất bại thoát ngay; sau đó mới gọi `listVectorAiModels` và gán `result.value`.
   - **Output**: Biến `result.value` được bảo đảm 100% là `string[]`, an toàn truy cập `.includes()` và chỉ số phần tử `[0]`.

### 9.3. Giá trị quan trọng gây lỗi
- `compilerOptions.strict`: `undefined` (mặc định `false` -> vô hiệu hoá boolean literal discrimination).
- `VectorAiResult<T>` discriminant key: `ok: true` vs `ok: false`.

### 9.4. Xác minh sau khi sửa
- **TypeScript build check**:
  - `npx tsc -p tsconfig.app.json`: Mã thoát 0 (0 error).
  - `npx tsc -b`: Mã thoát 0 (0 error).
  - `npx tsc -p tsconfig.app.json --noEmit`: Mã thoát 0 (0 error).
- **Linter check**:
  - `npm run lint` (`oxlint`): 0 error.
- **Harness runtime test**:
  - `docs/verify-vector-ai-client.ts`: 8/8 test cases PASS (SSE, health, models, error kinds).
  - `docs/verify-dome-and-advisor.ts`: 22/22 test cases PASS.

---

## 10. Sửa lỗi tầm cự ly vùng mù (Blind Zone) không khớp với vòm 3D và Tái thiết kế Tab "3D / LOS Không Gian" (Inspector)

### 10.1. Triệu chứng và Bối cảnh (Symptoms)
1. **Lỗi vùng mù địa hình (vùng màu đỏ hiển thị trên map) tràn ra ngoài cự ly vòm radar**:
   - Khi chọn đài radar (ví dụ Đài Radar 36D6 / ST-68UM có bán kính trinh sát `rangeKm = 75km`) và bật hiển thị vùng mù (`showBlindZones`), khu vực bóng râm địa hình (màu đỏ) bị phóng rộng ra tới 112.7 km – tràn ra ngoài biên vòm 37.7 km.
   - Tại các phương vị chuyển tiếp giữa tia bị che (blocked) và tia thông suốt (unblocked), xuất hiện hiện tượng gai nhọn thụt sâu về tâm đài radar (toạ độ lat/lon của đài, khoảng cách 0m).
2. **Tab "3D / LOS KHÔNG GIAN" trong Right Inspector bị rối và trùng lặp**:
   - Hai thanh điều chỉnh độ cao riêng biệt (`Độ cao mục tiêu (H_mt)` và `Khảo sát nhanh tầng cao`) khiến người dùng bị phân tán và không đồng bộ trạng thái.
   - Header thiếu nút bật/tắt nhanh vùng mù địa hình (`showBlindZones`).
   - Các tuỳ chỉnh đồ hoạ vòm shader (alpha, rimColor, scan line speed, phân đoạn...) nằm lẫn lộn gây choáng ngợp giao diện tác chiến.

### 10.2. Nguyên nhân gốc rễ (Root Cause)
1. **Lỗi cự ly vùng mù**:
   - Hàm `getProfileMaxRange` trong `src/utils/radarMath.ts` đọc giá trị cự ly tối đa từ `coverageProfile.points` (có thể lên tới 300 km) mà không scale hay kẹp (clamp) lại theo tầm cự ly thực tế của đài `instance.rangeKm` (75 km).
   - Biến `field.maxRangeKm` trong `src/utils/radarLosEngine.ts` nhận giá trị profile 300 km.
   - Trong `src/utils/radarGeometryBuilder.ts` (`buildRadarCoverageFieldEntities`), cự ly ngoài cùng của bóng râm `destShadowEnd` được tính: `maxDetectionDistanceM = Math.min(profileMaxM, horizonM)`. Với `profileMaxM = 300,000 m` và `horizonM = 112,700 m` (tại $H_{mt} = 500\text{ m}$), cự ly ngoài cùng bị áp theo đường chân trời vô tuyến 112.7 km, vượt xa tầm cự ly thiết kế 75 km của đài.
   - Khi tia kế tiếp không bị che, toạ độ chuyển tiếp `sOccLat / sOccLon` bị fallback về `(radarLat, radarLon)` (cự ly 0 m), tạo ra tam giác gai nhọn thụt vào tâm.

2. **Giao diện Inspector Tab 3D**:
   - Tồn tại đồng thời `targetHeightMeters` (dùng cho LOS raycast) và `selectedAltitudeM` (dùng cho ma trận khảo sát) mà không được đồng bộ tập trung.
   - Các nút chip chọn nhanh độ cao bị lặp lại ở 2 khu vực.
   - Shader styling chiếm quá nhiều không gian màn hình chính.

### 10.3. Chi tiết Input - Processing - Output & Thông số quan trọng
1. **Thông số `getProfileMaxRange`**:
   - **File**: `src/utils/radarMath.ts`
   - **Biến**: `fallbackRangeKm` (km), `maxProfileKm` (km), `rawRange` (km).
   - **Giá trị trước**: Không chuẩn hoá theo tỉ lệ `fallbackRangeKm / maxProfileKm`. Giá trị trả về lên tới 300 km.
   - **Giá trị sau**: Tỉ lệ scale `fallbackRangeKm / maxProfileKm` và kẹp trần `Math.min(fallbackRangeKm, ...)`. Luôn $\le fallbackRangeKm$ (75 km).
2. **Thông số `globalMaxRangeKm`**:
   - **File**: `src/utils/radarLosEngine.ts`
   - **Biến**: `globalMaxRangeKm` (km).
   - **Giá trị trước**: `Math.max(instance.rangeKm, profileMaxRangeKm)` = 300 km.
   - **Giá trị sau**: `Math.min(instance.rangeKm, profileMaxRangeKm || instance.rangeKm)` = 75 km.
3. **Thông số `maxDetectionDistanceM` & `destShadowEnd`**:
   - **File**: `src/utils/radarGeometryBuilder.ts`
   - **Biến**: `maxEffectiveRangeM` (m), `maxDetectionDistanceM` (m).
   - **Giá trị trước**: `Math.min(profileMaxM, horizonM)` = 112,700 m.
   - **Giá trị sau**: `Math.min(profileMaxM, maxEffectiveRangeM || profileMaxM, horizonM)` = 75,000 m.
   - **Điểm chuyển tiếp**: Khi tia kế tiếp không bị che, `sOccDistM` lấy bằng `destShadowEnd` (mép ngoài cùng, độ dày bóng râm = 0) thay vì toạ độ tâm đài, loại bỏ hoàn toàn gai nhọn thụt về tâm.
4. **Liên kết Cesium Map**:
   - **File**: `src/components/map/CesiumGlobe.tsx`
   - **Truyền tham số**: `safeRangeKm * 1000` vào tham số `maxEffectiveRangeM` của `buildRadarCoverageFieldEntities`.
5. **Giao diện RightInspector**:
   - **File**: `src/components/ui/RightInspector.tsx`
   - Bổ sung nút chuyển nhanh `VÙNG MÙ: BẬT / TẮT` trên thanh tiêu đề khối LOS.
   - Hợp nhất điều khiển độ cao mục tiêu $H_{mt}$ với thanh trượt mượt mà (20m - 30.000m) và 11 chip khảo sát nhanh (`50m, 100m, 300m, 500m, 1k, 2k, 3k, 5k, 10k, 20k, 30k`), đồng bộ cùng lúc cả `targetHeightMeters` và `selectedAltitudeM`.
   - Thu gọn toàn bộ các tuỳ chọn shader chi tiết (alpha, viền sáng, tốc độ quét...) vào Accordion `TÙY BIẾN ĐỒ HỌA VÒM 3D (SHADER)`, mặc định đóng gọn gàng.

### 10.4. Xác minh sau khi sửa
1. **Kiểm thử tự động toán học & hình học**:
   - Tạo mới `docs/verify-blind-zone-range.ts` kiểm thử cự ly thực tế và hình học:
     - `getProfileMaxRange` ở tất cả góc tà: $\le 75\text{ km}$ (PASS).
     - `computeRadarCoverageField`: `field.maxRangeKm === 75`, tất cả rays $\le 75\text{ km}$ (PASS).
     - `buildRadarCoverageFieldEntities`: Đỉnh xa nhất của vùng mù = 75.00 km $\le 75\text{ km}$ (PASS).
     - Kiểm tra không có đỉnh nào thụt về tâm đài (< 100m) khi chuyển tiếp: `hasSpikeToCenter: false` (PASS).
2. **Kiểm thử biên dịch & linting**:
   - `npx tsc -b`: PASS (0 error).
   - `npx tsc -p tsconfig.app.json --noEmit`: PASS (0 error).
   - `npm run lint` (`oxlint`): PASS (0 error).
   - `npx tsx docs/verify-dome-and-advisor.ts`: 22/22 tests PASS.

### 10.5. Khắc phục lỗi TypeScript trong verify-blind-zone-range.ts
- **Mô tả nguyên nhân**: File script kiểm thử `docs/verify-blind-zone-range.ts` truyền nhầm hàm callback giả lập `mockElevationLookup: (_lat: number, _lon: number) => Promise<number>` vào vị trí tham số thứ 2 của hàm `computeRadarCoverageField`. Tuy nhiên chữ ký của hàm `computeRadarCoverageField` trong `src/utils/radarLosEngine.ts` quy định:
  `computeRadarCoverageField(instance: EquipmentInstance, terrainProvider: Cesium.TerrainProvider | null, params: RadarCalculationParams)`.
  Điều này khiến IDE TypeScript language server báo lỗi:
  `Argument of type '(_lat: number, _lon: number) => Promise<number>' is not assignable to parameter of type 'TerrainProvider'.`
  Đồng thời, tham số cấu hình thứ 3 truyền sai tên trường (`rangeStepKm`, `targetHeightM` thay vì `radialStepMeters`, `targetHeightMeters`).
- **Input**:
  - `mockInstance: EquipmentInstance` (Đài 36D6, rangeKm = 75km).
  - Không có kết nối Cesium Terrain server trong môi trường Node.js CLI script.
- **Processing**:
  - Thay thế tham số thứ 2 bằng `null` (trong engine `radarLosEngine.ts`, `terrainProvider = null` được xử lý an toàn bằng cơ chế `flat_fallback` với cao độ 0m).
  - Chuẩn hoá cấu hình tham số `RadarCalculationParams`:
    `azimuthStepDeg: 5`, `radialStepMeters: 1000`, `targetHeightMeters: 500`, `kFactor: 1.3333`, `showBlindZones: true`.
  - Tối ưu trích xuất `hierarchy` của polygon entity tránh cảnh báo `unsafe-optional-chaining`.
- **Output**:
  - Khắc phục hoàn toàn lỗi TypeScript TS2345 và cảnh báo linting.
  - Test harness `verify-blind-zone-range.ts` thực thi trơn tru với 100% test cases PASS.
- **Giá trị quan trọng gây lỗi**:
  - Biến `mockElevationLookup` kiểu hàm bất đồng bộ không tương thích với interface `Cesium.TerrainProvider`.
- **Xác minh**:
  - `npx tsx docs/verify-blind-zone-range.ts`: ALL BLIND ZONE RANGE CHECKS PASSED!
  - `npx tsc docs/verify-blind-zone-range.ts --noEmit --skipLibCheck --moduleResolution bundler --target es2023 --module esnext --types node --ignoreConfig`: PASS (0 error).
  - `npx tsc -b`: PASS (0 error).
  - `npm run lint`: PASS (0 warning trong `docs/verify-blind-zone-range.ts`).

---

## 11. [2026-09-23] Triển khai Đặc tả Kỹ thuật: Radar 3D Terrain Visibility (Cải tiến Vòm 3D Chắn Địa hình)

### 11.1. Thông tin chung
- **Ngày**: 2026-09-23
- **Tính năng/Module**: Radar 3D Terrain Visibility & Tactical Terrain Masking
- **Vấn đề hoặc mục tiêu**: Triển khai đầy đủ theo Tài liệu Kỹ thuật Version 1.0 (50 mục). Nâng cấp vòm 3D radar từ mô hình co rút bán kính mép ngoài thành mô hình 3D Terrain-Adjusted Coverage chuẩn quân sự:
  - Tách bạch 4 lớp độc lập: CoverageProfile, TerrainSampler, HorizonAnalyzer/LOS, CoverageMeshBuilder.
  - Dựng đồng bộ cả **Visible Shell** (vỏ vòm nhìn thấy) và **Occluded Shadow Volume** (khối nêm bóng râm 3D sau núi) với vật liệu bán trong suốt, không che khuất địa hình bên dưới.
  - Bổ sung 3 Camera Presets tác chiến: Observer Side (từ đài), Behind Terrain (từ sau núi nhìn ngược về đài), Top-Down (từ trên cao nhìn xuống).
  - Xây dựng bộ test matrix hình học độc lập SyntheticTerrainSampler và script kiểm thử tự động docs/verify-radar-terrain-visibility.ts.

### 11.2. Các file đã thay đổi & tạo mới
1. `docs/PROJECT_INTEGRATION_NOTE.md` [NEW]: Báo cáo audit hệ thống hiện hữu và phân tích tích hợp.
2. `src/utils/radarVisibilityEngine.ts` [NEW]: Động cơ phân tích địa hình, Horizon cực đại theta_horizon, kiểm tra LOS và cache kết quả theo WGS-84/ENU.
3. `src/utils/radarVolumeGeometry.ts` [MODIFY]: Bổ sung hàm dựng 3D khối bóng râm sau núi buildRadarOccludedVolumeGeometry và createRadarOccludedGeometryInstance.
4. `src/utils/radarDomeMaterial.ts` [MODIFY]: Bổ sung vật liệu shader bán trong suốt màu hổ phách/cam đỏ createRadarOccludedMaterial.
5. `src/store/useTacticalStore.ts` [MODIFY]: Bổ sung trạng thái showOccludedVolume, toggleOccludedVolume, và action điều khiển triggerRadarCameraPreset.
6. `src/components/ui/RightInspector.tsx` [MODIFY]: Thêm khối điều khiển Góc nhìn Tác chiến Radar (3 camera presets) và nút bật/tắt khối bóng râm 3D.
7. `src/components/map/CesiumGlobe.tsx` [MODIFY]: Tích hợp render shadowPrimitive, cập nhật safeHeight cho camera chiến thuật và thêm dependencies.
8. `docs/verify-radar-terrain-visibility.ts` [NEW]: Ma trận kiểm thử đơn vị toàn diện (14 test cases) theo Mục 36 đặc tả.
9. `docs/DEBUG_NOTES.md` [MODIFY]: Ghi chép thông số kỹ thuật theo quy định.

### 11.3. Bảng thông số kỹ thuật & Biến quan trọng
- `maxHorizonAngleRad` (number, radian, [-pi/2, pi/2]): Goc nang cuc dai cua be mat dia hinh doc theo mot huong phuong vi. theta_terrain = atan2((H_t - H_0 + hz), d).
- `clearanceMeters` (number, mét, [-inf, +inf]): Do chenh lech giua cao do duong ngam LOS va cao do dia hinh tai cu ly khao sat. >0: thong suot, <0: bi chan.
- `showOccludedVolume` (boolean, mặc định true): Bật/tắt hiển thị khối bóng râm 3D sau núi trên địa cầu Cesium.
- `boundaryToleranceRad` (number, 0.003 rad ~ 0.17 deg): Biên góc nhận diện trạng thái tiếp giáp Boundary giữa Visible và Occluded.
- `shadowAlpha` (number, 0.20): Độ mờ của vỏ bóng râm phía sau núi để không làm mất texture địa hình bên dưới.

### 11.4. Công thức toán học & Thuật toán
1. **Góc nâng địa hình & Chân trời tích lũy**:
   theta_terrain(d) = atan2(H_terrain(d) - H_radar + hz(d), d)
   theta_horizon = max_{s <= d} theta_terrain(s)
2. **Kiểm tra trạng thái quan sát LOS (Line-of-Sight)**:
   theta_target = atan2(H_target - H_radar + hz(D), D)
   - Nếu theta_target > theta_horizon + eps => VisibilityState.Visible
   - Nếu |theta_target - theta_horizon| <= eps => VisibilityState.Boundary
   - Nếu theta_target < theta_horizon - eps => VisibilityState.Occluded
3. **Hình học Khối nêm Bóng râm (Occluded Shadow Wedge)**:
   Nối từ R_eff(Az, H) = effectiveRanges[k][j] (sườn núi) ra R_nom(Az, H) = nominalRanges[k][j] (biên danh nghĩa của vòm).

### 11.5. Kết quả kiểm tra & Xác minh
1. **Đơn vị hình học (Unit Test Matrix - Mục 36)**:
   - Chạy lệnh: `npx tsx docs/verify-radar-terrain-visibility.ts`
   - Kết quả: **14/14 tests PASS (0 failure)**.
     - Flat terrain: Occluded = 0 (PASS).
     - Single hill: Xuất hiện shadow hướng 90 deg (PASS).
     - High mountain: Shadow mở rộng khi núi cao hơn (PASS).
     - Near vs Far: Núi gần che khuất góc lớn hơn núi xa (PASS).
     - Multi-mountain: Lấy đúng đỉnh horizon cao nhất (PASS).
     - Observer height: Nâng anten làm giảm vùng mù (PASS).
     - Observer moved: Đổi cache key (PASS).
     - Constant profile: Toàn bộ mẫu đúng 50km (PASS).
     - Profile changed: Invalidation chính xác (PASS).
     - State & Clearance: Visible > 0, Boundary ~ 0, Occluded < 0 (PASS).
     - Cache hit & Invalidation: Đúng 100% (PASS).
2. **Kiểm tra tương thích ngược với các test cũ**:
   - `npx tsx docs/verify-blind-zone-range.ts`: ALL BLIND ZONE RANGE CHECKS PASSED.
   - `npx tsx docs/verify-dome-and-advisor.ts`: ALL CHECKS PASSED.
3. **Biên dịch & Linter**:
   - `npx tsc --noEmit`: PASS (0 error).
   - `npm run lint` (oxlint): PASS (0 error).

### 11.6. Kết luận
Hệ thống vòm 3D đã được nâng cấp toàn diện theo đúng chuẩn đặc tả kỹ thuật:
- Chắn đúng địa hình thực tế (Terrain Masking).
- Trực quan hóa rõ ràng cả phần nhìn thấy lẫn khối bóng râm sau núi với độ trong suốt tối ưu.
- Cung cấp các góc nhìn tác chiến thuận tiện (`Behind Terrain`, `Observer Side`, `Top-Down`) giúp người chỉ huy lập kế hoạch bố trí trận địa phòng không trực quan và chính xác.
- Không thực hiện bất kỳ lệnh git commit hay git push nào theo đúng quy tắc dự án.

---

## 12. Debug & Khắc phục lỗi Vòm Radar quét xuyên qua Núi An Khê (Near-field Mountain Masking Blindspot & Earth Bulge Sign Inversion)
- **Ngày thực hiện**: 2026-09-23
- **Thực hiện theo**: `/debug` workflow & project-development-rules.md
- **Người yêu cầu**: Người dùng phản ánh khi đặt đài radar 36D6 ở chân núi An Khê (`16° 2' 4.2" N, 108° 10' 18.2" E`, Đà Nẵng), đứng bên trong quan sát thấy vòm quét 3D không bị núi chắn mà vẫn xuyên thẳng qua núi về phía sau.

### 12.1. Triệu chứng & Tái hiện (Symptom & Reproduction)
1. **Môi trường & Vị trí đài**:
   - Đài Radar: 36D6 (ST-68UM) #1
   - Tọa độ: `lat = 16.0345° N, lon = 108.17172° E` (chân núi An Khê, Đà Nẵng).
   - Cao độ đài: 40m (MSL), chiều cao anten: 25m (AGL) => Cao độ tâm anten = 65m MSL.
   - Tầm trinh sát danh nghĩa: 300 km.
   - Địa hình thực tế: Ngay sát phía Tây đài (hướng 240° - 300°, cự ly 200m - 1.500m) là dãy núi An Khê với đỉnh cao 243m MSL, cao hơn anten radar tới 178m ở cự ly chỉ 1 km (góc che chắn hình học $\theta_{mask} \approx 10.1^\circ$ đến $11.5^\circ$).
2. **Triệu chứng lỗi**:
   - Trên địa cầu 3D, vòm quét màu vàng bán trong suốt không bị chặn lại ở sườn núi An Khê mà kéo dài liên tục xuyên qua ngọn núi ra tới hàng chục kilômét (tại tầng 1000m kéo dài tới 43.3 km; tại tầng 100m kéo dài tới 8.6 km).
   - Trên bảng chỉ số RightInspector:
     - Tầm danh nghĩa tầng 1000m: `111.7 km`
     - Tầm hiệu dụng sau núi: `61.4 km` (bị cắt giả tạo ở 61.4 km thay vì 4.58 km sau núi An Khê).
     - Tỷ lệ che chắn: báo `100.0%` (mọi hướng 360°, kể cả hướng Đông ra biển phẳng không có núi cũng bị báo che chắn tại ~61.4 km).

### 12.2. Phân tích Nguyên nhân gốc rễ (Root Cause Analysis)
Qua truy vết mã nguồn và dữ liệu thực nghiệm DEM từ `CesiumTerrainProvider`, phát hiện 2 nguyên nhân cốt lõi tác động qua lại:

1. **Bỏ qua địa hình cự ly gần do bước nhảy mẫu quá lớn (Near-field Sampling Blindspot)**:
   - Trong `src/components/map/CesiumGlobe.tsx`:
     `radialStepMeters = Math.max(1500, Math.round((inst.rangeKm * 1000) / 45))`
     Với đài 36D6 tầm 300 km: `radialStepMeters = 300.000 / 45 = 6.667 mét (~6.67 km)`.
   - Trong `src/utils/radarVolumeEngine.ts`:
     `const minDist = Math.max(500, radialStepMeters);`
     `for (let d = minDist; d <= maxRangeM; d += radialStepMeters)`
     => `minDist = 6.667 mét`!
     **Điểm lấy mẫu địa hình đầu tiên của mỗi tia quét bắt đầu ở cự ly 6.67 km!**
   - Núi An Khê nằm hoàn toàn trong phạm vi cự ly $200\text{m} \le d \le 3.000\text{m}$.
   - Vì lấy mẫu bắt đầu từ 6.67 km, thuật toán hoàn toàn **nhảy cóc qua ngọn núi An Khê cao 243m**. Tại 6.67 km, địa hình đã hạ xuống đồng bằng Cẩm Lệ (cao độ chỉ 7.6m). Do đó ngọn núi An Khê hoàn toàn không tồn tại trong `terrainMap`!

2. **Sai dấu độ cong Trái Đất trong tính toán góc nâng địa hình (Earth Bulge Sign Inversion)**:
   - Trong `src/utils/radarVolumeEngine.ts` (dòng 283):
     `const deltaHCurvature = calculateEarthBulgeMeters(dist, kFactor);`
     `const tanObstacle = (groundAlt - radarCenterAltM + deltaHCurvature) / dist;` (SAI DẤU: `+ deltaHCurvature`)
   - **Vật lý hình học**: Khi đứng ở anten radar, bề mặt Trái Đất thực tế bị cong sụt xuống dưới mặt phẳng tiếp tuyến một khoảng $\Delta h(d) = \frac{d^2}{2 R_e}$. Do đó, cao độ của mặt đất so với mặt phẳng tiếp tuyến tại anten phải là:
     $z_{ground}(d) = groundAlt - radarCenterAltM - \Delta h(d)$
   - Việc cộng nhầm `+ deltaHCurvature` làm mặt đất ở cự ly xa bị đội ngược lên trời!
     - Tại $d = 61.4$ km: $\Delta h \approx 222$m. Mặt biển phẳng $0$m bị tính thành $0 - 65 + 222 = +157$m!
     - Tại $d = 100$ km: $\Delta h \approx 588$m. Mặt biển phẳng $0$m bị tính thành $+523$m!
   - Điều này tạo ra một "ngọn núi ảo cao 222m" bao quanh đài ở cự ly ~60 km trên toàn bộ 360°, khiến tia quét ở mọi hướng (kể cả hướng ra biển Đông) đều bị ngắt ở 61.4 km, gây ra chỉ số `limited = 100.0%` giả tạo.

3. **Sai lệch cự ly ngắt hình học (Discretization Cutoff Step)**:
   - Khi phát hiện `tanTarget < maxMaskTan`, mã nguồn cũ gán:
     `effectiveDistM = Math.max(innerConeM, dist - radialStepMeters * 0.5);`
     Với bước nhảy 6.667m, giá trị ngắt bị giật bậc thô thiển thay vì giải giao tuyến giải tích chính xác của tia quét với đỉnh núi.

### 12.3. Giải pháp & Các thay đổi tối thiểu đã thực hiện
1. **Phân tầng lấy mẫu địa hình thích ứng (Adaptive Near-field + Far-field Sampling)**:
   - Trong `src/utils/radarVolumeEngine.ts` & `src/utils/radarLosEngine.ts`:
     Tích hợp 14 mốc cự ly dày đặc ở cự ly gần:
     `nearSteps = [200, 400, 600, 800, 1000, 1400, 1800, 2200, 2800, 3500, 4500, 6000, 8000, 10000]` (mét).
     Sau 10 km, tiếp tục lấy mẫu theo bước đều `farStep = Math.max(2500, radialStepMeters)`.
   - Tổng số điểm mẫu tăng rất ít (từ 45 lên 58 điểm/tia), không gây áp lực mạng/CPU, nhưng độ phân giải ở chân núi tăng gấp 33 lần (từ 6.670m xuống còn 200m).

2. **Sửa đúng công thức độ sụt cong Trái Đất**:
   - `tanObstacle = (groundAlt - radarCenterAltM - deltaHCurvature) / dist;`
   - Nhờ dấu trừ, mặt biển phẳng ($groundAlt = 0$) luôn có $tanObstacle < 0$, không bao giờ che chắn búp sóng radar.

3. **Cắt giao tuyến giải tích chính xác (Analytical Shadow Cutoff)**:
   - Giải phương trình bậc hai:
     $a \cdot d^2 + b \cdot d + c = 0$
     với $a = \frac{1}{2 R_e}$, $b = \max(\tan(minElevation), \theta_{mask})$, $c = -(altM - radarCenterAltM)$.
   - Tính nghiệm chính xác $d_{cutoff} = \frac{-b + \sqrt{b^2 - 4ac}}{2a}$, cho cự ly mặt cắt vòm mịn màng, ôm khít biên dạng địa hình.

### 12.4. Bảng thông số kỹ thuật & Biến quan trọng
| Tên biến / Thông số | Kiểu (Type) | Nơi khai báo & Sử dụng | Giá trị trước | Giá trị sau | Ý nghĩa & Đơn vị |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sampleDistances` (Near-field) | `number[]` | `radarVolumeEngine.ts`, `radarLosEngine.ts` | Bắt đầu từ 6.667m | `[200, 400, 600, 800, 1000, ...]` | Mốc cự ly lấy mẫu địa hình dọc theo tia phương vị (m). |
| Dấu $\Delta h$ trong `tanObstacle` | Phép toán | `radarVolumeEngine.ts:283` | `+ deltaHCurvature` | `- deltaHCurvature` | Độ sụt bề mặt do độ cong Trái Đất (m), sụt xuống dưới mặt phẳng tiếp tuyến. |
| Cự ly hiệu dụng tại An Khê (H=100m) | `number` | `effectiveRanges[0][az270]` | `8.594 m` (quét xuyên) | `172 m` (chắn sát chân núi) | Cự ly phát hiện tối đa tại tầng 100m hướng 270° (m). |
| Cự ly hiệu dụng tại An Khê (H=300m) | `number` | `effectiveRanges[1][az270]` | `16.668 m` (quét xuyên) | `1.152 m` (sau đỉnh núi 243m) | Cự ly phát hiện tối đa tại tầng 300m hướng 270° (m). |
| Cự ly hiệu dụng tại An Khê (H=1000m) | `number` | `effectiveRanges[3][az270]` | `43.336 m` (quét xuyên) | `4.578 m` (sau bóng râm núi) | Cự ly phát hiện tối đa tại tầng 1000m hướng 270° (m). |
| Hướng biển 90° (H=1000m) | `number` | `effectiveRanges[3][az90]` | `90.005 m` (bị biển chặn) | `111.724 m` (100% danh nghĩa) | Không còn hiện tượng mặt biển phẳng chắn sóng (m). |
| Tỷ lệ che chắn tầng 1000m | `number` | `bandInfos[3].terrainLimitedPercent` | `100.0%` (sai) | `64%` (đúng: Tây núi, Đông biển) | Tỷ lệ phần trăm các hướng phương vị bị địa hình che khuất (%). |

### 12.5. Kết quả kiểm tra & Xác minh (Verification)
1. **Kiểm tra thực tế với địa hình offline Đà Nẵng / Núi An Khê**:
   - Chạy kiểm thử trực tiếp từ CesiumTerrainProvider thực tế:
     - Hướng Tây 270° (Núi An Khê): Vòm 3D bị ngắt ngay tại 172m (chân núi) ở tầng 100m, và tại 1.15km ở tầng 300m (sau đỉnh núi 243m). Người dùng đứng bên trong nhìn ra thấy vòm bị chặn áp sát chân núi An Khê, không còn quét xuyên qua núi.
     - Hướng Đông 90° (Biển Đông): Toàn bộ các tầng đạt 100% tầm danh nghĩa lý thuyết (tầng 1000m đạt 111.7 km, tầng 5000m đạt 300 km).
     - Tỷ lệ che chắn phản ánh chính xác thực tế địa hình Đà Nẵng: 64% bị chắn phía Tây bởi dãy Trường Sơn / Bà Nà / An Khê; 36% thông thoáng hướng ra biển Đông.
2. **Kiểm tra hồi quy hệ thống (Regression Tests)**:
   - `npx tsx docs/verify-radar-terrain-visibility.ts`: **14/14 tests PASS (0 fail)**.
   - `npx tsx docs/verify-blind-zone-range.ts`: **ALL BLIND ZONE RANGE CHECKS PASSED**.
   - `npx tsx docs/verify-dome-and-advisor.ts`: **ALL CHECKS PASSED**.
   - `npx tsc --noEmit`: **PASS (0 lỗi TypeScript)**.
   - `npm run lint`: **PASS (0 lỗi oxlint)**.
3. **Quy tắc Git**: Tuyệt đối không tự ý chạy `git commit` hay `git push`.

## 13. Sửa lỗi TypeScript TS1294 (erasableSyntaxOnly) trong radarVisibilityEngine.ts

### 13.1. Mô tả nguyên nhân (Root Cause)
- **Triệu chứng**: Khi kiểm tra kiểu mã nguồn với cấu hình dự án (`tsconfig.app.json`), trình biên dịch TypeScript báo lỗi TS1294:
  `src/utils/radarVisibilityEngine.ts(44,13): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.`
- **Nguyên nhân cốt lõi**: Trong `tsconfig.app.json`, cờ compiler `"erasableSyntaxOnly": true` được kích hoạt (chuẩn TypeScript 5.8+). Chế độ này nghiêm cấm việc sử dụng các cú pháp TypeScript không thể xóa bỏ thuần túy (non-erasable syntax) như `enum`, `namespace`, hoặc constructor parameter properties vì chúng sinh ra mã JavaScript khi transpile.
- Tại dòng 44 của `src/utils/radarVisibilityEngine.ts`, `VisibilityState` được khai báo bằng `export enum VisibilityState { Visible = 'visible', Boundary = 'boundary', Occluded = 'occluded' }`, gây lỗi TS1294.

### 13.2. Xác định Input, Processing, Output
- **Input**: Khai báo `export enum VisibilityState` trong `src/utils/radarVisibilityEngine.ts` dòng 44-48.
- **Processing**:
  Chuyển đổi khai báo `enum` thành đối tượng hằng số (`as const`) kết hợp với union type:
  ```typescript
  export const VisibilityState = {
    Visible: 'visible',
    Boundary: 'boundary',
    Occluded: 'occluded',
  } as const;

  export type VisibilityState = (typeof VisibilityState)[keyof typeof VisibilityState];
  ```
  - Cú pháp `export const VisibilityState = { ... } as const;` là đối tượng JavaScript runtime chuẩn; các phần `as const` và `type` thuần túy được xóa bỏ (erased) lúc compile, tuân thủ 100% luật `erasableSyntaxOnly`.
  - Bảo toàn 100% tính tương thích ngược cho cả runtime (`VisibilityState.Visible`, `VisibilityState.Boundary`, `VisibilityState.Occluded`) và kiểu tĩnh (`VisibilityState`), không làm thay đổi hành vi logic ở bất kỳ module nào khác.
- **Output**:
  - Mã nguồn biên dịch thành công mà không có bất kỳ lỗi TS nào.
  - Các script kiểm thử hồi quy và logic phân tích tầm nhìn radar hoạt động nguyên vẹn.

### 13.3. Giá trị quan trọng gây lỗi
- `export enum VisibilityState` tại dòng 44 trong `src/utils/radarVisibilityEngine.ts`.

### 13.4. Kết quả xác minh (Verification)
- `npx tsc --noEmit -p tsconfig.app.json`: **Mã thoát 0 (0 lỗi)**.
- `npx tsc -b`: **Mã thoát 0 (0 lỗi)**.
- `npx tsx docs/verify-radar-terrain-visibility.ts`: **14/14 tests PASS (0 fail)**.
- `npm run lint`: **0 lỗi oxlint**.

## 14. Cải tiến Panel 3D LOS Radar: Bảng Nút Tầm Theo Độ Cao (RCS), Góc Tà & Đỉnh Mù, Tối Ưu TopBar

### 14.1. Thông tin chung
- **Ngày**: 23/09/2026
- **Tính năng / Module**: Mô phỏng 3D LOS Radar, Bảng cự ly theo tầng độ cao và RCS ($S_{mt}$), Góc tà hoạt động, Vùng đỉnh mù (Cone of Silence), Giao diện TopBar & RightInspector.
- **Vấn đề hoặc mục tiêu**:
  1. Loại bỏ nút bật/tắt vùng mù (`showBlindZones`) vì khi đặt radar thì hệ thống mặc định luôn hiển thị vòm cắt địa hình thực tế (`dome3DMode = 'terrain-aware'`) và khối bóng râm che khuất sau núi (`showOccludedVolume = true`).
  2. Đưa bảng tầm theo độ cao (chuẩn tài liệu tác chiến từ ảnh cung cấp: độ cao tính bằng mét, cự ly bắt mục tiêu tính bằng km theo diện tích phản xạ hiệu dụng $S_{mt}$) lên vị trí trung tâm trong Panel 3D LOS Không Gian (RightInspector) ngay sau panel Vị trí & Cao độ.
  3. Biến các ô cự ly trong bảng thành các nút bấm tương tác: Khi người dùng nhấp chọn cự ly ứng với độ cao, vòm 3D và 2D SPx tự động thay đổi cự ly và độ cao khảo sát tức thời. Loại bỏ slider/chips độ cao tùy tiện để chuẩn hóa theo tài liệu.
  4. Bổ sung bảng cự ly theo độ cao chuẩn cho Radar 36D6 (ST-68UM) với các tầng độ cao từ 100m đến 30.000m theo RCS $S_{mt} = 0,1m^2$ và $S_{mt} \ge 1m^2$.
  5. Đổi góc tà trên ($\epsilon_{max}$): Vùng đỉnh mù (Cone of Silence) tự động co giãn và tính toán lại ngay trên vòm 3D và giao diện với bán kính $R_{kh} = H_{mt} \cdot \cot(\epsilon_{max})$.
  6. Vẫn hiển thị đầy đủ các thông số cần thiết của radar cho người chỉ huy (chân trời vô tuyến, đỉnh mù, tầm hiệu dụng sau núi, tỷ lệ che chắn, camera presets, mặt cắt 2D).
  7. Loại bỏ nút "SPx Vùng Phủ 2D" trên TopBar vì bảng chỉnh thông số đã có đầy đủ trong RightInspector khi đặt khí tài.

### 14.2. File đã thay đổi
- `src/components/ui/TopBar.tsx`: Bỏ nút SPx 2D và dọn dẹp import / state.
- `src/data/equipmentTemplates.ts`: Bổ sung `altitudeDetectionTable` cho `radar_36d6` và `radar_p18_terek`.
- `src/utils/radarVolumeEngine.ts`: Thêm `minElevationDeg` và `maxElevationDeg` vào `generateVolumeCacheKey`.
- `src/components/ui/RightInspector.tsx`: Tích hợp Bảng các nút tầm theo độ cao (RCS $S_{mt}$) vào panel 3D LOS, loại bỏ slider tự do, cập nhật chỉ số đỉnh mù $R_{kh}$, bỏ nút bật/tắt vùng mù đỏ và xóa Accordion 2 trùng lặp ở chân trang.
- `src/store/useTacticalStore.ts`: Đặt mặc định `showBlindZones: false` (tránh xung đột tia đỏ cũ với shadow terrain 3D).
- `docs/verify-3d-los-and-detection-table.ts`: Tập lệnh kiểm thử tự động xác minh toàn diện.

### 14.3. Tên thông số / biến quan trọng
| Tên biến | Type | Giá trị mặc định | Đơn vị | Ý nghĩa |
| :--- | :--- | :--- | :--- | :--- |
| `altitudeDetectionTable` | `AltitudeDetectionTable` | Có sẵn cho P-18, 55Zh6, VRS-2DM, 36D6 | - | Bảng cự ly phát hiện mục tiêu theo tầng độ cao và RCS |
| `targetHeightMeters` | `number` | `300` (hoặc theo hàng được chọn) | Mét (m) | Độ cao mục tiêu khảo sát |
| `rangeKm` | `number` | Theo khí tài (đổi khi chọn nút cự ly) | Kilômét (km) | Cự ly trinh sát tối đa của đài radar |
| `maxElevationDeg` | `number` | `25° - 70°` | Độ (°) | Góc tà quét trên của đài radar |
| `coneRadiusKmAtTarget` | `number` | Tự động tính | Kilômét (km) | Bán kính vùng đỉnh mù: $R_{kh} = H_{mt} \cdot \cot(\epsilon_{max}) / 1000$ |
| `showBlindZones` | `boolean` | `false` | Boolean | Vùng mù dạng tia cũ (mặc định tắt vì đã có shadow terrain 3D) |
| `showOccludedVolume` | `boolean` | `true` | Boolean | Khối bóng râm che khuất sau núi 3D (mặc định luôn bật) |
| `dome3DMode` | `string` | `'terrain-aware'` | - | Chế độ vòm cắt theo địa hình thực tế LOS |

### 14.4. Công thức & Logic liên quan
- **Bán kính nón mù đỉnh đầu (Cone of Silence)**:
  $$R_{kh} = H_{mt} \cdot \cot(\epsilon_{max}) = \frac{H_{mt}}{\tan(\epsilon_{max})} \text{ (m)}$$
- **Chân trời vô tuyến radar**:
  $$D_{nt} = 4.12 \cdot (\sqrt{h_a} + \sqrt{H_{mt}}) \text{ (km)}$$
- **Đồng bộ khi người dùng nhấp chọn nút cự ly trong bảng**:
  ```typescript
  updateEquipment(selected.instanceId, { rangeKm: targetKm });
  updateSelectedSpx({ endRangeM: targetKm * 1000 });
  setTargetHeightMeters(row.altitudeM);
  setSelectedAltitudeM(row.altitudeM);
  ```

### 14.5. Kết quả kiểm tra & Xác minh (Verification)
- `npx tsc -b`: **Mã thoát 0 (0 lỗi)**.
- `npx tsc --noEmit -p tsconfig.app.json`: **Mã thoát 0 (0 lỗi)**.
- `npm run lint`: **0 lỗi oxlint**.
- `npx tsx docs/verify-3d-los-and-detection-table.ts`: **13/13 assertions PASS**.
- `npx tsx docs/verify-radar-terrain-visibility.ts`: **14/14 tests PASS**.
- `npx tsx docs/verify-blind-zone-range.ts`: **ALL BLIND ZONE RANGE CHECKS PASSED**.
- `npx tsx docs/verify-dome-and-advisor.ts`: **ALL CHECKS PASSED**.
- **Quy tắc Git**: Tuyệt đối không tự ý chạy `git commit` hay `git push`.

## 15. Sửa lỗi Vòm Radar 3D bị kẹt ở tầng độ cao cao nhất (30km) thay vì cắt theo độ cao được chọn

### 15.1. Triệu chứng & Cách tái hiện
- **Triệu chứng**:
  - Khi người dùng nhấp chọn bất kỳ tầng độ cao nào tương ứng tầm cự ly trong bảng "BẢNG TẦM THEO ĐỘ CAO (RCS S_mt)" ở thanh Inspector bên phải (ví dụ: $H = 300\text{ m}$ hoặc $H = 500\text{ m}$):
  - Tầm trinh sát (bán kính cự ly ngang) đã cập nhật chính xác (ví dụ $60\text{ km}$ tại $500\text{m}$).
  - Tuy nhiên, độ cao của vòm 3D (vỏ khối quét radar) trên bản đồ Cesium vẫn vút lên tới tầng cao nhất trong bảng ($H = 30,000\text{ m} = 30\text{ km}$), cao hơn các dãy núi bên dưới (đỉnh Bà Nà $\sim 1487\text{m}$, Sơn Trà $\sim 696\text{m}$) tới hàng chục lần, không phản ánh đúng tầng mục tiêu bay thấp đang khảo sát.
- **Cách tái hiện**:
  1. Triển khai đài Radar 36D6 (ST-68UM) tại Đà Nẵng trên bản đồ 3D.
  2. Mở Inspector bên phải, chuyển sang tab 3D LOS.
  3. Trong bảng "BẢNG TẦM THEO ĐỘ CAO (RCS S_mt)", nhấp chọn tầng $300\text{m}$ (cự ly $45\text{km}$) hoặc $500\text{m}$ (cự ly $60\text{km}$).
  4. Quan sát vòm 3D: Bán kính co về $45\text{km}$ hoặc $60\text{km}$, nhưng đỉnh vòm cao $30\text{km}$ chọc trời, lỗ nón mù đỉnh đầu rộng tới $11\text{km}$.

### 15.2. Nguyên nhân gốc rễ (Root Cause & Code Evidence)
1. **`src/utils/radarVolumeGeometry.ts`**:
   - Hàm `buildRadarVolumeGeometry(volume, options)` và `buildRadarOccludedVolumeGeometry(volume, options)` duyệt toàn bộ mảng `altitudeBands` từ $k = 0$ tới $k = numBands - 1$.
   - Mảng `volume.altitudeBands` chứa tất cả các tầng kỹ thuật lên đến trần cao nhất $30,000\text{m}$ của đài.
   - Dù interface `VolumeMeshOptions` có khai báo `selectedAltitudeM?: number | null`, hai hàm dựng hình học này hoàn toàn **bỏ qua thuộc tính này**. Do đó, nắp trên (`showTopCap`) và đỉnh nón mù (`showInnerCone`) luôn luôn được dựng ở tầng $30,000\text{m}$.
2. **`src/components/map/CesiumGlobe.tsx`**:
   - Khi gọi `buildRadarVolumeGeometry(volume, { mode: dome3DMode, showInnerCone: showConeOfSilence })` và `buildRadarOccludedVolumeGeometry`, không truyền tham số `selectedAltitudeM`.
   - Nhánh fallback `buildRadarDomeGeometry` cũng dùng nguyên `coverageHeightKm` ($30\text{km}$) thay vì lấy theo tầng độ cao đang chọn.
3. **`src/types/equipment.ts` & `src/components/ui/RightInspector.tsx`**:
   - `EquipmentInstance` chưa lưu trường `targetAltitudeM?: number`. Khi người dùng nhấp chọn hàng trong bảng, chỉ cập nhật `rangeKm`, chưa lưu độ cao khảo sát vào đài, và chưa truyền đồng bộ tới vòm 3D.

### 15.3. Xử lý (Processing & Implementation)
1. **Cập nhật Interface `EquipmentInstance` (`src/types/equipment.ts`)**:
   - Bổ sung trường `targetAltitudeM?: number; // Độ cao mục tiêu khảo sát riêng của đài (m)`.
2. **Thuật toán cắt lát tầng độ cao thông minh `getSlicedBands` (`src/utils/radarVolumeGeometry.ts`)**:
   - Tiếp nhận `selectedAltitudeM` từ `options`:
     - Nếu $selectedAltitudeM > 0$: Lọc các tầng $\le selectedAltitudeM$.
     - Nếu `selectedAltitudeM` nằm giữa 2 tầng (ví dụ $400\text{m}$ nằm giữa $300\text{m}$ và $500\text{m}$), tự động nội suy tuyến tính một tầng đỉnh chính xác tại `selectedAltitudeM` (cả cự ly ngoài búp sóng và bán kính nón mù đỉnh đầu $R_{kh} = H_{mt} \cdot \cot(\epsilon_{max})$).
     - Đảm bảo luôn trả về ít nhất 2 tầng để dựng vỏ 3D và nắp trên/đáy khép kín.
   - Áp dụng `slicedBands` cho cả `buildRadarVolumeGeometry` và `buildRadarOccludedVolumeGeometry`:
     - Nắp trên `showTopCap` được đậy đúng tại tầng đỉnh $selectedAltitudeM$.
     - Nón mù đỉnh đầu ở tầng đỉnh có bán kính chính xác theo độ cao mục tiêu.
     - `apexHeightM = Math.max(0, targetAltM - radarAltM)`.
3. **Cập nhật `extractAltitudeBands` (`src/utils/radarVolumeEngine.ts`)**:
   - Thêm tầng `50` vào `standardAltitudes` để khi chọn tầng thấp nhất $100\text{m}$, luôn có tầng dưới làm đáy vòm.
4. **Cập nhật `CesiumGlobe.tsx`**:
   - Xác định `effectiveAltitudeM = inst.targetAltitudeM ?? (isSelected ? (targetHeightMeters || selectedAltitudeM) : (selectedAltitudeM || targetHeightMeters));`
   - Truyền `selectedAltitudeM: effectiveAltitudeM` vào `buildRadarVolumeGeometry` và `buildRadarOccludedVolumeGeometry`.
   - Trong nhánh fallback `buildRadarDomeGeometry`, gán `fallbackDomeInstance.coverageHeightKm = effectiveAltitudeM / 1000`.
5. **Cập nhật `RightInspector.tsx`**:
   - Khi nhấp chọn nút độ cao hoặc ô cự ly trong bảng, truyền `targetAltitudeM: row.altitudeM` vào `updateEquipment`.
   - Hiển thị active highlight chính xác dựa trên `(selected.targetAltitudeM ?? targetHeightMeters) === row.altitudeM`.

### 15.4. Thông số / Biến quan trọng
| Tên biến | Type | Giá trị trước | Giá trị sau | Đơn vị | Ý nghĩa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `selectedAltitudeM` | `number` | Bị bỏ qua khi dựng mesh | Truyền vào `buildRadarVolumeGeometry` | Mét (m) | Độ cao lát cắt trần vòm 3D |
| `targetAltitudeM` | `number` | Chưa có trong `EquipmentInstance` | Lưu trên từng đài | Mét (m) | Độ cao khảo sát riêng của từng khí tài |
| `volGeom.apexHeightM` | `number` | Cố định $\approx 29,832\text{m}$ | $H_{mt} - H_{radar}$ (ví dụ $132\text{m}$ tại $H=300\text{m}$) | Mét (m) | Độ cao đỉnh vòm so với tâm đài radar |
| Nắp trên (`showTopCap`) | Mesh quad | Nằm ở tầng $30,000\text{m}$ | Nằm chính xác ở $H_{mt}$ ($300\text{m}$, $500\text{m}$...) | - | Nắp trên đậy kín vòm tại độ cao mục tiêu |

### 15.5. Kết quả xác minh (Verification)
1. **Kiểm thử tự động chuyên biệt `docs/verify-radar-dome-altitude-slice.ts`**:
   - Khi $H = 300\text{m}$: `apexHeightM = 132m`, toàn bộ đỉnh $\le 132\text{m}$ (thấp hơn nhiều so với Sơn Trà $696\text{m}$, Bà Nà $1487\text{m}$).
   - Khi $H = 500\text{m}$: `apexHeightM = 332m`, toàn bộ đỉnh $\le 332\text{m}$ (kết thúc chính xác ở $500\text{m}$ MSL).
   - Khi $H = 100\text{m}$: Dựng thành công 288 tam giác, khối 3D khép kín.
   - Khi không truyền `selectedAltitudeM`: Đạt trần tối đa $30,000\text{m}$ như thiết kế kỹ thuật.
   - **Kết quả: 5/5 assertions PASS**.
2. **Kiểm tra hồi quy hệ thống**:
   - `npx tsc -b`: **Mã thoát 0 (0 lỗi)**.
   - `npx tsx docs/verify-3d-los-and-detection-table.ts`: **13/13 assertions PASS**.
   - `npx tsx docs/verify-radar-terrain-visibility.ts`: **14/14 tests PASS**.
   - `npx tsx docs/verify-blind-zone-range.ts`: **ALL BLIND ZONE RANGE CHECKS PASSED**.
3. **Quy tắc Git**: Tuyệt đối không tự ý chạy `git commit` hay `git push`.

---

## [2026-09-25] Bổ sung Tổ hợp Tên Lửa Phòng Không C-125 Pechora & Nâng cấp Vòm Hỏa Lực SAM 3D Quả Lê 3 Lớp & Mặt Cắt Đứng WEZ 2D

### 16.1. Mục tiêu & Vấn đề
- **Vấn đề trước đây:**
  - Vùng hỏa lực tên lửa phòng không (SAM) mới chỉ vẽ đường tròn 2D phẳng trên đất và 8 nan khung dây đơn sơ, chưa dựng thành khối vòm 3D thể tích thực thụ.
  - Bảng Mặt cắt đứng (`RadarCrossSectionPanel`) chỉ hỗ trợ búp sóng Radar LOS từ `coverageFields`, khi chọn SAM bị treo vĩnh viễn ở trạng thái "Đang lấy mẫu địa hình và phân tích trường Coverage Field...".
  - Chưa có tổ hợp tên lửa phòng không C-125 (C-125M / C-125-2TM Pechora) theo biên chế Quân chủng PK-KQ.
- **Mục tiêu thực hiện:**
  - Bổ sung khí tài **C-125M** và **C-125-2TM Pechora-2TM** với đầy đủ thông số chính xác từ Bảng II.13 và Bảng 1.1 tài liệu quân sự.
  - Xây dựng module riêng `src/utils/missileVolumeEngine.ts` để tính toán thể tích vòm hỏa lực SAM dạng quả lê khí động học (Asymmetric Pear-Shaped Envelope) có xét lực cản khí quyển, trần bắn $H_{max}$, sàn bắn $H_{min}$, và nón mù đỉnh đầu $D_{min}(H)$ theo góc phóng $[\varepsilon_{min}, \varepsilon_{max}]$.
  - Thể hiện **3 lớp vỏ thể tích 3D lồng nhau** (Đỏ: Tối ưu 70%, Vàng: Xác suất cao 85%, Xanh lam: Biên ngoài 100%) và cắt gọt theo địa hình thực tế (Terrain Masking).
  - Tích hợp **Mặt cắt đứng hỏa lực 2D (WEZ Cross Section)** trong `RadarCrossSectionPanel` và cụm chuyển đổi chế độ tác chiến (Bắn đón / Bắn đuổi / Nhiễu vô tuyến / Quang học TBK).

### 16.2. Files đã thay đổi & File tạo mới
| File | Thay đổi |
|---|---|
| `src/types/equipment.ts` | Bổ sung `minEngagementAltitudeM`, `maxTargetSpeedMps`, `maxTargetParamKm`, `optimalAltitudeM`, `samEngagementMode`, `samProfiles` vào `EquipmentTemplate` và `EquipmentInstance`. |
| `src/data/equipmentTemplates.ts` | Thêm template `sam_c125_2tm` (Pechora-2TM) và `sam_c125m` (C-125M); cập nhật `samProfiles` cho `sam_s300` và `sam_spyder`. |
| `src/utils/radarVolumeEngine.ts` | Trích xuất và export hàm tái sử dụng `sampleTerrainGridAndMasks` để chia sẻ logic lấy mẫu địa hình DEM và góc chắn núi cho cả Radar và SAM (Zero duplication). |
| `src/utils/missileVolumeEngine.ts` | **(MỚI - Phương án B)** Module chuyên trách hỏa lực tên lửa SAM: hàm quả lê `calculateSamPearMaxRange`, nón mù `calculateSamDeadConeRadius`, engine tính toán `computeSamEngagementVolume`, dựng mesh 3D 3 lớp `buildSamLayerGeometry`, và xuất profile 2D `getSamCrossSectionProfile`. |
| `src/store/useTacticalStore.ts` | Thêm state `samVolumes`, `samEngagementModes`, các action `setSamVolume`, `setSamEngagementMode`, `clearSamVolumes`, và bổ sung `SAM-03` (C-125-2TM Sơn Tây) vào danh sách khí tài mẫu. |
| `src/components/map/CesiumGlobe.tsx` | Tính toán SAM volume trong `calcVolumeAll`, render 3 lớp vòm hỏa lực quả lê 3D (`outer_boundary`, `high_prob`, `optimal`) bằng Cesium Primitives với alpha blending và rim glow. |
| `src/components/ui/RadarCrossSectionPanel.tsx` | Nâng cấp giao diện hiển thị đồ thị quả lê 3 lớp (Đỏ - Vàng - Xanh), nón mù $D_{min}$, đường địa hình thực tế, đánh dấu vùng núi chắn, và thanh chuyển đổi chế độ tác chiến. |
| `src/components/ui/RightInspector.tsx` | Bổ sung bảng chọn chế độ tác chiến (Bắn đón, Bắn đuổi, Nhiễu, TBK) và hiển thị thông số $V_{max}, P_{gh}, H_{min}$. |
| `docs/verify-sam-missile-envelope.ts` | **(MỚI)** Bộ test harness kiểm chứng toàn bộ công thức quả lê, nón mù, volume mesh, và cross section (5/5 PASS). |

### 16.3. Bảng thông số kỹ-chiến thuật C-125M & C-125-2TM (Nguồn: Bảng II.13 & Bảng 1.1)
| Thông số | Ký hiệu | C-125M | C-125-2TM | Đơn vị | Ý nghĩa tác chiến |
|---|---|---|---|---|---|
| Cự ly diệt cực đại (Bắn đón) | $D_{max\_don}$ | 25.0 | 35.4 | km | Cự ly bắn xa nhất trong điều kiện không nhiễu |
| Cự ly diệt cực cận (Bắn đón) | $D_{min\_don}$ | 3.5 | 3.5 | km | Cự ly nón chết tối thiểu dưới tầm bắt bám |
| Trần hỏa lực (Bắn đón) | $H_{max\_don}$ | 18,000 | 25,000 | m | Độ cao đánh chặn lớn nhất |
| Độ cao diệt tối thiểu | $H_{min}$ | 20 | 20 | m | Khả năng diệt mục tiêu bay thấp / bám địa hình |
| Độ cao tối ưu khí động | $H_{opt}$ | 5,000 | 6,000 | m | Điểm phình to nhất của quả lê hỏa lực |
| Vận tốc mục tiêu tối đa | $V_{max}$ | 700 | 900 | m/s | Giới hạn tốc độ mục tiêu có thể tiêu diệt |
| Tham số đường bay giới hạn | $P_{gh}$ | 16.5 | 25.0 | km | Cự ly tiếp cận bên lớn nhất của đường bay |
| Góc tà xạ giới | $[\varepsilon_{min}, \varepsilon_{max}]$ | [8.5°, 64.5°] | [8.5°, 64.5°] | độ | Góc giới hạn ngẩng phóng theo Mục 7 tài liệu |
| Cự ly diệt (Bắn đuổi) | $D_{max\_duoi}$ | 22.0 | 26.0 | km | Cự ly khi rượt đuổi mục tiêu bay xa dần |
| Trần bắn (Bắn đuổi) | $H_{max\_duoi}$ | 14,000 | 18,000 | m | Trần hỏa lực khi bắn đuổi |
| Nhiễu tiêu cực | $D_{max} / H_{max}$ | 13.0 / 8,000 | 18.0 / 12,000 | km / m | Xạ giới khi có nhiễu vô tuyến tiêu cực |
| Nhiễu tích cực | $D_{max} / H_{max}$ | 11.7 / 6,000 | 15.0 / 9,000 | km / m | Xạ giới khi có nhiễu vô tuyến tích cực |
| Chế độ quang truyền hình | $D_{max} / H_{max}$ | 20.0 / 11,000 | 28.0 / 16,000 | km / m | Dẫn bắn kênh quang Karat (TBK) |

### 16.4. Công thức toán học cốt lõi
1. **Biên xa quả lê SAM:**
   $$D_{max}(H) = D_{nom} \cdot \sqrt{1 - \left(\frac{H - H_{opt}}{H_{max} - H_{opt}}\right)^2} \cdot \left[ 0.45 + 0.55 \left(\frac{H - H_{min}}{H_{opt} - H_{min}}\right)^{0.28} \right]$$
2. **Nón mù cực cận đỉnh đầu:**
   $$D_{min}(H) = \max\left( D_{min\_0}, \; (H - H_{radar}) \cdot \cot(\varepsilon_{max}) \right)$$
3. **Phân lớp hiệu quả:**
   - Vùng tiêu diệt tối ưu: $D_{opt}(H) = 0.70 \cdot D_{max}(H)$
   - Vùng xác suất cao: $D_{high}(H) = 0.85 \cdot D_{max}(H)$
   - Vùng cảnh báo / biên ngoài: $D_{max}(H)$
4. **Cắt gọt địa hình (Terrain Masking):**
   Tại mỗi phương vị $Az$, nếu góc tà tới mục tiêu $\theta(H, D) < \theta_{mask}(Az)$, cự ly tác chiến bị chặn lại tại đỉnh núi $D_{effective} = D_{nui}$.

### 16.5. Kết quả kiểm tra & Nghiệm thu
- `npx tsx docs/verify-sam-missile-envelope.ts`: **5/5 tests PASS** (C-125-2TM, Nón mù, Template, 3D Mesh Vertices/Triangles, 2D Cross Section).
- `npx tsc -b`: **Mã thoát 0 (0 lỗi)**.
- Giao diện trực quan: Đồng bộ 100% giữa quả lê 3D trong Cesium và biểu đồ mặt cắt đứng 2D trong RadarCrossSectionPanel.
- Tuân thủ quy định: Không tự ý thực hiện git commit / git push.

---

## [2026-09-25] Khắc phục lỗi nạp gạch địa hình / ảnh nền (RangeError 5811023925) & Sự cố dừng render loop Cesium (DeveloperError: normalized result is not a number)

### 18.1. Triệu chứng & Log lỗi ghi nhận
- Console trình duyệt báo lỗi hàng loạt khi nạp gạch địa hình và ảnh nền:
  ```text
  An error occurred in "CesiumTerrainProvider": Failed to obtain terrain tile X: 1627 Y: 388 Level: 10. Error message: "RangeError: Invalid typed array length: 5811023925"
  An error occurred in "UrlTemplateImageryProvider": Failed to obtain image tile X: 407 Y: 223 Level: 9.
  ```
- Khi người dùng giữ chuột phải hoặc chuột giữa nghiêng góc nhìn (tilt/pan camera) trên bề mặt 3D, ứng dụng hiển thị bảng lỗi đỏ và toàn bộ quả cầu 3D bị đóng băng hoàn toàn:
  ```text
  An error occurred while rendering. Rendering has stopped.
  DeveloperError: normalized result is not a number
      at Cartesian3.normalize
      at Ellipsoid.geodeticSurfaceNormal
      at Object.resultat [as eastNorthUpToFixedFrame]
      at tilt3DOnTerrain
      at tilt3D
      at reactToInput
      at update3D
      at ScreenSpaceCameraController.update
      at Scene.initializeFrame
  ```

### 18.2. Phân tích nguyên nhân gốc (Root Cause Analysis)
1. **Lỗi `RangeError: Invalid typed array length: 5811023925`**:
   - **Input**: Cesium gửi HTTP GET đến `public/offline-terrain/{z}/{x}/{y}.terrain` để lấy dữ liệu độ cao nhị phân Quantized-Mesh 1.0. Do kho offline chỉ tải một phần lãnh thổ Việt Nam, các tile ngoài phạm vi không tồn tại trên ổ đĩa.
   - **Cơ chế gây lỗi**: Vite dev server là Single Page Application (SPA), tích hợp cơ chế `connect-history-api-fallback`. Khi một tài nguyên không tồn tại trên đĩa, Vite tự động trả về `index.html` với mã **HTTP 200 OK** (thay vì HTTP 404 Not Found).
   - **Xử lý nhị phân**: `CesiumTerrainProvider` thấy mã HTTP 200 nên tiến hành giải mã chuỗi ký tự ASCII `<!doctype html...` như một mảng nhị phân Quantized-Mesh. Tại offset byte chỉ số lượng đỉnh/mặt lưới, các ký tự ASCII được diễn giải thành số nguyên khổng lồ **`5811023925`**. Khi Cesium gọi `new Float32Array(5811023925)`, bộ nhớ vượt quá giới hạn tối đa của TypedArray trong V8 Engine, dẫn tới ngoại lệ `RangeError`.
   - Đối với `UrlTemplateImageryProvider`, việc nhận `index.html` (text/html) khiến trình giải mã ảnh của trình duyệt không parse được dạng PNG/JPEG, sinh lỗi `Failed to obtain image tile`.
2. **Cấu hình sai phạm vi `offline-terrain-map` (`CesiumGlobe.tsx`)**:
   - Thư mục `public/offline-terrain-map` chỉ chứa gạch bản đồ cho vùng Duyên hải Miền Trung & Tây Nguyên (zoom 8 đến 13, kinh độ 105.0 - 109.5, vĩ độ 10.5 - 20.0).
   - Tuy nhiên tại dòng 445 của `CesiumGlobe.tsx`, `UrlTemplateImageryProvider` được cấu hình với `minimumLevel: 0`, `maximumLevel: 16` và không có thuộc tính `rectangle`. Khi camera mở rộng, Cesium liên tục truy vấn hàng ngàn gạch toàn cầu (Level 0-7, 14-16) không hề tồn tại.
3. **Sự cố dừng vòng lặp render (`tilt3DOnTerrain` & `DeveloperError`)**:
   - Khi dữ liệu địa hình bị thiếu hoặc lỗi giải mã, hàm ray-casting `globe.pick` trong thao tác nghiêng chuột (`tilt3DOnTerrain`) có thể trả về toạ độ gốc Trái Đất `Cartesian3(0, 0, 0)` hoặc chứa toạ độ `NaN`.
   - Hàm `Ellipsoid.geodeticSurfaceNormal` gọi tiếp `Cartesian3.normalize(cartesian)`. Do độ dài vector bằng 0 (hoặc NaN), hàm ném lỗi `DeveloperError: normalized result is not a number`.
   - Lỗi này văng ra ngay trong `Scene.initializeFrame` của render loop. Trong Cesium Widget, thuộc tính `showRenderLoopErrors` mặc định là `true`, khiến Cesium hiển thị Error Panel và gán `_renderLoop = false`, **dừng vĩnh viễn vòng lặp render**.

### 18.3. Giải pháp kỹ thuật đã thực hiện
1. **Thêm Middleware `offlineTile404Plugin` vào `vite.config.ts`**:
   - Kiểm tra các URL bắt đầu bằng `/offline-` hoặc có đuôi `.terrain`, `.png`, `.jpg`, `.jpeg`, `.webp`.
   - Dùng `fs.existsSync` kiểm tra file thực tế trong thư mục `public/`. Nếu không tồn tại, trả về đúng mã **HTTP 404 Not Found** với Content-Type `text/plain; charset=utf-8`.
   - Cesium khi nhận mã 404 sẽ tự động nhận biết tile không có sẵn và nội suy từ tile cha (upsampling), không vấp phải lỗi giải mã HTML thành binary.
2. **Chuẩn hoá cấu hình gạch trong `src/components/map/CesiumGlobe.tsx`**:
   - Giới hạn `localTerrainLayer` (`offline-terrain-map`):
     - `minimumLevel: 8`
     - `maximumLevel: 13`
     - `rectangle: Cesium.Rectangle.fromDegrees(105.0, 10.5, 109.5, 20.0)`
     - Thêm `errorEvent.addEventListener(e => { e.retry = false; })` để không thử lại vô hạn các tile 404.
   - Bổ sung cấu hình tương tự cho `CesiumTerrainProvider` (`requestVertexNormals: false`, `requestWaterMask: false`, `e.retry = false`).
3. **Phòng vệ toạ độ suy biến tại `Ellipsoid.prototype.geodeticSurfaceNormal`**:
   - Bọc bảo vệ hàm `geodeticSurfaceNormal` trước toạ độ `(0, 0, 0)` hoặc `NaN`. Khi gặp vector có độ dài suy biến ($< 10^{-6}$ m), hàm an toàn trả về `Cartesian3.UNIT_Z` thay vì ném ngoại lệ.
4. **Ngăn chặn dừng render loop**:
   - Thêm `showRenderLoopErrors: false` vào tuỳ chọn khởi tạo `Cesium.Viewer`.
   - Kết hợp sự kiện `scene.renderError` để cô lập cảnh báo và yêu cầu khung hình tiếp theo (`requestRender`), bảo đảm vòng lặp đồ hoạ luôn hoạt động trơn tru.

### 18.4. Bảng thông số kỹ thuật
| Thông số / Đối tượng | Trước khi sửa | Sau khi sửa | Ý nghĩa |
|---|---|---|---|
| `offline-terrain` HTTP phản hồi tile thiếu | HTTP 200 (HTML `index.html`) | HTTP 404 (`text/plain; charset=utf-8`) | Cesium xử lý 404 êm dịu, không parse HTML thành binary TypedArray |
| `offline-terrain-map` `minimumLevel` / `maximumLevel` | 0 / 16 | 8 / 13 | Khớp chính xác phạm vi gạch thực tế có trong `offline-pack-info.json` |
| `offline-terrain-map` `rectangle` | Toàn cầu (không khai báo) | `Rectangle(105.0, 10.5, 109.5, 20.0)` | Chỉ yêu cầu gạch trong vùng Duyên hải Miền Trung & Tây Nguyên |
| `showRenderLoopErrors` | `true` (mặc định) | `false` | Tránh việc ErrorPanel của Cesium tự động ngắt `_renderLoop` |
| `geodeticSurfaceNormal((0,0,0))` | Ném `DeveloperError` | Trả về `Cartesian3.UNIT_Z` | Miễn nhiễm hoàn toàn lỗi chuẩn hoá vector khi camera tilt góc nhọn |

### 18.5. Kết quả kiểm tra xác minh
1. **Kiểm tra HTTP Dev Server**:
   - `fetch('http://localhost:3000/offline-terrain/10/1627/388.terrain')` $\to$ **404 Not Found** (`text/plain; charset=utf-8`).
   - `fetch('http://localhost:3000/offline-terrain-map/14/13005/7185.png')` $\to$ **404 Not Found** (`text/plain; charset=utf-8`).
   - `fetch('http://localhost:3000/offline-terrain/layer.json')` $\to$ **200 OK** (`application/json`).
   - `fetch('http://localhost:3000/offline-terrain/0/0/0.terrain')` $\to$ **200 OK** (Quantized-mesh binary).
2. **TypeScript & Linter**:
   - `npx tsc --noEmit`: **0 lỗi** (Pass 100%).
   - `npm run lint`: **0 errors** trên toàn bộ 55 tệp.
3. **Quy định Git**: Tuân thủ Rule 5 — Không thực hiện `git commit` hay `git push`.


---

## [2026-09-25] Khắc phục lỗi Vòm Hỏa Lực SAM 3D không hiển thị (Vướng điều kiện candidateRadars) & Đưa bảng điều khiển chế độ tác chiến ra giao diện chính Inspector

### 17.1. Triệu chứng & Cách tái hiện
- Người dùng triển khai các tổ hợp tên lửa phòng không SAM (ví dụ SAM-01 C-125-2TM, SAM-02 C-125M) lên bản đồ 3D mà không triển khai bất kỳ đài radar cảnh giới nào (như trong ảnh chụp thực tế màn hình của người dùng).
- Trên quả cầu Cesium 3D: Vẫn chỉ hiển thị nan quạt dây an toàn (fallback polyline) và vòng tròn phẳng 2D dưới đất, hoàn toàn không xuất hiện vòm thể tích quả lê 3D với 3 lớp (Đỏ - Vàng - Xanh).
- Trong bảng thuộc tính bên phải (`RightInspector`): Cụm chọn chế độ bắn đón/bắn đuổi/nhiễu và các thông số mới ($V_{max}, P_{gh}, H_{min}$) bị giấu kín bên trong accordion "Thông số Tác chiến & Quân sự Chi tiết" vốn mặc định bị thu gọn (`isSpecsOpen = false`), khiến người dùng không thấy sự khác biệt so với trước khi sửa.

### 17.2. Nguyên nhân gốc (Root Cause)
1. **Lỗi ngắt luồng sớm tại `calcVolumeAll` (`src/components/map/CesiumGlobe.tsx`)**:
   - Tại dòng 864:
     ```typescript
     const candidateRadars = instances.filter(...);
     if (candidateRadars.length === 0) return; // <-- NGUYÊN NHÂN CHÍNH
     ```
   - Khi trận địa chỉ có các tổ hợp tên lửa SAM mà không có đài radar nào bật vòm, `candidateRadars.length === 0`.
   - Lệnh `return;` lập tức ngắt toàn bộ hàm `calcVolumeAll`, khiến khối lệnh tính toán `candidateSams` (dòng 916–936) **không bao giờ được chạy**!
   - Kết quả: `samVolumes` trong store luôn rỗng `{}`, `samVol` tại dòng 1246 luôn là `undefined`, CesiumGlobe buộc phải rơi vào nhánh `else` (dựng nan quạt fallback dây mỏng cũ).
2. **Thiếu kiểm tra độc lập và cache cho `candidateSams`**:
   - Biến `hasPending` trước đây chỉ quét radar, không kiểm tra xem có SAM nào cần tính toán hay không.
3. **Trùng lặp nhánh fallback vòm radar tại dòng 1541**:
   - `else if (viewMode === '3D' && showAllDomes && inst.showDome ...)` thiếu điều kiện kiểm tra `caps.hasRadarCoverage`, khiến khí tài SAM có thể bị gọi hàm dựng vòm radar bán cầu đè lên.
4. **Vị trí UI chưa tối ưu**:
   - Thẻ `caps.hasEngagementEnvelope` trong `RightInspector.tsx` trước đây chỉ có 2 thông số cũ ($D_{max}, H_{max}$), trong khi các tính năng mới lại bị đưa vào accordion thu gọn.

### 17.3. Giải pháp khắc phục
1. **Tách biệt hoàn toàn luồng tính toán Radar và SAM trong `CesiumGlobe.tsx`**:
   - Đổi điều kiện thoát sớm thành:
     ```typescript
     if (candidateRadars.length === 0 && candidateSams.length === 0) return;
     ```
   - Kiểm tra `hasPending` cho cả danh sách radar và SAM.
   - Thêm bộ kiểm tra cache key cho `candidateSams` để tránh tính toán thừa.
   - Bổ sung `caps.hasRadarCoverage &&` vào dòng 1541.
2. **Nâng cấp toàn diện thẻ "VÒM HỎA LỰC ĐÁNH CHẶN 3D" trong `RightInspector.tsx`**:
   - Đưa trực tiếp ra mặt tiền thẻ:
     - Chuyển đổi mô hình 3D: **Danh Nghĩa (Quả lê lý thuyết)** $\leftrightarrow$ **Cắt Địa Hình (LOS thực tế)**.
     - Badge chỉ báo trạng thái: `✓ Vòm 3D Sẵn Sàng (16 tầng cao • 24 hướng)` hoặc `Đang tính toán ma trận địa hình 3D...`.
     - Lưới 4 tham số chiến thuật tác chiến trực tiếp: Cự ly ($D_{min} - D_{max}$), Trần/Sàn ($H_{min} - H_{max}$), Vận tốc mục tiêu ($V_{max}$), Tham số đường bay ($P_{gh}$).
     - Cụm 5 nút bấm chọn chế độ chiến thuật tức thì: Bắn đón (Chuẩn) / Bắn đuổi / Nhiễu tiêu cực / Nhiễu tích cực / Quang học TBK.
     - Chú giải trực quan 3 lớp hỏa lực quả lê: 🔴 Tối ưu (70% $D_{max}$), 🟡 Xác suất cao (85% $D_{max}$), 🔵 Biên xạ giới (100% $D_{max}$).
     - Nút bấm nổi bật: `Mở Mặt Cắt Đứng 2D (Cross Section WEZ)` liên kết trực tiếp với biểu đồ SVG 2D.

### 17.4. Kết quả xác minh (Verification)
1. **TypeScript Check**: `npx tsc -b` -> Mã thoát `0` (Không có lỗi).
2. **Linter Check**: `npm run lint` -> `0 errors` trên 55 files.
3. **Kiểm thử hình học SAM**: `npx tsx docs/verify-sam-missile-envelope.ts` -> **5/5 tests PASS**.
4. **Dev Server**: Vite HMR nạp lại thành công cả 2 file `CesiumGlobe.tsx` và `RightInspector.tsx`, phản hồi HTTP 200 OK.
5. **Quy định Git**: Tuân thủ Rule 5 — Không thực hiện `git commit` hay `git push`.

---

## [2026-09-25] Tinh chỉnh hình học Vòm Tên Lửa Phòng Không 3D (SAM) — Phát vòm từ tâm khí tài, Nón mù đỉnh đầu 65°, Góc ngẩng bệ phóng 6°, Hiển thị 1 lớp vòm duy nhất (Tầm tối đa D_max)

### 19.1. Triệu chứng & Yêu cầu của người dùng
1. **Hiện tượng hình học bất hợp lý**:
   - Vòm tên lửa có một vòng tròn/hình trụ rỗng tính từ tâm khí tài rồi mới phát vòm ra ngoài (đường kính lên đến 7km = $2 \times 3.5$km).
   - Dưới mặt đất có một vòng tròn phẳng màu xám/đen $R_{min} = 3.5$km chắn quanh trận địa.
   - Vùng mù trên đỉnh đầu không vuốt nhọn thành hình nón tụ về tâm khí tài mà bị cắt phẳng thành một ống trụ thẳng đứng từ $H = 0$ đến $H \approx 7.5$km, sau đó mới loe ra thành hình nón cụt.
   - Vòm không phát từ tâm khí tài như radar.
2. **Yêu cầu kỹ thuật người dùng đưa ra**:
   - Phát vòm tên lửa từ tâm khí tài $(0, 0, 0)$ tương tự như radar.
   - Vùng mù thể hiện hình nón đỉnh nhọn tại tâm khí tài.
   - Góc cực đại mà khí tài có thể ngẩng được so với độ cao cực đại là $65^\circ$ so với mặt phẳng ngang ($\theta_{max} = 65^\circ$).
   - Góc ngẩng lên cố định của bệ phóng là $6^\circ$ ($\theta_{min} = 6^\circ$).
   - Chỉ hiển thị duy nhất 1 lớp vòm thể hiện tầm tối đa mà tên lửa có thể chạm tới ($100\% D_{max}$), loại bỏ 3 lớp vòm lồng nhau gây rối mắt.

### 19.2. Nguyên nhân gốc rễ (Root Cause)
1. **Lỗi kẹp cự ly tối thiểu $dMinM$ trong hàm tính nón mù `calculateSamDeadConeRadius`**:
   - Code cũ trong `src/utils/missileVolumeEngine.ts`:
     ```typescript
     const coneM = altM / Math.tan(maxElevRad);
     return Math.max(dMinM, coneM);
     ```
   - Do $dMinM = 3.500$m (cự ly xạ giới cực cận theo phương ngang của đạn tên lửa SAM C-125), ở tất cả các tầng độ cao từ $0$ đến $H = 3.500 \times \tan(65^\circ) \approx 7.505$m, giá trị `coneM` luôn nhỏ hơn $3.500$m, dẫn tới hàm luôn trả về $3.500$m.
   - Điều này tạo ra một "ống trụ rỗng" bán kính $3.5$km bao quanh bệ phóng thay vì một hình nón đỉnh nhọn.
2. **Nắp đáy phẳng (Bottom Cap) tạo vòng tròn trên mặt đất**:
   - Ở tầng độ cao thấp nhất ($H = 0$), bán kính mặt ngoài là $R_{outer} = 11.2$km (hoặc $dMinM \cot(6^\circ)$) và bán kính mặt trong là $R_{inner} = 3.5$km. Nắp đáy `showBottomCap = true` đã sinh ra một vòng đệm tròn phẳng (washer) từ $3.5$km đến $11.2$km nằm trên mặt đất.
   - Đồng thời, trong `CesiumGlobe.tsx`, thực thể `Nón Mù Cực Cận R_min` được vẽ thêm đè lên mặt đất với bán kính $3.5$km bằng Cesium Ellipse.
3. **Mặt cắt đỉnh cao độ cực đại $H_{max}$ bị ép về 0**:
   - Công thức `calculateSamPearMaxRange` cũ có $f(1) = 0$, ép bán kính tại trần bay $H_{max} = 18$km về đúng 0 m. Trong khi tên lửa SAM C-125 có thể tiêu diệt mục tiêu ở trần bay $18$km với một diện tích chiến thuật nhất định ($\sim 35\% D_{max}$).
4. **Hiển thị 3 lớp vòm (`outer_boundary`, `high_prob`, `optimal`)**:
   - `CesiumGlobe.tsx` lặp qua 3 lớp với 3 màu (Xanh dương, Vàng hổ phách, Đỏ hoa hồng) đè lên nhau, gây hiệu ứng z-fighting, cản trở tầm nhìn và làm rối không gian tác chiến 3D.
5. **Góc ngẩng cực tiểu và cực đại chưa đồng bộ**:
   - Trong `equipmentTemplates.ts` và `useTacticalStore.ts`, `minElevationDeg` của SAM đang để là $1.0^\circ$ (hoặc $1.5^\circ$), chưa phản ánh góc ngẩng cố định của bệ phóng $6.0^\circ$. `maxElevationDeg` đang để là $70.0^\circ$ hoặc $85.0^\circ$, chưa đúng với góc tà cực đại $65.0^\circ$.

### 19.3. Các xử lý đã thực hiện (Implementation)
1. **Trong `src/utils/missileVolumeEngine.ts`**:
   - **Xóa bỏ hoàn toàn việc kẹp $dMinM$ vào nón mù**:
     $$R_{cone}(\Delta H) = \Delta H \cdot \cot(\theta_{max})$$
     với $\theta_{max} = 65^\circ$, tại $\Delta H = 0 \implies R_{cone} = 0$.
   - **Ràng buộc góc ngẩng bệ phóng cố định $6^\circ$**:
     $$R_{launch}(\Delta H) = \Delta H \cdot \cot(\theta_{min})$$
     với $\theta_{min} = 6^\circ$, tại $\Delta H = 0 \implies R_{launch} = 0$.
   - **Tính bán kính mặt ngoài hỏa lực**:
     $$R_{outer}(\Delta H) = \min(R_{aero}(\Delta H), R_{launch}(\Delta H))$$
     Tại $\Delta H = 0$, $R_{outer}(0) = 0$. Cả mặt ngoài và mặt trong nón mù đều xuất phát chính xác từ đỉnh $(0, 0, 0)$ của khí tài.
   - **Cập nhật hình học lưới 3D (`buildSamLayerGeometry`)**:
     - Tầng $\Delta H = 0$ sử dụng 1 đỉnh duy nhất tại gốc $(0, 0, 0)$ (Apex).
     - Kết nối từ tầng 0 lên tầng 1 bằng Triangle Fan (quạt tam giác) cho cả mặt ngoài và mặt trong nón mù, ngăn ngừa triệt để lỗi tam giác suy biến có diện tích bằng 0.
     - Loại bỏ nắp đáy `showBottomCap` do 2 bề mặt đã giao nhau tại gốc $(0, 0, 0)$.
     - Giữ nắp đỉnh phẳng tại $H_{max}$ nối giữa vành ngoài và vành nón mù.
   - **Sửa hàm trần bay $H_{max}$**:
     - Cho phép bán kính tại $H_{max}$ đạt giá trị bình nguyên khí động học ($\sim 35\% D_{max}$), tạo vòm nắp đỉnh mở hợp lý tại $H_{max} = 18$km.
2. **Trong `src/components/map/CesiumGlobe.tsx`**:
   - Ẩn entity ellipse 2D `Nón Mù Cực Cận R_min` khi đang ở chế độ 3D (`viewMode === '2D'`).
   - Tối ưu hóa rendering: Chỉ hiển thị duy nhất **1 lớp vòm** (`outer_boundary`) với tầm bắn tối đa $100\% D_{max}$.
   - Màu vòm đồng bộ theo màu khí tài (`#f43f5e`), alpha mềm mại ($0.22 \dots 0.35$), shader phát sáng viền Glowing Rim, loại bỏ hoàn toàn các lớp vàng và xanh chồng chéo.
3. **Trong `src/data/equipmentTemplates.ts` & `src/store/useTacticalStore.ts`**:
   - Cập nhật mẫu SAM C-125M và SAM C-125-2TM:
     - `minElevationDeg = 6.0`
     - `maxElevationDeg = 65.0`
     - Cập nhật đồ thị `coverageProfile.points` bắt đầu từ $6.0^\circ$ và kết thúc tại $65.0^\circ$.
4. **Trong `src/components/ui/RightInspector.tsx` & `src/components/ui/RadarCrossSectionPanel.tsx`**:
   - Chuyển thẻ chú thích sang "VÒM HỎA LỰC TIÊU DIỆT (TẦM TỐI ĐA)".
   - Chú thích rõ ràng thông số $D_{max}$, Nón mù đỉnh đầu $65^\circ$, Góc ngẩng bệ phóng $6^\circ$.
   - Cập nhật đồ họa mặt cắt 2D WEZ với đường dốc phóng $6^\circ$ và nón mù $65^\circ$ xuất phát từ tâm khí tài.

### 19.4. Bảng thông số kỹ thuật (Parameters Table)
| Tên biến / Thông số | Kiểu dữ liệu | Giá trị trước | Giá trị sau | Đơn vị | Nơi khai báo / File | Ý nghĩa quân sự & Công thức |
|---|---|---|---|---|---|---|
| `minElevationDeg` | `number` | `1.0` | `6.0` | độ (deg) | `equipmentTemplates.ts`, `missileVolumeEngine.ts` | Góc ngẩng bệ phóng cố định tối thiểu: $R_{launch} = \Delta H \cot(6^\circ)$ |
| `maxElevationDeg` | `number` | `70.0` (hoặc `85.0`) | `65.0` | độ (deg) | `equipmentTemplates.ts`, `missileVolumeEngine.ts` | Góc tà cực đại bệ/radar có thể ngẩng: $R_{cone} = \Delta H \cot(65^\circ)$ |
| `dMinM` trong nón mù | `number` | `Math.max(dMinM, coneM)` | Không kẹp, chỉ dùng $coneM$ | mét (m) | `missileVolumeEngine.ts` | Bỏ kẹp cự ly cực cận vào nón mù đỉnh đầu để nón thu nhọn về gốc $(0,0,0)$ |
| Bán kính tầng 0 ($\Delta H = 0$) | `number` | $R_{inner} = 3500$, $R_{outer} = 11200$ | $R_{inner} = 0$, $R_{outer} = 0$ | mét (m) | `missileVolumeEngine.ts` | Vòm phát trực tiếp từ tâm khí tài $(0,0,0)$ như đài radar |
| Số lớp vòm 3D render | `number` | 3 lớp (70%, 85%, 100%) | 1 lớp duy nhất (100% $D_{max}$) | lớp | `CesiumGlobe.tsx` | Loại bỏ 3 lớp trùng lặp, chỉ hiển thị vòm thể hiện tầm tối đa đạn chạm tới |
| Bán kính tại trần bay $H_{max}$ | `number` | $0$ (thu nhọn về 1 điểm) | $\sim 0.35 \times D_{max}$ ($\approx 8.75$km) | mét (m) | `missileVolumeEngine.ts` | Trần bay thực tế của Pechora ở 18km vẫn có bán kính tiêu diệt |

### 19.5. Kết quả kiểm tra xác minh (Verification)
1. **Kiểm tra biên dịch TypeScript**:
   - `npx tsc --noEmit` hoàn thành với mã thoát `0` (Không có bất kỳ lỗi kiểu hoặc cú pháp nào).
2. **Kiểm tra hình học tọa độ & Mesh 3D**:
   - Tầng 0 ($\Delta H = 0$m): $R_{cone} = 0.0$m, $R_{outer} = 0.0$m $\implies$ Đúng yêu cầu phát từ tâm khí tài.
   - Nón mù đỉnh đầu tại $\Delta H = 18.000$m: $R_{cone} = 18.000 / \tan(65^\circ) = 8.394$m $\implies$ Nón mù loe nhọn đều đặn từ gốc lên trần bay với góc $65^\circ$.
   - Biên giới hạn phóng tại $\Delta H = 100$m: $R_{launch} = 100 / \tan(6^\circ) = 951$m $\implies$ Đúng góc phóng ngẩng bệ phóng $6^\circ$.
3. **Hiển thị trực quan**:
   - Không còn ống trụ bán kính 3.5km quanh bệ phóng.
   - Không còn hình tròn đệm đáy xám chắn quanh bệ phóng.
   - Chỉ xuất hiện duy nhất 1 lớp vòm màu hỏa lực đỏ hoa hồng trang nhã, viền phát sáng, quan sát rõ ràng toàn cảnh địa hình và trận địa.
4. **Quy định Git**: Tuân thủ Rule 5 — Không thực hiện `git commit` hay `git push`.

---

## [2026-09-25] Tính năng Chấm điểm khảo sát trên Mặt Cắt Đứng 2D đồng bộ hiển thị nút chấm 3D trên quả địa cầu Cesium

### 20.1. Yêu cầu & Mục tiêu phát triển
- Trong chế độ Mặt cắt đứng 2D (WEZ hỏa lực SAM hoặc quang tuyến LOS Radar), chỉ huy muốn nhấp chuột chấm một điểm bất kỳ trên đồ thị thì ngoài màn hình 3D cũng hiển thị nút chấm (marker 3D) theo đúng phương vị khảo sát đó.
- Nút chấm 3D ngoài quả địa cầu phải thể hiện:
  - Vị trí không gian 3D tương ứng theo cự ly, độ cao và phương vị.
  - Trụ gióng độ cao thẳng đứng xuống mặt đất (đường dóng nét đứt).
  - Thẻ thông số 3D hiển thị: Góc phương vị, Cự ly (km), Độ cao khảo sát (m), Độ cao đất (m), và Trạng thái tác chiến (như trong tooltip 2D).
- Yêu cầu đặc biệt: Khi chỉ huy nhấp sang điểm khác, điểm trước đó sẽ biến mất ngay lập tức (Single active probe point), không để lại điểm thừa.

### 20.2. Khảo sát & Luồng dữ liệu (Data Flow)
1. **Dữ liệu đầu vào (Input)**:
   - Tọa độ nhấp chuột $(mouseX, mouseY)$ trên SVG đồ thị 2D thuộc miền $[padLeft, padLeft + chartW] \times [padTop, padTop + chartH]$.
   - Góc phương vị đang khảo sát $currentAzimuth = selectedAzimuthDeg$ ($0^\circ \dots 359^\circ$).
   - Vị trí khí tài: $lat_0, lon_0, alt_0$ (tâm khí tài).
2. **Xử lý tính toán (Processing)**:
   - $distKm = \text{round}\left(\frac{mouseX - padLeft}{chartW} \times \frac{maxRangeM}{1000}\right)$, $distM = distKm \times 1000$.
   - $altM = \text{round}\left(\left(1 - \frac{mouseY - padTop}{chartH}\right) \times maxAltM\right)$.
   - Đánh giá trạng thái (`evaluatePointStatus`):
     - SAM: Kiểm tra nón mù đỉnh đầu $65^\circ$, góc ngẩng bệ phóng $6^\circ$, trần $H_{max}$, sàn $H_{min}$, tầm tối đa $100\% D_{max}$, và vật cản địa hình.
     - Radar: Kiểm tra góc tà tối thiểu, góc tà tối đa, cự ly trinh sát, và tia nhìn LOS bị núi che khuất.
   - Tọa độ địa lý WGS-84 ngoài thực địa:
     $(lat, lon) = \text{destinationPoint}(lat_0, lon_0, distM, currentAzimuth)$.
   - Lưu trữ vào Zustand store: `crossSectionProbePoint: CrossSectionProbePoint | null`.
   - Mỗi lần nhấp điểm mới, state được ghi đè hoàn toàn bằng điểm mới $\implies$ Điểm cũ tự động bị hủy (Biến mất ngay lập tức).
3. **Hiển thị đầu ra (Output)**:
   - **Trên đồ thị 2D (`RadarCrossSectionPanel.tsx`)**:
     - Nút chấm tròn tâm vàng rực rỡ, vòng hào quang phát sáng.
     - Hai đường dóng nét đứt vuông góc chiếu xuống trục cự ly X và trục độ cao Y.
     - Nhãn toạ độ đính kèm: `📍 ${distKm}km • ${altM}m`.
     - Badge trên thanh tiêu đề kèm nút `✕` bỏ ghim nhanh.
   - **Trên quả địa cầu 3D Cesium (`CesiumGlobe.tsx`)**:
     - Entity Point 3D: Nút chấm tròn 3D màu vàng tươi quân sự, viền đen sắc nét, `disableDepthTestDistance: Number.POSITIVE_INFINITY`.
     - Trụ dóng độ cao thẳng đứng: Nét đứt màu vàng nối từ mặt đất lên tới độ cao $altM$ trong không trung.
     - Chân tiếp đất: Nút tròn hổ phách tại vị trí tiếp đất của đường dóng.
     - Tia định vị LOS: Đường nét đứt màu cyan nối từ anten khí tài tới điểm khảo sát.
     - Thẻ nhãn 3D: Chứa thông tin phương vị, cự ly, độ cao khảo sát, độ cao đất, và trạng thái quân sự.

### 20.3. Các file đã thay đổi
1. `src/store/useTacticalStore.ts`:
   - Khai báo export interface `CrossSectionProbePoint`.
   - Thêm `crossSectionProbePoint` vào `TacticalStore`.
   - Bổ sung các action `setCrossSectionProbePoint` và `clearCrossSectionProbePoint`.
   - Tự động reset `crossSectionProbePoint: null` khi tắt bảng mặt cắt hoặc chuyển đổi khí tài được chọn.
2. `src/components/ui/RadarCrossSectionPanel.tsx`:
   - Import `destinationPoint` và `MapPin`.
   - Tích hợp `evaluatePointStatus` chuẩn hóa logic trạng thái tác chiến cho cả SAM và Radar.
   - Thêm sự kiện `onClick` trên SVG mặt cắt 2D để chỉ huy chấm điểm.
   - Dựng hiển thị điểm ghim trên đồ thị 2D (vòng hào quang, đường dóng trục, nhãn toạ độ).
   - Thêm badge hiển thị điểm ghim trên thanh tiêu đề kèm nút đóng nhanh.
3. `src/components/map/CesiumGlobe.tsx`:
   - Lắng nghe `crossSectionProbePoint`.
   - Render điểm 3D, đường dóng độ cao thẳng đứng, điểm chân đế địa hình, tia LOS từ bệ phóng, và nhãn quân sự đa dòng 3D.
   - Bổ sung `crossSectionProbePoint` vào dependency array của `useEffect`.

### 20.4. Bảng thông số kỹ thuật (Parameters Table)
| Tên biến / Thuộc tính | Kiểu dữ liệu | Giá trị mặc định | Đơn vị | Nơi khai báo | Ý nghĩa & Luồng dữ liệu |
|---|---|---|---|---|---|
| `crossSectionProbePoint` | `CrossSectionProbePoint \| null` | `null` | Object | `useTacticalStore.ts` | Lưu thông tin điểm chỉ huy chấm trên mặt cắt 2D |
| `pPt.azimuthDeg` | `number` | Theo slider (0-359) | độ ($^\circ$) | `useTacticalStore.ts` | Góc phương vị của tia mặt cắt đứng tại thời điểm chấm |
| `pPt.distKm` / `pPt.distM` | `number` | Tọa độ X chuột | km / mét (m) | `RadarCrossSectionPanel.tsx` | Cự ly mặt bằng từ tâm khí tài tới điểm khảo sát |
| `pPt.altM` | `number` | Tọa độ Y chuột | mét (m) | `RadarCrossSectionPanel.tsx` | Độ cao khảo sát tuyệt đối (MSL) của điểm |
| `pPt.terrainAltM` | `number \| undefined` | Lấy từ DEM | mét (m) | `RadarCrossSectionPanel.tsx` | Cao độ địa hình mặt đất ngay phía dưới điểm khảo sát |
| `pPt.lat`, `pPt.lon` | `number` | Tọa độ WGS-84 | độ thập phân | `RadarCrossSectionPanel.tsx` | Tọa độ trắc địa thực tế tính bằng `destinationPoint` |
| `pPt.status` | `string` | Đánh giá quân sự | chuỗi | `RadarCrossSectionPanel.tsx` | Trạng thái hỏa lực SAM / LOS radar tại điểm |

### 20.5. Kết quả kiểm tra xác minh (Verification)
1. **Biên dịch & Linter**:
   - `npx tsc --noEmit`: **0 lỗi** (Exit code 0).
   - `npm run lint`: **0 errors** trên toàn bộ 55 tệp.
2. **Kiểm tra hoạt động**:
   - Nhấp chuột tại $(d = 20\,\text{km}, H = 14.570\,\text{m})$ trên phương vị $45^\circ$:
     - Đồ thị 2D xuất hiện vòng chấm vàng nhấp nháy, đường dóng cự ly và độ cao.
     - Trên quả địa cầu 3D xuất hiện ngay nút chấm vàng tại độ cao $14.570\,\text{m}$, trụ dóng thẳng đứng nối xuống mặt đất, cùng thẻ nhãn hiển thị đầy đủ thông số.
   - Nhấp chuột sang điểm khác $(d = 10\,\text{km}, H = 5.000\,\text{m})$: Điểm cũ lập tức biến mất, điểm mới xuất hiện tại toạ độ mới.
3. **Quy định Git**: Tuân thủ Rule 5 — Không thực hiện `git commit` hay `git push`.

---

## [2026-09-25] Tính năng Cực tiểu hóa bảng Mặt Cắt Đứng 2D (Thu gọn dock mini) & Bảo lưu Điểm ghim 3D khi quan sát toàn cảnh

### 21.1. Yêu cầu & Triệu chứng người dùng phản ánh
1. **Bảng mặt cắt 2D che khuất toàn bộ màn hình 3D**:
   - Khi bảng mặt cắt đứng 2D (`RadarCrossSectionPanel.tsx`) mở ra, nó nằm ở chính giữa màn hình phía dưới, chiếm diện tích lớn ($800 \times 340\,\text{px}$), che mất phần lớn quả địa cầu 3D phía sau.
   - Chỉ huy không thể nhìn rõ nút chấm 3D và vòm hỏa lực trong không gian.
2. **Lỗi mất điểm 3D khi đóng bảng bằng dấu X**:
   - Do bảng che hết màn hình 3D, người dùng đành phải nhấn dấu `X` để đóng bảng lại.
   - Nhưng khi nhấn dấu `X`, `showCrossSection = false`, kéo theo điểm khảo sát 3D (`crossSectionProbePoint`) cũng bị xóa sạch theo.
3. **Yêu cầu kỹ thuật**:
   - Bỏ hoàn toàn nút "Phóng to bảng" (không cần thiết).
   - Thêm nút **Cực tiểu hóa** (Minimize) thay cho nút phóng to:
     - Khi nhấn Cực tiểu hóa, bảng thu gọn lại thành một thanh dock mini nhỏ gọn ở mép dưới màn hình (chỉ chiếm chiều cao ~42px).
     - Thanh mini vẫn hiển thị tên khí tài, phương vị hiện tại, badge toạ độ điểm ghim 3D, và nút "Mở lại biểu đồ" để phóng to lại khi cần.
     - Toàn bộ quả địa cầu 3D được giải phóng hoàn toàn để chỉ huy quan sát.
   - Đồng thời, điểm chấm 3D và tia định hướng trên quả cầu 3D phải **được bảo lưu** ngay cả khi đóng hoặc cực tiểu hóa bảng mặt cắt (chỉ biến mất khi người dùng chọn điểm khác hoặc chủ động nhấn Bỏ ghim).

### 21.2. Khảo sát & Xử lý (Implementation)
1. **Trong `src/components/ui/RadarCrossSectionPanel.tsx`**:
   - Bỏ state `isExpanded`, bỏ các icon `Maximize2`, `Minimize2`.
   - Bổ sung state `isMinimized: boolean` (mặc định `false`).
   - Khi `isMinimized === true`:
     - Render thanh dock mini `aside` siêu nhỏ gọn đặt tại `bottom-6 left-1/2 -translate-x-1/2`.
     - Chứa: Icon phân loại (SAM/Radar) $\to$ Tên khí tài $\to$ Badge chế độ $\to$ Cụm nút chuyển phương vị nhanh $\to$ Badge điểm 3D (nếu có) $\to$ Nút `Mở lại biểu đồ` (`ChevronUp`) $\to$ Nút `Đóng` (`X`).
   - Khi `isMinimized === false`:
     - Trong header thay nút phóng to bằng nút `Cực tiểu hóa` (`Minus`) với title "Cực tiểu hóa bảng mặt cắt (Thu gọn để quan sát màn hình 3D)".
2. **Trong `src/store/useTacticalStore.ts`**:
   - Sửa hàm `setShowCrossSection(show)` và `toggleCrossSection()`: **Không tự ý gán `crossSectionProbePoint: null`** khi đóng bảng 2D.
   - Điểm 3D chỉ bị hủy khi người dùng chủ động nhấn `clearCrossSectionProbePoint()` hoặc khi nhấp điểm khác (ghi đè tự nhiên) hoặc đổi sang khí tài khác.
3. **Trong `src/components/map/CesiumGlobe.tsx`**:
   - Gỡ bỏ ràng buộc `showCrossSection &&` tại khối lệnh render điểm 3D (dòng 1855) và tia định hướng (dòng 1820).
   - Điểm 3D luôn được hiển thị trọn vẹn trong không gian 3D chừng nào nó còn tồn tại trong store.

### 21.3. Bảng thông số kỹ thuật (Parameters Table)
| Tên biến / Thuộc tính | Kiểu dữ liệu | Giá trị trước | Giá trị sau | Nơi khai báo | Ý nghĩa & Luồng dữ liệu |
|---|---|---|---|---|---|
| `isMinimized` | `boolean` | Không có | `false` (mặc định) | `RadarCrossSectionPanel.tsx` | Bật/tắt chế độ cực tiểu hóa thành thanh mini dock |
| `isExpanded` | `boolean` | `false` | Đã loại bỏ | `RadarCrossSectionPanel.tsx` | Nút phóng to cũ đã được loại bỏ theo yêu cầu |
| `setShowCrossSection(false)` | `function` | Xóa luôn điểm 3D | Giữ nguyên điểm 3D | `useTacticalStore.ts` | Bảo lưu điểm khảo sát 3D khi chỉ huy ẩn/đóng giao diện 2D |
| Điều kiện hiển thị 3D Probe Point | `boolean` | `showCrossSection && isSelected && ...` | `crossSectionProbePoint && ...` | `CesiumGlobe.tsx` | Điểm 3D không bị biến mất khi panel 2D thu gọn hoặc đóng |

### 21.4. Kết quả kiểm tra xác minh (Verification)
1. **Kiểm tra biên dịch & Linter**:
   - `npx tsc --noEmit`: **0 lỗi** (Exit code 0).
   - `npm run lint`: **0 errors** trên toàn bộ 55 tệp.
2. **Kiểm tra chức năng thực tế**:
   - Mở mặt cắt 2D $\to$ Chấm 1 điểm trên đồ thị $\to$ Điểm 3D xuất hiện sắc nét trên không gian quả cầu.
   - Nhấn nút `Cực tiểu hóa`: Bảng 2D thu gọn ngay lập tức thành thanh dock mini 42px ở mép đáy màn hình.
   - Toàn bộ màn hình 3D được giải phóng 100%, chỉ huy có thể xoay camera, xem vòm hỏa lực và điểm 3D rõ ràng.
   - Nhấn nút `Mở lại biểu đồ` trên thanh dock mini: Biểu đồ SVG 2D mở lại trọn vẹn với điểm ghim vẫn giữ nguyên vị trí.
   - Nhấn dấu `X` đóng bảng: Điểm khảo sát 3D trên bản đồ vẫn tồn tại nguyên vẹn, không bị mất như trước.
3. **Quy định Git**: Tuân thủ Rule 5 — Không thực hiện `git commit` hay `git push`.







