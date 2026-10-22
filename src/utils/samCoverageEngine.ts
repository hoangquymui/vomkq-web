import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type { SamCoverageConfig, SamCoverageResult } from '../types/samCoverage';
import type { RadarCoverageVolume } from '../types/radarVolume';
import type { SpxCoverageResult } from '../types/spxRadarCoverage';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';
import { sampleTerrainOptimized } from './terrainSampler';
import { EARTH_RADIUS_METERS, DEFAULT_K_FACTOR } from './radarMath';

/**
 * Tính toạ độ đích (lat, lon) từ điểm gốc, khoảng cách (m) và góc phương vị (độ)
 */
export function destinationPoint(
  latDeg: number,
  lonDeg: number,
  distanceMeters: number,
  bearingDeg: number
): { lat: number; lon: number } {
  if (
    typeof latDeg !== 'number' || typeof lonDeg !== 'number' ||
    isNaN(latDeg) || isNaN(lonDeg) || !isFinite(latDeg) || !isFinite(lonDeg)
  ) {
    return { lat: 16.043, lon: 108.12081 };
  }

  const safeDist = typeof distanceMeters === 'number' && !isNaN(distanceMeters) && isFinite(distanceMeters)
    ? distanceMeters
    : 0;
  if (safeDist <= 0) return { lat: latDeg, lon: lonDeg };

  const delta = safeDist / EARTH_RADIUS_METERS;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (latDeg * Math.PI) / 180;
  const lambda1 = (lonDeg * Math.PI) / 180;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));

  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  const resLat = (phi2 * 180) / Math.PI;
  const resLon = (((lambda2 * 180) / Math.PI + 540) % 360) - 180;

  return {
    lat: isNaN(resLat) || !isFinite(resLat) ? latDeg : resLat,
    lon: isNaN(resLon) || !isFinite(resLon) ? lonDeg : resLon,
  };
}

/**
 * Tính khoảng cách trắc địa Geodesic WGS84 giữa 2 điểm (m)
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Tính góc phương vị (bearing) từ điểm 1 tới điểm 2 (độ, 0 -> 360)
 */
export function calculateBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);

  return (((theta * 180) / Math.PI) + 360) % 360;
}

/**
 * Kiểm tra xem một điểm toạ độ mục tiêu P(lat, lon) có nằm trong vùng nhìn thấy của Đài Radar hay không
 * (Kiểm tra cả cự ly tối đa và vật cản địa hình che khuất theo dữ liệu volume hoặc SPx)
 */
export function isPointVisibleToRadar(
  pointLat: number,
  pointLon: number,
  radar: EquipmentInstance,
  options?: {
    radarVolume?: RadarCoverageVolume | null;
    spxResult?: SpxCoverageResult | null;
    targetAltitudeM?: number;
  }
): boolean {
  const radarLat = radar.latitude;
  const radarLon = radar.longitude;
  const radarMaxRangeM = (radar.rangeKm || 300) * 1000;

  const distM = calculateDistanceMeters(radarLat, radarLon, pointLat, pointLon);
  if (distM > radarMaxRangeM) {
    return false; // Vượt quá tầm phát hiện xa nhất của đài radar
  }

  const bearingDeg = calculateBearingDeg(radarLat, radarLon, pointLat, pointLon);

  // 1. Kiểm tra theo Radar Coverage Volume (dữ liệu ma trận góc/cự ly/độ cao 3D Single Source of Truth)
  if (
    options?.radarVolume &&
    options.radarVolume.effectiveRanges &&
    options.radarVolume.effectiveRanges.length > 0 &&
    options.radarVolume.azimuthSamples &&
    options.radarVolume.azimuthSamples.length > 0
  ) {
    const vol = options.radarVolume;
    const azCount = vol.azimuthSamples.length;
    const azStep = 360 / azCount;
    const azIdx = Math.round(bearingDeg / azStep) % azCount;

    const targetAlt = options?.targetAltitudeM || 1000;
    let closestBand = 0;
    let minDiff = Math.abs(vol.altitudeBands[0] - targetAlt);
    for (let b = 1; b < vol.altitudeBands.length; b++) {
      const diff = Math.abs(vol.altitudeBands[b] - targetAlt);
      if (diff < minDiff) {
        minDiff = diff;
        closestBand = b;
      }
    }

    const effRange = vol.effectiveRanges[closestBand]?.[azIdx] ?? radarMaxRangeM;
    return distM <= effRange;
  }

  // 2. Kiểm tra theo SPx Coverage Result (chuẩn Cambridge Pixel đa giác mặt đất)
  if (options?.spxResult && options.spxResult.contours && options.spxResult.contours.length > 0) {
    const contour = options.spxResult.contours[options.spxResult.contours.length - 1] || options.spxResult.contours[0];
    const pts = contour.polygonPositions;
    if (pts && pts.length >= 3) {
      const idx = Math.min(pts.length - 1, Math.max(0, Math.round((bearingDeg / 360) * pts.length) % pts.length));
      const boundPt = pts[idx];
      if (boundPt) {
        const maxDist = calculateDistanceMeters(radarLat, radarLon, boundPt.lat, boundPt.lon);
        return distM <= maxDist;
      }
    }
  }

  // Fallback nếu chưa nạp DEM của radar
  return distM <= radarMaxRangeM;
}

/**
 * Bộ nhớ đệm lưu kết quả tính toán vùng hỏa lực tên lửa SAM
 */
export const samCoverageCache = new Map<string, SamCoverageResult>();

/**
 * Sinh khóa cache duy nhất cho tổ hợp tên lửa
 */
export function generateSamCoverageCacheKey(
  instance: EquipmentInstance,
  config: SamCoverageConfig,
  linkedRadar?: EquipmentInstance | null
): string {
  const comp = instance.compositeBattery;
  const mastKey = comp?.mastHeightOverrideM !== undefined ? `_m${comp.mastHeightOverrideM}` : '';
  const sectorKey = comp?.combatMode === 'sector'
    ? `_sec_${comp.combatAzimuthDeg || 0}_${instance.batteryConfig?.fcrSectorAngleDeg || 60}`
    : '_omni';
  const tarKey = linkedRadar
    ? `${linkedRadar.instanceId}_${linkedRadar.latitude.toFixed(5)}_${linkedRadar.longitude.toFixed(5)}_${linkedRadar.rangeKm}`
    : instance.batteryConfig
      ? `int_tar_${instance.batteryConfig.tarRadarId}_${instance.batteryConfig.tarRangeKm}`
      : 'no_radar';

  return [
    'sam_cov',
    instance.instanceId,
    instance.latitude.toFixed(5),
    instance.longitude.toFixed(5),
    (instance.altitude || 0).toFixed(0),
    config.dMaxM.toFixed(0),
    config.dMinM.toFixed(0),
    config.targetAltitudeM.toFixed(0),
    config.maskMode,
    config.designatedRadarId || 'none',
    tarKey,
    config.kFactor.toFixed(3),
    mastKey,
    sectorKey,
  ].join('__');
}

/**
 * ĐỘNG CƠ TÍNH TOÁN VÙNG HỎA LỰC TÊN LỬA PHÒNG KHÔNG (SAM COVERAGE ENGINE)
 * Triển khai đầy đủ 2 điều kiện cốt lõi:
 * - Điều kiện 1: Cắt địa hình tự thân (SAM Organic Terrain Masking theo DEM)
 * - Điều kiện 2: Gộp dữ liệu vùng che khuất của đài Radar chỉ thị (Radar Slaved Intersection)
 */
export async function computeSamCoverage(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  options?: {
    config?: Partial<SamCoverageConfig>;
    linkedRadar?: EquipmentInstance | null;
    linkedRadarVolume?: RadarCoverageVolume | null;
    linkedRadarSpx?: SpxCoverageResult | null;
  }
): Promise<SamCoverageResult> {
  const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const isSpyder = instance.templateId === 'sam_spyder' || !!instance.spyderConfig;
  const spyderCfg = instance.spyderConfig || tmpl?.spyderConfig;

  // Lấy các tham số khí tài
  const dMaxKm = isSpyder && spyderCfg
    ? spyderCfg.mr.dMaxKm
    : (instance.rangeKm || tmpl?.defaultRangeKm || 35.4);
  const dMinKm = isSpyder && spyderCfg
    ? spyderCfg.mr.dMinKm
    : (instance.minEngagementRangeKm || tmpl?.minEngagementRangeKm || 3.5);
  const hMaxM = isSpyder && spyderCfg
    ? spyderCfg.mr.hMaxM
    : (instance.maxEngagementAltitudeM || tmpl?.maxEngagementAltitudeM || 25000);
  const hMinM = isSpyder && spyderCfg
    ? spyderCfg.mr.hMinM
    : (instance.minEngagementAltitudeM || tmpl?.minEngagementAltitudeM || 20);

  const targetAltitudeM = options?.config?.targetAltitudeM ?? (instance.targetAltitudeM || 500);
  const maskMode = options?.config?.maskMode || instance.samTerrainMaskMode || (instance.designatedRadarId ? 'intersection' : 'organic');

  const fullConfig: SamCoverageConfig = {
    launcherHeightAGL: instance.compositeBattery?.mastHeightOverrideM ?? instance.antennaHeightAGL ?? 6,
    dMaxM: dMaxKm * 1000,
    dMinM: dMinKm * 1000,
    hMaxM,
    hMinM,
    targetAltitudeM,
    minElevationDeg: instance.minElevationDeg !== undefined ? instance.minElevationDeg : 0.5,
    maxElevationDeg: instance.maxElevationDeg !== undefined ? instance.maxElevationDeg : 65.0,
    kFactor: options?.config?.kFactor || DEFAULT_K_FACTOR,
    earthCurvature: options?.config?.earthCurvature ?? true,
    maskMode,
    designatedRadarId: instance.designatedRadarId,
    ...(options?.config || {}),
  };

  const effectiveLinkedRadar = options?.linkedRadar || (instance.batteryConfig ? {
    ...instance,
    instanceId: `${instance.instanceId}_tar`,
    name: instance.batteryConfig.tarRadarName,
    rangeKm: instance.batteryConfig.tarRangeKm,
    coverageHeightKm: instance.batteryConfig.tarHeightKm,
    antennaHeightAGL: (instance.compositeBattery?.mastHeightOverrideM ?? instance.batteryConfig.tarAglM) || 15,
  } as EquipmentInstance : null);

  const cacheKey = generateSamCoverageCacheKey(instance, fullConfig, effectiveLinkedRadar);
  const cached = samCoverageCache.get(cacheKey);
  if (cached) return cached;

  const centerLat = instance.latitude;
  const centerLon = instance.longitude;
  const centerGroundAltM = instance.altitude || 0;
  const totalLauncherElevationM = centerGroundAltM + fullConfig.launcherHeightAGL;

  // Bán kính cong Trái Đất hiệu dụng
  const effectiveEarthRadiusM = fullConfig.earthCurvature
    ? fullConfig.kFactor * EARTH_RADIUS_METERS
    : Infinity;

  // 360 hướng phương vị (bước 1.0°) tạo biên dạng răng cưa chuẩn quân sự
  const azimuths: number[] = [];
  for (let az = 0; az < 360; az += 1.0) {
    azimuths.push(az);
  }

  // Bước cự ly lấy mẫu dọc tia (tối ưu hiệu năng ~60 bước cho 35km)
  const distStepM = Math.max(300, Math.round(fullConfig.dMaxM / 60));
  const sampleDistances: number[] = [];
  for (let d = Math.max(distStepM, fullConfig.dMinM); d <= fullConfig.dMaxM; d += distStepM) {
    sampleDistances.push(d);
  }
  if (sampleDistances[sampleDistances.length - 1] !== fullConfig.dMaxM) {
    sampleDistances.push(fullConfig.dMaxM);
  }

  // 1. Lấy mẫu DEM độ cao địa hình quanh bệ phóng SAM
  const samCarto = Cesium.Cartographic.fromDegrees(centerLon, centerLat);
  const gridCartos: Cesium.Cartographic[] = [samCarto];

  for (const az of azimuths) {
    for (const dist of sampleDistances) {
      const dest = destinationPoint(centerLat, centerLon, dist, az);
      gridCartos.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    }
  }

  let sampledHeights: number[] = [];
  let terrainStatus: 'dem_loaded' | 'flat_fallback' | 'error' = 'dem_loaded';

  if (terrainProvider) {
    try {
      sampledHeights = await sampleTerrainOptimized(
        terrainProvider,
        centerLon,
        centerLat,
        gridCartos,
        10,
        1500
      );
    } catch {
      sampledHeights = new Array(gridCartos.length).fill(0);
      terrainStatus = 'flat_fallback';
    }
  } else {
    sampledHeights = new Array(gridCartos.length).fill(0);
    terrainStatus = 'flat_fallback';
  }

  const measuredGroundElevationM = sampledHeights[0] || centerGroundAltM;

  // 2. Phân tích từng hướng phương vị theo 2 Điều kiện
  const tanMinElev = Math.tan((fullConfig.minElevationDeg * Math.PI) / 180);
  const azimuthRanges = new Array<number>(azimuths.length).fill(fullConfig.dMinM);
  const polygonPositions: Array<{ lat: number; lon: number; alt: number }> = [];
  const innerConePositions: Array<{ lat: number; lon: number }> = [];

  let ptr = 1;
  const shouldCheckRadar =
    (fullConfig.maskMode === 'linked_radar' || fullConfig.maskMode === 'intersection') &&
    !!effectiveLinkedRadar;

  for (let a = 0; a < azimuths.length; a++) {
    const az = azimuths[a];
    let maxVisibleDistM = fullConfig.dMinM;
    let currentMaxMaskTan = tanMinElev;

    for (let s = 0; s < sampleDistances.length; s++) {
      const dist = sampleDistances[s];
      const terrainH = sampledHeights[ptr++];

      // Độ sụt do độ cong Trái Đất
      const earthBulgeDropM = fullConfig.earthCurvature && isFinite(effectiveEarthRadiusM)
        ? (dist * dist) / (2 * effectiveEarthRadiusM)
        : 0;

      // Góc tà đỉnh địa hình nhìn từ bệ phóng
      const tanTerrainAngle =
        (terrainH - totalLauncherElevationM - earthBulgeDropM) / dist;

      if (tanTerrainAngle > currentMaxMaskTan) {
        currentMaxMaskTan = tanTerrainAngle;
      }

      // ĐIỀU KIỆN 1: Kiểm tra Line-of-Sight từ Bệ phóng SAM tới Mục tiêu
      // Mục tiêu phải cao hơn mặt đất cục bộ
      if (fullConfig.targetAltitudeM < terrainH) {
        break; // Đâm vào núi
      }

      const tanTargetAngle =
        (fullConfig.targetAltitudeM - totalLauncherElevationM - earthBulgeDropM) / dist;

      const isSamVisible = tanTargetAngle >= currentMaxMaskTan;
      if (!isSamVisible && fullConfig.maskMode !== 'linked_radar') {
        // Bị đỉnh núi phía trước che khuất đường ngắm của bệ phóng
        break;
      }

      // ĐIỀU KIỆN 2: Kiểm tra xem điểm này có nằm trong vùng nhìn thấy của Đài Radar hay không
      if (shouldCheckRadar && effectiveLinkedRadar) {
        const candidatePt = destinationPoint(centerLat, centerLon, dist, az);
        const isRadarSeeing = isPointVisibleToRadar(candidatePt.lat, candidatePt.lon, effectiveLinkedRadar, {
          radarVolume: options?.linkedRadarVolume,
          spxResult: options?.linkedRadarSpx,
          targetAltitudeM: fullConfig.targetAltitudeM,
        });

        if (!isRadarSeeing) {
          // Điểm này rơi vào vùng mù (che khuất) của đài radar -> Tên lửa không thể bắn vào vùng này!
          break;
        }
      }

      maxVisibleDistM = dist;
    }

    azimuthRanges[a] = maxVisibleDistM;
  }

  // Khống chế bất biến R_wez <= R_radar từ ma trận RadarCoverageVolume (loại bỏ triệt để mọi tia gai nhọn)
  if (
    options?.linkedRadarVolume &&
    options.linkedRadarVolume.effectiveRanges &&
    options.linkedRadarVolume.effectiveRanges.length > 0
  ) {
    const vol = options.linkedRadarVolume;
    const targetAlt = fullConfig.targetAltitudeM;
    let closestBand = 0;
    let minDiff = Infinity;
    for (let b = 0; b < vol.altitudeBands.length; b++) {
      const diff = Math.abs(vol.altitudeBands[b] - targetAlt);
      if (diff < minDiff) {
        minDiff = diff;
        closestBand = b;
      }
    }
    const azCount = vol.azimuthSamples.length;
    const azStep = 360 / azCount;

    for (let a = 0; a < azimuths.length; a++) {
      const az = azimuths[a];
      const azIdx = Math.round(az / azStep) % azCount;
      const radarMaxM = vol.effectiveRanges[closestBand]?.[azIdx] ?? fullConfig.dMaxM;
      azimuthRanges[a] = Math.min(azimuthRanges[a], radarMaxM);
      if (radarMaxM <= fullConfig.dMinM) {
        azimuthRanges[a] = fullConfig.dMinM;
      }
    }
  }

  // Luôn hiển thị Vùng Hỏa Lực dạng Toàn Phương 360° (Omnidirectional)
  for (let a = 0; a < azimuths.length; a++) {
    const az = azimuths[a];
    const edgePt = destinationPoint(centerLat, centerLon, azimuthRanges[a], az);
    polygonPositions.push({
      lat: edgePt.lat,
      lon: edgePt.lon,
      alt: fullConfig.targetAltitudeM,
    });
  }
  if (polygonPositions.length > 0) {
    polygonPositions.push({ ...polygonPositions[0] });
  }

  if (fullConfig.dMinM > 0) {
    for (const az of azimuths) {
      innerConePositions.push(destinationPoint(centerLat, centerLon, fullConfig.dMinM, az));
    }
    if (innerConePositions.length > 0) {
      innerConePositions.push({ ...innerConePositions[0] });
    }
  }

  // Tính diện tích đa giác xấp xỉ bằng tổng diện tích các hình quạt tam giác (km²)
  let effectiveAreaM2 = 0;
  const dThetaRad = (1.0 * Math.PI) / 180;
  for (let a = 0; a < azimuthRanges.length; a++) {
    const r = azimuthRanges[a];
    const rMin = fullConfig.dMinM;
    if (r > rMin) {
      effectiveAreaM2 += 0.5 * (r * r - rMin * rMin) * dThetaRad;
    }
  }
  const effectiveAreaKm2 = Number((effectiveAreaM2 / 1_000_000).toFixed(1));
  const nominalAreaKm2 = Number(
    ((Math.PI * (fullConfig.dMaxM * fullConfig.dMaxM - fullConfig.dMinM * fullConfig.dMinM)) / 1_000_000).toFixed(1)
  );
  const coverageRatioPercent = nominalAreaKm2 > 0
    ? Number(Math.min(100, Math.max(0, (effectiveAreaKm2 / nominalAreaKm2) * 100)).toFixed(1))
    : 100;

  const result: SamCoverageResult = {
    instanceId: instance.instanceId,
    cacheKey,
    centerLat,
    centerLon,
    groundElevationM: measuredGroundElevationM,
    dMaxKm,
    dMinKm,
    maxEngagementAltitudeM: hMaxM,
    polygonPositions,
    innerConePositions,
    azimuthRanges,
    linkedRadarId: effectiveLinkedRadar?.instanceId || null,
    linkedRadarName: effectiveLinkedRadar?.name,
    maskMode: fullConfig.maskMode,
    coverageRatioPercent,
    effectiveAreaKm2,
    nominalAreaKm2,
    terrainStatus,
    timestamp: Date.now(),
  };

  samCoverageCache.set(cacheKey, result);
  return result;
}
