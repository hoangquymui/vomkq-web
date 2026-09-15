# VomKQ Web - Hệ Thống Lập Kế Hoạch Phòng Không 3D (Web GIS)

Ứng dụng Web GIS 3D chuyên biệt cho mô phỏng và lập kế hoạch bố trí khí tài Phòng không - Không quân, được xây dựng theo chuẩn công nghệ hàng không và quân sự hiện đại.

---

## 🚀 Khởi Chạy Dự Án

Thư mục: `vomkq-web`

```bash
# 1. Cài đặt thư viện (nếu chưa cài)
npm install

# 2. Khởi chạy máy chủ phát triển (Dev Server)
npm run dev

# Ứng dụng sẽ chạy tại địa chỉ: http://localhost:3000
```

### Đóng gói Production:
```bash
npm run build
npm run preview
```

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

* **3D GIS Globe Engine**: [CesiumJS](https://cesium.com/) + `vite-plugin-cesium`
* **Frontend Framework**: [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Build Tool**: [Vite](https://vite.dev/)
* **Styling & UI**: [Tailwind CSS v4](https://tailwindcss.com/) (Tactical Military Dark Theme)
* **Icons**: [Lucide React](https://lucide.dev/)
* **State Management**: [Zustand](https://github.com/pmndrs/zustand)

---

## 🎯 Các Tính Năng Đã Triển Khai

1. **Bản đồ 3D Quả Địa Cầu & 2D (Digital Globe)**
   - Hiển thị theo hệ toạ độ chuẩn địa lý quốc tế WGS-84 (Vĩ độ, Kinh độ, Độ cao).
   - Chuyển đổi mượt mà giữa chế độ **3D Globe** (cầu) và **2D Map** (phẳng).
   - Nút nhảy nhanh camera tới các vị trí trọng yếu: *Hà Nội, Hải Phòng, Đà Nẵng, TP. Hồ Chí Minh, Cam Ranh, Quần đảo Trường Sa, Toàn cảnh Việt Nam*.

2. **Kho Khí Tài & Triển Khai Tác Chiến (Catalog)**
   - *Đài Radar 36D6 (ST-68UM)*: Radar 3D cảnh giới & chỉ thị mục tiêu tầm xa (300 km).
   - *Đài Radar P-18M (Spoon Rest)*: Radar cảnh giới sóng mét chống tàng hình (250 km).
   - *Trạm Trinh sát Thụ động Kolchuga-M*: Trinh sát thụ động ESM (400 km).
   - *Tổ hợp Tên lửa SAM S-300PMU2 (Favorit)*: Tên lửa phòng không tầm xa (200 km).
   - *Tổ hợp Tên lửa Cơ động Spyder-MR*: Tên lửa phòng không cơ động phản ứng nhanh (50 km).
   - *Sở Chỉ Huy Tác Chiến C2 (SCH)*: Trung tâm chỉ huy, điều phối và phân bổ hỏa lực.
   - *Pháo Phòng Không Tự Hành ZSU-23-4 Shilka*: Phòng không tầm thấp, bảo vệ điểm.
   - Nhấp chọn khí tài -> Click bất kỳ đâu trên quả địa cầu 3D để triển khai.

3. **Mô Phỏng Vòm Phủ Sóng 3D (Radar Dome) & Vòng Chân Vòm 2D (Footprint)**
   - Bán cầu 3D trong suốt hiển thị vùng phủ sóng thực tế trong không gian.
   - Vòng tròn 2D chiếu chân vòm lên mặt đất.
   - Tự động thay đổi kích thước realtime khi chỉnh thanh trượt bán kính.

4. **Tuyến Chỉ Huy Tác Chiến (Command Links)**
   - Đường truyền số liệu chỉ huy nối từ Sở Chỉ Huy (SCH) tới các đài radar và trận địa tên lửa trực thuộc.
   - Hiệu ứng phát sáng 3D (Polyline Glow).
   - Tự động cập nhật tuyến đường khi SCH hoặc khí tài thay đổi toạ độ.

5. **Bảng Điều Khiển Thuộc Tính Chiến Thuật (Inspector)**
   - Cập nhật tên, toạ độ thực địa WGS-84 (Lat, Lon, Độ cao đất ASL, Tháp ăng-ten AGL).
   - Chỉnh sửa bán kính phủ sóng (Range km), tốc độ quét radar (°/s), góc tà min/max (°).
   - Chuyển đổi 4 trạng thái hoạt động: *Đang hoạt động*, *Chờ lệnh*, *Bảo trì*, *Ngừng hoạt động*.
   - Gán Sở Chỉ Huy cấp trên cho từng khí tài.
   - Bật/tắt vòm 3D độc lập cho từng đơn vị.

6. **Thước Đo Khoảng Cách Thực Địa (Measurement Tool)**
   - Đánh dấu các mốc toạ độ trên mặt đất/biển.
   - Tự động tính khoảng cách trắc địa đường cong mặt đất WGS-84 theo cả đơn vị **Kilomèt (km)** và **Hải lý (Nautical Miles - NM)**.

7. **Lưu & Nạp Bố Cục Kế Hoạch (Save / Load Layout)**
   - **Lưu Bố Cục**: Xuất kế hoạch tác chiến thành file `.json`.
   - **Tải Bố Cục**: Nạp lại file `.json` để khôi phục toàn bộ trận địa.
   - Định dạng tương thích với cấu trúc lưu trữ `LayoutSaveData` của hệ thống VomKQ.
