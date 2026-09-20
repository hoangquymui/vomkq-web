import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type {
  SpxRadarCoverageConfig,
  SpxCoverageResult,
  SpxCoverageContour,
  SpxRangeRing,
} from '../types/spxRadarCoverage';

const MEAN_EARTH_RADIUS_METERS = 6371000; // Bán kính trung bình Trái Đất (m)

/**
 * Tính toạ độ đích theo phương vị (bearing) và cự ly (distanceM) theo hình cầu WGS84,
 * bảo vệ tuyệt đối chống toạ độ NaN hoặc giá trị vô cực
 */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceM: number,
  bearingDeg: number
): { lat: number; lon: number } {
  if (
    typeof lat !== 'number' || typeof lon !== 'number' ||
    isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)
  ) {
    return { lat: 16.043, lon: 108.12081 };
  }

  const safeDist = typeof distanceM === 'number' && !isNaN(distanceM) && isFinite(distanceM) ? distanceM : 0;
  const safeBearing = typeof bearingDeg === 'number' && !isNaN(bearingDeg) && isFinite(bearingDeg) ? bearingDeg : 0;

  if (safeDist <= 0) {
    return { lat, lon };
  }

  const δ = safeDist / MEAN_EARTH_RADIUS_METERS;
  const θ = (safeBearing * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * Math.sin(φ2);
  const λ2 = λ1 + Math.atan2(y, x);

  const resLat = (φ2 * 180) / Math.PI;
  const resLon = (((λ2 * 180) / Math.PI + 540) % 360) - 180;

  return {
    lat: isNaN(resLat) || !isFinite(resLat) ? lat : resLat,
    lon: isNaN(resLon) || !isFinite(resLon) ? lon : resLon,
  };
}

/**
 * Tạo cache key cho cấu hình SPx của khí tài
 */
export function generateSpxCacheKey(
  instance: EquipmentInstance,
  config: SpxRadarCoverageConfig
): string {
  const heightsKey = config.targetHeights
    .map((t) => `${t.id}:${t.heightMeters}`)
    .join('|');
  return [
    instance.instanceId,
    instance.latitude.toFixed(5),
    instance.longitude.toFixed(5),
    config.radarHeightAGL.toFixed(1),
    config.startRangeM,
    config.endRangeM,
    config.minElevationDeg,
    config.maxElevationDeg,
    config.azimuthStartDeg,
    config.azimuthEndDeg,
    config.earthCurvature ? '1' : '0',
    config.kFactor.toFixed(3),
    config.altitudeReference,
    heightsKey,
  ].join('__');
}

/**
 * Bộ nhớ đệm lưu trữ kết quả lấy mẫu địa hình DEM
 * Giúp việc thay đổi độ cao mục tiêu hoặc dải màu diễn ra trong 0ms
 */
const terrainSampleCache = new Map<
  string,
  {
    groundElevationM: number;
    azimuths: number[];
    sampleDistances: number[];
    // Ma trận độ cao địa hình: heights[azimuthIdx][distIdx]
    heightsMatrix: Float32Array[];
  }
>();

/**
 * Tính toán danh sách cự ly các vòng cự ly thông minh và nội suy cho cự ly bất kỳ (ví dụ 165000m, 50000m)
 */
export function calculateSmartRangeRings(endRangeM: number, customIntervalM?: number): number[] {
  const safeEndRange = typeof endRangeM === 'number' && !isNaN(endRangeM) && isFinite(endRangeM)
    ? Math.max(1000, endRangeM)
    : 50000;
  let intervalM = typeof customIntervalM === 'number' && !isNaN(customIntervalM) && isFinite(customIntervalM) && customIntervalM > 0
    ? customIntervalM
    : 0;

  if (!intervalM) {
    // Tự động nội suy bước nhảy chuẩn tác chiến
    const km = safeEndRange / 1000;
    if (km <= 15) intervalM = 2500;       // mỗi 2.5km
    else if (km <= 35) intervalM = 5000;  // mỗi 5km
    else if (km <= 65) intervalM = 5000;  // mỗi 5km (50km -> 10 vòng chuẩn SPx)
    else if (km <= 120) intervalM = 10000;// mỗi 10km (100km -> 10 vòng)
    else if (km <= 220) intervalM = 25000;// mỗi 25km (165km -> 25, 50, 75, 100, 125, 150km)
    else if (km <= 350) intervalM = 50000;// mỗi 50km (300km -> 6 vòng)
    else intervalM = 50000;
  }

  // Đảm bảo số vòng từ 3 đến 14 vòng để bản đồ không bị rối
  while (safeEndRange / intervalM > 14) {
    intervalM *= 2;
  }

  const ranges: number[] = [];
  for (let r = intervalM; r < safeEndRange - (intervalM * 0.2); r += intervalM) {
    ranges.push(r);
  }

  // LUÔN LUÔN bao gồm vòng cự ly tối đa ngoài cùng (ví dụ 165.000m)
  if (!ranges.includes(safeEndRange)) {
    ranges.push(safeEndRange);
  }

  return ranges;
}

/**
 * Lấy mẫu độ cao địa hình an toàn theo lô (batches), tránh lỗi net::ERR_INSUFFICIENT_RESOURCES
 * khi yêu cầu hàng chục nghìn điểm cùng lúc trong trình duyệt.
 * Sử dụng cấp zoom 11 cho cự ly <= 80km và cấp zoom 10 cho cự ly lớn,
 * chia nhỏ thành từng batch 2500 điểm để không làm nghẽn hàng đợi kết nối mạng của Chromium.
 */
async function sampleTerrainInBatches(
  terrainProvider: Cesium.TerrainProvider,
  positions: Cesium.Cartographic[],
  endRangeM: number
): Promise<{ heights: number[]; status: 'dem_loaded' | 'flat_fallback' | 'error' }> {
  // Cấp 11: mỗi tile ~10km, độ chi tiết mesh rất cao, bao phủ trọn vẹn đỉnh núi Bà Nà, Sơn Trà, Hải Vân
  // Cấp 10: mỗi tile ~20km, tối ưu cho cự ly lớn > 80km
  const targetLevel = endRangeM <= 80000 ? 11 : 10;
  const batchSize = 4500;
  const heights = new Array<number>(positions.length).fill(0);

  try {
    for (let i = 0; i < positions.length; i += batchSize) {
      const chunk = positions.slice(i, i + batchSize);
      try {
        await Cesium.sampleTerrain(terrainProvider, targetLevel, chunk, false);
      } catch (err) {
        console.warn(`Lô lấy mẫu địa hình ${i}-${i + chunk.length} tại level ${targetLevel} có lỗi, fallback sang level 10:`, err);
        try {
          await Cesium.sampleTerrain(terrainProvider, 10, chunk, false);
        } catch {
          // Bỏ qua lỗi cục bộ, các điểm không đọc được sẽ mặc định 0m (mực nước biển)
        }
      }

      for (let j = 0; j < chunk.length; j++) {
        const h = chunk[j].height;
        heights[i + j] = h !== undefined && !isNaN(h) && isFinite(h) ? Math.max(0, h) : 0;
      }
    }

    return { heights, status: 'dem_loaded' };
  } catch (finalErr) {
    console.error('Lỗi khi lấy mẫu địa hình DEM:', finalErr);
    return { heights, status: 'error' };
  }
}

/**
 * ĐỘNG CƠ TÍNH TOÁN VÙNG PHỦ SPx (CAMBRIDGE PIXEL SPx RADAR COVERAGE ENGINE)
 * Quét tia Line-of-Sight kết hợp độ cong Trái Đất 4/3 và độ cao mục tiêu
 */
export async function computeSpxRadarCoverage(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  config: SpxRadarCoverageConfig
): Promise<SpxCoverageResult> {
  const radarLat = typeof instance.latitude === 'number' && !isNaN(instance.latitude) && isFinite(instance.latitude)
    ? instance.latitude
    : 16.043;
  const radarLon = typeof instance.longitude === 'number' && !isNaN(instance.longitude) && isFinite(instance.longitude)
    ? instance.longitude
    : 108.12081;

  const rawEnd = config?.endRangeM ?? (instance.rangeKm ? instance.rangeKm * 1000 : 50000);
  const endRangeM = typeof rawEnd === 'number' && !isNaN(rawEnd) && isFinite(rawEnd) ? Math.max(1000, rawEnd) : 50000;

  const rawStart = config?.startRangeM ?? 0;
  const startRangeM = typeof rawStart === 'number' && !isNaN(rawStart) && isFinite(rawStart) ? Math.max(0, rawStart) : 0;

  // 1. Kiểm tra hoặc lấy mẫu lưới địa hình DEM quanh vị trí đài
  const posKey = `${radarLat.toFixed(5)}_${radarLon.toFixed(5)}_${endRangeM}`;
  let cachedGrid = terrainSampleCache.get(posKey);

  let terrainStatus: 'dem_loaded' | 'flat_fallback' | 'error' = 'dem_loaded';

  // Độ phân giải phương vị và cự ly
  // 360 tia (bước 1.0°) tạo biên dạng răng cưa cực kỳ chân thực
  const azStepDeg = 1.0;
  const azimuths: number[] = [];
  const startAz = typeof config?.azimuthStartDeg === 'number' && !isNaN(config.azimuthStartDeg) ? config.azimuthStartDeg : 0;
  const endAz = typeof config?.azimuthEndDeg === 'number' && !isNaN(config.azimuthEndDeg) ? config.azimuthEndDeg : 360;
  for (let az = startAz; az < endAz; az += azStepDeg) {
    azimuths.push(az);
  }

  // Bước cự ly lấy mẫu dọc theo tia tối ưu hoá hiệu năng (khoảng 70-80 bước cho cự ly 50km, giảm 40% tải mạng)
  const distStepM = Math.max(350, Math.round(endRangeM / 75));
  const sampleDistances: number[] = [];
  for (let d = Math.max(350, distStepM); d <= endRangeM; d += distStepM) {
    sampleDistances.push(d);
  }
  if (sampleDistances[sampleDistances.length - 1] !== endRangeM) {
    sampleDistances.push(endRangeM);
  }

  if (!cachedGrid) {
    // A. Lấy cao độ vị trí đặt đài
    const radarCarto = Cesium.Cartographic.fromDegrees(radarLon, radarLat);
    const gridCartos: Cesium.Cartographic[] = [radarCarto];

    // B. Chuẩn bị các điểm dọc theo 360 tia phương vị
    for (const az of azimuths) {
      for (const dist of sampleDistances) {
        const dest = destinationPoint(radarLat, radarLon, dist, az);
        gridCartos.push(Cesium.Cartographic.fromDegrees(dest.lon, dest.lat));
      }
    }

    // C. Lấy mẫu bất đồng bộ an toàn từ Cesium TerrainProvider
    let sampledHeights: number[] = [];
    if (terrainProvider) {
      const sampleRes = await sampleTerrainInBatches(
        terrainProvider,
        gridCartos,
        endRangeM
      );
      sampledHeights = sampleRes.heights;
      terrainStatus = sampleRes.status;
    } else {
      sampledHeights = new Array(gridCartos.length).fill(0);
      terrainStatus = 'flat_fallback';
    }

    const groundElevationM = sampledHeights[0] || 0;

    // D. Xây dựng ma trận độ cao
    const heightsMatrix: Float32Array[] = [];
    let ptr = 1;
    for (let a = 0; a < azimuths.length; a++) {
      const row = new Float32Array(sampleDistances.length);
      for (let s = 0; s < sampleDistances.length; s++) {
        row[s] = sampledHeights[ptr++];
      }
      heightsMatrix.push(row);
    }

    cachedGrid = {
      groundElevationM,
      azimuths,
      sampleDistances,
      heightsMatrix,
    };

    terrainSampleCache.set(posKey, cachedGrid);
  }

  const { groundElevationM, heightsMatrix } = cachedGrid;
  const radarAGL = typeof config?.radarHeightAGL === 'number' && !isNaN(config.radarHeightAGL) && isFinite(config.radarHeightAGL)
    ? config.radarHeightAGL
    : (instance.antennaHeightAGL || 15);
  const totalAntennaElevationM = (groundElevationM || 0) + radarAGL;

  // Bán kính hiệu dụng khúc xạ Trái Đất 4/3
  const kFactor = typeof config?.kFactor === 'number' && !isNaN(config.kFactor) && isFinite(config.kFactor)
    ? config.kFactor
    : 1.33333;
  const effectiveEarthRadiusM = config.earthCurvature
    ? kFactor * MEAN_EARTH_RADIUS_METERS
    : Infinity;

  // Tangent của góc tà quét tối thiểu và tối đa
  const minElev = typeof config?.minElevationDeg === 'number' && !isNaN(config.minElevationDeg) ? config.minElevationDeg : -10;
  const maxElev = typeof config?.maxElevationDeg === 'number' && !isNaN(config.maxElevationDeg) ? config.maxElevationDeg : 40;
  const tanMinElev = Math.tan((minElev * Math.PI) / 180);
  const tanMaxElev = Math.tan((maxElev * Math.PI) / 180);

  // 2. Sắp xếp các tầng độ cao mục tiêu (từ thấp đến cao để phân tích)
  const targetHeightsList = Array.isArray(config?.targetHeights) && config.targetHeights.length > 0
    ? config.targetHeights
    : [
        { id: 'tier_500', heightMeters: 500, color: '#00e676', label: '500m' },
        { id: 'tier_800', heightMeters: 800, color: '#ffd600', label: '800m' },
        { id: 'tier_1000', heightMeters: 1000, color: '#ff9100', label: '1000m' },
        { id: 'tier_2000', heightMeters: 2000, color: '#ff1744', label: '2000m' },
      ];
  const sortedTiers = [...targetHeightsList].sort(
    (a, b) => a.heightMeters - b.heightMeters
  );

  // Lưu cự ly phát hiện tối đa cho từng tầng theo từng phương vị:
  // maxRangePerTierAz[tierIndex][azimuthIndex] = maxVisibleDistanceM
  const maxRangePerTierAz: number[][] = sortedTiers.map(() =>
    new Array(azimuths.length).fill(startRangeM)
  );

  // 3. Quét tia theo từng phương vị
  for (let azIdx = 0; azIdx < azimuths.length; azIdx++) {
    const rowHeights = heightsMatrix[azIdx];

    // Góc chắn cực đại dọc theo tia (bắt đầu từ góc quét dưới)
    let currentMaxMaskTan = tanMinElev;

    // Theo dõi cự ly phủ sóng cho từng tầng trên hướng phương vị này
    const currentTierRanges = new Array(sortedTiers.length).fill(startRangeM);

    for (let distIdx = 0; distIdx < sampleDistances.length; distIdx++) {
      const dist = sampleDistances[distIdx];
      const terrainH = rowHeights[distIdx] || 0;

      // Độ sụt giảm do độ cong Trái Đất tại cự ly dist
      const earthBulgeDropM = config.earthCurvature && isFinite(effectiveEarthRadiusM)
        ? (dist * dist) / (2 * effectiveEarthRadiusM)
        : 0;

      // Góc tà của đỉnh địa hình tại cự ly dist nhìn từ anten đài
      const tanTerrainAngle =
        (terrainH - totalAntennaElevationM - earthBulgeDropM) / dist;

      // Cập nhật góc chắn địa hình cực đại
      if (tanTerrainAngle > currentMaxMaskTan) {
        currentMaxMaskTan = Math.min(tanMaxElev, tanTerrainAngle);
      }

      // Kiểm tra Line-of-Sight cho từng tầng độ cao mục tiêu
      for (let tIdx = 0; tIdx < sortedTiers.length; tIdx++) {
        const tier = sortedTiers[tIdx];

        // Độ cao mục tiêu (MSL hoặc AGL)
        let targetAltM = tier.heightMeters;
        if (config.altitudeReference === 'ground') {
          targetAltM = terrainH + tier.heightMeters;
        }

        // 1. Mục tiêu phải cao hơn mặt đất thực tế tại điểm đó
        if (targetAltM < terrainH) {
          continue;
        }

        // 2. Góc tà nhìn tới mục tiêu từ anten đài
        const tanTargetAngle =
          (targetAltM - totalAntennaElevationM - earthBulgeDropM) / dist;

        // 3. Điều kiện phát hiện:
        // - Góc tới mục tiêu phải vượt lên trên góc chắn của địa hình trước đó
        // - Góc tới mục tiêu phải nằm trong búp sóng [tanMinElev, tanMaxElev]
        const isVisible =
          tanTargetAngle >= currentMaxMaskTan &&
          tanTargetAngle <= tanMaxElev &&
          tanTargetAngle >= tanMinElev;

        if (isVisible) {
          currentTierRanges[tIdx] = dist;
        }
      }
    }

    // Gán kết quả cho từng tầng
    for (let tIdx = 0; tIdx < sortedTiers.length; tIdx++) {
      maxRangePerTierAz[tIdx][azIdx] = currentTierRanges[tIdx];
    }
  }

  // 4. Xây dựng các đa giác đường bao khép kín (Polygon Contours) cho từng tầng
  const contours: SpxCoverageContour[] = [];

  for (let tIdx = sortedTiers.length - 1; tIdx >= 0; tIdx--) {
    const tier = sortedTiers[tIdx];
    const polygonPositions: Array<{ lat: number; lon: number; alt: number }> = [];

    let maxObserved = 0;
    let sumR2 = 0;

    for (let azIdx = 0; azIdx < azimuths.length; azIdx++) {
      const az = azimuths[azIdx];
      const rawR = maxRangePerTierAz[tIdx][azIdx];
      const r = typeof rawR === 'number' && !isNaN(rawR) && isFinite(rawR) ? rawR : startRangeM;

      if (r > maxObserved) maxObserved = r;
      sumR2 += r * r;

      const pt = destinationPoint(radarLat, radarLon, r, az);
      if (typeof pt.lat === 'number' && typeof pt.lon === 'number' && !isNaN(pt.lat) && !isNaN(pt.lon) && isFinite(pt.lat) && isFinite(pt.lon)) {
        polygonPositions.push({
          lat: pt.lat,
          lon: pt.lon,
          alt: tier.heightMeters,
        });
      }
    }

    // Đóng đa giác khép kín
    if (polygonPositions.length > 0) {
      polygonPositions.push({ ...polygonPositions[0] });
    }

    // Diện tích vùng phủ xấp xỉ (km²)
    const dTheta = (azStepDeg * Math.PI) / 180;
    const coverageAreaKm2 = Number(((0.5 * sumR2 * dTheta) / 1_000_000).toFixed(1));

    // Nếu tầng này không phát hiện được mục tiêu (bị núi che hoàn toàn hoặc độ cao mục tiêu thấp hơn địa hình),
    // không tạo toạ độ rác suy biến về 1 điểm (gây lỗi NaN component trong Cesium)
    if (maxObserved <= 0 || coverageAreaKm2 <= 0) {
      contours.push({
        tier,
        polygonPositions: [],
        maxObservedRangeM: 0,
        coverageAreaKm2: 0,
      });
      continue;
    }

    contours.push({
      tier,
      polygonPositions,
      maxObservedRangeM: maxObserved,
      coverageAreaKm2,
    });
  }

  // 5. Tạo các vòng cự ly đồng tâm (Range Rings) với thuật toán nội suy thông minh
  const rangeRings: SpxRangeRing[] = [];
  if (config.showRangeRings) {
    const ringDistances = calculateSmartRangeRings(endRangeM, config.rangeRingIntervalM);

    for (const ringRangeM of ringDistances) {
      const ringPositions: Array<{ lat: number; lon: number }> = [];

      // Đường tròn 120 điểm mượt mà
      const ringStep = 3;
      for (let az = 0; az <= 360; az += ringStep) {
        ringPositions.push(destinationPoint(radarLat, radarLon, ringRangeM, az));
      }

      // Nhãn cự ly đặt ở hướng Bắc (0°)
      const labelPt = destinationPoint(radarLat, radarLon, ringRangeM, 0);

      const isMax = ringRangeM === endRangeM;
      const distStr = ringRangeM >= 1000 ? `${ringRangeM / 1000}km` : `${ringRangeM}m`;
      rangeRings.push({
        rangeM: ringRangeM,
        label: isMax ? `${distStr} [MAX]` : distStr,
        positions: ringPositions,
        labelPosition: labelPt,
      });
    }
  }

  return {
    instanceId: instance.instanceId,
    calculatedAt: Date.now(),
    cacheKey: generateSpxCacheKey(instance, config),
    radarLat,
    radarLon,
    groundElevationM,
    totalAntennaElevationM,
    config,
    contours,
    rangeRings,
    terrainStatus,
  };
}
