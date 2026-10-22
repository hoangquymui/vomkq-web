/**
 * NHẬN THỨC ĐỐI TƯỢNG VÙNG PHỦ (SITE PROFILE)
 * ==========================================
 *
 * ĐÂY LÀ FILE TRẢ LỜI TRỰC TIẾP CÂU HỎI:
 *   "Khi đặt khí tài xuống, nó có thể phân biệt trong phạm vi hoạt động của nó biết được
 *    nhà, sông, suối, núi ở đâu cách bao xa so với khí tài không?"
 *
 * Câu trả lời: ĐƯỢC, nhờ 3 nguồn dữ liệu độc lập được hợp nhất ở đây:
 *   1. Ảnh raster (đã có)          -> CHỈ để người nhìn, máy không đọc được nội dung.
 *   2. Terrain quantized-mesh (đã có) -> cao độ THẬT: biết núi/đồi/độ dốc ở đâu.
 *   3. Lớp vectơ OSM (Phase 1-2)   -> nhãn của từng đối tượng: nhà, sông, suối, đường, rừng.
 *
 * Hàm `buildSiteProfile()` gộp 3 nguồn lại và trả về một "bản đặc tính" có cấu trúc,
 * kèm trường `text` là bản tóm tắt tiếng Việt để nhét thẳng vào prompt AI.
 *
 * RÀNG BUỘC THIẾT KẾ: bán kính phân tích LUÔN bằng tầm hoạt động của khí tài
 * (`template.defaultRangeKm`), nên "trong phạm vi hoạt động" là điều kiện bắt buộc
 * của mọi phép đếm, không phải tuỳ chọn.
 */

import * as Cesium from 'cesium';
import type { VectorFeature, VectorFeatureKind } from '../types/vectorFeature';
import { VECTOR_KIND_LABELS } from '../types/vectorFeature';
import { loadVectorFeatureStore, queryFeaturesInRadius, type VectorFeatureStore } from '../services/vectorFeatureStore';
import { getOfflineTerrainProvider } from '../services/offlineTerrainProvider';
import { sampleTerrainOptimized } from './terrainSampler';
import {
  distanceToGeometryKm,
  geometryAreaKm2,
  geometryLengthKm,
  type LatLon,
} from './vectorGeometry';

/** Bán kính Trái Đất (m) — dùng cho chuẩn hoá cao độ và góc dốc. */
const EARTH_RADIUS_M = 6_371_000;

/** Số vòng xung quanh tâm khi lấy mẫu địa hình. 8 x 24 = 192 điểm + tâm. */
const TERRAIN_RINGS = 8;

/** Số hướng trên mỗi vòng. */
const TERRAIN_DIRECTIONS = 24;

/** Bán kính lấy mẫu địa hình tối đa (m) — trùng bán kính khí tài. */
const TERRAIN_SAMPLE_MAX_M = 150_000;

/** Ngưỡng coi là "dữ liệu mỏng" (feature/km²) — để UI cảnh báo thay vì báo 0. */
const SPARSE_DATA_THRESHOLD_PER_KM2 = 0.5;

/**
 * MỘT MẪU ĐỊA HÌNH TẠI MỘT HƯỚNG
 *
 * VÌ SAO TÁCH RIÊNG: trước đây `sampleTerrainHeights()` trả về mảng phẳng 193 số
 * rồi `buildTerrainAwareness()` gom thành 6 con số tổng hợp (min/max/mean/slope...)
 * và **vứt bỏ toàn bộ 192 mẫu còn lại**. Nhưng đó mới là dữ liệu quý nhất để vẽ
 * "hướng nào thông thoáng, hướng nào bị núi chắn" — thứ quyết định vị trí đặt đài.
 * Giữ lại từng mẫu kèm hướng của nó thì vẽ được biểu đồ cánh hoa mà KHÔNG phải
 * gọi lại `Cesium.sampleTerrain` (tốn thêm một vòng I/O terrain).
 */
export interface TerrainSample {
  /** Phương vị từ tâm, độ [0, 360). 0 = bắc, tăng theo chiều kim đồng hồ. */
  bearingDeg: number;
  /** Cự ly ngang từ tâm tới mẫu (m) — dùng làm MẪU SỐ của độ dốc. */
  distanceM: number;
  /** Cao độ tại mẫu (m). */
  elevationM: number;
  /** Độ dốc tại mẫu (độ), tính bằng `atan2(|cao độ - cao độ tâm|, cự ly ngang)`. */
  slopeDeg: number;
}

/**
 * MỘT VÒNG MẪU ĐỊA HÌNH
 *
 * Vì sao gom theo vòng: người dùng nhìn bản đồ theo "vòng tròn quanh đài" (cự ly),
 * nên dữ liệu cũng nên tổ chức theo cự ly để UI vẽ đúng hình học đó.
 */
export interface TerrainProfileRing {
  /** Số thứ tự vòng, 1..TERRAIN_RINGS. */
  ring: number;
  /** Bán kính vòng (m). */
  radiusM: number;
  /** Các mẫu theo phương vị tăng dần, độ dài luôn bằng TERRAIN_DIRECTIONS. */
  samples: TerrainSample[];
  /** Cao độ thấp nhất trong vòng (m). */
  minElevationM: number;
  /** Cao độ cao nhất trong vòng (m). */
  maxElevationM: number;
}

/**
 * ĐỐI TƯỢNG GẦN NHẤT KÈM TOẠ ĐỘ ĐỂ VẼ
 *
 * `TerrainAwareness.nearestPeak` và 7 trường `nearest*Km` của `VectorAwareness`
 * đã chứa cự ly nhưng chỉ là số. Muốn vẽ đường nối lên bản đồ thì cần toạ độ,
 * nên gom tất cả về một kiểu chung thay vì rải rác 8 chỗ.
 */
export interface NearestPointRef {
  /** Khoá định danh để UI tra lại, ví dụ 'building', 'river', 'peak'. */
  key: string;
  /** Nhãn tiếng Việt hiển thị trên bản đồ. */
  labelVi: string;
  /** Cự ly từ tâm (km). */
  distanceKm: number;
  /** Toạ độ điểm gần nhất — để vẽ đường nối. */
  lat: number;
  lon: number;
}

/** Thông tin về đối tượng gần nhất tìm được trong bán kính. */
export interface NearestFeatureInfo {
  kind: VectorFeatureKind;
  labelVi: string;
  name?: string;
  distanceKm: number;
  /** Vị trí trên đối tượng gần nhất - dùng để vẽ đường nối và nhãn cự ly. */
  nearestLat: number;
  nearestLon: number;
}

/** Chỉ số địa hình, lấy từ Cesium terrain (cao độ thật, không phải ảnh). */
export interface TerrainAwareness {
  /** Cao độ tại chính vị trí khí tài (m). */
  elevationAtCenterM: number;
  minM: number;
  maxM: number;
  meanM: number;
  /** Chênh lệch cao độ lớn nhất trong bán kính (m) - đại lượng "độ nhô" của vùng. */
  reliefM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  /** Độ gồ ghề chuẩn hoá 0..1 (độ lệch chuẩn cao độ / biên độ). */
  roughness: number;
  /** Số đỉnh núi trong bán kính (từ lớp vectơ `peak`). */
  peakCount: number;
  /** Số sườn núi trong bán kính (từ lớp vectơ `ridge`). */
  ridgeCount: number;
  nearestPeak: NearestFeatureInfo | null;
  /** true nếu đã lấy được mẫu cao độ từ terrain. */
  hasTerrainData: boolean;
}

/** Chỉ số đối tượng vùng phủ, lấy từ lớp vectơ OSM. */
export interface VectorAwareness {
  // --- Nhà / công trình ---
  buildingCount: number;
  buildingAreaKm2: number;
  /** Mật độ nhà trên km² - chỉ số "đô thị hay nông thôn". */
  buildingDensityPerKm2: number;
  /** Cự ly tới ngôi nhà gần nhất (km). null = không có nhà nào trong bán kính. */
  nearestBuildingKm: number | null;

  // --- Nước: sông, suối, hồ ---
  riverCount: number;
  riverLengthKm: number;
  nearestRiverKm: number | null;
  streamCount: number;
  streamLengthKm: number;
  nearestStreamKm: number | null;
  waterBodyCount: number;
  waterBodyAreaKm2: number;
  nearestWaterBodyKm: number | null;

  // --- Giao thông ---
  roadCount: number;
  roadLengthKm: number;
  nearestHighwayKm: number | null;

  // --- Rừng ---
  forestCount: number;
  forestAreaKm2: number;
  /** Tỷ lệ diện tích rừng / diện tích vùng phủ (0..1). */
  forestRatio: number;
  nearestForestKm: number | null;

  // --- Loại đất & địa danh ---
  landAreaKm2: number;
  landUseRatio: Record<string, number>;
  placeNames: string[];
  nearestPlaceKm: number | null;

  /** true nếu đã nạp được lớp vectơ (false = ứng dụng đang chỉ có ảnh raster). */
  hasVectorData: boolean;
  /** Cảnh báo khi dữ liệu quá mỏng để kết luận - quan trọng ở vùng nông thôn VN. */
  isSparse: boolean;
  /** Tên các vùng đã tải (để biết dữ liệu phủ tới đâu). */
  coveredRegions: string[];
}

/** Bản đặc tính đầy đủ của 1 vị trí khí tài trong tầm hoạt động của nó. */
export interface SiteProfile {
  center: LatLon;
  radiusKm: number;
  /** Diện tích vùng phủ (km²) - dùng làm mẫu số cho mọi tỷ lệ. */
  areaKm2: number;
  terrain: TerrainAwareness;
  features: VectorAwareness;
  /**
   * Các vòng mẫu địa hình, đã tách hướng + cự ly + cao độ + độ dốc từng mẫu.
   *
   * Rỗng khi không có terrain. Dữ liệu này được tái sắp xếp từ đúng mảng 193 phần
   * tử mà `sampleTerrainHeights()` đã trả về — KHÔNG gọi lại `Cesium.sampleTerrain`.
   */
  terrainRings: TerrainProfileRing[];
  /**
   * Toàn bộ đối tượng gần nhất, gộp từ `terrain.nearestPeak` và các trường
   * `nearest*Km` của `features`. Mục đích: UI vẽ được đường nối tâm đài → đối
   * tượng mà không phải tra lại từng trường rời rạc.
   */
  nearestPoints: NearestPointRef[];
  /**
   * Bản tóm tắt tiếng Việt (~15 dòng) để nhét vào prompt AI.
   * Rỗng nếu không có cả terrain lẫn vectơ.
   */
  text: string;
}

/** Kết quả truy vấn 1 feature kèm cự ly thật. */
export interface NearbyFeature {
  feature: VectorFeature;
  distanceKm: number;
  /** true nếu điểm khí tài nằm BÊN TRONG vùng của feature (cự ly = 0). */
  inside: boolean;
  /** Điểm gần nhất trên hình học - để vẽ đường nối. */
  nearest: LatLon | null;
}

// ---------------------------------------------------------------------------
// TRUY VẤN CỰ LY THẬT
// ---------------------------------------------------------------------------

/**
 * Tìm tất cả feature trong bán kính, kèm CỰ LY THẬT tới hình học, sắp xếp từ gần tới xa.
 *
 * Đây là hàm cốt lõi: nó phân biệt được "cái này nằm ở đâu" với "cái này CÁCH BAO XA".
 * Với nhà/rừng (đa giác) nó dùng point-in-polygon nên nếu khí tài đặt bên trong vùng
 * thì cự ly = 0, đúng nghĩa vật lý.
 *
 * @param store kho vectơ; truyền null = không có dữ liệu vectơ, trả về mảng rỗng
 * @param lat vĩ độ tâm
 * @param lon kinh độ tâm
 * @param radiusKm bán kính (thường là tầm hoạt động của khí tài)
 * @param kinds chỉ lấy các loại này; bỏ trống = lấy tất cả
 * @param limit giới hạn số kết quả (mặc định không giới hạn)
 */
export function queryFeaturesNear(
  store: VectorFeatureStore | null,
  lat: number,
  lon: number,
  radiusKm: number,
  kinds?: readonly VectorFeatureKind[],
  limit?: number
): NearbyFeature[] {
  if (!store || !Number.isFinite(lat) || !Number.isFinite(lon) || !(radiusKm > 0)) return [];

  // Bước 1: lọc ứng viên bằng chỉ mục lưới + bounding box (rất nhanh)
  const candidates = queryFeaturesInRadius(store, lat, lon, radiusKm, kinds);
  if (candidates.length === 0) return [];

  // Bước 2: tính cự ly thật tới hình học (chỉ cho ứng viên vượt bbox)
  const center: LatLon = { lat, lon };
  const results: NearbyFeature[] = [];

  for (const feature of candidates) {
    const { distanceKm, nearest } = distanceToGeometryKm(center, feature.geometry);
    if (!(distanceKm <= radiusKm)) continue;

    results.push({
      feature,
      distanceKm,
      inside: distanceKm === 0,
      nearest,
    });
  }

  results.sort((a, b) => a.distanceKm - b.distanceKm);

  return typeof limit === 'number' && limit > 0 ? results.slice(0, limit) : results;
}

// ---------------------------------------------------------------------------
// LẤY MẪU ĐỊA HÌNH
// ---------------------------------------------------------------------------

/**
 * Lấy mẫu cao độ thật trong bán kính bằng Cesium terrain.
 *
 * Lưới lấy mẫu: vài vòng đồng tâm, mỗi vòng chia đều theo phương vị. Cách này mẫu
 * đều hơn lưới vuông ở vùng hình tròn, và tránh dồn mẫu vào 4 góc.
 *
 * @returns mảng cao độ (m) theo thứ tự lấy mẫu; mảng rỗng nếu không có terrain
 */
export async function sampleTerrainHeights(
  terrainProvider: Cesium.TerrainProvider | null,
  lat: number,
  lon: number,
  radiusKm: number
): Promise<number[]> {
  if (!terrainProvider || terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return [];

  // Kiểm tra availability nếu có: nếu cấp khả dụng tại tâm < 2 tức là ngoài vùng gói địa hình offline
  const providerWithAvail = terrainProvider as unknown as {
    availability?: {
      computeMaximumLevelAtPosition?: (cartographic: Cesium.Cartographic) => number;
    };
  };
  if (
    providerWithAvail.availability &&
    typeof providerWithAvail.availability.computeMaximumLevelAtPosition === 'function'
  ) {
    const centerCarto = Cesium.Cartographic.fromDegrees(lon, lat);
    const maxAvail = providerWithAvail.availability.computeMaximumLevelAtPosition(centerCarto);
    if (typeof maxAvail === 'number' && maxAvail < 2) {
      return [];
    }
  }

  const sampleRadiusM = Math.min(radiusKm * 1000, TERRAIN_SAMPLE_MAX_M);
  // `Cesium.sampleTerrain` nhận mảng Cartographic (không phải Cartesian3) và ghi
  // kết quả cao độ ngược lại vào chính các đối tượng đó qua thuộc tính `height`.
  const positions: Cesium.Cartographic[] = [
    Cesium.Cartographic.fromDegrees(lon, lat),
  ];

  for (let ring = 1; ring <= TERRAIN_RINGS; ring++) {
    const ringRadiusM = (sampleRadiusM * ring) / TERRAIN_RINGS;
    for (let dir = 0; dir < TERRAIN_DIRECTIONS; dir++) {
      const bearing = (dir * 360) / TERRAIN_DIRECTIONS;
      const rad = (bearing * Math.PI) / 180;
      const dLat = ((ringRadiusM * Math.cos(rad)) / EARTH_RADIUS_M) * (180 / Math.PI);
      const dLon =
        ((ringRadiusM * Math.sin(rad)) / (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180))) *
        (180 / Math.PI);
      positions.push(Cesium.Cartographic.fromDegrees(lon + dLon, lat + dLat));
    }
  }

  try {
    const heights = await sampleTerrainOptimized(
      terrainProvider,
      lon,
      lat,
      positions,
      10,
      1500
    );
    return heights;
  } catch (error) {
    console.warn('Không lấy được mẫu cao độ terrain; bỏ qua phần địa hình.', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ô NHỚ MODULE: TERRAIN PROVIDER
// ---------------------------------------------------------------------------
// `useTacticalStore.ts` là module thuần, không import Cesium (tránh ràng buộc & tròn import).
// Nên CesiumGlobe ghi provider vào đây mỗi khi terrain sẵn sàng - đúng pattern mà
// `aiPlacementAdvisor.ts` đang dùng cho `setAdvisorViewport()`.

let terrainProviderRef: Cesium.TerrainProvider | null = null;

/** Ghi terrain provider hiện tại vào ô nhớ module (gọi từ CesiumGlobe). */
export function setTerrainProvider(provider: Cesium.TerrainProvider | null): void {
  terrainProviderRef = provider;
}

/** Đọc terrain provider đã ghi (null nếu chưa nạp xong hoặc không có gói địa hình). */
export function getTerrainProvider(): Cesium.TerrainProvider | null {
  return terrainProviderRef;
}

/** Đảm bảo terrain provider đã sẵn sàng: nếu ô nhớ chưa có, nạp từ getOfflineTerrainProvider(). */
export async function ensureTerrainProvider(): Promise<Cesium.TerrainProvider | null> {
  if (terrainProviderRef && !(terrainProviderRef instanceof Cesium.EllipsoidTerrainProvider)) {
    return terrainProviderRef;
  }
  try {
    const provider = await getOfflineTerrainProvider();
    terrainProviderRef = provider;
    return provider;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TÍNH TOÁN ĐẶC TÍNH
// ---------------------------------------------------------------------------

/** Tính đặc tính địa hình từ mẫu cao độ đã lấy. */
function buildTerrainAwareness(
  heights: number[],
  centerElevationM: number,
  sampleRadiusKm: number
): TerrainAwareness {
  const empty: TerrainAwareness = {
    elevationAtCenterM: centerElevationM,
    minM: 0,
    maxM: 0,
    meanM: 0,
    reliefM: 0,
    maxSlopeDeg: 0,
    meanSlopeDeg: 0,
    roughness: 0,
    peakCount: 0,
    ridgeCount: 0,
    nearestPeak: null,
    hasTerrainData: false,
  };
  if (heights.length === 0) return empty;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let validCount = 0;
  for (const h of heights) {
    if (!Number.isFinite(h)) continue;
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
    validCount++;
  }
  if (min === Infinity || validCount === 0) return empty;

  const mean = sum / validCount;
  const relief = max - min;

  // Độ dốc: so sánh từng mẫu với mẫu tâm, chuẩn hoá theo cự ly tương ứng.
  // Dùng bán kính từ tâm tới vòng của mẫu để suy ra cự ly ngang.
  const slopes: number[] = [];
  const ringStepM = (sampleRadiusKm * 1000) / TERRAIN_RINGS;

  for (let ring = 1; ring <= TERRAIN_RINGS; ring++) {
    const ringRadiusM = ringStepM * ring;
    for (let dir = 0; dir < TERRAIN_DIRECTIONS; dir++) {
      const index = 1 + (ring - 1) * TERRAIN_DIRECTIONS + dir;
      const h = heights[index];
      if (!Number.isFinite(h)) continue;
      const rise = Math.abs(h - centerElevationM);
      const slope = Math.atan2(rise, ringRadiusM) * (180 / Math.PI);
      slopes.push(slope);
    }
  }

  const maxSlope = slopes.length > 0 ? Math.max(...slopes) : 0;
  const meanSlope = slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : 0;

  // Độ gồ ghề: độ lệch chuẩn cao độ chia cho biên độ -> 0 (đồng bằng) tới 1 (gồ ghề)
  const validHeights = heights.filter(Number.isFinite);
  const variance =
    validHeights.length > 0
      ? validHeights.reduce((s, h) => s + (h - mean) ** 2, 0) / validHeights.length
      : 0;
  const stddev = Math.sqrt(variance);
  const roughness = relief > 0 ? Math.min(1, stddev / relief) : 0;

  return {
    elevationAtCenterM: Math.round(centerElevationM),
    minM: Math.round(min),
    maxM: Math.round(max),
    meanM: Math.round(mean),
    reliefM: Math.round(relief),
    maxSlopeDeg: Number(maxSlope.toFixed(1)),
    meanSlopeDeg: Number(meanSlope.toFixed(1)),
    roughness: Number(roughness.toFixed(3)),
    peakCount: 0,
    ridgeCount: 0,
    nearestPeak: null,
    hasTerrainData: true,
  };
}

/**
 * TÁI SẮP XẾP MẢNG CAO ĐỘ PHẲNG THÀNH CÁC VÒNG MẪU
 *
 * VÌ SAO CẦN HÀM NÀY: `sampleTerrainHeights()` trả về mảng phẳng theo thứ tự
 * `index = 1 + (ring-1)*TERRAIN_DIRECTIONS + dir` (tâm ở index 0). Hàm này bóc
 * mảng đó thành từng vòng, mỗi vòng mang theo hướng và cự ly của từng mẫu — để
 * UI có thể vẽ biểu đồ hình học đúng với bản đồ mà KHÔNG phải gọi lại terrain.
 *
 * CÔNG THỨC ĐỘ DỐC CỐ Ý GIỮ NGUYÊN so với `buildTerrainAwareness`:
 * `atan2(|cao độ mẫu - cao độ tâm|, cự ly ngang)`. Dùng cự ly NGANG (không phải
 * khoảng cách 3D) vì đó là hình học mà người dùng nhìn trên bản đồ phẳng ngang.
 * Nếu đổi công thức ở đây mà không đổi ở kia, biểu đồ sẽ mâu thuẫn với dòng
 * "Độ dốc" đang hiển thị — đây là lý do phải giữ một nguồn sự thật duy nhất.
 *
 * EXPORT để `docs/verify-site-profile.ts` kiểm chứng bằng mảng cao độ giả lập:
 * hàm này thuần tuý (không đụng Cesium) nên test được ngay cả khi máy không có
 * gói terrain offline — nếu giữ private thì vùng nào cũng chỉ test được khi có
 * terrain thật, tức là gần như không test được gì.
 */
export function buildTerrainRings(
  heights: number[],
  centerElevationM: number,
  sampleRadiusKm: number
): TerrainProfileRing[] {
  if (heights.length === 0) return [];

  const sampleRadiusM = Math.min(sampleRadiusKm * 1000, TERRAIN_SAMPLE_MAX_M);
  const ringStepM = sampleRadiusM / TERRAIN_RINGS;
  const rings: TerrainProfileRing[] = [];

  for (let ring = 1; ring <= TERRAIN_RINGS; ring++) {
    const ringRadiusM = ringStepM * ring;
    const samples: TerrainSample[] = [];
    let min = Infinity;
    let max = -Infinity;

    for (let dir = 0; dir < TERRAIN_DIRECTIONS; dir++) {
      const index = 1 + (ring - 1) * TERRAIN_DIRECTIONS + dir;
      const h = heights[index];
      if (!Number.isFinite(h)) continue;

      if (h < min) min = h;
      if (h > max) max = h;

      // Phương vị: `sampleTerrainHeights` dùng bearing đo từ BẮC theo chiều
      // kim đồng hồ (dLat theo cos, dLon theo sin) — giữ đúng quy ước đó để
      // hướng Bắc của biểu đồ khớp hướng Bắc của bản đồ.
      const bearingDeg = (dir * 360) / TERRAIN_DIRECTIONS;
      const rise = Math.abs(h - centerElevationM);
      const slopeDeg = (Math.atan2(rise, ringRadiusM) * 180) / Math.PI;

      samples.push({
        bearingDeg,
        distanceM: Math.round(ringRadiusM),
        elevationM: Math.round(h),
        slopeDeg: Number(slopeDeg.toFixed(1)),
      });
    }

    // Vòng không có mẫu hợp lệ (terrain rỗng ở hướng đó) thì bỏ qua thay vì
    // đẩy vào UI một vòng rỗng làm biểu đồ méo.
    if (samples.length === 0) continue;

    rings.push({
      ring,
      radiusM: Math.round(ringRadiusM),
      samples,
      minElevationM: Math.round(min === Infinity ? centerElevationM : min),
      maxElevationM: Math.round(max === -Infinity ? centerElevationM : max),
    });
  }

  return rings;
}

/** Gom thống kê từ danh sách feature đã tính cự ly. */
function buildVectorAwareness(
  nearby: NearbyFeature[],
  areaKm2: number,
  packs: VectorPackRegionInfo[]
): { awareness: VectorAwareness; nearestPoints: NearestPointRef[] } {
  const counts: Record<string, number> = {};
  const lengths: Record<string, number> = {};
  const areas: Record<string, number> = {};
  const nearestKm: Record<string, number> = {};
  /**
   * Toạ độ điểm gần nhất theo từng loại.
   *
   * VÌ SAO CẦN BẢNG RIÊNG: `nearestKm` chỉ giữ CỰ LY nên thông tin "gần nhất ở
   * đâu" bị mất. UI cần toạ độ để vẽ đường nối tâm đài → đối tượng. Ghi kèm
   * ngay lúc duyệt nên không phải quét lại `nearby` (vốn có thể vài chục nghìn
   * phần tử) ở bước dựng hồ sơ.
   */
  const nearestPoint: Record<string, LatLon> = {};
  const landUseRatio: Record<string, number> = {};
  const placeNames: string[] = [];

  for (const item of nearby) {
    const kind = item.feature.kind;
    counts[kind] = (counts[kind] || 0) + 1;

    if (item.feature.geometry.type === 'LineString') {
      lengths[kind] = (lengths[kind] || 0) + geometryLengthKm(item.feature.geometry);
    } else if (item.feature.geometry.type === 'Polygon') {
      areas[kind] = (areas[kind] || 0) + geometryAreaKm2(item.feature.geometry);
    }

    if (item.distanceKm < (nearestKm[kind] ?? Infinity)) {
      nearestKm[kind] = item.distanceKm;
      // Chỉ ghi khi tìm thấy điểm hình học thật; `inside = true` thì `nearest`
      // vẫn là toạ độ trên ranh giới đối tượng nên vẽ đường nối vẫn hợp lý.
      if (item.nearest) nearestPoint[kind] = item.nearest;
    }

    if (kind === 'place' && item.feature.properties.name) {
      placeNames.push(item.feature.properties.name);
    }
    if (kind === 'land' && item.feature.properties.landuse) {
      landUseRatio[item.feature.properties.landuse] =
        (landUseRatio[item.feature.properties.landuse] || 0) + geometryAreaKm2(item.feature.geometry);
    }
  }

  const buildingArea = areas.building ?? 0;
  const forestArea = areas.forest ?? 0;
  const landArea = Object.values(landUseRatio).reduce((s, v) => s + v, 0);

  // Chuẩn hoá tỷ lệ sử dụng đất về 0..1
  for (const key of Object.keys(landUseRatio)) {
    if (landArea > 0) landUseRatio[key] = Number((landUseRatio[key] / landArea).toFixed(3));
  }

  const totalCount = nearby.length;
  const isSparse = areaKm2 > 0 && totalCount / areaKm2 < SPARSE_DATA_THRESHOLD_PER_KM2;

  const round = (v: number | undefined, digits = 2) =>
    v === undefined ? 0 : Number(v.toFixed(digits));
  const roundKm = (v: number | undefined) => (v === undefined ? null : Number(v.toFixed(2)));

  const awareness: VectorAwareness = {
    buildingCount: counts.building ?? 0,
    buildingAreaKm2: round(buildingArea),
    // Mật độ = SỐ công trình trên km² (công trình/km²), KHÔNG phải diện tích chia vùng.
    // Lý do: các ngưỡng diễn giải trong `describeSettlement` được thiết kế theo đơn vị
    // này, và nếu dùng diện tích thì một vùng có 54 ngôi nhà nhỏ sẽ ra 0.27 km² -> làm
    // tròn thành 0 và mất hoàn toàn thông tin mật độ.
    buildingDensityPerKm2: areaKm2 > 0 ? round((counts.building ?? 0) / areaKm2, 2) : 0,
    nearestBuildingKm: roundKm(nearestKm.building),

    riverCount: counts.water_river ?? 0,
    riverLengthKm: round(lengths.water_river),
    nearestRiverKm: roundKm(nearestKm.water_river),
    streamCount: counts.water_stream ?? 0,
    streamLengthKm: round(lengths.water_stream),
    nearestStreamKm: roundKm(nearestKm.water_stream),
    waterBodyCount: counts.water_body ?? 0,
    waterBodyAreaKm2: round(areas.water_body),
    nearestWaterBodyKm: roundKm(nearestKm.water_body),

    roadCount: counts.highway ?? 0,
    roadLengthKm: round(lengths.highway),
    nearestHighwayKm: roundKm(nearestKm.highway),

    forestCount: counts.forest ?? 0,
    forestAreaKm2: round(forestArea),
    // Tỷ lệ rừng KẸP ở 1.0. Các polygon `natural=wood` / `landuse=forest` trong OSM
    // thường chồng lấn nhau (một thửa rừng được vẽ bởi cả 2 tag, hoặc các thửa liền
    // kề có chung ranh giới), nên tổng diện tích thô có thể vượt diện tích vùng.
    // Kẹp ở 1 giữ cho con số có nghĩa "chiếm bao nhiêu phần trăm vùng".
    forestRatio:
      areaKm2 > 0 ? Number(Math.min(1, forestArea / areaKm2).toFixed(3)) : 0,
    nearestForestKm: roundKm(nearestKm.forest),

    landAreaKm2: round(landArea),
    landUseRatio,
    placeNames: placeNames.slice(0, 12),
    nearestPlaceKm: roundKm(nearestKm.place),

    hasVectorData: totalCount > 0,
    isSparse,
    coveredRegions: packs.map((p) => p.regionKey),
  };

  // Đổi bảng toạ độ rời thành mảng có nhãn để UI vẽ thẳng lên bản đồ.
  // Chỉ giữ loại THỰC SỰ có điểm gần nhất — nếu không, UI sẽ vẽ đường nối về
  // toạ độ 0,0 ngoài Việt Nam và người dùng tưởng bản đồ hỏng.
  const labels: Record<string, string> = {
    building: 'Nhà cửa',
    water_river: 'Sông',
    water_stream: 'Suối',
    water_body: 'Hồ',
    highway: 'Đường',
    forest: 'Rừng',
    place: 'Địa danh',
  };
  const nearestPoints: NearestPointRef[] = [];
  for (const [key, latLon] of Object.entries(nearestPoint)) {
    const labelVi = labels[key];
    const distanceKm = nearestKm[key];
    if (!labelVi || distanceKm === undefined) continue;
    nearestPoints.push({
      key,
      labelVi,
      distanceKm: Number(distanceKm.toFixed(2)),
      lat: latLon.lat,
      lon: latLon.lon,
    });
  }
  // Sắp xếp gần → xa: UI vẽ nhãn theo thứ tự này nên loại xa nhất không bị che
  // bởi loại gần, và người dùng đọc được chuỗi cự ly tăng dần.
  nearestPoints.sort((a, b) => a.distanceKm - b.distanceKm);

  return { awareness, nearestPoints };
}

/** Thông tin tối thiểu về vùng đã tải, dùng để báo "dữ liệu phủ tới đâu". */
export interface VectorPackRegionInfo {
  regionKey: string;
  name: string;
  radiusKm: number;
}

/**
 * DỰNG ĐẶC TÍNH VÙNG PHỦ CHO 1 VỊ TRÍ KHÍ TÀI
 * =================================================
 *
 * Đây là hàm chính của cả tính năng. Trả về bảng đặc tính đầy đủ cho vùng có bán kính
 * `radiusKm` (thường là tầm hoạt động của khí tài).
 *
 * @param lat vĩ độ vị trí khí tài
 * @param lon kinh độ vị trí khí tài
 * @param radiusKm bán kính phân tích (km) - dùng tầm hoạt động khí tài
 * @param terrainProvider provider Cesium; null = bỏ qua phần địa hình
 * @param store kho vectơ; null = sẽ tự nạp (hoặc bỏ qua nếu chưa có gói)
 */
export async function buildSiteProfile(
  lat: number,
  lon: number,
  radiusKm: number,
  terrainProvider?: Cesium.TerrainProvider | null,
  store?: VectorFeatureStore | null
): Promise<SiteProfile> {
  const safeRadius = Math.max(1, Math.min(400, radiusKm || 35));
  const areaKm2 = Number((Math.PI * safeRadius * safeRadius).toFixed(2));
  const center: LatLon = { lat, lon };

  // --- Nguồn 2: địa hình ---
  let provider: Cesium.TerrainProvider | null = null;
  if (terrainProvider !== null) {
    provider = terrainProvider ?? terrainProviderRef;
    if (!provider || provider instanceof Cesium.EllipsoidTerrainProvider) {
      if (terrainProvider === undefined) {
        provider = await ensureTerrainProvider();
      }
    }
  }
  const heights = await sampleTerrainHeights(provider, lat, lon, safeRadius);
  const terrain = buildTerrainAwareness(heights, heights[0] ?? 0, safeRadius);

  // --- Nguồn 3: vectơ ---
  const vectorStore = store ?? (await loadVectorFeatureStore());
  const nearby = queryFeaturesNear(vectorStore, lat, lon, safeRadius);
  const packs: VectorPackRegionInfo[] =
    vectorStore?.packs.map((p) => ({
      regionKey: p.info.regionKey,
      name: p.info.name,
      radiusKm: p.info.radiusKm,
    })) ?? [];

  const vectorResult = buildVectorAwareness(nearby, areaKm2, packs);
  const features = vectorResult.awareness;

  // Bổ sung số đỉnh/sườn núi & đỉnh núi gần nhất từ lớp vectơ
  const peakItems = nearby.filter((i) => i.feature.kind === 'peak');
  terrain.peakCount = peakItems.length;
  terrain.ridgeCount = nearby.filter((i) => i.feature.kind === 'ridge').length;

  const nearestPeakItem = peakItems.find((i) => i.nearest !== null);
  terrain.nearestPeak = nearestPeakItem
    ? {
        kind: 'peak',
        labelVi: VECTOR_KIND_LABELS.peak,
        name: nearestPeakItem.feature.properties.name,
        distanceKm: Number(nearestPeakItem.distanceKm.toFixed(2)),
        nearestLat: nearestPeakItem.nearest!.lat,
        nearestLon: nearestPeakItem.nearest!.lon,
      }
    : null;

  // Đỉnh núi không nằm trong `buildVectorAwareness` (đó chỉ duyệt vòng vectơ để
  // bắt đầu ở 'building'), nên phải chèn thủ công vào đúng vị trí theo cự ly
  // để danh sách giữ thứ tự gần → xa như đã cam kết.
  const nearestPoints = vectorResult.nearestPoints.slice();
  if (terrain.nearestPeak) {
    nearestPoints.push({
      key: 'peak',
      labelVi: terrain.nearestPeak.labelVi,
      distanceKm: terrain.nearestPeak.distanceKm,
      lat: terrain.nearestPeak.nearestLat,
      lon: terrain.nearestPeak.nearestLon,
    });
    nearestPoints.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  const profile: SiteProfile = {
    center,
    radiusKm: safeRadius,
    areaKm2,
    terrain,
    features,
    terrainRings: buildTerrainRings(heights, heights[0] ?? 0, safeRadius),
    nearestPoints,
    text: '',
  };

  profile.text = formatProfileText(profile);
  return profile;
}

// ---------------------------------------------------------------------------
// ĐỊNH DẠNG KẾT QUẢ CHO AI
// ---------------------------------------------------------------------------

/**
 * CÁC NGƯỠNG ĐỘ DỐC + MÀU TƯƠNG ỨNG
 *
 * VÌ SAO EXPORT: `describeSlope()` (dùng cho văn bản AI) và biểu đồ cánh hoa
 * (màu tô trên SVG) phải dùng CHUNG một bảng ngưỡng. Nếu ai đó sửa ngưỡng ở
 * `describeSlope` mà quên sửa ở biểu đồ, người dùng sẽ thấy mảng màu đỏ ứng với
 * chữ "thoải thoải" — mâu thuẫn ngay trên cùng một màn hình. Xuất bảng ngưỡng ra
 * để cả hai cùng đọc là cách rẻ nhất để tránh điều đó.
 */
export const SLOPE_LEVELS = [
  { maxDeg: 2, labelVi: 'Bằng phẳng', color: '#22c55e' },
  { maxDeg: 6, labelVi: 'Thoai thoải', color: '#84cc16' },
  { maxDeg: 12, labelVi: 'Dốc vừa', color: '#eab308' },
  { maxDeg: 20, labelVi: 'Dốc', color: '#f97316' },
  { maxDeg: Infinity, labelVi: 'Dốc đứng', color: '#ef4444' },
] as const;

/** Trả về mức độ dốc (kèm màu) cho một góc dốc bất kỳ. */
export function classifySlope(slopeDeg: number) {
  return SLOPE_LEVELS.find((level) => slopeDeg < level.maxDeg) ?? SLOPE_LEVELS[SLOPE_LEVELS.length - 1];
}

/**
 * Diễn giải độ dốc bằng ngôn ngữ tự nhiên (giúp AI và người đọc hiểu).
 *
 * CỐ Ý dùng chung `SLOPE_LEVELS` với biểu đồ — xem giải thích ở bảng ngưỡng.
 */
export function describeSlope(slopeDeg: number): string {
  return classifySlope(slopeDeg).labelVi;
}

/** Diễn giải tỷ lệ rừng. */
function describeForest(ratio: number): string {
  if (ratio < 0.02) return 'gần như không có rừng';
  if (ratio < 0.15) return 'rừng lẻ tản';
  if (ratio < 0.4) return 'rừng xen kẽ';
  if (ratio < 0.7) return 'phủ rừng dày';
  return 'rừng phủ kín';
}

/**
 * Diễn giải mật độ nhà.
 *
 * Đơn vị là CÔNG TRÌNH TRÊN KM² (không phải km²/công trình). Thang này dễ diễn giải
 * cho người dùng VN và khớp với mật độ theo sổ tay thống kê dân cư:
 *   < 1     : vùng đất trống, thưa thớt
 *   1–25    : nông thôn rải rác (làng rải rác dọc đường, nhà sơn)
 *   25–100  : dân cư vừa (thị xã, thị trấn, khu tập trung)
 *   100–500 : đô thị nhỏ / khu công nghiệp
 *   > 500   : lõi đô thị
 */
function describeSettlement(densityPerKm2: number): string {
  if (densityPerKm2 <= 0) return 'vùng đất trống, không có nhà';
  if (densityPerKm2 < 1) return 'rất thưa thớt, vài cụm nhà rải rác';
  if (densityPerKm2 < 25) return 'nông thôn rải rác, nhà sơn ven đường';
  if (densityPerKm2 < 100) return 'dân cư vừa, thị xã hoặc thị trấn';
  if (densityPerKm2 < 500) return 'mật độ dân cư cao, khu đô thị nhỏ';
  return 'mật độ dân cư rất cao, lõi đô thị';
}

/**
 * Chuyển SiteProfile thành văn bản tiếng Việt (~12-18 dòng) để nhúng vào prompt AI.
 * Rỗng nếu không có dữ liệu nào (cả terrain lẫn vectơ đều trống).
 */
export function formatProfileText(profile: SiteProfile): string {
  const lines: string[] = [];
  const { terrain, features } = profile;

  lines.push(
    `Vùng phủ: bán kính ${profile.radiusKm} km quanh tâm (diện tích ≈ ${profile.areaKm2} km²).`
  );

  // --- Địa hình: cao độ & độ dốc (chỉ khi có terrain) ---
  if (terrain.hasTerrainData) {
    lines.push(
      `Địa hình: cao độ tâm ${terrain.elevationAtCenterM} m; dao động trong vùng ${terrain.minM}-${terrain.maxM} m (chênh ${terrain.reliefM} m).`
    );
    lines.push(
      `Độ dốc: lớn nhất ${terrain.maxSlopeDeg}°, trung bình ${terrain.meanSlopeDeg}° - ${describeSlope(terrain.maxSlopeDeg)}; độ gồ ghề ${(terrain.roughness * 100).toFixed(0)}%.`
    );
  } else {
    lines.push('Địa hình: chưa có dữ liệu cao độ terrain cho vùng này (chỉ có ảnh vệ tinh).');
  }

  // --- Núi: đếm từ lớp VECTƠ (peak/ridge), nên phải độc lập với việc có terrain hay không.
  //     Nếu gộp vào khối `hasTerrainData` thì vùng chỉ có OSM mà không có Cesium terrain
  //     sẽ mất sạch thông tin núi - đúng loại mất dữ liệu mà tính năng này sinh ra để tránh.
  if (terrain.peakCount > 0 || terrain.ridgeCount > 0) {
    const nearest = terrain.nearestPeak;
    const peakText = nearest
      ? `đỉnh núi gần nhất cách ${nearest.distanceKm} km${nearest.name ? ` (${nearest.name})` : ''}`
      : `${terrain.peakCount} đỉnh núi`;
    lines.push(`Núi: có ${terrain.peakCount} đỉnh, ${terrain.ridgeCount} sườn núi; ${peakText}.`);
  } else if (features.hasVectorData) {
    lines.push(
      'Núi: không có đỉnh núi nào được ghi nhận trong vùng (địa hình thoáng, dạng đồi bằng hoặc đồng bằng).'
    );
  }

  // --- Nhà cửa ---
  if (features.hasVectorData) {
    lines.push(
      `Nhà cửa: ${features.buildingCount} công trình trong ${profile.areaKm2} km² (mật độ ${features.buildingDensityPerKm2} công trình/km²) - ${describeSettlement(features.buildingDensityPerKm2)}.` +
        (features.nearestBuildingKm !== null
          ? ` Nhà gần nhất cách ${features.nearestBuildingKm} km.`
          : ' Không có nhà nào trong tầm.')
    );

    // --- Nước ---
    const waterBits: string[] = [];
    if (features.riverCount > 0) {
      waterBits.push(
        `${features.riverCount} sông (tổng chiều dài trong vùng ${features.riverLengthKm} km` +
          (features.nearestRiverKm !== null ? `, sông gần nhất cách ${features.nearestRiverKm} km` : '') +
          ')'
      );
    }
    if (features.streamCount > 0) {
      waterBits.push(
        `${features.streamCount} suối/kênh (tổng ${features.streamLengthKm} km` +
          (features.nearestStreamKm !== null ? `, suối gần nhất cách ${features.nearestStreamKm} km` : '') +
          ')'
      );
    }
    if (features.waterBodyCount > 0) {
      waterBits.push(
        `${features.waterBodyCount} hồ/đầm lầm (${features.waterBodyAreaKm2} km²` +
          (features.nearestWaterBodyKm !== null ? `, gần nhất cách ${features.nearestWaterBodyKm} km` : '') +
          ')'
      );
    }
    if (waterBits.length > 0) {
      lines.push(`Nước: ${waterBits.join('; ')}.`);
    } else {
      lines.push('Nước: không có sông, suối hay hồ nào được ghi nhận trong vùng.');
    }

    // --- Giao thông ---
    if (features.roadCount > 0) {
      lines.push(
        `Giao thông: ${features.roadCount} đoạn đường (tổng ${features.roadLengthKm} km` +
          (features.nearestHighwayKm !== null ? `, đường gần nhất cách ${features.nearestHighwayKm} km` : '') +
          ').'
      );
    } else {
      lines.push('Giao thông: không có đường lớn nào trong vùng (vùng đồi núi hoặc rừng).');
    }

    // --- Rừng & đất ---
    if (features.forestAreaKm2 > 0) {
      lines.push(
        `Rừng: ${features.forestAreaKm2} km² (${(features.forestRatio * 100).toFixed(0)}% vùng) - ${describeForest(features.forestRatio)}` +
          (features.nearestForestKm !== null ? `; rừng gần nhất cách ${features.nearestForestKm} km.` : '.')
      );
    }

    if (features.placeNames.length > 0) {
      lines.push(`Địa danh trong vùng: ${features.placeNames.join(', ')}.`);
    }

    if (features.isSparse) {
      lines.push(
        'LƯU Ý: dữ liệu vectơ ở vùng này khá mỏng (OSM chưa được vẽ kỹ), các con số về nhà/đường có thể THẤP HƠN thực tế.'
      );
    }
  } else {
    lines.push(
      'Dữ liệu vectơ: chưa có gói dữ liệu OSM nào được nạp cho vùng này, nên chỉ có ảnh vệ tinh (không phân biệt được nhà/sông/suối).'
    );
  }

  return lines.join('\n');
}

/**
 * Bản tóm tắt ngắn (1-2 dòng) cho log/debug và cho UI hiển thị nhanh.
 */
export function summarizeProfile(profile: SiteProfile): string {
  const bits: string[] = [];
  const { terrain, features } = profile;
  if (terrain.hasTerrainData) bits.push(`cao độ ${terrain.minM}-${terrain.maxM} m`);
  if (features.buildingCount > 0) bits.push(`${features.buildingCount} nhà`);
  if (features.forestAreaKm2 > 0) bits.push(`${features.forestAreaKm2} km² rừng`);
  if (features.nearestRiverKm !== null) bits.push(`sông gần ${features.nearestRiverKm} km`);
  return bits.length > 0 ? bits.join(', ') : 'không có dữ liệu chi tiết';
}
