import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';

console.log('=== BẮT ĐẦU KIỂM TRA CHUẨN HÓA GỘP CỨNG RADAR VÀO TỔ HỢP TÊN LỬA ===\n');

// 1. Kiểm tra các Radar được gộp cứng
const integratedRadarIds = [
  'radar_36d6',
  'radar_96l6e',
  'radar_p19',
  'radar_el_m_2084',
  'radar_30n6e1',
  'radar_snr125_2tm',
  'radar_snr125',
  'radar_p18_terek',
];

console.log('1. Kiểm tra cờ isIntegratedOnly của các đài Radar thuộc tổ hợp:');
for (const id of integratedRadarIds) {
  const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === id);
  if (!tmpl) {
    console.error(`❌ Không tìm thấy template cho radar: ${id}`);
    process.exit(1);
  }
  if (!tmpl.isIntegratedOnly) {
    console.error(`❌ Radar ${id} (${tmpl.name}) CHƯA được đặt isIntegratedOnly: true!`);
    process.exit(1);
  }
  console.log(`  ✅ ${tmpl.name} (id: ${tmpl.id}) -> isIntegratedOnly = true (Đã ẩn khỏi catalog đơn lẻ)`);
}

// 2. Kiểm tra danh sách 3 Radar cảnh giới độc lập
const standaloneRadars = EQUIPMENT_TEMPLATES.filter(
  (t) => t.category === 'RadarCanhGioi' && !t.isIntegratedOnly
);

console.log('\n2. Kiểm tra danh sách Radar cảnh giới độc lập (Catalog LeftSidebar):');
console.log(`  Số lượng: ${standaloneRadars.length} đài (Kỳ vọng: đúng 3 đài)`);
if (standaloneRadars.length !== 3) {
  console.error(`❌ Số lượng radar cảnh giới độc lập không đúng 3: tìm thấy ${standaloneRadars.length}`);
  process.exit(1);
}
for (const r of standaloneRadars) {
  console.log(`  ✅ ${r.name} (id: ${r.id})`);
}

// 3. Kiểm tra 4 Tổ Hợp Tên Lửa Phòng Không
const samTemplates = EQUIPMENT_TEMPLATES.filter((t) => t.category === 'TenLuaPhongKhong');
console.log(`\n3. Kiểm tra 4 Tổ Hợp Tên Lửa Phòng Không (${samTemplates.length} tổ hợp):`);

for (const sam of samTemplates) {
  const cfg = sam.batteryConfig;
  if (!cfg) {
    console.error(`❌ Tổ hợp ${sam.name} thiếu batteryConfig!`);
    process.exit(1);
  }
  console.log(`\n  * Tổ hợp: ${sam.name} (id: ${sam.id})`);
  console.log(`    - Loại biên chế: ${cfg.batteryType}`);
  console.log(`    - Số lượng bệ phóng: ${cfg.launcherCount} bệ (${cfg.launcherName})`);
  console.log(`    - Đài chỉ thị (TAR): ${cfg.tarRadarName} (id: ${cfg.tarRadarId})`);
  console.log(`    - Tầm TAR: ${cfg.tarRangeKm} km, Trần: ${cfg.tarHeightKm} km, AGL: ${cfg.tarAglM} m`);
  console.log(`    - Đài dẫn bắn (FCR): ${cfg.fcrRadarName} (id: ${cfg.fcrRadarId})`);
  console.log(`    - Tầm FCR: ${cfg.fcrRangeKm} km, Góc quạt: ${cfg.fcrSectorAngleDeg}°, Phễu mù: ${cfg.fcrBlindConeDeg}°`);
  console.log(`    - Vùng WEZ: D_min ${cfg.minEngagementRangeKm}km - D_max ${cfg.maxEngagementRangeKm}km (Vòng đón ${cfg.maxLaunchRangeKm}km)`);
  console.log(`    - Độ cao tiêu diệt: H_min ${cfg.minEngagementAltitudeM}m - H_max ${cfg.maxEngagementAltitudeM}m`);

  // Kiểm tra cấu hình đổi nhanh đài TAR trên S-300
  if (sam.id === 'sam_s300') {
    if (!cfg.alternateTarOptions || cfg.alternateTarOptions.length < 2) {
      console.error(`❌ S-300 thiếu alternateTarOptions cho 96L6E và 36D6!`);
      process.exit(1);
    }
    console.log(`    - Tùy chọn đổi nhanh TAR: ${cfg.alternateTarOptions.map((o) => o.name).join(' ⟷ ')}`);
  }

  // Kiểm tra số bệ Pechora = 3, S-300/SPYDER = 4
  if (sam.id === 'sam_c125m' || sam.id === 'sam_c125_2tm') {
    if (cfg.launcherCount !== 3) {
      console.error(`❌ Pechora C-125 (${sam.id}) phải có 3 bệ phóng (tìm thấy ${cfg.launcherCount})!`);
      process.exit(1);
    }
  } else {
    if (cfg.launcherCount !== 4) {
      console.error(`❌ Tổ hợp ${sam.id} phải có 4 bệ phóng (tìm thấy ${cfg.launcherCount})!`);
      process.exit(1);
    }
  }
}

console.log('\n======================================================');
console.log('✅ TOÀN BỘ KIỂM TRA ĐÃ VƯỢT QUA 100% THÀNH CÔNG!');
console.log('======================================================');
