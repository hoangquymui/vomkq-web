/**
 * Verification test for radar 3D dome and volume altitude slicing
 * Run with: npx tsx docs/verify-radar-dome-altitude-slice.ts
 */
import assert from 'assert';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../src/utils/equipmentFactory';
import { computeRadarCoverageVolume } from '../src/utils/radarVolumeEngine';
import {
  buildRadarVolumeGeometry,
  buildRadarOccludedVolumeGeometry,
} from '../src/utils/radarVolumeGeometry';

async function runTests() {
  console.log('--- TEST BẮT ĐẦU: KIỂM CHỨNG CẮT LÁT VÒM RADAR 3D THEO ĐỘ CAO ĐƯỢC CHỌN ---');

  const tmpl36d6 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6')!;
  assert(tmpl36d6, 'Template radar 36D6 phải tồn tại');

  // Giả lập điểm đặt radar tại Đà Nẵng: MSL = 156m, anten = 12m, tổng = 168m MSL
  const inst = createEquipmentFromTemplate(tmpl36d6, {
    latitude: 16.029,
    longitude: 108.176,
    altitude: 156,
  });
  inst.antennaHeightAGL = 12;
  inst.rangeKm = 60; // Tầm cự ly khi chọn H = 500m

  console.log(`[1] Đang tính toán Volume cho đài ${inst.name} (ASL=${inst.altitude}m)...`);
  const volume = await computeRadarCoverageVolume(inst, null, {
    azimuthStepDeg: 10,
    radialStepMeters: 2000,
  });

  assert(volume, 'Volume phải được tạo');
  assert(volume.altitudeBands.length >= 5, 'Volume phải có nhiều tầng độ cao');
  console.log('   Các tầng độ cao trong Volume:', volume.altitudeBands);

  // 1. Kiểm chứng khi chọn H = 300m
  console.log('\n[2] Kiểm tra dựng hình học vòm với H = 300m:');
  const volGeom300 = buildRadarVolumeGeometry(volume, {
    mode: 'terrain-aware',
    selectedAltitudeM: 300,
  });
  assert(volGeom300, 'volGeom300 phải dựng thành công');

  const expectedZ300 = 300 - volume.radarAltM; // 300 - 156 = 144m
  console.log(`   Độ cao apexHeightM đo được: ${volGeom300.apexHeightM}m (Kỳ vọng: ${expectedZ300}m)`);
  assert(
    Math.abs(volGeom300.apexHeightM - expectedZ300) < 1.0,
    `apexHeightM phải xấp xỉ ${expectedZ300}m nhưng nhận được ${volGeom300.apexHeightM}m`
  );

  // Kiểm tra không có đỉnh nào trong positions vượt quá 144m
  let maxZ300 = -Infinity;
  for (let i = 2; i < volGeom300.positions.length; i += 3) {
    if (volGeom300.positions[i] > maxZ300) maxZ300 = volGeom300.positions[i];
  }
  console.log(`   Tọa độ Z lớn nhất của mọi đỉnh: ${maxZ300}m`);
  assert(
    maxZ300 <= expectedZ300 + 0.1,
    `Không có đỉnh nào được vượt quá đỉnh lát cắt ${expectedZ300}m (tìm thấy ${maxZ300}m)`
  );
  console.log('   => PASS: Vòm 3D tại 300m thấp hơn nhiều so với núi (Bà Nà ~1487m, Sơn Trà ~696m)!');

  // 2. Kiểm chứng khi chọn H = 500m
  console.log('\n[3] Kiểm tra dựng hình học vòm với H = 500m:');
  const volGeom500 = buildRadarVolumeGeometry(volume, {
    mode: 'terrain-aware',
    selectedAltitudeM: 500,
  });
  assert(volGeom500, 'volGeom500 phải dựng thành công');

  const expectedZ500 = 500 - volume.radarAltM; // 500 - 156 = 344m
  console.log(`   Độ cao apexHeightM đo được: ${volGeom500.apexHeightM}m (Kỳ vọng: ${expectedZ500}m)`);
  assert(
    Math.abs(volGeom500.apexHeightM - expectedZ500) < 1.0,
    `apexHeightM phải xấp xỉ ${expectedZ500}m nhưng nhận được ${volGeom500.apexHeightM}m`
  );

  let maxZ500 = -Infinity;
  for (let i = 2; i < volGeom500.positions.length; i += 3) {
    if (volGeom500.positions[i] > maxZ500) maxZ500 = volGeom500.positions[i];
  }
  console.log(`   Tọa độ Z lớn nhất của mọi đỉnh: ${maxZ500}m`);
  assert(
    maxZ500 <= expectedZ500 + 0.1,
    `Không có đỉnh nào được vượt quá đỉnh lát cắt ${expectedZ500}m (tìm thấy ${maxZ500}m)`
  );
  console.log('   => PASS: Vòm 3D tại 500m kết thúc chính xác ở 500m MSL!');

  // 3. Kiểm chứng khi chọn H = 100m (tầng thấp nhất trong bảng)
  console.log('\n[4] Kiểm tra dựng hình học vòm với H = 100m (tầng thấp nhất):');
  const volGeom100 = buildRadarVolumeGeometry(volume, {
    mode: 'terrain-aware',
    selectedAltitudeM: 100,
  });
  assert(volGeom100, 'volGeom100 phải dựng thành công và không bị null');
  console.log(`   Số tam giác: ${volGeom100.triangleCount}, apexHeightM: ${volGeom100.apexHeightM}m`);
  console.log('   => PASS: Tầng 100m vẫn dựng thành công khối 3D!');

  // 4. Kiểm chứng khi không truyền selectedAltitudeM (mặc định lấy toàn bộ trần cao nhất 30km)
  console.log('\n[5] Kiểm tra dựng hình học vòm khi không truyền selectedAltitudeM (toàn bộ vòm 30km):');
  const volGeomFull = buildRadarVolumeGeometry(volume, {
    mode: 'terrain-aware',
  });
  assert(volGeomFull, 'volGeomFull phải dựng thành công');
  const expectedZFull = 30000 - volume.radarAltM;
  console.log(`   Độ cao apexHeightM đo được: ${volGeomFull.apexHeightM}m (Kỳ vọng: ${expectedZFull}m)`);
  assert(
    Math.abs(volGeomFull.apexHeightM - expectedZFull) < 1.0,
    `Toàn bộ vòm phải đạt tới trần kỹ thuật ${expectedZFull}m`
  );
  console.log('   => PASS: Trần tối đa khi không cắt lát vẫn đạt đúng 30,000m!');

  console.log('\n=== TẤT CẢ CÁC BÀI TEST ĐỀU THÀNH CÔNG VƯỢT TRỘI! ===');
}

runTests().catch((err) => {
  console.error('TEST THẤT BẠI:', err);
  process.exit(1);
});
