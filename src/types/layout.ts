export interface SavedEquipmentEntry {
  instanceId: string;
  templateId: string;
  shortId?: string;
  posX: number;
  posY: number;
  posZ: number;
  latitude: number;
  longitude: number;
  groundElevationMeters: number;
  antennaHeightAGL: number;
  currentRange: number; // km in web
  currentScanSpeed: number;
  currentMinElevation: number;
  currentMaxElevation: number;
  currentCoverageHeight: number;
  status: number; // 0: Active, 1: Standby, 2: Maintenance, 3: Offline
  commandedByInstanceId?: string | null;
}

export interface LayoutSaveData {
  layoutName: string;
  savedAtIso8601: string;
  areaId?: string;
  equipments: SavedEquipmentEntry[];
}
