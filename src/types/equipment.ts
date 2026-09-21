import type { CoverageProfile } from './radarCoverage';

export type EquipmentCategory =
  | 'RadarCanhGioi'
  | 'TenLuaPhongKhong'
  | 'SoChiHuy'
  | 'PhaoPhongKhong'
  | 'TramQuanSat';

export type OperationalStatus = 'Active' | 'Standby' | 'Maintenance' | 'Offline';

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
  shortId?: string; // Mã định danh quân sự ngắn: R-01, SAM-01, CP-01...
  wavelengthM?: number;
  coverageProfile?: CoverageProfile;
  spxConfig?: Partial<import('./spxRadarCoverage').SpxRadarCoverageConfig>;
}

export const CATEGORY_META: Record<
  EquipmentCategory,
  { prefix: string; nameVi: string; icon: string }
> = {
  RadarCanhGioi: { prefix: 'R', nameVi: 'Radar Cảnh Giới', icon: 'Radar' },
  TenLuaPhongKhong: { prefix: 'SAM', nameVi: 'Tên Lửa Phòng Không', icon: 'Target' },
  SoChiHuy: { prefix: 'CP', nameVi: 'Sở Chỉ Huy', icon: 'Radio' },
  PhaoPhongKhong: { prefix: 'AAA', nameVi: 'Pháo Phòng Không', icon: 'Zap' },
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
