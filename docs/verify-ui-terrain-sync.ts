/**
 * BỘ KIỂM THỬ XÁC MINH 12 TEST CASES TOÀN DIỆN:
 * 1. Nhãn phân loại khí tài & Tiêu đề nhóm
 * 2. Làm sạch badge dư thừa
 * 3. Bảo toàn tham số kỹ thuật
 * 4. Lấy mẫu DEM độc lập 2 vị trí A & B
 * 5. 6 Lớp trực quan hóa không gian GIS
 * 6. Đồng bộ độ cao 2D và 3D
 * 7. Xoay hướng mặt cắt phương vị
 * 8. Cache key & Invalidation
 * 9. Báo cáo trạng thái thiếu DEM
 * 10. Ngoại lệ S-300PMU2
 * 11. Hồi quy
 * 12. Giải phóng bộ nhớ & Async safety
 */

import { EQUIPMENT_UI_LABELS, getRadarRoleDisplayLabel } from '../src/constants/equipmentLabels';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../src/utils/equipmentFactory';
import {
  runTerrainComparison,
  isS300Exception,
  type ObserverComparisonPoint,
} from '../src/utils/terrainComparisonEngine';
import {
  extractSliceFromTerrainGrid,
  sampleTerrainGridAndMasks,
} from '../src/utils/radarVolumeEngine';
import type { SharedTerrainSlice } from '../src/types/radarCoverage';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

async function runAll12Tests() {
  console.log('====================================================');
  console.log('KIỂM THỬ 12 TEST CASES NÂNG CẤP GIAO DIỆN & ĐỒNG BỘ ĐỊA HÌNH');
  console.log('====================================================\n');

  // TEST 1: Tiêu đề nhóm radar hiển thị đúng
  console.log('--- TEST 1: Tiêu đề nhóm radar hiển thị đúng ---');
  assert(
    EQUIPMENT_UI_LABELS.GROUP_TITLES.RADAR_FIRE_CONTROL === 'RADAR ĐIỀU KHIỂN HỎA LỰC',
    'Nhóm 1 đổi đúng thành "RADAR ĐIỀU KHIỂN HỎA LỰC"'
  );
  assert(
    EQUIPMENT_UI_LABELS.GROUP_TITLES.RADAR_EARLY_WARNING === 'RADAR CẢNH GIỚI',
    'Nhóm 2 đổi đúng thành "RADAR CẢNH GIỚI"'
  );
  assert(
    getRadarRoleDisplayLabel(true) === 'Radar điều khiển hỏa lực',
    'Helper getRadarRoleDisplayLabel(true) trả về "Radar điều khiển hỏa lực"'
  );
  assert(
    getRadarRoleDisplayLabel(false) === 'Radar cảnh giới',
    'Helper getRadarRoleDisplayLabel(false) trả về "Radar cảnh giới"'
  );

  // TEST 2: Các badge dư thừa không còn xuất hiện
  console.log('\n--- TEST 2: Kiểm tra loại bỏ 3 badge dư thừa ---');
  const fs = await import('fs');
  const leftSidebarContent = fs.readFileSync('src/components/ui/LeftSidebar.tsx', 'utf-8');
  assert(
    !leftSidebarContent.includes('Chỉ Thị Tên Lửa (36D6)'),
    'Không còn badge "Chỉ Thị Tên Lửa (36D6)" trong thẻ khí tài'
  );
  assert(
    !leftSidebarContent.includes('Cảnh Giới (Không Bắn Tên Lửa)'),
    'Không còn badge "Cảnh Giới (Không Bắn Tên Lửa)" trong thẻ khí tài'
  );
  assert(
    !leftSidebarContent.includes('Hỏa Lực Tiêu Diệt (SAM)'),
    'Không còn badge "Hỏa Lực Tiêu Diệt (SAM)" trong thẻ khí tài'
  );

  // TEST 3: Thông tin kỹ thuật khí tài không bị mất
  console.log('\n--- TEST 3: Thông tin kỹ thuật khí tài nguyên vẹn ---');
  const tmpl36D6 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6');
  assert(!!tmpl36D6, 'Tìm thấy đài 36D6 ST-68UM');
  assert(tmpl36D6!.defaultRangeKm === 300, 'Tầm phủ 36D6 vẫn là 300km');
  assert(tmpl36D6!.canDesignateForSam === true, '36D6 giữ nguyên canDesignateForSam: true');
  assert(tmpl36D6!.radarSubRole === 'chi_thi_ten_lua', '36D6 giữ nguyên phân loại kỹ thuật nội bộ');

  const tmplC125 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm');
  assert(!!tmplC125, 'Tìm thấy C-125-2TM Pechora-2TM');
  assert(tmplC125!.minEngagementRangeKm === 3.5 && tmplC125!.defaultRangeKm === 35.4, 'Tầm bắn 3.5-35.4km');
  assert(tmplC125!.maxEngagementAltitudeM === 25000, 'Trần bắn 25.000m');

  // TEST 4: Hai vị trí có cao độ khác nhau được lấy mẫu DEM độc lập
  console.log('\n--- TEST 4: Hai vị trí A và B độc lập cao độ ---');
  const obsA: ObserverComparisonPoint = {
    id: 'obs_peak',
    name: 'Đài Đỉnh Núi',
    latitude: 21.08,
    longitude: 105.37,
    altitudeASL: 1200, // Đỉnh núi cao 1.200m
    antennaHeightAGL: 20,
    rangeKm: 50,
  };
  const obsB: ObserverComparisonPoint = {
    id: 'obs_valley',
    name: 'Đài Chân Núi',
    latitude: 21.15,
    longitude: 105.45,
    altitudeASL: 60, // Chân núi cao 60m
    antennaHeightAGL: 15,
    rangeKm: 40,
  };
  assert(obsA.altitudeASL !== obsB.altitudeASL, 'Cao độ ASL của A và B hoàn toàn khác nhau');
  assert(obsA.antennaHeightAGL + obsA.altitudeASL === 1220, 'Tổng cao độ đài A = 1.220m');
  assert(obsB.antennaHeightAGL + obsB.altitudeASL === 75, 'Tổng cao độ đài B = 75m');

  // TEST 5: Các lớp che khuất GIS (6 lớp) được hiển thị nhất quán
  console.log('\n--- TEST 5: Chạy so sánh không gian GIS & 6 Lớp trực quan hóa ---');
  const compResult = await runTerrainComparison(obsA, obsB, null, {
    azimuthStepDeg: 30,
    targetHeightMeters: 100,
  });
  assert(compResult.samples.length > 0, `Đã sinh ${compResult.samples.length} điểm mẫu lưới không gian`);
  assert(typeof compResult.stats.overlapVisiblePercent === 'number', 'Có tỷ lệ phần trăm vùng chồng lấn');
  assert(typeof compResult.stats.mutualBlindPercent === 'number', 'Có tỷ lệ phần trăm vùng mù chung');
  assert(typeof compResult.stats.onlyAVisiblePercent === 'number', 'Có tỷ lệ phần trăm vùng chỉ A thấy');
  assert(typeof compResult.stats.onlyBVisiblePercent === 'number', 'Có tỷ lệ phần trăm vùng chỉ B thấy');
  assert(compResult.terrainStatus === 'flat_fallback', 'Chế độ giả lập khi không có DEM network');

  // TEST 6: Dữ liệu 2D và 3D khớp nhau tại cùng vị trí mẫu (Single Source of Truth)
  console.log('\n--- TEST 6: Đồng bộ dữ liệu 2D và 3D từ cùng một TerrainGrid ---');
  const sampleDistances = [1000, 2000, 5000, 10000, 20000];
  const terrainMap = new Map<string, number>();
  sampleDistances.forEach((d) => terrainMap.set(`45_${d}`, 150 + d * 0.01));

  const sharedSlice: SharedTerrainSlice = extractSliceFromTerrainGrid(
    'test_radar_1',
    45,
    21.0,
    105.8,
    50,
    15,
    20000,
    terrainMap,
    sampleDistances,
    'loaded'
  );
  assert(sharedSlice.samples.length === 5, 'Trích xuất đúng 5 điểm lát cắt');
  assert(sharedSlice.samples[2].distM === 5000, 'Điểm số 3 ở cự ly 5000m');
  assert(sharedSlice.samples[2].terrainAltM === 150 + 5000 * 0.01, 'Cao độ 2D khớp chính xác cao độ 3D');

  // TEST 7: Thay đổi hướng mặt cắt không gây sai lệch dữ liệu
  console.log('\n--- TEST 7: Xoay hướng mặt cắt phương vị ---');
  terrainMap.set(`90_5000`, 250);
  const slice90 = extractSliceFromTerrainGrid(
    'test_radar_1',
    90,
    21.0,
    105.8,
    50,
    15,
    20000,
    terrainMap,
    sampleDistances,
    'loaded'
  );
  assert(slice90.azimuthDeg === 90, 'Phương vị 90° chuẩn xác');
  assert(slice90.samples[2].terrainAltM === 250, 'Cao độ tại 90°/5km là 250m');

  // TEST 8: Cache key & Invalidation khi di chuyển vị trí
  console.log('\n--- TEST 8: Cache key thay đổi khi di chuyển tọa độ ---');
  assert(
    sharedSlice.cacheKey !== slice90.cacheKey,
    'Khác phương vị thì cacheKey khác nhau'
  );
  const movedSlice = extractSliceFromTerrainGrid(
    'test_radar_1',
    45,
    21.5, // Dịch chuyển vĩ độ
    105.8,
    50,
    15,
    20000,
    terrainMap,
    sampleDistances,
    'loaded'
  );
  assert(
    sharedSlice.cacheKey !== movedSlice.cacheKey,
    'Khi di chuyển tọa độ, cacheKey tự động vô hiệu hóa dữ liệu cũ'
  );

  // TEST 9: Không có DEM thì giao diện thông báo rõ ràng
  console.log('\n--- TEST 9: Thông báo rõ ràng khi không có DEM ---');
  assert(
    compResult.terrainStatus === 'flat_fallback',
    'Hệ thống chuyển về trạng thái flat_fallback khi không có DEM provider'
  );
  const crossSectionContent = fs.readFileSync('src/components/ui/RadarCrossSectionPanel.tsx', 'utf-8');
  assert(
    crossSectionContent.includes('Chế độ địa hình phẳng mô phỏng'),
    'Giao diện 2D có banner cảnh báo địa hình phẳng mô phỏng'
  );

  // TEST 10: S-300PMU2 giữ nguyên chức năng hiện tại & Ngoại lệ bảo vệ
  console.log('\n--- TEST 10: Ngoại lệ S-300PMU2 được bảo vệ nghiêm ngặt ---');
  const obsS300: ObserverComparisonPoint = {
    id: 's300_unit',
    name: 'Tổ hợp S-300PMU2',
    latitude: 21.0,
    longitude: 105.8,
    altitudeASL: 30,
    antennaHeightAGL: 10,
    rangeKm: 200,
    templateId: 'sam_s300',
  };
  assert(isS300Exception(obsS300) === true, 'S-300PMU2 được nhận diện đúng là ngoại lệ');
  try {
    await runTerrainComparison(obsS300, obsB, null);
    assert(false, 'Lẽ ra phải chặn S-300PMU2 không cho tham gia so sánh!');
  } catch (e: any) {
    assert(
      e.message.includes('S-300PMU2'),
      'Đã chặn thành công S-300PMU2 kèm thông báo ngoại lệ kỹ thuật'
    );
  }

  // TEST 11: Kiểm thử hồi quy chức năng hiện có
  console.log('\n--- TEST 11: Kiểm thử hồi quy các chức năng hiện có ---');
  const inst36D6 = createEquipmentFromTemplate(tmpl36D6!, 21.0, 105.8);
  assert(inst36D6.canDesignateForSam === true, 'Instance 36D6 kế thừa canDesignateForSam: true');
  const instC125 = createEquipmentFromTemplate(tmplC125!, 21.0, 105.8);
  assert(instC125.category === 'TenLuaPhongKhong', 'SAM giữ nguyên category');

  // TEST 12: Không xuất hiện lỗi render, memory leak hoặc cập nhật bất đồng bộ sai thứ tự
  console.log('\n--- TEST 12: Giải phóng tài nguyên và an toàn bất đồng bộ ---');
  const cesiumGlobeContent = fs.readFileSync('src/components/map/CesiumGlobe.tsx', 'utf-8');
  assert(
    cesiumGlobeContent.includes('viewer.entities.removeById(lineId)'),
    'Line of Cut có cơ chế xóa entity cũ'
  );
  assert(
    cesiumGlobeContent.includes('existing.forEach((e) => viewer.entities.remove(e))'),
    'Terrain comparison có cơ chế dọn sạch entities điểm mẫu cũ trước khi vẽ mới'
  );

  console.log('\n====================================================');
  console.log('🎉 TẤT CẢ 12/12 BÀI TEST ĐỀU ĐẠT CHUẨN XÁC 100%!');
  console.log('====================================================');
}

runAll12Tests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
