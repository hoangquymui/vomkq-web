import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type {
  RadarCalculationParams,
  RadarCoverageResult,
  RayProfile,
  RaySamplePoint,
} from '../types/radarCoverage';
import {
  calculateConeOfSilenceRadiusKm,
  calculateEarthBulgeMeters,
  calculateObstacleMaskingAngleRad,
  calculateRadarHorizonDistanceKm,
  DEFAULT_K_FACTOR,
  EARTH_RADIUS_METERS,
} from './radarMath';

/**
 * Tính toạ độ đích (lat, lon) từ điểm gốc, khoảng cách (m) và góc phương vị (độ)
 */
export function destinationPoint(
  latDeg: number,
  lonDeg: number,
  distanceMeters: number,
  bearingDeg: number
): { lat: number; lon: number } {
  const delta = distanceMeters / EARTH_RADIUS_METERS;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (latDeg * Math.PI) / 180;
  const lambda1 = (lonDeg * Math.PI) / 180;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: (phi2 * 180) / Math.PI,
    lon: (lambda2 * 180) / Math.PI,
  };
}

/**
 * Thuật toán Bắn tia Ray-Casting & Tính toán Vùng Che Khuất Radar (LOS)
 * Cắt lát qua địa hình thực tế 3D của Cesium
 */
export async function computeRadarCoverage(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  params: RadarCalculationParams
): Promise<RadarCoverageResult> {
  const {
    targetHeightMeters = 300,
    azimuthStepDeg = 4,
    radialStepMeters = 2500,
    kFactor = DEFAULT_K_FACTOR,
  } = params;

  const maxRangeM = instance.rangeKm * 1000;
  const radarLat = instance.latitude;
  const radarLon = instance.longitude;
  const radarGroundAlt = instance.altitude || 0;
  const antennaHeight = instance.antennaHeightAGL || 15;
  const radarCenterAltM = radarGroundAlt + antennaHeight;

  const minElevRad = (instance.minElevationDeg * Math.PI) / 180;
  const maxElevRad = (instance.maxElevationDeg * Math.PI) / 180;

  // 1. Tạo danh sách các điểm lấy mẫu không gian trên tất cả các tia
  const azimuths: number[] = [];
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    azimuths.push(az);
  }

  // Tạo số lượng bước cự ly r_i
  const sampleDistances: number[] = [];
  const minSampleDist = Math.max(1000, radialStepMeters);
  for (let d = minSampleDist; d <= maxRangeM; d += radialStepMeters) {
    sampleDistances.push(d);
  }
  if (sampleDistances[sampleDistances.length - 1] !== maxRangeM) {
    sampleDistances.push(maxRangeM);
  }

  // Tạo mảng Cartographic để lấy mẫu độ cao địa hình hàng loạt
  interface GridPoint {
    azIndex: number;
    distIndex: number;
    distanceM: number;
    lat: number;
    lon: number;
  }

  const allPoints: GridPoint[] = [];
  const cartographics: Cesium.Cartographic[] = [];

  azimuths.forEach((az, azIdx) => {
    sampleDistances.forEach((dist, distIdx) => {
      const dest = destinationPoint(radarLat, radarLon, dist, az);
      allPoints.push({
        azIndex: azIdx,
        distIndex: distIdx,
        distanceM: dist,
        lat: dest.lat,
        lon: dest.lon,
      });
      cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    });
  });

  // 2. Lấy mẫu độ cao địa hình từ Cesium TerrainProvider
  let sampledHeights: number[] = new Array(cartographics.length).fill(0);
  if (terrainProvider) {
    try {
      // Lấy mẫu địa hình chi tiết nhất (bất đồng bộ)
      const sampled = await Cesium.sampleTerrainMostDetailed(
        terrainProvider,
        cartographics
      );
      sampledHeights = sampled.map((c) => (c.height !== undefined ? Math.max(0, c.height) : 0));
    } catch {
      // Fallback nếu terrain offline chưa tải kịp tile
      sampledHeights = cartographics.map(() => 0);
    }
  }

  // 3. Phân tích quang tuyến Line-of-Sight (LOS) từng hướng phương vị
  const profiles: RayProfile[] = [];
  let blockedRaysCount = 0;

  let pointCursor = 0;

  azimuths.forEach((az) => {
    let maxMaskingAngle = minElevRad;
    let mainMaskingDistance = 0;
    const raySamples: RaySamplePoint[] = [];

    sampleDistances.forEach((dist) => {
      const terrainAlt = sampledHeights[pointCursor] || 0;
      const pointMeta = allPoints[pointCursor];
      pointCursor++;

      // Tính góc tà che khuất từ điểm đài radar đến đỉnh chướng ngại vật tại cự ly này
      const currentMaskingAngle = calculateObstacleMaskingAngleRad(
        radarCenterAltM,
        terrainAlt,
        dist,
        kFactor
      );

      if (currentMaskingAngle > maxMaskingAngle) {
        maxMaskingAngle = currentMaskingAngle;
        mainMaskingDistance = dist;
      }

      // Kiểm tra mục tiêu bay ở độ cao targetHeightMeters tại cự ly dist có bị che khuất không
      const hz = calculateEarthBulgeMeters(dist, kFactor);
      const targetElevAngle = Math.atan2(
        targetHeightMeters - radarCenterAltM + hz,
        dist
      );

      // Điểm bị che khuất nếu góc nâng mục tiêu nhỏ hơn góc chắn địa hình cao nhất phía trước
      // hoặc nằm ngoài giới hạn cánh sóng đài radar
      const isBlocked =
        targetElevAngle < maxMaskingAngle ||
        targetElevAngle < minElevRad ||
        targetElevAngle > maxElevRad;

      // Độ cao tia sóng phát xạ theo mép góc tà min hoặc góc che khuất
      const effElev = Math.max(minElevRad, maxMaskingAngle);
      const rayAlt = radarCenterAltM + dist * Math.tan(effElev) - hz;

      raySamples.push({
        distanceM: dist,
        lat: pointMeta.lat,
        lon: pointMeta.lon,
        terrainAltM: Math.round(terrainAlt),
        rayAltM: Math.round(rayAlt),
        isBlocked,
      });
    });

    if (maxMaskingAngle > minElevRad + 0.005) {
      // Có góc chắn núi đáng kể (> ~0.3°)
      blockedRaysCount++;
    }

    profiles.push({
      azimuthDeg: az,
      maskingAngleRad: maxMaskingAngle,
      maskingDistanceM: mainMaskingDistance,
      samples: raySamples,
      maxRangeM,
    });
  });

  // 4. Tính toán các chỉ số kỹ chiến thuật
  const coneRadiusKm = calculateConeOfSilenceRadiusKm(
    targetHeightMeters,
    instance.maxElevationDeg
  );

  const horizonKm = calculateRadarHorizonDistanceKm(
    antennaHeight,
    targetHeightMeters
  );

  const coverageRatio =
    azimuths.length > 0
      ? Math.round(((azimuths.length - blockedRaysCount) / azimuths.length) * 100)
      : 100;

  return {
    instanceId: instance.instanceId,
    radarName: instance.name,
    calculatedAt: Date.now(),
    radarLat,
    radarLon,
    radarAltM: Math.round(radarCenterAltM),
    antennaHeightAGL: antennaHeight,
    maxRangeKm: instance.rangeKm,
    targetHeightM: targetHeightMeters,
    coneOfSilenceRadiusKm: Number(coneRadiusKm.toFixed(2)),
    radarHorizonKm: Number(horizonKm.toFixed(1)),
    profiles,
    totalRays: azimuths.length,
    blockedRaysCount,
    coverageRatioPercent: coverageRatio,
  };
}
