/**
 * KỊCH BẢN KIỂM THỬ TỰ ĐỘNG: SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL RADAR SANDBOX)
 * ============================================================================
 * 
 * Chạy bằng: npx tsx docs/verify-tactical-sandbox.ts
 */

import {
  findDeepestRadarBlindCorridors,
  generateInfiltrationRoute,
  evaluateRouteInterception,
  getUavPositionAtProgress,
  generateTacticalAiSuggestions,
} from '../src/utils/tacticalInfiltrationEngine';
import { generateElevationRampCanvas } from '../src/utils/tacticalSandboxShading';
import { TACTICAL_UNIT_PRESETS, type TacticalSandboxUnit } from '../src/types/tacticalSandbox';
import type { RadarCoverageField, RayCoverageData } from '../src/types/radarCoverage';

console.log('=================================================================');
console.log('🧪 BẮT ĐẦU KIỂM THỬ HỆ THỐNG SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL SANDBOX)');
console.log('=================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} - ${detail ?? ''}`);
    failCount++;
  }
}

// 1. Dựng dữ liệu giả định RadarCoverageField tại Tam Đảo (Lat: 21.45, Lon: 105.65)
// Tạo 1 tia góc phương vị 45° bị chắn bởi dãy núi tại cự ly 8,000m (cao 900m),
// phía sau từ 8,000m đến 30,000m là thung lũng sâu (cao 120m) nằm trong bóng che khuất (Radar Shadow).
const mockSamples = [];
for (let d = 500; d <= 30000; d += 500) {
  const isOccludedByRidge = d > 8000;
  mockSamples.push({
    distanceM: d,
    lat: 21.45 + (d / 111000) * 0.7,
    lon: 105.65 + (d / 111000) * 0.7,
    rayAltM: 300 + (d * 0.02),
    terrainAltM: d === 8000 ? 900 : d > 8000 ? 120 : 150,
    isVisible: !isOccludedByRidge,
    isShadow: isOccludedByRidge,
  });
}

const mockRay45: RayCoverageData = {
  azimuthDeg: 45,
  elevationDeg: 0.5,
  maxRangeM: 30000,
  visibleEndM: 8000,
  shadowStartM: 8000,
  hasOcclusion: true,
  occlusionPoint: {
    distanceM: 8000,
    lat: 21.45 + (8000 / 111000) * 0.7,
    lon: 105.65 + (8000 / 111000) * 0.7,
    terrainAltM: 900,
  },
  samples: mockSamples,
};

const mockField: RadarCoverageField = {
  instanceId: 'radar_36d6_test',
  radarName: 'Đài Radar Cảnh Giới 36D6-M',
  calculatedAt: Date.now(),
  cacheKey: 'test_key',
  radarLat: 21.45,
  radarLon: 105.65,
  radarAltM: 350,
  antennaHeightAGL: 20,
  profileId: 'radar_36d6',
  minElevationDeg: 0.5,
  maxElevationDeg: 30,
  maxRangeKm: 30,
  minHeightM: 50,
  maxHeightM: 10000,
  targetHeightM: 60,
  terrainStatus: 'loaded',
  rays: [mockRay45],
  azimuthRays: { 45: [mockRay45] },
  totalRays: 1,
  occludedRaysCount: 1,
  coverageRatioPercent: 40,
  coneOfSilenceRadiusKm: 1.5,
  radarHorizonKm: 45,
};

// TEST 1: Phát hiện hành lang mù radar (Blind Corridor)
console.log('TEST 1: Phát hiện hành lang mù radar từ dữ liệu LOS');
const corridors = findDeepestRadarBlindCorridors(mockField, 5000);
assert(corridors.length === 1, 'Số lượng hành lang phát hiện được', `Thực tế: ${corridors.length}`);
assert(corridors[0]?.azimuthDeg === 45, 'Góc phương vị hành lang là 45°', `Thực tế: ${corridors[0]?.azimuthDeg}`);
assert(corridors[0]?.shadowDepthM === 22000, 'Độ sâu bóng che khuất là 22,000m (30km - 8km)', `Thực tế: ${corridors[0]?.shadowDepthM}`);

// TEST 2: Sinh đường bay luồn khe núi (Infiltration Route)
console.log('\nTEST 2: Tự động sinh đường bay luồn lách Nap-of-the-Earth');
const route = generateInfiltrationRoute(mockField, {
  corridorAzimuthDeg: 45,
  targetType: 'Drone Cảm tử Kamikaze',
  targetSpeedMps: 60,
  heightAglM: 60,
});

assert(route !== null, 'Tạo thành công đường bay xâm nhập', 'Route is null');
if (route) {
  assert(route.waypoints.length > 5, 'Số lượng mốc waypoints trên tuyến > 5', `Thực tế: ${route.waypoints.length}`);
  assert(route.targetSpeedMps === 60, 'Vận tốc bay đặt đúng 60 m/s', `Thực tế: ${route.targetSpeedMps}`);
  assert(route.waypoints[0].heightAglM === 60, 'Độ cao bay bám địa hình H_AGL = 60m', `Thực tế: ${route.waypoints[0].heightAglM}`);
  assert(route.status === 'stealth', 'UAV khởi đầu ở trạng thái tàng hình (Stealth) trong khe núi', `Thực tế: ${route.status}`);
}

// TEST 3: Đón lõng hỏa lực (Interception by Tactical Unit)
console.log('\nTEST 3: Kiểm tra giao cắt đón lõng bằng tổ MANPADS Igla-S');
if (route) {
  // Bố trí 1 tổ MANPADS tại mỏm núi đón đầu (khoảng cách 15km dọc theo thung lũng)
  const targetWp = route.waypoints[Math.floor(route.waypoints.length / 2)];
  const testUnit: TacticalSandboxUnit = {
    id: 'test_igla_1',
    role: 'manpads_igla',
    name: 'Tổ Igla-S Đón Lõng',
    latitude: targetWp.lat,
    longitude: targetWp.lon,
    altitudeM: 200, // Đặt trên đồi cạnh thung lũng
    rangeM: TACTICAL_UNIT_PRESETS.manpads_igla.rangeM, // 6,000m
    maxHeightM: TACTICAL_UNIT_PRESETS.manpads_igla.maxHeightM,
    minHeightM: TACTICAL_UNIT_PRESETS.manpads_igla.minHeightM,
    colorHex: TACTICAL_UNIT_PRESETS.manpads_igla.colorHex,
    iconName: TACTICAL_UNIT_PRESETS.manpads_igla.iconName,
    deployedAt: Date.now(),
  };

  const updatedRoute = evaluateRouteInterception(route, [testUnit]);
  assert(updatedRoute.interceptedRatioPercent > 0, 'Tỷ lệ bị đón lõng tăng lên > 0%', `Thực tế: ${updatedRoute.interceptedRatioPercent}%`);
  
  // Kiểm tra nội suy vị trí UAV tại điểm bị đón lõng
  const interceptedProgress = 0.5;
  const uavPos = getUavPositionAtProgress(updatedRoute, interceptedProgress);
  assert(uavPos !== null, 'Tính toán thành công vị trí nội suy 3D của UAV', 'uavPos is null');
  if (uavPos) {
    assert(uavPos.status === 'intercepted', 'UAV chuyển sang trạng thái bị tiêu diệt [intercepted] khi bay qua vòm hỏa lực', `Thực tế: ${uavPos.status}`);
  }
}

// TEST 4: AI Cố vấn Đề xuất Điểm cao Chốt chặn (Tactical AI Co-pilot)
console.log('\nTEST 4: AI Cố vấn đề xuất điểm cao khống chế khe mù');
const suggestions = generateTacticalAiSuggestions(mockField, []);
assert(suggestions.length > 0, 'AI sinh ra các gợi ý điểm cao', `Số gợi ý: ${suggestions.length}`);
if (suggestions.length > 0) {
  assert(suggestions[0].role === 'manpads_igla', 'Gợi ý ưu tiên số 1 là tổ MANPADS', `Thực tế: ${suggestions[0].role}`);
  assert(suggestions[0].elevationM === 900, 'Cao độ điểm cao gợi ý trùng với đỉnh núi che khuất (900m)', `Thực tế: ${suggestions[0].elevationM}m`);
  assert(suggestions[0].score >= 90, 'Điểm đánh giá vị trí chiến thuật >= 90', `Thực tế: ${suggestions[0].score}`);
}

// TEST 5: Kiểm tra dải màu Canvas Gradient của bộ hiển thị
console.log('\nTEST 5: Khởi tạo 1D Canvas Gradient cho bộ phối màu thị giác');
const canvasMono = generateElevationRampCanvas('monochrome');
const canvasGreen = generateElevationRampCanvas('crt_green');
const canvasAmber = generateElevationRampCanvas('amber');
assert(canvasMono.width === 256, 'Canvas Monochrome tạo thành công kích thước 256x1', `Width: ${canvasMono.width}`);
assert(canvasGreen.width === 256, 'Canvas CRT Green tạo thành công kích thước 256x1', `Width: ${canvasGreen.width}`);
assert(canvasAmber.width === 256, 'Canvas Amber HUD tạo thành công kích thước 256x1', `Width: ${canvasAmber.width}`);

console.log('\n=================================================================');
console.log(`🏁 KẾT QUẢ KIỂM THỬ: ${passCount} PASSED, ${failCount} FAILED`);
console.log('=================================================================');

if (failCount > 0) {
  process.exit(1);
}
