/**
 * Định nghĩa cấu trúc dữ liệu cho Vùng Hỏa Lực Tên Lửa Phòng Không (SAM) Cắt Địa Hình
 * Hỗ trợ 2 điều kiện cốt lõi:
 * 1. Tự thân bệ phóng cắt địa hình theo DEM (SAM Organic Terrain Masking)
 * 2. Gộp dữ liệu vùng che khuất (vùng mù) của đài Radar chỉ thị (Radar Slaved Intersection)
 */

export interface SamCoverageConfig {
  /** Chiều cao bệ phóng / anten ngắm bắn AGL (m), mặc định 6m */
  launcherHeightAGL: number;
  /** Tầm bắn tối đa khí động học D_max (m) */
  dMaxM: number;
  /** Cự ly diệt mục tiêu cực cận D_min (m) */
  dMinM: number;
  /** Độ cao tối đa diệt mục tiêu H_max (m) */
  hMaxM: number;
  /** Độ cao tối thiểu diệt mục tiêu H_min (m) */
  hMinM: number;
  /** Độ cao mục tiêu bay đang đánh giá (m), mặc định 500m hoặc theo cấu hình */
  targetAltitudeM: number;
  /** Góc tà tối thiểu bệ phóng có thể xạ kích (độ) */
  minElevationDeg: number;
  /** Góc tà tối đa bệ phóng có thể xạ kích (độ) */
  maxElevationDeg: number;
  /** Hệ số khúc xạ khí quyển k (mặc định 1.33333 ~ 4/3) */
  kFactor: number;
  /** Bật/tắt tính toán độ cong Trái Đất */
  earthCurvature: boolean;
  /** Chế độ cắt địa hình: organic (tự thân) | linked_radar (theo radar) | intersection (gộp cả 2) */
  maskMode: 'organic' | 'linked_radar' | 'intersection';
  /** ID của đài radar chỉ thị mục tiêu liên kết (nếu có) */
  designatedRadarId?: string | null;
}

export interface SamCoverageResult {
  instanceId: string;
  cacheKey: string;
  centerLat: number;
  centerLon: number;
  groundElevationM: number;
  dMaxKm: number;
  dMinKm: number;
  maxEngagementAltitudeM: number;
  /**
   * Danh sách đỉnh đa giác bao quanh vùng hỏa lực sau khi cắt địa hình
   * (Đã gộp cả Điều kiện 1: Tự thân + Điều kiện 2: Radar chỉ thị)
   */
  polygonPositions: Array<{ lat: number; lon: number; alt: number }>;
  /**
   * Danh sách các điểm đường bao nón chết cực cận D_min (nếu có)
   */
  innerConePositions?: Array<{ lat: number; lon: number }>;
  /**
   * Cự ly hiệu dụng theo từng phương vị (360 hướng, 0° -> 359°) tính bằng mét
   */
  azimuthRanges: number[];
  /** ID của đài radar chỉ thị đang hiệp đồng */
  linkedRadarId: string | null;
  /** Tên của đài radar chỉ thị đang hiệp đồng */
  linkedRadarName?: string;
  /** Chế độ cắt địa hình thực tế */
  maskMode: 'organic' | 'linked_radar' | 'intersection';
  /** Tỷ lệ diện tích hiệu dụng còn lại so với hình tròn lý thuyết 100% (%) */
  coverageRatioPercent: number;
  /** Diện tích hiệu dụng thực tế sau cắt địa hình (km²) */
  effectiveAreaKm2: number;
  /** Diện tích lý thuyết tối đa pi * R^2 (km²) */
  nominalAreaKm2: number;
  /** Trạng thái DEM khi tính toán */
  terrainStatus: 'dem_loaded' | 'flat_fallback' | 'error';
  /** Thời điểm tính toán (epoch ms) */
  timestamp: number;
}
