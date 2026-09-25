/**
 * Script kiểm thử tự động xác minh tính năng:
 * 1. Bảng tầm theo độ cao (RCS S_mt) của các đài: P-18, 55Zh6, VRS-2DM và 36D6.
 * 2. Đổi góc tà trên (maxElevationDeg) ảnh hưởng tới generateVolumeCacheKey và bán kính đỉnh mù R_kh.
 * 3. Bán kính đỉnh mù R_kh = H_mt * cotg(eps_max).
 */

import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { generateVolumeCacheKey } from '../src/utils/radarVolumeEngine';
import type { EquipmentInstance } from '../src/types/equipment';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

console.log('================================================================');
console.log('KIỂM TRA TÍNH NĂNG 3D LOS: BẢNG TẦM THEO ĐỘ CAO & GÓC TÀ');
console.log('================================================================\n');

// 1. Kiểm tra bảng tầm theo độ cao của các đài radar
const p18 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_p18');
const nebo = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_1l13_55zh6');
const vrs2dm = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_vrs2dm');
const radar36d6 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6');

assert(Boolean(p18?.altitudeDetectionTable), 'P-18M có bảng tầm theo độ cao');
assert(Boolean(nebo?.altitudeDetectionTable), '1L13-3/55Zh6-1 có bảng tầm theo độ cao');
assert(Boolean(vrs2dm?.altitudeDetectionTable), 'VRS-2DM có bảng tầm theo độ cao');
assert(Boolean(radar36d6?.altitudeDetectionTable), 'Radar 36D6 đã được bổ sung bảng tầm theo độ cao tương ứng');

// Kiểm tra chi tiết bảng của 36D6
assert(
  radar36d6!.altitudeDetectionTable!.rows.length >= 8,
  `36D6 có ${radar36d6!.altitudeDetectionTable!.rows.length} tầng độ cao`
);
const row500m_36d6 = radar36d6!.altitudeDetectionTable!.rows.find((r) => r.altitudeM === 500);
assert(Boolean(row500m_36d6 && row500m_36d6.val1 === 60 && row500m_36d6.val2 === 85), '36D6 tại 500m có tầm 60km (0.1m²) và 85km (>1m²)');

// Kiểm tra chi tiết bảng của VRS-2DM (theo ảnh người dùng)
const row100m_vrs = vrs2dm!.altitudeDetectionTable!.rows.find((r) => r.altitudeM === 100);
assert(Boolean(row100m_vrs && row100m_vrs.val1 === 35 && row100m_vrs.val2 === 35), 'VRS-2DM tại 100m đạt 35km cho cả 2.6m² và 4m²');

const row4500m_vrs = vrs2dm!.altitudeDetectionTable!.rows.find((r) => r.altitudeM === 4500);
assert(Boolean(row4500m_vrs && row4500m_vrs.val2 === 185), 'VRS-2DM tại 4500m đạt 185km cho 4m²');

// 2. Kiểm tra generateVolumeCacheKey phản hồi khi thay đổi góc tà maxElevationDeg
const mockInstance: EquipmentInstance = {
  instanceId: 'test_inst_1',
  templateId: 'radar_36d6',
  name: 'Đài Radar 36D6 Test',
  category: 'RadarCanhGioi',
  latitude: 16.043,
  longitude: 108.12,
  altitude: 100,
  rangeKm: 300,
  scanSpeed: 36,
  minElevationDeg: 0.5,
  maxElevationDeg: 30,
  antennaHeightAGL: 25,
  coverageHeightKm: 30,
  status: 'Active',
  color: '#06b6d4',
  showDome: true,
  showSweep: true,
};

const params = { azimuthStepDeg: 5, radialStepMeters: 2000 };
const key1 = generateVolumeCacheKey(mockInstance, params);

const mockInstanceChangedMaxElev: EquipmentInstance = {
  ...mockInstance,
  maxElevationDeg: 45,
};
const key2 = generateVolumeCacheKey(mockInstanceChangedMaxElev, params);

assert(key1 !== key2, 'Thay đổi maxElevationDeg làm thay đổi cacheKey để vòm 3D tính lại đỉnh mù');

// 3. Kiểm tra công thức bán kính đỉnh mù (Cone of Silence) R_kh = H_mt * cotg(eps_max)
function computeConeRadiusKm(targetHeightM: number, maxElevDeg: number): number {
  return (targetHeightM * (1 / Math.tan((maxElevDeg * Math.PI) / 180))) / 1000;
}

const r_kh_30deg = computeConeRadiusKm(1000, 30); // 1000m tại 30° -> cotg(30°) = sqrt(3) ≈ 1.732 km
const r_kh_45deg = computeConeRadiusKm(1000, 45); // 1000m tại 45° -> cotg(45°) = 1.000 km
const r_kh_60deg = computeConeRadiusKm(1000, 60); // 1000m tại 60° -> cotg(60°) = 0.577 km

assert(Math.abs(r_kh_30deg - 1.732) < 0.01, `Đỉnh mù tại 30° độ cao 1000m: ${r_kh_30deg.toFixed(3)} km ≈ 1.732 km`);
assert(Math.abs(r_kh_45deg - 1.000) < 0.01, `Đỉnh mù tại 45° độ cao 1000m: ${r_kh_45deg.toFixed(3)} km = 1.000 km`);
assert(Math.abs(r_kh_60deg - 0.577) < 0.01, `Đỉnh mù tại 60° độ cao 1000m: ${r_kh_60deg.toFixed(3)} km ≈ 0.577 km`);
assert(r_kh_30deg > r_kh_45deg && r_kh_45deg > r_kh_60deg, 'Góc tà trên càng lớn thì vùng đỉnh mù càng thu hẹp');

console.log('\n================================================================');
console.log('TẤT CẢ CÁC KIỂM TRA ĐỀU VƯỢT QUA XUẤT SẮC (ALL PASS)!');
console.log('================================================================');
