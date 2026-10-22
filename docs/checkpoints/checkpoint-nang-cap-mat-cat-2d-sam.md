# Checkpoint: Nâng Cấp Mặt Cắt Đứng 2D Cho Tổ Hợp Tên Lửa Phòng Không (SAM)

- **Ngày thực hiện:** 21/10/2026
- **Mục tiêu:** Nâng cấp biểu đồ Mặt Cắt Đứng 2D (`RadarCrossSectionPanel.tsx`) khi hiển thị Tổ hợp Tên lửa Phòng không (`isSam === true`): kết hợp đầy đủ địa hình DEM thực tế, quang tuyến Radar che khuất (Radar Shadow), công cụ chọn độ cao mục tiêu $H_{\text{mt}}$ với các mốc cự ly $R_{\text{bđ}}, R_{\text{kt}}, D_{\text{tn}}$, và trực quan hóa vòm hỏa lực WEZ bị cắt khuyết bởi góc khuất địa hình.

---

## 1. Các hạng mục đã thực hiện

### 1.1. Khôi phục và chuẩn hóa đọc Địa hình DEM cho SAM
- Trước đây khi `isSam === true`, code chỉ tìm kiếm trong `samVolume.terrainMap` (vốn là `Map<string, number>` lưu theo tọa độ địa lý lon_lat, dẫn đến không khớp với khoảng cách $d$ km và mảng địa hình bị rỗng).
- Đã nâng cấp logic: ưu tiên đọc từ `samVolume.terrainGrid` (`RadarTerrainGrid` do `missileVolumeEngine` và `radarLosEngine` tạo ra).
- Tìm kiếm chỉ số góc phương vị gần nhất (`closestAzIdx`) với `currentAzimuth` trong lưới 360 độ của `terrainGrid`.
- Trích xuất mảng độ cao địa hình `terrainProfile` chính xác từ `terrainHeights[azIdx * distances.length + dIdx]`.
- Vẫn duy trì fallback sang `terrainMap` nếu `terrainGrid` chưa sẵn sàng.

### 1.2. Mở khóa phân tích quang tuyến Radar và tính toán $H_{\text{mt}}$ cho SAM
- `effectiveAntennaHeight`: SAM sử dụng độ cao ăng-ten đài điều khiển $h_a = 8.2\text{m}$ (thay vì $0\text{m}$).
- Bỏ điều kiện `!isSam` tại hàm `blindAnalysis`: SAM giờ đây tính toán đầy đủ mảng tia che khuất quang tuyến `effectiveBlindElevations`, chùm tia quang tuyến `samRays` quét từ đài dẫn bắn / trinh sát.
- Mở khóa toàn bộ thanh công cụ phân tích mục tiêu $H_{\text{mt}}$ cho SAM:
  - Cho phép người dùng tùy chọn độ cao mục tiêu ($50\text{m}, 100\text{m}, 300\text{m}, 500\text{m}, 1000\text{m}, 3000\text{m}, 5000\text{m}, 10000\text{m}$).
  - Hiển thị đường bay mục tiêu nét đứt màu vàng hổ phách.
  - Tự động tính toán và hiển thị các mốc:
    - $R_{\text{bđ}}$: Cự ly bắt đầu phát hiện mục tiêu ở độ cao $H_{\text{mt}}$.
    - $R_{\text{kt}}$: Cự ly kết thúc theo dõi / bắt bám.
    - $D_{\text{tn}}$: Cự ly phát hiện thực tế / cự ly bắn hiệu quả của tên lửa ở độ cao đó.

### 1.3. Cắt khuyết Quả Lê Hỏa Lực (WEZ) bởi Góc Khuất Địa Hình
- Tạo SVG `<clipPath id="samLosVisibleClip">`:
  - Đi theo profile đường bao thấy được tối thiểu $H_{\text{minVis}}(d) = \max(H_{\text{terrain}}(d), H_{\text{shadow}}(d), \text{groundAlt} + H_{\min})$ lên tới trần đồ thị $H_{\max}$.
  - Giúp khoét bỏ trơn tru phần đáy quả lê hỏa lực lọt vào trong bóng núi / vùng mù quang tuyến radar.
- Vẽ 2 lớp Quả lê Hỏa lực WEZ:
  - **Lớp lý thuyết (danh định):** Viền nét đứt mờ (`strokeDasharray="4 3"`, `opacity="0.35"`), cho thấy tầm bắn thiết kế nếu không có chướng ngại vật địa hình.
  - **Lớp thực tế (bị cắt khuyết):** Áp dụng `clipPath="url(#samLosVisibleClip)"`, tô màu gradient WEZ rực rỡ, phản ánh chính xác vùng hỏa lực mà tên lửa có thể phóng và dẫn đường tới mục tiêu.
- Hiển thị các sọc chéo đỏ nhấp nháy (`Radar Shadow`) trong các thung lũng, hẻm núi bị che khuất.

### 1.4. Nâng cấp bộ đánh giá điểm tương tác (`evaluatePointStatus`)
- Khi người dùng rê chuột hoặc di chuyển mục tiêu trên biểu đồ SAM:
  - Ưu tiên kiểm tra góc tà xem điểm có lọt vào vùng mù đồi núi (`effectiveBlindElevations`) hay không $\rightarrow$ Cảnh báo rõ: `"BỊ CHE KHUẤT BỞI ĐỊA HÌNH (VÙNG MÙ RADAR)"`.
  - Nếu không bị che khuất $\rightarrow$ Đánh giá cự ly và độ cao trong Quả lê Hỏa lực WEZ (`"NẰM TRONG VÙNG DIỆT MỤC TIÊU CỦA TÊN LỬA (WEZ)"`) hoặc trong tầm trinh sát cảnh giới (`"TRONG VÙNG PHÁT HIỆN CỦA ĐÀI TRINH SÁT TỔ HỢP"`).

### 1.5. Tinh chỉnh giao diện & Sửa lỗi hiển thị LaTeX
- Sửa tiêu đề header từ chuỗi LaTeX thô `MẶT CẮT \beta = ...` thành tiêu đề sạch: `MẶT CẮT β = ${currentAzimuth}°`.
- Badge định danh hiển thị rõ loại vũ khí: `TỔ HỢP TÊN LỬA PHÒNG KHÔNG (SAM)` kèm tần số / băng sóng và cự ly xạ giới.
- Bổ sung chú giải (Legend) trực quan cho SAM:
  - Vòm hỏa lực WEZ thực tế & WEZ lý thuyết (nét đứt).
  - Vùng mù địa hình (Radar Shadow).
  - Quang tuyến radar dẫn bắn (#38bdf8).
  - Đường bay mục tiêu $H_{\text{mt}}$ (#f59e0b).

---

## 2. File thay đổi

- `src/components/ui/RadarCrossSectionPanel.tsx`: Áp dụng toàn bộ nâng cấp phân tích LOS, cắt khuyết WEZ, trích xuất địa hình SAM và tối ưu UI/UX.

---

## 3. Kết quả xác minh

- **Biên dịch TypeScript & Build Bundle (`npm run build`):**
  - Đã chạy `tsc -b && vite build`: hoàn thành thành công (**Exit code: 0**).
  - Không phát sinh bất kỳ lỗi cú pháp hoặc TypeScript nào.
- **Xác nhận chức năng:**
  - **Radar cảnh giới độc lập (`isSam === false`):** Giữ nguyên 100% tính năng và độ ổn định vốn có.
  - **Tổ hợp tên lửa (`isSam === true`):** Đọc địa hình DEM mượt mà qua `terrainGrid`, tính toán chuẩn xác vùng mù `Radar Shadow`, hiển thị chùm tia quang tuyến và quả lê WEZ thực tế bị cắt khuyết bởi bóng núi trơn tru.
