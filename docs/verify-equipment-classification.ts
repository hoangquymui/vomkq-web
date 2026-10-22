import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../src/utils/equipmentFactory';

console.log('--- TEST PHÂN LOẠI KHÍ TÀI & RADAR CHỈ THỊ ---');

// 1. Kiểm tra 36D6
const r36d6 = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6');
if (!r36d6 || r36d6.canDesignateForSam !== true || r36d6.radarSubRole !== 'chi_thi_ten_lua') {
  console.error('Lỗi: radar_36d6 không đạt chuẩn canDesignateForSam!');
  process.exit(1);
}
console.log('✓ Đài 36D6 ST-68UM: canDesignateForSam = true, radarSubRole = chi_thi_ten_lua');

// 2. Kiểm tra các đài cảnh giới khác
const otherRadars = ['radar_p18', 'radar_1l13_55zh6', 'radar_vrs2dm', 'radar_p18_terek'];
for (const id of otherRadars) {
  const r = EQUIPMENT_TEMPLATES.find((t) => t.id === id);
  if (!r || r.canDesignateForSam !== false || r.radarSubRole !== 'canh_gioi_nhin_vong') {
    console.error(`Lỗi: Radar ${id} không đạt chuẩn cảnh giới nhìn vòng!`);
    process.exit(1);
  }
}
console.log('✓ Các đài P-18M, Nebo, VRS-2DM: canDesignateForSam = false, radarSubRole = canh_gioi_nhin_vong');

// 3. Kiểm tra tổ hợp tên lửa
const samTemplates = EQUIPMENT_TEMPLATES.filter((t) => t.category === 'TenLuaPhongKhong');
if (samTemplates.length !== 4) {
  console.error(`Lỗi: Kỳ vọng 4 tổ hợp tên lửa nhưng tìm thấy ${samTemplates.length}`);
  process.exit(1);
}
console.log(`✓ Tìm thấy đủ ${samTemplates.length} tổ hợp tên lửa: S-300PMU2, C-125-2TM, C-125M, SPYDER`);

// 4. Kiểm tra kế thừa qua factory
const samInst = createEquipmentFromTemplate(r36d6, {
  latitude: 21.0,
  longitude: 105.8,
  altitude: 25,
});
if (samInst.canDesignateForSam !== true || samInst.radarSubRole !== 'chi_thi_ten_lua') {
  console.error('Lỗi: Instance của 36D6 không kế thừa canDesignateForSam!');
  process.exit(1);
}
console.log('✓ Instance 36D6 kế thừa chuẩn xác canDesignateForSam = true');

console.log('🎉 XÁC MINH PHÂN LOẠI KHÍ TÀI THÀNH CÔNG 100%!');
process.exit(0);
