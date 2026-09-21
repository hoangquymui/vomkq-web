import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type {
  RadarCalculationParams,
  RadarCoverageField,
  RadarCoverageResult,
  RayCoverageData,
  RayCoverageSample,
  RayProfile,
  RaySamplePoint,
} from '../types/radarCoverage';
import {
  calculateConeOfSilenceRadiusKm,
  calculateEarthBulgeMeters,
  calculateRadarHorizonDistanceKm,
  DEFAULT_K_FACTOR,
  EARTH_RADIUS_METERS,
  getProfileMaxRange,
} from './radarMath';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';

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
 * Tạo khóa cache cho Coverage Field dựa trên thông số khí tài & tham số khảo sát
 */
export function generateCoverageCacheKey(
  instance: EquipmentInstance,
  params: RadarCalculationParams
): string {
  const profile =
    instance.coverageProfile ||
    EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId)?.coverageProfile;
  const profileVer = profile?.points.map((p) => `${p.elevationDeg}:${p.maxRangeKm}`).join(',') || 'def';
  const azStep = params.azimuthStepDeg || 5;
  const elevStep = params.elevationStepDeg || 3;
  const radStep = params.radialStepMeters || 3000;
  const k = params.kFactor || DEFAULT_K_FACTOR;
  const targetH = params.targetHeightMeters || 300;
  const blind = params.showBlindZones ? 1 : 0;

  return `${instance.instanceId}_${instance.latitude.toFixed(4)}_${instance.longitude.toFixed(4)}_${instance.altitude}_${instance.antennaHeightAGL}_${profileVer}_${azStep}_${elevStep}_${radStep}_${k.toFixed(3)}_H${targetH}_B${blind}`;
}

/**
 * ĐỘNG CƠ TÍNH TOÁN COVERAGE FIELD 3D (SINGLE SOURCE OF TRUTH)
 * Quét không gian theo Azimuth × Elevation, kiểm tra cự ly theo Coverage Profile,
 * phân tích Line-of-Sight (LOS) cắt qua địa hình thực tế của Cesium.
 */
export async function computeRadarCoverageField(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  params: RadarCalculationParams
): Promise<RadarCoverageField> {
  const {
    azimuthStepDeg = 5,
    elevationStepDeg = 3,
    radialStepMeters = 3000,
    kFactor = DEFAULT_K_FACTOR,
    targetHeightMeters = 300,
  } = params;

  const radarLat = instance.latitude;
  const radarLon = instance.longitude;
  const radarGroundAlt = instance.altitude || 0;
  const antennaHeight = instance.antennaHeightAGL || 15;
  const radarCenterAltM = radarGroundAlt + antennaHeight;

  // Lấy Coverage Profile của khí tài
  const profile =
    instance.coverageProfile ||
    EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId)?.coverageProfile;

  const minElevDeg = profile ? profile.minElevationDeg : instance.minElevationDeg;
  const maxElevDeg = profile ? profile.maxElevationDeg : instance.maxElevationDeg;

  // 1. Tạo danh sách góc phương vị (Azimuth)
  const azimuths: number[] = [];
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    azimuths.push(az);
  }

  // 2. Tạo danh sách góc tà (Elevation)
  const elevations: number[] = [];
  for (let el = minElevDeg; el <= maxElevDeg; el += elevationStepDeg) {
    elevations.push(Number(el.toFixed(1)));
  }
  if (elevations.length === 0 || elevations[elevations.length - 1] < maxElevDeg) {
    elevations.push(maxElevDeg);
  }

  // 3. Tìm cự ly xa nhất trên toàn bộ profile để xác định tầm quét địa hình
  let globalMaxRangeKm = 0;
  elevations.forEach((el) => {
    const rKm = getProfileMaxRange(profile, el, instance.rangeKm);
    if (rKm > globalMaxRangeKm) globalMaxRangeKm = rKm;
  });
  if (globalMaxRangeKm <= 0) globalMaxRangeKm = instance.rangeKm || 100;
  const globalMaxRangeM = globalMaxRangeKm * 1000;

  // 4. Tạo các bước cự ly lấy mẫu địa hình dọc theo mặt đất
  const sampleDistances: number[] = [];
  const minSampleDist = Math.max(800, radialStepMeters);
  for (let d = minSampleDist; d <= globalMaxRangeM; d += radialStepMeters) {
    sampleDistances.push(d);
  }
  if (sampleDistances[sampleDistances.length - 1] !== globalMaxRangeM) {
    sampleDistances.push(globalMaxRangeM);
  }

  // 5. Chuẩn bị mảng Cartographic để lấy mẫu độ cao địa hình từ Cesium
  interface GroundPointMeta {
    az: number;
    dist: number;
    lat: number;
    lon: number;
  }

  const groundPoints: GroundPointMeta[] = [];
  const cartographics: Cesium.Cartographic[] = [];

  azimuths.forEach((az) => {
    sampleDistances.forEach((dist) => {
      const dest = destinationPoint(radarLat, radarLon, dist, az);
      groundPoints.push({
        az,
        dist,
        lat: dest.lat,
        lon: dest.lon,
      });
      cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    });
  });

  // 6. Lấy mẫu độ cao địa hình bất đồng bộ từ Cesium TerrainProvider theo lô an toàn
  let sampledHeights: number[] = new Array(cartographics.length).fill(0);
  let terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error' = 'flat_fallback';

  if (terrainProvider) {
    try {
      // Xác định cấp zoom địa hình phù hợp theo tầm hoạt động của radar
      // Tầm nhỏ (<= 60km): level 11 (~10km/tile, mesh dày)
      // Tầm trung (<= 160km): level 10 (~20km/tile)
      // Tầm xa (> 160km): level 9 (~40km/tile, tối ưu hóa triệt để lưu lượng mạng tránh lỗi net::ERR_INSUFFICIENT_RESOURCES)
      const targetLevel = globalMaxRangeKm <= 60 ? 11 : globalMaxRangeKm <= 160 ? 10 : 9;
      const batchSize = 350;
      for (let i = 0; i < cartographics.length; i += batchSize) {
        const chunk = cartographics.slice(i, i + batchSize);
        try {
          await Cesium.sampleTerrain(terrainProvider, targetLevel, chunk, false);
        } catch {
          try {
            await Cesium.sampleTerrain(terrainProvider, Math.max(8, targetLevel - 1), chunk, false);
          } catch {
            // Không ngắt luồng nếu thiếu một vài tile cục bộ
          }
        }
        for (let j = 0; j < chunk.length; j++) {
          const h = chunk[j].height;
          sampledHeights[i + j] = h !== undefined && !isNaN(h) && isFinite(h) ? Math.max(0, h) : 0;
        }
        if (i + batchSize < cartographics.length) {
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      }
      terrainStatus = 'loaded';
    } catch {
      sampledHeights = cartographics.map(() => 0);
      terrainStatus = 'sampling_error';
    }
  }

  // Bản đồ tra cứu nhanh độ cao mặt đất: map[azimuth][distance]
  const terrainHeightMap = new Map<string, { lat: number; lon: number; alt: number }>();
  for (let i = 0; i < groundPoints.length; i++) {
    const gp = groundPoints[i];
    terrainHeightMap.set(`${gp.az}_${gp.dist}`, {
      lat: gp.lat,
      lon: gp.lon,
      alt: sampledHeights[i] || 0,
    });
  }

  // 7. Xây dựng từng Ray trong không gian 3D (Azimuth × Elevation)
  const allRays: RayCoverageData[] = [];
  const azimuthRays: Record<number, RayCoverageData[]> = {};

  let occludedRaysCount = 0;
  let minHeightFound = radarCenterAltM;
  let maxHeightFound = radarCenterAltM;

  azimuths.forEach((az) => {
    azimuthRays[az] = [];

    elevations.forEach((el) => {
      // A. Xác định giới hạn tối đa của ray theo Coverage Profile
      const rayMaxRangeKm = getProfileMaxRange(profile, el, instance.rangeKm);
      const rayMaxRangeM = rayMaxRangeKm * 1000;

      if (rayMaxRangeM <= 0) {
        // Góc không được phép phủ sóng -> Không tạo vùng Visible
        const emptyRay: RayCoverageData = {
          azimuthDeg: az,
          elevationDeg: el,
          maxRangeM: 0,
          visibleEndM: 0,
          shadowStartM: null,
          hasOcclusion: false,
          occlusionPoint: null,
          samples: [],
        };
        allRays.push(emptyRay);
        azimuthRays[az].push(emptyRay);
        return;
      }

      // B. Duyệt dọc theo ray để tính LOS với địa hình
      const elRad = (el * Math.PI) / 180;
      const raySamples: RayCoverageSample[] = [];

      let firstOcclusionDist: number | null = null;
      let occlusionPoint: RayCoverageData['occlusionPoint'] = null;

      // Lọc các cự ly nằm trong giới hạn rayMaxRangeM
      const distancesForRay = sampleDistances.filter((d) => d <= rayMaxRangeM);
      if (distancesForRay.length === 0 || distancesForRay[distancesForRay.length - 1] < rayMaxRangeM) {
        distancesForRay.push(rayMaxRangeM);
      }

      for (const dist of distancesForRay) {
        // Lấy toạ độ và độ cao địa hình
        let groundMeta = terrainHeightMap.get(`${az}_${dist}`);
        if (!groundMeta) {
          const dest = destinationPoint(radarLat, radarLon, dist, az);
          groundMeta = { lat: dest.lat, lon: dest.lon, alt: 0 };
        }

        // Tính độ cao của tia sóng có xét độ cong Trái Đất và khúc xạ
        const hz = calculateEarthBulgeMeters(dist, kFactor);
        const rayAlt = radarCenterAltM + dist * Math.tan(elRad) - hz;

        if (rayAlt < minHeightFound) minHeightFound = rayAlt;
        if (rayAlt > maxHeightFound) maxHeightFound = rayAlt;

        // So sánh đường ray với bề mặt địa hình
        const isBlockedByTerrain = groundMeta.alt >= rayAlt;

        if (isBlockedByTerrain && firstOcclusionDist === null) {
          firstOcclusionDist = dist;
          occlusionPoint = {
            distanceM: dist,
            lat: groundMeta.lat,
            lon: groundMeta.lon,
            terrainAltM: Math.round(groundMeta.alt),
          };
        }

        const isCurrentlyInShadow = firstOcclusionDist !== null && dist >= firstOcclusionDist;

        raySamples.push({
          distanceM: dist,
          lat: groundMeta.lat,
          lon: groundMeta.lon,
          rayAltM: Math.round(rayAlt),
          terrainAltM: Math.round(groundMeta.alt),
          isVisible: !isCurrentlyInShadow,
          isShadow: isCurrentlyInShadow,
        });
      }

      const hasOcclusion = firstOcclusionDist !== null;
      if (hasOcclusion) occludedRaysCount++;

      const visibleEndM = hasOcclusion ? firstOcclusionDist! : rayMaxRangeM;
      const shadowStartM = hasOcclusion ? firstOcclusionDist! : null;

      const rayData: RayCoverageData = {
        azimuthDeg: az,
        elevationDeg: el,
        maxRangeM: rayMaxRangeM,
        visibleEndM,
        shadowStartM,
        hasOcclusion,
        occlusionPoint,
        samples: raySamples,
      };

      allRays.push(rayData);
      azimuthRays[az].push(rayData);
    });
  });

  // 8. Đóng gói kết quả Coverage Field hoàn chỉnh (Single Source of Truth)
  const coneRadiusKm = calculateConeOfSilenceRadiusKm(
    targetHeightMeters,
    instance.maxElevationDeg
  );
  const horizonKm = calculateRadarHorizonDistanceKm(
    antennaHeight,
    targetHeightMeters
  );

  const coverageRatio =
    allRays.length > 0
      ? Math.round(((allRays.length - occludedRaysCount) / allRays.length) * 100)
      : 100;

  const cacheKey = generateCoverageCacheKey(instance, params);

  return {
    instanceId: instance.instanceId,
    radarName: instance.name,
    calculatedAt: Date.now(),
    cacheKey,
    radarLat,
    radarLon,
    radarAltM: Math.round(radarCenterAltM),
    antennaHeightAGL: antennaHeight,
    profileId: profile?.id || 'default_profile',
    minElevationDeg: minElevDeg,
    maxElevationDeg: maxElevDeg,
    maxRangeKm: globalMaxRangeKm,
    minHeightM: Math.round(minHeightFound),
    maxHeightM: Math.round(maxHeightFound),
    targetHeightM: Math.round(targetHeightMeters),
    terrainStatus,
    rays: allRays,
    azimuthRays,
    totalRays: allRays.length,
    occludedRaysCount,
    coverageRatioPercent: coverageRatio,
    coneOfSilenceRadiusKm: Number(coneRadiusKm.toFixed(2)),
    radarHorizonKm: Number(horizonKm.toFixed(1)),
  };
}

/**
 * Chuyển đổi dữ liệu từ RadarCoverageField sang RadarCoverageResult (Không lấy mẫu địa hình lại)
 */
export function convertFieldToCoverageResult(
  field: RadarCoverageField,
  instance: EquipmentInstance,
  targetHeightM: number = 300
): RadarCoverageResult {
  const profiles: RayProfile[] = [];
  const azimuths = Object.keys(field.azimuthRays).map(Number).sort((a, b) => a - b);

  azimuths.forEach((az) => {
    const raysAtAz = field.azimuthRays[az] || [];
    const minElevRay = raysAtAz[0];
    const raySamples: RaySamplePoint[] = (minElevRay?.samples || []).map((s) => ({
      distanceM: s.distanceM,
      lat: s.lat,
      lon: s.lon,
      terrainAltM: s.terrainAltM,
      rayAltM: s.rayAltM,
      isBlocked: s.isShadow,
    }));

    profiles.push({
      azimuthDeg: az,
      maskingAngleRad: minElevRay?.hasOcclusion ? 0.06 : 0,
      maskingDistanceM: minElevRay?.occlusionPoint?.distanceM || 0,
      samples: raySamples,
      maxRangeM: (minElevRay?.maxRangeM || instance.rangeKm * 1000),
    });
  });

  return {
    instanceId: instance.instanceId,
    radarName: instance.name,
    calculatedAt: field.calculatedAt,
    radarLat: field.radarLat,
    radarLon: field.radarLon,
    radarAltM: field.radarAltM,
    antennaHeightAGL: field.antennaHeightAGL,
    maxRangeKm: field.maxRangeKm,
    targetHeightM,
    coneOfSilenceRadiusKm: field.coneOfSilenceRadiusKm,
    radarHorizonKm: field.radarHorizonKm,
    profiles,
    totalRays: field.totalRays,
    blockedRaysCount: field.occludedRaysCount,
    coverageRatioPercent: field.coverageRatioPercent,
  };
}

/**
 * Hàm tương thích ngược computeRadarCoverage chuyển đổi từ CoverageField
 */
export async function computeRadarCoverage(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  params: RadarCalculationParams
): Promise<RadarCoverageResult> {
  const field = await computeRadarCoverageField(instance, terrainProvider, params);
  return convertFieldToCoverageResult(field, instance, params.targetHeightMeters || 300);
}

