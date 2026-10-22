# Checkpoint: Chuẩn Hóa Toàn Diện Tổ Hợp Tên Lửa Phòng Không SPYDER và Đài Ra Đa EL/M-2084AD Theo Tài Liệu Chính Thức Của Bộ Quốc Phòng

**Thời gian:** 2026-10-22  
**Mục tiêu:** Rà soát, đối chiếu và sửa đổi toàn bộ các thông số kỹ chiến thuật của tổ hợp tên lửa phòng không SPYDER (SR/MR) và đài ra đa EL/M-2084AD dựa theo tài liệu chính thức của Bộ Quốc Phòng tại thư mục `tai_lieu/To_hop_ten_lua_phong_khong_SPYDER.docx`.

---

## 1. Các Sai Lệch Được Khắc Phục & Chuẩn Hóa Theo Tài Liệu BQP

### 1.1. Khắc phục lỗi crash EBUSY khi mở tài liệu (`vite.config.ts`)
- **Vấn đề:** Khi người dùng mở file `.docx` trong thư mục `tai_lieu`, trình theo dõi file của Vite (Chokidar) quét vào file nhị phân đang bị khóa gây lỗi `EBUSY: resource busy or locked`.
- **Giải pháp:** Cấu hình `server.watch.ignored: ['**/tai_lieu/**', '**/docs/**']` giúp nhà phát triển mở, đọc và chỉnh sửa tài liệu thoải mái mà không làm gián đoạn dev server.

---

### 1.2. Đài Ra Đa 3D Đa Chức Năng MMR EL/M-2084AD (`radar_el_m_2084`)
- **Tên & công nghệ:** Chuẩn hóa tên thành **Đài Ra đa Đa chức năng EL/M-2084AD MMR** (Ra đa mảng pha quét điện tử chủ động AESA, dải sóng S-band 3.1 – 3.5 GHz).
- **Cự ly trinh sát:** Nâng cự ly danh định từ 250 km lên **330 km** theo tài liệu:
  - Mục tiêu diện tích phản xạ hiệu dụng RCS $5\text{ m}^2$: **330 km**
  - Mục tiêu RCS $1\text{ m}^2$: **200 km**
  - Mục tiêu RCS $0.2\text{ m}^2$: **135 km**
  - Trần phát hiện $H_{\max}$: **30 km** ($30.000\text{ m}$).
- **Tốc độ quay:** **30 vòng/phút (30 RPM = 180°/s)**, chu kỳ cập nhật dữ liệu 2 giây/vòng.
- **Độ cao triển khai anten:** **8 m** tính từ mặt đất đến tâm mảng pha.
- **Khả năng bám bắt:** Theo dõi 1.200 mục tiêu theo chế độ TWS (Track While Scan), đồng thời bám sát chuyên dụng 200 mục tiêu.

---

### 1.3. Cụm Biên Chế & Trận Địa Tổ Hợp SPYDER (`sam_spyder`)
- **Biên chế hỏa lực:** Chuẩn hóa cấu hình chuẩn gồm 1 Xe chỉ huy CCU + 1 Đài Radar EL/M-2084AD + **6 Xe bệ phóng tự hành MFU**:
  - **3 Xe MFU-MR**: Mang 8 ống phóng đạn tầm trung (Derby-MR / Python-5-MR trang bị tầng khởi tốc Booster).
  - **3 Xe MFU-SR**: Mang 4 ray phóng đạn tầm ngắn (Python-5 / Derby SR).
  - **Tổng cộng:** **36 đạn trực chiến** sẵn sàng phóng trên bệ.
- **Thời gian phản ứng:** Giảm từ 9 giây xuống **4 giây** (từ lúc xác định địch đến lúc phóng đạn, đúng theo mục II.1 tài liệu BQP).
- **Khả năng tiêu diệt đồng thời:** Tiêu diệt đồng thời **20 mục tiêu** (điều khiển 20 tên lửa cùng lúc).
- **Vùng bảo vệ:** Đường kính bảo vệ toàn cụm đạt **120 km**.
- **Liên lạc chỉ huy - bệ phóng:**
  - Kết nối giữa CCU và 6 xe MFU qua **máy vô tuyến băng rộng UHF BNET** (dải 225 - 400 MHz) với cự ly giãn cách lên tới **10.000 m (10 km)**.
  - Kết nối CCU và Đài Ra đa EL/M-2084AD bằng tuyến cáp quang kép từ 100 m đến 250 m.

---

### 1.4. Đạn Tên Lửa & Động Học Khí Tài
- **Vận tốc đạn tên lửa:**
  - Đạn tầm trung MR (có tầng khởi tốc Booster): **1.200 m/s** (Mach 3.5).
  - Đạn tầm ngắn SR: **700 m/s** (Mach 2).
- **Khả năng cơ động quá tải cực đại:**
  - Đạn Derby: **40g**.
  - Đạn Python-5: **70g** (trang bị cánh lái phụ đẩy vector khí động 18 mặt phẳng điều khiển, khóa bám toàn cầu 360°).
- **Khí tài quang điện tử Toplite trên từng xe MFU:**
  - Tích hợp cụm cảm biến FLIR thế hệ 3, camera quang học CCD độ phóng đại 27x, thiết bị đo xa laser LRF cự ly 20 km.
  - Cho phép từng xe bệ phóng MFU phục kích, tác chiến độc lập mà không cần bật sóng radar (phục kích tàng hình).

---

### 1.5. Chế Độ Bắn & Chiến Thuật Tác Chiến (`samProfiles`)
Mở rộng và chuẩn hóa hệ thống chế độ bắn cho SPYDER:
1. `head_on`: SPYDER-MR Bắn đón đạn Derby-MR (Cự ly: 2 - 50 km, H: 20m - 16km, V mục tiêu: 800 m/s).
2. `sr_mode`: SPYDER-SR Tầm ngắn Python-5/Derby (Cự ly: 1 - 20 km, H: 20m - 9km, V mục tiêu: 800 m/s).
3. `lobl_sr`: SPYDER-SR Khóa mục tiêu trước khi phóng LOBL (Cự ly: 1 - 15 km, H: 20m - 9km).
4. `tail_chase`: Bắn đuổi mục tiêu bay xa dần (Cự ly: 3 - 28 km, H: 50m - 12km).
5. `toplite_optical`: Cảm biến quang điện tử Toplite MFU (Cự ly: 1 - 20 km, H: 20m - 9km, phục kích quang học chống chế áp EW).
6. `jamming_passive`: Tác chiến trong môi trường nhiễu tiêu cực / Chaff (Cự ly: 2 - 42 km).
7. `jamming_active`: Tác chiến chống nhiễu tích cực / Chế độ HOJ dẫn bắn nguồn phát nhiễu (Cự ly: 2 - 35 km).

---

## 2. Danh Sách Các File Đã Chỉnh Sửa

| STT | File | Nội Dung Thay Đổi |
|:---:|:---|:---|
| 1 | [`vite.config.ts`](file:///e:/code/du_an/3D/vkq/vompk/vite.config.ts) | Bổ sung `**/tai_lieu/**`, `**/docs/**` vào danh sách `watch.ignored` tránh lỗi EBUSY khóa file. |
| 2 | [`src/types/equipment.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/types/equipment.ts) | Bổ sung trường `missileSpeeds` (vận tốc đạn MR/SR) trong `SpyderSystemConfig`. |
| 3 | [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts) | Cập nhật cấu hình `SPYDER_SYSTEM_DEFAULT_CONFIG`, `radar_el_m_2084` (330km, 30 RPM, cao 8m), `sam_spyder` (6 bệ MFU, BNET 10km, phản ứng 4s, 7 chế độ bắn). |
| 4 | [`src/utils/compositeBatteryGeometry.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/compositeBatteryGeometry.ts) | Cập nhật `generateInitialLaunchers` tự động sinh 6 bệ phóng MFU (3 bệ MR 8 đạn + 3 bệ SR 4 đạn) phân bố đều 6 hướng cho SPYDER. |
| 5 | [`src/utils/missileVolumeEngine.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts) | Ưu tiên `dMaxKm` / `hMaxM` từ `samProfiles` cho SPYDER giúp các mode SR, LOBL, Toplite co giãn vòm 3D và 2D chính xác theo thời gian thực. |
| 6 | [`src/components/ui/RightInspector.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx) | Mở khóa cụm chọn chế độ bắn tác chiến cho SPYDER, cập nhật bảng tính năng chiến kỹ thuật chuẩn BQP (EL/M-2084AD 330km, 36 đạn, Toplite 20km, BNET 10km). |
| 7 | [`src/components/ui/RadarCrossSectionPanel.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RadarCrossSectionPanel.tsx) | Bổ sung nhãn ngắn gọn (`SR-20km`, `LOBL`, `Toplite`) trên thanh chuyển đổi chế độ bắn trong Mặt cắt đứng 2D. |
| 8 | [`src/store/useTacticalStore.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/store/useTacticalStore.ts) | Đồng bộ dữ liệu mẫu ban đầu của `eq_sam_spyder_haiphong` và tự động khởi tạo `compositeBattery` với 6 bệ phóng MFU. |

---

## 3. Kết Quả Xác Minh (Verification)

- **Kiểm tra biên dịch & đóng gói:**
  - Lệnh thực thi: `npm run build` (`tsc -b && vite build`)
  - Kết quả: **Thành công 100% (Exit code 0)**.
  - Chi tiết:
    - 2.000 modules được biên dịch không có bất kỳ cảnh báo lỗi kiểu TypeScript nào.
    - Bundle client hoàn tất: `dist/assets/index-BFuQiIwA.js` (1.052 kB), `dist/assets/index-DwMcMhKV.css` (130 kB).
- **Khắc phục triệt để lỗi EBUSY:** Thư mục `tai_lieu` được bỏ qua khỏi watcher, không còn tình trạng đứng dev server khi mở tài liệu tham khảo Word `.docx`.

---

## 4. Trạng Thái Hiện Tại & Đề Xuất Tiếp Theo

- **Trạng thái:** Toàn bộ thông số kỹ chiến thuật của tổ hợp SPYDER và đài radar EL/M-2084AD đã hoàn toàn đồng nhất giữa tài liệu chính thức của Bộ Quốc Phòng, mô hình toán học 3D, mặt cắt quang tuyến 2D và giao diện điều khiển.
- **Bước tiếp theo:**
  - Người dùng có thể kiểm tra trực tiếp trên trình duyệt, đặt thử tổ hợp SPYDER tại Hải Phòng hoặc vị trí bất kỳ để quan sát 6 xe bệ phóng MFU, vòm kép MR/SR và thử nghiệm chuyển đổi giữa 7 chế độ bắn trên cả bản đồ 3D lẫn mặt cắt đứng 2D.
