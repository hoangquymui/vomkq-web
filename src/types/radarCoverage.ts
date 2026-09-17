/**
 * Kiểu dữ liệu phục vụ tính toán Line-of-Sight (LOS), trường phủ sóng và vòm 3D cắt địa hình
 */

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
