/**
 * Hàm dựng thực thể khí tài từ template — dùng chung cho:
 * - nhấp bản đồ để đặt khí tài mới (CesiumGlobe, activeTool === 'place')
 * - đặt khí tài tại gợi ý của AI (useTacticalStore.placeEquipmentAtSuggestion)
 *
 * Nhờ vậy giá trị mặc định (tầm, góc tà, trần phủ sóng, màu, cờ hiển thị) chỉ tồn tại ở MỘT nơi.
 */
import type { EquipmentInstance, EquipmentTemplate } from '../types/equipment';
import { createDefaultCompositeBatteryState } from './compositeBatteryGeometry';

export interface EquipmentPlacementParams {
  latitude: number; // độ thập phân WGS-84
  longitude: number; // độ thập phân WGS-84
  altitude: number; // cao độ mặt đất ASL (m)
  /** Số thứ tự để hậu tố tên hiển thị (bỏ qua nếu không truyền) */
  nameIndex?: number;
  /** instanceId tuỳ chọn; nếu bỏ trống sẽ tự sinh */
  instanceId?: string;
  /** Danh sách khí tài hiện có trên trận địa để tự động hiệp đồng liên kết */
  existingInstances?: EquipmentInstance[];
}

/** Sinh instanceId duy nhất theo thời gian + chuỗi ngẫu nhiên (giống định dạng sẵn có của app) */
export function generateEquipmentInstanceId(): string {
  return `eq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Dựng một `EquipmentInstance` đầy đủ từ template với đúng bộ giá trị mặc định
 * đang dùng ở luồng đặt khí tài trên bản đồ (xem CesiumGlobe.tsx, nhánh 'place').
 */
export function createEquipmentFromTemplate(
  template: EquipmentTemplate,
  params: EquipmentPlacementParams
): EquipmentInstance {
  const nameSuffix = params.nameIndex !== undefined ? ` #${params.nameIndex}` : '';

  // Tự động tìm đài radar có khả năng chỉ thị mục tiêu cho tên lửa (hoặc đài radar gần nhất)
  let autoRadarId = template.designatedRadarId || null;
  let autoMaskMode = template.samTerrainMaskMode;

  if (template.category === 'TenLuaPhongKhong' && !autoRadarId && params.existingInstances && params.existingInstances.length > 0) {
    const tarTmplId = template.batteryConfig?.tarRadarId;
    const fcrTmplId = template.batteryConfig?.fcrRadarId;
    const pairedRadar = params.existingInstances.find(
      (inst) => (inst.templateId === tarTmplId || inst.templateId === fcrTmplId) && inst.status === 'Active'
    );
    const fireControlRadar = params.existingInstances.find((inst) => inst.canDesignateForSam && inst.status === 'Active');
    const fallbackRadar = params.existingInstances.find((inst) => inst.category === 'RadarCanhGioi' && inst.status === 'Active');
    const targetRadar = pairedRadar || fireControlRadar || fallbackRadar;
    if (targetRadar) {
      autoRadarId = targetRadar.instanceId;
      autoMaskMode = 'intersection';
    }
  }

  if (!autoMaskMode && template.category === 'TenLuaPhongKhong') {
    autoMaskMode = autoRadarId ? 'intersection' : 'organic';
  }

  return {
    instanceId: params.instanceId || generateEquipmentInstanceId(),
    templateId: template.id,
    name: `${template.name}${nameSuffix}`,
    category: template.category,
    latitude: params.latitude,
    longitude: params.longitude,
    altitude: params.altitude,
    antennaHeightAGL: template.antennaHeightAGL || 15,
    rangeKm: template.defaultRangeKm || 50,
    scanSpeed: template.defaultScanSpeed || 0,
    minElevationDeg: template.minElevationDeg !== undefined ? template.minElevationDeg : -10,
    maxElevationDeg: template.maxElevationDeg !== undefined ? template.maxElevationDeg : 40,
    coverageHeightKm: template.coverageHeightKm || 25,
    status: 'Active',
    commandedByInstanceId: null,
    color: template.symbolColor || '#38bdf8',
    showDome: true,
    showSweep: (template.defaultScanSpeed || 0) > 0,
    coverageProfile: template.coverageProfile,
    minEngagementRangeKm: template.minEngagementRangeKm,
    maxEngagementAltitudeM: template.maxEngagementAltitudeM,
    minEngagementAltitudeM: template.minEngagementAltitudeM,
    optimalAltitudeM: template.optimalAltitudeM,
    maxTargetSpeedMps: template.maxTargetSpeedMps,
    maxTargetParamKm: template.maxTargetParamKm,
    reactionTimeSeconds: template.reactionTimeSeconds,
    deployTimeMinutes: template.deployTimeMinutes,
    guidanceMethodVi: template.guidanceMethodVi,
    samProfiles: template.samProfiles,
    samEngagementMode: template.samEngagementMode || 'head_on',
    samTerrainMaskMode: template.category === 'TenLuaPhongKhong' ? 'intersection' : autoMaskMode,
    designatedRadarId: autoRadarId,
    targetAltitudeM: 500,
    batteryConfig: template.batteryConfig,
    compositeBattery: template.batteryConfig
      ? createDefaultCompositeBatteryState(params.latitude, params.longitude, params.altitude, template.batteryConfig)
      : undefined,
    canDesignateForSam: template.canDesignateForSam,
    radarSubRole: template.radarSubRole,
    radarSubRoleVi: template.radarSubRoleVi,
    spyderConfig: template.spyderConfig,
    realPhotoUrl: template.realPhotoUrl,
    model3dUrl: template.model3dUrl,
    model3dScale: template.model3dScale || 1.0,
  };
}
