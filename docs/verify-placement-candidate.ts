/**
 * Verification script: Kiểm chứng ĐỘNG CƠ SINH ỨNG VIÊN VỊ TRÍ ĐẶT KHÍ TÀI.
 *
 * Mục tiêu: chứng minh gợi ý vị trí được TÍNH TỪ DỮ LIỆU THẬT (cao độ + cự ly tới nhà/nước)
 * và deterministic, KHÔNG phải do model bịa - tức khắc phục hiện tượng "đặt đại cho có".
 *
 * Kiểm thử chạy trên 2 tầng:
 *   1. TẦNG HÌNH HỌC (deterministic, không cần mạng/terrain): tiêm một hàm cao độ tổng hợp
 *      (một "đỉnh núi" ở phía Tây) và một kho vectơ giả (cụm nhà ở phía Đông, một hồ nước ở
 *      giữa) rồi kiểm tra điểm số/ứng viên trả về ĐÚNG như kỳ vọng.
 *   2. TẦNG PARSE: kiểm chứng `parsePlacementRanking` chịu được index lệch, trùng, markdown...
 *
 * Chạy:  npx tsx docs/verify-placement-candidate.ts
 */

import { generatePlacementCandidates } from '../src/utils/placementCandidateEngine';
import { parsePlacementRanking, resolveAdvisorSuggestionIndex } from '../src/utils/aiPlacementAdvisor';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { computeGeometryBounds } from '../src/utils/vectorGeometry';
import type { VectorFeatureStore } from '../src/services/vectorFeatureStore';
import type { VectorFeature, VectorFeatureKind, VectorGeometry } from '../src/types/vectorFeature';

let failures = 0;
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, typeof detail === 'object' ? JSON.stringify(detail) : detail);
}

const GRID_CELL_DEG = 0.05;
const KM_PER_DEG_LAT = 111.32;
const CENTER = { lat: 21.45, lon: 105.65 };

interface LatLon { lat: number; lon: number; }

function offsetKm(center: LatLon, eastKm: number, northKm: number): LatLon {
  const dLat = 1 / KM_PER_DEG_LAT;
  const dLon = 1 / (KM_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  return { lat: center.lat + northKm * dLat, lon: center.lon + eastKm * dLon };
}

function distanceKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hình vuông (km) quanh 1 tâm -> polygon GeoJSON. */
function squareAround(center: LatLon, widthKm: number, heightKm: number): VectorGeometry {
  const halfLat = (heightKm / 2) / KM_PER_DEG_LAT;
  const halfLon = (widthKm / 2) / (KM_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [center.lon - halfLon, center.lat - halfLat],
      [center.lon + halfLon, center.lat - halfLat],
      [center.lon + halfLon, center.lat + halfLat],
      [center.lon - halfLon, center.lat + halfLat],
      [center.lon - halfLon, center.lat - halfLat],
    ]],
  };
}

function makeFakeFeature(id: string, kind: VectorFeatureKind, geometry: VectorGeometry): VectorFeature {
  const bounds = computeGeometryBounds(geometry)!;
  return { id, kind, geometry, properties: { kind, labelVi: kind }, bounds, regionKey: 'test' };
}

function makeFakeStore(features: VectorFeature[]): VectorFeatureStore {
  const grid = new Map<string, number[]>();
  features.forEach((feature, index) => {
    for (let row = Math.floor(feature.bounds.minLat / GRID_CELL_DEG); row <= Math.floor(feature.bounds.maxLat / GRID_CELL_DEG); row++) {
      for (let col = Math.floor(feature.bounds.minLon / GRID_CELL_DEG); col <= Math.floor(feature.bounds.maxLon / GRID_CELL_DEG); col++) {
        const key = `${row}_${col}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });
  const kindCounts = {} as Record<VectorFeatureKind, number>;
  for (const feature of features) kindCounts[feature.kind] = (kindCounts[feature.kind] ?? 0) + 1;
  return {
    packs: [{ info: { regionKey: 'test', name: 'Vùng kiểm thử', centerLat: CENTER.lat, centerLon: CENTER.lon, radiusKm: 35, featureCount: features.length, kindCounts, downloadedAt: '1970-01-01T00:00:00.000Z' }, features }],
    featureCount: features.length,
    kindCounts,
    grid,
    allFeatures: features,
  };
}

/** Dựng cảnh: đỉnh cao ở phía Tây, cụm nhà ở phía Đông, hồ nước ở giữa. */
function buildScenario(lakeWidthKm: number) {
  const peak = offsetKm(CENTER, -8, 0);
  const features: VectorFeature[] = [];
  for (let i = 0; i < 12; i++) {
    const spot = offsetKm(CENTER, 2 + (i % 4) * 0.05, (i - 6) * 0.05);
    features.push(makeFakeFeature(`building:${i}`, 'building', squareAround(spot, 0.03, 0.03)));
  }
  features.push(makeFakeFeature('water_body:1', 'water_body', squareAround(CENTER, lakeWidthKm, lakeWidthKm)));

  // "Đỉnh núi" nhọn (Gaussian) ở phía Tây để điểm cao nổi bật hẳn so với phần còn lại.
  // Nếu dùng gradient thoải, điểm cao độ sẽ bão hoà (mọi điểm đều đạt trần goodElevationM)
  // và không còn phân biệt được - đúng loại lỗi mà bài kiểm thử này cần bắt.
  const elevationLookup = async (points: readonly LatLon[]) =>
    points.map((p) => {
      const d = distanceKm(p, peak);
      return Math.round(100 + 900 * Math.exp(-(d * d) / 9));
    });

  return { features, elevationLookup, peak };
}
// ---------------------------------------------------------------------------
// TẦNG 1: ĐỘNG CƠ (dữ liệu tiêm, deterministic)
// ---------------------------------------------------------------------------

async function runEngineLayer() {
  console.log('=== TẦNG 1: ĐỘNG CƠ (cao độ tiêm + kho vectơ giả) ===\n');

  const { features, elevationLookup, peak } = buildScenario(6);
  const store = makeFakeStore(features);
  const template = EQUIPMENT_TEMPLATES[0];

  const candidates = await generatePlacementCandidates({
    center: CENTER,
    radiusKm: 30,
    template,
    maxCandidates: 180,
    topCount: 6,
    elevationLookup,
    featureStore: store,
  });

  check('Sinh được ứng viên (1..topCount)', candidates.length > 0 && candidates.length <= 6, {
    count: candidates.length,
  });

  const sorted = candidates.every((c, i, arr) => i === 0 || arr[i - 1].score >= c.score);
  check('Điểm số xếp giảm dần', sorted, candidates.map((c) => Number(c.score.toFixed(3))));

  const best = candidates[0];
  check(
    'Ứng viên tốt nhất nằm phía Tây (gần đỉnh, xa cụm nhà phía Đông)',
    best.longitude < CENTER.lon,
    { bestLon: Number(best.longitude.toFixed(4)), centerLon: CENTER.lon }
  );
  check(
    'Ứng viên tốt nhất nằm sát đỉnh (cách đỉnh < 4.5 km)',
    distanceKm({ lat: best.latitude, lon: best.longitude }, peak) < 4.5,
    { distanceToPeakKm: Number(distanceKm({ lat: best.latitude, lon: best.longitude }, peak).toFixed(2)) }
  );
  check('Ứng viên tốt nhất xa khu dân cư (> 3 km)', (best.criteria.nearestBuildingKm ?? 0) > 3, {
    nearestBuildingKm: best.criteria.nearestBuildingKm,
  });
  check(
    'Ứng viên tốt nhất đạt trần cao độ tốt (>= 250 m) và nổi bật (nhô > 300 m)',
    best.criteria.elevationM >= 250 && best.criteria.reliefM > 300,
    { elevationM: best.criteria.elevationM, reliefM: best.criteria.reliefM }
  );
  check('Không ứng viên nào nằm trong vùng nước', candidates.every((c) => !c.criteria.inWater), {});
  check(
    'Không ứng viên nào nằm giữa hồ (cách tâm > 3 km)',
    candidates.every((c) => distanceKm({ lat: c.latitude, lon: c.longitude }, CENTER) > 3),
    {}
  );
  check('Lý do nêu số liệu thật', best.reason.includes('cao độ') && best.reason.includes('km'), best.reason);
  check('breakdown có điểm tiêu chí cao độ', best.breakdown.elevation !== undefined, best.breakdown);
  check('breakdown có điểm tiêu chí dân cư', best.breakdown.awayFromPopulation !== undefined, {});

  // Hồ phủ kín vùng -> chứng minh `excludeInWater` thực sự loại ứng viên.
  const flooded = buildScenario(200);
  const floodedCandidates = await generatePlacementCandidates({
    center: CENTER,
    radiusKm: 30,
    template,
    elevationLookup: flooded.elevationLookup,
    featureStore: makeFakeStore(flooded.features),
    topCount: 6,
  });
  check('Hồ phủ kín -> không còn ứng viên nào', floodedCandidates.length === 0, {
    count: floodedCandidates.length,
  });

  // Deterministic: chạy lại phải cho cùng toạ độ.
  const again = await generatePlacementCandidates({
    center: CENTER,
    radiusKm: 30,
    template,
    elevationLookup,
    featureStore: store,
    topCount: 6,
  });
  check(
    'Deterministic: chạy lại cho cùng toạ độ',
    JSON.stringify(again.map((c) => `${c.latitude},${c.longitude}`)) ===
      JSON.stringify(candidates.map((c) => `${c.latitude},${c.longitude}`)),
    {}
  );
}

// ---------------------------------------------------------------------------
// TẦNG 2: PARSE XẾP HẠNG (chống model trả sai)
// ---------------------------------------------------------------------------

function runParserLayer() {
  console.log('\n=== TẦNG 2: PARSE XẾP HẠNG ===\n');

  const r1 = parsePlacementRanking('{"summary":"ok","ranking":[{"index":0,"reason":"a"},{"index":2,"reason":"c"}]}', 3);
  check('JSON hợp lệ -> ok', r1.ok && r1.value.ranking.length === 2 && r1.value.summary === 'ok', r1);

  const wrapped = 'Kết quả:\n```json\n{"summary":"s","ranking":[{"index":1,"reason":"b"}]}\n```';
  const r2 = parsePlacementRanking(wrapped, 3);
  check('Bọc markdown vẫn parse được', r2.ok && r2.value.ranking.length === 1 && r2.value.ranking[0].index === 1, r2);

  const messy = '{"summary":"s","ranking":[{"index":9,"reason":"x"},{"index":0,"reason":"y"},{"index":0,"reason":"dup"}]}';
  const r3 = parsePlacementRanking(messy, 3);
  check('Bỏ index ngoài biên + loại trùng', r3.ok && r3.value.ranking.length === 1 && r3.value.ranking[0].index === 0, r3);

  const r4 = parsePlacementRanking('không có json', 3);
  check('Không có JSON -> ok=false', !r4.ok, r4);

  const r5 = parsePlacementRanking('{"summary":"s","ranking":[]}', 3);
  check('Mảng rỗng -> ok, 0 mục', r5.ok && r5.value.ranking.length === 0, r5);

  const invalidIndices = parsePlacementRanking(JSON.stringify({
    summary: 's',
    ranking: [
      { index: 0.9, reason: 'fractional' },
      { index: -0.1, reason: 'negative fractional' },
      { index: '', reason: 'empty' },
      { index: '  ', reason: 'whitespace' },
      { index: null, reason: 'null' },
      { index: true, reason: 'boolean' },
      { index: '2', reason: 'valid integer string' },
    ],
  }), 3);
  check('Không làm tròn hay ép index rác thành ứng viên hợp lệ',
    invalidIndices.ok && invalidIndices.value.ranking.length === 1
      && invalidIndices.value.ranking[0].index === 2, invalidIndices);
}

// ---------------------------------------------------------------------------
// TẦNG 3: CHUẨN HOÁ CHỈ SỐ GỢI Ý (bấm marker trên bản đồ -> tra vào danh sách)
// ---------------------------------------------------------------------------

/**
 * Hàm này là RANH GIỚI giữa "marker trên bản đồ" và "danh sách gợi ý trong store".
 * Nếu nó lọt qua một index sai thì người dùng bấm vào gợi ý số 2 lại bị đặt
 * khí tài ở gợi ý số 1 (hoặc tệ hơn là lỗi runtime). Nên phải chặn mọi dạng
 * rác: index âm, vượt biên, số thực, chuỗi rỗng, null, count <= 0.
 */
function runIndexNormalizeLayer() {
  console.log('\n=== TẦNG 3: CHUẨN HOÁ CHỈ SỐ GỢI Ý ===\n');

  const count = 3;
  check('Index hợp lệ -> giữ nguyên', resolveAdvisorSuggestionIndex(0, count) === 0
    && resolveAdvisorSuggestionIndex(2, count) === 2, { got: resolveAdvisorSuggestionIndex(2, count) });

  check('Ngoài biên -> null', resolveAdvisorSuggestionIndex(-1, count) === null
    && resolveAdvisorSuggestionIndex(3, count) === null, {});

  check('Số thực -> null', resolveAdvisorSuggestionIndex(1.5, count) === null, {});

  check('Chuỗi số -> chấp nhận (Cesium trả về string)', resolveAdvisorSuggestionIndex('1', count) === 1, {});

  check('Chuỗi rác / null / undefined -> null', resolveAdvisorSuggestionIndex('', count) === null
    && resolveAdvisorSuggestionIndex('abc', count) === null
    && resolveAdvisorSuggestionIndex(null, count) === null
    && resolveAdvisorSuggestionIndex(undefined, count) === null, {});

  check('Danh sách rỗng -> null cho mọi index', resolveAdvisorSuggestionIndex(0, 0) === null, {});

  check('Bỏ chọn (null) -> null', resolveAdvisorSuggestionIndex(null, count) === null, {});
}

async function main() {
  await runEngineLayer();
  runParserLayer();
  runIndexNormalizeLayer();
  console.log('');
  if (failures === 0) console.log('ALL CHECKS PASSED');
  else console.log(`FAILED: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
