/**
 * @fileoverview Pure, deterministic calculation of Analysis Input Fingerprints and Freshness.
 * Tách biệt hoàn toàn khỏi Cesium, UI và React rendering context.
 * Tuân thủ North Star v2.1 và Checkpoint 2B.
 */

import type { Plan } from '../types/plan';
import type { EquipmentPlacement, EquipmentDefinition } from '../types/equipment';
import type { SpxRadarCoverageConfig } from '../../types/spxRadarCoverage';
import type {
  SpxAnalysisInputSnapshot,
  AnalysisResult,
  FreshnessStatus,
} from '../types/analysis';

export const SPX_ALGORITHM_ID = 'spx_radar_coverage';
export const SPX_ALGORITHM_VERSION = '1.0.0';

export interface SpxConfigResolutionInputs {
  antennaHeightAGL?: number;
  rangeKm?: number;
  minElevationDeg?: number;
  maxElevationDeg?: number;
  customSpxConfig?: Partial<SpxRadarCoverageConfig> | null;
}

/**
 * Thống nhất một cơ chế duy nhất để dựng cấu hình SPx hiệu lực (effective config)
 * từ cấu hình chung và các thuộc tính riêng của từng đài (placement/definition/visual).
 */
export function resolveEffectiveSpxConfigFromCanonical(
  baseConfig: SpxRadarCoverageConfig,
  placement: EquipmentPlacement,
  definition: EquipmentDefinition,
  customSpxConfig?: Partial<SpxRadarCoverageConfig> | null
): SpxRadarCoverageConfig {
  return resolveEffectiveSpxConfig(baseConfig, {
    antennaHeightAGL: placement.position.aglM,
    rangeKm: definition.rangeKm,
    minElevationDeg: definition.minElevationDeg,
    maxElevationDeg: definition.maxElevationDeg,
    customSpxConfig,
  });
}

export function resolveEffectiveSpxConfig(
  baseConfig: SpxRadarCoverageConfig,
  inputs: SpxConfigResolutionInputs
): SpxRadarCoverageConfig {
  const custom = inputs.customSpxConfig || {};

  const radarHeightAGL =
    custom.radarHeightAGL ??
    (inputs.antennaHeightAGL !== undefined && inputs.antennaHeightAGL > 0
      ? inputs.antennaHeightAGL
      : baseConfig.radarHeightAGL);

  const endRangeM =
    custom.endRangeM ??
    (inputs.rangeKm !== undefined && inputs.rangeKm > 0
      ? inputs.rangeKm * 1000
      : baseConfig.endRangeM);

  const minElevationDeg =
    custom.minElevationDeg ??
    (inputs.minElevationDeg !== undefined
      ? inputs.minElevationDeg
      : baseConfig.minElevationDeg);

  const maxElevationDeg =
    custom.maxElevationDeg ??
    (inputs.maxElevationDeg !== undefined
      ? inputs.maxElevationDeg
      : baseConfig.maxElevationDeg);

  return {
    ...baseConfig,
    ...custom,
    radarHeightAGL,
    endRangeM,
    minElevationDeg,
    maxElevationDeg,
  };
}

/**
 * Tạo snapshot đầu vào thuần túy cho phép phân tích SPx từ trạng thái miền chuẩn.
 * Toàn bộ tọa độ và tham số số học được chuẩn hóa chính xác để đảm bảo tính tất định.
 * Không bao gồm màu sắc, độ mờ (transparency), trạng thái chọn hoặc UI.
 */
export function buildSpxInputSnapshot(
  scenarioId: string,
  plan: Plan,
  placement: EquipmentPlacement,
  definition: EquipmentDefinition,
  spxConfig: SpxRadarCoverageConfig,
  terrainVersion = 'v1',
  terrainProviderKey?: string
): SpxAnalysisInputSnapshot {
  const targetHeights = (spxConfig.targetHeights || [])
    .map((th) => ({
      ...(th.id ? { id: th.id } : {}),
      heightMeters: typeof th.heightMeters === 'number' && !isNaN(th.heightMeters) ? th.heightMeters : 0,
      label: th.label || `${th.heightMeters}m`,
    }))
    .sort((a, b) => {
      if (a.heightMeters !== b.heightMeters) {
        return a.heightMeters - b.heightMeters;
      }
      return (a.id || '').localeCompare(b.id || '');
    });

  const rangeKm = definition.rangeKm ?? (spxConfig.endRangeM ? spxConfig.endRangeM / 1000 : 50);
  const minElev = spxConfig.minElevationDeg !== undefined ? spxConfig.minElevationDeg : (definition.minElevationDeg ?? -10);
  const maxElev = spxConfig.maxElevationDeg !== undefined ? spxConfig.maxElevationDeg : (definition.maxElevationDeg ?? 40);
  const antennaAGL = spxConfig.radarHeightAGL ?? placement.position.aglM ?? 40;
  const startRangeM = spxConfig.startRangeM ?? 0;
  const endRangeM = spxConfig.endRangeM ?? (rangeKm * 1000);
  const azimuthStartDeg = spxConfig.azimuthStartDeg ?? 0;
  const azimuthEndDeg = spxConfig.azimuthEndDeg ?? 360;
  const terrainProvKey = terrainProviderKey || `flat_${terrainVersion || 'v1'}`;

  return {
    scenarioId,
    planId: plan.id,
    planVersion: plan.version,
    instanceId: placement.id,
    latitude: placement.position.lat,
    longitude: placement.position.lon,
    altitude: placement.position.altM,
    antennaHeightAGL: antennaAGL,
    rangeKm,
    startRangeM,
    endRangeM,
    minElevationDeg: minElev,
    maxElevationDeg: maxElev,
    azimuthStartDeg,
    azimuthEndDeg,
    kFactor: spxConfig.kFactor ?? 1.3333,
    earthCurvature: Boolean(spxConfig.earthCurvature ?? true),
    altitudeReference: spxConfig.altitudeReference || 'sea_level',
    targetHeights,
    terrainVersion: terrainVersion || 'v1',
    terrainProviderKey: terrainProvKey,
    algorithmId: SPX_ALGORITHM_ID,
    algorithmVersion: SPX_ALGORITHM_VERSION,
  };
}

/**
 * Hình chiếu ngữ nghĩa (semantic projection) của đầu vào phân tích SPx.
 * Chỉ chứa identity cần thiết, effective numerical engine inputs, terrain provider/version
 * và algorithm identity/version. Loại bỏ hoàn toàn planVersion, nhãn hiển thị UI,
 * hoặc các tham số bị override không ảnh hưởng đến thuật toán tính toán.
 */
export interface SpxSemanticAnalysisProjection {
  algorithmId: string;
  algorithmVersion: string;
  instanceId: string;
  latitude: number;
  longitude: number;
  antennaHeightAGL: number;
  startRangeM: number;
  endRangeM: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  azimuthStartDeg: number;
  azimuthEndDeg: number;
  kFactor: number;
  earthCurvature: boolean;
  altitudeReference: string;
  targetHeights: Array<{ id?: string; heightMeters: number }>;
  terrainVersion: string;
  terrainProviderKey: string;
}

export function buildSemanticAnalysisProjection(
  snapshot: SpxAnalysisInputSnapshot
): SpxSemanticAnalysisProjection {
  const targetHeights = (snapshot.targetHeights || [])
    .map((th) => ({
      ...(th.id ? { id: th.id } : {}),
      heightMeters: th.heightMeters,
    }))
    .sort((a, b) => {
      if (a.heightMeters !== b.heightMeters) {
        return a.heightMeters - b.heightMeters;
      }
      return (a.id || '').localeCompare(b.id || '');
    });

  const effectiveEndRangeM =
    snapshot.endRangeM !== undefined
      ? snapshot.endRangeM
      : snapshot.rangeKm * 1000;

  return {
    algorithmId: snapshot.algorithmId,
    algorithmVersion: snapshot.algorithmVersion,
    instanceId: snapshot.instanceId,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    antennaHeightAGL: snapshot.antennaHeightAGL,
    startRangeM: snapshot.startRangeM ?? 0,
    endRangeM: effectiveEndRangeM,
    minElevationDeg: snapshot.minElevationDeg,
    maxElevationDeg: snapshot.maxElevationDeg,
    azimuthStartDeg: snapshot.azimuthStartDeg ?? 0,
    azimuthEndDeg: snapshot.azimuthEndDeg ?? 360,
    kFactor: snapshot.kFactor,
    earthCurvature: Boolean(snapshot.earthCurvature),
    altitudeReference: snapshot.altitudeReference,
    targetHeights,
    terrainVersion: snapshot.terrainVersion,
    terrainProviderKey: snapshot.terrainProviderKey || `flat_${snapshot.terrainVersion || 'v1'}`,
  };
}

/**
 * Thuật toán FNV-1a 64-bit băm chuỗi ký tự thành mã hex tất định.
 * Đảm bảo tính toán siêu nhanh và không phụ thuộc thư viện crypto ngoài.
 */
function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fp_${hex1}${hex2}`;
}

/**
 * Chuyển đổi đối tượng snapshot thành chuỗi JSON với thứ tự khóa cố định (canonical JSON).
 */
function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Tính toán input fingerprint tất định từ semantic projection của AnalysisInputSnapshot.
 */
export function computeAnalysisFingerprint(snapshot: SpxAnalysisInputSnapshot): string {
  const projection = buildSemanticAnalysisProjection(snapshot);
  const canonicalString = canonicalizeJson(projection);
  return fnv1a64(canonicalString);
}

/**
 * Đánh giá trạng thái hiện hành (Freshness) của kết quả phân tích so với dữ liệu đầu vào hiện thời.
 * - 'current': Snapshot hiện tại khớp chính xác 100% với fingerprint của kết quả.
 * - 'stale': Snapshot đầu vào đã bị sửa đổi (vị trí, cấu hình, tầng độ cao...).
 * - 'unknown': Không có kết quả hoặc không đủ dữ liệu để tính toán đối chiếu.
 */
export function evaluateAnalysisFreshness(
  currentSnapshot: SpxAnalysisInputSnapshot | null,
  result: AnalysisResult | null
): FreshnessStatus {
  if (!result || !result.inputFingerprint) return 'unknown';
  if (!currentSnapshot) return 'unknown';

  const currentFingerprint = computeAnalysisFingerprint(currentSnapshot);
  return currentFingerprint === result.inputFingerprint ? 'current' : 'stale';
}
