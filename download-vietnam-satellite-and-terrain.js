import fs from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Toạ độ vùng lãnh thổ và biển đảo Việt Nam
const VN_BOUNDS = {
  minLon: 101.5,
  maxLon: 118.5,
  minLat: 6.0,
  maxLat: 24.0,
};

// Access Token Cesium Ion của dự án
const CESIUM_ION_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYmIyMWFkMS1lYjc5LTQ0NzMtYThlNS1iNTEzMTA1NTY4MjQiLCJpZCI6NDYwODUzLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODUxMjM1ODN9.gyB0vWTm1yJXS2pCkaVqyLdbg1RxFzjReo7jeDEMmQU';

const OUT_SAT_DIR = path.resolve(__dirname, 'public', 'offline-satellite');
const OUT_TERRAIN_DIR = path.resolve(__dirname, 'public', 'offline-terrain');

// Helper tải file qua HTTPS
function fetchBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchBuffer(res.headers.location, headers).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ buffer: buf, encoding: res.headers['content-encoding'] });
        });
      })
      .on('error', reject);
  });
}

// -------------------------------------------------------------
// PHẦN 1: TÍNH TOÁN & TẢI ẢNH VỆ TINH 2D (ESRI World Imagery)
// -------------------------------------------------------------
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

function getSatelliteTileList(maxZoom = 7) {
  const tiles = [];
  for (let z = 0; z <= maxZoom; z++) {
    if (z === 0) {
      tiles.push({ z: 0, x: 0, y: 0 });
      continue;
    }
    const xMin = Math.max(0, lon2tile(VN_BOUNDS.minLon, z));
    const xMax = Math.min(Math.pow(2, z) - 1, lon2tile(VN_BOUNDS.maxLon, z));
    const yMin = Math.max(0, lat2tile(VN_BOUNDS.maxLat, z));
    const yMax = Math.min(Math.pow(2, z) - 1, lat2tile(VN_BOUNDS.minLat, z));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// -------------------------------------------------------------
// PHẦN 2: TÍNH TOÁN & TẢI ĐỊA HÌNH 3D (Cesium World Terrain)
// -------------------------------------------------------------
// Cesium World Terrain dùng GeographicTilingScheme (WGS84 EPSG:4326):
// Level 0: 2 tiles (0/0/0, 0/1/0)
// Số tile X = 2 * 2^z, Số tile Y = 2^z
function getTerrainTileList(maxZoom = 6) {
  const tiles = [];
  // Gốc level 0 luôn cần cả 2 tile để khởi tạo quadtree toàn cầu
  tiles.push({ z: 0, x: 0, y: 0 });
  tiles.push({ z: 0, x: 1, y: 0 });

  for (let z = 1; z <= maxZoom; z++) {
    const xTiles = 2 * Math.pow(2, z);
    const yTiles = Math.pow(2, z);

    // Root level 1 cần đủ 4 tile
    if (z === 1) {
      for (let x = 0; x < xTiles; x++) {
        for (let y = 0; y < yTiles; y++) {
          tiles.push({ z, x, y });
        }
      }
      continue;
    }

    const xMin = Math.max(0, Math.floor(((VN_BOUNDS.minLon + 180) / 360) * xTiles));
    const xMax = Math.min(xTiles - 1, Math.floor(((VN_BOUNDS.maxLon + 180) / 360) * xTiles));
    const yMin = Math.max(0, Math.floor(((VN_BOUNDS.minLat + 90) / 180) * yTiles));
    const yMax = Math.min(yTiles - 1, Math.floor(((VN_BOUNDS.maxLat + 90) / 180) * yTiles));

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

async function runDownload() {
  console.log('🚀 Bắt đầu quá trình tải Bản Đồ Vệ Tinh 2D & Địa Hình 3D Việt Nam...');

  // 1. Tải 2D SATELLITE (Zoom 0-8)
  const satTiles = getSatelliteTileList(8);
  console.log(`\n📦 1. Tải Bản đồ Vệ tinh 2D (ESRI Satellite): ${satTiles.length} mảnh gạch (Zoom 0-8)`);

  let satSuccess = 0;
  for (let i = 0; i < satTiles.length; i++) {
    const { z, x, y } = satTiles[i];
    const outDir = path.join(OUT_SAT_DIR, String(z), String(x));
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${y}.jpg`);

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 500) {
      satSuccess++;
      continue;
    }

    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    try {
      const res = await fetchBuffer(url);
      fs.writeFileSync(outFile, res.buffer);
      satSuccess++;
      if (satSuccess % 20 === 0 || satSuccess === satTiles.length) {
        process.stdout.write(`   ✓ Đã tải 2D: ${satSuccess}/${satTiles.length} ảnh...\r`);
      }
    } catch (err) {
      console.warn(`   ⚠️ Lỗi tải ảnh vệ tinh ${z}/${x}/${y}:`, err.message);
    }
  }
  console.log(`\n   ✅ Hoàn tất tải ảnh vệ tinh 2D: ${satSuccess}/${satTiles.length} mảnh.`);

  // 2. Lấy thông tin & Endpoint của Cesium World Terrain từ Cesium Ion
  console.log(`\n🏔️ 2. Lấy thông tin Cesium World Terrain (Asset 1)...`);
  const assetEndpointUrl = `https://api.cesium.com/v1/assets/1/endpoint?access_token=${CESIUM_ION_TOKEN}`;
  const assetRes = await fetchBuffer(assetEndpointUrl);
  const assetData = JSON.parse(assetRes.buffer.toString('utf8'));
  const terrainBaseUrl = assetData.url;
  const terrainToken = assetData.accessToken;

  // 3. Tải và cấu hình layer.json offline
  fs.mkdirSync(OUT_TERRAIN_DIR, { recursive: true });
  console.log(`   Tải layer.json từ Cesium Ion...`);
  const layerUrl = `${terrainBaseUrl}layer.json?access_token=${terrainToken}`;
  const layerRes = await fetchBuffer(layerUrl);
  let layerJsonBuf = layerRes.buffer;
  if (layerRes.encoding === 'gzip' || (layerJsonBuf[0] === 0x1f && layerJsonBuf[1] === 0x8b)) {
    layerJsonBuf = zlib.gunzipSync(layerJsonBuf);
  }
  const layerConfig = JSON.parse(layerJsonBuf.toString('utf8'));

  // Sửa lại layer.json để trỏ trực tiếp vào thư mục offline cục bộ
  layerConfig.tiles = ['{z}/{x}/{y}.terrain'];
  layerConfig.minzoom = 0;
  layerConfig.maxzoom = 7;
  fs.writeFileSync(
    path.join(OUT_TERRAIN_DIR, 'layer.json'),
    JSON.stringify(layerConfig, null, 2),
    'utf8'
  );
  console.log(`   ✅ Đã cấu hình layer.json offline thành công.`);

  // 4. Tải các tile địa hình 3D (.terrain) (Level 0-7)
  const terrainTiles = getTerrainTileList(7);
  console.log(`\n📦 3. Tải Địa hình 3D lồi lõm: ${terrainTiles.length} mảnh (Level 0-7)...`);

  let terrainSuccess = 0;
  for (let i = 0; i < terrainTiles.length; i++) {
    const { z, x, y } = terrainTiles[i];
    const outDir = path.join(OUT_TERRAIN_DIR, String(z), String(x));
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${y}.terrain`);

    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 100) {
      terrainSuccess++;
      continue;
    }

    const tileUrl = `${terrainBaseUrl}${z}/${x}/${y}.terrain?v=1.2.0&access_token=${terrainToken}`;
    try {
      const res = await fetchBuffer(tileUrl, {
        Accept: 'application/vnd.quantized-mesh,application/octet-stream;q=0.9',
      });
      let tileBuf = res.buffer;
      // Giải nén nếu server trả về gzip để Cesium đọc mượt trực tiếp
      if (res.encoding === 'gzip' || (tileBuf[0] === 0x1f && tileBuf[1] === 0x8b)) {
        try {
          tileBuf = zlib.gunzipSync(tileBuf);
        } catch {
          // giữ nguyên nếu không phải gzip
        }
      }
      fs.writeFileSync(outFile, tileBuf);
      terrainSuccess++;
      if (terrainSuccess % 15 === 0 || terrainSuccess === terrainTiles.length) {
        process.stdout.write(`   ✓ Đã tải 3D: ${terrainSuccess}/${terrainTiles.length} mảnh địa hình...\r`);
      }
    } catch (err) {
      console.warn(`   ⚠️ Lỗi tải terrain ${z}/${x}/${y}:`, err.message);
    }
  }
  console.log(`\n   ✅ Hoàn tất tải Địa hình 3D: ${terrainSuccess}/${terrainTiles.length} mảnh.`);

  // 5. Ghi file metadata tóm tắt
  const metadata = {
    name: 'Bản đồ Vệ tinh & Địa hình 3D Việt Nam Offline',
    downloadedAt: new Date().toISOString(),
    bounds: VN_BOUNDS,
    satellite: {
      provider: 'ESRI World Imagery',
      zoomLevels: '0-7',
      tileCount: satSuccess,
      format: 'JPEG Slippy Map (XYZ)',
      localPath: '/offline-satellite/{z}/{x}/{y}.jpg'
    },
    terrain: {
      provider: 'Cesium World Terrain (quantized-mesh-1.0)',
      zoomLevels: '0-6',
      tileCount: terrainSuccess,
      format: 'Quantized Mesh 1.0 (uncompressed binary)',
      localPath: '/offline-terrain'
    }
  };
  fs.writeFileSync(
    path.join(__dirname, 'public', 'offline-pack-info.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  console.log('\n🎉 HOÀN THÀNH TẢI TOÀN BỘ BẢN ĐỒ VỆ TINH 2D VÀ ĐỊA HÌNH 3D VIỆT NAM!');
}

runDownload().catch(console.error);
