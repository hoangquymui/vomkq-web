/**
 * SPx Multi-Altitude Radar Coverage Types
 * Dựa trên chuẩn phần mềm SPx Radar Coverage của Cambridge Pixel
 * Phục vụ mô phỏng vùng phủ radar đa tầng độ cao, tính toán dựa trên DEM địa hình và độ cong Trái Đất.
 */

export interface SpxTargetHeightTier {
  id: string;
  heightMeters: number; // Độ cao mục tiêu (m)
  color: string; // Mã màu hex (e.g. #00e676, #ffd600, #ff9100, #ff1744)
  label: string; // Nhãn hiển thị (e.g. "500m", "800m", "1000m", "2000m")
  outlineColor?: string;
  fillOpacity?: number; // Độ trong suốt riêng nếu cần (0.1 - 1.0)
}

export type SpxAltitudeReference = 'sea_level' | 'ground';

export interface SpxRadarCoverageConfig {
  // Thông số vị trí và hình học anten
  radarHeightAGL: number; // Chiều cao anten so với mặt đất (m) - mặc định 40.0m
  startRangeM: number; // Cự ly bắt đầu khảo sát (m) - mặc định 0.0m
  endRangeM: number; // Cự ly tối đa khảo sát (m) - mặc định 50000.0m (50km)
  minElevationDeg: number; // Góc tà quét dưới (°) - mặc định -10.0°
  maxElevationDeg: number; // Góc tà quét trên (°) - mặc định 40.0°
  azimuthStartDeg: number; // Góc phương vị bắt đầu (°) - mặc định 0.0°
  azimuthEndDeg: number; // Góc phương vị kết thúc (°) - mặc định 360.0°

  // Môi trường vật lý
  earthCurvature: boolean; // Có tính độ cong Trái Đất không - mặc định true
  kFactor: number; // Hệ số khúc xạ chuẩn khí quyển (4/3 = 1.3333)

  // Cấu hình tầng độ cao mục tiêu
  altitudeReference: SpxAltitudeReference; // 'sea_level' (MSL) hoặc 'ground' (AGL)
  targetHeights: SpxTargetHeightTier[];

  // Hiển thị trực quan
  coverageTransparency: number; // Độ trong suốt vùng phủ (0.1 -> 1.0) - mặc định 0.45
  showRangeRings: boolean; // Hiển thị các vòng tròn cự ly đồng tâm - mặc định true
  rangeRingIntervalM: number; // Khoảng cách giữa các vòng cự ly (m) - mặc định 5000m
  showBoundaryLine: boolean; // Hiển thị đường viền đỏ ngoài cùng - mặc định true
  boundaryColor: string; // Màu đường viền ngoài cùng - mặc định #ef4444 (Đỏ)
}

export interface SpxCoverageContour {
  tier: SpxTargetHeightTier;
  // Danh sách toạ độ biên dạng đa giác của tầng này
  polygonPositions: Array<{ lat: number; lon: number; alt: number }>;
  // Cự ly trung bình hoặc cự ly xa nhất phát hiện được
  maxObservedRangeM: number;
  coverageAreaKm2: number;
}

export interface SpxRangeRing {
  rangeM: number;
  label: string;
  positions: Array<{ lat: number; lon: number }>;
  labelPosition: { lat: number; lon: number };
}

export interface SpxCoverageResult {
  instanceId: string;
  calculatedAt: number;
  cacheKey: string;
  radarLat: number;
  radarLon: number;
  groundElevationM: number; // Độ cao mặt đất tại vị trí đài lấy từ DEM
  totalAntennaElevationM: number; // Cao độ tuyệt đối của anten (MSL = ground + AGL)
  config: SpxRadarCoverageConfig;

  // Danh sách các dải màu vùng phủ (sắp xếp từ tầng cao nhất đến tầng thấp nhất)
  contours: SpxCoverageContour[];

  // Các vòng tròn cự ly đồng tâm
  rangeRings: SpxRangeRing[];

  // Trạng thái lấy mẫu địa hình
  terrainStatus: 'dem_loaded' | 'flat_fallback' | 'error';
}

/**
 * 4 Tầng độ cao mục tiêu chuẩn theo phần mềm SPx của Cambridge Pixel
 */
export const DEFAULT_SPX_TARGET_HEIGHTS: SpxTargetHeightTier[] = [
  {
    id: 'tier_500',
    heightMeters: 500,
    color: '#00e676', // Xanh lục tươi
    label: '500m',
    outlineColor: '#00c853',
  },
  {
    id: 'tier_800',
    heightMeters: 800,
    color: '#ffd600', // Vàng
    label: '800m',
    outlineColor: '#ffab00',
  },
  {
    id: 'tier_1000',
    heightMeters: 1000,
    color: '#ff9100', // Cam
    label: '1000m',
    outlineColor: '#ff6d00',
  },
  {
    id: 'tier_2000',
    heightMeters: 2000,
    color: '#ff1744', // Đỏ
    label: '2000m',
    outlineColor: '#d50000',
  },
];

/**
 * Cấu hình SPx mặc định chuẩn
 */
export const DEFAULT_SPX_CONFIG: SpxRadarCoverageConfig = {
  radarHeightAGL: 40.0, // 40m như trong ảnh SPx
  startRangeM: 0.0,
  endRangeM: 50000.0, // 50.000m (50km)
  minElevationDeg: -10.0, // -10 độ
  maxElevationDeg: 40.0, // 40 độ
  azimuthStartDeg: 0.0,
  azimuthEndDeg: 360.0,
  earthCurvature: true,
  kFactor: 4 / 3, // Mô hình 4/3 chuẩn
  altitudeReference: 'sea_level',
  targetHeights: DEFAULT_SPX_TARGET_HEIGHTS,
  coverageTransparency: 0.45,
  showRangeRings: true,
  rangeRingIntervalM: 5000.0, // Vòng cự ly mỗi 5km
  showBoundaryLine: true,
  boundaryColor: '#ef4444',
};
