import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_TERRAIN_DIR = path.resolve(__dirname, 'public', 'offline-terrain-map');
const INFO_FILE = path.resolve(__dirname, 'public', 'offline-pack-info.json');

// Các khu vực chiến thuật trọng điểm mặc định
const PRESET_REGIONS = {
  mientrung: {
    name: 'Toàn Bộ Duyên Hải Miền Trung & Tây Nguyên',
    minLat: 10.5,
    maxLat: 20.0,
    minLon: 105.0,
    maxLon: 109.5,
    minZoom: 8,
    maxZoom: 13,
  },
  danang: {
    name: 'Đà Nẵng & Vùng Trời Duyên Hải Miền Trung',
    lat: 16.05,
    lon: 108.20,
    radiusKm: 40,
    minZoom: 8,
    maxZoom: 13,
  },
  haivan: {
    name: 'Đèo Hải Vân & Bán Đảo Sơn Trà (Đà Nẵng - Huế)',
    lat: 16.195,
    lon: 108.131,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
  tamdao: {
    name: 'Dãy Núi Tam Đảo & Phụ Cận (Vĩnh Phúc - Thái Nguyên - Tuyên Quang)',
    lat: 21.45,
    lon: 105.65,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
  binhdinh: {
    name: 'Tây Sơn - Đèo An Khê - Quy Nhơn (Bình Định - Gia Lai)',
    lat: 13.90,
    lon: 108.95,
    radiusKm: 40,
    minZoom: 8,
    maxZoom: 13,
  },
  hanoi: {
    name: 'Thủ Đô Hà Nội & Vành Đai Phòng Không',
    lat: 21.03,
    lon: 105.85,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
  haiphong: {
    name: 'Khu Vực Duyên Hải Hải Phòng - Cát Bà',
    lat: 20.85,
    lon: 106.68,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
  camranh: {
    name: 'Vịnh Cam Ranh - Nha Trang - Khánh Hoà',
    lat: 11.95,
    lon: 109.15,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
  tphcm: {
    name: 'TP. Hồ Chí Minh & Vùng Phòng Không Phía Nam',
    lat: 10.82,
    lon: 106.63,
    radiusKm: 35,
    minZoom: 8,
    maxZoom: 13,
  },
};

// Chuyển đổi toạ độ EPSG:4326 sang Slippy Map XYZ
function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

// Tính toạ độ Bounding Box từ tâm và bán kính (km)
function getBoundsFromCenter(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111.0;
  const lonDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

// Lập danh sách mảnh gạch cho vùng toạ độ
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

// Tải buffer qua HTTPS
function fetchBuffer(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VomKQ/1.0',
          Accept: 'image/png,image/jpeg,image/*;q=0.9',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchBuffer(res.headers.location, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Kiểm tra tính toàn vẹn của file ảnh (PNG hoặc JPEG)
function isValidImage(buf) {
  if (!buf || buf.length < 50) return false;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpg;
}

// Tải tile Google Terrain chuẩn Tiếng Việt, sạch bóng POI cửa hàng
async function fetchGoogleTerrainTile(z, x, y) {
  const subdomains = ['0', '1', '2', '3'];
  const sub = subdomains[(x + y) % subdomains.length];
  // lyrs=p: Terrain với ranh giới và tuyến đường, hl=vi&gl=VN: chuẩn địa danh và chủ quyền Việt Nam
  const url = `https://mt${sub}.google.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}&hl=vi&gl=VN`;

  const buf = await fetchBuffer(url);
  if (isValidImage(buf)) return buf;
  throw new Error(`File không hợp lệ tại ${z}/${x}/${y}`);
}

// Tải song song có kiểm soát luồng và retry
async function downloadTileBatch(tiles, concurrency = 6, delayMs = 20) {
  let completed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const total = tiles.length;
  const startTime = Date.now();

  console.log(`📡 Đang xử lý ${total} mảnh gạch Google Terrain...`);
  console.log(`⚙️ Số luồng đồng thời: ${concurrency} | Nghỉ giữa request: ${delayMs}ms\n`);

  let nextTileIdx = 0;

  async function worker() {
    while (nextTileIdx < total) {
      const idx = nextTileIdx++;
      if (idx >= total) break;
      const tile = tiles[idx];
      if (!tile) continue;

      const { z, x, y } = tile;
      const outDir = path.join(OUT_TERRAIN_DIR, String(z), String(x));
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${y}.png`);

      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 100) {
        completed++;
        skippedCount++;
        continue;
      }

      let success = false;
      let retries = 3;

      while (retries > 0 && !success) {
        try {
          const buf = await fetchGoogleTerrainTile(z, x, y);
          fs.writeFileSync(outFile, buf);
          downloadedCount++;
          success = true;
        } catch {
          retries--;
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      if (!success) {
        failedCount++;
      }

      completed++;

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (completed % 25 === 0 || completed === total) {
        const percent = ((completed / total) * 100).toFixed(1);
        const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const speed = (downloadedCount / elapsedSec).toFixed(1);
        process.stdout.write(
          `\r[${percent}%] Tiến độ: ${completed}/${total} | Mới tải: ${downloadedCount} | Bỏ qua: ${skippedCount} | Lỗi: ${failedCount} | ${speed} tiles/s`
        );
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n\n✅ Hoàn thành tải bản đồ Google Terrain trong ${durationSec}s!`);
  console.log(`- Mảnh gạch mới tải: ${downloadedCount}`);
  console.log(`- Mảnh gạch đã có sẵn (bỏ qua): ${skippedCount}`);
  console.log(`- Mảnh gạch lỗi: ${failedCount}`);

  return { total, downloadedCount, skippedCount, failedCount };
}

// Xử lý tham số dòng lệnh CLI
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    region: 'mientrung',
    minZoom: null,
    maxZoom: null,
    radiusKm: null,
    lat: null,
    lon: null,
    concurrency: 6,
  };

  for (const arg of args) {
    if (arg.startsWith('--region=')) options.region = arg.split('=')[1];
    else if (arg.startsWith('--minZoom=')) options.minZoom = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--maxZoom=')) options.maxZoom = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--radius=')) options.radiusKm = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--lat=')) options.lat = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--lon=')) options.lon = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) options.concurrency = parseInt(arg.split('=')[1], 10);
  }

  return options;
}

async function main() {
  console.log('========================================================================');
  console.log('🗺️ BỘ TẢI BẢN ĐỒ GOOGLE TERRAIN TIẾNG VIỆT (KHÔNG CỬA HÀNG / POI) - VOMKQ');
  console.log('========================================================================\n');

  const options = parseArgs();

  let regionConfig;
  let bounds;

  if (options.lat !== null && options.lon !== null) {
    regionConfig = {
      name: `Khu vực tuỳ chỉnh (${options.lat.toFixed(3)}, ${options.lon.toFixed(3)})`,
      lat: options.lat,
      lon: options.lon,
      radiusKm: options.radiusKm || 35,
      minZoom: options.minZoom || 8,
      maxZoom: options.maxZoom || 13,
    };
    bounds = getBoundsFromCenter(regionConfig.lat, regionConfig.lon, regionConfig.radiusKm);
  } else {
    const preset = PRESET_REGIONS[options.region] || PRESET_REGIONS.mientrung;
    regionConfig = { ...preset };
    if (options.minZoom !== null) regionConfig.minZoom = options.minZoom;
    if (options.maxZoom !== null) regionConfig.maxZoom = options.maxZoom;
    if (options.radiusKm !== null) regionConfig.radiusKm = options.radiusKm;

    if (preset.bounds || (preset.minLat !== undefined && preset.minLon !== undefined)) {
      bounds = {
        minLat: preset.minLat,
        maxLat: preset.maxLat,
        minLon: preset.minLon,
        maxLon: preset.maxLon,
      };
    } else {
      bounds = getBoundsFromCenter(preset.lat, preset.lon, regionConfig.radiusKm || 35);
    }
  }

  console.log(`📍 Khu vực mục tiêu: ${regionConfig.name}`);
  console.log(`🔍 Mức Zoom: Level ${regionConfig.minZoom} -> Level ${regionConfig.maxZoom}`);

  const tiles = getTilesForBounds(bounds, regionConfig.minZoom, regionConfig.maxZoom);
  console.log(`📦 Tổng số mảnh gạch cần tải: ${tiles.length}`);

  const result = await downloadTileBatch(tiles, options.concurrency);

  // Hàm đếm chính xác số file trên đĩa
  function countFilesRecursive(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) count += countFilesRecursive(p);
      else count++;
    }
    return count;
  }

  // Cập nhật pack-info
  let info = {};
  if (fs.existsSync(INFO_FILE)) {
    try {
      info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
      info = {};
    }
  }

  delete info.topo; // Loại bỏ hoàn toàn topo cũ
  info.lastUpdated = new Date().toISOString();
  const totalOnDisk = countFilesRecursive(OUT_TERRAIN_DIR);
  info.googleTerrain = [
    {
      name: 'Toàn Bộ Duyên Hải Miền Trung & Tây Nguyên',
      bounds,
      zoomLevels: '8-13',
      downloadedAt: new Date().toISOString(),
      tileCount: totalOnDisk,
      localPath: '/offline-terrain-map/{z}/{x}/{y}.png',
    },
  ];

  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  console.log(`\n💾 Đã cập nhật metadata tại public/offline-pack-info.json (Tổng cộng: ${totalOnDisk} tiles)`);
  console.log(`📁 File lưu trữ cục bộ: public/offline-terrain-map/{z}/{x}/{y}.png`);
}

main().catch(console.error);
