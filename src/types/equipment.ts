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
  iconName: string;
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
}

export interface PresetLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  heading?: number;
  pitch?: number;
}
