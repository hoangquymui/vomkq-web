import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type {
  RadarCoverageVolume,
  VolumeCalculationParams,
  VolumeVisibilityState,
  AltitudeBandInfo,
  RadarTerrainGrid,
} from '../types/radarVolume';
import type { SharedTerrainSlice } from '../types/radarCoverage';
import {
  calculateConeOfSilenceRadiusKm,
  calculateEarthBulgeMeters,
  calculateRadarHorizonDistanceKm,
  DEFAULT_K_FACTOR,
  EARTH_RADIUS_METERS,
  getProfileMaxRange,
} from './radarMath';
import { destinationPoint } from './radarLosEngine';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';
import { sampleTerrainOptimized } from './terrainSampler';

/** Cache lưu các Volume đã tính để tránh tính lại khi xoay/zoom bản đồ */
const volumeCache = new Map<string, RadarCoverageVolume>();
const terrainProviderIds = new WeakMap<Cesium.TerrainProvider, number>();
let nextTerrainProviderId = 1;

/** Keep a uniform, closed azimuth grid even when a requested step does not divide 360. */
function getTerrainAzimuthStepDeg(params: VolumeCalculationParams): number {
  const requestedAzStep = params.azimuthStepDeg;
  const azStep = typeof requestedAzStep === 'number' && Number.isFinite(requestedAzStep) && requestedAzStep > 0
    ? Math.min(360, requestedAzStep)
    : 5;
  const requestedTerrainStep = params.terrainAzimuthStepDeg;
  const terrainStep = typeof requestedTerrainStep === 'number' && Number.isFinite(requestedTerrainStep) && requestedTerrainStep > 0
    ? Math.min(360, requestedTerrainStep)
    : Math.min(azStep, 2);
  return 360 / Math.ceil(360 / terrainStep);
}

/**
 * Trích xuất danh sách các tầng độ cao (m) phù hợp nhất cho đài radar
 * Kết hợp giữa:
 * 1. Bảng tầm radar theo độ cao (altitudeDetectionTable) của nhà sản xuất khí tài
 * 2. Các tầng tác chiến chuẩn (100m, 300m, 500m, 1km, 3km, 5km, 10km, 15km, 20km, 25km...)
 * 3. Trần phủ sóng tối đa (coverageHeightKm) của khí tài
 */
export function extractAltitudeBands(instance: EquipmentInstance): number[] {
  const template = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const table = instance.altitudeDetectionTable || template?.altitudeDetectionTable;

  const maxAltitudeM = Math.max(1000, (instance.coverageHeightKm || 25) * 1000);
  const bandSet = new Set<number>();

  // 1. Thêm các tầng từ bảng tầm tài liệu kỹ thuật
  if (table && table.rows && table.rows.length > 0) {
    table.rows.forEach((r) => {
      if (r.altitudeM > 0 && r.altitudeM <= maxAltitudeM) {
        bandSet.add(r.altitudeM);
      }
    });
  }

  // 2. Thêm các tầng tác chiến tiêu chuẩn phòng không (50m: mục tiêu bay thấp/hành trình)
  const standardAltitudes = [
    50, 100, 300, 500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000,
  ];
  standardAltitudes.forEach((alt) => {
    if (alt <= maxAltitudeM) {
      bandSet.add(alt);
    }
  });

  // Luôn đảm bảo có trần độ cao tối đa
  bandSet.add(maxAltitudeM);

  return Array.from(bandSet).sort((a, b) => a - b);
}

/**
 * Tính cự ly danh định lý thuyết (m) tại một độ cao mục tiêu cụ thể
 */
export function calculateNominalRangeAtAltitude(
  instance: EquipmentInstance,
  altitudeM: number,
  kFactor: number = DEFAULT_K_FACTOR
): number {
  const template = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const table = instance.altitudeDetectionTable || template?.altitudeDetectionTable;
  const profile = instance.coverageProfile || template?.coverageProfile;
  const antennaHeight = instance.antennaHeightAGL || 15;
  const maxRangeM = (instance.rangeKm || 100) * 1000;

  // 1. Nếu có bảng tra cứu độ cao, ưu tiên nội suy tuyến tính từ bảng
  if (table && table.rows && table.rows.length > 0) {
    const rows = [...table.rows].sort((a, b) => a.altitudeM - b.altitudeM);
    // Nếu độ cao <= hàng đầu
    if (altitudeM <= rows[0].altitudeM) {
      const val = typeof rows[0].val1 === 'number' ? rows[0].val1 : parseFloat(String(rows[0].val1)) || 30;
      return Math.min(maxRangeM, val * 1000);
    }
    // Nếu độ cao >= hàng cuối
    if (altitudeM >= rows[rows.length - 1].altitudeM) {
      const last = rows[rows.length - 1];
      const val = typeof last.val1 === 'number' ? last.val1 : parseFloat(String(last.val1)) || (instance.rangeKm || 100);
      return Math.min(maxRangeM, val * 1000);
    }
    // Nội suy giữa 2 hàng liền kề
    for (let i = 0; i < rows.length - 1; i++) {
      const rA = rows[i];
      const rB = rows[i + 1];
      if (altitudeM >= rA.altitudeM && altitudeM <= rB.altitudeM) {
        const valA = typeof rA.val1 === 'number' ? rA.val1 : parseFloat(String(rA.val1)) || 30;
        const valB = typeof rB.val1 === 'number' ? rB.val1 : parseFloat(String(rB.val1)) || valA;
        const span = rB.altitudeM - rA.altitudeM;
        const fraction = span > 0 ? (altitudeM - rA.altitudeM) / span : 0;
        const interpolatedKm = valA + (valB - valA) * fraction;
        return Math.min(maxRangeM, interpolatedKm * 1000);
      }
    }
  }

  // 2. Giới hạn bởi cự ly đường chân trời quang học / vô tuyến theo công thức chuẩn:
  // D_nt = 4.12 * (sqrt(h_a) + sqrt(H_mt)) (km)
  const horizonKm = calculateRadarHorizonDistanceKm(antennaHeight, altitudeM) * (kFactor / DEFAULT_K_FACTOR);
  let maxRangeKmAtAlt = Math.min(instance.rangeKm, horizonKm);

  // 3. Giới hạn bởi góc tà tối thiểu (minElevationDeg)
  const minElevDeg = instance.minElevationDeg !== undefined ? instance.minElevationDeg : (profile?.minElevationDeg ?? 0);
  if (minElevDeg > 0.05 && altitudeM > antennaHeight) {
    const minElevRad = (minElevDeg * Math.PI) / 180;
    const deltaH = altitudeM - antennaHeight;
    const maxRangeByMinElevM = deltaH / Math.tan(minElevRad);
    maxRangeKmAtAlt = Math.min(maxRangeKmAtAlt, maxRangeByMinElevM / 1000);
  }

  // 4. Nếu có Coverage Profile theo góc tà, đối chiếu với búp sóng
  if (profile && profile.points && profile.points.length > 0) {
    const estDistanceM = Math.max(5000, maxRangeKmAtAlt * 1000 * 0.7);
    const deltaH = altitudeM - antennaHeight;
    const approxElevDeg = Math.max(0, Math.min(85, (Math.atan2(deltaH, estDistanceM) * 180) / Math.PI));
    const profileRangeKm = getProfileMaxRange(profile, approxElevDeg, instance.rangeKm);
    if (profileRangeKm > 0) {
      maxRangeKmAtAlt = Math.min(maxRangeKmAtAlt, profileRangeKm);
    }
  }

  return Math.min(maxRangeM, Math.max(1000, maxRangeKmAtAlt * 1000));
}

/**
 * Tạo khóa cache duy nhất cho RadarCoverageVolume
 */
export function generateVolumeCacheKey(
  instance: EquipmentInstance,
  params: VolumeCalculationParams,
  terrainProvider?: Cesium.TerrainProvider | null
): string {
  const azStep = getTerrainAzimuthStepDeg(params);
  const radStep = params.radialStepMeters || 2000;
  const k = (params.kFactor || DEFAULT_K_FACTOR).toFixed(3);
  const altKey = params.customAltitudeBands?.join(',') || 'auto';
  const profileKey = instance.coverageProfile?.points.map((p) => `${p.elevationDeg}:${p.maxRangeKm}`).join('-') || 'def';
  const elevKey = `${instance.minElevationDeg ?? 0}_${instance.maxElevationDeg ?? 30}`;
  let terrainKey = 'no-terrain';
  if (terrainProvider) {
    let providerId = terrainProviderIds.get(terrainProvider);
    if (providerId === undefined) {
      providerId = nextTerrainProviderId++;
      terrainProviderIds.set(terrainProvider, providerId);
    }
    terrainKey = `terrain-${providerId}`;
  }

  return `vol_v3_${terrainKey}_${instance.instanceId}_${instance.latitude.toFixed(4)}_${instance.longitude.toFixed(4)}_${instance.altitude}_${instance.antennaHeightAGL}_${instance.rangeKm}_${instance.coverageHeightKm}_${elevKey}_${azStep}_${radStep}_${k}_${altKey}_${profileKey}`;
}

/**
 * ĐỘNG CƠ TÍNH TOÁN DETECTION VOLUME 3D THEO ĐỊA HÌNH
 * Xuất dữ liệu trung gian chuẩn hóa:
 * Altitude × Azimuth × Nominal Range × Effective Range × Visibility State
 */
export async function computeRadarCoverageVolume(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  params: VolumeCalculationParams = {}
): Promise<RadarCoverageVolume> {
  const cacheKey = generateVolumeCacheKey(instance, params, terrainProvider);
  const cached = volumeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const {
    radialStepMeters = 2000,
    kFactor = DEFAULT_K_FACTOR,
    customAltitudeBands,
  } = params;
  const azimuthStepDeg = getTerrainAzimuthStepDeg(params);

  const radarLat = instance.latitude;
  const radarLon = instance.longitude;
  const radarGroundAltM = instance.altitude || 0;
  const antennaHeightAGL = instance.antennaHeightAGL || 15;
  const radarCenterAltM = radarGroundAltM + antennaHeightAGL;
  const maxRangeKm = instance.rangeKm || 100;
  const maxRangeM = maxRangeKm * 1000;
  const maxElevationDeg = instance.maxElevationDeg || 30;

  // 1. Xác định trục Độ cao (Altitude Bands)
  const altitudeBands = customAltitudeBands && customAltitudeBands.length > 0
    ? [...customAltitudeBands].sort((a, b) => a - b)
    : extractAltitudeBands(instance);

  // 2. Xác định trục Phương vị (Azimuth Samples)
  const azimuthSamples: number[] = [];
  const azimuthCount = Math.round(360 / azimuthStepDeg);
  for (let azIndex = 0; azIndex < azimuthCount; azIndex++) {
    azimuthSamples.push(azIndex * azimuthStepDeg);
  }

  // 3. Tính toán trước bán kính nón mù đỉnh đầu (Cone of Silence) theo từng tầng độ cao:
  // R_kh = deltaH * cotg(eps_max) với deltaH = max(0, altM - radarCenterAltM)
  const innerConeRadii = altitudeBands.map((altM) => {
    const deltaH = Math.max(0, altM - radarCenterAltM);
    const radiusKm = calculateConeOfSilenceRadiusKm(deltaH, maxElevationDeg);
    return Math.round(radiusKm * 1000);
  });

  // 4. Tính trước cự ly danh nghĩa lý thuyết cho từng tầng độ cao
  const nominalRangesByBand = altitudeBands.map((altM) => {
    return calculateNominalRangeAtAltitude(instance, altM, kFactor);
  });

  // 5 & 6. Lấy mẫu độ cao địa hình DEM và tính góc che chắn tích lũy
  const { terrainMap, maxMaskInfoByAzDist, sampleDistances, terrainStatus, terrainGrid } = await sampleTerrainGridAndMasks(
    radarLat,
    radarLon,
    radarCenterAltM,
    maxRangeM,
    azimuthSamples,
    radialStepMeters,
    terrainProvider,
    kFactor,
    nominalRangesByBand
  );

  // 7. Xây dựng ma trận nominalRanges, effectiveRanges, visibilityStates
  // Kích thước: [altitudeBands.length][azimuthSamples.length]
  const rEquiv = EARTH_RADIUS_METERS * kFactor;
  const aQuad = 1 / (2 * rEquiv);

  const nominalRanges: number[][] = [];
  const effectiveRanges: number[][] = [];
  const visibilityStates: VolumeVisibilityState[][] = [];

  let totalSamples = 0;
  let terrainLimitedCount = 0;

  for (let bandIdx = 0; bandIdx < altitudeBands.length; bandIdx++) {
    const altM = altitudeBands[bandIdx];
    const nomRangeM = nominalRangesByBand[bandIdx];
    const innerConeM = innerConeRadii[bandIdx];

    const nominalRow: number[] = [];
    const effectiveRow: number[] = [];
    const visibilityRow: VolumeVisibilityState[] = [];

    for (let azIdx = 0; azIdx < azimuthSamples.length; azIdx++) {
      const az = azimuthSamples[azIdx];
      totalSamples++;

      nominalRow.push(nomRangeM);

      if (terrainStatus !== 'loaded') {
        effectiveRow.push(nomRangeM);
        visibilityRow.push('NO_DATA');
        continue;
      }

      // Nếu cự ly danh nghĩa nhỏ hơn hoặc bằng nón mù đỉnh đầu -> ngoài búp sóng
      if (nomRangeM <= innerConeM) {
        effectiveRow.push(innerConeM);
        visibilityRow.push('OUTSIDE_ENVELOPE');
        continue;
      }

      // Tìm cự ly xa nhất dọc theo phương vị az mà mục tiêu ở độ cao altM không bị che khuất
      let effectiveDistM = nomRangeM;
      let isBlocked = false;
      let previousDistM = 0;
      let previousGroundAltM = radarGroundAltM;

      // Duyệt qua các mốc cự ly lấy mẫu
      for (const dist of sampleDistances) {
        if (dist > nomRangeM) break;
        const groundAlt = terrainMap.get(`${az}_${dist}`) ?? 0;
        if (dist <= innerConeM) {
          previousDistM = dist;
          previousGroundAltM = groundAlt;
          continue;
        }

        // Góc nhìn tới mục tiêu ở độ cao altM tại khoảng cách dist:
        const deltaH = calculateEarthBulgeMeters(dist, kFactor);
        const tanTarget = (altM - radarCenterAltM - deltaH) / dist;
        const maskInfo = maxMaskInfoByAzDist.get(`${az}_${dist}`);
        const maxMaskTan = maskInfo ? maskInfo.maxTan : -Number.MAX_VALUE;

        // Bị chắn nếu mục tiêu nằm dưới mặt đất cục bộ hoặc bị khuất sau góc chắn của núi
        // The terrain horizon can be below the antenna's horizontal plane.
        // Beam elevation limits must not disable terrain occlusion in that case.
        if (altM < groundAlt || tanTarget < maxMaskTan) {
          isBlocked = true;
          // Giải phương trình giao tuyến giải tích giữa tia quét và góc chắn núi
          const cQuad = -(altM - radarCenterAltM);
          let cutoffM = previousDistM;
          let hasShadowCutoff = false;
          const previousMaskInfo = maxMaskInfoByAzDist.get(`${az}_${previousDistM}`);
          for (const mask of [previousMaskInfo, maskInfo]) {
            if (!mask) continue;
            const bQuad = mask.maxTan;
            const disc = bQuad * bQuad - 4 * aQuad * cQuad;
            if (disc < 0) continue;
            const dCutoff = (-bQuad + Math.sqrt(disc)) / (2 * aQuad);
            // A mountain cannot occlude foreground points before the mountain.
            // A newly sampled peak must not project its shadow back to the radar.
            if (dCutoff >= mask.peakDist) {
              cutoffM = hasShadowCutoff ? Math.min(cutoffM, dCutoff) : dCutoff;
              hasShadowCutoff = true;
            }
          }
          if (altM < groundAlt && previousGroundAltM <= altM && groundAlt > previousGroundAltM) {
            const t = (altM - previousGroundAltM) / (groundAlt - previousGroundAltM);
            const groundCutoffM = previousDistM + t * (dist - previousDistM);
            cutoffM = hasShadowCutoff ? Math.min(cutoffM, groundCutoffM) : groundCutoffM;
          }
          effectiveDistM = Math.min(dist, Math.max(innerConeM, previousDistM, cutoffM));
          break;
        }
        previousDistM = dist;
        previousGroundAltM = groundAlt;
      }

      if (isBlocked) {
        terrainLimitedCount++;
        effectiveRow.push(Math.floor(effectiveDistM));
        visibilityRow.push('TERRAIN_LIMITED');
      } else {
        effectiveRow.push(Math.round(nomRangeM));
        visibilityRow.push('VISIBLE');
      }
    }

    nominalRanges.push(nominalRow);
    effectiveRanges.push(effectiveRow);
    visibilityStates.push(visibilityRow);
  }

  // 8. Tổng hợp thông tin từng tầng độ cao (bandInfos)
  const bandInfos: AltitudeBandInfo[] = altitudeBands.map((altM, bandIdx) => {
    const effRow = effectiveRanges[bandIdx];
    const visRow = visibilityStates[bandIdx];
    const nomKm = nominalRangesByBand[bandIdx] / 1000;
    const innerKm = innerConeRadii[bandIdx] / 1000;

    let sumEffM = 0;
    let limitedCount = 0;
    for (let i = 0; i < effRow.length; i++) {
      sumEffM += effRow[i];
      if (visRow[i] === 'TERRAIN_LIMITED') limitedCount++;
    }

    const avgEffKm = effRow.length > 0 ? sumEffM / effRow.length / 1000 : nomKm;
    const limitedPct = effRow.length > 0 ? Math.round((limitedCount / effRow.length) * 100) : 0;

    return {
      altitudeM: altM,
      nominalRangeKm: Number(nomKm.toFixed(1)),
      innerConeRadiusKm: Number(innerKm.toFixed(1)),
      averageEffectiveRangeKm: Number(avgEffKm.toFixed(1)),
      terrainLimitedPercent: limitedPct,
    };
  });

  const coverageRatioPercent = totalSamples > 0
    ? Math.max(0, Math.min(100, Math.round(((totalSamples - terrainLimitedCount) / totalSamples) * 100)))
    : 100;

  const result: RadarCoverageVolume = {
    radarId: instance.instanceId,
    radarName: instance.name,
    calculatedAt: Date.now(),
    cacheKey,
    radarLat,
    radarLon,
    radarAltM: Math.round(radarCenterAltM),
    antennaHeightAGL,
    minElevationDeg: instance.minElevationDeg,
    maxElevationDeg,
    maxRangeKm,
    coverageHeightKm: instance.coverageHeightKm || 25,
    altitudeBands,
    azimuthSamples,
    nominalRanges,
    effectiveRanges,
    innerConeRadii,
    visibilityStates,
    bandInfos,
    terrainGrid,
    terrainStatus,
    calculationState: terrainStatus === 'sampling_error' ? 'ERROR' : 'READY',
    totalSamples,
    terrainLimitedCount,
    coverageRatioPercent,
  };

  // A failed or unavailable DEM must be retried, never reused as measured terrain.
  if (terrainStatus === 'loaded') volumeCache.set(cacheKey, result);
  return result;
}

/** Xóa cache một radar khi tọa độ hoặc thông số khí tài thay đổi */
export function invalidateVolumeCache(instanceId?: string) {
  if (!instanceId) {
    volumeCache.clear();
    return;
  }
  for (const key of volumeCache.keys()) {
    if (key.includes(`_${instanceId}_`)) {
      volumeCache.delete(key);
    }
  }
}

export interface TerrainGridSamplingResult {
  terrainMap: Map<string, number>;
  maxMaskInfoByAzDist: Map<string, { maxTan: number; peakDist: number; peakAlt: number }>;
  sampleDistances: number[];
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';
  terrainGrid?: RadarTerrainGrid;
}

/**
 * LẤY MẪU ĐỘ CAO ĐỊA HÌNH DEM VÀ TÍNH TOÁN GÓC CHE KHUẤT TÍCH LŨY (REUSABLE)
 * Dùng chung cho cả Radar Cảnh Giới và Tên Lửa Phòng Không (SAM)
 */
export async function sampleTerrainGridAndMasks(
  centerLat: number,
  centerLon: number,
  centerAltM: number,
  maxRangeM: number,
  azimuthSamples: number[],
  radialStepMeters: number,
  terrainProvider: Cesium.TerrainProvider | null,
  kFactor: number = DEFAULT_K_FACTOR,
  requiredDistances: number[] = []
): Promise<TerrainGridSamplingResult> {
  const sampleDistances: number[] = [];
  // A 300 km radar used to skip 6.7 km between samples, missing whole ridges.
  // Resolve nearby slopes at 250 m and keep distant gaps at most 1 km.
  const nearStep = Math.min(250, Math.max(100, radialStepMeters));
  const nearEnd = Math.min(30000, maxRangeM);
  for (let d = nearStep; d <= nearEnd; d += nearStep) sampleDistances.push(d);

  const farStep = Math.min(1000, Math.max(100, radialStepMeters));
  const startFar = sampleDistances.length > 0 ? sampleDistances[sampleDistances.length - 1] + farStep : farStep;
  for (let d = startFar; d <= maxRangeM; d += farStep) {
    sampleDistances.push(d);
  }
  if (sampleDistances.length === 0 || sampleDistances[sampleDistances.length - 1] < maxRangeM) {
    sampleDistances.push(maxRangeM);
  }
  for (const dist of requiredDistances) {
    if (Number.isFinite(dist) && dist > 0 && dist <= maxRangeM) sampleDistances.push(dist);
  }
  const sortedDistances = [...new Set(sampleDistances)].sort((a, b) => a - b);
  sampleDistances.splice(0, sampleDistances.length, ...sortedDistances);

  interface SampleMeta {
    az: number;
    dist: number;
    lat: number;
    lon: number;
  }

  const sampleMetas: SampleMeta[] = [];
  const cartographics: Cesium.Cartographic[] = [];

  azimuthSamples.forEach((az) => {
    sampleDistances.forEach((dist) => {
      const dest = destinationPoint(centerLat, centerLon, dist, az);
      sampleMetas.push({ az, dist, lat: dest.lat, lon: dest.lon });
      cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    });
  });

  let sampledHeights: number[] = new Array(cartographics.length).fill(0);
  let terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error' = 'flat_fallback';

  if (terrainProvider && !(terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
    try {
      // A long-range radar still needs the same nearby mountain detail as a
      // short-range one. Keep far terrain coarse to bound tile/CPU demand.
      const indicesByLevel = new Map<number, number[]>();
      for (let index = 0; index < sampleMetas.length; index++) {
        const distanceM = sampleMetas[index].dist;
        const level = distanceM <= 30000 ? 13 : distanceM <= 80000 ? 11 : distanceM <= 160000 ? 10 : 9;
        const indices = indicesByLevel.get(level) ?? [];
        indices.push(index);
        indicesByLevel.set(level, indices);
      }
      for (const [level, indices] of indicesByLevel) {
        const heights = await sampleTerrainOptimized(
          terrainProvider,
          centerLon,
          centerLat,
          indices.map((index) => cartographics[index]),
          level,
          1500
        );
        indices.forEach((index, offset) => { sampledHeights[index] = heights[offset]; });
      }
      terrainStatus = 'loaded';
    } catch {
      sampledHeights = cartographics.map(() => 0);
      terrainStatus = 'sampling_error';
    }
  }

  const terrainMap = new Map<string, number>();
  for (let i = 0; i < sampleMetas.length; i++) {
    const meta = sampleMetas[i];
    terrainMap.set(`${meta.az}_${meta.dist}`, sampledHeights[i] || 0);
  }

  const maxMaskInfoByAzDist = new Map<string, { maxTan: number; peakDist: number; peakAlt: number }>();
  const terrainGrid: RadarTerrainGrid | undefined = terrainStatus === 'loaded'
    ? {
      azimuthSamples: [...azimuthSamples],
      sampleDistances: [...sampleDistances],
      terrainHeights: new Float32Array(sampledHeights),
      minimumVisibleHeights: new Float32Array(sampledHeights.length),
    }
    : undefined;

  azimuthSamples.forEach((az, azIndex) => {
    let currentMaxTan = -Number.MAX_VALUE;
    let peakDist = 0;
    let peakAlt = 0;

    sampleDistances.forEach((dist, distanceIndex) => {
      const groundAlt = terrainMap.get(`${az}_${dist}`) || 0;
      const deltaHCurvature = calculateEarthBulgeMeters(dist, kFactor);
      const tanObstacle = (groundAlt - centerAltM - deltaHCurvature) / dist;

      if (tanObstacle > currentMaxTan) {
        currentMaxTan = tanObstacle;
        peakDist = dist;
        peakAlt = groundAlt;
      }
      maxMaskInfoByAzDist.set(`${az}_${dist}`, { maxTan: currentMaxTan, peakDist, peakAlt });
      if (terrainGrid) {
        const index = azIndex * sampleDistances.length + distanceIndex;
        terrainGrid.minimumVisibleHeights[index] = Math.max(
          groundAlt,
          centerAltM + dist * currentMaxTan + deltaHCurvature
        );
      }
    });
  });

  return {
    terrainMap,
    maxMaskInfoByAzDist,
    sampleDistances,
    terrainStatus,
    terrainGrid,
  };
}

/**
 * Trích xuất lát cắt địa hình chuẩn hóa cho một góc phương vị từ kết quả lấy mẫu lưới 3D có sẵn
 * Dùng làm Single Source of Truth cho 2D Cross Section Panel
 */
export function extractSliceFromTerrainGrid(
  instanceId: string,
  azimuthDeg: number,
  centerLat: number,
  centerLon: number,
  groundAltM: number,
  antennaHeightAGL: number,
  maxRangeM: number,
  terrainMap: Map<string, number> | undefined,
  sampleDistances: number[],
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error' = 'loaded',
  kFactor: number = DEFAULT_K_FACTOR
): SharedTerrainSlice {
  const samples = sampleDistances.map((distM) => {
    const dest = destinationPoint(centerLat, centerLon, distM, azimuthDeg);
    const altM = terrainMap ? (terrainMap.get(`${azimuthDeg}_${distM}`) ?? 0) : 0;
    return {
      distM,
      lat: dest.lat,
      lon: dest.lon,
      terrainAltM: altM,
    };
  });

  return {
    instanceId,
    azimuthDeg,
    centerLat,
    centerLon,
    groundAltM,
    antennaHeightAGL,
    maxRangeM,
    kFactor,
    samples,
    terrainStatus,
    timestamp: Date.now(),
    cacheKey: `${instanceId}_${azimuthDeg}_${centerLat}_${centerLon}_${terrainStatus}`,
  };
}

