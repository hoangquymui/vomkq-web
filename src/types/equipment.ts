import type { CoverageProfile } from './radarCoverage';

export type EquipmentCategory =
  | 'RadarCanhGioi'
  | 'TenLuaPhongKhong'
  | 'SoChiHuy'
  | 'PhaoPhongKhong'
  | 'CamBienThuDong'
  | 'TramQuanSat';

export type OperationalStatus = 'Active' | 'Standby' | 'Maintenance' | 'Offline';

/**
 * Cấu hình tạm thời bật/tắt hiển thị mô hình 3D khí tài trên quả cầu Cesium 3D.
 * - false (mặc định hiện tại): Tạm thời không thêm mô hình 3D vào, chỉ chấm điểm đặt (tâm đài / cờ tác chiến).
 * - true: Sau này khi người dùng chuẩn bị đầy đủ bộ mô hình 3D chuẩn sẽ kích hoạt lại toàn diện.
 */
export const ENABLE_3D_MODELS = false;

/**
 * Phân loại vai trò radar đối với tác chiến tên lửa phòng không:
 * - 'chi_thi_ten_lua': Radar 3D đo 3 tọa độ (phương vị, cự ly, độ cao), chỉ thị mục tiêu và cung cấp phần tử bắn cho tên lửa (Ví dụ: Đài Radar 36D6 ST-68UM).
 * - 'canh_gioi_nhin_vong': Radar 2D/VHF cảnh giới phát hiện sớm từ xa, không đo cao 3D trực tiếp để dẫn bắn tên lửa (Ví dụ: P-18M, Nebo, VRS-2DM...).
 */
export type RadarSubRole = 'chi_thi_ten_lua' | 'canh_gioi_nhin_vong';

/**
 * Chế độ cắt địa hình và hiệp đồng vùng hỏa lực tên lửa:
 * - 'organic': Vòm tên lửa tự cắt địa hình độc lập (theo độ cao và góc che khuất từ vị trí đặt trận địa tên lửa).
 * - 'linked_radar': Tên lửa chỉ được phép bắn trong phạm vi mà đài radar chỉ thị mục tiêu liên kết quan sát được (kế thừa góc che khuất của radar).
 * - 'intersection': Giao thoa hỏa lực kép: Vừa bị giới hạn bởi địa hình tại trận địa tên lửa, vừa phải nằm trong vùng quét của đài radar chỉ thị (V_SAM ∩ V_Radar).
 */
export type SamTerrainMaskMode = 'organic' | 'linked_radar' | 'intersection';

export interface AltitudeDetectionRow {
  altitudeM: number; // Độ cao mục tiêu (m)
  val1: number | string; // Cự ly phát hiện cột 1 (km)
  val2?: number | string; // Cự ly phát hiện cột 2 (km) nếu có
}

export interface AltitudeDetectionTable {
  headers: string[]; // Tên các cột (ví dụ: ["Độ cao (m)", "S_mt > 1m² (km)"])
  rows: AltitudeDetectionRow[];
}

export interface EquipmentTemplate {
  id: string;
  name: string;
  category: EquipmentCategory;
  categoryNameVi: string;
  description: string;
  defaultRangeKm: number;
  defaultScanSpeed: number; // deg / sec
  minElevationDeg: number;
  maxElevationDeg: number;
  antennaHeightAGL: number; // meters
  coverageHeightKm: number;
  symbolColor: string;
  /**
   * Màu vỏ vòm phủ sóng riêng của loại đài (hex). Tuỳ chọn.
   * Thứ tự ưu tiên màu vòm hiệu dụng: domeColorOverride -> domeColor (template) -> instance.color
   * Nguồn: vomkq-web/docs/dome-video-match/README.md mục 5.
   */
  domeColor?: string;
  iconName: string;
  wavelengthM?: number; // Bước sóng của đài (m): sóng mét ~2m, sóng cm ~0.05m
  coverageProfile?: CoverageProfile;
  altitudeDetectionTable?: AltitudeDetectionTable;
  minEngagementRangeKm?: number; // Cự ly xạ giới tối thiểu (km) cho Tên Lửa / Pháo
  maxEngagementAltitudeM?: number; // Trần bắn tiêu diệt tối đa (m)
  minEngagementAltitudeM?: number; // Độ cao tiêu diệt tối thiểu (m), ví dụ 20m cho C-125
  maxTargetSpeedMps?: number; // Vận tốc mục tiêu tối đa có thể tiêu diệt (m/s)
  maxTargetParamKm?: number; // Tham số đường bay giới hạn P_gh (km)
  optimalAltitudeM?: number; // Độ cao tối ưu khí động học đạt tầm xa cực đại H_opt (m)
  reactionTimeSeconds?: number; // Thời gian phản ứng xạ kích (giây)
  deployTimeMinutes?: number; // Thời gian triển khai/thu hồi (phút)
  guidanceMethodVi?: string; // Phương thức dẫn bắn (Radar TVM, Hồng ngoại IIR, Lệnh vô tuyến...)
  samEngagementMode?:
    | 'head_on'
    | 'tail_chase'
    | 'passive_jamming'
    | 'active_jamming'
    | 'tvk_optical'
    | 'surface'
    | 'ballistic'
    | 'jamming'
    | 'jamming_passive'
    | 'jamming_active'
    | 'tbk_optical'
    | string;
  samProfiles?: Record<
    string,
    {
      modeVi: string;
      dMinKm: number;
      dMaxKm: number;
      hMinM: number;
      hMaxM: number;
      vMaxMps: number;
      pGhKm: number;
    }
  >;
  frequencyRangeGhz?: string; // Dải tần số trinh sát điện từ (GHz) cho trạm thụ động ESM
  networkGroupId?: string; // Định danh nhóm mạng cảm biến TDoA
  spyderConfig?: SpyderSystemConfig;
  realPhotoUrl?: string; // Ảnh thực tế khí tài hiển thị trên cờ tác chiến
  model3dUrl?: string; // Đường dẫn mô hình 3D (.glb, .gltf)
  model3dScale?: number; // Hệ số tỉ lệ mô hình 3D (mặc định 1.0)
  model3dHeadingOffset?: number; // Độ lệch góc xoay (độ)
  model3dAltitudeOffset?: number; // Độ lệch cao độ so với mặt đất (m)
  customModelFileName?: string; // Tên file mô hình 3D tự nạp
  customPhotoFileName?: string; // Tên file ảnh thực tế tự nạp
  canDesignateForSam?: boolean; // Khả năng chỉ thị mục tiêu cho tên lửa phòng không (true với 36D6, false với radar cảnh giới nhìn vòng)
  radarSubRole?: RadarSubRole; // Phân định 'chi_thi_ten_lua' vs 'canh_gioi_nhin_vong'
  radarSubRoleVi?: string; // Tên vai trò hiển thị tiếng Việt
  designatedRadarId?: string | null; // ID đài radar chỉ thị mục tiêu cho tổ hợp tên lửa
  samTerrainMaskMode?: SamTerrainMaskMode; // Chế độ cắt địa hình tên lửa: 'organic' | 'linked_radar' | 'intersection'
  radarGroup?: RadarGroup; // Nhóm radar: 'acquisition_3d' | 'surveillance_2d'
  batteryConfig?: CompositeBatteryConfig; // Cấu hình tổ hợp đồng bộ (SAM Battery)
  maxLaunchRangeKm?: number; // Cự ly phóng cực đại R_launch_max (vòng đón hỏa lực)
  isIntegratedOnly?: boolean; // Khí tài hữu cơ nội bộ trong tổ hợp, không cho phép đặt lẻ trên bản đồ
}

export type RadarGroup = 'acquisition_3d' | 'surveillance_2d';

export interface CompositeLauncherItem {
  id: string; // ví dụ: "launcher_1", "launcher_2"...
  index: number; // 1, 2, 3, 4
  name: string; // ví dụ: "Bệ phóng 5P73-2TM #1"
  latitude: number;
  longitude: number;
  altitude: number; // ASL m (tự snap theo DEM)
  distanceToCenterM: number; // Khoảng cách tới đài FCR (m)
  bearingFromCenterDeg: number; // Góc phương vị từ đài FCR (0° - 360°)
  isValid: boolean; // true nếu trong tầm cáp & không bị đồi che
  warningMessage?: string; // "Ngoài phễu bắt đạn!" / "Mất kết nối cáp!"
}

export interface CompositeBatteryConfig {
  batteryType: string;
  tarRadarName: string; // Tên đài Radar Chỉ thị đi kèm (TAR)
  tarRadarId: string;
  tarRadarTemplateId?: string; // Alias tương thích cho ID template của TAR
  tarRangeKm: number;
  tarHeightKm: number;
  tarAglM: number;
  tarWavelengthM?: number;
  alternateTarOptions?: Array<{
    id: string;
    name: string;
    rangeKm: number;
    heightKm: number;
    aglM: number;
    wavelengthM?: number;
    description?: string;
  }>;
  fcrRadarName: string; // Tên đài Điều khiển hỏa lực (FCR)
  fcrRadarId: string;
  fcrRadarTemplateId?: string; // Alias tương thích cho ID template của FCR
  fcrRangeKm: number;
  fcrHeightKm: number;
  fcrAglM: number;
  fcrWavelengthM?: number;
  fcrSectorAngleDeg: number; // Góc quạt FCR: 90° S-300, 60° C-125, 360° Spyder
  fcrBlindConeDeg: number; // Phễu mù đỉnh đầu: 70° S-300, 65° C-125, 75° Spyder
  launcherName: string; // Tên loại bệ phóng (ví dụ: 5P85TE2, 5P73-2TM, 5P73, MFU)
  launcherCount: number; // Mặc định 4
  defaultLauncherDistanceM: number; // 80m - 120m
  maxCableDistanceM: number; // 150m C-125, 200m S-300, 2000m Spyder
  minEngagementRangeKm: number;
  maxEngagementRangeKm: number;
  maxLaunchRangeKm: number; // R_launch_max (Vòng đón)
  maxEngagementAltitudeM: number;
  minEngagementAltitudeM: number;
}

export interface CompositeBatteryState {
  launchers: CompositeLauncherItem[];
  combatMode: 'omnidirectional' | 'sector';
  combatAzimuthDeg: number; // Hướng xạ giới chính (0° - 360°)
  showLayers: {
    tarDome: boolean; // Vòm Radar Cảnh giới / Chỉ thị (Xanh dương)
    fcrDome: boolean; // Vòm Bám bắt FCR (Cam)
    wezDome: boolean; // Vùng Hỏa lực WEZ (Đỏ)
    launchers: boolean; // Đội hình Bệ phóng & Cáp
  };
  mastHeightOverrideM?: number; // Chiều cao tháp nâng ăng-ten tùy chỉnh
}

export interface SpyderDomeSpec {
  name: string;
  nameVi: string;
  missileTypeVi: string;
  dMaxKm: number; // Cự ly tiêu diệt lớn nhất (km): 20km (SR), 50km (MR)
  dMinKm: number; // Cự ly tiêu diệt nhỏ nhất (km): 1km (SR), 2km (MR)
  hMaxM: number;  // Độ cao tiêu diệt lớn nhất (m): 9000m (SR), 16000m (MR)
  hMinM: number;  // Độ cao tiêu diệt nhỏ nhất (m): 20m (SR & MR)
  colorHex: string; // Mã màu vòm: xanh lá nhạt #10b981 (SR), xanh lam nhạt #0ea5e9 (MR)
}

export interface SpyderSystemConfig {
  sr: SpyderDomeSpec;
  mr: SpyderDomeSpec;
  targetSpeeds: {
    aircraftMps: number; // Máy bay > 30m: < 800 m/s
    helicopterMps: number; // Trực thăng > 20m: 0 - 200 m/s
    uavMps: number; // UAV > 100m: < 300 m/s
  };
  missileSpeeds?: {
    mrMps: number; // Derby-MR & Python-5-MR: 1200 m/s
    srMps: number; // Derby-SR & Python-5-SR: 700 m/s
  };
  targetTypesVi: string[];
}

export interface EquipmentInstance {
  instanceId: string;
  templateId: string;
  name: string;
  category: EquipmentCategory;
  latitude: number;
  longitude: number;
  altitude: number; // ASL in meters
  antennaHeightAGL: number; // AGL in meters
  rangeKm: number;
  scanSpeed: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  coverageHeightKm: number;
  status: OperationalStatus;
  commandedByInstanceId?: string | null;
  color: string;
  showDome: boolean;
  showSweep: boolean;
  currentSweepHeading?: number; // deg
  shortId?: string; // Mã định danh quân sự ngắn: R-01, SAM-01, CP-01, ESM-01...
  wavelengthM?: number;
  coverageProfile?: CoverageProfile;
  altitudeDetectionTable?: AltitudeDetectionTable;
  minEngagementRangeKm?: number;
  maxEngagementAltitudeM?: number;
  minEngagementAltitudeM?: number;
  maxTargetSpeedMps?: number;
  maxTargetParamKm?: number;
  optimalAltitudeM?: number;
  reactionTimeSeconds?: number;
  deployTimeMinutes?: number;
  guidanceMethodVi?: string;
  samEngagementMode?:
    | 'head_on'
    | 'tail_chase'
    | 'passive_jamming'
    | 'active_jamming'
    | 'tvk_optical'
    | 'surface'
    | 'ballistic'
    | 'jamming'
    | 'jamming_passive'
    | 'jamming_active'
    | 'tbk_optical'
    | string;
  samProfiles?: Record<
    string,
    {
      modeVi: string;
      dMinKm: number;
      dMaxKm: number;
      hMinM: number;
      hMaxM: number;
      vMaxMps: number;
      pGhKm: number;
    }
  >;
  frequencyRangeGhz?: string;
  networkGroupId?: string;
  spxConfig?: Partial<import('./spxRadarCoverage').SpxRadarCoverageConfig>;
  targetAltitudeM?: number; // Độ cao mục tiêu khảo sát riêng của đài (m)
  spyderConfig?: SpyderSystemConfig;
  realPhotoUrl?: string; // Ảnh thực tế khí tài hiển thị trên cờ tác chiến
  model3dUrl?: string; // Đường dẫn mô hình 3D (.glb, .gltf)
  model3dScale?: number; // Hệ số tỉ lệ mô hình 3D (mặc định 1.0)
  model3dHeadingOffset?: number; // Độ lệch góc xoay (độ)
  model3dAltitudeOffset?: number; // Độ lệch cao độ so với mặt đất (m)
  customModelFileName?: string; // Tên file mô hình 3D tự nạp
  customPhotoFileName?: string; // Tên file ảnh thực tế tự nạp
  canDesignateForSam?: boolean; // Khả năng chỉ thị mục tiêu cho tên lửa phòng không
  radarSubRole?: RadarSubRole; // Phân định 'chi_thi_ten_lua' vs 'canh_gioi_nhin_vong'
  radarSubRoleVi?: string; // Tên vai trò hiển thị tiếng Việt
  designatedRadarId?: string | null; // ID đài radar chỉ thị mục tiêu được liên kết
  samTerrainMaskMode?: SamTerrainMaskMode; // Chế độ cắt địa hình tên lửa: 'organic' | 'linked_radar' | 'intersection'
  radarGroup?: RadarGroup;
  batteryConfig?: CompositeBatteryConfig;
  compositeBattery?: CompositeBatteryState;
  maxLaunchRangeKm?: number;
  isIntegratedOnly?: boolean;
}

export const CATEGORY_META: Record<
  EquipmentCategory,
  { prefix: string; nameVi: string; icon: string }
> = {
  RadarCanhGioi: { prefix: 'R', nameVi: 'Radar Cảnh Giới', icon: 'Radar' },
  TenLuaPhongKhong: { prefix: 'SAM', nameVi: 'Tên Lửa Phòng Không', icon: 'Target' },
  SoChiHuy: { prefix: 'CP', nameVi: 'Sở Chỉ Huy', icon: 'Radio' },
  PhaoPhongKhong: { prefix: 'AAA', nameVi: 'Pháo Phòng Không', icon: 'Zap' },
  CamBienThuDong: { prefix: 'ESM', nameVi: 'Cảm Biến Thụ Động (ESM)', icon: 'RadioTower' },
  TramQuanSat: { prefix: 'OP', nameVi: 'Trạm Quan Sát', icon: 'Antenna' },
};

export interface PresetLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  heading?: number;
  pitch?: number;
}
