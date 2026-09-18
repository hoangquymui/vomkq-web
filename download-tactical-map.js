import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_SAT_DIR = path.resolve(__dirname, 'public', 'offline-satellite');
const INFO_FILE = path.resolve(__dirname, 'public', 'offline-pack-info.json');

// Các khu vực chiến thuật trọng điểm mặc định
const PRESET_REGIONS = {
  tamdao: {
    name: 'Dãy Núi Tam Đảo & Phụ Cận (Vĩnh Phúc - Thái Nguyên - Tuyên Quang)',
    lat: 21.45,
    lon: 105.65,
    radiusKm: 35,
    minZoom: 9,
    maxZoom: 13,
  },
  binhdinh: {
    name: 'Tây Sơn - Đèo An Khê - Quy Nhơn (Bình Định - Gia Lai)',
    lat: 13.90,
    lon: 108.95,
    radiusKm: 40,
    minZoom: 9,
    maxZoom: 13,
  },
  hanoi: {
    name: 'Thủ Đô Hà Nội & Vành Đai Phòng Không',
    lat: 21.03,
    lon: 105.85,
    radiusKm: 30,
    minZoom: 9,
    maxZoom: 13,
  },
  haiphong: {
    name: 'Khu Vực Duyên Hải Hải Phòng - Cát Bà',
    lat: 20.85,
    lon: 106.68,
    radiusKm: 30,
    minZoom: 9,
    maxZoom: 13,
  },
  haivan: {
    name: 'Đèo Hải Vân & Bán Đảo Sơn Trà (Đà Nẵng - Huế)',
    lat: 16.195,
    lon: 108.131,
    radiusKm: 35,
    minZoom: 9,
    maxZoom: 13,
  },
  danang: {
    name: 'Đà Nẵng & Vùng Trời Duyên Hải Miền Trung',
    lat: 16.05,
    lon: 108.20,
    radiusKm: 35,
    minZoom: 9,
    maxZoom: 13,
  },
  camranh: {
    name: 'Vịnh Cam Ranh - Nha Trang - Khánh Hoà',
    lat: 11.95,
    lon: 109.15,
    radiusKm: 35,
    minZoom: 9,
    maxZoom: 13,
  },
  tphcm: {
    name: 'TP. Hồ Chí Minh & Vùng Phòng Không Phía Nam',
    lat: 10.82,
    lon: 106.63,
    radiusKm: 35,
    minZoom: 9,
    maxZoom: 13,
  },
};

// Hàm chuyển đổi toạ độ địa lý (WGS84) sang toạ độ mảnh gạch (Slippy Map Tile XYZ)
function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

// Bounding box từ toạ độ tâm và bán kính (km)
function getBoundsFromCenter(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.0;
  const dLon = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLon: lon - dLon,
    maxLon: lon + dLon,
  };
}

// Lập danh sách mảnh gạch cho một vùng toạ độ
function getTilesForBounds(bounds, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = Math.max(0, lon2tile(bounds.minLon, z));
    const xMax = Math.min(Math.pow(2, z) - 1, lon2tile(bounds.maxLon, z));
    const yMin = Math.max(0, lat2tile(bounds.maxLat, z));
    const yMax = Math.min(Math.pow(2, z) - 1, lat2tile(bounds.minLat, z));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// Tải file buffer qua HTTPS có hỗ trợ chuyển hướng
function fetchBuffer(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Quản lý hàng đợi tải song song (Worker Pool)
async function downloadTileBatch(tiles, concurrency = 8) {
  let completed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const total = tiles.length;
  console.log(`📡 Bắt đầu tải ${total} mảnh gạch bản đồ vệ tinh (Đồng thời: ${concurrency})...\n`);

  async function worker(index) {
    while (tiles.length > 0) {
      const tile = tiles.shift();
      if (!tile) break;

      const { z, x, y } = tile;
      const outDir = path.join(OUT_SAT_DIR, String(z), String(x));
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${y}.jpg`);

      // Kiểm tra file đã có sẵn
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 600) {
        completed++;
        skippedCount++;
        continue;
      }

      // Nguồn ảnh ESRI World Imagery
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      let success = false;
      let retries = 2;

      while (retries > 0 && !success) {
        try {
          const buffer = await fetchBuffer(url);
          fs.writeFileSync(outFile, buffer);
          downloadedCount++;
          success = true;
        } catch {
          retries--;
          if (retries > 0) await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (!success) {
        failedCount++;
      }

      completed++;
      if (completed % 15 === 0 || completed === total) {
        const percent = ((completed / total) * 100).toFixed(1);
        process.stdout.write(
          `   ⏳ Tiến trình: ${completed}/${total} (${percent}%) | Đã tải mới: ${downloadedCount} | Có sẵn: ${skippedCount} | Lỗi: ${failedCount}\r`
        );
      }
    }
  }

  const workers = Array.from({ length: concurrency }, (_, i) => worker(i));
  await Promise.all(workers);

  console.log(`\n\n✅ Hoàn tất tải ảnh vệ tinh!`);
  console.log(`   - Tổng số mảnh kiểm tra: ${total}`);
  console.log(`   - Tải mới: ${downloadedCount} mảnh`);
  console.log(`   - Đã có sẵn: ${skippedCount} mảnh`);
  console.log(`   - Không tải được: ${failedCount} mảnh`);

  return { total, downloadedCount, skippedCount, failedCount };
}

// Phân tích tham số dòng lệnh CLI
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    region: 'tamdao',
    lat: null,
    lon: null,
    radiusKm: null,
    minZoom: null,
    maxZoom: null,
    concurrency: 10,
  };

  for (const arg of args) {
    if (arg.startsWith('--region=')) {
      options.region = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--lat=')) {
      options.lat = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--lon=')) {
      options.lon = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--radiusKm=')) {
      options.radiusKm = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--minZoom=')) {
      options.minZoom = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--maxZoom=')) {
      options.maxZoom = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

async function main() {
  console.log('===============================================================');
  console.log('🛰️ BỘ TẢI BẢN ĐỒ VỆ TINH ĐỘ NÉT CAO NGOẠI TUYẾN - VOMKQ 3D GIS');
  console.log('===============================================================\n');

  const options = parseArgs();

  let regionConfig;
  if (options.lat !== null && options.lon !== null) {
    regionConfig = {
      name: `Khu vực tuỳ chỉnh (${options.lat.toFixed(3)}, ${options.lon.toFixed(3)})`,
      lat: options.lat,
      lon: options.lon,
      radiusKm: options.radiusKm || 30,
      minZoom: options.minZoom || 9,
      maxZoom: options.maxZoom || 13,
    };
  } else {
    regionConfig = PRESET_REGIONS[options.region] || PRESET_REGIONS.tamdao;
    if (options.minZoom !== null) regionConfig.minZoom = options.minZoom;
    if (options.maxZoom !== null) regionConfig.maxZoom = options.maxZoom;
    if (options.radiusKm !== null) regionConfig.radiusKm = options.radiusKm;
  }

  console.log(`📍 Khu vực mục tiêu: ${regionConfig.name}`);
  console.log(`🌐 Toạ độ tâm: Lat ${regionConfig.lat}, Lon ${regionConfig.lon}`);
  console.log(`📏 Bán kính bao phủ: ${regionConfig.radiusKm} km`);
  console.log(`🔍 Mức Zoom: Level ${regionConfig.minZoom} -> Level ${regionConfig.maxZoom}`);

  const bounds = getBoundsFromCenter(regionConfig.lat, regionConfig.lon, regionConfig.radiusKm);
  const tiles = getTilesForBounds(bounds, regionConfig.minZoom, regionConfig.maxZoom);

  console.log(`📦 Dự kiến tải: ${tiles.length} mảnh gạch`);

  const result = await downloadTileBatch(tiles, options.concurrency);

  // Cập nhật thông tin pack info
  let info = {};
  if (fs.existsSync(INFO_FILE)) {
    try {
      info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
      info = {};
    }
  }

  info.lastUpdated = new Date().toISOString();
  info.highResRegions = info.highResRegions || [];
  info.highResRegions.push({
    name: regionConfig.name,
    lat: regionConfig.lat,
    lon: regionConfig.lon,
    radiusKm: regionConfig.radiusKm,
    zoomLevels: `${regionConfig.minZoom}-${regionConfig.maxZoom}`,
    downloadedAt: new Date().toISOString(),
    tileCount: result.total - result.failedCount,
  });

  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  console.log(`\n💾 Đã cập nhật thông tin dữ liệu tại public/offline-pack-info.json`);
  console.log('🚀 Bây giờ bạn có thể bật chế độ Ngoại Tuyến (Offline) trên ứng dụng và zoom cận cảnh mượt mà!');
}

main().catch(console.error);
