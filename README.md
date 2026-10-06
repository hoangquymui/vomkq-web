# VomKQ Web – Hệ thống lập kế hoạch Phòng không 3D (Web GIS)

Ứng dụng Web GIS 3D để mô phỏng và lập kế hoạch bố trí khí tài Phòng không – Không quân: vùng phát hiện radar, vòm tiêu diệt tên lửa/pháo, che khuất địa hình (LOS), mặt cắt đứng (WEZ) và gợi ý bố trí bằng AI.

## Công nghệ

| Thành phần | Thư viện |
| --- | --- |
| Globe 3D | [CesiumJS](https://cesium.com/) + `vite-plugin-cesium` |
| Giao diện | React 19 + TypeScript |
| Build | Vite 8 |
| Style | Tailwind CSS v4 |
| State | Zustand |
| Icon | Lucide React |
| Chuyển đổi model 3D | three.js |

---

## 1. Yêu cầu

- **Node.js ≥ 20** (khuyến nghị bản LTS mới nhất) và npm.
- **Git**.
- Trình duyệt hỗ trợ WebGL 2 (Chrome / Edge mới).
- *(Tùy chọn)* Tài khoản [Cesium ion](https://ion.cesium.com/) để lấy access token nếu dùng dữ liệu online của Cesium.
- *(Tùy chọn)* Backend VECTOR AI (FastAPI) chạy tại `http://127.0.0.1:8000` cho tính năng gợi ý bố trí.

## 2. Cài đặt

```bash
git clone https://github.com/hoangquymui/vomkq-web.git
cd vomkq-web
npm install
```

### Cấu hình biến môi trường

```bash
# Windows (PowerShell)
Copy-Item .env.example .env.local
# Linux / macOS
cp .env.example .env.local
```

Mở `.env.local` và điền:

```ini
VITE_CESIUM_ION_TOKEN=<token Cesium ion của bạn>
```

> `.env.local` đã được `.gitignore` bỏ qua, **không commit token lên git**. Nếu để trống, ứng dụng vẫn chạy với bản đồ offline / nguồn không cần token.

## 3. Chạy ứng dụng

```bash
npm run dev
```

Mở trình duyệt tại **http://localhost:3000**. Dev server lắng nghe trên mọi interface (`0.0.0.0`) nên các máy trong mạng LAN cũng truy cập được qua IP máy chạy.

## 4. Dữ liệu bản đồ offline

Tile bản đồ vệ tinh và địa hình **không nằm trong git** (quá lớn). Sau khi clone, tải lại bằng script, dữ liệu được lưu vào `public/`:

| Thư mục | Nội dung |
| --- | --- |
| `public/offline-satellite/{z}/{x}/{y}` | Ảnh vệ tinh 2D |
| `public/offline-terrain/` | Địa hình 3D (quantized-mesh `.terrain` + `layer.json`) |
| `public/offline-terrain-map/` | Bản đồ địa hình dạng ảnh |
| `public/offline-pack-info.json` | Thông tin gói dữ liệu đã tải (được commit) |

Lệnh tải:

```bash
# Ảnh vệ tinh + địa hình toàn Việt Nam
node scripts/download-vietnam-satellite-and-terrain.js

# Tải theo khu vực
npm run download-tamdao            # ảnh vệ tinh Tam Đảo
npm run download-binhdinh          # ảnh vệ tinh Bình Định
npm run download-terrain-tamdao    # địa hình Tam Đảo
npm run download-terrain-binhdinh  # địa hình Bình Định
npm run download-topo-mientrung    # bản đồ địa hình miền Trung

# Tải tất cả
node scripts/download-tactical-all.js
```

Có thể tùy chỉnh `--region=`, `--minZoom=`, `--maxZoom=` (xem đầu mỗi file trong `scripts/`). Nếu không có tile offline, ứng dụng sẽ dùng nguồn bản đồ online.

Ngoài ra có thể chép thẳng các thư mục `public/offline-*` từ máy khác (USB/ổ mạng) để dùng hoàn toàn offline.

## 5. Build production

```bash
npm run build      # kiểm tra kiểu TypeScript + build ra dist/
npm run preview    # chạy thử bản build
```

Mặc định bản build **không** chép tile offline vào `dist/` để build nhanh. Khi triển khai, có 2 cách:

- Phục vụ thư mục `public/offline-*` song song với `dist/` trên web server (nginx, IIS…), cùng đường dẫn `/offline-...`.
- Hoặc đóng gói kèm tile vào `dist/`:

  ```bash
  # PowerShell
  $env:COPY_OFFLINE_TILES="1"; npm run build
  # Linux / macOS
  COPY_OFFLINE_TILES=1 npm run build
  ```

## 6. Kiểm tra & lint

```bash
npm run lint                                         # oxlint
npx tsx scripts/verify/verify-sam-missile-envelope.ts  # chạy script kiểm chứng engine
```

Các script kiểm chứng tính toán (LOS, vòm radar, vòm tên lửa, AI advisor…) nằm trong `scripts/verify/`.

## 7. Cấu trúc thư mục

```
vomkq-web/
├── public/
│   ├── images/equipments/   # ảnh khí tài
│   ├── models/equipments/   # model 3D (.glb)
│   └── offline-*/           # tile offline (không commit)
├── scripts/
│   ├── download-*.js        # tải dữ liệu bản đồ offline
│   ├── verify/              # script kiểm chứng engine
│   └── vectorAiLauncher.ts  # plugin Vite khởi chạy backend AI khi dev
├── src/
│   ├── components/          # map (Cesium), ui (panel, modal)
│   ├── data/                # thông số khí tài (equipmentTemplates.ts)
│   ├── services/            # client gọi VECTOR AI
│   ├── store/               # Zustand store
│   ├── types/               # kiểu dữ liệu
│   └── utils/               # engine tính radar / LOS / tên lửa / hình học
├── docs/                    # ghi chú phát triển
├── .env.example
└── vite.config.ts
```

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| `Port 3000 is already in use` | Tắt tiến trình đang dùng cổng 3000 hoặc sửa `server.port` trong `vite.config.ts`. |
| Bản đồ đen / không có địa hình | Kiểm tra đã tải tile vào `public/offline-*` hoặc đã điền `VITE_CESIUM_ION_TOKEN`. |
| Tính năng AI báo lỗi kết nối | Khởi động backend VECTOR AI tại `127.0.0.1:8000`. |
| `npm install` lỗi | Dùng Node.js ≥ 20, xoá `node_modules` rồi cài lại. |
