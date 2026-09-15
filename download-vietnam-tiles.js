/**
 * Script tải trọn gói bản đồ Offline cho khu vực Việt Nam
 * Toạ độ: Lon 101.5°E - 118.5°E, Lat 6.0°N - 24.0°N
 * Cấp Zoom: 0 đến 8 (Toàn cảnh chiến lược quốc gia, biển đảo)
 * Lưu trữ tại: public/offline-tiles/{z}/{x}/{y}.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình phạm vi toạ độ Việt Nam (Bao gồm đất liền, thềm lục địa và 2 quần đảo Hoàng Sa, Trường Sa)
const VN_BBOX = {
  minLon: 101.5,
  maxLon: 118.5,
  minLat: 6.0,
  maxLat: 24.0,
};

// Cấu hình mức Zoom (mặc định 0 đến 8 để tải nhanh và dung lượng nhẹ ~10MB)
// Bạn có thể tăng MAX_ZOOM lên 9 hoặc 10 nếu muốn chi tiết hơn
const MIN_ZOOM = 0;
const MAX_ZOOM = 8;

// Nguồn tile: OpenStreetMap hoặc CartoDB (chuẩn XYZ)
const TILE_SERVERS = [
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
];
const SELECTED_SERVER = TILE_SERVERS[1]; // Dùng CartoDB Voyager sạch đẹp, không bị rate-limit gắt

const OUTPUT_DIR = path.join(__dirname, 'public', 'offline-tiles');

// Chuyển đổi Kinh/Vĩ độ sang Toạ độ gạch Tile XYZ
function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom)
  );
}

// Giới hạn đồng thời (concurrency) để không bị nghẽn mạng
const CONCURRENCY = 6;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadTile(z, x, y, urlTemplate, retries = 3) {
  const tileUrl = urlTemplate
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y);

  const tileDir = path.join(OUTPUT_DIR, String(z), String(x));
  const tileFile = path.join(tileDir, `${y}.png`);

  if (fs.existsSync(tileFile)) {
    return { success: true, skipped: true };
  }

  fs.mkdirSync(tileDir, { recursive: true });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(tileUrl, {
        headers: {
          'User-Agent': 'VomKQ-Tactical-GIS-Downloader/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(tileFile, buffer);
      return { success: true, skipped: false };
    } catch (err) {
      if (attempt === retries) {
        console.error(`[Lỗi] Không tải được tile (${z}/${x}/${y}): ${err.message}`);
        return { success: false, error: err.message };
      }
      await sleep(400 * attempt);
    }
  }
}

async function main() {
  console.log('====================================================');
  console.log('🇻🇳 BẮT ĐẦU XUẤT BẢN ĐỒ VIỆT NAM CHẠY OFFLINE');
  console.log(`Phạm vi: Lon [${VN_BBOX.minLon}, ${VN_BBOX.maxLon}], Lat [${VN_BBOX.minLat}, ${VN_BBOX.maxLat}]`);
  console.log(`Mức Zoom: ${MIN_ZOOM} -> ${MAX_ZOOM}`);
  console.log(`Thư mục lưu: ${OUTPUT_DIR}`);
  console.log('====================================================\n');

  // Tính toán danh sách tile cần tải
  const tileQueue = [];

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const minX = Math.max(0, lon2tile(VN_BBOX.minLon, z));
    const maxX = Math.min(Math.pow(2, z) - 1, lon2tile(VN_BBOX.maxLon, z));
    const minY = Math.max(0, lat2tile(VN_BBOX.maxLat, z));
    const maxY = Math.min(Math.pow(2, z) - 1, lat2tile(VN_BBOX.minLat, z));

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tileQueue.push({ z, x, y });
      }
    }
  }

  console.log(`Tổng số tile cần xuất: ${tileQueue.length} ảnh gạch.\n`);

  let completed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;

  // Xử lý tải đồng thời (Worker Pool)
  async function worker() {
    while (tileQueue.length > 0) {
      const tile = tileQueue.shift();
      if (!tile) break;

      const res = await downloadTile(tile.z, tile.x, tile.y, SELECTED_SERVER);
      completed++;
      if (res.skipped) skippedCount++;
      else if (res.success) downloadedCount++;

      const percent = ((completed / (downloadedCount + skippedCount + tileQueue.length)) * 100).toFixed(1);
      process.stdout.write(
        `\rĐang tải: ${completed} / ${completed + tileQueue.length} (${percent}%) | Đã tải mới: ${downloadedCount} | Đã có sẵn: ${skippedCount}`
      );

      // Nghỉ nhẹ để không spam server
      await sleep(20);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // Tạo file metadata.json lưu thông số gói bản đồ
  const metadata = {
    name: 'Vietnam Offline Base Map (VomKQ)',
    description: 'Bản đồ cắt gọn lãnh thổ và biển đảo Việt Nam phục vụ chạy Offline',
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    bounds: [VN_BBOX.minLon, VN_BBOX.minLat, VN_BBOX.maxLon, VN_BBOX.maxLat],
    totalTiles: completed,
    exportedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  console.log('\n\n====================================================');
  console.log('✅ XUẤT BẢN ĐỒ OFFLINE VIỆT NAM THÀNH CÔNG!');
  console.log(`Đã lưu trữ toàn bộ tại: public/offline-tiles/`);
  console.log('Ứng dụng Web giờ đây có thể chọn "Bản Đồ Offline VN" và chạy 100% không cần Internet!');
  console.log('====================================================');
}

main().catch(console.error);
