/**
 * HỆ THỐNG MÔ HÌNH DETECTION VOLUME 3D CHO RADAR
 * Chuẩn hóa theo tài liệu chuyên ngành Radar và Kế hoạch cải tiến Vòm Radar 3D:
 * - Trục độ cao mục tiêu (Altitude Bands) × Trục phương vị (Azimuth Samples)
 * - Tách bạch trạng thái Danh nghĩa (Nominal) và Cắt theo địa hình thực (Terrain-aware)
 * - Single Source of Truth cho 3D Volume, Mặt cắt đứng và Mặt cắt ngang
 */

export type VolumeVisibilityState =
  | 'VISIBLE'          // Nằm trong envelope radar và không bị địa hình che
  | 'TERRAIN_LIMITED'  // Bị giới hạn/chắn bởi chướng ngại vật địa hình thực tế
  | 'OUTSIDE_ENVELOPE' // Nằm ngoài giản đồ búp sóng / trần quan sát của radar
  | 'NO_DATA';         // Chưa có dữ liệu địa hình hoặc tính toán chưa hoàn tất

export interface AltitudeBandInfo {
  altitudeM: number;
  nominalRangeKm: number;
  innerConeRadiusKm: number;
  averageEffectiveRangeKm: number;
  terrainLimitedPercent: number;
}

export interface RadarCoverageVolume {
  radarId: string;
  radarName: string;
  calculatedAt: number;
  cacheKey: string;
  radarLat: number;
  radarLon: number;
  radarAltM: number; // ASL (mặt đất) + AGL (tháp anten) tính bằng mét
  antennaHeightAGL: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  maxRangeKm: number;
  coverageHeightKm: number;

  // Trục 1: Mảng các tầng độ cao khảo sát (mét) [ví dụ: 100, 300, 500, 1000, 3000, 5000, 10000, 20000, 25000]
  altitudeBands: number[];

  // Trục 2: Mảng các góc phương vị lấy mẫu (độ) [0, 5, 10, ... 355]
  azimuthSamples: number[];

  // Ma trận cự ly danh nghĩa: nominalRanges[altIdx][azIdx] (mét)
  nominalRanges: number[][];

  // Ma trận cự ly hiệu dụng thực tế (đã cắt theo LOS địa hình DEM): effectiveRanges[altIdx][azIdx] (mét)
  effectiveRanges: number[][];

  // Bán kính nón mù đỉnh đầu theo từng tầng độ cao: innerConeRadii[altIdx] = H * cotg(eps_max) (mét)
  innerConeRadii: number[];

  // Ma trận trạng thái nhìn thấy: visibilityStates[altIdx][azIdx]
  visibilityStates: VolumeVisibilityState[][];

  // Thông tin tổng hợp từng tầng độ cao để UI Inspector hiển thị nhanh
  bandInfos: AltitudeBandInfo[];

  // Trạng thái địa hình và tính toán
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';
  calculationState: 'IDLE' | 'CALCULATING' | 'READY' | 'ERROR';

  // Thống kê chỉ số tác chiến
  totalSamples: number;
  terrainLimitedCount: number;
  coverageRatioPercent: number; // Tỷ lệ phủ sóng thực tế so với danh nghĩa (%)
}

export interface VolumeCalculationParams {
  azimuthStepDeg?: number;    // Bước phương vị (mặc định 5°)
  radialStepMeters?: number;  // Bước lấy mẫu cự ly DEM (mặc định 2000m)
  kFactor?: number;           // Hệ số khúc xạ khí quyển (chuẩn 4/3 ~ 1.3333)
  customAltitudeBands?: number[]; // Cho phép truyền danh sách tầng độ cao riêng
}

export interface VolumeMeshOptions {
  mode: 'nominal' | 'terrain-aware'; // Chế độ danh nghĩa hay cắt theo địa hình
  showInnerCone?: boolean;           // Dựng nón mù đỉnh đầu hay khép kín tâm
  showTopCap?: boolean;              // Đậy nắp trên ở trần độ cao H_max
  showBottomCap?: boolean;           // Đáy bám sát tầng độ cao thấp nhất
  selectedAltitudeM?: number | null; // Độ cao lát cắt ngang được chọn
}
