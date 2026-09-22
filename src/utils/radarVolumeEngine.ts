import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type {
  RadarCoverageVolume,
  VolumeCalculationParams,
  VolumeVisibilityState,
  AltitudeBandInfo,
} from '../types/radarVolume';
import {
  calculateConeOfSilenceRadiusKm,
  calculateEarthBulgeMeters,
  calculateRadarHorizonDistanceKm,
  DEFAULT_K_FACTOR,
  getProfileMaxRange,
} from './radarMath';
import { destinationPoint } from './radarLosEngine';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';

/** Cache lưu các Volume đã tính để tránh tính lại khi xoay/zoom bản đồ */
const volumeCache = new Map<string, RadarCoverageVolume>();

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

  // 2. Thêm các tầng tác chiến tiêu chuẩn phòng không
  const standardAltitudes = [
    100, 300, 500, 1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000,
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
  params: VolumeCalculationParams
): string {
  const azStep = params.azimuthStepDeg || 5;
  const radStep = params.radialStepMeters || 2000;
  const k = (params.kFactor || DEFAULT_K_FACTOR).toFixed(3);
  const altKey = params.customAltitudeBands?.join(',') || 'auto';
  const profileKey = instance.coverageProfile?.points.map((p) => `${p.elevationDeg}:${p.maxRangeKm}`).join('-') || 'def';

  return `vol_${instance.instanceId}_${instance.latitude.toFixed(4)}_${instance.longitude.toFixed(4)}_${instance.altitude}_${instance.antennaHeightAGL}_${instance.rangeKm}_${instance.coverageHeightKm}_${azStep}_${radStep}_${k}_${altKey}_${profileKey}`;
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
  const cacheKey = generateVolumeCacheKey(instance, params);
  const cached = volumeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const {
    azimuthStepDeg = 5,
    radialStepMeters = 2000,
    kFactor = DEFAULT_K_FACTOR,
    customAltitudeBands,
  } = params;

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
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    azimuthSamples.push(az);
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

  // 5. Chuẩn bị lưới lấy mẫu địa hình DEM từ Cesium
  const sampleDistances: number[] = [];
  const minDist = Math.max(500, radialStepMeters);
  for (let d = minDist; d <= maxRangeM; d += radialStepMeters) {
    sampleDistances.push(d);
  }
  if (sampleDistances.length === 0 || sampleDistances[sampleDistances.length - 1] < maxRangeM) {
    sampleDistances.push(maxRangeM);
  }

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
      const dest = destinationPoint(radarLat, radarLon, dist, az);
      sampleMetas.push({ az, dist, lat: dest.lat, lon: dest.lon });
      cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    });
  });

  let sampledHeights: number[] = new Array(cartographics.length).fill(0);
  let terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error' = 'flat_fallback';

  if (terrainProvider) {
    try {
      const targetLevel = maxRangeKm <= 60 ? 11 : maxRangeKm <= 160 ? 10 : 9;
      const batchSize = 350;
      for (let i = 0; i < cartographics.length; i += batchSize) {
        const chunk = cartographics.slice(i, i + batchSize);
        try {
          await Cesium.sampleTerrain(terrainProvider, targetLevel, chunk, false);
        } catch {
          try {
            await Cesium.sampleTerrain(terrainProvider, Math.max(8, targetLevel - 1), chunk, false);
          } catch {
            // bỏ qua lỗi cục bộ
          }
        }
        for (let j = 0; j < chunk.length; j++) {
          const h = chunk[j].height;
          sampledHeights[i + j] = h !== undefined && !isNaN(h) && isFinite(h) ? Math.max(0, h) : 0;
        }
        if (i + batchSize < cartographics.length) {
          await new Promise((resolve) => setTimeout(resolve, 6));
        }
      }
      terrainStatus = 'loaded';
    } catch {
      sampledHeights = cartographics.map(() => 0);
      terrainStatus = 'sampling_error';
    }
  }

  // Tra cứu nhanh độ cao mặt đất: terrainMap.get(`${az}_${dist}`)
  const terrainMap = new Map<string, number>();
  for (let i = 0; i < sampleMetas.length; i++) {
    const meta = sampleMetas[i];
    terrainMap.set(`${meta.az}_${meta.dist}`, sampledHeights[i] || 0);
  }

  // 6. Phân tích góc chắn địa hình tích lũy theo từng phương vị
  // Tại phương vị az, theo dõi tan(theta_mask)(d) = max_{s <= d} [ (h_terr(s) - h_antenna - delta_h(s)) / s ]
  const maxMaskTanByAzDist = new Map<string, number>();

  azimuthSamples.forEach((az) => {
    let currentMaxTan = -Number.MAX_VALUE;

    sampleDistances.forEach((dist) => {
      const groundAlt = terrainMap.get(`${az}_${dist}`) || 0;
      const deltaHCurvature = calculateEarthBulgeMeters(dist, kFactor);
      // Góc nhìn từ anten tới bề mặt địa hình tại khoảng cách dist
      const tanObstacle = (groundAlt - radarCenterAltM + deltaHCurvature) / dist;

      if (tanObstacle > currentMaxTan) {
        currentMaxTan = tanObstacle;
      }
      maxMaskTanByAzDist.set(`${az}_${dist}`, currentMaxTan);
    });
  });

  // 7. Xây dựng ma trận nominalRanges, effectiveRanges, visibilityStates
  // Kích thước: [altitudeBands.length][azimuthSamples.length]
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

      // Nếu cự ly danh nghĩa nhỏ hơn hoặc bằng nón mù đỉnh đầu -> ngoài búp sóng
      if (nomRangeM <= innerConeM) {
        effectiveRow.push(innerConeM);
        visibilityRow.push('OUTSIDE_ENVELOPE');
        continue;
      }

      // Tìm cự ly xa nhất dọc theo phương vị az mà mục tiêu ở độ cao altM không bị che khuất
      let effectiveDistM = nomRangeM;
      let isBlocked = false;

      // Duyệt qua các mốc cự ly lấy mẫu
      for (const dist of sampleDistances) {
        if (dist > nomRangeM) break;
        if (dist <= innerConeM) continue;

        // Góc nhìn tới mục tiêu ở độ cao altM tại khoảng cách dist:
        const deltaH = calculateEarthBulgeMeters(dist, kFactor);
        const tanTarget = (altM - radarCenterAltM - deltaH) / dist;
        const maxMaskTan = maxMaskTanByAzDist.get(`${az}_${dist}`) ?? -Number.MAX_VALUE;

        // Nếu góc nhìn tới mục tiêu nhỏ hơn góc chắn của núi ở phía trước -> bị khuất sau núi!
        if (tanTarget < maxMaskTan) {
          // Bị chắn tại mốc cự ly này
          effectiveDistM = Math.max(innerConeM, dist - radialStepMeters * 0.5);
          isBlocked = true;
          break;
        }
      }

      if (isBlocked) {
        terrainLimitedCount++;
        effectiveRow.push(Math.round(effectiveDistM));
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
    terrainStatus,
    calculationState: 'READY',
    totalSamples,
    terrainLimitedCount,
    coverageRatioPercent,
  };

  volumeCache.set(cacheKey, result);
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
