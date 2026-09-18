import fs from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_TERRAIN_DIR = path.resolve(__dirname, 'public', 'offline-terrain');
const INFO_FILE = path.resolve(__dirname, 'public', 'offline-pack-info.json');

const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYmIyMWFkMS1lYjc5LTQ0NzMtYThlNS1iNTEzMTA1NTY4MjQiLCJpZCI6NDYwODUzLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODUxMjM1ODN9.gyB0vWTm1yJXS2pCkaVqyLdbg1RxFzjReo7jeDEMmQU';

// Các khu vực chiến thuật trọng điểm
const PRESET_REGIONS = {
  mientrung: {
    name: 'Toàn Bộ Miền Trung & Tây Nguyên (Thanh Hóa -> Bình Thuận)',
    bounds: { minLat: 10.5, maxLat: 20.0, minLon: 105.0, maxLon: 109.5 },
    minZoom: 8,
    maxZoom: 13,
  },
  mientrung_core: {
    name: 'Trọng Điểm Miền Trung (Huế - Đà Nẵng - Quảng Nam - Bình Định - Khánh Hòa)',
    bounds: { minLat: 11.8, maxLat: 16.8, minLon: 107.3, maxLon: 109.5 },
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
    radiusKm: 30,
    minZoom: 8,
    maxZoom: 13,
  },
  haiphong: {
    name: 'Khu Vực Duyên Hải Hải Phòng - Cát Bà',
    lat: 20.85,
    lon: 106.68,
    radiusKm: 30,
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
  danang: {
    name: 'Đà Nẵng & Vùng Trời Duyên Hải Miền Trung',
    lat: 16.05,
    lon: 108.20,
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

// Helper tải HTTP/HTTPS
function fetchBuffer(url, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, headers, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          encoding: res.headers['content-encoding'],
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
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

// Lập danh sách tile terrain theo GeographicTilingScheme (WGS84 EPSG:4326 TMS)
function getTerrainTilesForBounds(bounds, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const xTiles = 2 * Math.pow(2, z);
    const yTiles = Math.pow(2, z);

    const xMin = Math.max(0, Math.floor(((bounds.minLon + 180) / 360) * xTiles));
    const xMax = Math.min(xTiles - 1, Math.floor(((bounds.maxLon + 180) / 360) * xTiles));
    const yMin = Math.max(0, Math.floor(((bounds.minLat + 90) / 180) * yTiles));
    const yMax = Math.min(yTiles - 1, Math.floor(((bounds.maxLat + 90) / 180) * yTiles));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// Tải song song theo batch
async function downloadTerrainBatch(tiles, terrainBaseUrl, terrainToken, concurrency = 10) {
  let completed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const total = tiles.length;
  console.log(`🏔️ Bắt đầu tải ${total} mảnh địa hình 3D Quantized-Mesh (Đồng thời: ${concurrency})...\n`);

  async function worker() {
    while (tiles.length > 0) {
      const tile = tiles.shift();
      if (!tile) break;

      const { z, x, y } = tile;
      const outDir = path.join(OUT_TERRAIN_DIR, String(z), String(x));
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${y}.terrain`);

      // Kiểm tra file có sẵn và có dung lượng đủ lớn (đã có vector pháp tuyến normals)
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 15000) {
        completed++;
        skippedCount++;
        continue;
      }

      const tileUrl = `${terrainBaseUrl}${z}/${x}/${y}.terrain?v=1.2.0&access_token=${terrainToken}`;
      let success = false;
      let retries = 2;

      while (retries > 0 && !success) {
        try {
          const res = await fetchBuffer(tileUrl, {
            Accept:
              'application/vnd.quantized-mesh;extensions=octvertexnormals-watermask-metadata,application/octet-stream;q=0.9',
          });

          let tileBuf = res.buffer;
          // Giải nén nếu là gzip để Cesium đọc mượt mà
          if (res.encoding === 'gzip' || (tileBuf[0] === 0x1f && tileBuf[1] === 0x8b)) {
            try {
              tileBuf = zlib.gunzipSync(tileBuf);
            } catch {
              // giữ nguyên
            }
          }

          fs.writeFileSync(outFile, tileBuf);
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
          `   ⏳ Tiến trình: ${completed}/${total} (${percent}%) | Mới: ${downloadedCount} | Có sẵn: ${skippedCount} | Lỗi: ${failedCount}\r`
        );
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log(`\n\n✅ Hoàn tất tải Địa hình 3D!`);
  console.log(`   - Tổng số mảnh: ${total}`);
  console.log(`   - Đã tải mới: ${downloadedCount} mảnh`);
  console.log(`   - Đã có sẵn: ${skippedCount} mảnh`);
  console.log(`   - Thất bại: ${failedCount} mảnh`);

  return { total, downloadedCount, skippedCount, failedCount };
}

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
  console.log('=====================================================================');
  console.log('🏔️ BỘ TẢI ĐỊA HÌNH 3D NÉT CAO (CESIUM WORLD TERRAIN) NGOẠI TUYẾN');
  console.log('=====================================================================\n');

  const options = parseArgs();

  let regionConfig;
  if (options.lat !== null && options.lon !== null) {
    regionConfig = {
      name: `Khu vực tuỳ chỉnh (${options.lat.toFixed(3)}, ${options.lon.toFixed(3)})`,
      lat: options.lat,
      lon: options.lon,
      radiusKm: options.radiusKm || 35,
      minZoom: options.minZoom || 8,
      maxZoom: options.maxZoom || 12,
    };
  } else {
    regionConfig = PRESET_REGIONS[options.region] || PRESET_REGIONS.tamdao;
    if (options.minZoom !== null) regionConfig.minZoom = options.minZoom;
    if (options.maxZoom !== null) regionConfig.maxZoom = options.maxZoom;
    if (options.radiusKm !== null) regionConfig.radiusKm = options.radiusKm;
  }

  console.log(`📍 Khu vực mục tiêu: ${regionConfig.name}`);
  if (regionConfig.bounds) {
    console.log(`🌐 Khung toạ độ: Lat [${regionConfig.bounds.minLat}, ${regionConfig.bounds.maxLat}], Lon [${regionConfig.bounds.minLon}, ${regionConfig.bounds.maxLon}]`);
  } else {
    console.log(`🌐 Toạ độ tâm: Lat ${regionConfig.lat}, Lon ${regionConfig.lon}`);
    console.log(`📏 Bán kính bao phủ: ${regionConfig.radiusKm} km`);
  }
  console.log(`🔍 Mức Zoom: Level ${regionConfig.minZoom} -> Level ${regionConfig.maxZoom}`);

  // 1. Kết nối Cesium Ion lấy endpoint
  console.log(`\n🔑 Đang kết nối Cesium Ion Asset 1 (Cesium World Terrain)...`);
  const assetEndpointUrl = `https://api.cesium.com/v1/assets/1/endpoint?access_token=${CESIUM_ION_TOKEN}`;
  const assetRes = await fetchBuffer(assetEndpointUrl);
  const assetData = JSON.parse(assetRes.buffer.toString('utf8'));
  const terrainBaseUrl = assetData.url;
  const terrainToken = assetData.accessToken;
  console.log(`   ✓ Endpoint URL: ${terrainBaseUrl}`);

  // 2. Tải và cấu hình layer.json offline với maxzoom cao
  console.log(`\n⚙️ Đang đồng bộ cấu hình layer.json cho độ nét cao (Level 0 -> ${regionConfig.maxZoom})...`);
  const layerUrl = `${terrainBaseUrl}layer.json?access_token=${terrainToken}`;
  const layerRes = await fetchBuffer(layerUrl);
  let layerJsonBuf = layerRes.buffer;
  if (layerRes.encoding === 'gzip' || (layerJsonBuf[0] === 0x1f && layerJsonBuf[1] === 0x8b)) {
    layerJsonBuf = zlib.gunzipSync(layerJsonBuf);
  }
  const layerConfig = JSON.parse(layerJsonBuf.toString('utf8'));

  layerConfig.tiles = ['{z}/{x}/{y}.terrain'];
  layerConfig.minzoom = 0;
  // Đặt maxzoom theo mức tải cao nhất (tối thiểu 13 - độ nét cực hạn)
  layerConfig.maxzoom = Math.max(13, regionConfig.maxZoom);
  layerConfig.extensions = ['octvertexnormals', 'watermask', 'metadata'];

  // Cắt mảng available đúng bằng maxzoom + 1
  if (Array.isArray(layerConfig.available)) {
    layerConfig.available = layerConfig.available.slice(0, layerConfig.maxzoom + 1);
  }

  fs.mkdirSync(OUT_TERRAIN_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_TERRAIN_DIR, 'layer.json'),
    JSON.stringify(layerConfig, null, 2),
    'utf8'
  );
  console.log(`   ✓ Đã cập nhật public/offline-terrain/layer.json (maxzoom: ${layerConfig.maxzoom})`);

  // 3. Lập danh sách tile terrain và tải
  const bounds = regionConfig.bounds
    ? regionConfig.bounds
    : getBoundsFromCenter(regionConfig.lat, regionConfig.lon, regionConfig.radiusKm);
  const tiles = getTerrainTilesForBounds(bounds, regionConfig.minZoom, regionConfig.maxZoom);
  console.log(`📦 Dự kiến tải: ${tiles.length} mảnh địa hình 3D\n`);

  const result = await downloadTerrainBatch(tiles, terrainBaseUrl, terrainToken, options.concurrency);

  // 4. Cập nhật offline-pack-info.json
  let info = {};
  if (fs.existsSync(INFO_FILE)) {
    try {
      info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
      info = {};
    }
  }

  info.lastUpdated = new Date().toISOString();
  info.highResTerrain = info.highResTerrain || [];
  info.highResTerrain.push({
    name: regionConfig.name,
    lat: regionConfig.lat,
    lon: regionConfig.lon,
    radiusKm: regionConfig.radiusKm,
    zoomLevels: `${regionConfig.minZoom}-${regionConfig.maxZoom}`,
    downloadedAt: new Date().toISOString(),
    tileCount: result.total - result.failedCount,
  });

  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  console.log(`💾 Đã cập nhật thông tin dữ liệu tại public/offline-pack-info.json`);
  console.log('🚀 Địa hình 3D lồi lõm cực nét (như online) đã sẵn sàng hoạt động ngoại tuyến!');
}

main().catch(console.error);
