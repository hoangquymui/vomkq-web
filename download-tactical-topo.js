import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_TOPO_DIR = path.resolve(__dirname, 'public', 'offline-topo');
const INFO_FILE = path.resolve(__dirname, 'public', 'offline-pack-info.json');

// Toạ độ địa lý các vùng
const REGIONS = {
  mientrung: {
    name: 'Toàn Bộ Miền Trung & Tây Nguyên (Thanh Hóa -> Bình Thuận)',
    minLat: 10.5,
    maxLat: 20.0,
    minLon: 105.0,
    maxLon: 109.5,
    minZoom: 8,
    maxZoom: 13,
  },
  mientrung_core: {
    name: 'Trọng Điểm Miền Trung (Huế - Đà Nẵng - Quảng Nam - Bình Định - Khánh Hòa)',
    minLat: 11.8,
    maxLat: 16.8,
    minLon: 107.3,
    maxLon: 109.5,
    minZoom: 8,
    maxZoom: 13,
  },
  tamdao: {
    name: 'Dãy Núi Tam Đảo & Phụ Cận',
    minLat: 21.15,
    maxLat: 21.75,
    minLon: 105.3,
    maxLon: 106.0,
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

// Tải buffer qua HTTPS có timeout và chuyển hướng
function fetchBuffer(url, timeoutMs = 15000) {
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
  // PNG magic bytes: 0x89 0x50 0x4E 0x47
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  // JPEG magic bytes: 0xFF 0xD8
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpg;
}

// Tải một tile với cơ chế xoay vòng subdomains và fallback
async function fetchTopoTile(z, x, y) {
  const subdomains = ['a', 'b', 'c'];
  const sub = subdomains[(x + y) % subdomains.length];

  // Nguồn 1: OpenTopoMap chuẩn đường đồng mức
  const otmUrl = `https://${sub}.tile.opentopomap.org/${z}/${x}/${y}.png`;
  try {
    const buf = await fetchBuffer(otmUrl);
    if (isValidImage(buf)) return buf;
  } catch {
    // Thử nguồn dự phòng
  }

  // Nguồn 2: ArcGIS World Topo Map (dự phòng đảm bảo không bao giờ lỗi)
  const esriUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
  try {
    const buf = await fetchBuffer(esriUrl);
    if (isValidImage(buf)) return buf;
  } catch {
    // Không tải được
  }

  throw new Error(`Không tải được tile ${z}/${x}/${y} từ cả 2 nguồn`);
}

// Tải song song có kiểm soát tốc độ và retry bền bỉ
async function downloadTopoBatch(tiles, concurrency = 6, delayMs = 25) {
  let completed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const total = tiles.length;
  const startTime = Date.now();

  console.log(`📡 Đang xử lý ${total} mảnh gạch bản đồ Topo độ cao...`);
  console.log(`⚙️ Số luồng đồng thời: ${concurrency} | Nghỉ giữa các request: ${delayMs}ms (đảm bảo không bị nghẽn mạng)\n`);

  async function worker() {
    while (tiles.length > 0) {
      const tile = tiles.shift();
      if (!tile) break;

      const { z, x, y } = tile;
      const outDir = path.join(OUT_TOPO_DIR, String(z), String(x));
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${y}.png`);

      // Kiểm tra nếu đã có sẵn và file hợp lệ
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 100) {
        completed++;
        skippedCount++;
        continue;
      }

      let success = false;
      let retries = 3;

      while (retries > 0 && !success) {
        try {
          const buf = await fetchTopoTile(z, x, y);
          fs.writeFileSync(outFile, buf);
          downloadedCount++;
          success = true;
        } catch {
          retries--;
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }

      if (!success) {
        failedCount++;
      }

      completed++;

      // Khoảng nghỉ nhỏ để tôn trọng rate limit của server
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (completed % 25 === 0 || completed === total) {
        const percent = ((completed / total) * 100).toFixed(1);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = (completed / elapsedSec).toFixed(1);
        const remainingSec = Math.round((total - completed) / (completed / elapsedSec || 1));
        const remMin = Math.floor(remainingSec / 60);
        const remSec = remainingSec % 60;

        process.stdout.write(
          `   ⏳ Tiến trình: ${completed}/${total} (${percent}%) | Tải mới: ${downloadedCount} | Có sẵn: ${skippedCount} | Lỗi: ${failedCount} | ${rate} tile/s | Còn lại: ~${remMin}m${remSec}s\r`
        );
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Hoàn tất tiến trình tải Bản Đồ Topo! (Thời gian: ${totalTimeSec} giây)`);
  console.log(`   - Tổng mảnh kiểm tra: ${total}`);
  console.log(`   - Tải mới thành công: ${downloadedCount} mảnh`);
  console.log(`   - Đã có sẵn trên máy: ${skippedCount} mảnh`);
  console.log(`   - Thất bại: ${failedCount} mảnh`);

  return { total, downloadedCount, skippedCount, failedCount };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    region: 'mientrung',
    minZoom: 8,
    maxZoom: 13,
    concurrency: 6,
    delayMs: 25,
  };

  for (const arg of args) {
    if (arg.startsWith('--region=')) {
      options.region = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--minZoom=')) {
      options.minZoom = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--maxZoom=')) {
      options.maxZoom = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--delay=')) {
      options.delayMs = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

async function main() {
  console.log('========================================================================');
  console.log('🗺️ BỘ TẢI BẢN ĐỒ TOPO ĐỘ CAO NGOẠI TUYẾN (CONTOUR LINES) - VOMKQ GIS');
  console.log('========================================================================\n');

  const options = parseArgs();
  const regionConfig = REGIONS[options.region] || REGIONS.mientrung;

  if (options.minZoom !== undefined) regionConfig.minZoom = options.minZoom;
  if (options.maxZoom !== undefined) regionConfig.maxZoom = options.maxZoom;

  console.log(`📍 Khu vực: ${regionConfig.name}`);
  console.log(`🌐 Phạm vi toạ độ: Vĩ độ [${regionConfig.minLat}, ${regionConfig.maxLat}] | Kinh độ [${regionConfig.minLon}, ${regionConfig.maxLon}]`);
  console.log(`🔍 Mức Zoom: Level ${regionConfig.minZoom} -> Level ${regionConfig.maxZoom}`);

  fs.mkdirSync(OUT_TOPO_DIR, { recursive: true });

  const tiles = getTilesForBounds(regionConfig, regionConfig.minZoom, regionConfig.maxZoom);
  console.log(`📦 Dự kiến tải: ${tiles.length} mảnh gạch bản đồ Topo\n`);

  const result = await downloadTopoBatch(tiles, options.concurrency, options.delayMs);

  // Cập nhật pack info
  let info = {};
  if (fs.existsSync(INFO_FILE)) {
    try {
      info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
      info = {};
    }
  }

  info.lastUpdated = new Date().toISOString();
  info.topo = info.topo || [];
  info.topo.push({
    region: regionConfig.name,
    bounds: {
      minLat: regionConfig.minLat,
      maxLat: regionConfig.maxLat,
      minLon: regionConfig.minLon,
      maxLon: regionConfig.maxLon,
    },
    zoomLevels: `${regionConfig.minZoom}-${regionConfig.maxZoom}`,
    downloadedAt: new Date().toISOString(),
    tileCount: result.total - result.failedCount,
    localPath: '/offline-topo/{z}/{x}/{y}.png',
  });

  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  console.log(`💾 Đã cập nhật thông tin dữ liệu tại public/offline-pack-info.json`);
  console.log('🚀 Bản đồ Topo độ cao ngoại tuyến đã sẵn sàng phục vụ chế độ 2D!');
}

main().catch(console.error);
