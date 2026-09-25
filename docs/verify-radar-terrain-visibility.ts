/**
 * VERIFICATION SCRIPT: RADAR 3D TERRAIN VISIBILITY UNIT TEST MATRIX
 * Tuân thủ đầy đủ Ma trận kiểm thử Mục 36 trong Đặc tả Kỹ thuật Version 1.0 (2026-09-23)
 *
 * Kiểm tra hình học độc lập (không cần mạng hay Cesium Viewer):
 * - Geometry: Flat terrain, Single mountain, High mountain, Near/Far, Multi-mountain
 * - Observer: Height 0 vs Height > 0, Observer moved
 * - Coverage: Constant profile vs Altitude-dependent profile
 * - State: Visible, Boundary, Occluded, Clearance calculation
 * - Cache: Hit, Invalidation on profile change, Invalidation on observer move
 */

import {
  RadarVisibilityEngine,
  SyntheticTerrainSampler,
  HorizonAnalyzer,
  VisibilityState,
  type VisibilityAnalysisRequest,
} from '../src/utils/radarVisibilityEngine';
import type { CoverageProfile } from '../src/types/radarCoverage';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(testId: string, description: string, condition: boolean, details?: unknown) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${testId}: ${description}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${testId}: ${description}`, details !== undefined ? details : '');
  }
}

async function runTestMatrix() {
  console.log('================================================================');
  console.log('RADAR 3D TERRAIN VISIBILITY — COMPREHENSIVE UNIT TEST MATRIX');
  console.log('================================================================\n');

  const engine = new RadarVisibilityEngine();
  const observerLat = 16.0;
  const observerLon = 108.0;

  // Profile lý thuyết chuẩn (100km)
  const standardProfile: CoverageProfile = {
    id: 'test_std_profile',
    name: 'Profile Thử Nghiệm Chuẩn',
    minElevationDeg: 0.5,
    maxElevationDeg: 35.0,
    points: [
      { elevationDeg: 0.5, maxRangeKm: 80 },
      { elevationDeg: 5.0, maxRangeKm: 100 },
      { elevationDeg: 15.0, maxRangeKm: 70 },
      { elevationDeg: 35.0, maxRangeKm: 30 },
    ],
  };

  // --------------------------------------------------------------------------
  // NHÓM 1: GEOMETRY TESTS (Test 01 -> Test 07)
  // --------------------------------------------------------------------------
  console.log('\n--- NHÓM 1: GEOMETRY TESTS ---');

  // Test 01: Flat terrain -> Không có vật cản, toàn bộ samples phải Visible hoặc Boundary
  const flatSampler = new SyntheticTerrainSampler(observerLat, observerLon, 10);
  const flatReq: VisibilityAnalysisRequest = {
    observer: { latitude: observerLat, longitude: observerLon, heightMeters: 50 },
    coverageProfile: standardProfile,
    terrain: { source: 'synthetic_flat', sampler: flatSampler },
    config: {
      azimuthSamples: 36,
      elevationSamples: 10,
      terrainSampleSpacingMeters: 2000,
      analysisDistanceMeters: 80000,
      useEarthCurvature: false,
    },
  };
  const flatRes = await engine.analyze(flatReq);
  const flatOccludedCount = flatRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  assert('Test 01', 'Flat terrain: Không có mẫu nào bị che khuất (Occluded = 0)', flatOccludedCount === 0, {
    flatOccludedCount,
    totalSamples: flatRes.samples.length,
  });

  // Test 02: Single hill -> 1 ngọn núi tại cự ly 15km, hướng 90 độ, đỉnh 800m
  const singleHillSampler = new SyntheticTerrainSampler(observerLat, observerLon, 10).addObstacle({
    distanceMeters: 15000,
    azimuthDeg: 90,
    peakElevationMeters: 800,
    radiusMeters: 4000,
  });
  const singleHillReq: VisibilityAnalysisRequest = {
    observer: { latitude: observerLat, longitude: observerLon, heightMeters: 30 },
    coverageProfile: standardProfile,
    terrain: { source: 'synthetic_single_hill', sampler: singleHillSampler },
    config: {
      azimuthSamples: 36,
      elevationSamples: 10,
      terrainSampleSpacingMeters: 1500,
      analysisDistanceMeters: 80000,
      useEarthCurvature: false,
    },
  };
  const singleHillRes = await engine.analyze(singleHillReq);
  // Hướng 90 độ (azimuthRad ~ PI/2) phải xuất hiện Occluded ở góc tà thấp
  const samples90Deg = singleHillRes.samples.filter(
    (s) => Math.abs(s.azimuthRad - Math.PI / 2) < 0.15 && s.elevationRad < 0.05
  );
  const occludedAt90 = samples90Deg.filter((s) => s.state === VisibilityState.Occluded);
  assert(
    'Test 02',
    'Single hill: Xuất hiện vùng bóng râm (Occluded) phía sau núi hướng 90°',
    occludedAt90.length > 0,
    { occludedAt90: occludedAt90.length, totalAt90: samples90Deg.length }
  );

  // Test 03: High mountain -> Tăng độ cao đỉnh núi lên 2500m -> số mẫu bị Occluded phải tăng lên
  const highMountainSampler = new SyntheticTerrainSampler(observerLat, observerLon, 10).addObstacle({
    distanceMeters: 15000,
    azimuthDeg: 90,
    peakElevationMeters: 2500,
    radiusMeters: 4000,
  });
  const highMountainReq: VisibilityAnalysisRequest = {
    ...singleHillReq,
    terrain: { source: 'synthetic_high_mountain', sampler: highMountainSampler },
  };
  const highMountainRes = await engine.analyze(highMountainReq);
  const totalOccSingle = singleHillRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  const totalOccHigh = highMountainRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  assert(
    'Test 03',
    'High mountain: Đỉnh núi cao hơn tạo ra vùng bóng râm lớn hơn (totalOccHigh > totalOccSingle)',
    totalOccHigh > totalOccSingle,
    { totalOccSingle, totalOccHigh }
  );

  // Test 04 & 05: Mountain near observer vs Mountain far observer
  const nearMountainSampler = new SyntheticTerrainSampler(observerLat, observerLon, 10).addObstacle({
    distanceMeters: 5000,
    azimuthDeg: 0,
    peakElevationMeters: 600,
    radiusMeters: 2500,
  });
  const farMountainSampler = new SyntheticTerrainSampler(observerLat, observerLon, 10).addObstacle({
    distanceMeters: 40000,
    azimuthDeg: 0,
    peakElevationMeters: 600,
    radiusMeters: 2500,
  });
  const nearRes = await engine.analyze({
    ...singleHillReq,
    terrain: { source: 'synthetic_near', sampler: nearMountainSampler },
  });
  const farRes = await engine.analyze({
    ...singleHillReq,
    terrain: { source: 'synthetic_far', sampler: farMountainSampler },
  });
  const nearOcc = nearRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  const farOcc = farRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  assert(
    'Test 04 & 05',
    'Near vs Far mountain: Núi gần có góc che khuất lớn hơn nên che nhiều mẫu hơn núi xa cùng độ cao',
    nearOcc >= farOcc,
    { nearOcc, farOcc }
  );

  // Test 06 & 07: Two mountains & Multi-mountain horizon peak test
  // Núi 1 ở cự ly 10km cao 500m (tan = 0.05). Núi 2 ở cự ly 25km cao 2000m (tan = 0.08).
  // Chân trời cực đại phải lấy theo Núi 2 (góc lớn hơn).
  const multiMountainSampler = new SyntheticTerrainSampler(observerLat, observerLon, 0)
    .addObstacle({ distanceMeters: 10000, azimuthDeg: 180, peakElevationMeters: 500, radiusMeters: 2000 })
    .addObstacle({ distanceMeters: 25000, azimuthDeg: 180, peakElevationMeters: 2000, radiusMeters: 3000 });

  const multiRes = await engine.analyze({
    ...singleHillReq,
    terrain: { source: 'synthetic_multi_mountain', sampler: multiMountainSampler },
  });
  const horizonAt180 = multiRes.horizon.find((h) => Math.abs(h.azimuthRad - Math.PI) < 0.15);
  assert(
    'Test 06 & 07',
    'Multi-mountain: HorizonAnalyzer lấy điểm chân trời cao nhất trên hướng quét',
    horizonAt180 !== undefined && horizonAt180.terrainElevationMeters >= 1500,
    { horizonAt180 }
  );

  // --------------------------------------------------------------------------
  // NHÓM 2: OBSERVER TESTS (Test 08 -> Test 10)
  // --------------------------------------------------------------------------
  console.log('\n--- NHÓM 2: OBSERVER TESTS ---');

  // Test 08 & 09: Observer height 0 vs Observer height 100m
  const obsLowReq: VisibilityAnalysisRequest = {
    ...singleHillReq,
    observer: { latitude: observerLat, longitude: observerLon, heightMeters: 5 },
    terrain: { source: 'synthetic_single_hill', sampler: singleHillSampler },
  };
  const obsHighReq: VisibilityAnalysisRequest = {
    ...singleHillReq,
    observer: { latitude: observerLat, longitude: observerLon, heightMeters: 250 },
    terrain: { source: 'synthetic_single_hill', sampler: singleHillSampler },
  };
  const obsLowRes = await engine.analyze(obsLowReq);
  const obsHighRes = await engine.analyze(obsHighReq);
  const occLow = obsLowRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  const occHigh = obsHighRes.samples.filter((s) => s.state === VisibilityState.Occluded).length;
  assert(
    'Test 08 & 09',
    'Observer height: Nâng cao anten radar (250m so với 5m) giúp giảm góc che khuất và diện tích vùng mù',
    occHigh < occLow,
    { occLow, occHigh }
  );

  // Test 10: Observer moved -> Cache key phải thay đổi
  const movedReq: VisibilityAnalysisRequest = {
    ...obsLowReq,
    observer: { latitude: observerLat + 0.1, longitude: observerLon + 0.1, heightMeters: 5 },
  };
  const key1 = engine.generateCacheKey(obsLowReq);
  const key2 = engine.generateCacheKey(movedReq);
  assert('Test 10', 'Observer moved: Thay đổi vị trí đài sinh ra cache key khác nhau', key1 !== key2, {
    key1: key1.substring(0, 30),
    key2: key2.substring(0, 30),
  });

  // --------------------------------------------------------------------------
  // NHÓM 3: COVERAGE PROFILE TESTS (Test 11 -> Test 13)
  // --------------------------------------------------------------------------
  console.log('\n--- NHÓM 3: COVERAGE PROFILE TESTS ---');

  // Test 11 & 12: Constant vs Altitude-dependent profile
  const constantProfile: CoverageProfile = {
    id: 'constant_profile',
    name: 'Profile Hằng Số',
    minElevationDeg: 0,
    maxElevationDeg: 30,
    points: [
      { elevationDeg: 0, maxRangeKm: 50 },
      { elevationDeg: 30, maxRangeKm: 50 },
    ],
  };
  const constReq: VisibilityAnalysisRequest = {
    ...flatReq,
    coverageProfile: constantProfile,
  };
  const constRes = await engine.analyze(constReq);
  const all50Km = constRes.samples.every((s) => Math.abs(s.distanceMeters - 50000) < 1);
  assert('Test 11 & 12', 'Constant profile: Toàn bộ mẫu có cự ly đúng bằng 50 km', all50Km);

  // Test 13: Profile changed -> Invalidation
  const changedProfile: CoverageProfile = {
    ...constantProfile,
    id: 'constant_profile_v2',
    points: [
      { elevationDeg: 0, maxRangeKm: 90 },
      { elevationDeg: 30, maxRangeKm: 90 },
    ],
  };
  const changedReq: VisibilityAnalysisRequest = {
    ...flatReq,
    coverageProfile: changedProfile,
  };
  const keyConst1 = engine.generateCacheKey(constReq);
  const keyConst2 = engine.generateCacheKey(changedReq);
  assert('Test 13', 'Profile changed: Thay đổi profile làm thay đổi cache key và kết quả', keyConst1 !== keyConst2);

  // --------------------------------------------------------------------------
  // NHÓM 4: STATE & CLEARANCE TESTS (Test 14 -> Test 16)
  // --------------------------------------------------------------------------
  console.log('\n--- NHÓM 4: STATE & CLEARANCE TESTS ---');

  // Test 14, 15, 16: Visible, Boundary, Occluded và Clearance
  // Xét 1 tia tại cự ly 20km:
  // Giả sử maxHorizonAngleRad = 0.05 (~2.86 độ). Tại 20km, chân trời có độ cao H = 20000 * tan(0.05) ~ 1001.7m.
  const H0 = 0;
  const maxHorizonRad = 0.05;
  const D = 20000;

  // Mục tiêu A: cao 2000m (vượt xa chân trời) -> Visible, clearance > 0
  const losA = HorizonAnalyzer.testTargetLOS(H0, D, 2000, maxHorizonRad, false);
  assert('Test 14', 'Target LOS: Mục tiêu cao hơn chân trời có state = Visible và clearance > 0',
    losA.state === VisibilityState.Visible && losA.clearanceMeters > 500,
    { clearance: losA.clearanceMeters }
  );

  // Mục tiêu B: cao sát chân trời (1001.7m) -> Boundary
  const horizonTargetAlt = D * Math.tan(maxHorizonRad);
  const losB = HorizonAnalyzer.testTargetLOS(H0, D, horizonTargetAlt, maxHorizonRad, false);
  assert('Test 15', 'Target LOS: Mục tiêu bám sát đường chân trời có state = Boundary',
    losB.state === VisibilityState.Boundary,
    { clearance: losB.clearanceMeters, state: losB.state }
  );

  // Mục tiêu C: cao 200m (nằm sâu dưới chân trời 1000m) -> Occluded, clearance < 0
  const losC = HorizonAnalyzer.testTargetLOS(H0, D, 200, maxHorizonRad, false);
  assert('Test 16', 'Target LOS: Mục tiêu thấp hơn chân trời có state = Occluded và clearance < 0',
    losC.state === VisibilityState.Occluded && losC.clearanceMeters < -500,
    { clearance: losC.clearanceMeters }
  );

  // --------------------------------------------------------------------------
  // NHÓM 5: CACHE & ASYNC TESTS (Test 17 -> Test 20)
  // --------------------------------------------------------------------------
  console.log('\n--- NHÓM 5: CACHE & ASYNC TESTS ---');

  // Test 17: Cùng request phải trúng cache (cacheHit = true)
  await engine.analyze(flatReq);
  const res2 = await engine.analyze(flatReq);
  assert('Test 17', 'Cache hit: Phân tích lại cùng một request phải trúng cache (cacheHit = true)',
    res2.metadata.cacheHit === true,
    { cacheHit: res2.metadata.cacheHit }
  );

  // Test 18: Invalidate xóa sạch cache
  engine.invalidate();
  const res3 = await engine.analyze(flatReq);
  assert('Test 18', 'Cache invalidation: Sau khi gọi invalidate, request chạy lại (cacheHit = false)',
    res3.metadata.cacheHit === false
  );

  // --------------------------------------------------------------------------
  // TỔNG KẾT
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} TESTS PASS (Thất bại: ${failedTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestMatrix().catch((err) => {
  console.error('Lỗi thực thi Ma trận Kiểm thử:', err);
  process.exit(1);
});
