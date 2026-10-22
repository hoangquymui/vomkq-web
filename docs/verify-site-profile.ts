/**
 * Verification script: Kiểm chứng Site Profile (đặc tính vùng phủ của khí tài).
 *
 * Mục tiêu: chứng minh `buildSiteProfile()` thực sự trả lời được câu hỏi
 * "trong tầm hoạt động của khí tài, nhà/sông/suối/núi ở đâu và cách bao xa".
 *
 * Kiểm thử chạy trên 2 tầng:
 *   1. TẦNG HÌNH HỌC (deterministic, không cần mạng): dựng một kho vectơ giả với
 *      các đối tượng đặt ở vị trí & khoảng cách đã biết, rồi kiểm tra profile tính ra
 *      ĐÚNG các con số kỳ vọng.
 *   2. TẦNG TÍCH HỢP (cần dữ liệu thật): đọc gói GeoJSON đã tải trong
 *      public/offline-vector và in ra profile thật để đối chiếu bằng mắt/QGIS.
 *
 * Chạy:  npx tsx docs/verify-site-profile.ts
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSiteProfile,
  buildTerrainRings,
  formatProfileText,
  queryFeaturesNear,
  summarizeProfile,
} from '../src/utils/featureAwareness';
import { queryFeaturesInRadius, type VectorFeatureStore } from '../src/services/vectorFeatureStore';
import { computeGeometryBounds } from '../src/utils/vectorGeometry';
import type { VectorFeature, VectorFeatureKind, VectorGeometry } from '../src/types/vectorFeature';
import {
  listDownloadedRegions,
  loadPackFromDisk,
  readPackHeader,
  vectorPackDir,
} from './vectorPackDisk';

let failures = 0;
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, typeof detail === 'object' ? JSON.stringify(detail) : detail);
}

const GRID_CELL_DEG = 0.05;

// ---------------------------------------------------------------------------
// TẦNG 1: KHO VECTƠ GIẢ — kiểm chứng logic thuần, không phụ thuộc dữ liệu thật
// ---------------------------------------------------------------------------

/** Tạo 1 feature giả với hình học cho trước, tự tính bounds và gán vào lưới. */
function makeFakeFeature(
  id: string,
  kind: VectorFeatureKind,
  geometry: VectorGeometry
): VectorFeature {
  const bounds = computeGeometryBounds(geometry)!;
  return {
    id,
    kind,
    geometry,
    properties: { kind, labelVi: kind },
    bounds,
    regionKey: 'test',
  };
}

/** Dựng kho vectơ giả giống hệt cấu trúc do `loadVectorFeatureStore()` sinh ra. */
function makeFakeStore(features: VectorFeature[]): VectorFeatureStore {
  const grid = new Map<string, number[]>();
  features.forEach((feature, index) => {
    for (
      let row = Math.floor(feature.bounds.minLat / GRID_CELL_DEG);
      row <= Math.floor(feature.bounds.maxLat / GRID_CELL_DEG);
      row++
    ) {
      for (
        let col = Math.floor(feature.bounds.minLon / GRID_CELL_DEG);
        col <= Math.floor(feature.bounds.maxLon / GRID_CELL_DEG);
        col++
      ) {
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
    packs: [
      {
        info: {
          regionKey: 'test',
          name: 'Vùng kiểm thử',
          centerLat: 21.45,
          centerLon: 105.65,
          radiusKm: 35,
          featureCount: features.length,
          kindCounts,
          downloadedAt: '1970-01-01T00:00:00.000Z',
        },
        features,
      },
    ],
    featureCount: features.length,
    kindCounts,
    grid,
    allFeatures: features,
  };
}

/** Dựng hình chữ nhật (km) thành polygon quanh tâm, hướng Đông-Nam. */
function rectangleNear(
  centerLat: number,
  centerLon: number,
  eastKm: number,
  northKm: number,
  widthKm: number,
  heightKm: number
): VectorGeometry {
  const dLatPerKm = 1 / 111.32;
  const dLonPerKm = 1 / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const cLat = centerLat + northKm * dLatPerKm;
  const cLon = centerLon + eastKm * dLonPerKm;
  const halfLat = (heightKm / 2) * dLatPerKm;
  const halfLon = (widthKm / 2) * dLonPerKm;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [cLon - halfLon, cLat - halfLat],
        [cLon + halfLon, cLat - halfLat],
        [cLon + halfLon, cLat + halfLat],
        [cLon - halfLon, cLat + halfLat],
        [cLon - halfLon, cLat - halfLat],
      ],
    ],
  };
}

async function runSyntheticLayer() {
  console.log('=== TẦNG 1: KIỂM CHỨNG LOGIC (kho vectơ giả, vị trí đã biết) ===\n');

  const CENTER = { lat: 21.45, lon: 105.65 };

  // Vị trí các đối tượng, cố tình ở khoảng cách dễ kiểm chứng:
  //   - 10 ngôi nhà ở ~2 km về phía Đông
  //   - 1 sông (đường thẳng) chạy cách tâm ~5 km về phía Bắc
  //   - 3 suối ở ~1 km
  //   - 2 đỉnh núi ở ~8 km và ~12 km
  const features: VectorFeature[] = [];

  for (let i = 0; i < 10; i++) {
    const jitter = (i - 5) * 0.02;
    features.push(
      makeFakeFeature(
        `building:${i}`,
        'building',
        rectangleNear(CENTER.lat, CENTER.lon, 2 + jitter, 0, 0.05, 0.05)
      )
    );
  }

  // Sông: đường ngang ở 5 km về phía Bắc
  const dLatPerKm = 1 / 111.32;
  const dLonPerKm = 1 / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180));
  const riverLat = CENTER.lat + 5 * dLatPerKm;
  features.push(
    makeFakeFeature('water_river:1', 'water_river', {
      type: 'LineString',
      coordinates: [
        [CENTER.lon - 0.1, riverLat],
        [CENTER.lon, riverLat],
        [CENTER.lon + 0.1, riverLat],
      ],
    })
  );

  for (let i = 0; i < 3; i++) {
    features.push(
      makeFakeFeature(
        `water_stream:${i}`,
        'water_stream',
        rectangleNear(CENTER.lat, CENTER.lon, -1 - i * 0.5, 0.3, 0.02, 0.02) as never
      )
    );
  }

  features.push(
    makeFakeFeature('peak:1', 'peak', {
      type: 'Point',
      // 8 km về phía BẮC THUẦN TÚY (chỉ đổi vĩ độ) -> cự ly đúng 8 km
      coordinates: [CENTER.lon, CENTER.lat + 8 * dLatPerKm],
    })
  );
  features.push(
    makeFakeFeature('peak:2', 'peak', {
      type: 'Point',
      // 12 km về phía TÂY THUẦN TÚY (chỉ đổi kinh độ) -> cự ly đúng 12 km
      coordinates: [CENTER.lon - 12 * dLonPerKm, CENTER.lat],
    })
  );

  const store = makeFakeStore(features);

  console.log('--- 1. queryFeaturesNear: cự ly thật & sắp xếp ---');

  const nearby = queryFeaturesNear(store, CENTER.lat, CENTER.lon, 35);
  check(
    'Tìm thấy đúng 16 đối tượng trong bán kính 35 km',
    nearby.length === 16,
    { found: nearby.length, expected: 16 }
  );

  const sorted = [...nearby].every((item, i, arr) => i === 0 || arr[i - 1].distanceKm <= item.distanceKm);
  check('Kết quả được sắp xếp từ gần tới xa', sorted, {});

  const nearest = nearby[0];
  check(
    'Đối tượng gần nhất là suối ở ~1 km (0.8 < d < 1.2)',
    nearest.feature.kind === 'water_stream' && nearest.distanceKm > 0.8 && nearest.distanceKm < 1.2,
    { kind: nearest.feature.kind, distanceKm: Number(nearest.distanceKm.toFixed(3)) }
  );

  const nearestRiver = nearby.find((i) => i.feature.kind === 'water_river');
  check(
    'Sông ở ~5 km (4.8 < d < 5.2)',
    nearestRiver !== undefined && nearestRiver.distanceKm > 4.8 && nearestRiver.distanceKm < 5.2,
    { distanceKm: Number(nearestRiver?.distanceKm.toFixed(3)) }
  );

  const nearestBuilding = nearby.find((i) => i.feature.kind === 'building');
  // Nhà được rải ở eastKm = 1.9 .. 2.1, mỗi ngôi rộng 0.05 km.
  // Ngôi gần nhất có tâm ở 1.9 km, cạnh gần nhất nằm ở 1.9 - 0.025 = 1.875 km.
  // Đây chính là điểm cần kiểm chứng: hệ thống phải đo tới CẠNH, không tới TÂM.
  check(
    'Nhà gần nhất: đo tới CẠNH ~1.875 km, không phải tới tâm 1.9 km',
    nearestBuilding !== undefined &&
      nearestBuilding.distanceKm > 1.85 &&
      nearestBuilding.distanceKm < 1.9,
    { distanceKm: Number(nearestBuilding?.distanceKm.toFixed(3)) }
  );

  console.log('--- 2. Lọc theo loại (kinds) ---');

  const peaksOnly = queryFeaturesNear(store, CENTER.lat, CENTER.lon, 35, ['peak']);
  check(
    'Lọc peak trả về đúng 2 đỉnh',
    peaksOnly.length === 2 && peaksOnly.every((i) => i.feature.kind === 'peak'),
    { found: peaksOnly.length }
  );

  const buildingsOnly = queryFeaturesNear(store, CENTER.lat, CENTER.lon, 35, ['building']);
  check('Lọc building trả về đúng 10 ngôi', buildingsOnly.length === 10, { found: buildingsOnly.length });

  console.log('--- 3. Bán kính nhỏ hơn phải lọc bớt ---');

  const within3km = queryFeaturesNear(store, CENTER.lat, CENTER.lon, 3);
  check(
    'Bán kính 3 km chỉ thấy suối + nhà (không thấy sông 5 km, núi 8 km)',
    within3km.every((i) => i.distanceKm <= 3) &&
      !within3km.some((i) => i.feature.kind === 'water_river') &&
      !within3km.some((i) => i.feature.kind === 'peak'),
    {
      found: within3km.length,
      kinds: [...new Set(within3km.map((i) => i.feature.kind))],
    }
  );

  console.log('--- 4. buildSiteProfile tính đúng chỉ số ---');

  // Không truyền terrain -> phần địa hình rỗng, phần vectơ vẫn đầy đủ
  const profile = await buildSiteProfile(CENTER.lat, CENTER.lon, 35, null, store);

  check('Diện tích vùng = π r² ≈ 3848 km²', Math.abs(profile.areaKm2 - Math.PI * 1225) < 1, {
    areaKm2: profile.areaKm2,
  });

  check('Đếm đúng 10 nhà', profile.features.buildingCount === 10, {
    buildingCount: profile.features.buildingCount,
  });
  check('Đếm đúng 1 sông', profile.features.riverCount === 1, { riverCount: profile.features.riverCount });
  check('Đếm đúng 3 suối', profile.features.streamCount === 3, { streamCount: profile.features.streamCount });
  check('Đếm đúng 2 đỉnh núi', profile.terrain.peakCount === 2, { peakCount: profile.terrain.peakCount });

  check(
    'Cự ly sông gần nhất ~5 km',
    profile.features.nearestRiverKm !== null &&
      profile.features.nearestRiverKm > 4.8 &&
      profile.features.nearestRiverKm < 5.2,
    { nearestRiverKm: profile.features.nearestRiverKm }
  );
  check(
    'Cự ly nhà gần nhất = 1.875 km (đo tới cạnh)',
    profile.features.nearestBuildingKm !== null &&
      profile.features.nearestBuildingKm > 1.85 &&
      profile.features.nearestBuildingKm < 1.9,
    { nearestBuildingKm: profile.features.nearestBuildingKm }
  );
  check(
    'Cự ly suối gần nhất ~1 km',
    profile.features.nearestStreamKm !== null &&
      profile.features.nearestStreamKm > 0.8 &&
      profile.features.nearestStreamKm < 1.2,
    { nearestStreamKm: profile.features.nearestStreamKm }
  );

  // Chiều dài sông: 0.2 độ kinh độ ở vĩ độ 21.45 ≈ 0.2 x 111.32 x cos(21.45) ≈ 20.7 km
  check(
    'Chiều dài sông ~20.7 km (đúng chiều ngang của tuyến)',
    profile.features.riverLengthKm > 20 && profile.features.riverLengthKm < 21.5,
    { riverLengthKm: profile.features.riverLengthKm }
  );

  check(
    'Đỉnh núi gần nhất ở đúng 8 km (đặt thuần vĩ độ)',
    profile.terrain.nearestPeak !== null &&
      profile.terrain.nearestPeak.distanceKm > 7.9 &&
      profile.terrain.nearestPeak.distanceKm < 8.1,
    { nearestPeakKm: profile.terrain.nearestPeak?.distanceKm }
  );

  console.log('--- 5. Vùng KHÔNG có dữ liệu (biển, sa mạc) ---');

  const emptyProfile = await buildSiteProfile(0, 0, 35, null, null);
  check('Không có vectơ -> hasVectorData = false', emptyProfile.features.hasVectorData === false, {});
  check('Không có vectơ -> isSparse = true', emptyProfile.features.isSparse === true, {});
  check('Không có terrain -> hasTerrainData = false', emptyProfile.terrain.hasTerrainData === false, {});
  check(
    'Văn bản tóm tắt vẫn sinh ra được (không vỡ)',
    emptyProfile.text.length > 0,
    { textLines: emptyProfile.text.split('\n').length }
  );

  console.log('--- 6. Vùng có DỮ LIỆU MỎNG -> phải cảnh báo ---');

  // 1 ngôi nhà trong vùng 35 km => mật độ 0.026/km² < 0.5 => mỏng
  const sparseStore = makeFakeStore([
    makeFakeFeature('building:solo', 'building', rectangleNear(CENTER.lat, CENTER.lon, 3, 0, 0.05, 0.05)),
  ]);
  const sparseProfile = await buildSiteProfile(CENTER.lat, CENTER.lon, 35, null, sparseStore);
  check('1 nhà / 3848 km² -> đánh dấu dữ liệu mỏng', sparseProfile.features.isSparse === true, {
    isSparse: sparseProfile.features.isSparse,
  });
  check(
    'Văn bản cảnh báo "dữ liệu mỏng"',
    sparseProfile.text.includes('LƯU Ý') && sparseProfile.text.includes('THẤP HƠN'),
    {}
  );

  console.log('--- 7. formatProfileText sinh câu chữ có số liệu thật ---');

  const text = formatProfileText(profile);
  check('Có nhắc tới số nhà', text.includes('10 công trình'), { matched: text.includes('10 công trình') });
  check('Có nhắc tới sông và cự ly', text.includes('sông'), {});
  check('Có nhắc tới suối', text.includes('suối'), {});
  check('Có nhắc tới đỉnh núi', text.includes('đỉnh'), {});
  check(
    'Văn bản không rỗng và không quá dài (< 2000 ký tự)',
    text.length > 50 && text.length < 2000,
    { length: text.length }
  );

  // Chống hồi quy: thông tin Núi đếm từ lớp VECTƠ phải xuất hiện NGAY CẢ KHI không
  // có Cesium terrain. Trước đây nó nằm trong khối `if (hasTerrainData)` nên vùng
  // chỉ có OSM mà mất sạch dữ liệu núi - đúng loại mất dữ liệu cần tránh.
  const noTerrainText = formatProfileText({
    ...profile,
    terrain: { ...profile.terrain, hasTerrainData: false },
  });
  check(
    'Không có terrain VẪN nhắc tới đỉnh núi (dữ liệu đếm từ lớp vectơ)',
    noTerrainText.includes('đỉnh'),
    { hasPeakLine: noTerrainText.includes('đỉnh') }
  );
  check(
    'Không có terrain thì báo rõ chưa có cao độ, nhưng vẫn có số liệu nhà',
    noTerrainText.includes('chưa có dữ liệu cao độ') && noTerrainText.includes('10 công trình'),
    {}
  );

  console.log('--- 8. terrainRings: dữ liệu để VẼ BIỂU ĐỒ cánh hoa ---');
  runTerrainRingsLayer();

  console.log('--- 9. nearestPoints: toạ độ để VẼ ĐƯỜNG NỐI ---');
  await runNearestPointsLayer(profile);

  console.log('');
  console.log('--- BẢN ĐẶC TÍNH MẪU (in ra để đọc) ---');
  console.log(text);
  console.log('');
  console.log('Tóm tắt:', summarizeProfile(profile));
  console.log('');
}

// ---------------------------------------------------------------------------
// TẦNG 1B: terrainRings — dữ liệu thô để vẽ biểu đồ cánh hoa độ dốc
// ---------------------------------------------------------------------------

/**
 * Vì sao test bằng mảng cao độ giả lập thay vì đợi Cesium terrain:
 * `buildTerrainRings` thuần tuý — không đụng Cesium. Nhờ vậy kiểm được cả khi máy
 * không có gói terrain offline, và kiểm được TRƯỜNG HỢP ĐẶC BIỆT (mảng rỗng,
 * có NaN) mà dữ liệu thật hiếm khi tạo ra.
 */
function runTerrainRingsLayer() {
  const RINGS = 8;
  const DIRS = 24;
  const CENTER = 100;

  // Mảng phẳng 193 phần tử đúng thứ tự `1 + (ring-1)*24 + dir`:
  //   - tâm (index 0) = 100 m
  //   - mọi mẫu trong vòng 1 = 150 m  (đều 50 m, dốc đồng đều)
  const flat = new Array(1 + RINGS * DIRS).fill(NaN);
  flat[0] = CENTER;
  for (let ring = 1; ring <= RINGS; ring++) {
    for (let dir = 0; dir < DIRS; dir++) flat[1 + (ring - 1) * DIRS + dir] = 150;
  }

  const rings = buildTerrainRings(flat, CENTER, 40);
  check('Số vòng = TERRAIN_RINGS (8)', rings.length === RINGS, { rings: rings.length });
  check(
    'Mỗi vòng đủ TERRAIN_DIRECTIONS (24) mẫu',
    rings.every((r) => r.samples.length === DIRS),
    { counts: rings.map((r) => r.samples.length).join(',') }
  );
  check(
    'Bán kính vòng tăng đều & không vượt bán kính phân tích',
    rings.every((r, i) => i === 0 || r.radiusM > rings[i - 1].radiusM) &&
      rings[rings.length - 1].radiusM <= 40_000,
    { radii: rings.map((r) => r.radiusM).join(',') }
  );
  check(
    'Phương vị chạy 0..345° bước 15° (0 = Bắc)',
    rings[0].samples[0].bearingDeg === 0 && rings[0].samples[23].bearingDeg === 345,
    { first: rings[0].samples[0].bearingDeg, last: rings[0].samples[23].bearingDeg }
  );
  check(
    'Vòng 1 có min = max = 150 m',
    rings[0].minElevationM === 150 && rings[0].maxElevationM === 150,
    { min: rings[0].minElevationM, max: rings[0].maxElevationM }
  );

  // Độ dốc vòng 1 = atan2(|150-100|, 5000) = 5.71° -> làm tròn 5.7
  const slopeRing1 = rings[0].samples[0].slopeDeg;
  const expected1 = Number(((Math.atan2(50, 5000) * 180) / Math.PI).toFixed(1));
  check(
    'Độ dốc vòng 1 khớp công thức atan2(Δcao độ, cự ly ngang)',
    slopeRing1 === expected1,
    { got: slopeRing1, expected: expected1 }
  );

  // Độ dốc phải KHÔNG TĂNG khi cự ly tăng (cùng 50 m chênh lệch): đây là điều làm
  // cho biểu đồ "độ dốc giảm theo cự ly" có ý nghĩa vật lý, không phải nhiễu.
  //
  // Dùng `<=` chứ không phải `<`: slope được làm tròn 1 chữ số để khỏi rối UI,
  // nên các vòng ngoài (5 km, 10 km...) đều tròn về 0.1 và bằng nhau. Đòi "giảm
  // nghiêm" ở đây sẽ fail vì thuật toán làm tròn, không phải vì thuật toán sai.
  const slopes = rings.map((r) => r.samples[0].slopeDeg);
  check(
    'Độ dốc không tăng khi cự ly tăng',
    slopes.every((s, i) => i === 0 || s <= slopes[i - 1]),
    { slopes: slopes.join(' >= ') }
  );
  check(
    'Vòng trong dốc hơn vòng ngoài (sau khi làm tròn vẫn phải thấy rõ)',
    slopes[0] > slopes[slopes.length - 1],
    { inner: slopes[0], outer: slopes[slopes.length - 1] }
  );

  // Trường hợp biên: không có terrain -> mảng rỗng -> phải trả về mảng rỗng chứ
  // KHÔNG được ném lỗi, vì UI sẽ gọi hàm này ở mọi vị trí kể cả ngoài biển.
  check('Mảng rỗng -> trả về [] (không vỡ)', buildTerrainRings([], 0, 35).length === 0, {});
  check('NaN toàn bộ -> không sinh vòng nào', buildTerrainRings(new Array(193).fill(NaN), 0, 35).length === 0, {});

  // Trường hợp biên: terrain lỗ hổng ở một hướng. Vòng đó phải bị BỎ (không đẩy
  // vòng rỗng vào UI làm biểu đồ méo), nhưng vòng khác vẫn phải đủ 24 mẫu.
  const holed = flat.slice();
  for (let dir = 0; dir < DIRS; dir++) holed[1 + dir] = NaN;
  const holedRings = buildTerrainRings(holed, CENTER, 40);
  check(
    'Vòng 1 hỏng toàn bộ -> bị loại, các vòng sau vẫn đủ 24 mẫu',
    holedRings.length === RINGS - 1 && holedRings.every((r) => r.samples.length === DIRS),
    { rings: holedRings.length, counts: holedRings.map((r) => r.samples.length).join(',') }
  );
}

/**
 * Vì sao cần test riêng: `nearestPoints` là thứ UI dùng để vẽ đường nối. Nếu
 * toạ độ sai thì đường nối vẽ ra rỗng giữa Nam Bộ — mà điều đó KHÔNG chạm
 * vào bất kỳ kiểm tra cũ nào vì chúng chỉ so cự ly.
 */
async function runNearestPointsLayer(profile: Awaited<ReturnType<typeof buildSiteProfile>>) {
  const pts = profile.nearestPoints;
  check('Có ít nhất 1 điểm gần nhất', pts.length > 0, { count: pts.length });
  check(
    'Tất cả có nhãn tiếng Việt + toạ độ trong nước',
    pts.every(
      (p) =>
        p.labelVi.length > 0 &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        p.lat > 8 &&
        p.lat < 24 &&
        p.lon > 102 &&
        p.lon < 110
    ),
    { pts: pts.map((p) => `${p.key}@${p.distanceKm}km`).join(', ') }
  );
  check(
    'Cự ly sắp tăng dần',
    pts.every((p, i) => i === 0 || p.distanceKm >= pts[i - 1].distanceKm),
    { order: pts.map((p) => p.distanceKm).join(', ') }
  );
  check(
    'Không trùng loại (mỗi loại 1 điểm gần nhất)',
    new Set(pts.map((p) => p.key)).size === pts.length,
    { keys: pts.map((p) => p.key).join(',') }
  );

  // Khoá phải là loại có nhãn — UI tra bảng màu theo khoá này.
  check(
    'Khoá đều thuộc nhóm biết (không rò rỉ loại lạ)',
    pts.every((p) =>
      ['building', 'water_river', 'water_stream', 'water_body', 'highway', 'forest', 'place', 'peak'].includes(p.key)
    ),
    { keys: [...new Set(pts.map((p) => p.key))].join(',') }
  );

  // Khoảng cách tâm → điểm phải khớp cự ly đã khai báo (sai ở đây nghĩa là đường
  // nối sẽ không khớp với con số hiển thị trong bảng).
  const CENTER = { lat: profile.center.lat, lon: profile.center.lon };
  const allMatch = pts.every((p) => {
    const dLat = (p.lat - CENTER.lat) * 111.32;
    const dLon = (p.lon - CENTER.lon) * 111.32 * Math.cos((CENTER.lat * Math.PI) / 180);
    return Math.abs(Math.hypot(dLat, dLon) - p.distanceKm) < 0.6;
  });
  check('Khoảng cách tâm → toạ độ khớp cựLy khai báo', allMatch, {});

  // Vùng không có vectơ -> KHÔNG được sinh điểm 0,0 (UI sẽ vẽ đường về ngoài VN).
  const emptyProfilePts = (await buildSiteProfile(0, 0, 35, null, null)).nearestPoints;
  check(
    'Vùng trống -> không sinh điểm nào (không có toạ độ 0,0)',
    emptyProfilePts.length === 0,
    { pts: emptyProfilePts.map((p) => `${p.key}@${p.lat},${p.lon}`).join(', ') }
  );
}

// ---------------------------------------------------------------------------
// TẦNG 2: DỮ LIỆU THẬT — nạp gói GeoJSON đã tải và in profile thật
// ---------------------------------------------------------------------------

async function runRealDataLayer() {
  const publicDir = vectorPackDir();
  if (!existsSync(publicDir)) {
    console.log('=== TẦNG 2: BỎ QUA (chưa có thư mục public/offline-vector) ===');
    console.log('Chạy: npm run download-vector-mientrung');
    return;
  }

  const regions = listDownloadedRegions(publicDir);
  if (regions.length === 0) {
    console.log('=== TẦNG 2: BỎ QUA (chưa có gói .geojson nào) ===');
    return;
  }

  console.log('=== TẦNG 2: DỮ LIỆU THẬT ===');
  console.log(`Tìm thấy ${regions.length} gói: ${regions.join(', ')}\n`);

  for (const regionKey of regions) {
    const header = readPackHeader(join(publicDir, `${regionKey}.geojson`));
    const center = header?.center ?? { lat: 0, lon: 0 };
    const radiusKm = header?.radiusKm ?? 30;

    console.log(`--- Gói "${regionKey}" ---`);
    console.log(
      `  Tâm: ${center.lat}, ${center.lon} | bán kính: ${radiusKm} km` +
        (header?.layout === 'tiled' ? ` | đã tách ${header.cellCount} ô` : '')
    );
    console.log(`  Số feature trong gói: ${header?.featureCount ?? 0}`);
    console.log(`  Phân bố loại: ${JSON.stringify(header?.kindCounts ?? {})}`);

    const store = loadPackFromDisk(regionKey, publicDir);
    if (!store) {
      console.log('  Không dựng được kho vectơ từ đĩa; bỏ qua.');
      continue;
    }

    const profile = await buildSiteProfile(center.lat, center.lon, radiusKm, null, store);
    console.log('');
    console.log(profile.text);
    console.log('');

    // Kiểm chứng chéo: queryFeaturesInRadius phải trả về số feature <= toàn bộ gói
    const inRadius = queryFeaturesInRadius(store, center.lat, center.lon, radiusKm);
    check(
      `[${regionKey}] Số feature trong bán kính <= tổng số trong gói`,
      inRadius.length <= store.featureCount,
      { inRadius: inRadius.length, total: store.featureCount }
    );
    check(
      `[${regionKey}] Profile không báo "chưa có dữ liệu vectơ" khi gói có dữ liệu`,
      profile.features.hasVectorData === store.featureCount > 0,
      { hasVectorData: profile.features.hasVectorData, total: store.featureCount }
    );
    // Gói đã tách ô nạp qua nhiều file — nếu chỉ đọc file index thì số nạp được
    // sẽ là 0 trong khi metadata khai 91k. Chốt lại bằng so số khai báo vs thực tế.
    check(
      `[${regionKey}] Số feature nạp được khớp số khai trong metadata`,
      store.featureCount === (header?.featureCount ?? 0),
      { loaded: store.featureCount, declared: header?.featureCount ?? 0 }
    );

    console.log(`  Tóm tắt: ${summarizeProfile(profile)}\n`);
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  await runSyntheticLayer();
  await runRealDataLayer();

  console.log('');
  console.log(failures === 0 ? 'TẤT CẢ PASS' : `${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('LỖI:', error);
  process.exitCode = 1;
});
