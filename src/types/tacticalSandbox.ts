/**
 * Kiểu dữ liệu và hằng số tham số cho Sa bàn Tác chiến Mô phỏng (Tactical Radar Sandbox)
 * 
 * Tuân thủ Project Development Rules:
 * Mọi thông số chiến thuật đều được ghi chú rõ ràng về tên biến, type, giá trị mặc định,
 * đơn vị, phạm vi hợp lệ, ý nghĩa và quan hệ với các thông số khác.
 */

/**
 * Giao diện hiển thị thị giác cho Sa bàn 3D
 * - monochrome : Nền đen tuyền, địa hình nhô màu trắng/xám bạc (Phong cách SAR / Radar độ tương phản cao)
 * - crt_green  : Tông xanh huỳnh quang đặc trưng của màn hiện sóng radar P-18 / Kolchuga
 * - amber      : Tông vàng hổ phách dịu mắt phục vụ tác chiến ban đêm
 */
export type SandboxVisualTheme = 'monochrome' | 'crt_green' | 'amber';

/**
 * Vai trò / Chủng loại lực lượng tác chiến tầm thấp trên sa bàn
 */
export type TacticalUnitRole =
  | 'manpads_igla'       // Tổ tên lửa phòng không vác vai Igla-S / 9K338
  | 'visual_observer'    // Tổ trinh sát mắt / Đài quan sát phòng không (OP)
  | 'aa_gun_23mm'        // Khẩu đội pháo cao xạ ZU-23-2
  | 'decoy_radar'        // Trận địa giả / Đài phát bức xạ mồi nhử (Decoy)
  | 'command_post';      // Sở chỉ huy tiền phương / Trạm thông tin

/**
 * Cấu hình mẫu cho từng loại lực lượng chiến thuật
 */
export interface TacticalUnitPreset {
  role: TacticalUnitRole;
  name: string;
  shortName: string;
  description: string;
  /**
   * Bán kính tác chiến / quan sát hiệu quả
   * - Tên biến: rangeM
   * - Type: number
   * - Đơn vị: mét (m)
   * - Phạm vi hợp lệ: 500m - 10000m
   */
  rangeM: number;
  /**
   * Trần bắn / Trần quan sát tối đa
   * - Tên biến: maxHeightM
   * - Type: number
   * - Đơn vị: mét (m)
   * - Phạm vi hợp lệ: 100m - 5000m
   */
  maxHeightM: number;
  /**
   * Độ cao tác chiến tối thiểu
   * - Tên biến: minHeightM
   * - Type: number
   * - Đơn vị: mét (m)
   * - Phạm vi hợp lệ: 0m - 100m
   */
  minHeightM: number;
  colorHex: string;
  iconName: string;
}

/**
 * Bảng thông số định mức chuẩn quân sự cho các lực lượng chiến thuật
 * Nguồn tham khảo: Giáo trình Vũ khí phòng không - Tên lửa vác vai Igla-S, Pháo ZU-23-2
 */
export const TACTICAL_UNIT_PRESETS: Record<TacticalUnitRole, TacticalUnitPreset> = {
  manpads_igla: {
    role: 'manpads_igla',
    name: 'Tổ Tên lửa Vác vai Igla-S',
    shortName: 'Igla-S',
    description: 'Tên lửa đất đối không tầm thấp 9K338, tự dẫn hồng ngoại đón lõng tại khe núi',
    rangeM: 6000,         // 6.0 km
    maxHeightM: 3500,     // 3.5 km
    minHeightM: 10,       // 10 m
    colorHex: '#10b981',  // Emerald Green
    iconName: 'Crosshair',
  },
  visual_observer: {
    role: 'visual_observer',
    name: 'Tổ Trinh sát Mắt / Đài Quan sát',
    shortName: 'Đài quan sát',
    description: 'Phát hiện mục tiêu bay thấp lách địa hình bằng khí tài quang học & mắt thường',
    rangeM: 5000,         // 5.0 km
    maxHeightM: 2500,     // 2.5 km
    minHeightM: 0,        // 0 m
    colorHex: '#eab308',  // Yellow / Amber
    iconName: 'Eye',
  },
  aa_gun_23mm: {
    role: 'aa_gun_23mm',
    name: 'Khẩu đội Pháo Cao xạ 23mm ZU-23-2',
    shortName: 'ZU-23-2',
    description: 'Hỏa lực phòng không đánh gần đón lõng tại cửa thoát của thung lũng',
    rangeM: 2500,         // 2.5 km
    maxHeightM: 2000,     // 2.0 km
    minHeightM: 0,        // 0 m
    colorHex: '#f97316',  // Orange
    iconName: 'ShieldAlert',
  },
  decoy_radar: {
    role: 'decoy_radar',
    name: 'Trận địa Nghi binh / Mồi nhử',
    shortName: 'Trận địa giả',
    description: 'Thu hút tên lửa chống bức xạ diệt radar (HARM) bảo vệ đài radar thật',
    rangeM: 1500,         // 1.5 km
    maxHeightM: 500,      // 0.5 km
    minHeightM: 0,
    colorHex: '#a855f7',  // Purple
    iconName: 'Radio',
  },
  command_post: {
    role: 'command_post',
    name: 'Sở Chỉ huy Tiền phương',
    shortName: 'Sở chỉ huy',
    description: 'Chỉ huy hiệp đồng hỏa lực phân tầng và truyền chỉ thị mục tiêu',
    rangeM: 2000,         // 2.0 km
    maxHeightM: 1000,     // 1.0 km
    minHeightM: 0,
    colorHex: '#06b6d4',  // Cyan
    iconName: 'Building',
  },
};

/**
 * Một thực thể đơn vị chiến thuật được triển khai trên Sa bàn
 */
export interface TacticalSandboxUnit {
  id: string;
  role: TacticalUnitRole;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Độ cao địa hình mặt đất tại vị trí cắm cờ (ASL)
   * - Tên biến: altitudeM
   * - Type: number
   * - Đơn vị: mét (m)
   */
  altitudeM: number;
  /** Bán kính hỏa lực / quan sát (m) */
  rangeM: number;
  /** Trần bắn tối đa (m) */
  maxHeightM: number;
  /** Độ cao tối thiểu (m) */
  minHeightM: number;
  colorHex: string;
  iconName: string;
  deployedAt: number;
}

/**
 * Điểm mốc trên quỹ đạo bay luồn lách khe núi của UAV đối phương
 */
export interface InfiltrationWaypoint {
  lat: number;
  lon: number;
  /**
   * Độ cao bay so với mực nước biển (ASL)
   * - Tên biến: altitudeM
   * - Type: number
   * - Đơn vị: mét (m)
   */
  altitudeM: number;
  /**
   * Độ cao bay thực tế so với mặt đất địa hình (AGL)
   * - Tên biến: heightAglM
   * - Type: number
   * - Đơn vị: mét (m)
   * - Mặc định: 60m (bay bám địa hình Nap-of-the-Earth)
   */
  heightAglM: number;
  /**
   * Bị radar chính quét thấy hay nằm trong bóng che khuất địa hình
   * - true: Bị radar phát hiện (Lộ diện)
   * - false: Ẩn náu trong bóng che khuất của núi (Tàng hình)
   */
  isCoveredByRadar: boolean;
  /**
   * Bị lực lượng chốt chặn đón lõng (MANPADS/Pháo) bao quát
   */
  isCoveredByInterception: boolean;
  /** Đơn vị nào đang bao quát điểm này */
  interceptedByUnitId?: string;
  /** Khoảng cách từ radar chính (m) */
  distanceFromRadarM: number;
}

/**
 * Đường bay mô phỏng xâm nhập Nap-of-the-Earth của UAV / Tên lửa hành trình
 */
export interface InfiltrationSimulationRoute {
  id: string;
  name: string;
  targetType: 'UAV Trinh sát' | 'Drone Cảm tử Kamikaze' | 'Tên lửa Hành trình';
  /**
   * Vận tốc bay giả định của mục tiêu
   * - Tên biến: targetSpeedMps
   * - Type: number
   * - Đơn vị: mét trên giây (m/s)
   * - Mặc định: 50 m/s (~180 km/h) cho UAV, 220 m/s (~800 km/h) cho tên lửa hành trình
   */
  targetSpeedMps: number;
  waypoints: InfiltrationWaypoint[];
  /** Tiến độ mô phỏng hiện tại từ 0 (bắt đầu) tới 1 (kết thúc) */
  currentProgress: number;
  /**
   * Trạng thái tác chiến của mục tiêu tại vị trí hiện tại:
   * - stealth: Đang lẩn trốn trong khe núi, radar chưa thấy
   * - detected: Bị radar chính phát hiện (lộ diện trên màn hình)
   * - intercepted: Bị tổ hỏa lực đón lõng bắn hạ / khống chế
   */
  status: 'stealth' | 'detected' | 'intercepted';
  currentPosition?: {
    lat: number;
    lon: number;
    altM: number;
  };
  totalDistanceM: number;
  detectedRatioPercent: number; // Tỷ lệ lộ diện trên toàn tuyến
  interceptedRatioPercent: number; // Tỷ lệ bị hỏa lực đón lõng bao quát
}

/**
 * Gợi ý điểm cao khống chế từ AI Cố vấn tác chiến (Tactical AI Co-pilot)
 */
export interface InterceptionSuggestion {
  id: string;
  role: TacticalUnitRole;
  latitude: number;
  longitude: number;
  elevationM: number;
  reliefM: number; // Độ nhô so với thung lũng xung quanh (m)
  slopeDeg: number;
  score: number; // Điểm đánh giá vị trí (0 - 100)
  reason: string;
  targetedCorridorAzimuthDeg: number;
}
