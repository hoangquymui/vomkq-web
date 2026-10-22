/**
 * ĐỘNG CƠ SO SÁNH TẦM NHÌN ĐỊA HÌNH GIS (GIS TERRAIN COMPARISON ENGINE)
 * So sánh ảnh hưởng của địa hình số (DEM) đến hai vị trí quan sát độc lập (Observer A vs Observer B)
 * Phục vụ trực quan hóa và huấn luyện mô phỏng không gian GIS.
 *
 * RÀNG BUỘC PHÁP LÝ & TÁC CHIẾN:
 * - Không chuyển kết quả chồng lấn thành kết luận về khả năng khai hỏa thực tế.
 * - Không xác định trường bắn hiệu dụng của tên lửa.
 * - Ngoại lệ: Cách ly hoàn toàn S-300PMU2 ('sam_s300').
 */

import * as Cesium from 'cesium';
import { sampleTerrainOptimized } from './terrainSampler';
import { destinationPoint } from './radarLosEngine';
import { calculateEarthBulgeMeters, DEFAULT_K_FACTOR } from './radarMath';

export interface ObserverComparisonPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeASL: number; // Cao độ mặt đất tự nhiên (m)
  antennaHeightAGL: number; // Chiều cao ăng-ten / đài quan sát (m)
  rangeKm: number; // Cự ly quan sát tối đa (km)
  templateId?: string;
}

export interface TerrainComparisonConfig {
  azimuthStepDeg: number; // Mặc định 5°
  targetHeightMeters: number; // Độ cao mục tiêu khảo sát H_mt (m), mặc định 100m
  kFactor: number; // Hệ số khúc xạ 4/3
  analysisRadiusKm?: number; // Bán kính phân tích chung
}

export interface ComparisonPointSample {
  azimuthDeg: number;
  distanceM: number;
  latitude: number;
  longitude: number;
  terrainAltM: number;
  // Trạng thái nhìn thấy: true = Nhìn thấy (LOS), false = Bị núi che khuất
  visibleFromA: boolean;
  visibleFromB: boolean;
  // Vùng thiếu DEM
  isMissingDem: boolean;
}

export interface TerrainComparisonResult {
  observerA: ObserverComparisonPoint;
  observerB: ObserverComparisonPoint;
  timestamp: number;
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';

  // Dữ liệu lưới mẫu
  samples: ComparisonPointSample[];

  // Thống kê định lượng (%)
  stats: {
    totalSamples: number;
    // Cả A và B đều quan sát được
    overlapVisibleCount: number;
    overlapVisiblePercent: number;
    // Cả A và B đều bị che khuất (Mù chung)
    mutualBlindCount: number;
    mutualBlindPercent: number;
    // Chỉ A nhìn thấy (B bị che)
    onlyAVisibleCount: number;
    onlyAVisiblePercent: number;
    // Chỉ B nhìn thấy (A bị che)
    onlyBVisibleCount: number;
    onlyBVisiblePercent: number;
    // Vùng chưa đủ dữ liệu DEM
    missingDemCount: number;
    missingDemPercent: number;
  };
}

/**
 * Kiểm tra xem khí tài có thuộc diện ngoại lệ S-300PMU2 hay không
 */
export function isS300Exception(observer: ObserverComparisonPoint): boolean {
  return observer.templateId === 'sam_s300';
}

/**
 * Thực thi thuật toán so sánh ảnh hưởng địa hình giữa 2 vị trí quan sát A và B
 */
export async function runTerrainComparison(
  observerA: ObserverComparisonPoint,
  observerB: ObserverComparisonPoint,
  terrainProvider: Cesium.TerrainProvider | null,
  config: Partial<TerrainComparisonConfig> = {}
): Promise<TerrainComparisonResult> {
  // 1. Kiểm tra ngoại lệ S-300PMU2: Tuyệt đối không áp dụng
  if (isS300Exception(observerA) || isS300Exception(observerB)) {
    throw new Error(
      'Ngoại lệ kỹ thuật: Tổ hợp S-300PMU2 không áp dụng tính năng so sánh lớp phủ kết hợp mới!'
    );
  }

  const azStep = config.azimuthStepDeg || 5;
  const hMt = config.targetHeightMeters || 100;
  const k = config.kFactor || DEFAULT_K_FACTOR;

  // Lấy bán kính phân tích chung: Tối thiểu của tầm A, tầm B và max 100km
  const maxRangeM = Math.min(
    100000,
    Math.max(
      observerA.rangeKm * 1000,
      observerB.rangeKm * 1000,
      (config.analysisRadiusKm || 50) * 1000
    )
  );

  // Sinh lưới cự ly phân tích
  const distances: number[] = [];
  const stepDist = maxRangeM <= 40000 ? 1000 : 2500;
  for (let d = stepDist; d <= maxRangeM; d += stepDist) {
    distances.push(d);
  }

  const azimuths: number[] = [];
  for (let az = 0; az < 360; az += azStep) {
    azimuths.push(az);
  }

  // 2. Tạo tập hợp các điểm tọa độ cần khảo sát từ tâm vị trí A
  // (Không gian khảo sát bao phủ quanh khu vực của cả 2 đài)
  interface GridPoint {
    azA: number;
    distA: number;
    lat: number;
    lon: number;
  }
  const gridPoints: GridPoint[] = [];
  const cartographics: Cesium.Cartographic[] = [];

  azimuths.forEach((az) => {
    distances.forEach((dist) => {
      const dest = destinationPoint(observerA.latitude, observerA.longitude, dist, az);
      gridPoints.push({ azA: az, distA: dist, lat: dest.lat, lon: dest.lon });
      cartographics.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
    });
  });

  // 3. Lấy mẫu DEM thực tế từ Cesium TerrainProvider
  let sampledHeights: number[] = new Array(cartographics.length).fill(0);
  let terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error' = 'flat_fallback';

  if (terrainProvider && !(terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
    try {
      sampledHeights = await sampleTerrainOptimized(
        terrainProvider,
        observerA.longitude,
        observerA.latitude,
        cartographics,
        10,
        1500
      );
      terrainStatus = 'loaded';
    } catch {
      sampledHeights = cartographics.map(() => 0);
      terrainStatus = 'sampling_error';
    }
  }

  // 4. Tính toán độ cao tuyệt đối của 2 vị trí quan sát
  const totalAltA = observerA.altitudeASL + observerA.antennaHeightAGL;
  const totalAltB = observerB.altitudeASL + observerB.antennaHeightAGL;

  // Bản đồ tra cứu độ cao mặt đất theo tọa độ
  const heightLookup = new Map<string, number>();
  for (let i = 0; i < gridPoints.length; i++) {
    const pt = gridPoints[i];
    heightLookup.set(`${pt.azA}_${pt.distA}`, sampledHeights[i] || 0);
  }

  // 5. Tính góc che khuất tích lũy từ Observer A
  const maxTanA = new Map<number, number>(); // az -> maxTan
  const visibleMapA = new Map<string, boolean>();

  azimuths.forEach((az) => {
    let currentMaxTan = -Infinity;
    distances.forEach((dist) => {
      const groundAlt = heightLookup.get(`${az}_${dist}`) || 0;
      const hz = calculateEarthBulgeMeters(dist, k);
      const tanTerrain = (groundAlt - totalAltA - hz) / dist;

      // Góc nhìn tới mục tiêu ở độ cao H_mt (AGL)
      const targetAlt = groundAlt + hMt;
      const tanTarget = (targetAlt - totalAltA - hz) / dist;

      if (tanTarget >= currentMaxTan) {
        visibleMapA.set(`${az}_${dist}`, true);
      } else {
        visibleMapA.set(`${az}_${dist}`, false);
      }

      if (tanTerrain > currentMaxTan) {
        currentMaxTan = tanTerrain;
      }
    });
    maxTanA.set(az, currentMaxTan);
  });

  // 6. Tính góc che khuất tích lũy từ Observer B
  // Với mỗi điểm mẫu p, tính cự ly và góc phương vị từ B tới p
  const visibleMapB = new Map<string, boolean>();

  for (let i = 0; i < gridPoints.length; i++) {
    const pt = gridPoints[i];
    const groundAlt = sampledHeights[i] || 0;

    // Khoảng cách từ B tới điểm này
    const dLat = ((pt.lat - observerB.latitude) * Math.PI) / 180;
    const dLon = ((pt.lon - observerB.longitude) * Math.PI) / 180;
    const meanLat = ((pt.lat + observerB.latitude) * Math.PI) / 360;
    const xM = dLon * 6371000 * Math.cos(meanLat);
    const yM = dLat * 6371000;
    const distB = Math.hypot(xM, yM);

    if (distB > observerB.rangeKm * 1000) {
      // Vượt quá cự ly của B
      visibleMapB.set(`${pt.azA}_${pt.distA}`, false);
      continue;
    }

    const hzB = calculateEarthBulgeMeters(distB, k);
    const targetAlt = groundAlt + hMt;
    const tanTargetB = (targetAlt - totalAltB - hzB) / Math.max(10, distB);

    // Tính góc chắn đơn giản dọc hướng từ B tới P
    // (Kiểm tra góc nhìn có dương hơn góc chân trời tối thiểu hay không)
    const minElevAngleRad = (0.5 * Math.PI) / 180;
    const isVisibleB = tanTargetB >= Math.tan(minElevAngleRad);
    visibleMapB.set(`${pt.azA}_${pt.distA}`, isVisibleB);
  }

  // 7. Tổng hợp và phân loại ma trận 6 lớp
  const samples: ComparisonPointSample[] = [];
  let overlapVisibleCount = 0;
  let mutualBlindCount = 0;
  let onlyAVisibleCount = 0;
  let onlyBVisibleCount = 0;
  let missingDemCount = 0;

  for (let i = 0; i < gridPoints.length; i++) {
    const pt = gridPoints[i];
    const key = `${pt.azA}_${pt.distA}`;
    const terrAlt = sampledHeights[i] || 0;
    const visA = visibleMapA.get(key) ?? false;
    const visB = visibleMapB.get(key) ?? false;
    const isMissing = terrainStatus !== 'loaded';

    if (isMissing) missingDemCount++;

    if (visA && visB) {
      overlapVisibleCount++;
    } else if (!visA && !visB) {
      mutualBlindCount++;
    } else if (visA && !visB) {
      onlyAVisibleCount++;
    } else if (!visA && visB) {
      onlyBVisibleCount++;
    }

    samples.push({
      azimuthDeg: pt.azA,
      distanceM: pt.distA,
      latitude: pt.lat,
      longitude: pt.lon,
      terrainAltM: terrAlt,
      visibleFromA: visA,
      visibleFromB: visB,
      isMissingDem: isMissing,
    });
  }

  const total = samples.length || 1;

  return {
    observerA,
    observerB,
    timestamp: Date.now(),
    terrainStatus,
    samples,
    stats: {
      totalSamples: total,
      overlapVisibleCount,
      overlapVisiblePercent: Number(((overlapVisibleCount / total) * 100).toFixed(1)),
      mutualBlindCount,
      mutualBlindPercent: Number(((mutualBlindCount / total) * 100).toFixed(1)),
      onlyAVisibleCount,
      onlyAVisiblePercent: Number(((onlyAVisibleCount / total) * 100).toFixed(1)),
      onlyBVisibleCount,
      onlyBVisiblePercent: Number(((onlyBVisibleCount / total) * 100).toFixed(1)),
      missingDemCount,
      missingDemPercent: Number(((missingDemCount / total) * 100).toFixed(1)),
    },
  };
}
