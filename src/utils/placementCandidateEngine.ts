/**
 * ĐỘNG CƠ SINH & CHẤM ĐIỂM ỨNG VIÊN VỊ TRÍ ĐẶT KHÍ TÀI
 * ======================================================
 *
 * VÌ SAO CẦN FILE NÀY (thay cho việc để model LLM tự chọn toạ độ):
 * Một model ngôn ngữ chạy local KHÔNG có năng lực không gian - nếu bắt nó trả về
 * lat/lon thì kết quả chỉ là một điểm bất kỳ trong bán kính kèm lý do nghe-hợp-lý.
 * Đó chính là hiện tượng "đặt đại cho có".
 *
 * Cách khắc phục: CLIENT tự tính toạ độ bằng DỮ LIỆU THẬT rồi mới tới AI. Cụ thể:
 *   1. Sinh lưới ứng viên trong vùng quan tâm (mặc định ~180 điểm).
 *   2. Lấy cao độ thật cho cả lưới bằng 1 lượt Cesium terrain (sampleTerrainOptimized).
 *   3. Với mỗi ứng viên, đo CỰ LY THẬT tới nhà / đường / sông-suối-hồ / rừng bằng
 *      lớp vectơ OSM (queryFeaturesNear -> distanceToGeometryKm).
 *   4. Chấm điểm theo BỘ TRỌNG SỐ MINH BẠCH (xem DEFAULT_PLACEMENT_WEIGHTS) và giữ lại
 *      `breakdown` từng tiêu chí để UI giải thích được "vì sao điểm này tốt".
 *
 * Kết quả là toạ độ + điểm số CÓ CĂN CỨ và deterministic (cùng dữ liệu -> cùng kết quả).
 * AI chỉ còn vai trò xếp hạng lại và viết diễn giải chiến thuật (xem buildRankingMessages).
 *
 * GIẢ ĐỊNH GIAO DIỆN (không có nguồn ngoài, đã ghi vào docs/DEBUG_NOTES.md):
 * - Các ngưỡng trong `DEFAULT_PLACEMENT_TUNING` là "kinh nghiệm bố trí", có thể chỉnh.
 * - Điểm rơi vào vùng nước (đa giác hồ/đầm hoặc cách tim sông/suối < IN_WATER_KM) bị loại.
 * - Nếu chưa nạp gói terrain: bỏ các tiêu chí cao độ/độ nhô/độ dốc, trọng số được chia lại.
 * - Nếu chưa nạp gói vectơ: bỏ các tiêu chí dân cư/đường/nước/rừng, trọng số được chia lại.
 *
 * Module thuần: mọi phụ thuộc ngoài (cao độ, kho vectơ) đều TIÊM ĐƯỢC qua tham số
 * `elevationLookup` / `featureStore` để kiểm thử không cần Cesium hay dữ liệu thật.
 */
import * as Cesium from 'cesium';
import type { EquipmentTemplate } from '../types/equipment';
import type { VectorFeatureKind } from '../types/vectorFeature';
import type { VectorFeatureStore } from '../services/vectorFeatureStore';
import { loadVectorFeatureStore } from '../services/vectorFeatureStore';
import { getTerrainProvider, queryFeaturesNear } from './featureAwareness';
import { sampleTerrainOptimized } from './terrainSampler';

/** 1 điểm toạ độ WGS-84 (độ thập phân). */
export interface LatLonPoint {
  lat: number;
  lon: number;
}

/** Số liệu thật đo được tại 1 ứng viên. */
export interface PlacementCandidateCriteria {
  /** Cao độ mặt đất ASL (m). 0 nếu không có dữ liệu terrain. */
  elevationM: number;
  /** Độ nhô lớn nhất so với các ô lân cận trong lưới (m) - đại lượng "thoáng". */
  reliefM: number;
  /** Độ dốc cục bộ suy ra từ độ nhô và bước lưới (độ). */
  localSlopeDeg: number;
  nearestBuildingKm: number | null;
  nearestHighwayKm: number | null;
  nearestWaterKm: number | null;
  nearestForestKm: number | null;
  /** Cự ly tới khí tài đã bố trí gần nhất (km). null = chưa có khí tài nào. */
  nearestPlacedKm: number | null;
  /** true nếu ứng viên rơi vào vùng nước (hồ/đầm hoặc sát tim sông/suối). */
  inWater: boolean;
  hasTerrainData: boolean;
  hasVectorData: boolean;
}

/** Các khoá tiêu chí - dùng để lặp có kiểu, tránh truy cập động vào `PlacementWeights`. */
export const CRITERION_KEYS = [
  'elevation',
  'relief',
  'slope',
  'awayFromPopulation',
  'awayFromRoad',
  'waterClear',
  'forestCover',
  'separation',
] as const;

export type CriterionKey = (typeof CRITERION_KEYS)[number];

/** Bộ trọng số chấm điểm. Trọng số của tiêu chí KHÔNG có dữ liệu sẽ bị loại và chia lại. */
export type PlacementWeights = Record<CriterionKey, number>;

/** Bộ trọng số mặc định - tổng = 1.0. Xem chú thích "GIẢ ĐỊNH GIAO DIỆN" ở đầu file. */
export const DEFAULT_PLACEMENT_WEIGHTS: PlacementWeights = {
  elevation: 0.2,
  relief: 0.16,
  slope: 0.12,
  awayFromPopulation: 0.22,
  awayFromRoad: 0.08,
  waterClear: 0.07,
  forestCover: 0.05,
  separation: 0.1,
};
/** Ngưỡng chuyển số liệu thô thành điểm 0..1. */
export interface PlacementTuning {
  /** Cao độ được coi là "đủ tốt" (m) - đạt ngưỡng này thì điểm cao độ = 1. */
  goodElevationM: number;
  /** Độ nhô "đủ tốt" (m). */
  goodReliefM: number;
  /** Độ dốc còn tốt (độ) - nhỏ hơn ngưỡng này điểm = 1. */
  goodSlopeDeg: number;
  /** Độ dốc bị coi là quá đứng (độ) - lớn hơn ngưỡng này điểm = 0. */
  tooSteepSlopeDeg: number;
  /** Cự ly "đủ xa" khu dân cư (km). */
  goodDistanceFromBuildingKm: number;
  /** Cự ly "đủ xa" đường lớn (km). */
  goodDistanceFromRoadKm: number;
  /** Cự ly tối thiểu coi là "thoát nước" (km). */
  goodWaterClearanceKm: number;
  /** Cự ly tới rừng coi là "có che khuất" (km). */
  goodForestKm: number;
  /** Cự ly tối thiểu tới khí tài đã bố trí để không chồng tầm (km). */
  goodSeparationKm: number;
  /** true = loại hẳn ứng viên rơi vào vùng nước. */
  excludeInWater: boolean;
}

/** Ngưỡng mặc định - xem "GIẢ ĐỊNH GIAO DIỆN" ở đầu file. */
export const DEFAULT_PLACEMENT_TUNING: PlacementTuning = {
  goodElevationM: 250,
  goodReliefM: 90,
  goodSlopeDeg: 8,
  tooSteepSlopeDeg: 28,
  goodDistanceFromBuildingKm: 3,
  goodDistanceFromRoadKm: 2,
  goodWaterClearanceKm: 0.6,
  goodForestKm: 1.5,
  goodSeparationKm: 5,
  excludeInWater: true,
};

/** Một ứng viên đã chấm điểm, sẵn sàng để hiển thị / xếp hạng. */
export interface PlacementCandidate {
  latitude: number;
  longitude: number;
  /** Điểm tổng [0,1] = trung bình có trọng số của `breakdown`. */
  score: number;
  /** Điểm từng tiêu chí [0,1], dùng cho UI giải thích. */
  breakdown: Partial<Record<CriterionKey, number>>;
  criteria: PlacementCandidateCriteria;
  /** Lý do tiếng Việt sinh từ SỐ LIỆU THẬT (không phải do AI viết). */
  reason: string;
}

/** Hàm tra cao độ tiêm được (kiểm thử không cần Cesium terrain). */
export type ElevationLookup = (points: readonly LatLonPoint[]) => Promise<number[]>;

export interface GeneratePlacementCandidatesOptions {
  center: LatLonPoint;
  radiusKm: number;
  template: EquipmentTemplate;
  /** Khí tài đã bố trí - dùng cho tiêu chí `separation`. Bỏ trống = không chấm tiêu chí này. */
  placed?: readonly { latitude: number; longitude: number; rangeKm: number }[];
  /** Trần số ứng viên sinh ra (mặc định 180). */
  maxCandidates?: number;
  /** Số ứng viên tốt nhất trả về (mặc định 8). */
  topCount?: number;
  weights?: Partial<PlacementWeights>;
  tuning?: Partial<PlacementTuning>;
  /** Provider terrain; bỏ trống -> lấy từ ô nhớ module (`getTerrainProvider()`). */
  terrainProvider?: Cesium.TerrainProvider | null;
  /** Kho vectơ; undefined -> tự nạp; null -> coi như không có dữ liệu. */
  featureStore?: VectorFeatureStore | null;
  /** Tiêm hàm tra cao độ để kiểm thử. */
  elevationLookup?: ElevationLookup;
}
// ---------------------------------------------------------------------------
// HẰNG SỐ & TIỆN ÍCH SỐ HỌC
// ---------------------------------------------------------------------------

/** Số km trên 1 độ vĩ (xấp xỉ cầu). */
const KM_PER_DEG_LAT = 111.32;
/** Bước lưới nhỏ nhất / lớn nhất (km) - chặn để lưới không quá dày hoặc quá thưa. */
const MIN_STEP_KM = 2;
const MAX_STEP_KM = 50;
/** Cự ly tới tim sông/suối để coi là "nằm trong nước" (km). */
const IN_WATER_KM = 0.05;
/** Bán kính quét lớp vectơ quanh mỗi ứng viên, kẹp [min,max] (km). */
const FEATURE_QUERY_MIN_KM = 8;
const FEATURE_QUERY_MAX_KM = 40;
/** Loại đối tượng cần cho việc chấm điểm. */
const SCORING_KINDS: readonly VectorFeatureKind[] = [
  'building',
  'water_river',
  'water_stream',
  'water_body',
  'highway',
  'forest',
];
const WATER_KINDS: readonly VectorFeatureKind[] = ['water_river', 'water_stream', 'water_body'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Cự ly haversine (km) giữa 2 điểm toạ độ. */
function haversineKm(a: LatLonPoint, b: LatLonPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Một ô lưới ứng viên (giữ chỉ số lưới để tính độ nhô với ô lân cận). */
interface GridPoint extends LatLonPoint {
  gx: number;
  gy: number;
}

/**
 * Sinh lưới điểm vuông trong hình tròn. Bước lưới được chọn sao cho số điểm xấp xỉ
 * `maxCandidates`, rồi kẹp [MIN_STEP_KM, MAX_STEP_KM] để không quá dày/quá thưa.
 */
function buildGridPoints(
  center: LatLonPoint,
  radiusKm: number,
  maxCandidates: number
): { points: GridPoint[]; stepKm: number } {
  const stepKm = clamp(radiusKm * Math.sqrt(Math.PI / maxCandidates), MIN_STEP_KM, MAX_STEP_KM);
  const reach = Math.ceil(radiusKm / stepKm);
  const latDegPerKm = 1 / KM_PER_DEG_LAT;
  const lonDegPerKm = 1 / (KM_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));

  const points: GridPoint[] = [];
  for (let gy = -reach; gy <= reach; gy++) {
    for (let gx = -reach; gx <= reach; gx++) {
      const eastKm = gx * stepKm;
      const northKm = gy * stepKm;
      if (Math.hypot(eastKm, northKm) > radiusKm) continue;
      points.push({
        gx,
        gy,
        lat: center.lat + northKm * latDegPerKm,
        lon: center.lon + eastKm * lonDegPerKm,
      });
    }
  }

  // Chặn trần: nếu vẫn vượt (do kẹp bước lưới), lấy mẫu đều.
  if (points.length > maxCandidates) {
    const stride = points.length / maxCandidates;
    const thinned: GridPoint[] = [];
    for (let i = 0; i < points.length && thinned.length < maxCandidates; i += stride) {
      thinned.push(points[Math.floor(i)]);
    }
    return { points: thinned, stepKm };
  }

  return { points, stepKm };
}

/** Tra cao độ: ưu tiên hàm tiêm, sau đó tới provider terrain, cuối cùng là toàn 0. */
async function lookupElevations(
  opts: GeneratePlacementCandidatesOptions,
  points: readonly GridPoint[]
): Promise<number[]> {
  if (opts.elevationLookup) {
    const injected = await opts.elevationLookup(points);
    return points.map((_, i) => (Number.isFinite(injected[i]) ? injected[i] : 0));
  }

  const provider = opts.terrainProvider ?? getTerrainProvider();
  if (!provider || points.length === 0) return points.map(() => 0);

  const positions = points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
  const heights = await sampleTerrainOptimized(
    provider,
    opts.center.lon,
    opts.center.lat,
    positions,
    10,
    1500
  );
  return points.map((_, i) => (Number.isFinite(heights[i]) ? heights[i] : 0));
}
// ---------------------------------------------------------------------------
// CHỈ SỐ ĐỊA HÌNH CỤC BỘ (từ mẫu cao độ của lưới)
// ---------------------------------------------------------------------------

/** 8 ô lân cận (dx, dy) trên lưới - dùng để tính độ nhô. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Chỉ số địa hình cục bộ của 1 ô lưới. */
interface LocalTerrainMetric {
  elevationM: number;
  reliefM: number;
  localSlopeDeg: number;
}

/**
 * Tính độ nhô/độ dốc cục bộ cho từng ô lưới: độ nhô = chênh cao lớn nhất với 8 ô lân
 * cận; độ dốc = atan2(độ nhô, bước lưới). Cách này đo "thoáng" mà không cần mẫu thêm.
 */
function buildTerrainMetrics(
  points: readonly GridPoint[],
  heights: readonly number[],
  stepKm: number
): LocalTerrainMetric[] {
  const indexByCell = new Map<string, number>();
  points.forEach((p, i) => indexByCell.set(`${p.gx}_${p.gy}`, i));
  const stepM = stepKm * 1000;

  return points.map((p, i) => {
    const h = heights[i];
    let relief = 0;
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const j = indexByCell.get(`${p.gx + dx}_${p.gy + dy}`);
      if (j === undefined) continue;
      relief = Math.max(relief, Math.abs(h - heights[j]));
    }
    const slopeDeg = stepM > 0 ? Math.atan2(relief, stepM) * (180 / Math.PI) : 0;
    return {
      elevationM: Math.round(h),
      reliefM: Math.round(relief),
      localSlopeDeg: Number(slopeDeg.toFixed(1)),
    };
  });
}

// ---------------------------------------------------------------------------
// ĐO CỰ LY THẬT TỚI LỚP VECTƠ
// ---------------------------------------------------------------------------

/** Kết quả đo cự ly thật quanh 1 ứng viên. */
interface FeatureProbe {
  nearestBuildingKm: number | null;
  nearestHighwayKm: number | null;
  nearestWaterKm: number | null;
  nearestForestKm: number | null;
  inWater: boolean;
}

function minOrNull(current: number | null, candidate: number): number {
  return current === null || candidate < current ? candidate : current;
}

/**
 * Quét lớp vectơ quanh từng ứng viên để lấy cự ly thật tới nhà / đường / nước / rừng.
 * Trả giá trị null (chưa thấy) khi không có dữ liệu vectơ.
 */
function probeFeatures(
  store: VectorFeatureStore | null,
  points: readonly GridPoint[],
  queryRadiusKm: number,
  hasVectorData: boolean
): FeatureProbe[] {
  return points.map((p) => {
    const probe: FeatureProbe = {
      nearestBuildingKm: null,
      nearestHighwayKm: null,
      nearestWaterKm: null,
      nearestForestKm: null,
      inWater: false,
    };
    if (!hasVectorData || !store) return probe;

    const nearby = queryFeaturesNear(store, p.lat, p.lon, queryRadiusKm, SCORING_KINDS);
    for (const item of nearby) {
      const kind = item.feature.kind;
      if (kind === 'building') {
        probe.nearestBuildingKm = minOrNull(probe.nearestBuildingKm, item.distanceKm);
      } else if (kind === 'highway') {
        probe.nearestHighwayKm = minOrNull(probe.nearestHighwayKm, item.distanceKm);
      } else if (kind === 'forest') {
        probe.nearestForestKm = minOrNull(probe.nearestForestKm, item.distanceKm);
      } else if ((WATER_KINDS as readonly string[]).includes(kind)) {
        probe.nearestWaterKm = minOrNull(probe.nearestWaterKm, item.distanceKm);
        if (item.inside || item.distanceKm <= IN_WATER_KM) probe.inWater = true;
      }
    }
    return probe;
  });
}
// ---------------------------------------------------------------------------
// CHẤM ĐIỂM
// ---------------------------------------------------------------------------

/** Điểm tiêu chí độ dốc: càng thoải càng tốt, quá đứng thì 0. */
function slopeScore(slopeDeg: number, tuning: PlacementTuning): number {
  if (!Number.isFinite(slopeDeg)) return 0;
  if (slopeDeg <= tuning.goodSlopeDeg) return 1;
  if (slopeDeg >= tuning.tooSteepSlopeDeg) return 0;
  const span = tuning.tooSteepSlopeDeg - tuning.goodSlopeDeg;
  return span > 0 ? clamp01(1 - (slopeDeg - tuning.goodSlopeDeg) / span) : 0;
}

/**
 * Chấm điểm 1 ứng viên. Chỉ tính các tiêu chí CÓ dữ liệu rồi chia lại trọng số
 * (nhờ vậy thiếu terrain hay thiếu vectơ vẫn ra điểm có nghĩa, không bị kéo về 0).
 */
function scoreCandidate(
  criteria: PlacementCandidateCriteria,
  weights: PlacementWeights,
  tuning: PlacementTuning
): { score: number; breakdown: Partial<Record<CriterionKey, number>> } {
  const breakdown: Partial<Record<CriterionKey, number>> = {};

  if (criteria.hasTerrainData) {
    breakdown.elevation = clamp01(criteria.elevationM / tuning.goodElevationM);
    breakdown.relief = clamp01(criteria.reliefM / tuning.goodReliefM);
    breakdown.slope = slopeScore(criteria.localSlopeDeg, tuning);
  }

  if (criteria.hasVectorData) {
    breakdown.awayFromPopulation =
      criteria.nearestBuildingKm === null
        ? 1
        : clamp01(criteria.nearestBuildingKm / tuning.goodDistanceFromBuildingKm);
    breakdown.awayFromRoad =
      criteria.nearestHighwayKm === null
        ? 1
        : clamp01(criteria.nearestHighwayKm / tuning.goodDistanceFromRoadKm);
    breakdown.waterClear = criteria.inWater
      ? 0
      : criteria.nearestWaterKm === null
        ? 1
        : clamp01(criteria.nearestWaterKm / tuning.goodWaterClearanceKm);
    // Rừng gần = có che khuất (tốt cho sống sót). Không có rừng -> điểm trung tính 0.4.
    breakdown.forestCover =
      criteria.nearestForestKm === null
        ? 0.4
        : 0.3 + 0.7 * (1 - clamp01(criteria.nearestForestKm / tuning.goodForestKm));
  }

  if (criteria.nearestPlacedKm !== null) {
    breakdown.separation = clamp01(criteria.nearestPlacedKm / tuning.goodSeparationKm);
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const key of CRITERION_KEYS) {
    const part = breakdown[key];
    if (part === undefined) continue;
    const w = weights[key];
    if (!(w > 0)) continue;
    weighted += w * part;
    totalWeight += w;
  }

  return { score: totalWeight > 0 ? clamp01(weighted / totalWeight) : 0, breakdown };
}

/** Sinh lý do tiếng Việt từ số liệu THẬT (không phải văn do AI viết). */
function buildReason(criteria: PlacementCandidateCriteria): string {
  const bits: string[] = [];

  if (criteria.hasTerrainData) {
    bits.push(`cao độ ${criteria.elevationM} m`);
    if (criteria.reliefM >= 5) bits.push(`nhô ${criteria.reliefM} m so với lân cận`);
    bits.push(`dốc cục bộ ${criteria.localSlopeDeg.toFixed(1)}°`);
  }

  if (criteria.hasVectorData) {
    bits.push(
      criteria.nearestBuildingKm === null
        ? 'không có nhà trong bán kính quét'
        : `cách khu dân cư gần nhất ${criteria.nearestBuildingKm.toFixed(1)} km`
    );
    if (criteria.inWater) {
      bits.push('NẰM TRONG VÙNG NƯỚC');
    } else if (criteria.nearestWaterKm !== null) {
      bits.push(`cách sông/suối/hồ gần nhất ${criteria.nearestWaterKm.toFixed(1)} km`);
    }
    if (criteria.nearestHighwayKm !== null) {
      bits.push(`cách đường lớn gần nhất ${criteria.nearestHighwayKm.toFixed(1)} km`);
    }
  }

  if (criteria.nearestPlacedKm !== null) {
    bits.push(`cách khí tài đã bố trí gần nhất ${criteria.nearestPlacedKm.toFixed(1)} km`);
  }

  if (!criteria.hasVectorData) bits.push('chưa có dữ liệu vectơ để đối chiếu nhà/đường/sông');
  if (!criteria.hasTerrainData) bits.push('chưa có dữ liệu cao độ terrain');

  return bits.length > 0 ? `Căn cứ: ${bits.join('; ')}.` : 'Chưa có dữ liệu để lập luận.';
}
// ---------------------------------------------------------------------------
// HÀM CHÍNH
// ---------------------------------------------------------------------------

/** Cự ly (km) tới khí tài đã bố trí gần nhất; null nếu danh sách rỗng. */
function nearestPlacedKm(
  point: LatLonPoint,
  placed: readonly { latitude: number; longitude: number }[]
): number | null {
  let nearest: number | null = null;
  for (const item of placed) {
    const d = haversineKm(point, { lat: item.latitude, lon: item.longitude });
    if (nearest === null || d < nearest) nearest = d;
  }
  return nearest;
}

/**
 * Sinh danh sách ứng viên đặt khí tài trong vùng quan tâm, đã chấm điểm và xếp hạng
 * giảm dần theo điểm. Trả tối đa `topCount` ứng viên tốt nhất (mặc định 8).
 *
 * Deterministic: cùng dữ liệu vào -> cùng danh sách ra. Không phụ thuộc AI.
 */
export async function generatePlacementCandidates(
  opts: GeneratePlacementCandidatesOptions
): Promise<PlacementCandidate[]> {
  const radiusKm = clamp(opts.radiusKm, 1, 500);
  const maxCandidates = clamp(Math.round(opts.maxCandidates ?? 180), 9, 600);
  const topCount = clamp(Math.round(opts.topCount ?? 8), 1, 50);
  const weights: PlacementWeights = { ...DEFAULT_PLACEMENT_WEIGHTS, ...(opts.weights ?? {}) };
  const tuning: PlacementTuning = { ...DEFAULT_PLACEMENT_TUNING, ...(opts.tuning ?? {}) };
  // Ngưỡng "không chồng tầm" co giãn theo tầm khí tài: hai đài cùng tầm R đặt gần nhau
  // (dưới ~R/2) là chồng phủ đáng kể, nên đẩy ngưỡng separation lên theo template.
  const effectiveTuning: PlacementTuning = {
    ...tuning,
    goodSeparationKm: Math.max(tuning.goodSeparationKm, opts.template.defaultRangeKm * 0.5),
  };

  const { points, stepKm } = buildGridPoints(opts.center, radiusKm, maxCandidates);
  if (points.length === 0) return [];

  // Kho vectơ: undefined -> tự nạp; null -> coi như không có dữ liệu.
  const store =
    opts.featureStore === undefined ? await loadVectorFeatureStore() : opts.featureStore;
  const hasVectorData = Boolean(store && store.featureCount > 0);

  const heights = await lookupElevations(opts, points);
  const hasTerrainData =
    Boolean(opts.elevationLookup) || Boolean(opts.terrainProvider ?? getTerrainProvider());

  const terrainMetrics = buildTerrainMetrics(points, heights, stepKm);
  const featureQueryRadiusKm = clamp(radiusKm / 2, FEATURE_QUERY_MIN_KM, FEATURE_QUERY_MAX_KM);
  const probes = probeFeatures(store, points, featureQueryRadiusKm, hasVectorData);

  const candidates: PlacementCandidate[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const terrain = terrainMetrics[i];
    const probe = probes[i];

    const criteria: PlacementCandidateCriteria = {
      elevationM: hasTerrainData ? terrain.elevationM : 0,
      reliefM: hasTerrainData ? terrain.reliefM : 0,
      localSlopeDeg: hasTerrainData ? terrain.localSlopeDeg : 0,
      nearestBuildingKm: probe.nearestBuildingKm,
      nearestHighwayKm: probe.nearestHighwayKm,
      nearestWaterKm: probe.nearestWaterKm,
      nearestForestKm: probe.nearestForestKm,
      nearestPlacedKm: opts.placed ? nearestPlacedKm(point, opts.placed) : null,
      inWater: probe.inWater,
      hasTerrainData,
      hasVectorData,
    };

    // Loại thẳng ứng viên rơi vào vùng nước (không thể dựng trận địa).
    if (tuning.excludeInWater && criteria.inWater) continue;

    const { score, breakdown } = scoreCandidate(criteria, weights, effectiveTuning);
    candidates.push({
      latitude: Number(point.lat.toFixed(6)),
      longitude: Number(point.lon.toFixed(6)),
      score,
      breakdown,
      criteria,
      reason: buildReason(criteria),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.latitude - b.latitude);
  return candidates.slice(0, topCount);
}