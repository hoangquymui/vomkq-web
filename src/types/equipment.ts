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
  samEngagementMode?: 'head_on' | 'tail_chase' | 'jamming_passive' | 'jamming_active' | 'tbk_optical';
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
  samEngagementMode?: 'head_on' | 'tail_chase' | 'jamming_passive' | 'jamming_active' | 'tbk_optical';
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
