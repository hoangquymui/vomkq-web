import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../src/utils/equipmentFactory';
import {
  computeSamCoverage,
  calculateDistanceMeters,
  calculateBearingDeg,
  destinationPoint,
  isPointVisibleToRadar,
} from '../src/utils/samCoverageEngine';
import type { EquipmentInstance } from '../src/types/equipment';
import type { RadarCoverageVolume } from '../src/types/radarCoverage';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('KIỂM THỬ CẮT ĐỊA HÌNH TÊN LỬA & GỘP VÙNG MÙ RADAR');
  console.log('====================================================\n');

  // Khởi tạo Đài Radar 36D6 tại Đà Nẵng
  const tmpl36D6 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6')!;
  const radar36D6 = createEquipmentFromTemplate(tmpl36D6, {
    latitude: 16.043,
    longitude: 108.1208,
    altitude: 103,
    nameIndex: 1,
  });

  // Khởi tạo Tổ hợp Tên Lửa C-125-2TM tại Quảng Trị / Huế
  const tmplC125 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')!;

  console.log('--- TEST 1: Tự động liên kết Radar (Auto-link) khi đặt Tên Lửa ---');
  // Khi đã có đài 36D6 trên bản đồ, tạo C-125 và truyền existingInstances
  const samInstance = createEquipmentFromTemplate(tmplC125, {
    latitude: 16.36,
    longitude: 107.46,
    altitude: 261,
    nameIndex: 2,
    existingInstances: [radar36D6],
  });

  assert(samInstance.designatedRadarId === radar36D6.instanceId, 'C-125 tự động liên kết với đài 36D6 (#1)');
  assert(samInstance.samTerrainMaskMode === 'intersection', 'C-125 tự động kích hoạt chế độ intersection (gộp cả 2 điều kiện)');

  console.log('\n--- TEST 2: Tính toán Hình học Trắc địa Geodesic WGS84 ---');
  const distBetweenM = calculateDistanceMeters(
    radar36D6.latitude,
    radar36D6.longitude,
    samInstance.latitude,
    samInstance.longitude
  );
  const bearingRadToSam = calculateBearingDeg(
    radar36D6.latitude,
    radar36D6.longitude,
    samInstance.latitude,
    samInstance.longitude
  );

  console.log(`- Khoảng cách từ Radar 36D6 đến C-125: ${(distBetweenM / 1000).toFixed(1)}km`);
  console.log(`- Phương vị từ Radar 36D6 đến C-125: ${bearingRadToSam.toFixed(1)}°`);
  assert(distBetweenM > 70000 && distBetweenM < 90000, 'Khoảng cách giữa Đà Nẵng và Quảng Trị ~75-80km chuẩn xác');
  assert(bearingRadToSam > 290 && bearingRadToSam < 330, 'Phương vị từ Đà Nẵng tới Quảng Trị là Tây Bắc (~305°)');

  console.log('\n--- TEST 3: Kiểm tra Nhìn thấy của Radar (isPointVisibleToRadar) ---');
  // Điểm P1 nằm ngay sát đài radar (khoảng cách 10km) -> nhìn thấy
  const p1 = destinationPoint(radar36D6.latitude, radar36D6.longitude, 10000, 45);
  const isP1Vis = isPointVisibleToRadar(p1.lat, p1.lon, radar36D6);
  assert(isP1Vis === true, 'Điểm P1 trong tầm nhìn thấy rõ của Radar');

  // Điểm P2 nằm ngoài tầm quét của đài 36D6 (> 300km)
  const p2 = destinationPoint(radar36D6.latitude, radar36D6.longitude, 350000, 45);
  const isP2Vis = isPointVisibleToRadar(p2.lat, p2.lon, radar36D6);
  assert(isP2Vis === false, 'Điểm P2 ngoài tầm quét 300km của Radar bị loại bỏ chuẩn xác');

  // Điểm P3 nằm ở hướng bị núi chắn trong dữ liệu radarVolume
  const mockRadarVolume: RadarCoverageVolume = {
    radarId: radar36D6.instanceId,
    radarName: radar36D6.name,
    calculatedAt: Date.now(),
    cacheKey: 'test_key',
    radarLat: radar36D6.latitude,
    radarLon: radar36D6.longitude,
    radarAltM: 143,
    antennaHeightAGL: 40,
    minElevationDeg: -10,
    maxElevationDeg: 40,
    maxRangeKm: 300,
    coverageHeightKm: 25,
    altitudeBands: [500, 1000, 5000],
    azimuthSamples: [0, 90, 180, 270, 310],
    nominalRanges: [[300000, 300000, 300000, 300000, 300000]],
    // Tại hướng 310° (hướng về phía sau dãy núi), tầm quét bị chắn ở 30km
    effectiveRanges: [[300000, 300000, 300000, 300000, 30000]],
    innerConeRadii: [0, 0, 0],
    visibilityStates: [],
    bandInfos: [],
    terrainStatus: 'loaded',
    calculationState: 'READY',
  };

  // Điểm P3 ở hướng 310° cự ly 60km (> 30km che khuất)
  const p3 = destinationPoint(radar36D6.latitude, radar36D6.longitude, 60000, 310);
  const isP3Vis = isPointVisibleToRadar(p3.lat, p3.lon, radar36D6, {
    radarVolume: mockRadarVolume,
    targetAltitudeM: 500,
  });
  assert(isP3Vis === false, 'Điểm P3 nằm trong vùng che khuất (vùng mù) của radar bị loại bỏ hoàn toàn');

  console.log('\n--- TEST 4: Tính toán Vùng Hỏa Lực SAM Cắt Địa Hình (computeSamCoverage) ---');
  // Chạy tính toán SAM Coverage với chế độ organic
  const resOrganic = await computeSamCoverage(samInstance, null, {
    config: { maskMode: 'organic', dMaxM: 35400, dMinM: 3500 },
  });
  assert(resOrganic.polygonPositions.length === 361, 'Đa giác hỏa lực có đủ 360 tia khép kín (361 đỉnh)');
  assert(resOrganic.nominalAreaKm2 > 3000, 'Diện tích danh định hợp lệ');

  // Chạy tính toán SAM Coverage với chế độ intersection hiệp đồng radar bị che khuất
  const resIntersection = await computeSamCoverage(samInstance, null, {
    config: { maskMode: 'intersection', dMaxM: 35400, dMinM: 3500 },
    linkedRadar: radar36D6,
    linkedRadarVolume: mockRadarVolume,
  });

  assert(resIntersection.linkedRadarId === radar36D6.instanceId, 'Kết quả ghi nhận đài radar liên kết');
  assert(resIntersection.maskMode === 'intersection', 'Chế độ hoạt động là intersection');
  assert(resIntersection.polygonPositions.length === 361, 'Đa giác sau gộp dữ liệu vẫn khép kín trọn vẹn');

  console.log('\n--- TEST 5: Đa giác khép kín hợp lệ (PolygonHierarchy) ---');
  const firstPt = resIntersection.polygonPositions[0];
  const lastPt = resIntersection.polygonPositions[resIntersection.polygonPositions.length - 1];
  assert(
    Math.abs(firstPt.lat - lastPt.lat) < 1e-6 && Math.abs(firstPt.lon - lastPt.lon) < 1e-6,
    'Đỉnh đầu và đỉnh cuối trùng khớp tuyệt đối, khép kín đa giác Cesium PolygonHierarchy'
  );

  console.log('\n====================================================');
  console.log('🎉 TẤT CẢ 5/5 BÀI TEST CẮT ĐỊA HÌNH & GỘP VÙNG MÙ RADAR ĐỀU ĐẠT 100%!');
  console.log('====================================================');
}

runTests().catch((e) => {
  console.error('Lỗi khi chạy test:', e);
  process.exit(1);
});
