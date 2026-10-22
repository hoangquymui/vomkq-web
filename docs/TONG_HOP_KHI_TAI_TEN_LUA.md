# TỔNG HỢP TOÀN DIỆN KHÍ TÀI TÊN LỬA VÀ CÁC TÍNH NĂNG TÁC CHIẾN LIÊN QUAN (VOMKQ)

> **Tài liệu tổng hợp kỹ thuật & tác chiến quân sự**  
> Dự án: **VomKQ Web (Hệ thống tính toán & trực quan hóa Vòm Phủ Sóng 3D)**  
> Trạng thái: Đã hiện thực và kiểm chứng thành công trên mã nguồn dự án.

---

## MỤC LỤC
1. [Hệ thống các Khí tài Tên lửa trong Dự án](#1-hệ-thống-các-khí-tài-tên-lửa-trong-dự-án)
2. [Đặc tính Kỹ - Chiến thuật Chi tiết từng Khí tài](#2-đặc-tính-kỹ---chiến-thuật-chi-tiết-từng-khí-tài)
   - [2.1. Tổ hợp Tên lửa S-300PMU2 Favorit](#21-tổ-hợp-tên-lửa-s-300pmu2-favorit-sam_s300)
   - [2.2. Tổ hợp Tên lửa C-125-2TM Pechora-2TM](#22-tổ-hợp-tên-lửa-c-125-2tm-pechora-2tm-sam_c125_2tm)
   - [2.3. Tổ hợp Tên lửa C-125M Pechora](#23-tổ-hợp-tên-lửa-c-125m-pechora-sam_c125m)
   - [2.4. Tổ hợp Tên lửa SPYDER (SR & MR)](#24-tổ-hợp-tên-lửa-phòng-không-spyder-sr--mr-sam_spyder)
   - [2.5. Tổ Tên lửa Vác vai Igla-S (Sa bàn Tác chiến)](#25-tổ-tên-lửa-vác-vai-igla-s-tactical-sandbox)
   - [2.6. Mục tiêu Tên lửa Đối phương & Khí tài Nghi binh Mồi nhử](#26-mục-tiêu-tên-lửa-đối-phương--khí-tài-nghi-binh-mồi-nhử)
3. [Các Tính năng & Động cơ Tính toán Đã Hiện thực](#3-các-tính-năng--động-cơ-tính-toán-đã-hiện-thực)
   - [3.1. Động cơ Dựng Thể tích Hỏa lực 3D Cắt Địa hình (missileVolumeEngine)](#31-động-cơ-dựng-thể-tích-hỏa-lực-3d-cắt-địa-hình)
   - [3.2. Mô hình Khí động Dạng Quả lê (Pear-shaped Envelope)](#32-mô-hình-khí-động-dạng-quả-lê)
   - [3.3. Mô hình Bán Elip Vòm kép SPYDER (Dual-Dome Semi-Ellipse)](#33-mô-hình-bán-elip-vòm-kép-spyder)
   - [3.4. Nón Mù Đỉnh đầu Hình nón (Cone of Silence / Dead Cone)](#34-nón-mù-đỉnh-đầu-hình-nón)
   - [3.5. Phân tầng Xác suất Hỏa lực (Outer / High-Prob / Optimal)](#35-phân-tầng-xác-suất-hỏa-lực)
   - [3.6. Cắt Thể tích 3D theo Địa hình Số DEM (Terrain-Aware Sampling)](#36-cắt-thể-tích-3d-theo-địa-hình-số-dem)
4. [Các Tính năng Trực quan hóa & Giao diện Tác chiến](#4-các-tính-năng-trực-quan-hóa--giao-diện-tác-chiến)
   - [4.1. Kiến trúc Năng lực Khí tài Tách biệt (Asset Capabilities)](#41-kiến-trúc-năng-lực-khí-tài-tách-biệt)
   - [4.2. Bảng Mặt Cắt Đứng 2D Hỏa lực Tên lửa (Cross Section WEZ Panel)](#42-bảng-mặt-cắt-đứng-2d-hỏa-lực-tên-lửa)
   - [4.3. Bảng Thanh tra Tham số Khí tài (RightInspector)](#43-bảng-thanh-tra-tham-số-khí-tài)
   - [4.4. Mạng Lưới Chỉ huy Hiệp đồng C2 (Command & Control Links)](#44-mạng-lưới-chỉ-huy-hiệp-đồng-c2)
   - [4.5. Hiệp đồng Radar Cảnh giới & Tính Cự ly Báo động Tác chiến](#45-hiệp-đồng-radar-cảnh-giới--tính-cự-ly-báo-động-tác-chiến)
5. [Hệ Thống Kiểm Thử & Xác Minh Độc Lập](#5-hệ-thống-kiểm-thử--xác-minh-độc-lập)
6. [Danh Mục Mã Nguồn & Tệp Tin Liên Quan Trực Tiếp](#6-danh-mục-mã-nguồn--tệp-tin-liên-quan-trực-tiếp)

---

## 1. HỆ THỐNG CÁC KHÍ TÀI TÊN LỬA TRONG DỰ ÁN

Trong cấu trúc dữ liệu của dự án (`category: 'TenLuaPhongKhong'`), hệ thống phân tách rõ rệt khí tài tên lửa với các chủng loại radar cảnh giới, sở chỉ huy và pháo cao xạ. Dự án đã mô hình hóa 4 tổ hợp tên lửa phòng không chủ lực và 1 chủng loại tên lửa phòng không vác vai tầm thấp, cùng các thực thể mô phỏng mục tiêu tên lửa hành trình của đối phương:

| Mã Định Danh | Tên Khí Tài | Vai Trò Tác Chiến | Cự Ly Tiêu Diệt ($D_{min} - D_{max}$) | Độ Cao Tiêu Diệt ($H_{min} - H_{max}$) | Phương Thức Dẫn Bắn |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sam_s300` | **S-300PMU2 Favorit** | Tên lửa tầm xa chiến lược | $3.0 - 200.0\text{ km}$ | $10\text{ m} - 27.000\text{ m}$ | Radar Track-via-Missile (TVM) đạn 48N6E2 |
| `sam_c125_2tm`| **C-125-2TM Pechora-2TM** | Tên lửa tầm trung cơ động cao | $3.5 - 35.4\text{ km}$ | $20\text{ m} - 25.000\text{ m}$ | Lệnh vô tuyến bám qua đạn & Quang truyền hình Karat |
| `sam_c125m` | **C-125M Pechora** | Tên lửa tầm trung kinh điển | $3.5 - 25.0\text{ km}$ | $20\text{ m} - 18.000\text{ m}$ | Lệnh điều khiển vô tuyến qua đài SNR-125 |
| `sam_spyder` | **SPYDER (SR & MR)** | Tổ hợp cơ động phản ứng nhanh | SR: $1 - 20\text{ km}$<br>MR: $2 - 50\text{ km}$ | SR: $20\text{ m} - 9.000\text{ m}$<br>MR: $20\text{ m} - 16.000\text{ m}$ | Python-5 (Hồng ngoại IIR) & Derby-MR (Radar sóng mm + Booster) |
| `manpads_igla`| **Igla-S (9K338)** | Tên lửa vác vai tầm thấp | $0.5 - 6.0\text{ km}$ | $10\text{ m} - 3.500\text{ m}$ | Tự dẫn hồng ngoại thụ động |
| Mục tiêu bay | **Tên lửa Hành trình** | Mục tiêu xâm nhập Nap-of-the-Earth | Vận tốc $220\text{ m/s}$ ($\sim 800\text{ km/h}$) | Bay thấp bám địa hình $60\text{ m}$ AGL | Mô phỏng đường bay luồn lách khe núi |

---

## 2. ĐẶC TÍNH KỸ - CHIẾN THUẬT CHI TIẾT TỪNG KHÍ TÀI

### 2.1. Tổ hợp Tên lửa S-300PMU2 Favorit (`sam_s300`)
- **Tập tin định nghĩa**: [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts#L317-L361)
- **Màu sắc vòm & ký hiệu**: Đỏ rực (`#ef4444`).
- **Thông số kỹ thuật chuẩn**:
  - Tầm bắn danh định: $D_{max} = 200\text{ km}$, $D_{min} = 3\text{ km}$.
  - Trần bắn / Sàn bắn: $H_{max} = 27.000\text{ m}$ ($27\text{ km}$), $H_{min} = 10\text{ m}$.
  - Độ cao tối ưu khí động ($H_{opt}$): $8.000\text{ m}$.
  - Vận tốc mục tiêu tiêu diệt cực đại: $V_{max} = 2.800\text{ m/s}$ (đủ khả năng đánh chặn tên lửa đạn đạo chiến thuật và mục tiêu siêu thanh).
  - Tham số đường bay giới hạn ($P_{gh}$): $120\text{ km}$.
  - Thời gian phản ứng xạ kích: $5\text{ giây}$.
  - Góc tà tác chiến: $3.0^\circ \to 65.0^\circ$.
- **Hồ sơ chế độ bắn chuyên biệt (`samProfiles`)**:
  - `head_on` (Bắn đón không nhiễu): $D_{max} = 200\text{ km}$, $H_{max} = 27\text{ km}$, $V_{max} = 2.800\text{ m/s}$, $P_{gh} = 120\text{ km}$.
  - `tail_chase` (Bắn đuổi không nhiễu): $D_{max} = 110\text{ km}$, $H_{max} = 20\text{ km}$, $V_{max} = 600\text{ m/s}$, $P_{gh} = 80\text{ km}$.
  - `jamming_passive` (Nhiễu tiêu cực): $D_{max} = 140\text{ km}$, $H_{max} = 18\text{ km}$, $V_{max} = 1.800\text{ m/s}$, $P_{gh} = 80\text{ km}$.
  - `jamming_active` (Nhiễu tích cực): $D_{max} = 100\text{ km}$, $H_{max} = 15\text{ km}$, $V_{max} = 1.800\text{ m/s}$, $P_{gh} = 60\text{ km}$.
  - `tbk_optical` (Quang truyền hình / Khẩn cấp): $D_{max} = 120\text{ km}$, $H_{max} = 16\text{ km}$, $V_{max} = 1.200\text{ m/s}$, $P_{gh} = 70\text{ km}$.

---

### 2.2. Tổ hợp Tên lửa C-125-2TM Pechora-2TM (`sam_c125_2tm`)
- **Tập tin định nghĩa**: [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts#L363-L408)
- **Màu sắc vòm & ký hiệu**: Đỏ cánh sen / Rose (`#f43f5e`).
- **Mô tả tác chiến**: Bản hiện đại hóa sâu của Quân chủng Phòng không - Không quân Việt Nam. Khả năng bắn đón mục tiêu bay nhanh đến $900\text{ m/s}$, bám sát và xạ kích đồng thời 2 mục tiêu, tích hợp khí tài ngắm quang truyền hình Karat kháng nhiễu điện tử triệt để.
- **Thông số kỹ thuật chuẩn**:
  - Tầm bắn danh định: $D_{max} = 35.4\text{ km}$, $D_{min} = 3.5\text{ km}$.
  - Trần bắn / Sàn bắn: $H_{max} = 25.000\text{ m}$, $H_{min} = 20\text{ m}$.
  - Độ cao tối ưu khí động ($H_{opt}$): $6.000\text{ m}$.
  - Vận tốc mục tiêu tiêu diệt cực đại: $V_{max} = 900\text{ m/s}$.
  - Tham số đường bay giới hạn ($P_{gh}$): $25.0\text{ km}$.
  - Thời gian phản ứng: $5\text{ giây}$; Thời gian triển khai/thu hồi: $25\text{ phút}$.
  - Góc tà tác chiến: Góc ngẩng bệ phóng cố định $6.0^\circ$, góc tà cực đại ngẩng được $65.0^\circ$.
- **Hồ sơ chế độ bắn chuyên biệt (`samProfiles`)**:
  - `head_on` (Bắn đón không nhiễu): $D_{max} = 35.4\text{ km}$, $H_{max} = 25\text{ km}$, $V_{max} = 900\text{ m/s}$, $P_{gh} = 25\text{ km}$.
  - `tail_chase` (Bắn đuổi không nhiễu): $D_{max} = 26.0\text{ km}$, $H_{max} = 18\text{ km}$, $V_{max} = 300\text{ m/s}$, $P_{gh} = 20\text{ km}$.
  - `jamming_passive` (Nhiễu vô tuyến tiêu cực): $D_{max} = 18.0\text{ km}$, $H_{max} = 12\text{ km}$, $V_{max} = 650\text{ m/s}$, $P_{gh} = 15\text{ km}$.
  - `jamming_active` (Nhiễu vô tuyến tích cực): $D_{max} = 15.0\text{ km}$, $H_{max} = 9\text{ km}$, $V_{max} = 650\text{ m/s}$, $P_{gh} = 15\text{ km}$.
  - `tbk_optical` (Quang truyền hình Karat - TBK): $D_{max} = 28.0\text{ km}$, $H_{max} = 16\text{ km}$, $V_{max} = 500\text{ m/s}$, $P_{gh} = 22\text{ km}$.

---

### 2.3. Tổ hợp Tên lửa C-125M Pechora (`sam_c125m`)
- **Tập tin định nghĩa**: [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts#L410-L455)
- **Màu sắc vòm & ký hiệu**: Đỏ nhạt (`#fb7185`).
- **Nguồn tài liệu**: Bảng II.13 - Giáo trình Đài điều khiển tên lửa SNR-125M.
- **Thông số kỹ thuật chuẩn**:
  - Tầm bắn danh định: $D_{max} = 25.0\text{ km}$, $D_{min} = 3.5\text{ km}$.
  - Trần bắn / Sàn bắn: $H_{max} = 18.000\text{ m}$, $H_{min} = 20\text{ m}$.
  - Độ cao tối ưu khí động ($H_{opt}$): $5.000\text{ m}$.
  - Vận tốc mục tiêu tiêu diệt cực đại: $V_{max} = 700\text{ m/s}$, tham số $P_{gh} = 16.5\text{ km}$.
  - Thời gian phản ứng: $6\text{ giây}$; Thời gian triển khai/thu hồi: $120\text{ phút}$.
  - Góc tà tác chiến: $6.0^\circ \to 65.0^\circ$.
- **Hồ sơ chế độ bắn chuyên biệt (`samProfiles`)**:
  - `head_on`: $D_{max} = 25.0\text{ km}$, $H_{max} = 18\text{ km}$, $V_{max} = 700\text{ m/s}$, $P_{gh} = 16.5\text{ km}$.
  - `tail_chase`: $D_{max} = 22.0\text{ km}$, $H_{max} = 14\text{ km}$, $V_{max} = 300\text{ m/s}$, $P_{gh} = 16.5\text{ km}$.
  - `jamming_passive`: $D_{max} = 13.0\text{ km}$, $H_{max} = 8\text{ km}$, $V_{max} = 550\text{ m/s}$, $P_{gh} = 10.5\text{ km}$.
  - `jamming_active`: $D_{max} = 11.7\text{ km}$, $H_{max} = 6\text{ km}$, $V_{max} = 550\text{ m/s}$, $P_{gh} = 10.5\text{ km}$.
  - `tbk_optical`: $D_{max} = 20.0\text{ km}$, $H_{max} = 11\text{ km}$, $V_{max} = 400\text{ m/s}$, $P_{gh} = 16.5\text{ km}$.

---

### 2.4. Tổ hợp Tên lửa Phòng không SPYDER (SR & MR) (`sam_spyder`)
- **Tập tin định nghĩa**: [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts#L7-L38) và [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts#L457-L502)
- **Cấu hình chuẩn quân sự**: Tuân thủ chính xác **Bảng 1 - Tham số cơ bản của hệ thống Spyder** và **Sơ đồ Mặt cắt đứng (WEZ Cross Section)**.
- **Kiến trúc Vòm Hỏa Lực Kép (Dual-Dome Architecture)**:
  1. **SPYDER-SR (Tầm ngắn)**:
     - Tên lửa sử dụng: **Python-5** trang bị đầu dò ảnh nhiệt hồng ngoại băng tần kép (Dual-band IIR) có khả năng khóa mục tiêu sau khi phóng (LOAL) và góc quan sát toàn cầu.
     - Cự ly tiêu diệt: $D_{max} = 20\text{ km}$, $D_{min} = 1\text{ km}$.
     - Độ cao tiêu diệt: $H_{max} = 9.000\text{ m}$ ($9\text{ km}$), $H_{min} = 20\text{ m}$.
     - Màu vòm hiển thị: Xanh lục nhạt (`#10b981`).
  2. **SPYDER-MR (Tầm trung)**:
     - Tên lửa sử dụng: **Derby-MR** trang bị đầu tự dẫn radar chủ động sóng milimet kết hợp tầng động cơ khởi tốc phụ (Booster).
     - Cự ly tiêu diệt: $D_{max} = 50\text{ km}$, $D_{min} = 2\text{ km}$.
     - Độ cao tiêu diệt: $H_{max} = 16.000\text{ m}$ ($16\text{ km}$), $H_{min} = 20\text{ m}$.
     - Màu vòm hiển thị: Xanh lam nhạt (`#0ea5e9`).
- **Giới hạn tốc độ mục tiêu tiêu diệt (Quy định tại Bảng 1, Mục 3)**:
  - Máy bay (độ cao $> 30\text{ m}$): $V_{mt} < 800\text{ m/s}$.
  - Trực thăng (độ cao $> 20\text{ m}$): $V_{mt} = 0 - 200\text{ m/s}$ (tiêu diệt được cả trực thăng treo tại chỗ).
  - Thiết bị bay không người lái (UAV) (độ cao $> 100\text{ m}$): $V_{mt} < 300\text{ m/s}$.
- **Góc tà xạ kích**: $5^\circ \to 75^\circ$, phóng đa hướng $360^\circ$ thẳng đứng hoặc nghiêng.
- **Thời gian phản ứng xạ kích**: $9\text{ giây}$.

---

### 2.5. Tổ Tên lửa Vác vai Igla-S (`Tactical Sandbox`)
- **Tập tin định nghĩa**: [`src/types/tacticalSandbox.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/types/tacticalSandbox.ts#L68-L78)
- **Mã vai trò**: `manpads_igla`.
- **Thông số tác chiến**:
  - Tên lửa đất đối không vác vai 9K338 Igla-S (Nga).
  - Tầm bắn hiệu quả: $6.000\text{ m}$ ($6\text{ km}$).
  - Trần bắn tối đa: $3.500\text{ m}$ ($3.5\text{ km}$), sàn bắn tối thiểu: $10\text{ m}$.
  - Ứng dụng: Bố trí tại các chốt điểm cao, đón lõng tại các cửa thung lũng, hẻm núi để tiêu diệt UAV, trực thăng và tên lửa hành trình bay bám địa hình.

---

### 2.6. Mục tiêu Tên lửa Đối phương & Khí tài Nghi binh Mồi nhử
- **Tên lửa Hành trình đối phương (`InfiltrationSimulationRoute`)**:
  - Định nghĩa tại [`src/types/tacticalSandbox.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/types/tacticalSandbox.ts#L190-L222).
  - Vận tốc bay giả định: $220\text{ m/s} \approx 800\text{ km/h}$.
  - Quỹ đạo bay: Mô phỏng bay bám sát địa hình Nap-of-the-Earth ($60\text{ m}$ AGL), luồn lách theo các thung lũng khuất sau các dãy núi đá vôi để tránh trường radar cảnh giới.
- **Trận địa Nghi binh Mồi nhử (`decoy_radar`)**:
  - Định nghĩa tại [`src/types/tacticalSandbox.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/types/tacticalSandbox.ts#L101-L111).
  - Phát bức xạ điện từ giả mô phỏng sóng radar điều khiển tên lửa để thu hút tên lửa chống bức xạ diệt radar (HARM / AGM-88) của đối phương bay chệch khỏi trận địa thật.

---

## 3. CÁC TÍNH NĂNG & ĐỘNG CƠ TÍNH TOÁN ĐÃ HIỆN THỰC

### 3.1. Động cơ Dựng Thể tích Hỏa lực 3D Cắt Địa hình
- Đặt tại: [`src/utils/missileVolumeEngine.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts).
- Chức năng: Tính toán thể tích vùng tiêu diệt 3D (Weapon Engagement Zone - WEZ) dựa trên tọa độ thực địa, độ cao bệ phóng, địa hình số DEM và góc ngẩng khí tài.

### 3.2. Mô hình Khí động Dạng Quả lê
Hàm [`calculateSamPearMaxRange`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts#L129-L157):
$$\Delta H = H_{mt} - H_{bệ}$$
- **Nửa trên ($\Delta H \ge H_{opt}$)**: Suy giảm lực nâng khí động do mật độ không khí loãng:
  $$\text{upperFactor} = 0.35 + 0.65 \cdot \sqrt{\max\left(0, 1 - \left(\frac{\Delta H - H_{opt}}{H_{max} - H_{opt}}\right)^2\right)}$$
  *(Tại trần bắn $H_{max}$, tên lửa vẫn bảo toàn khoảng $35\%$ tầm xa cực đại).*
- **Nửa dưới ($\Delta H < H_{opt}$)**: Suy giảm tầm bay do sức cản không khí đặc ở tầng sát đất:
  $$\text{lowerFactor} = 0.45 + 0.55 \cdot \left(\frac{\Delta H - H_{min}}{H_{opt} - H_{min}}\right)^{0.28}$$
  *(Tầng sát đất đạt $45\% - 50\%$ cự ly cực đại).*
- **Cắt góc phóng**: Kết hợp giới hạn góc ngẩng tối thiểu của bệ phóng $6^\circ$:
  $$D_{launch\_limit} = \Delta H \cdot \cot(6^\circ)$$

### 3.3. Mô hình Bán Elip Vòm kép SPYDER
Hàm [`calculateSpyderDomeMaxRange`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts#L109-L117):
Tuân thủ dạng hình học mặt cắt đứng bán elip chuẩn quân sự:
$$D(\Delta H) = D_{max} \cdot \sqrt{\max\left(0, 1 - \left(\frac{\Delta H}{H_{max}}\right)^2\right)}$$
- Tại chân bệ phóng ($\Delta H = 0$): $D = D_{max}$ ($20\text{ km}$ cho SR, $50\text{ km}$ cho MR).
- Tại trần xạ kích ($\Delta H = H_{max}$): $D = 0$ ($9\text{ km}$ cho SR, $16\text{ km}$ cho MR).
- Hệ thống tự động tính toán đồng thời cả 2 vòm lồng nhau: vòm trong SR (`spyderSrVolume`) nằm trọn trong vòm ngoài MR (`isSpyderDualDome: true`).

### 3.4. Nón Mù Đỉnh đầu Hình nón
Hàm [`calculateSamDeadConeRadius`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts#L165-L182):
- Vùng nón mù không xạ kích được do giới hạn góc ngẩng tối đa của bệ phóng / radar dẫn bắn ($\epsilon_{max} = 65^\circ$ đối với S-300 / C-125, $75^\circ$ đối với SPYDER).
- **Đặc điểm đỉnh nón (Apex)**: Đỉnh nón nằm chính xác tại tâm khí tài ($\Delta H = 0 \to R_{kh} = 0$).
- Bán kính nón mù tại độ cao $\Delta H$:
  $$R_{kh} = \Delta H \cdot \cot(\epsilon_{max}) = \frac{\Delta H}{\tan(\epsilon_{max})}$$

### 3.5. Phân tầng Xác suất Hỏa lực
Trong thể tích hỏa lực 3D, hệ thống tự động bóc tách thành 3 phân lớp xác suất tiêu diệt:
1. `optimal` (**Vùng tối ưu**): Đạt $70\% D_{max}$ — Xác suất tiêu diệt mục tiêu $P_k \ge 0.9$.
2. `high_prob` (**Vùng xác suất cao**): Đạt $85\% D_{max}$ — Xác suất tiêu diệt $P_k \ge 0.7 - 0.85$.
3. `outer_boundary` (**Biên xạ giới danh định**): $100\% D_{max}$ — Ranh giới khí động cực đại của đạn.

### 3.6. Cắt Thể tích 3D theo Địa hình Số DEM
Hàm [`sampleTerrainGridAndMasks`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/radarVolumeEngine.ts#L36) và [`computeSamEngagementVolume`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts#L230):
- Lấy mẫu độ cao địa hình thực tế (Cesium Terrain Provider) trên toàn bộ dải 360 phương vị và cự ly hướng tâm $D_{max}$.
- Tính toán góc che chắn địa hình tích lũy $\alpha_{ck}$.
- Nếu đường ngắm xạ kích hoặc độ cao tầng bay bị đỉnh núi che khuất, thể tích hỏa lực bị cắt gọt tại điểm giao cắt với sườn núi (`effectiveRanges`), mô phỏng chân thực vùng bóng râm hỏa lực không thể tiêu diệt mục tiêu phía sau dãy núi.

---

## 4. CÁC TÍNH NĂNG TRỰC QUAN HÓA & GIAO DIỆN TÁC CHIẾN

### 4.1. Kiến trúc Năng lực Khí tài Tách biệt
File [`src/utils/assetVisualization.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/assetVisualization.ts):
- Áp dụng nguyên tắc tách biệt chặt chẽ: Khí tài tên lửa phòng không (`TenLuaPhongKhong`) chỉ sở hữu năng lực `hasEngagementEnvelope = true`.
- **Tuyệt đối không ép vẽ vòng cự ly radar đồng tâm 360°** (`hasRangeRings = false`) hay quạt quét quay tròn (`hasSweep = false`).
- Icon cờ tác chiến SVG riêng biệt: 2 đầu đạn tên lửa vút lên chuẩn quân sự.

### 4.2. Bảng Mặt Cắt Đứng 2D Hỏa lực Tên lửa
File [`src/components/ui/RadarCrossSectionPanel.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RadarCrossSectionPanel.tsx):
- Khi chọn khí tài tên lửa, bảng tự động chuyển từ mặt cắt radar sang **Mặt Cắt Đứng Vùng Tiêu Diệt (WEZ Cross Section Profile)**.
- Hiển thị đồng thời:
  - Đường cong khí động quả lê / bán elip.
  - Vùng nón mù đỉnh đầu $65^\circ$.
  - 3 lớp xác suất: Tối ưu (70%), Xác suất cao (85%), Cực đại (100%).
  - Mặt cắt địa hình núi nhấp nhô theo góc phương vị đã chọn.
  - Vùng biên hiệu dụng thực tế sau khi bị núi cắt.
  - Với SPYDER: Vẽ lồng ghép cả 2 đường cong WEZ của SPYDER-SR và SPYDER-MR.
  - Tương tác Probe Point: Click chuột vào bất kỳ điểm nào trong vùng xạ kích để xem cự ly, độ cao và đồng bộ ngay lập tức điểm 3D trên quả cầu Cesium.

### 4.3. Bảng Thanh tra Tham số Khí tài
File [`src/components/ui/RightInspector.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx):
- **Cụm chọn Chế độ Xạ kích**: Chuyển đổi linh hoạt giữa các điều kiện tác chiến:
  - Bắn đón không nhiễu (`head_on`).
  - Bắn đuổi không nhiễu (`tail_chase`).
  - Nhiễu tiêu cực (`jamming_passive`).
  - Nhiễu tích cực (`jamming_active`).
  - Ngắm quang truyền hình Karat (`tbk_optical`).
- **Chuyển đổi Mô hình 3D**: `DANH NGHĨA` (Lý thuyết) $\leftrightarrow$ `CẮT ĐỊA HÌNH` (Thực tế sau núi).
- **Thống kê tham số tức thời**: Cự ly tiêu diệt, trần/sàn hỏa lực, $V_{max}$ mục tiêu, tham số $P_{gh}$, thời gian phản ứng, phương thức dẫn bắn.

### 4.4. Mạng Lưới Chỉ huy Hiệp đồng C2
File [`src/store/useTacticalStore.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/store/useTacticalStore.ts) & [`src/components/map/CesiumGlobe.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/map/CesiumGlobe.tsx):
- Trường `commandedByInstanceId` gán từng trận địa tên lửa dưới quyền chỉ huy của một Sở Chỉ Huy Tác Chiến C2 (ví dụ SCH C2 Hà Nội chỉ huy Tiểu đoàn tên lửa C-125 Sơn Tây và Tiểu đoàn SPYDER Hải Phòng).
- Hiển thị đường liên kết chỉ huy tác chiến (Command Links) phát sáng nối từ SCH đến bệ phóng tên lửa.

### 4.5. Hiệp đồng Radar Cảnh giới & Tính Cự ly Báo động Tác chiến
File [`src/utils/radarMath.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/radarMath.ts#L178-L200) & [`src/components/ui/RadarFieldStatsModal.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RadarFieldStatsModal.tsx#L57-L66):
- Tự động tính toán cự ly tình báo báo động từ đài radar cảnh giới truyền về cho trận địa tên lửa phòng không tiêu diệt mục tiêu bay nhanh $V_{mt}$:
  - **Cự ly thông báo xa** ($D_{th.báo.xa}$): Đảm bảo thời gian mở máy, sấy đài và vào cấp 1 ($t_{chậm} + t_{SSCĐ}$):
    $$D_{th.báo.xa} = D_{đánh.chặn} + V_{mt} \cdot (t_{chậm} + t_{SSCĐ})$$
  - **Cự ly thông báo chính xác** ($D_{th.báo.ch.xác}$): Đảm bảo thời gian tính toán phần tử bắn và thời gian đạn bay ($t_{chậm} + t_{tính.toán} + t_{bay.đạn}$):
    $$D_{th.báo.ch.xác} = D_{đánh.chặn} + V_{mt} \cdot (t_{chậm} + t_{tính.toán} + t_{bay.đạn})$$

### 4.6. Phân Loại Khí Tài & Hiệp Đồng Dẫn Bắn Radar Chỉ Thị (Fire-Control Coordination)
File [`src/components/ui/LeftSidebar.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/LeftSidebar.tsx), [`src/components/ui/RightInspector.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx), [`src/utils/missileVolumeEngine.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts):
- **Phân định danh mục rành mạch tại Kho Khí Tài**:
  - **Mục Tên Lửa Phòng Không (SAM)**: S-300PMU2, C-125-2TM, C-125M, SPYDER (SR/MR).
  - **Mục Radar**: Phân tách rạch ròi 2 nhóm:
    1. 🎯 **Radar 3D Chỉ Thị Mục Tiêu (Dùng được cho Tên Lửa)**: Đại diện bởi **Đài Radar 36D6 (ST-68UM)** - Đo 3 tọa độ (phương vị, cự ly, độ cao), chuyên dụng phát hiện mục tiêu bay thấp/tên lửa hành trình và chỉ thị phần tử bắn cho S-300, C-125 (`canDesignateForSam = true`).
    2. 👁️ **Radar Cảnh Giới Nhìn Vòng (Không dùng cho Tên Lửa)**: Các đài **P-18M**, **1L13-3 / 55Ж6-1 (Nebo)**, **VRS-2DM (Bắt Thấp)**, **P-18 Terek** - Chuyên cảnh giới phát hiện sớm từ xa, không đo cao 3D trực tiếp để dẫn bắn cho tên lửa (`canDesignateForSam = false`).
- **Cơ chế Cắt Địa Hình Hỏa Lực theo Radar (Hiệp đồng V_SAM ∩ V_Radar)**:
  - Cho phép người dùng liên kết trận địa tên lửa với một đài radar trên bản đồ (`designatedRadarId`).
  - Hỗ trợ 3 chế độ cắt địa hình:
    1. `organic`: Vòm tên lửa tự cắt địa hình độc lập theo góc che khuất từ vị trí bệ phóng.
    2. `linked_radar`: **Chỉ bắn trong vùng đài radar chỉ thị quét được** - Cự ly xạ kích của tên lửa tại mọi hướng và độ cao bị khống chế nghiêm ngặt bởi cự ly phát hiện của radar ($D_{eff}(az, H) \le D_{radar}(az, H)$).
    3. `intersection`: **Giao thoa hỏa lực kép** ($V_{SAM} \cap V_{Radar}$) - Vừa bị chặn bởi địa hình tại bệ phóng, vừa phải nằm trong tầm bám sát của đài radar chỉ thị.
  - **3D Shader GPU**: Tên lửa kế thừa cấu trúc `terrainGrid` của chính nó hoặc của đài radar liên kết để shader GPU loại bỏ hoàn toàn các pixel nằm ngoài tầm bao phủ hỏa lực.

---

## 5. HỆ THỐNG KIỂM THỬ & XÁC MINH ĐỘC LẬP

1. File kiểm thử thể tích hỏa lực tên lửa: [`docs/verify-sam-missile-envelope.ts`](file:///e:/code/du_an/3D/vkq/vompk/docs/verify-sam-missile-envelope.ts) (8/8 bài kiểm tra PASS).
2. File kiểm thử phân loại khí tài & radar chỉ thị: [`docs/verify-equipment-classification.ts`](file:///e:/code/du_an/3D/vkq/vompk/docs/verify-equipment-classification.ts) (Đạt chuẩn 100%):
   - Xác minh đài 36D6 là `canDesignateForSam = true` (`chi_thi_ten_lua`).
   - Xác minh các đài P-18M, Nebo, VRS-2DM là `canDesignateForSam = false` (`canh_gioi_nhin_vong`).
   - Xác minh khởi tạo đủ 4 tổ hợp tên lửa và kế thừa chính xác qua factory.

---

## 6. DANH MỤC MÃ NGUỒN & TỆP TIN LIÊN QUAN TRỰC TIẾP

| Đường dẫn tệp tin | Chức năng liên quan khí tài tên lửa |
| :--- | :--- |
| [`src/types/equipment.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/types/equipment.ts) | Định nghĩa `RadarSubRole`, `SamTerrainMaskMode`, các trường `canDesignateForSam`, `designatedRadarId`. |
| [`src/data/equipmentTemplates.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/data/equipmentTemplates.ts) | Phân định vai trò 36D6 vs Cảnh giới nhìn vòng; gán chế độ cắt địa hình mặc định cho tên lửa. |
| [`src/utils/equipmentFactory.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/equipmentFactory.ts) | Kế thừa các trường phân loại và hiệp đồng khi khởi tạo thực thể khí tài mới. |
| [`src/utils/missileVolumeEngine.ts`](file:///e:/code/du_an/3D/vkq/vompk/src/utils/missileVolumeEngine.ts) | Động cơ tính toán thể tích SAM, lấy `terrainGrid`, cắt theo radar liên kết và outer boundary. |
| [`src/components/ui/LeftSidebar.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/LeftSidebar.tsx) | Giao diện Kho Khí Tài phân nhóm rõ Tên Lửa vs Radar (36D6 Chỉ thị vs Cảnh giới nhìn vòng). |
| [`src/components/ui/RightInspector.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/ui/RightInspector.tsx) | Bảng điều khiển chọn đài Radar chỉ thị mục tiêu và chọn chế độ cắt địa hình hỏa lực. |
| [`src/components/map/CesiumGlobe.tsx`](file:///e:/code/du_an/3D/vkq/vompk/src/components/map/CesiumGlobe.tsx) | Render vòm SAM với tham số `terrainMask` trên GPU shader và truyền `linkedRadarVolume`. |
| [`docs/verify-sam-missile-envelope.ts`](file:///e:/code/du_an/3D/vkq/vompk/docs/verify-sam-missile-envelope.ts) | Bộ kịch bản 8 test case tự động xác minh toàn diện tính năng tên lửa. |
| [`docs/verify-equipment-classification.ts`](file:///e:/code/du_an/3D/vkq/vompk/docs/verify-equipment-classification.ts) | Kịch bản kiểm thử tự động phân loại khí tài và vai trò radar đối với tên lửa. |
