import type { EquipmentTemplate, PresetLocation } from '../types/equipment';

export const EQUIPMENT_TEMPLATES: EquipmentTemplate[] = [
  {
    id: 'radar_36d6',
    name: 'Đài Radar 36D6 (ST-68UM)',
    category: 'RadarCanhGioi',
    categoryNameVi: 'Radar Cảnh Giới',
    description: 'Radar 3D cảnh giới và chỉ thị mục tiêu tầm trung-xa, bám sát các mục tiêu bay thấp và tên lửa hành trình.',
    defaultRangeKm: 300,
    defaultScanSpeed: 36, // 6 vòng/phút = 36 deg/s
    minElevationDeg: 0.5,
    maxElevationDeg: 30,
    antennaHeightAGL: 25,
    coverageHeightKm: 30,
    symbolColor: '#06b6d4', // Cyan
    iconName: 'Radar',
    wavelengthM: 0.1, // Sóng dm (S-band ~10cm)
    coverageProfile: {
      id: 'prof_36d6',
      name: 'Giản đồ 36D6 ST-68UM',
      minElevationDeg: 0.5,
      maxElevationDeg: 30,
      points: [
        { elevationDeg: 0.5, maxRangeKm: 300 },
        { elevationDeg: 2.0, maxRangeKm: 300 },
        { elevationDeg: 5.0, maxRangeKm: 260 },
        { elevationDeg: 10.0, maxRangeKm: 180 },
        { elevationDeg: 15.0, maxRangeKm: 120 },
        { elevationDeg: 20.0, maxRangeKm: 80 },
        { elevationDeg: 30.0, maxRangeKm: 40 },
      ],
    },
  },
  {
    id: 'radar_p18',
    name: 'Đài Radar P-18M (Spoon Rest)',
    category: 'RadarCanhGioi',
    categoryNameVi: 'Radar Cảnh Giới',
    description: 'Radar cảnh giới sóng mét (VHF) chống máy bay tàng hình, tầm phát hiện xa, khả năng kháng nhiễu cao.',
    defaultRangeKm: 250,
    defaultScanSpeed: 24, // 4 vòng/phút = 24 deg/s
    minElevationDeg: 0,
    maxElevationDeg: 25,
    antennaHeightAGL: 12,
    coverageHeightKm: 25,
    symbolColor: '#0ea5e9', // Sky blue
    iconName: 'Radio',
    wavelengthM: 2.0, // Sóng mét (VHF ~2m)
    coverageProfile: {
      id: 'prof_p18',
      name: 'Giản đồ P-18M Spoon Rest',
      minElevationDeg: 0,
      maxElevationDeg: 25,
      points: [
        { elevationDeg: 0.0, maxRangeKm: 250 },
        { elevationDeg: 2.0, maxRangeKm: 250 },
        { elevationDeg: 4.0, maxRangeKm: 230 },
        { elevationDeg: 8.0, maxRangeKm: 170 },
        { elevationDeg: 14.0, maxRangeKm: 100 },
        { elevationDeg: 20.0, maxRangeKm: 55 },
        { elevationDeg: 25.0, maxRangeKm: 25 },
      ],
    },
  },
  {
    id: 'radar_kolchuga',
    name: 'Trạm Trinh sát Thụ động Kolchuga-M',
    category: 'TramQuanSat',
    categoryNameVi: 'Trạm Trinh Sát',
    description: 'Hệ thống định vị vô tuyến thụ động (ESM), không phát sóng radar, phát hiện mục tiêu qua tín hiệu phát xạ điện từ.',
    defaultRangeKm: 400,
    defaultScanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 45,
    antennaHeightAGL: 18,
    coverageHeightKm: 40,
    symbolColor: '#8b5cf6', // Violet
    iconName: 'Antenna',
    coverageProfile: {
      id: 'prof_kolchuga',
      name: 'Giản đồ Thụ động Kolchuga-M',
      minElevationDeg: 0,
      maxElevationDeg: 45,
      points: [
        { elevationDeg: 0.0, maxRangeKm: 400 },
        { elevationDeg: 5.0, maxRangeKm: 380 },
        { elevationDeg: 12.0, maxRangeKm: 300 },
        { elevationDeg: 20.0, maxRangeKm: 200 },
        { elevationDeg: 30.0, maxRangeKm: 120 },
        { elevationDeg: 45.0, maxRangeKm: 50 },
      ],
    },
  },
  {
    id: 'sam_s300',
    name: 'Tổ hợp Tên lửa SAM S-300PMU2 (Favorit)',
    category: 'TenLuaPhongKhong',
    categoryNameVi: 'Tên Lửa Phòng Không',
    description: 'Tổ hợp tên lửa phòng không tầm xa chiến lược, đánh chặn máy bay và tên lửa đạn đạo chiến thuật.',
    defaultRangeKm: 200,
    defaultScanSpeed: 0,
    minElevationDeg: 3,
    maxElevationDeg: 65,
    antennaHeightAGL: 8,
    coverageHeightKm: 27,
    symbolColor: '#ef4444', // Red
    iconName: 'Crosshair',
    coverageProfile: {
      id: 'prof_s300',
      name: 'Khu vực Tiêu diệt S-300PMU2',
      minElevationDeg: 3,
      maxElevationDeg: 65,
      points: [
        { elevationDeg: 3.0, maxRangeKm: 200 },
        { elevationDeg: 15.0, maxRangeKm: 200 },
        { elevationDeg: 30.0, maxRangeKm: 170 },
        { elevationDeg: 45.0, maxRangeKm: 110 },
        { elevationDeg: 65.0, maxRangeKm: 35 },
      ],
    },
  },
  {
    id: 'sam_spyder',
    name: 'Tổ hợp Tên lửa Cơ động Spyder-MR',
    category: 'TenLuaPhongKhong',
    categoryNameVi: 'Tên Lửa Phòng Không',
    description: 'Tổ hợp tên lửa phòng không cơ động tầm trung phản ứng nhanh, trang bị đầu dò hồng ngoại và radar chủ động.',
    defaultRangeKm: 50,
    defaultScanSpeed: 0,
    minElevationDeg: 5,
    maxElevationDeg: 75,
    antennaHeightAGL: 5,
    coverageHeightKm: 16,
    symbolColor: '#f97316', // Orange
    iconName: 'Zap',
    coverageProfile: {
      id: 'prof_spyder',
      name: 'Khu vực Tiêu diệt Spyder-MR',
      minElevationDeg: 5,
      maxElevationDeg: 75,
      points: [
        { elevationDeg: 5.0, maxRangeKm: 50 },
        { elevationDeg: 20.0, maxRangeKm: 50 },
        { elevationDeg: 40.0, maxRangeKm: 42 },
        { elevationDeg: 60.0, maxRangeKm: 25 },
        { elevationDeg: 75.0, maxRangeKm: 12 },
      ],
    },
  },
  {
    id: 'c2_command_post',
    name: 'Sở Chỉ Huy Tác Chiến C2 (SCH)',
    category: 'SoChiHuy',
    categoryNameVi: 'Sở Chỉ Huy',
    description: 'Trung tâm chỉ huy tác chiến phòng không, tích hợp dữ liệu radar, phân chia hoả lực và điều khiển tác chiến.',
    defaultRangeKm: 80,
    defaultScanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 90,
    antennaHeightAGL: 30,
    coverageHeightKm: 15,
    symbolColor: '#eab308', // Yellow/Gold
    iconName: 'ShieldAlert',
    coverageProfile: {
      id: 'prof_c2',
      name: 'Phạm vi Chỉ huy C2',
      minElevationDeg: 0,
      maxElevationDeg: 90,
      points: [
        { elevationDeg: 0.0, maxRangeKm: 80 },
        { elevationDeg: 45.0, maxRangeKm: 80 },
        { elevationDeg: 90.0, maxRangeKm: 80 },
      ],
    },
  },
  {
    id: 'aaa_zsu23',
    name: 'Pháo Phòng Không Tự Hành ZSU-23-4 Shilka',
    category: 'PhaoPhongKhong',
    categoryNameVi: 'Pháo Phòng Không',
    description: 'Pháo phòng không 4 nòng 23mm tự hành tích hợp radar điều khiển bắn RPK-2, tiêu diệt mục tiêu tầm thấp.',
    defaultRangeKm: 5,
    defaultScanSpeed: 45,
    minElevationDeg: -4,
    maxElevationDeg: 85,
    antennaHeightAGL: 4,
    coverageHeightKm: 3,
    symbolColor: '#10b981', // Emerald
    iconName: 'Target',
    coverageProfile: {
      id: 'prof_zsu23',
      name: 'Xạ giới Pháo ZSU-23-4',
      minElevationDeg: -4,
      maxElevationDeg: 85,
      points: [
        { elevationDeg: -4.0, maxRangeKm: 3.5 },
        { elevationDeg: 0.0, maxRangeKm: 5.0 },
        { elevationDeg: 30.0, maxRangeKm: 5.0 },
        { elevationDeg: 60.0, maxRangeKm: 3.8 },
        { elevationDeg: 85.0, maxRangeKm: 2.0 },
      ],
    },
  }
];

export const PRESET_LOCATIONS: PresetLocation[] = [
  {
    id: 'tamdao',
    name: '⛰️ Đỉnh Tam Đảo (Radar Núi)',
    latitude: 21.458,
    longitude: 105.645,
    height: 9000,
    heading: 45,
    pitch: -25
  },
  {
    id: 'fansipan',
    name: '🏔️ Đỉnh Fansipan (Dãy Hoàng Liên Sơn)',
    latitude: 22.303,
    longitude: 103.775,
    height: 12000,
    heading: 30,
    pitch: -25
  },
  {
    id: 'bavi',
    name: '⛰️ Dãy Ba Vì & Tây Hà Nội',
    latitude: 21.08,
    longitude: 105.36,
    height: 15000,
    heading: 90,
    pitch: -30
  },
  {
    id: 'haivan',
    name: '⛰️ Đèo Hải Vân (Đà Nẵng - Huế)',
    latitude: 16.195,
    longitude: 108.131,
    height: 14000,
    heading: 120,
    pitch: -25
  },
  {
    id: 'hanoi',
    name: 'Thủ đô Hà Nội',
    latitude: 21.028511,
    longitude: 105.854167,
    height: 80000,
    pitch: -45
  },
  {
    id: 'haiphong',
    name: 'Hải Phòng & Vịnh Bắc Bộ',
    latitude: 20.844912,
    longitude: 106.688084,
    height: 90000,
    pitch: -45
  },
  {
    id: 'danang',
    name: 'Đà Nẵng & Miền Trung',
    latitude: 16.054407,
    longitude: 108.202167,
    height: 90000,
    pitch: -45
  },
  {
    id: 'tphcm',
    name: 'TP. Hồ Chí Minh & Nam Bộ',
    latitude: 10.823099,
    longitude: 106.629664,
    height: 90000,
    pitch: -45
  },
  {
    id: 'truongsa',
    name: 'Quần đảo Trường Sa',
    latitude: 9.5,
    longitude: 112.5,
    height: 500000,
    pitch: -55
  },
  {
    id: 'vietnam_overview',
    name: 'Toàn cảnh Lãnh thổ Việt Nam',
    latitude: 16.0,
    longitude: 107.5,
    height: 1800000,
    pitch: -75
  }
];
