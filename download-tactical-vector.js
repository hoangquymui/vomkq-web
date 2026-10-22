/**
 * BỘ TẢI DỮ LIỆU VECTƠ OFFLINE (OSM -> GeoJSON) CHO VOMKQ 3D GIS
 * ===============================================================
 *
 * MỤC ĐÍCH
 *   Bản đồ raster (public/offline-satellite/*.jpg) chỉ là "cái miếng dán": máy không
 *   biết pixel nào là nhà, pixel nào là sông. Script này tải lớp dữ liệu thứ hai -
 *   dữ liệu vector có nhãn (nhà, sông, suối, núi, đường, rừng, loại đất, địa danh) -
 *   để hệ thống có thể trả lời: "trong tầm phủ của khí tài này có bao nhiêu nhà,
 *   sông cách bao xa, đỉnh núi gần nhất ở đâu và cao bao nhiêu".
 *
 * NGUỒN DỮ LIỆU
 *   Overpass API (mặc định https://overpass-api.de/api/interpreter), dựa trên
 *   OpenStreetMap. Miễn phí, không cần API key.
 *   Đổi endpoint bằng biến môi trường OVERPASS_URL.
 *
 * CÁCH DÙNG
 *   node download-tactical-vector.js --region=tamdao
 *   node download-tactical-vector.js --region=tamdao --radiusKm=50
 *   node download-tactical-vector.js --lat=16.05 --lon=108.20 --radiusKm=35
 *   node download-tactical-vector.js --region=binhdinh --kinds=building,water_river,peak
 *   node download-tactical-vector.js --region=tamdao --force
 *   node download-tactical-vector.js --list
 *
 * KẾT QUẢ
 *   public/offline-vector/{region}.geojson  - GeoJSON chuẩn, mụi feature có properties.kind
 *   public/offline-pack-info.json            - được cập nhật thêm mục "vector"
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_VECTOR_DIR = path.resolve(__dirname, 'public', 'offline-vector');
const INFO_FILE = path.resolve(__dirname, 'public', 'offline-pack-info.json');

/** Bán kính Trái Đất dùng cho mọi phép tính cự ly (km) */
const EARTH_RADIUS_KM = 6371.0;

/** Endpoint Overpass chính + các mirror dự phòng (xoay vòng khi lỗi/rate-limit) */
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * CÁC KHU VỰC TẢI MẶC ĐỊNH
 *
 * Tâm/bán kính cố tình KHỚP với `PRESET_REGIONS` trong `download-tactical-map.js`
 * để dữ liệu vectơ phủ đúng vùng đã có sẵn ảnh vệ tinh + địa hình.
 *
 * VÌ SAO MỖI TỈNH LÀ MỘT VÙNG RIÊNG THAY VÌ MỘT VÙNG "MIỀN TRUNG" KHỔNG LỒ
 *   Dải Hà Tĩnh → Lâm Đồng trải dài ~690 km. Gộp làm một sẽ tạo ra gói nhiều GB và
 *   mỗi request Overpass đều phải chờ hàng chút. Chia theo tỉnh giúp:
 *     - tải được dần (tỉnh nào xong thì dùng tỉnh đó), không mất trắng khi 504 giữa chừng;
 *     - bỏ được tỉnh không cần mà không ảnh hưởng tỉnh khác;
 *     - mỗi gói vừa phải, tải trong vài phút.
 */
const PRESET_REGIONS = {
  // --- Miền Trung: dải Hà Tĩnh -> Lâm Đồng ---
  hatinh: { name: 'Hà Tĩnh & Vùng ven biển phía Bắc', lat: 18.11, lon: 105.71, radiusKm: 55 },
  quangbinh: { name: 'Quảng Bình - Đồng Hới & Phong Nha - Kẻ Bàng', lat: 17.47, lon: 106.78, radiusKm: 55 },
  hue: { name: 'Huế - Phú Bài & Vùng lõi di sản', lat: 16.05, lon: 107.57, radiusKm: 55 },
  danang: { name: 'Đà Nẵng & Vùng Trời Duyên Hải Miền Trung', lat: 16.05, lon: 108.2, radiusKm: 40 },
  quangngai: { name: 'Quảng Ngãi - Kon Tum lộ', lat: 15.55, lon: 108.22, radiusKm: 55 },
  binhdinh: { name: 'Tây Sơn - Đèo An Khê - Quy Nhơn', lat: 13.9, lon: 109.2, radiusKm: 55 },
  gialai: { name: 'Gia Lai - Pleiku & Cao Nguyên', lat: 13.98, lon: 108.02, radiusKm: 55 },
  daklak: { name: 'Đắk Lắk - Buôn Ma Thuột', lat: 12.71, lon: 108.24, radiusKm: 55 },
  lamdong: { name: 'Lâm Đồng - Đà Lạt & Cao Nguyên', lat: 11.95, lon: 108.46, radiusKm: 60 },

  // --- Miền Bắc ---
  tamdao: { name: 'Dãy Núi Tam Đảo & Phụ Cận (Vĩnh Phúc - Thái Nguyên - Tuyên Quang)', lat: 21.45, lon: 105.65, radiusKm: 35 },
  hanoi: { name: 'Thủ Đô Hà Nội & Vành Đai Phòng Không', lat: 21.03, lon: 105.85, radiusKm: 30 },
  haiphong: { name: 'Khu Vực Duyên Hải Hải Phòng - Cát Bà', lat: 20.85, lon: 106.68, radiusKm: 30 },

  // --- Miền Nam ---
  khanhhoa: { name: 'Khánh Hoà - Nha Trang & Vịnh Cam Ranh', lat: 12.24, lon: 109.2, radiusKm: 55 },
  tphcm: { name: 'TP. Hồ Chí Minh & Vùng Phòng Không Phía Nam', lat: 10.82, lon: 106.63, radiusKm: 35 },
};

/**
 * NHÓM VÙNG: gom nhiều preset thành một lệnh tải.
 *
 * Dùng khi muốn phủ cả một dải lãnh thổ thay vì từng tỉnh. Script tải LƯUỢI và
 * bỏ qua vùng đã có file, nên chạy lại sau khi một tỉnh bị 504 chỉ tải tiếp từ chỗ
 * dừng chứ không tải lại từ đầu.
 */
const REGION_GROUPS = {
  /** Dải Miền Trung từ Hà Tĩnh (18.1°N) xuống Lâm Đồng (11.95°N) - trải ~690 km. */
  mientrung: [
    'hatinh',
    'quangbinh',
    'hue',
    'danang',
    'quangngai',
    'binhdinh',
    'gialai',
    'daklak',
    'lamdong',
  ],
};

/**
 * DANH MỤC 10 LOẠI ĐỐI TƯỢNG VECTƠ (kind -> metadata)
 * `kind` là hợp đồng dữ liệu ổn định - frontend sẽ phụ thuộc vào các chuỗi này.
 */
const FEATURE_KINDS = {
  building: { labelVi: 'Nhà / công trình xây dựng', geometry: 'area' },
  water_river: { labelVi: 'Sông / kênh lớn', geometry: 'line' },
  water_stream: { labelVi: 'Suối / kênh nhỏ', geometry: 'line' },
  water_body: { labelVi: 'Hồ / đầm lầm (mặt nước kín)', geometry: 'area' },
  peak: { labelVi: 'Đỉnh núi', geometry: 'point' },
  ridge: { labelVi: 'Sườn núi / lưng núi', geometry: 'line' },
  highway: { labelVi: 'Đường giao thông', geometry: 'line' },
  forest: { labelVi: 'Rừng / cây lâu năm', geometry: 'area' },
  land: { labelVi: 'Loại đất sử dụng', geometry: 'area' },
  place: { labelVi: 'Địa danh (làng/xã/thị trấn)', geometry: 'point' },
};

const DEFAULT_KINDS = Object.keys(FEATURE_KINDS);

/** Các tag highway quá nhỏ/sao cho nhiều -> loại bớt để giữ file gọn */
const HIGHWAY_EXCLUDE = new Set([
  'footway',
  'path',
  'cycleway',
  'steps',
  'track',
  'bridleway',
  'corridor',
  'platform',
]);

/** Tag này khiến một way là VÙNG (polygon) thay vì ĐƯỜNG (line) */
const AREA_NATURAL = new Set(['water', 'wood', 'scrub', 'wetland', 'sand', 'beach', 'grassland']);

/** Tag landuse này khiến một way là VÙNG (polygon) */
const AREA_LANDUSE = new Set([
  'forest',
  'orchard',
  'residential',
  'farmland',
  'meadow',
  'grass',
  'farmyard',
  'industrial',
  'commercial',
  'retail',
  'quarry',
  'construction',
  'allotments',
  'cemetery',
  'village_green',
]);

/**
 * QUY TẮC PHÂN LOẠI - thứ tự ưu tiên cao -> thấp, khớp đầu tiên thắng.
 * Mỗi quy tắc: { kind, test(tags) }
 */
const KIND_RULES = [
  { kind: 'building', test: (t) => t.building !== undefined },
  { kind: 'water_river', test: (t) => ['river', 'riverbank', 'canal'].includes(t.waterway) },
  { kind: 'water_stream', test: (t) => ['stream', 'ditch'].includes(t.waterway) },
  { kind: 'water_body', test: (t) => t.natural === 'water' },
  { kind: 'peak', test: (t) => ['peak', 'volcano'].includes(t.natural) },
  { kind: 'ridge', test: (t) => ['ridge', 'arete'].includes(t.natural) },
  { kind: 'forest', test: (t) => t.landuse === 'forest' || t.landuse === 'orchard' || t.natural === 'wood' },
  { kind: 'land', test: (t) => t.landuse !== undefined && AREA_LANDUSE.has(t.landuse) },
  { kind: 'place', test: (t) => t.place !== undefined },
  {
    kind: 'highway',
    test: (t) => t.highway !== undefined && !HIGHWAY_EXCLUDE.has(t.highway),
  },
];

/** Phân loại 1 element Overpass -> kind, hoặc null nếu không thuộc loại nào cần lấy */
function classify(tags) {
  if (!tags) return null;
  for (const rule of KIND_RULES) {
    if (rule.test(tags)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TIỆN ÍCH TOẠ ĐỘ
// ---------------------------------------------------------------------------

/** Bounding box (WGS-84) từ tâm + bán kính km */
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

/** Cự ly Haversine giữa 2 điểm (km) */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Thu nhỏ bbox về gần tâm theo tỷ lệ (dùng để lấy lề cho vòng tròn khí tài) */
function insetBounds(bounds, factor) {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;
  const halfLat = ((bounds.maxLat - bounds.minLat) / 2) * factor;
  const halfLon = ((bounds.maxLon - bounds.minLon) / 2) * factor;
  return {
    minLat: centerLat - halfLat,
    maxLat: centerLat + halfLat,
    minLon: centerLon - halfLon,
    maxLon: centerLon + halfLon,
  };
}

/** Chia bbox thành lưới ô vuông cạnh `chunkDeg` để tránh làm quá tải Overpass */
function splitBounds(bounds, chunkDeg) {
  const chunks = [];
  const latSpan = bounds.maxLat - bounds.minLat;
  const lonSpan = bounds.maxLon - bounds.minLon;
  const rows = Math.max(1, Math.ceil(latSpan / chunkDeg));
  const cols = Math.max(1, Math.ceil(lonSpan / chunkDeg));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      chunks.push({
        minLat: bounds.minLat + r * chunkDeg,
        maxLat: Math.min(bounds.maxLat, bounds.minLat + (r + 1) * chunkDeg),
        minLon: bounds.minLon + c * chunkDeg,
        maxLon: Math.min(bounds.maxLon, bounds.minLon + (c + 1) * chunkDeg),
        row: r,
        col: c,
      });
    }
  }
  return chunks;
}

/** Ô vuông này có giao với hình tròn bán kính radiusKm quanh tâm không? */
function chunkIntersectsCircle(chunk, center) {
  // Gần đúng nhưng đủ dùng: khoảng cách từ tâm tới góc gần nhất của ô
  const nearLat = Math.max(chunk.minLat, Math.min(center.lat, chunk.maxLat));
  const nearLon = Math.max(chunk.minLon, Math.min(center.lon, chunk.maxLon));
  return haversineKm(center.lat, center.lon, nearLat, nearLon) <= center.radiusKm;
}

// ---------------------------------------------------------------------------
// OVERPASS
// ---------------------------------------------------------------------------

/**
 * Dựng query Overpass cho 1 chunk bbox (south,west,north,east)
 *
 * LƯU Ý HIỆU NĂNG: phải lọc NGAY TRONG Overpass QL bằng regex tag, KHÔNG query
 * toàn bộ rồi lọc ở JS. Query `way["natural"](bbox)` không có regex sẽ trả về hàng
 * chục nghìn way (đặc biệt vùng rừng Tây Nguyên) kèm geometry đầy đủ -> vượt
 * giới hạn bộ nhớ của Overpass và bị trả HTTP 504.
 * Các regex bên dưới phải khớp với KIND_RULES để không bỏ sót hay thừa dữ liệu.
 */
function buildOverpassQuery(bounds, wantedKinds) {
  const s = bounds.minLat.toFixed(6);
  const w = bounds.minLon.toFixed(6);
  const n = bounds.maxLat.toFixed(6);
  const e = bounds.maxLon.toFixed(6);
  const box = `${s},${w},${n},${e}`;

  // Mỗi câu lệnh Overpass được gắn nhãn `kind` để `--kinds` cắt được những câu
  // không cần. KHÔNG chỉ để tối ưu tốc độ: `way["building"]` trên ô 0.3° ở Quảng
  // Ngãi trả về hàng chục nghìn element, còn `node["natural"~"^(peak|volcano)$"]`
  // trên cùng ô chỉ vài chục. Lọc ngay tại Overpass giúp một lần bù dữ liệu point
  // chạy xong trong vài phút thay vì vài giờ, và tránh 504 do response quá nặng.
  const statements = [
    { kind: 'building', q: `way["building"](${box});` },
    { kind: 'water_river', q: `way["waterway"~"^(river|riverbank|canal)$"](${box});` },
    { kind: 'water_stream', q: `way["waterway"~"^(stream|ditch)$"](${box});` },
    { kind: 'water_body', q: `way["natural"="water"](${box});` },
    { kind: 'forest', q: `way["landuse"~"^(forest|orchard)$"](${box});` },
    { kind: 'forest', q: `way["natural"="wood"](${box});` },
    {
      kind: 'land',
      q: `way["landuse"~"^(residential|farmland|meadow|grass|farmyard|industrial|commercial|retail|quarry|construction|allotments|cemetery|village_green)$"](${box});`,
    },
    {
      kind: 'highway',
      q: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${box});`,
    },
    { kind: 'ridge', q: `way["natural"~"^(ridge|arete)$"](${box});` },
    { kind: 'peak', q: `node["natural"~"^(peak|volcano)$"](${box});` },
    {
      kind: 'place',
      q: `node["place"~"^(village|hamlet|town|city|suburb|neighbourhood|locality|island|district|county|state)$"](${box});`,
    },
  ];

  const active = wantedKinds
    ? statements.filter((statement) => wantedKinds.has(statement.kind))
    : statements;

  return ['[out:json][timeout:120];(', ...active.map((item) => item.q), ');out body geom;'].join(
    '\n'
  );
}

/** Gửi POST tới Overpass, nhận về Buffer (có timeout + redirect) */
function postOverpass(endpoint, query, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const body = Buffer.from(`data=${encodeURIComponent(query)}`, 'utf8');
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'VomKQ-Vector/1.0 (offline tactical vector downloader)',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': body.length,
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return postOverpass(res.headers.location, query, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
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
    req.write(body);
    req.end();
  });
}

/**
 * Gửi 1 query, thử lần lượt các endpoint (xoay vòng) với backoff.
 * Overpass hay trả 429 (rate limit) hoặc 504 (quá tải) nên cần retry thay vì bỏ cuộc.
 */
async function queryOverpass(query, attempts = 8) {
  const endpoints = [OVERPASS_URL, ...OVERPASS_MIRRORS];
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const endpoint = endpoints[attempt % endpoints.length];
    try {
      const buffer = await postOverpass(endpoint, query);
      const json = JSON.parse(buffer.toString('utf8'));
      if (!json || !Array.isArray(json.elements)) {
        throw new Error('Phản hồi Overpass thiếu trường elements');
      }
      return json.elements;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        // Backoff tăng dần. 504 từ Overpass thường là quá tải tạm thời, nghỉ
        // thêm giúp request sau có cơ hội thành công hơn là retry liên tục.
        const waitMs = 1500 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError || new Error('Overpass thất bại không rõ lý do');
}

// ---------------------------------------------------------------------------
// CHUYỂN OVERPASS -> GEOJSON
// ---------------------------------------------------------------------------

/** Ring đã khép kín chưa? (điểm đầu khác điểm cuối) */
function isClosedRing(coords) {
  if (coords.length < 4) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/** Đóng vòng polygon (thêm điểm đầu = điểm cuối) */
function closeRing(coords) {
  if (coords.length === 0) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
}

/**
 * Làm tròn toạ độ trước khi ghi ra đĩa.
 *
 * 5 chữ số thập phân = sai số tối đa ~1.1 m. Đây là đánh đổi có chủ đích: bài toán phủ
 * sóng làm việc ở thang km, nên 1 m là vô nghĩa - nhưng với 165 000 feature, mỗi chữ số
 * thập phân thừa lặp lại ~2 lần (cho lon và lat) trên mỗi điểm, nên giảm từ 6 xuống 5
 * tiết kiệm ~15% dung lượng mà không ảnh hưởng bất kỳ kết luận nào.
 */
function round6(value) {
  return Number(value.toFixed(5));
}

/** 1 điểm có nằm trong bán kính tâm vùng không? */
function isWithinRadius(lat, lon, center) {
  return haversineKm(center.lat, center.lon, lat, lon) <= center.radiusKm;
}

/** Gom các tag OSM quan trọng vào properties (bỏ tag rác, giữ file gọn) */
function buildProperties(kind, tags) {
  const num = (value) => {
    if (value === undefined) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const int = (value) => {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const props = {
    kind,
    name: tags.name || tags['name:vi'] || undefined,
    nameVi: tags['name:vi'] || tags.name || undefined,
    building: tags.building || undefined,
    buildingLevels: int(tags['building:levels']),
    heightM: num(tags.height) || num(tags['building:height']) || undefined,
    waterway: tags.waterway || undefined,
    natural: tags.natural || undefined,
    landuse: tags.landuse || undefined,
    highway: tags.highway || undefined,
    place: tags.place || undefined,
    surface: tags.surface || undefined,
    ele: num(tags.ele),
    layer: int(tags.layer),
  };

  // Bỏ key rỗng để GeoJSON nhẹ hơn nhiều
  const clean = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined && value !== null && value !== '') clean[key] = value;
  }
  return clean;
}

/**
 * Chuyển 1 element Overpass (`out body geom`) thành GeoJSON Feature.
 * Trả về null nếu element không dùng được (thiếu geometry, quá ngắn, ngoài bán kính).
 */
function elementToFeature(element, center) {
  const tags = element.tags || {};
  const rule = classify(tags);
  if (!rule) return null;
  const kind = rule.kind;

  // --- Node -> Point ---
  //
  // QUAN TRỌNG: Overpass KHÔNG gắn mảng `geometry` cho node kể cả khi query
  // dùng `out body geom` — node chỉ có `lat`/`lon` ở cấp gốc. Chỉ way/relation
  // mới có `geometry`. Trước đây code đọc `element.geometry[0]` cho mọi loại,
  // nên mọi đối tượng point (đỉnh núi, địa danh) bị hủy âm thầm — biểu hiện
  // là `peak: 0` trong mọi gói dù OSM có hàng trăm đỉnh. Đã kiểm chứng bằng
  // docs/probe-node-geom.mjs.
  if (element.type === 'node') {
    const { lat, lon } = element;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!isWithinRadius(lat, lon, center)) return null;

    return {
      type: 'Feature',
      id: `${kind}:node/${element.id}`,
      geometry: { type: 'Point', coordinates: [round6(lon), round6(lat)] },
      properties: buildProperties(kind, tags),
    };
  }

  // --- Way -> LineString hoặc Polygon ---
  const geometry = Array.isArray(element.geometry) ? element.geometry : null;
  if (!geometry || geometry.length === 0) return null;

  const points = geometry.filter(
    (n) => n && typeof n.lat === 'number' && typeof n.lon === 'number'
  );
  if (points.length < 2) return null;

  // Bỏ way nằm quá xa (nằm ở góc ô vuông xa tâm)
  if (!isWithinRadius(points[0].lat, points[0].lon, center)) return null;

  const lonLatPairs = points.map((p) => [round6(p.lon), round6(p.lat)]);
  const wantsArea =
    tags.building !== undefined ||
    (tags.landuse !== undefined && AREA_LANDUSE.has(tags.landuse)) ||
    (tags.natural !== undefined && AREA_NATURAL.has(tags.natural));

  if (wantsArea || isClosedRing(lonLatPairs)) {
    const ring = closeRing(lonLatPairs);
    if (ring.length < 4) return null;
    return {
      type: 'Feature',
      id: `${kind}:way/${element.id}`,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: buildProperties(kind, tags),
    };
  }

  return {
    type: 'Feature',
    id: `${kind}:way/${element.id}`,
    geometry: { type: 'LineString', coordinates: lonLatPairs },
    properties: buildProperties(kind, tags),
  };
}

// ---------------------------------------------------------------------------
// RÚT GỌN (DOUGLAS-PEUCKER)
// ---------------------------------------------------------------------------

/** Bình phương khoảng cách từ điểm tới đoạn thẳng, trên mặt phẳng lon/lat */
function perpendicularDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Rút gọn polyline bằng Douglas-Peucker (đệ quy có stack, tránh tràn call stack
 * với way dài như sông/đường có hàng nghìn điểm).
 * toleranceDeg: sai số cho phép (độ). 0.0002 ~ 22 m - giữ được hình dạng sông/suốai.
 */
function simplifyLine(coords, toleranceDeg) {
  if (coords.length <= 2 || toleranceDeg <= 0) return coords;

  const toleranceSq = toleranceDeg * toleranceDeg;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;

    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistanceSq(
        coords[i][0],
        coords[i][1],
        coords[start][0],
        coords[start][1],
        coords[end][0],
        coords[end][1]
      );
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > toleranceSq && maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  const out = [];
  for (let i = 0; i < coords.length; i++) {
    if (keep[i]) out.push(coords[i]);
  }
  return out;
}

/** Rút gọn 1 feature (chỉ LineString/Polygon) */
function simplifyFeature(feature, toleranceDeg) {
  if (toleranceDeg <= 0) return feature;
  const g = feature.geometry;
  if (g.type === 'LineString') {
    return {
      ...feature,
      geometry: { ...g, coordinates: simplifyLine(g.coordinates, toleranceDeg) },
    };
  }
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map((ring) => simplifyLine(ring, toleranceDeg));
    // Vòng rút gọn còn dưới 4 điểm là vô nghĩa -> giữ nguyên
    if (rings.some((ring) => ring.length < 4)) return feature;
    return { ...feature, geometry: { ...g, coordinates: rings } };
  }
  return feature;
}

// ---------------------------------------------------------------------------
// THỐNG KÊ
// ---------------------------------------------------------------------------

/** Đếm số feature theo từng kind */
function countByKind(features) {
  const counts = {};
  for (const key of DEFAULT_KINDS) counts[key] =0;
  for (const feature of features) {
    const kind = feature.properties.kind;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}
/** Lấy cặp [lon, lat] đầu tiên của feature, dùng để xác định nó thuộc ô lưới nào. */
function firstCoordOf(feature) {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let first = coords;
  while (Array.isArray(first) && Array.isArray(first[0])) first = first[0];
  return Array.isArray(first) && first.length >= 2 && Number.isFinite(first[0]) && Number.isFinite(first[1])
    ? [first[0], first[1]] : null;
}

/** True bounds allow ROI readers to find geometry crossing a cell's anchor coordinate. */
export function vectorFeatureBounds(features) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return;
      west = Math.min(west, coords[0]); south = Math.min(south, coords[1]);
      east = Math.max(east, coords[0]); north = Math.max(north, coords[1]);
    } else for (const child of coords) visit(child);
  };
  for (const feature of features) visit(feature.geometry?.coordinates);
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** Record real request provenance; old cached arrays carry unknown status, even if empty. */
export function vectorCoverageRecord(chunk, kinds, { elements, provenance, error } = {}) {
  const bbox = [chunk.minLon, chunk.minLat, chunk.maxLon, chunk.maxLat].map((value) => Number(value.toFixed(6)));
  return {
    id: `${chunk.row}_${chunk.col}`, bbox, kinds: [...kinds].sort(),
    status: error ? 'failed' : provenance ? (elements?.length ? 'success' : 'empty') : 'unknown',
    queriedAt: provenance?.queriedAt ?? null,
    queryHash: provenance?.queryHash ?? null,
    elementCount: Array.isArray(elements) ? elements.length : null,
    ...(error ? { error: String(error.message ?? error) } : {}),
  };
}
// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
/** Phân tích tham số dòng lệnh */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    region: 'tamdao',
    lat: null,
    lon: null,
    radiusKm: null,
    chunkDeg: 0.15,
    simplifyDeg: 0.0002,
    concurrency: 2,
    force: false,
    list: false,
    kinds: null,
    suffix: '',
  };

  for (const arg of args) {
    if (arg.startsWith('--region=')) options.region = arg.slice(9).toLowerCase();
    else if (arg.startsWith('--lat=')) options.lat = Number.parseFloat(arg.slice(6));
    else if (arg.startsWith('--lon=')) options.lon = Number.parseFloat(arg.slice(6));
    else if (arg.startsWith('--radiusKm=')) options.radiusKm = Number.parseFloat(arg.slice(11));
    else if (arg.startsWith('--chunkDeg=')) options.chunkDeg = Number.parseFloat(arg.slice(11));
    else if (arg.startsWith('--simplifyDeg=')) options.simplifyDeg = Number.parseFloat(arg.slice(14));
    else if (arg.startsWith('--concurrency=')) options.concurrency = Number.parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--kinds=')) options.kinds = arg.slice(8).split(',').map((s) => s.trim());
    else if (arg.startsWith('--suffix=')) options.suffix = arg.slice(9).replace(/[^\w.-]/g, '');
    else if (arg === '--force') options.force = true;
    else if (arg === '--list') options.list = true;
  }

  return options;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs();

  if (options.list) {
    console.log('Các vùng tải sẵn:');
    for (const [key, value] of Object.entries(PRESET_REGIONS)) {
      console.log(
        `  ${key.padEnd(12)} ${value.name}  (${value.lat}, ${value.lon}, r=${value.radiusKm} km)`
      );
    }
    console.log('\nCác nhóm vùng (tải tuần tự từng vùng trong nhóm):');
    for (const [name, keys] of Object.entries(REGION_GROUPS)) {
      console.log(`  ${name}: ${keys.join(', ')}`);
    }
    console.log('\nCác loại đối tượng:');
    for (const [key, value] of Object.entries(FEATURE_KINDS)) {
      console.log(`  ${key.padEnd(13)} ${value.labelVi}  (${value.geometry})`);
    }
    return;
  }

  // --- Xác định danh sách vùng cần tải ---
  // Nếu --region trỏ tới một NHÓM (REGION_GROUPS) thì tải lần lượt từng vùng trong nhóm.
  // Tải tuần tự chứ không song song: Overpass chỉ chịu được vài request đồng thời, và
  // chạy 9 tỉnh cùng lúc sẽ làm tất cả đều 504.
  const group = REGION_GROUPS[options.region];
  const regionKeys = group ? group : [options.region];

  console.log('===============================================================');
  console.log('BỘ TẢI DỮ LIỆU VECTƠ OFFLINE (OSM) - VOMKQ 3D GIS');
  console.log('===============================================================\n');

  if (group) {
    console.log(`Tải nhóm "${options.region}" gồm ${regionKeys.length} vùng:`);
    for (const key of regionKeys) {
      const preset = PRESET_REGIONS[key];
      if (preset) {
        console.log(`   - ${preset.name} (${preset.lat}, ${preset.lon}, r=${preset.radiusKm} km)`);
      }
    }
    console.log('');
  }

  // Tải tuần tự từng vùng: một vùng lỗi không được làm hỏng cả nhóm.
  const summary = [];
  for (let i = 0; i < regionKeys.length; i++) {
    const key = regionKeys[i];
    // Vùng tuỳ chỉnh (--lat/--lon) không có trong PRESET_REGIONS, hàm tải tự dựng.
    const isCustom = Number.isFinite(options.lat) && Number.isFinite(options.lon);
    if (!PRESET_REGIONS[key] && !isCustom) {
      console.warn(`\nBỏ qua "${key}": không có trong PRESET_REGIONS.`);
      continue;
    }
    if (group) {
      console.log(`\n${'='.repeat(64)}`);
      console.log(`[${i + 1}/${regionKeys.length}] ${PRESET_REGIONS[key].name}`);
      console.log('='.repeat(64));
    }
    try {
      const result = await downloadSingleRegion(key, options);
      if (result) summary.push({ key, ...result });
    } catch (error) {
      console.error(`\nVùng "${key}" thất bại: ${error.message}`);
      summary.push({ key, failed: true, error: error.message });
    }
  }

  if (summary.length === 0) {
    throw new Error('Không tải được vùng nào.');
  }

  // --- Báo cáo tổng ---
  console.log(`\n${'='.repeat(64)}`);
  console.log('TỔNG KẾT');
  console.log('='.repeat(64));

  let totalFeatures = 0;
  let okCount = 0;
  for (const item of summary) {
    if (item.failed) {
      console.log(`   ${item.key.padEnd(14)} LỖI: ${item.error}`);
      continue;
    }
    okCount++;
    totalFeatures += item.featureCount;
    console.log(
      `   ${item.key.padEnd(14)} ${String(item.featureCount).padStart(7)} feature  ${item.sizeMb} MB`
    );
  }

  console.log(`\nThành công ${okCount}/${summary.length} vùng, tổng ${totalFeatures} feature.`);
  console.log('Đã cập nhật public/offline-pack-info.json.');
  if (okCount < summary.length) {
    console.warn(
      '\nMột số vùng bị lỗi (thường do Overpass quá tải 504). Chạy LẠI cùng lệnh này - ' +
        'script tự bỏ qua vùng đã tải thành công nên chỉ tải tiếp phần còn thiếu.'
    );
  }
}

/**
 * Tải MỘT vùng và ghi gói. Trả về tóm tắt để `main()` tổng hợp, hoặc null nếu đã có sẵn.
 */
async function downloadSingleRegion(regionKey, options) {
  // Vùng tuỳ chỉnh (--lat/--lon) không nằm trong PRESET_REGIONS nên tự dựng ở đây.
  const isCustom = Number.isFinite(options.lat) && Number.isFinite(options.lon);
  if (isCustom) {
    regionKey = `custom-${options.lat.toFixed(3)}_${options.lon.toFixed(3)}`;
  }

  const preset = isCustom
    ? {
        name: `Khu vực tuỳ chỉnh (${options.lat.toFixed(3)}, ${options.lon.toFixed(3)})`,
        lat: options.lat,
        lon: options.lon,
        radiusKm: options.radiusKm || 30,
      }
    : PRESET_REGIONS[regionKey];

  if (!preset) {
    throw new Error(
      `Không có vùng "${regionKey}". Chạy với --list để xem danh sách vùng hợp lệ.`
    );
  }

  const regionConfig = { ...preset };
  if (Number.isFinite(options.radiusKm)) regionConfig.radiusKm = options.radiusKm;

  const key = regionKey;
  // `--suffix` tách gói phụ (ví dụ chỉ peak/ridge/place) ra khỏi gói chính, để có
  // thể bù một phần dữ liệu mà không ghi đè kết quả tải đầy đủ đã có.
  const keySlug = options.suffix ? `${key}__${options.suffix}` : key;
  const outFile = path.join(OUT_VECTOR_DIR, `${keySlug}.geojson`);

  // --- Bỏ qua nếu đã tải ---
  //
  // CHỈ bỏ qua khi cache ô đầy đủ. Nếu lần trước tải thiếu ô (Overpass 504 giữa
  // chừng) mà đã ghi file, lần sau sẽ âm thầm giữ nguyên gói thiếu — đúng kiểu
  // "báo xong" nhưng dữ liệu không đủ. Số ô cần biết chỉ có được sau bước chia ô
  // nên phần kiểm tra này chuyển xuống dưới, ngay sau khi dựng `chunks`.
  // Cache cũng tách theo suffix: cache của gói chính và của gói phụ là hai bộ
  // element khác nhau (gói phụ chỉ chứa point) — trộn chung sẽ làm mất tính
  // đúng đắn của việc "cache này đã đủ ô cho bộ kind này chưa".
  const cacheDir = path.join(OUT_VECTOR_DIR, '.cache', keySlug);
  const cellCachePath = (row, col) => path.join(cacheDir, `${row}_${col}.json`);
  const countCachedCells = () =>
    fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json')).length
      : 0;

  const wantedKinds = options.kinds ? new Set(options.kinds) : null;
  if (wantedKinds) {
    for (const kind of wantedKinds) {
      if (!FEATURE_KINDS[kind]) throw new Error(`Loại không hợp lệ: ${kind}`);
    }
  }

  const center = { lat: regionConfig.lat, lon: regionConfig.lon, radiusKm: regionConfig.radiusKm };
  const bounds = getBoundsFromCenter(center.lat, center.lon, center.radiusKm);
  const circle = insetBounds(bounds, 0.98);
  const chunks = splitBounds(circle, options.chunkDeg).filter((chunk) =>
    chunkIntersectsCircle(chunk, center)
  );

  console.log(`Tâm: ${center.lat}, ${center.lon} | bán kính: ${center.radiusKm} km`);
  console.log(
    `Chia thành ${chunks.length} ô (ô ${options.chunkDeg}°), tối đa ${options.concurrency} request đồng thời`
  );
  console.log(`Kết quả: ${path.relative(__dirname, outFile)}`);

  // --- Bỏ qua nếu đã tải ĐỦ bộ ô ---
  //
  // Vì sao kiểm tra ở đây chứ không ở đầu hàm: chỉ tới bước này mới biết chính
  // xác vùng cần bao nhiêu ô. Bỏ qua chỉ khi cache có đủ số ô đó — nếu không thì
  // phải tải tiếp, nếu không sẽ giữ nguyên một gói thiếu dữ liệu rồi báo "xong".
  const cachedCount = countCachedCells();
  if (fs.existsSync(outFile) && !options.force && cachedCount >= chunks.length) {
    const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
    console.log(`   Đã tồn tại (${sizeMb} MB, ${cachedCount}/${chunks.length} ô) - bỏ qua.`);
    let existingCount = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      existingCount = raw.featureCount ?? raw.features?.length ?? 0;
    } catch {
      /* file hỏng thì cứ coi như 0, không chặn */
    }
    return { featureCount: existingCount, sizeMb };
  }
  if (fs.existsSync(outFile) && cachedCount > 0) {
    console.log(
      `   Tệp đã có nhưng cache chỉ ${cachedCount}/${chunks.length} ô - tải tiếp phần còn thiếu.`
    );
  }

  // --- Tải từng ô ---
  const collected = [];
  const seen = new Set();

  // --- Cache từng ô trên đĩa ---
  //
  // VÌ SAO CẦN: một lần chạy 9 tỉnh mất hàng giờ, mà Overpass hay 504 giữa chừng.
  // Trước đây mất trắng mọi ô đã tải xong. Giờ mỗi ô ghi riêng 1 file cache, nên
  // chạy lại là nối tiếp chứ không tải lại từ đầu.
  fs.mkdirSync(cacheDir, { recursive: true });

  const readCellCache = (row, col, queryHash) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(cellCachePath(row, col), 'utf8'));
      if (Array.isArray(parsed)) return { elements: parsed, provenance: null };
      if (parsed.schemaVersion === 2 && parsed.queryHash === queryHash && Array.isArray(parsed.elements)
        && typeof parsed.queriedAt === 'string') return { elements: parsed.elements, provenance: parsed };
      return null;
    } catch {
      return null;
    }
  };
  const writeCellCache = (row, col, elements, provenance) => {
    try {
      fs.writeFileSync(cellCachePath(row, col), JSON.stringify({ schemaVersion: 2, ...provenance, elements }));
    } catch {
      /* hết dung lượng cache cũng không sao, chỉ mất tốc độ */
    }
  };
  const queue = chunks.slice();
  const coverageRequests = [];
  const requestedKinds = [...(wantedKinds ?? DEFAULT_KINDS)].sort();
  let done = 0;
  let failed = 0;

  async function worker() {
    while (queue.length > 0) {
      const chunk = queue.shift();
      if (!chunk) break;

      // Ưu tiên cache trước: lần chạy sau chỉ bỏ qua bước mạng.
      const query = buildOverpassQuery(chunk, wantedKinds);
      const queryHash = createHash('sha256').update(query).digest('hex');
      const cached = readCellCache(chunk.row, chunk.col, queryHash);
      let elements = cached?.elements ?? null;
      let provenance = cached?.provenance ?? null;
      const fromCache = cached !== null;

      if (!fromCache) {
        try {
          elements = await queryOverpass(query);
          provenance = { queriedAt: new Date().toISOString(), queryHash };
          writeCellCache(chunk.row, chunk.col, elements, provenance);
        } catch (error) {
          failed++;
          console.warn(`\n   Ô [${chunk.row},${chunk.col}] lỗi: ${error.message}`);
          coverageRequests.push(vectorCoverageRecord(chunk, requestedKinds, { error }));
          // Vẫn tính ô này là đã xử lý, nếu không vòng lặp sẽ treo khi
          // Overpass hỏng cả chục ô liên tiếp.
          done++;
          continue;
        }
      }

      coverageRequests.push(vectorCoverageRecord(chunk, requestedKinds, { elements, provenance }));

      for (const element of elements) {
        const feature = elementToFeature(element, center);
        if (!feature) continue;
        if (wantedKinds && !wantedKinds.has(feature.properties.kind)) continue;
        // Feature chạm ranh giới giữa 2 ô có thể bị trả 2 lần -> khử trùng theo id
        if (seen.has(feature.id)) continue;
        seen.add(feature.id);
        collected.push(feature);
      }

      done++;
      const percent = ((done / chunks.length) * 100).toFixed(0);
      process.stdout.write(
        `   ${done}/${chunks.length} ô (${percent}%${fromCache ? ', cache' : ''}) | ` +
          `feature: ${collected.length} | lỗi: ${failed}\r`
      );
    }
  }

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker())
  );
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  // --- Rút gọn + ghi file ---
  // Rút gọn MẠNH hơn cho gói lớn: toạ độ 6 chữ số (~0.11 m) là quá dư cho mục đích
  // phân tích cự ly cỡ km. 5 chữ số (~1.1 m) vẫn chính xác hơn nhiều so với bán kính
  // khí tài, và tiết kiệm ~15% dung lượng trên file chứa hàng trăm nghìn điểm.
  const features = collected.map((feature) => {
    // Nhà giữ nguyên hình dạng (để đo diện tích chính xác); tuyến/vùng lớn thì rút gọn
    const tolerance = feature.properties.kind === 'building' ? 0 : options.simplifyDeg;
    return simplifyFeature(feature, tolerance);
  });

  const counts = countByKind(features);
  const coverageLedger = {
    schemaVersion: 1,
    requestedKinds,
    // Successful transport does not undo original extraction exclusions or prove OSM completeness.
    extraction: 'legacy-first-coordinate-radius-filter-way-node-only',
    requests: coverageRequests.sort((a, b) => a.id.localeCompare(b.id)),
  };

  // Báo cáo ô hỏng TRƯỚC khi ghi file, để người dùng biết gói vừa tạo là bản
  // thiếu và cần chạy lại. Im lặng ghi ra rồi tưởng đã xong là cách làm mất
  // thời gian nhất — lần chạy sau không có lý do gì để tải lại những ô đã có.
  if (failed > 0) {
    console.log(
      `\nCẢNH BÁO: ${failed}/${chunks.length} ô không tải được. Gói này THIẾU dữ liệu.` +
        `\nChạy lại cùng lệnh để nối tiếp — các ô đã tải được nằm trong cache.`
    );
  }

  // --- Chia nhỏ theo ô lưới (chỉ khi gói quá lớn) ---
  //
  // VÌ SAO PHẢI CHIA: một gói đô thị như Đà Nẵng có thể lên tới 165 000 feature /
  // 48 MB. Nạp nguyên gói vào bộ nhớ sẽ tốn hàng trăm MB RAM và làm Cesium treo.
  // Cách duy nhất khả thi cho bản đồ vector ở quy mô này là chia ô để tải lazy:
  // ứng dụng chỉ tải các ô đang nằm trong khung nhìn.
  //
  // Ngưỡng: gói > SPLIT_THRESHOLD_MB thì tự động chia ô CELL_DEG x CELL_DEG.
  const SPLIT_THRESHOLD_MB = 8;
  const CELL_DEG = 0.1; // ~11 km - vừa đủ nhỏ để tải nhanh, vừa đủ lớn để ít file
  const sizeEstimateMb = JSON.stringify(features).length / (1024 * 1024);

  fs.mkdirSync(OUT_VECTOR_DIR, { recursive: true });

  if (sizeEstimateMb > SPLIT_THRESHOLD_MB) {
    console.log(
      `\nGói lớn (${sizeEstimateMb.toFixed(1)} MB) - tự động chia ô ${CELL_DEG}° để ứng dụng tải lazy.`
    );

    // Gom feature vào ô theo tâm hình học (bounding box chưa có lúc này, dùng điểm đầu
    // đủ để chia; ứng dụng vẫn lọc chính xác bằng bbox khi truy vấn).
    const buckets = new Map();
    for (const feature of features) {
      const first = firstCoordOf(feature);
      if (!first) continue;
      const [lon, lat] = first;
      const row = Math.floor(lat / CELL_DEG);
      const col = Math.floor(lon / CELL_DEG);
      const key = `${row}_${col}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(feature);
      else buckets.set(key, [feature]);
    }

    // Ghi 1 file index (nhỏ) + N file ô
    const index = {
      type: 'vector-tile-index',
      region: keySlug,
      baseRegion: key,
      name: regionConfig.name,
      bbox: [circle.minLon, circle.minLat, circle.maxLon, circle.maxLat],
      cellDeg: CELL_DEG,
      cellCount: buckets.size,
      manifestVersion: 2,
      cellBounds: Object.fromEntries([...buckets].map(([name, list]) => [name, vectorFeatureBounds(list)])),
      coverageLedger,
      // DANH SÁCH Ô THẬT SỰ CÓ TRÊN ĐĨA.
      //
      // Vì sao bắt buộc: phía ứng dụng không có API liệt kê thư mục tĩnh, nên
      // nó chỉ có thể dò ô theo công thức `${row}_${col}` từ bbox. Bounding box của
      // vùng là HÌNH VUÔNG trong khi dữ liệu chỉ lấy trong HÌNH TRÒN -> một góc
      // vuông luôn trống, tức là 7-30% số ô là 404. Xem `listCellFiles()`.
      // Ghi danh sách ô vào index biến việc dò thành tra cứu, không còn 404 nào
      // và bỏ được hàng trăm request thừa mỗi lần mở bản đồ.
      cells: [...buckets.keys()].sort(),
      featureCount: features.length,
      kindCounts: counts,
      center: { lat: center.lat, lon: center.lon },
      radiusKm: center.radiusKm,
      downloadedAt: new Date().toISOString(),
    };

    // Gom nguyên khối vào file .all để phân tích khi cần, không ship lên web
    fs.writeFileSync(`${outFile}.all`, JSON.stringify({ features, metadata: index }), 'utf8');

    const dir = path.join(OUT_VECTOR_DIR, keySlug);
    fs.mkdirSync(dir, { recursive: true });

    let cellFiles = 0;
    let cellBytes = 0;
    for (const [cellKey, list] of buckets) {
      const cellFile = path.join(dir, `${cellKey}.geojson`);
      const payload = JSON.stringify({ type: 'FeatureCollection', features: list });
      fs.writeFileSync(cellFile, payload, 'utf8');
      cellBytes += payload.length;
      cellFiles++;
    }

    fs.writeFileSync(outFile, JSON.stringify(index), 'utf8');
    console.log(
      `   Đã chia thành ${cellFiles} ô, tổng ${(cellBytes / 1048576).toFixed(1)} MB ` +
        `(trung bình ${(cellBytes / cellFiles / 1024).toFixed(0)} KB/ô).`
    );
  } else {
    const geojson = {
      type: 'FeatureCollection',
      name: regionConfig.name,
      bbox: [circle.minLon, circle.minLat, circle.maxLon, circle.maxLat],
      metadata: {
        manifestVersion: 2,
        coverageLedger,
        provider: 'OpenStreetMap via Overpass API',
        region: key,
        center: { lat: center.lat, lon: center.lon },
        radiusKm: center.radiusKm,
        downloadedAt: new Date().toISOString(),
        featureCount: features.length,
        kindCounts: counts,
      },
      features,
    };
    fs.writeFileSync(outFile, JSON.stringify(geojson), 'utf8');
  }

  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);

  // --- Cập nhật offline-pack-info.json ---
  let info = {};
  if (fs.existsSync(INFO_FILE)) {
    try {
      info = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    } catch {
      info = {};
    }
  }
  info.lastUpdated = new Date().toISOString();
  const previousRegions = Array.isArray(info.vector?.regions) ? info.vector.regions : [];
  info.vector = {
    provider: 'OpenStreetMap via Overpass API',
    localPath: '/offline-vector/{region}.geojson',
    regions: previousRegions
      .filter((entry) => entry.region !== key)
      .concat(
        options.suffix
          ? []
          : [
              {
                region: key,
                name: regionConfig.name,
                lat: center.lat,
                lon: center.lon,
                radiusKm: center.radiusKm,
                downloadedAt: new Date().toISOString(),
                featureCount: features.length,
                kindCounts: counts,
              },
            ]
      ),
  };
  if (!options.suffix) fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');

  console.log(`\nHoàn tất trong ${elapsedSec}s | ${features.length} feature | ${sizeMb} MB`);
  for (const [kind, count] of Object.entries(counts)) {
    if (count > 0) console.log(`   - ${kind.padEnd(13)} ${count}`);
  }
  if (failed > 0) {
    console.warn(`Có ${failed} ô lỗi trong vùng này - chạy lại lệnh để bù.`);
  }

  return { featureCount: features.length, sizeMb };
}

// Importing the metadata helpers in tests must never start a download.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('\nLỖI:', error.message);
    process.exitCode = 1;
  });
}
