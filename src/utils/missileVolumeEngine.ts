import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import {
  calculateEarthBulgeMeters,
  DEFAULT_K_FACTOR,
  EARTH_RADIUS_METERS,
} from './radarMath';
import { sampleTerrainGridAndMasks } from './radarVolumeEngine';
import { EQUIPMENT_TEMPLATES, SPYDER_SYSTEM_DEFAULT_CONFIG } from '../data/equipmentTemplates';
import { destinationPoint, calculateDistanceMeters, calculateBearingDeg } from './samCoverageEngine';

export type SamEngagementMode =
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

export type SamProbabilityLayer = 'outer_boundary' | 'high_prob' | 'optimal';

export interface SamVolumeGeometry {
  positions: Float64Array;
  normals: Float32Array;
  st: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  apexHeightM: number;
  maxEffectiveRadiusM: number;
  center: Cesium.Cartesian3;
  modelMatrix: Cesium.Matrix4;
}

export interface SamEngagementVolume {
  instanceId: string;
  instanceName: string;
  mode: SamEngagementMode;
  modeVi: string;
  centerLat: number;
  centerLon: number;
  centerAltM: number;
  antennaHeightAGL: number;
  dMaxKm: number;
  dMinKm: number;
  hMaxM: number;
  hMinM: number;
  hOptM: number;
  pGhKm: number;
  vMaxMps: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  azimuthSamples: number[];
  altitudeBands: number[];
  innerConeRadii: number[];
  optimalRanges: number[][]; // [bandIdx][azIdx] (70% D_max)
  highProbRanges: number[][]; // [bandIdx][azIdx] (85% D_max)
  nominalRanges: number[][]; // [bandIdx][azIdx] (100% D_max)
  effectiveRanges: number[][]; // [bandIdx][azIdx] sau khi cắt địa hình
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';
  cacheKey: string;
  maxMaskInfoByAzDist?: Map<string, { maxTan: number; peakDist: number; peakAlt: number }>;
  terrainMap?: Map<string, number>;
  sampleDistances?: number[];
  terrainGrid?: import('../types/radarVolume').RadarTerrainGrid;
  radarLat?: number;
  radarLon?: number;
  radarAltM?: number;
  maxRangeKm?: number;
  isSpyderDualDome?: boolean;
  spyderSrVolume?: SamEngagementVolume;
}

/** Cache bộ nhớ lưu các SamEngagementVolume đã tính toán */
const samVolumeCache = new Map<string, SamEngagementVolume>();

/**
 * Tạo cache key đồng bộ duy nhất cho SamEngagementVolume
 */
export function getSamVolumeCacheKey(
  instance: EquipmentInstance,
  options: {
    mode?: SamEngagementMode;
    azimuthStepDeg?: number;
    kFactor?: number;
  } = {}
): string {
  const mode = options.mode || instance.samEngagementMode || 'head_on';
  const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const isSpyder = instance.templateId === 'sam_spyder' || !!instance.spyderConfig;
  const spyderCfg = instance.spyderConfig || tmpl?.spyderConfig || (isSpyder ? SPYDER_SYSTEM_DEFAULT_CONFIG : undefined);
  const profile = (instance.samProfiles || tmpl?.samProfiles)?.[mode];

  const dMaxKm = profile?.dMaxKm ?? (isSpyder && spyderCfg ? spyderCfg.mr.dMaxKm : (instance.rangeKm || tmpl?.defaultRangeKm || 25));
  const hMaxM = profile?.hMaxM ?? (isSpyder && spyderCfg ? spyderCfg.mr.hMaxM : (instance.maxEngagementAltitudeM || tmpl?.maxEngagementAltitudeM || 18000));
  const minElevationDeg = instance.minElevationDeg !== undefined ? instance.minElevationDeg : 6.0;
  const maxElevationDeg = instance.maxElevationDeg !== undefined ? instance.maxElevationDeg : 65.0;
  const azimuthStepDeg = options.azimuthStepDeg || 5;
  const kFactor = options.kFactor || DEFAULT_K_FACTOR;
  const centerLat = instance.latitude;
  const centerLon = instance.longitude;
  const centerGroundAltM = instance.altitude || 0;
  // Ưu tiên chiều cao tháp ăng-ten tùy chỉnh mastHeightOverrideM
  const antennaHeightAGL = instance.compositeBattery?.mastHeightOverrideM ?? instance.antennaHeightAGL ?? 6;
  const centerAltM = centerGroundAltM + antennaHeightAGL;
  const designatedRadarId = instance.designatedRadarId || 'none';
  const samTerrainMaskMode = instance.samTerrainMaskMode || 'organic';
  const mastKey = instance.compositeBattery?.mastHeightOverrideM !== undefined ? `_m${instance.compositeBattery.mastHeightOverrideM}` : '';

  return `sam_${instance.instanceId}_${mode}_${centerLat.toFixed(4)}_${centerLon.toFixed(4)}_${centerAltM.toFixed(1)}${mastKey}_${dMaxKm}_${hMaxM}_${minElevationDeg}_${maxElevationDeg}_${azimuthStepDeg}_${kFactor.toFixed(2)}_${designatedRadarId}_${samTerrainMaskMode}`;
}

/**
 * 1b. HÀM TÍNH BIÊN CỰ LY VÒM HỎA LỰC ELIP SPYDER THEO ĐỘ CAO (D(deltaH))
 * Dạng hình học: Vòm cong elip đều (Mặt cắt đứng Ảnh 2) từ sàn hỏa lực hMinM đến trần hMaxM:
 * D(deltaH) = D_max * sqrt(max(0, 1 - (deltaH / hMaxM)^2))
 * Tại mặt đất (deltaH = 0): D = D_max (20km cho SR, 50km cho MR)
 * Tại trần bay (deltaH = hMaxM): D = 0 (9km cho SR, 16km cho MR)
 */
export function calculateSpyderDomeMaxRange(
  deltaHM: number,
  dMaxM: number,
  hMaxM: number
): number {
  if (deltaHM < 0 || deltaHM > hMaxM) return 0;
  const ratio = deltaHM / hMaxM;
  return Math.max(0, dMaxM * Math.sqrt(Math.max(0, 1 - ratio * ratio)));
}

/**
 * 1. HÀM TÍNH BIÊN CỰ LY QUẢ LÊ KHÍ ĐỘNG SAM THEO ĐỘ CAO (D_max(H))
 * Dạng hình học: Phình cực đại tại H_opt (5-8km), thu hẹp ở sát đất do không khí đặc,
 * và vuốt dần về trần hỏa lực H_max (giữ khoảng 35% tầm xa cực đại tại trần bắn).
 * @param deltaHM Độ cao tương đối so với bệ phóng (m)
 * @param dMaxM Cự ly tiêu diệt cực đại danh định (m)
 * @param hMinM Độ cao sàn hỏa lực tương đối (m)
 * @param hMaxM Trần hỏa lực tối đa (m)
 * @param hOptM Độ cao tối ưu khí động học đạt cự ly lớn nhất (m)
 */
export function calculateSamPearMaxRange(
  deltaHM: number,
  dMaxM: number,
  hMinM: number = 0,
  hMaxM: number = 25000,
  hOptM: number = 6000
): number {
  if (deltaHM < 0 || deltaHM > hMaxM) return 0;

  // Nửa trên (từ H_opt đến H_max): suy giảm lực nâng khí động theo mật độ không khí
  let upperFactor = 1.0;
  if (deltaHM >= hOptM) {
    const span = Math.max(1, hMaxM - hOptM);
    const ratio = Math.min(1, (deltaHM - hOptM) / span);
    // Tại trần hỏa lực H_max, tên lửa vẫn giữ khoảng 35% tầm xa cực đại
    upperFactor = 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - ratio * ratio));
  }

  // Nửa dưới (từ hMinM đến H_opt): suy giảm do mật độ không khí lớn & khí động
  let lowerFactor = 1.0;
  if (deltaHM < hOptM) {
    const span = Math.max(1, hOptM - hMinM);
    const ratio = Math.min(1, Math.max(0, (deltaHM - hMinM) / span));
    // Tầng sát đất đạt khoảng 45% - 50% cự ly cực đại (trước khi bị cắt bởi góc ngẩng bệ phóng 6°)
    lowerFactor = 0.45 + 0.55 * Math.pow(ratio, 0.28);
  }

  return Math.max(0, dMaxM * upperFactor * lowerFactor);
}

/**
 * 2. HÀM TÍNH NÓN MÙ CỰC CẬN & GÓC TÀ ĐỈNH ĐẦU HÌNH NÓN (Cone of Silence)
 * Vùng mù hình nón có đỉnh (apex) đặt tại đúng tâm khí tài (deltaH = 0 -> R = 0).
 * Góc cực đại ngẩng được so với mặt phẳng ngang là maxElevDeg (mặc định 65°).
 * Bán kính nón mù tại độ cao deltaH: R = deltaH * cotg(maxElevDeg).
 */
export function calculateSamDeadConeRadius(
  altM: number,
  centerAltM: number,
  dMinMOrMaxElevDeg: number = 65.0,
  maxElevDeg: number = 65.0
): number {
  const elevDeg =
    typeof maxElevDeg === 'number' && maxElevDeg > 0 && maxElevDeg <= 89
      ? maxElevDeg
      : dMinMOrMaxElevDeg <= 89
        ? dMinMOrMaxElevDeg
        : 65.0;
  const deltaH = Math.max(0, altM - centerAltM);
  const rad = (Math.max(10, Math.min(85, elevDeg)) * Math.PI) / 180;
  const cot = 1 / Math.tan(rad);
  const coneM = deltaH * cot;
  return Math.round(coneM);
}

/**
 * 3. TRÍCH XUẤT CÁC TẦNG ĐỘ CAO CHO SAM
 * Phát vòm từ tâm khí tài (tầng 0 tại đúng centerAltM với deltaH = 0),
 * trải đều lên đến trần độ cao cực đại centerAltM + hMaxM.
 */
export function extractSamAltitudeBands(
  centerAltM: number,
  hMaxM: number,
  hOptM: number,
  hMinM: number = 20
): number[] {
  const safeHMinM = Math.max(0, Math.min(hMinM, hMaxM * 0.5));
  const relAltitudes = [
    safeHMinM,
    Math.max(safeHMinM, 50),
    Math.max(safeHMinM, 150),
    Math.max(safeHMinM, 300),
    Math.max(safeHMinM, 600),
    Math.max(safeHMinM, 1000),
    Math.max(safeHMinM, 2000),
    Math.max(safeHMinM, 3500),
    Math.round(hOptM),
    8000,
    11000,
    14000,
    18000,
    22000,
    Math.round(hMaxM),
  ];
  const uniqueBands = Array.from(
    new Set(
      relAltitudes
        .filter((h) => h >= safeHMinM && h <= hMaxM)
        .map((h) => Math.round(centerAltM + h))
    )
  ).sort((a, b) => a - b);

  if (uniqueBands.length === 0 || uniqueBands[0] !== Math.round(centerAltM + safeHMinM)) {
    uniqueBands.unshift(Math.round(centerAltM + safeHMinM));
  }
  const topAlt = Math.round(centerAltM + hMaxM);
  if (uniqueBands[uniqueBands.length - 1] !== topAlt) {
    uniqueBands.push(topAlt);
  }
  return uniqueBands;
}

/**
 * 4. TÍNH TOÁN KHỐI THỂ TÍCH HỎA LỰC SAM 3D CẮT ĐỊA HÌNH
 */
export async function computeSamEngagementVolume(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  options: {
    mode?: SamEngagementMode;
    azimuthStepDeg?: number;
    radialStepMeters?: number;
    kFactor?: number;
    linkedRadarVolume?: import('../types/radarVolume').RadarCoverageVolume;
    samTerrainMaskMode?: import('../types/equipment').SamTerrainMaskMode;
  } = {}
): Promise<SamEngagementVolume> {
  const mode: SamEngagementMode = options.mode || instance.samEngagementMode || 'head_on';
  const linkedRadarVolume = options.linkedRadarVolume;
  const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const isSpyder = instance.templateId === 'sam_spyder' || !!instance.spyderConfig;
  const spyderCfg = instance.spyderConfig || tmpl?.spyderConfig || (isSpyder ? SPYDER_SYSTEM_DEFAULT_CONFIG : undefined);

  const profile = (instance.samProfiles || tmpl?.samProfiles)?.[mode];

  const dMaxKm = profile?.dMaxKm ?? (isSpyder && spyderCfg ? spyderCfg.mr.dMaxKm : (instance.rangeKm || tmpl?.defaultRangeKm || 25));
  const dMinKm = profile?.dMinKm ?? (isSpyder && spyderCfg ? spyderCfg.mr.dMinKm : (instance.minEngagementRangeKm || tmpl?.minEngagementRangeKm || 3.5));
  const hMaxM = profile?.hMaxM ?? (isSpyder && spyderCfg ? spyderCfg.mr.hMaxM : (instance.maxEngagementAltitudeM || tmpl?.maxEngagementAltitudeM || 18000));
  const hMinM = profile?.hMinM ?? (isSpyder && spyderCfg ? spyderCfg.mr.hMinM : (instance.minEngagementAltitudeM || tmpl?.minEngagementAltitudeM || 20));
  const hOptM = isSpyder ? (hMaxM <= 10000 ? 3500 : 5000) : (instance.optimalAltitudeM || tmpl?.optimalAltitudeM || Math.round(hMaxM * 0.35));
  const pGhKm = profile?.pGhKm || instance.maxTargetParamKm || tmpl?.maxTargetParamKm || 16.5;
  const vMaxMps = profile?.vMaxMps || (isSpyder && spyderCfg ? spyderCfg.targetSpeeds.aircraftMps : (instance.maxTargetSpeedMps || tmpl?.maxTargetSpeedMps || 700));
  const modeVi = profile?.modeVi || (isSpyder ? 'Tổ hợp SPYDER (SR/MR)' : 'Bắn đón (Không nhiễu)');

  // Góc ngẩng bệ phóng cố định 6° và góc cực đại ngẩng được 65°
  const minElevationDeg = instance.minElevationDeg !== undefined ? instance.minElevationDeg : 6.0;
  const maxElevationDeg = instance.maxElevationDeg !== undefined ? instance.maxElevationDeg : 65.0;

  const azimuthStepDeg = options.azimuthStepDeg || 5;
  const radialStepMeters = options.radialStepMeters || Math.max(1200, Math.round((dMaxKm * 1000) / 40));
  const kFactor = options.kFactor || DEFAULT_K_FACTOR;

  const centerLat = instance.latitude;
  const centerLon = instance.longitude;
  const centerGroundAltM = instance.altitude || 0;
  const antennaHeightAGL = instance.compositeBattery?.mastHeightOverrideM ?? instance.antennaHeightAGL ?? 6;
  const centerAltM = centerGroundAltM + antennaHeightAGL;
  const dMaxM = dMaxKm * 1000;

  const cacheKey = getSamVolumeCacheKey(instance, { mode, azimuthStepDeg, kFactor });
  const cached = samVolumeCache.get(cacheKey);
  if (cached) return cached;

  // Trích xuất các tầng độ cao (bắt đầu từ sàn hỏa lực hMinM đến trần hMaxM)
  const altitudeBands = extractSamAltitudeBands(centerAltM, hMaxM, hOptM, hMinM);
  const azimuthSamples: number[] = [];
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    azimuthSamples.push(az);
  }

  // Nón mù hình nón theo từng tầng độ cao: max(D_min, deltaH * cotg(maxElevationDeg))
  const innerConeRadii = altitudeBands.map((altM) =>
    Math.max(dMinKm * 1000, calculateSamDeadConeRadius(altM, centerAltM, maxElevationDeg))
  );

  // Lấy mẫu độ cao địa hình DEM và tính góc che khuất tích lũy (bao quát cự ly tối đa dMaxM)
  const { terrainMap, maxMaskInfoByAzDist, sampleDistances, terrainStatus, terrainGrid } = await sampleTerrainGridAndMasks(
    centerLat,
    centerLon,
    centerAltM,
    dMaxM,
    azimuthSamples,
    radialStepMeters,
    terrainProvider,
    kFactor
  );

  const tanMinElev = Math.tan((minElevationDeg * Math.PI) / 180);
  const cotMinElev = 1 / tanMinElev;
  const rEquiv = EARTH_RADIUS_METERS * kFactor;
  const aQuad = 1 / (2 * rEquiv);

  /** Hàm tiện ích xây dựng ma trận cự ly danh định và hiệu dụng sau cắt địa hình */
  const buildMatrix = (
    bands: number[],
    innerCones: number[],
    envelopeMaxM: number,
    envelopeHeightM: number,
    envelopeOptM: number,
    useSpyderDome: boolean
  ) => {
    const optimalRanges: number[][] = [];
    const highProbRanges: number[][] = [];
    const nominalRanges: number[][] = [];
    const effectiveRanges: number[][] = [];

    for (let b = 0; b < bands.length; b++) {
      const altM = bands[b];
      const deltaH = Math.max(hMinM, altM - centerAltM);
      const innerConeM = innerCones[b];

      let nomMaxRangeM = 0;
      if (useSpyderDome) {
        const rawDome = calculateSpyderDomeMaxRange(deltaH, envelopeMaxM, envelopeHeightM);
        const isTopBand = b === bands.length - 1;
        nomMaxRangeM = isTopBand ? Math.max(80, rawDome) : rawDome;
        nomMaxRangeM = Math.max(innerConeM, nomMaxRangeM);
      } else {
        const aeroMaxM = calculateSamPearMaxRange(deltaH, envelopeMaxM, 0, envelopeHeightM, envelopeOptM);
        const launchLimitM = minElevationDeg > 0 ? Math.round(deltaH * cotMinElev) : Infinity;
        nomMaxRangeM = Math.min(aeroMaxM, launchLimitM);
        nomMaxRangeM = Math.max(innerConeM, nomMaxRangeM);
      }

      const optMaxM = Math.max(innerConeM, Math.round(nomMaxRangeM * 0.70));
      const highProbM = Math.max(innerConeM, Math.round(nomMaxRangeM * 0.85));

      const optRow: number[] = [];
      const highProbRow: number[] = [];
      const nomRow: number[] = [];
      const effRow: number[] = [];

      for (let j = 0; j < azimuthSamples.length; j++) {
        const az = azimuthSamples[j];
        nomRow.push(nomMaxRangeM);
        optRow.push(optMaxM);
        highProbRow.push(highProbM);

        if (nomMaxRangeM <= innerConeM) {
          effRow.push(innerConeM);
          continue;
        }

        // Kiểm tra góc che chắn địa hình
        let effDistM = nomMaxRangeM;
        for (const dist of sampleDistances) {
          if (dist > nomMaxRangeM) break;
          if (dist <= innerConeM) continue;

          const groundAlt = terrainMap.get(`${az}_${dist}`) || 0;
          const deltaHBulge = calculateEarthBulgeMeters(dist, kFactor);
          const tanTarget = (altM - centerAltM - deltaHBulge) / dist;
          const maskInfo = maxMaskInfoByAzDist.get(`${az}_${dist}`);
          const maxMaskTan = maskInfo ? maskInfo.maxTan : -Number.MAX_VALUE;

          if (altM < groundAlt || (maxMaskTan > tanMinElev && tanTarget < maxMaskTan)) {
            const bQuad = Math.max(tanMinElev, maxMaskTan);
            const cQuad = -(altM - centerAltM);
            const disc = bQuad * bQuad - 4 * aQuad * cQuad;
            if (disc >= 0 && altM > centerAltM) {
              const dCutoff = (-bQuad + Math.sqrt(disc)) / (2 * aQuad);
              effDistM = Math.min(dist, Math.max(innerConeM, dCutoff));
            } else {
              effDistM = Math.min(dist, Math.max(innerConeM, maskInfo ? maskInfo.peakDist : dist));
            }
            break;
          }
        }

        // Nếu có đài Radar chỉ thị mục tiêu liên kết: Tên lửa chỉ được phép bắn trong phạm vi radar quét được
        if (
          linkedRadarVolume &&
          linkedRadarVolume.effectiveRanges &&
          linkedRadarVolume.effectiveRanges.length > 0
        ) {
          const radarLat = linkedRadarVolume.radarLat;
          const radarLon = linkedRadarVolume.radarLon;

          const radarAzCount = linkedRadarVolume.azimuthSamples.length;
          const radarAzStep = 360 / radarAzCount;

          // Xác định tầng độ cao mục tiêu tương ứng trong radar (chuẩn hóa AGL vs MSL)
          const targetAltRelM = Math.max(0, altM - centerAltM);
          const radarBandsAreRelative = (linkedRadarVolume.altitudeBands[0] ?? 0) < centerAltM * 0.5;
          const targetAltToCompare = radarBandsAreRelative ? targetAltRelM : altM;

          let closestBandIdx = 0;
          let minDiffAlt = Infinity;
          for (let bi = 0; bi < linkedRadarVolume.altitudeBands.length; bi++) {
            const diff = Math.abs(linkedRadarVolume.altitudeBands[bi] - targetAltToCompare);
            if (diff < minDiffAlt) {
              minDiffAlt = diff;
              closestBandIdx = bi;
            }
          }

          // Kiểm tra điểm mục tiêu P tại cự ly effDistM trên phương vị az của SAM trong không gian trắc địa WGS84
          const targetPt = destinationPoint(centerLat, centerLon, effDistM, az);
          const radarDistM = calculateDistanceMeters(radarLat, radarLon, targetPt.lat, targetPt.lon);
          const radarAzDeg = calculateBearingDeg(radarLat, radarLon, targetPt.lat, targetPt.lon);
          const radarAzIdx = Math.round(radarAzDeg / radarAzStep) % radarAzCount;
          const radarMaxAtAzM = linkedRadarVolume.effectiveRanges[closestBandIdx]?.[radarAzIdx] ?? 0;

          // QUY TẮC BẤT BIẾN: R_wez <= R_radar tại cùng góc phương vị và độ cao
          if (radarDistM > radarMaxAtAzM || effDistM > radarMaxAtAzM) {
            effDistM = Math.min(effDistM, radarMaxAtAzM);
          }

          // Nếu tầm nhìn radar nhỏ hơn hoặc bằng cự ly cực cận R_min, hướng đó không thể bắn
          if (radarMaxAtAzM <= innerConeM) {
            effDistM = innerConeM;
          }
          effDistM = Math.max(innerConeM, effDistM);
        }

        effRow.push(Math.round(effDistM));
      }

      optimalRanges.push(optRow);
      highProbRanges.push(highProbRow);
      nominalRanges.push(nomRow);
      effectiveRanges.push(effRow);
    }

    return { optimalRanges, highProbRanges, nominalRanges, effectiveRanges };
  };

  // 1. Tính toán ma trận cho vòm chính (MR đối với Spyder, hoặc SAM thông thường)
  const mainMatrices = buildMatrix(altitudeBands, innerConeRadii, dMaxM, hMaxM, hOptM, isSpyder);

  // 2. Nếu là Tổ hợp Spyder: tính toán vòm phụ tầm ngắn SPYDER-SR (20km, 9000m) khi ở chế độ tổng hợp
  let srVolume: SamEngagementVolume | undefined = undefined;
  const isDualDomeMode = isSpyder && (mode === 'head_on' || !mode || mode === 'mr_mode');
  if (isDualDomeMode && spyderCfg) {
    const srDMaxKm = spyderCfg.sr.dMaxKm;
    const srDMinKm = spyderCfg.sr.dMinKm;
    const srHMaxM = spyderCfg.sr.hMaxM;
    const srHMinM = spyderCfg.sr.hMinM;
    const srDMaxM = srDMaxKm * 1000;
    const srAltitudeBands = extractSamAltitudeBands(centerAltM, srHMaxM, 3500, srHMinM);
    const srInnerConeRadii = srAltitudeBands.map((altM) =>
      Math.max(srDMinKm * 1000, calculateSamDeadConeRadius(altM, centerAltM, maxElevationDeg))
    );
    const srMatrices = buildMatrix(srAltitudeBands, srInnerConeRadii, srDMaxM, srHMaxM, 3500, true);

    srVolume = {
      instanceId: `${instance.instanceId}_sr`,
      instanceName: `${instance.name} (SPYDER-SR)`,
      mode,
      modeVi: 'Tổ hợp Spyder-SR Tầm ngắn (Python-5)',
      centerLat,
      centerLon,
      centerAltM,
      antennaHeightAGL,
      dMaxKm: srDMaxKm,
      dMinKm: srDMinKm,
      hMaxM: srHMaxM,
      hMinM: srHMinM,
      hOptM: 3500,
      pGhKm: 20.0,
      vMaxMps: spyderCfg.targetSpeeds.aircraftMps,
      minElevationDeg,
      maxElevationDeg,
      azimuthSamples,
      altitudeBands: srAltitudeBands,
      innerConeRadii: srInnerConeRadii,
      optimalRanges: srMatrices.optimalRanges,
      highProbRanges: srMatrices.highProbRanges,
      nominalRanges: srMatrices.nominalRanges,
      effectiveRanges: srMatrices.effectiveRanges,
      terrainStatus,
      cacheKey: `${cacheKey}_sr`,
      maxMaskInfoByAzDist,
      terrainMap,
      sampleDistances,
      terrainGrid,
      radarLat: centerLat,
      radarLon: centerLon,
      radarAltM: centerAltM,
      maxRangeKm: srDMaxKm,
      isSpyderDualDome: true,
    };
  }

  const volume: SamEngagementVolume = {
    instanceId: instance.instanceId,
    instanceName: instance.name,
    mode,
    modeVi,
    centerLat,
    centerLon,
    centerAltM,
    antennaHeightAGL,
    dMaxKm,
    dMinKm,
    hMaxM,
    hMinM,
    hOptM,
    pGhKm,
    vMaxMps,
    minElevationDeg,
    maxElevationDeg,
    azimuthSamples,
    altitudeBands,
    innerConeRadii,
    optimalRanges: mainMatrices.optimalRanges,
    highProbRanges: mainMatrices.highProbRanges,
    nominalRanges: mainMatrices.nominalRanges,
    effectiveRanges: mainMatrices.effectiveRanges,
    terrainStatus,
    cacheKey,
    maxMaskInfoByAzDist,
    terrainMap,
    sampleDistances,
    terrainGrid,
    radarLat: centerLat,
    radarLon: centerLon,
    radarAltM: centerAltM,
    maxRangeKm: dMaxKm,
    isSpyderDualDome: isSpyder,
    spyderSrVolume: srVolume,
  };

  samVolumeCache.set(cacheKey, volume);
  return volume;
}

// Cesium exports this helper at runtime but omits the private API from its declarations.
const verticalExaggeration = (Cesium as unknown as {
  VerticalExaggeration: { getHeight(height: number, scale: number, relativeHeight: number): number };
}).VerticalExaggeration;

function displayHeightTransform(options: { verticalExaggeration?: number; verticalExaggerationRelativeHeight?: number } = {}) {
  const requestedScale = options.verticalExaggeration ?? 1;
  const requestedRelativeHeight = options.verticalExaggerationRelativeHeight ?? 0;
  const scale = Number.isFinite(requestedScale) && requestedScale >= 0 ? requestedScale : 1;
  const relativeHeight = Number.isFinite(requestedRelativeHeight) ? requestedRelativeHeight : 0;
  if (!verticalExaggeration) return (physicalHeightM: number) => physicalHeightM;
  return (physicalHeightM: number) => verticalExaggeration.getHeight(physicalHeightM, scale, relativeHeight);
}

/** Chuyển đổi toạ độ trắc địa mặt cầu WGS84 sang hệ ENU cục bộ chuẩn xác, giải quyết triệt để lỗi cong Trái Đất */
function createGeodeticPositionWriter(
  centerLat: number,
  centerLon: number,
  modelMatrix: Cesium.Matrix4,
  positions: Float64Array,
  toDisplayHeight: (h: number) => number = (h) => h
) {
  const inverseModelMatrix = Cesium.Matrix4.inverseTransformation(modelMatrix, new Cesium.Matrix4());
  const worldPosition = new Cesium.Cartesian3();
  const localPosition = new Cesium.Cartesian3();

  return (positionIndex: number, rangeM: number, azimuthDeg: number, altitudeM: number) => {
    const destination = destinationPoint(centerLat, centerLon, rangeM, azimuthDeg);
    Cesium.Cartesian3.fromDegrees(
      destination.lon,
      destination.lat,
      toDisplayHeight(altitudeM),
      Cesium.Ellipsoid.WGS84,
      worldPosition
    );
    Cesium.Matrix4.multiplyByPoint(inverseModelMatrix, worldPosition, localPosition);
    positions[positionIndex] = localPosition.x;
    positions[positionIndex + 1] = localPosition.y;
    positions[positionIndex + 2] = localPosition.z;
    return localPosition;
  };
}

const MAX_CAP_RADIAL_STEP_M = 2000;
const MIN_VOLUME_WIDTH_M = 0.001;

interface SamRadialCap {
  altitudeM: number;
  outerRanges: number[];
  innerRanges: number[];
  radialSteps: number;
  upward: boolean;
}

function createSamRadialCap(
  altitudeM: number,
  outerRanges: number[],
  innerRanges: number[],
  upward: boolean
): SamRadialCap {
  const maxWidth = Math.max(0, ...outerRanges.map((range, j) => range - innerRanges[j]));
  return {
    altitudeM,
    outerRanges,
    innerRanges,
    radialSteps: maxWidth > MIN_VOLUME_WIDTH_M ? Math.ceil(maxWidth / MAX_CAP_RADIAL_STEP_M) : 0,
    upward,
  };
}

function samCapVertexCount(cap: SamRadialCap, numAz: number): number {
  return cap.radialSteps > 0 ? (cap.radialSteps + 1) * numAz : 0;
}

function appendSamRadialCap(
  cap: SamRadialCap,
  azimuthSamples: number[],
  vertexOffset: number,
  writePosition: ReturnType<typeof createGeodeticPositionWriter>,
  normals: Float32Array,
  st: Float32Array,
  indices: number[],
  isSector?: boolean,
  sectorPairs?: Array<{ j: number; diff: number }>
): number {
  if (cap.radialSteps === 0) return 0;
  const numAz = azimuthSamples.length;
  let maxLocalHeight = -Infinity;

  for (let radial = 0; radial <= cap.radialSteps; radial++) {
    const fraction = radial / cap.radialSteps;
    for (let j = 0; j < numAz; j++) {
      const range = cap.innerRanges[j] + fraction * (cap.outerRanges[j] - cap.innerRanges[j]);
      const index = vertexOffset + radial * numAz + j;
      const positionIndex = index * 3;
      const local = writePosition(positionIndex, range, azimuthSamples[j], cap.altitudeM);
      maxLocalHeight = Math.max(maxLocalHeight, local.z);
      normals[positionIndex] = 0;
      normals[positionIndex + 1] = 0;
      normals[positionIndex + 2] = cap.upward ? 1 : -1;
      st[index * 2] = j / numAz;
      st[index * 2 + 1] = cap.upward ? 1 : 0;
    }
  }

  if (isSector && sectorPairs && sectorPairs.length >= 2) {
    const pairsCount = sectorPairs.length - 1;
    for (let radial = 0; radial < cap.radialSteps; radial++) {
      for (let s = 0; s < pairsCount; s++) {
        const j = sectorPairs[s].j;
        const nextJ = sectorPairs[s + 1].j;
        if (cap.outerRanges[j] - cap.innerRanges[j] <= MIN_VOLUME_WIDTH_M &&
            cap.outerRanges[nextJ] - cap.innerRanges[nextJ] <= MIN_VOLUME_WIDTH_M) continue;
        const p00 = vertexOffset + radial * numAz + j;
        const p01 = vertexOffset + radial * numAz + nextJ;
        const p10 = p00 + numAz;
        const p11 = p01 + numAz;
        if (cap.upward) {
          indices.push(p00, p01, p10, p10, p01, p11);
        } else {
          indices.push(p00, p10, p01, p10, p11, p01);
        }
      }
    }
  } else {
    for (let radial = 0; radial < cap.radialSteps; radial++) {
      for (let j = 0; j < numAz; j++) {
        const nextJ = (j + 1) % numAz;
        if (cap.outerRanges[j] - cap.innerRanges[j] <= MIN_VOLUME_WIDTH_M &&
            cap.outerRanges[nextJ] - cap.innerRanges[nextJ] <= MIN_VOLUME_WIDTH_M) continue;
        const p00 = vertexOffset + radial * numAz + j;
        const p01 = vertexOffset + radial * numAz + nextJ;
        const p10 = p00 + numAz;
        const p11 = p01 + numAz;
        if (cap.upward) {
          indices.push(p00, p01, p10, p10, p01, p11);
        } else {
          indices.push(p00, p10, p01, p10, p11, p01);
        }
      }
    }
  }

  return maxLocalHeight;
}

/**
 * 5. XÂY DỰNG MESH ĐA GIÁC 3D CHO TỪNG LỚP HỎA LỰC SAM
 * Chuẩn WGS-84 ellipsoid: vỏ ngoài, nón mù, nắp trên và nắp sàn hỏa lực hMinM.
 */
export function buildSamLayerGeometry(
  volume: SamEngagementVolume,
  layer: SamProbabilityLayer = 'outer_boundary',
  options: {
    mode?: 'nominal' | 'terrain-aware';
    showInnerCone?: boolean;
    showTopCap?: boolean;
    showBottomCap?: boolean;
    combatMode?: 'omnidirectional' | 'sector';
    combatAzimuthDeg?: number;
    sectorAngleDeg?: number;
    verticalExaggeration?: number;
    verticalExaggerationRelativeHeight?: number;
    selectedAltitudeM?: number | null;
  } = {}
): SamVolumeGeometry | null {
  const { altitudeBands, azimuthSamples, innerConeRadii, centerLat, centerLon, centerAltM } = volume;
  const rawNumBands = altitudeBands.length;
  const numAz = azimuthSamples.length;
  if (rawNumBands < 2 || numAz < 3) return null;

  const isTerrainAware = options.mode !== 'nominal';
  const showInnerCone = options.showInnerCone !== false;
  const showTopCap = options.showTopCap !== false;
  const showBottomCap = options.showBottomCap !== false; // Luôn bật nắp sàn đáy để cắt địa hình chuẩn xác

  // Xử lý cắt lát độ cao nếu có selectedAltitudeM
  const maxAlt = options.selectedAltitudeM && options.selectedAltitudeM > 0
    ? options.selectedAltitudeM
    : altitudeBands[rawNumBands - 1];

  interface SlicedSamBand {
    altM: number;
    ranges: number[];
    innerRadius: number;
  }

  // Lựa chọn ma trận cự ly tương ứng với lớp
  let rangeMatrix = isTerrainAware ? volume.effectiveRanges : volume.nominalRanges;
  let scale = 1.0;
  if (layer === 'high_prob') {
    scale = 0.85;
    rangeMatrix = volume.highProbRanges;
  } else if (layer === 'optimal') {
    scale = 0.70;
    rangeMatrix = volume.optimalRanges;
  }

  const slicedBands: SlicedSamBand[] = [];
  for (let k = 0; k < rawNumBands; k++) {
    const alt = altitudeBands[k];
    if (alt <= maxAlt) {
      const rowRanges: number[] = new Array(numAz);
      for (let j = 0; j < numAz; j++) {
        let r = rangeMatrix[k]?.[j] ?? 0;
        if (isTerrainAware && volume.effectiveRanges[k]?.[j] !== undefined) {
          r = Math.min(r, volume.effectiveRanges[k][j] * scale);
        }
        rowRanges[j] = r;
      }
      slicedBands.push({
        altM: alt,
        ranges: rowRanges,
        innerRadius: innerConeRadii[k] ?? 0.1,
      });
    } else {
      break;
    }
  }

  // Nội suy tầng đỉnh nếu maxAlt nằm giữa 2 tầng
  if (slicedBands.length > 0 && slicedBands[slicedBands.length - 1].altM < maxAlt) {
    const lastBand = slicedBands[slicedBands.length - 1];
    const nextIdx = slicedBands.length;
    if (nextIdx < rawNumBands) {
      const nextAlt = altitudeBands[nextIdx];
      const span = nextAlt - lastBand.altM;
      const t = span > 0 ? (maxAlt - lastBand.altM) / span : 0;
      const interpRanges: number[] = new Array(numAz);
      for (let j = 0; j < numAz; j++) {
        let rNext = rangeMatrix[nextIdx]?.[j] ?? 0;
        if (isTerrainAware && volume.effectiveRanges[nextIdx]?.[j] !== undefined) {
          rNext = Math.min(rNext, volume.effectiveRanges[nextIdx][j] * scale);
        }
        interpRanges[j] = lastBand.ranges[j] + t * (rNext - lastBand.ranges[j]);
      }
      const interpInner =
        lastBand.innerRadius + t * ((innerConeRadii[nextIdx] ?? 0.1) - lastBand.innerRadius);
      slicedBands.push({
        altM: maxAlt,
        ranges: interpRanges,
        innerRadius: interpInner,
      });
    }
  }

  // Đảm bảo có ít nhất 2 tầng
  if (slicedBands.length === 1) {
    const single = slicedBands[0];
    const baseAlt = Math.max(0, Math.round(single.altM * 0.3));
    slicedBands.unshift({
      altM: baseAlt,
      ranges: [...single.ranges],
      innerRadius: single.innerRadius,
    });
  } else if (slicedBands.length === 0) {
    // Nếu maxAlt nhỏ hơn tầng thấp nhất
    const rowRanges: number[] = new Array(numAz);
    for (let j = 0; j < numAz; j++) {
      let r = rangeMatrix[0]?.[j] ?? 0;
      if (isTerrainAware && volume.effectiveRanges[0]?.[j] !== undefined) {
        r = Math.min(r, volume.effectiveRanges[0][j] * scale);
      }
      rowRanges[j] = r;
    }
    slicedBands.push({ altM: Math.max(0, maxAlt * 0.5), ranges: rowRanges, innerRadius: innerConeRadii[0] ?? 0.1 });
    slicedBands.push({ altM: maxAlt, ranges: [...rowRanges], innerRadius: innerConeRadii[0] ?? 0.1 });
  }

  const numBands = slicedBands.length;

  const toDisplayHeight = displayHeightTransform(options);
  const center = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, toDisplayHeight(centerAltM));
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // Luôn hiển thị Vùng Hỏa Lực dạng Toàn Phương 360° (Omnidirectional)
  const isSector = false;
  const sectorPairs: Array<{ j: number; diff: number }> = [];

  // Thu thập cự ly trong/ngoài cho từng tầng độ cao
  const bandOuterRanges: number[][] = [];
  const bandInnerRanges: number[][] = [];
  let maxEffectiveRadiusM = 0;

  for (let k = 0; k < numBands; k++) {
    const rOutRow: number[] = [];
    const rInRow: number[] = [];
    const band = slicedBands[k];
    for (let j = 0; j < numAz; j++) {
      let rOuter = band.ranges[j];
      const rInner = showInnerCone ? Math.min(rOuter, Math.max(0.1, band.innerRadius)) : 0.1;
      rOuter = Math.max(rInner, rOuter);
      if (rOuter > maxEffectiveRadiusM) maxEffectiveRadiusM = rOuter;
      rOutRow.push(rOuter);
      rInRow.push(rInner);
    }
    bandOuterRanges.push(rOutRow);
    bandInnerRanges.push(rInRow);
  }

  // Khởi tạo các nắp (Top Cap và Bottom Cap sàn hỏa lực)
  const caps: SamRadialCap[] = [];
  if (showTopCap) {
    caps.push(createSamRadialCap(
      slicedBands[numBands - 1].altM,
      bandOuterRanges[numBands - 1],
      bandInnerRanges[numBands - 1],
      true
    ));
  }
  if (showBottomCap) {
    caps.push(createSamRadialCap(
      slicedBands[0].altM,
      bandOuterRanges[0],
      bandInnerRanges[0],
      false
    ));
  }

  const outerVertexOffset = 0;
  const outerVertexCount = numBands * numAz;

  const innerVertexOffset = outerVertexCount;
  const innerVertexCount = showInnerCone ? numBands * numAz : 0;

  const capsVertexCount = caps.reduce((acc, c) => acc + samCapVertexCount(c, numAz), 0);
  const totalVertices = outerVertexCount + innerVertexCount + capsVertexCount;

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);
  const indices: number[] = [];

  const writePosition = createGeodeticPositionWriter(centerLat, centerLon, modelMatrix, positions, toDisplayHeight);
  let apexHeightM = 0;

  // A. Vỏ ngoài (Outer Shell)
  for (let k = 0; k < numBands; k++) {
    const altM = slicedBands[k].altM;
    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;
    for (let j = 0; j < numAz; j++) {
      const vIdx = outerVertexOffset + k * numAz + j;
      const pIdx = vIdx * 3;
      const stIdx = vIdx * 2;
      const local = writePosition(pIdx, bandOuterRanges[k][j], azimuthSamples[j], altM);
      apexHeightM = Math.max(apexHeightM, local.z);

      const len = Math.sqrt(local.x * local.x + local.y * local.y + local.z * local.z) || 1;
      normals[pIdx] = local.x / len;
      normals[pIdx + 1] = local.y / len;
      normals[pIdx + 2] = local.z / len;

      st[stIdx] = j / numAz;
      st[stIdx + 1] = vCoord;
    }
  }

  // B. Nón mù bên trong (Inner Cone)
  if (showInnerCone) {
    for (let k = 0; k < numBands; k++) {
      const altM = slicedBands[k].altM;
      const vCoord = numBands > 1 ? k / (numBands - 1) : 0;
      for (let j = 0; j < numAz; j++) {
        const vIdx = innerVertexOffset + k * numAz + j;
        const pIdx = vIdx * 3;
        const stIdx = vIdx * 2;
        const local = writePosition(pIdx, bandInnerRanges[k][j], azimuthSamples[j], altM);

        const len = Math.sqrt(local.x * local.x + local.y * local.y + local.z * local.z) || 1;
        normals[pIdx] = -local.x / len;
        normals[pIdx + 1] = -local.y / len;
        normals[pIdx + 2] = -local.z / len;

        st[stIdx] = j / numAz;
        st[stIdx + 1] = vCoord;
      }
    }
  }

  // C. Dựng các nắp (Radial Caps)
  let capOffset = outerVertexCount + innerVertexCount;
  for (const cap of caps) {
    appendSamRadialCap(cap, azimuthSamples, capOffset, writePosition, normals, st, indices, isSector, sectorPairs);
    capOffset += samCapVertexCount(cap, numAz);
  }

  // D. Nối tam giác cho Vỏ ngoài và Nón mù
  if (isSector && sectorPairs.length >= 2) {
    const pairsCount = sectorPairs.length - 1;
    for (let k = 0; k < numBands - 1; k++) {
      for (let s = 0; s < pairsCount; s++) {
        const j = sectorPairs[s].j;
        const jNext = sectorPairs[s + 1].j;
        const p00 = outerVertexOffset + k * numAz + j;
        const p01 = outerVertexOffset + k * numAz + jNext;
        const p10 = outerVertexOffset + (k + 1) * numAz + j;
        const p11 = outerVertexOffset + (k + 1) * numAz + jNext;

        indices.push(p00, p01, p10);
        indices.push(p10, p01, p11);
      }
    }

    if (showInnerCone) {
      for (let k = 0; k < numBands - 1; k++) {
        for (let s = 0; s < pairsCount; s++) {
          const j = sectorPairs[s].j;
          const jNext = sectorPairs[s + 1].j;
          const p00 = innerVertexOffset + k * numAz + j;
          const p01 = innerVertexOffset + k * numAz + jNext;
          const p10 = innerVertexOffset + (k + 1) * numAz + j;
          const p11 = innerVertexOffset + (k + 1) * numAz + jNext;

          indices.push(p00, p10, p01);
          indices.push(p10, p11, p01);
        }
      }
    }

    // Hai vách sườn bên phẳng khép kín rẻ quạt
    const jLeft = sectorPairs[0].j;
    const jRight = sectorPairs[sectorPairs.length - 1].j;
    for (let k = 0; k < numBands - 1; k++) {
      // Vách bên trái
      const out0L = outerVertexOffset + k * numAz + jLeft;
      const out1L = outerVertexOffset + (k + 1) * numAz + jLeft;
      const in0L = showInnerCone ? innerVertexOffset + k * numAz + jLeft : out0L;
      const in1L = showInnerCone ? innerVertexOffset + (k + 1) * numAz + jLeft : out1L;
      indices.push(out0L, out1L, in0L);
      indices.push(out1L, in1L, in0L);

      // Vách bên phải
      const out0R = outerVertexOffset + k * numAz + jRight;
      const out1R = outerVertexOffset + (k + 1) * numAz + jRight;
      const in0R = showInnerCone ? innerVertexOffset + k * numAz + jRight : out0R;
      const in1R = showInnerCone ? innerVertexOffset + (k + 1) * numAz + jRight : out1R;
      indices.push(out0R, in0R, out1R);
      indices.push(out1R, in0R, in1R);
    }
  } else {
    // Toàn phương 360°
    for (let k = 0; k < numBands - 1; k++) {
      for (let j = 0; j < numAz; j++) {
        const jNext = (j + 1) % numAz;
        const p00 = outerVertexOffset + k * numAz + j;
        const p01 = outerVertexOffset + k * numAz + jNext;
        const p10 = outerVertexOffset + (k + 1) * numAz + j;
        const p11 = outerVertexOffset + (k + 1) * numAz + jNext;

        indices.push(p00, p01, p10);
        indices.push(p10, p01, p11);
      }
    }

    if (showInnerCone) {
      for (let k = 0; k < numBands - 1; k++) {
        for (let j = 0; j < numAz; j++) {
          const jNext = (j + 1) % numAz;
          const p00 = innerVertexOffset + k * numAz + j;
          const p01 = innerVertexOffset + k * numAz + jNext;
          const p10 = innerVertexOffset + (k + 1) * numAz + j;
          const p11 = innerVertexOffset + (k + 1) * numAz + jNext;

          indices.push(p00, p10, p01);
          indices.push(p10, p11, p01);
        }
      }
    }
  }

  const indicesUint32 = new Uint32Array(indices);
  return {
    positions,
    normals,
    st,
    indices: indicesUint32,
    vertexCount: totalVertices,
    triangleCount: indicesUint32.length / 3,
    apexHeightM,
    maxEffectiveRadiusM,
    center,
    modelMatrix,
  };
}


/**
 * 6. ĐÓNG GÓI THÀNH CESIUM GEOMETRY INSTANCE
 */
export function createSamVolumeGeometryInstance(
  geom: SamVolumeGeometry,
  instanceId: string,
  layer: SamProbabilityLayer
): Cesium.GeometryInstance {
  const attributes = new Cesium.GeometryAttributes();
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: geom.positions,
  });
  attributes.normal = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: geom.normals,
  });
  attributes.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: geom.st,
  });

  const cesiumGeometry = new Cesium.Geometry({
    attributes,
    indices: geom.indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: new Cesium.BoundingSphere(
      new Cesium.Cartesian3(0, 0, geom.apexHeightM * 0.5),
      Math.max(geom.maxEffectiveRadiusM, geom.apexHeightM)
    ),
  });

  return new Cesium.GeometryInstance({
    id: `sam-vol-${instanceId}-${layer}`,
    geometry: cesiumGeometry,
    modelMatrix: geom.modelMatrix,
  });
}

/**
 * 7. XUẤT DỮ LIỆU ĐƯỜNG CONG MẶT CẮT ĐỨNG 2D (CROSS SECTION WEZ PROFILE)
 * Phục vụ vẽ trực tiếp trên RadarCrossSectionPanel
 */
export interface SamCrossSectionCurvePoint {
  altM: number;
  dMinM: number;
  dOptM: number;
  dHighM: number;
  dMaxM: number;
  dEffectiveM: number;
}

export function getSamCrossSectionProfile(
  volume: SamEngagementVolume,
  azimuthDeg: number = 0
): {
  points: SamCrossSectionCurvePoint[];
  hMinM: number;
  hMaxM: number;
  hOptM: number;
  dMaxM: number;
  dMinM: number;
  modeVi: string;
  isSpyderDualDome?: boolean;
  spyderSrProfile?: {
    points: SamCrossSectionCurvePoint[];
    hMinM: number;
    hMaxM: number;
    dMaxM: number;
    dMinM: number;
    modeVi: string;
  };
} {
  const { altitudeBands, azimuthSamples, optimalRanges, highProbRanges, nominalRanges, effectiveRanges, innerConeRadii } = volume;

  // Tìm chỉ số góc azimuth gần nhất
  let closestAzIdx = 0;
  let minDiff = 360;
  for (let j = 0; j < azimuthSamples.length; j++) {
    let diff = Math.abs(azimuthSamples[j] - azimuthDeg);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      closestAzIdx = j;
    }
  }

  const points: SamCrossSectionCurvePoint[] = altitudeBands.map((altM, k) => ({
    altM,
    dMinM: innerConeRadii[k],
    dOptM: optimalRanges[k][closestAzIdx],
    dHighM: highProbRanges[k][closestAzIdx],
    dMaxM: nominalRanges[k][closestAzIdx],
    dEffectiveM: effectiveRanges[k][closestAzIdx],
  }));

  let spyderSrProfile: {
    points: SamCrossSectionCurvePoint[];
    hMinM: number;
    hMaxM: number;
    dMaxM: number;
    dMinM: number;
    modeVi: string;
  } | undefined = undefined;

  if (volume.isSpyderDualDome && volume.spyderSrVolume) {
    const srVol = volume.spyderSrVolume;
    let srClosestAzIdx = 0;
    let srMinDiff = 360;
    for (let j = 0; j < srVol.azimuthSamples.length; j++) {
      let diff = Math.abs(srVol.azimuthSamples[j] - azimuthDeg);
      if (diff > 180) diff = 360 - diff;
      if (diff < srMinDiff) {
        srMinDiff = diff;
        srClosestAzIdx = j;
      }
    }
    spyderSrProfile = {
      points: srVol.altitudeBands.map((altM, k) => ({
        altM,
        dMinM: srVol.innerConeRadii[k],
        dOptM: srVol.optimalRanges[k][srClosestAzIdx],
        dHighM: srVol.highProbRanges[k][srClosestAzIdx],
        dMaxM: srVol.nominalRanges[k][srClosestAzIdx],
        dEffectiveM: srVol.effectiveRanges[k][srClosestAzIdx],
      })),
      hMinM: srVol.hMinM,
      hMaxM: srVol.hMaxM,
      dMaxM: srVol.dMaxKm * 1000,
      dMinM: srVol.dMinKm * 1000,
      modeVi: srVol.modeVi,
    };
  }

  return {
    points,
    hMinM: volume.hMinM,
    hMaxM: volume.hMaxM,
    hOptM: volume.hOptM,
    dMaxM: volume.dMaxKm * 1000,
    dMinM: volume.dMinKm * 1000,
    modeVi: volume.modeVi,
    isSpyderDualDome: volume.isSpyderDualDome,
    spyderSrProfile,
  };
}
