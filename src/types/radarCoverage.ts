/**
 * Kiểu dữ liệu phục vụ tính toán Line-of-Sight (LOS), trường phủ sóng và vòm 3D cắt địa hình
 * Chuẩn hóa theo kiến trúc: Coverage Profile -> LOS Engine -> Coverage Field (SINGLE SOURCE OF TRUTH)
 */

/**
 * Điểm mốc giới hạn cự ly theo góc tà trong Coverage Profile
 */
export interface CoverageProfilePoint {
  elevationDeg: number; // Góc tà (°)
  maxRangeKm: number; // Cự ly phát hiện tối đa tại góc tà này (km)
}

/**
 * Coverage Profile: Giới hạn phủ sóng theo góc tà và cự ly của khí tài
 */
export interface CoverageProfile {
  id: string;
  name: string;
  minElevationDeg: number;
  maxElevationDeg: number;
  points: CoverageProfilePoint[]; // Sắp xếp tăng dần theo elevationDeg
}

/**
 * Điểm lấy mẫu 3D trên tia sóng
 */
export interface RayCoverageSample {
  distanceM: number;
  lat: number;
  lon: number;
  rayAltM: number;
  terrainAltM: number;
  isVisible: boolean;
  isShadow: boolean;
}

/**
 * Dữ liệu của một tia quét quang tuyến 3D (Azimuth x Elevation)
 */
export interface RayCoverageData {
  azimuthDeg: number;
  elevationDeg: number;
  maxRangeM: number;
  visibleEndM: number; // Cự ly điểm Visible cuối cùng trước vật cản
  shadowStartM: number | null; // Cự ly bắt đầu vùng Shadow (sau vật cản)
  hasOcclusion: boolean; // Có bị địa hình chắn không
  occlusionPoint: {
    distanceM: number;
    lat: number;
    lon: number;
    terrainAltM: number;
  } | null;
  samples: RayCoverageSample[];
}

/**
 * Dữ liệu trường radar hoàn chỉnh: SINGLE SOURCE OF TRUTH
 */
export interface RadarCoverageField {
  instanceId: string;
  radarName: string;
  calculatedAt: number;
  cacheKey: string;
  radarLat: number;
  radarLon: number;
  radarAltM: number; // Cao độ đài (ASL + AGL)
  antennaHeightAGL: number;
  profileId: string;
  minElevationDeg: number;
  maxElevationDeg: number;
  maxRangeKm: number;
  minHeightM: number;
  maxHeightM: number;
  targetHeightM: number; // Độ cao mục tiêu khảo sát H_mt (m)
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';

  // Toàn bộ các tia theo Azimuth x Elevation
  rays: RayCoverageData[];

  // Tra cứu nhanh theo Azimuth (phục vụ Cross Section)
  azimuthRays: Record<number, RayCoverageData[]>;

  // Thống kê vùng phủ
  totalRays: number;
  occludedRaysCount: number;
  coverageRatioPercent: number;
  coneOfSilenceRadiusKm: number;
  radarHorizonKm: number;
}

export interface RaySamplePoint {
  distanceM: number;
  lat: number;
  lon: number;
  terrainAltM: number;
  rayAltM: number;
  isBlocked: boolean;
}

export interface RayProfile {
  azimuthDeg: number;
  maskingAngleRad: number; // Góc che khuất lớn nhất trên hướng này (radian)
  maskingDistanceM: number; // Cự ly đến điểm che khuất chính
  samples: RaySamplePoint[];
  maxRangeM: number;
}

export interface RadarCoverageResult {
  instanceId: string;
  radarName: string;
  calculatedAt: number;
  radarLat: number;
  radarLon: number;
  radarAltM: number; // ASL (mặt đất) + AGL (tháp anten)
  antennaHeightAGL: number;
  maxRangeKm: number;
  targetHeightM: number;
  coneOfSilenceRadiusKm: number; // R_kh_mu = H_mt * cot(eps_max)
  radarHorizonKm: number; // D_nt = 4.12 * (sqrt(ha) + sqrt(Hmt))
  profiles: RayProfile[];
  
  // Thống kê vùng phủ
  totalRays: number;
  blockedRaysCount: number;
  coverageRatioPercent: number; // Tỷ lệ phủ %
}

export interface RadarCalculationParams {
  targetHeightMeters: number; // Độ cao mục tiêu khảo sát H_mt (m)
  azimuthStepDeg: number; // Bước góc lấy mẫu phương vị (ví dụ 2° đến 5°)
  radialStepMeters: number; // Bước cự ly lấy mẫu (ví dụ 500m đến 1000m)
  elevationStepDeg?: number; // Bước góc tà (ví dụ 2° đến 3°)
  kFactor: number; // Hệ số khúc xạ khí quyển (chuẩn 4/3 ~ 1.3333)
  showBlindZones: boolean; // Bật/tắt hiển thị vùng mù (Đỏ)
}

export interface RadarFieldSummary {
  totalStations: number;
  totalAreaSqKm: number; // S_truong = 2.6 * D0^2 * n
  overlapFactor: number; // K_trl = 1.2 * (DH / D0)^2
  detectionProbability: number; // P_ph = 1 - (1 - P_tb)^K_trl
  effectiveHorizonKm: number;
  activeRadars: Array<{
    id: string;
    name: string;
    rangeKm: number;
    coneOfSilenceKm: number;
    coveragePercent: number;
  }>;
}

