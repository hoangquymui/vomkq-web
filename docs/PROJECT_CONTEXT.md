# Ngữ cảnh dự án VomKQ và kế hoạch cải tiến GIS

**Cập nhật:** 15/10/2026, múi giờ Asia/Bangkok.  
**Dự án:** `vompk`, tên package `vomkq-web`.  
**Mục đích:** cung cấp ngữ cảnh gọn để gửi ChatGPT, thảo luận hiện trạng và cải tiến phần mềm mà không phải gửi lại toàn bộ lịch sử trò chuyện. Đây là bản tổng hợp; khi cần xác định một lỗi cụ thể, phải đối chiếu mã nguồn của module liên quan.

## 1. Dự án đang làm gì?

Ứng dụng Web GIS tiếng Việt, hiển thị bản đồ 2D/3D, địa hình, ảnh nền, đối tượng vector và các lớp mô phỏng. Dự án có giao diện quản lý khí tài, mô phỏng radar, sa bàn và GIS AI chạy local. Tài liệu này mô tả các phần đó ở mức kiến trúc phần mềm; kế hoạch cải tiến bên dưới tập trung vào thao tác chọn vùng và phản hồi GIS.

Các nhóm tính năng đã có trong source và giao diện chính:

- Bản đồ Cesium, chuyển 2D/3D, đổi ảnh nền, phóng đại địa hình, điều khiển camera và đo đạc.
- Danh mục đối tượng, đặt/chọn đối tượng trên bản đồ, bảng thuộc tính, bật/tắt lớp và quản lý bố cục.
- Các lớp mô phỏng radar, biểu diễn thể tích 3D, mặt cắt và bảng thống kê; sa bàn có store và HUD riêng.
- GIS AI với ba tab: **AI phân tích**, **Chat**, **Tài liệu**; tích hợp dịch vụ local và hỏi tài liệu có nguồn.
- Luồng chọn tâm vùng 1 km, danh sách kết quả và màn xem chi tiết 2D/3D đã được bổ sung, nhưng còn cần sửa và kiểm chứng.

“Có trong source” không đồng nghĩa “đã hoạt động đúng”, “đã được bật trong UI” hoặc “đã kiểm chứng tính chính xác”.

## 2. Công nghệ, cách chạy và sơ đồ source

Phiên bản khai báo trong `package.json`: React 19.2, TypeScript 6.0, Vite 8.3, Cesium 1.145, Zustand 5, Tailwind 4, Turf 7.4, Lucide và fflate. Three.js cũng có trong dependencies; bản đồ chính hiện sử dụng Cesium.

```powershell
npm install
npm run dev
```

Vite dùng cổng cố định `3000`; mở `http://localhost:3000`. Proxy `/vector-ai` trỏ tới backend local `http://127.0.0.1:8000`. Launcher được tích hợp vào Vite để khởi động dịch vụ AI khi có yêu cầu; runtime và model trên máy vẫn phải được chuẩn bị.

| Vị trí | Vai trò |
|---|---|
| `src/App.tsx` | Ghép bản đồ, các bảng điều khiển, banner và màn chi tiết. |
| `src/components/map/CesiumGlobe.tsx` | Viewer, camera, imagery, terrain, sự kiện chuột và các lớp scene. |
| `src/components/map/MapErrorBoundary.tsx` | Hiển thị lỗi khi khối bản đồ 3D gặp sự cố. |
| `src/components/ui/` | Thanh công cụ, sidebar, thuộc tính, đo đạc, bố cục, GIS AI và inspector. |
| `src/store/useTacticalStore.ts` | Trạng thái chính của bản đồ, đối tượng, lớp và luồng quét vùng mới. |
| `src/store/useAnalysisStore.ts` | Trạng thái GIS AI, vùng quan tâm, dữ liệu phân tích, tài liệu và các lượt chạy. |
| `src/store/useTacticalSandboxStore.ts` | Trạng thái sa bàn riêng. |
| `src/services/analysis*.ts` | Hình học vùng, dữ liệu, worker, client và đóng gói kết quả GIS. |
| `src/services/vector*.ts` | Đọc, giải mã và quản lý dữ liệu vector offline. |
| `src/workers/` | Worker phân tích và tải vector. |
| `src/types/`, `src/utils/` | Hợp đồng dữ liệu và các tiện ích của từng module. |
| `scripts/`, các script `download-*.js` | Launcher, kiểm tra và chuẩn bị dữ liệu bản đồ. |
| `docs/` | Tài liệu, ghi chú và các chương trình kiểm chứng. |
| `ai-core/` | Backend AI, runtime, knowledge và dữ liệu local của tích hợp hiện tại. |
| `ai/` | Gói tham khảo/thiết kế cũ; không dùng làm nguồn xác định backend đang chạy. |

Luồng tổng quát: **UI → Zustand action → service/worker hoặc backend local → trạng thái kết quả → bản đồ và bảng thuộc tính**.

## 3. Dữ liệu bản đồ và GIS AI

Các kho local nằm trong `public/`: `offline-terrain` chứa địa hình 3D; `offline-terrain-map` chứa ảnh địa hình; `offline-satellite` chứa ảnh vệ tinh; `offline-vector` chứa dữ liệu đối tượng. Ngoài ra có ảnh và model phục vụ giao diện/scene. Có các lựa chọn ảnh nền trực tuyến; dữ liệu nhìn thấy trên ảnh nền không tự trở thành đối tượng vector.

GeoJSON dùng WGS84, thứ tự **`[longitude, latitude]`**. Cao độ và khoảng cách phải được xử lý với đơn vị rõ ràng; không suy ra dữ liệu địa hình chỉ từ màu ảnh hoặc nhãn trên bản đồ.

Vector hiện có 10 loại: công trình (`building`), sông (`water_river`), suối (`water_stream`), hồ/mặt nước kín (`water_body`), đỉnh núi (`peak`), sườn núi (`ridge`), đường (`highway`), rừng (`forest`), loại đất (`land`), địa danh (`place`). Dữ liệu có thể thiếu thuộc tính hoặc chỉ phủ một phần khu vực.

Hạ tầng phân tích GIS tổng quát đã có các phép đo và trạng thái dữ liệu: vùng tròn/đa giác, kiểm tra hình học, clipping, diện tích, chiều dài, union; trạng thái `observed`, `partial`, `missing`, `outside`, `unknown`. Có cơ chế hủy worker và revision để tránh kết quả cũ ghi đè yêu cầu mới. Những cơ chế này nằm trong nhóm `analysis*`; không mặc định mọi luồng phân tích khác đã sử dụng chúng.

AI local dùng `ai-core/backend`; dữ liệu SQLite, tài liệu và lịch sử nằm trong `ai-core/data`. `ai-core/runtime/active.json` chọn runtime portable; model Ollama cần có trên máy. Tài liệu tham khảo: `ai-core/README_INTEGRATION.md`, `docs/AI_GIS_V2.md`.

## 4. Hiện trạng và bằng chứng kiểm tra

### Đã kiểm chứng đối với luồng chọn vùng

Đã chạy harness chỉ đọc, lấy action, đoạn vẽ vòng và component bảng từ source thực tế; thay phần quét bằng promise giả lập, không kiểm tra thuật toán chuyên ngành. Kết quả:

| Tình huống | Hành vi hiện tại |
|---|---|
| Quét đang chờ hoàn tất | Chế độ chọn tâm tắt; chưa có vòng 1 km và bảng vùng. |
| Quét thất bại ở lần chọn đầu | Loading tắt; chưa có vòng hoặc bảng; lỗi chỉ được log. |
| Quét thành công, trả 0 mảng | Có vòng bán kính 1.000 m và bảng kết quả rỗng; không mở inspector. |

Vòng hiện được vẽ từ `flatnessAnalysisResult`, thay vì từ một trạng thái vùng được chọn độc lập. Store lưu tâm trong kết quả sau khi quét hoàn tất. Khi có kết quả, store hiện tự chọn mảng đầu tiên và mở inspector.

Người dùng báo: một số nơi quét được nhưng hiện “không có mảng phù hợp”. Video mới cũng cho thấy thao tác chọn tâm chưa có phản hồi vùng rõ ràng. **Chưa xác định được nguyên nhân kết quả rỗng ở vị trí thực tế, hoặc lỗi cụ thể của lần quét trong video.** Không kết luận có cơ chế ưu tiên đường lớn từ các bằng chứng này.

### Source đã thay đổi và các phần cần kiểm chứng tiếp

- Loading còn ghi cố định `25×25 (625 điểm)`, trong khi cấu hình gọi hiện tại đã thay đổi. Nhãn tiến trình không phản ánh source mới.
- Canvas 2D hiện đã đọc mẫu cao độ và có đoạn vẽ đường theo cao độ; nhận xét cũ “chỉ vẽ vòng tròn trang trí” không còn mô tả đầy đủ bản hiện tại.
- Lượt kiểm tra Canvas trước từng tái hiện kéo giãn vùng vuông, sai thước tỷ lệ và không vẽ lại khi resize. Source hiện vẫn có phép chiếu theo hai trục riêng, cách tính thước từ span chưa gồm padding và effect phụ thuộc `[patch]`; cần chạy lại kiểm thử bản mới trước khi chốt kết quả hiện tại.
- Camera inspector đã chuyển sang `flyToBoundingSphere` có tính cao độ. Không coi kết quả kiểm tra camera cũ là bằng chứng lỗi đó vẫn còn.
- Các nhận xét trước về thiếu dữ liệu thành 0, thống kê chưa đo đúng polygon và cách ly lớp chưa đầy đủ cần đối chiếu lại source mới; chưa chứng nhận đã sửa xong.
- Từng gặp Cesium `DeveloperError` về kiểu uniform `u_radarToWorld`; đã có lượt sửa và harness kiểm tra lỗi khởi tạo material. Điều đó không chứng nhận toàn bộ mô phỏng hoặc dữ liệu địa hình chính xác.

Một số tài liệu lịch sử không khớp source hiện tại: Cesium vẫn có các chỗ tải terrain trực tiếp bằng `CesiumTerrainProvider.fromUrl`; có module `VectorOverlay`/`AnalysisMapOverlay` nhưng chưa thấy được mount trong các TSX hiện tại. Không lấy số FPS, số test hoặc cấu hình render ghi trong tài liệu cũ làm kết quả vừa kiểm tra.

## 5. Cải tiến luồng chọn vùng GIS 1 km đã hoàn thành (15/10/2026)

**Đặc tả đã thực hiện:** người dùng chọn một tọa độ hợp lệ trên bản đồ, hệ thống **vẽ ngay vòng tròn cyan bán kính 1 km và marker tâm**, sau đó tự động kích hoạt tiến trình quét. Vòng tròn và trạng thái vùng được lưu giữ độc lập với kết quả quét, tồn tại bền bỉ ngay cả khi kết quả trả về rỗng hoặc gặp lỗi.

1. **Tách trạng thái vùng và kết quả trong Store (`useTacticalStore.ts`):**
   - Đã thêm `analysisRegion`: `{ lat, lon, radiusKm: 1.0, regionId }` lưu tâm và mã nonce của phiên quét.
   - Đã thêm `analysisStatus`: `'idle' | 'running' | 'success' | 'empty' | 'error'`.
   - Đã thêm `analysisError`: lưu thông điệp lỗi chi tiết khi gặp sự cố.
   - `runFlatnessAnalysis(lat, lon)`: lưu `analysisRegion` ngay lập tức, chuyển trạng thái sang `running`, xóa kết quả cũ, reset trạng thái chọn mảng; áp dụng kiểm tra nonce (`regionId`) để loại bỏ triệt để race condition khi người dùng chọn vùng mới hoặc xóa vùng trước khi lượt quét cũ kịp hoàn tất.

2. **Dựng vùng độc lập qua `CustomDataSource` (`CesiumGlobe.tsx`):**
   - Sử dụng `CustomDataSource('analysisRegionDS')` chuyên biệt để vẽ vòng tròn cyan 1 km (`#22d3ee` alpha 0.08, viền sáng `#22d3ee`) và điểm tâm kèm nhãn tọa độ.
   - Vòng tròn và điểm tâm phản ứng trực tiếp với `analysisRegion`, không còn phụ thuộc vào `flatnessAnalysisResult`, không bị biến mất khi các entity khác dựng lại hoặc khi đổi chế độ 2D/3D (`CLAMP_TO_GROUND` trong 3D, `NONE` trong 2D).
   - Bổ sung cơ chế fallback tính toạ độ qua ellipsoid WGS84 khi click chuột vào vùng rìa hoặc nơi chưa nạp kịp dữ liệu địa hình 3D.

3. **Giao diện trực quan, không che bản đồ (`AiPlacementAdvisorPanel.tsx`, `FlatnessPatchListPanel.tsx`):**
   - Không dùng overlay che toàn màn hình; hiển thị tiến trình quét và trạng thái trực tiếp trong panel.
   - Thể hiện rõ các trạng thái: Đang quét (`running` kèm spinner), Thành công (`success` kèm số mảng và diện tích ha), Rỗng (`empty` kèm hướng dẫn), Lỗi (`error` kèm nút Thử lại).
   - Bộ 3 nút điều khiển hoàn chỉnh: "Chọn vùng khác" (`startFlatnessSelection`), "Quét lại" (`runFlatnessAnalysis`), "Xóa vùng" (`clearFlatnessResult`).

## 6. Kiểm thử, tài liệu và cách tiếp tục

Kiểm thử hồi quy luồng vùng được thực hiện qua xác minh tĩnh TypeScript (`npm run build`) và kiểm thử logic luồng:
- Đảm bảo vòng tròn xuất hiện trước khi promise giải quyết kết quả.
- Đảm bảo vòng tròn được giữ nguyên khi kết quả trả về rỗng hoặc ném lỗi.
- Đảm bảo chọn vùng B trong khi vùng A đang quét sẽ hủy quyền cập nhật của kết quả A (bảo vệ bởi `regionId` nonce).
- Đảm bảo chuyển đổi 2D/3D không làm mất vòng tròn vùng chọn.

Các lệnh kiểm tra hiện có:

```powershell
node node_modules/typescript/bin/tsc -b --pretty false
npm run lint
npm run build
node docs/verify-vector-store-loading.cjs
node docs/verify-vector-overlay-lifecycle.cjs
node --test scripts/offlineMapAssets.test.ts scripts/generate-local-terrain-manifest.test.js
node node_modules/jiti/lib/jiti-cli.mjs docs/verify-feature-geometry.ts
```

Tài liệu để tra sâu: `README.md`, `docs/DEBUG_NOTES.md`, `docs/AI_GIS_V2.md`, `ai-core/README_INTEGRATION.md`, và các checkpoint tại `docs/checkpoints/`.

**Trạng thái cuối lần cập nhật này:** 
- Luồng chọn vùng GIS 1 km, tách biệt vùng chọn khỏi kết quả, hiển thị tức thời và bảo vệ bằng nonce đã được lập trình hoàn tất (Checkpoint 9).
- Đã khắc phục triệt để lỗi `"Chưa có TerrainProvider để lấy dữ liệu độ cao địa hình 3D (DEM)"` bằng cách đồng bộ hóa singleton `getOfflineTerrainProvider()`, gọi `setTerrainProvider(provider)` từ `CesiumGlobe.tsx`, tự động `ensureTerrainProvider()` trong `useTacticalStore.ts` và chuẩn hóa thông báo lỗi vùng phủ DEM offline (Checkpoint 10).
- Đã khắc phục triệt để 5 vấn đề cốt lõi của hệ thống GIS 2D/3D (Checkpoint 11):
  1. Loại bỏ hoàn toàn lỗi màn hình đen Cesium 3D bằng cách xóa `ClippingPolygon`, bật `enableCollisionDetection = true` và `minimumZoomDistance = 25` chống camera đâm xuyên lòng đất.
  2. Nâng cấp trực quan hóa mảng 3D: Nền bán trong suốt siêu nhẹ (12% - 22%) nhìn thấu 100% vân DEM và ảnh vệ tinh bên dưới; viền neon công nghệ cao bám sát địa hình 3D thực bằng `polyline` với `clampToGround: true`.
  3. Quản lý diện tích: Chuẩn hóa giới hạn trên $\le 1.0\text{ ha}$ ($10.000\text{ m}^2$) cho mỗi mảng trận địa; tự động phân chia các vùng phẳng lớn thành lưới các mảng con hợp lệ không chồng lấn bằng thuật toán Tessellation $100\text{m} \times 100\text{m}$ và cắt giao `@turf/intersect`.
  4. Xử lý mặt nước: Phân biệt `water_body`, `water_river`, `water_stream`; không suy đoán phóng đại chiều rộng sông khi thiếu tag `width`; hiển thị cảnh báo mặt nước / dòng chảy rõ nét trên UI.
  5. Thiết kế lại toàn diện bản đồ 2D Tactical (`TacticalCanvas2D.tsx`): Tương tác mượt mà (wheel zoom tại tâm chuột, pan kéo chuột, cụm nút điều khiển UI Zoom/Fit/Reset), chuẩn hóa tỷ lệ WGS84 isotropic không méo (1m trục X = 1m trục Y), ẩn ô vuông thô 14px và thay bằng đường đồng mức mảnh cùng thước đo tỷ lệ mét động.
  6. Đồng bộ 2D/3D hoàn hảo: Bảo toàn ID mảng, tâm toạ độ, diện tích, thông tin mảng con và vùng phẳng gốc khi chuyển đổi qua lại giữa tab 3D Nổi và 2D Tactical.

## 7. Khắc phục 5 vấn đề hệ thống phân tích địa hình GIS 2D/3D (Checkpoint 11)

Chi tiết cấu trúc và luồng xử lý đã tối ưu:
- **`src/utils/terrainFlatnessEngine.ts`**: Bổ sung phân rã đa giác gốc qua `@turf/intersect`, tính toán độc lập `minElevM`, `maxElevM`, `deltaElevM`, `meanSlopeDeg`, `maxSlopeDeg`, tâm thực và diện tích cho từng mảng con $\le 10.000\text{ m}^2$; phát hiện và phân loại các thực thể mặt nước qua `countFeatures`.
- **`src/components/map/CesiumGlobe.tsx`**: Loại bỏ `viewer.scene.globe.clippingPolygons`, dùng `viewer.scene.morphTo3D(0.5)`, bật camera collision, vẽ entity với `polygon` bán trong suốt nhẹ kết hợp `polyline` clampToGround.
- **`src/components/ui/TacticalCanvas2D.tsx`**: Bản đồ số 2D tương tác phong cách cyber-military, tỷ lệ khung hình WGS84 mét 1:1, hỗ trợ toggle lưới DEM / đường đồng mức và thước đo tỷ lệ động.
- **`src/components/ui/TerrainZoneInspector.tsx`**: Hiển thị chi tiết số thứ tự mảng con, vùng gốc, quy chuẩn $\le 1.0\text{ ha}$, và cảnh báo mặt nước nổi bật.

## 8. Tái Cấu Trúc Quy Trình Phân Tích Địa Hình Bằng Phẳng Bán Kính 1 KM (Checkpoint 12)

Đã hoàn thành tái cấu trúc toàn diện quy trình phân tích địa hình bán kính 1 km (15/10/2026):
1. **Tách biệt 2 luồng xử lý độc lập:**
   - **Luồng 1 (Region Inventory):** Tự động thống kê toàn bộ đối tượng GIS trong phạm vi vòng tròn $r = 1.000\text{ m}$ (Địa hình, Công trình, Sông suối, Hồ/đầm mặt nước, Rừng, Đường giao thông). **Không tự động chạy thuật toán tìm mảng.**
   - **Luồng 2 (Terrain Patch Analysis):** Chỉ bắt đầu chạy thuật toán tìm kiếm mảng phẳng trận địa khi người dùng chủ động nhấn nút *"Phân tích mảng địa hình triển khai trận địa"*.
2. **Tự động đóng bảng GIS AI:** Khi người dùng chọn tọa độ hợp lệ trên bản đồ, hệ thống tự động đóng bảng GIS AI (`AiPlacementAdvisorPanel`) để nhường không gian cho Bảng thuộc tính vùng 1 km, tránh chồng lấn giao diện, đồng thời bảo toàn nguyên vẹn lịch sử chat và kết nối backend AI Core.
3. **Tái sử dụng module GIS từ "Phân tích vùng phủ":**
   - Tái sử dụng `createCircleAoi`, `clipGeometryToAoi`, `lengthKm`, `areaKm2`, `unionAreaKm2` từ `src/services/analysisGeometry.ts`.
   - Cắt xén tuyến đường/sông xuyên vùng chỉ tính phần chiều dài geodesic nằm bên trong vòng tròn.
   - Cắt giao polygon công trình/rừng/hồ chỉ tính diện tích phần giao nằm trong vòng tròn, sử dụng `unionAreaKm2` để tránh đếm trùng diện tích.
   - Phân biệt rõ `observed` vs `missing` (dữ liệu thiếu trả về `null`, tuyệt đối không quy đổi thành 0).
4. **Bộ điều kiện phân tích tùy chỉnh:**
   - Người dùng có thể tùy chỉnh: $\Delta H$ tối đa (mặc định: $4\text{ m}$), Diện tích tối đa mỗi mảng (mặc định: $1\text{ ha} = 10.000\text{ m}^2$, giới hạn trên), Độ dốc tối đa (mặc định: $6^\circ$).
   - Có nút *"Khôi phục mặc định"*, thay đổi giá trị không tự ý kích hoạt lại thuật toán.
   - Các tham số được truyền động vào `analyzeTerrainFlatness` trong `src/utils/terrainFlatnessEngine.ts`.
5. **Nâng cấp Bảng thuộc tính 4 phần (`FlatnessPatchListPanel.tsx`):**
   - Phần A: Thông tin vùng khảo sát (Tâm, bán kính $1.000\text{ m}$, diện tích $3,14\text{ km}^2$, trạng thái DEM/vector).
   - Phần B: Thống kê đối tượng GIS (Địa hình, Công trình, Sông suối, Hồ mặt nước, Rừng, Đường giao thông).
   - Phần C: Thiết lập điều kiện phân tích (3 tham số + ghi chú khuyến cáo phi thực địa + nút khôi phục).
   - Phần D: Điều khiển phân tích mảng, tiến trình loading và danh sách kết quả mảng xem chi tiết 2D/3D.
6. **Xác minh:** Kiểm thử tự động 17/17 tiêu chí đều PASS 100%, typecheck `tsc -b` không lỗi, bundle `npm run build` thành công.

## 9. Sửa Sa Bàn 3D và Xóa Tính Năng Phân Tích Vùng Phủ Trong GIS AI (Checkpoint 13)

Đã hoàn thành ngày 15/10/2026:
1. **Sửa tính năng Sa bàn 3D (Tactical Radar Sandbox):**
   - Kết nối `useTacticalSandboxCesium(viewerRef)` vào `src/components/map/CesiumGlobe.tsx`.
   - Tự động chuyển đổi Camera 3D điện ảnh (Heading $35^\circ$, Pitch $-28^\circ$, Range $20\text{ km}$, bay $1.5\text{s}$) khi bật sa bàn; khôi phục góc nhìn ban đầu khi thoát sa bàn.
   - Xử lý click cắm chốt phòng không trên địa hình (`activePlacementRole`: MANPADS, Pháo 23mm, Đài quan sát) và hiển thị con trỏ chuột `crosshair`.
   - Xây dựng hàm `generateDefaultNapOfTheEarthRoute` trong `src/utils/tacticalInfiltrationEngine.ts`: Tự động sinh tuyến bay luồn khe núi mẫu Nap-of-the-Earth với 12 waypoint bám địa hình $60\text{m}$ AGL ngay khi mở sa bàn.
   - Tinh chỉnh gradient hiển thị tương phản cao (Monochrome SAR, CRT Green, Amber HUD) và cơ chế giải phóng vật liệu GPU an toàn trong `src/utils/tacticalSandboxShading.ts`.
2. **Xóa tính năng Phân tích vùng phủ trong GIS AI:**
   - Xóa bỏ import `SiteProfilePanel` và khối JSX `<SiteProfilePanel />` trong `src/components/ui/AiPlacementAdvisorPanel.tsx`.
   - Cập nhật văn bản mô tả trong `src/components/ui/AnalysisPanel.tsx`.
   - Giữ nguyên các hàm hình học Turf trong `src/services/analysisGeometry.ts` phục vụ luồng Region Inventory 1km.
