/**
 * PHÂN TÍCH ĐỊA HÌNH BẰNG PHẲNG ĐỦ ĐIỀU KIỆN TRIỂN KHAI TRẬN ĐỊA
 * ================================================================
 *
 * Bài toán: Cho điểm tâm + bán kính 1 km, tìm tất cả mảng địa hình
 * đủ bằng phẳng (ΔH ≤ 4m, độ dốc ≤ 10°, diện tích ≥ 10.000 m²) để
 * triển khai khí tài quân sự / đài radar.
 *
 * Thuật toán:
 *   1. Sinh lưới 81×81 điểm trong circle bán kính 1km (bước lưới chính xác 25m).
 *   2. sampleTerrainOptimized() lấy cao độ DEM batch từ TerrainProvider.
 *   3. Tính slope giữa mỗi cặp ô liền kề 4-neighbor nội bộ.
 *   4. Union-Find có ràng buộc dải cao độ: chỉ gộp 2 cụm nếu
 *      max(max_a, max_b) - min(min_a, min_b) ≤ maxDeltaElevM (4m) và slope ≤ 10°.
 *   5. Tính Convex Hull đóng, diện tích Shoelace và chu vi thực tế.
 *   6. Kiểm tra mọi điểm địa hình nằm bên trong Convex Hull để ngăn lọt đỉnh núi/hố sâu.
 *   7. Lọc mảng diện tích polygon thực ≥ 10.000 m².
 *   8. Lưu mảng mẫu điểm cao độ thực (samples) phục vụ vẽ bình độ 2D.
 */

import * as Cesium from 'cesium';
import { area } from '@turf/area';
import { intersect } from '@turf/intersect';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { sampleTerrainOptimized } from './terrainSampler';
import { queryFeaturesNear } from './featureAwareness';
import type { VectorFeatureStore } from '../services/vectorFeatureStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Một điểm tọa độ địa lý. */
export interface LatLonPoint {
  lat: number;
  lon: number;
}

/** Một điểm mẫu cao độ địa hình nội bộ của mảng. */
export interface TerrainSamplePoint {
  lat: number;
  lon: number;
  height: number;
}

/** Một mảng địa hình bằng phẳng đủ điều kiện hoặc không. */
export interface FlatPatch {
  id: string;
  /** Mã định danh của vùng địa hình tự nhiên gốc (nếu được chia từ vùng lớn > 1 ha). */
  parentZoneId?: string;
  /** Thứ tự mảng con trong vùng gốc. */
  subIndex?: number;
  /** Tổng diện tích của vùng địa hình tự nhiên gốc (m²). */
  totalZoneAreaM2?: number;
  /** Đa giác bao quanh mảng (đã đóng – điểm cuối = điểm đầu). */
  polygon: LatLonPoint[];
  centerLat: number;
  centerLon: number;
  /** Diện tích hình học thực của đa giác (m²), đảm bảo giới hạn trên <= 10.000 m² (1 ha). */
  areaM2: number;
  /** Chu vi của đa giác (m). */
  perimeterM: number;
  minElevM: number;
  maxElevM: number;
  /** Chênh lệch độ cao = maxElevM - minElevM. */
  deltaElevM: number;
  /** Độ dốc trung bình nội bộ (°). */
  meanSlopeDeg: number;
  /** Độ dốc lớn nhất nội bộ (°). */
  maxSlopeDeg: number;
  /** true nếu ΔH ≤ maxDeltaElevM VÀ maxSlopeDeg ≤ ngưỡng. */
  isDeployable: boolean;
  /** Số công trình trong mảng. */
  buildingCount: number;
  /** Chiều dài sông/suối chạy qua (km). */
  riverLengthKm: number;
  /** Diện tích rừng trong mảng (m²). */
  forestAreaM2: number;
  /** Số đoạn đường trong mảng. */
  roadCount: number;
  /** Cảnh báo chướng ngại vật mặt nước/sông suối. */
  waterWarning?: string;
  /** Danh sách các điểm mẫu cao độ nội bộ của mảng để vẽ vi địa hình 2D. */
  samples: TerrainSamplePoint[];
}

/** Kết quả phân tích địa hình toàn vùng. */
export interface FlatnessAnalysisResult {
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  patches: FlatPatch[];
  totalAreaM2: number;
  /** Tổng diện tích các mảng isDeployable = true. */
  deployableAreaM2: number;
  sampledAt: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

/** Tính khoảng cách (m) theo Haversine giữa 2 điểm địa lý. */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Kiểm tra điểm nằm trong đa giác (Ray-casting algorithm). */
function isPointInPolygon(p: LatLonPoint, polygon: LatLonPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Tính diện tích (m²) theo công thức Shoelace và chu vi (m) của đa giác phẳng trên mặt phẳng cục bộ. */
function polygonAreaAndPerimeter(
  hull: LatLonPoint[],
  centerLat: number,
  centerLon: number,
): { areaM2: number; perimeterM: number } {
  if (hull.length < 3) return { areaM2: 0, perimeterM: 0 };
  const mPerDegLat = 111_132.92;
  const mPerDegLon = 111_412.84 * Math.cos((centerLat * Math.PI) / 180);
  const pts = hull.map((p) => ({
    x: (p.lon - centerLon) * mPerDegLon,
    y: (p.lat - centerLat) * mPerDegLat,
  }));

  let area = 0;
  let perimeter = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    perimeter += Math.hypot(dx, dy);
  }
  return { areaM2: Math.abs(area) / 2, perimeterM: perimeter };
}

// ---------------------------------------------------------------------------
// Union-Find có ràng buộc biên độ cao độ [minH, maxH]
// ---------------------------------------------------------------------------

class ElevationBoundedUnionFind {
  private parent: Int32Array;
  private rank: Uint8Array;
  public minH: Float64Array;
  public maxH: Float64Array;

  constructor(n: number, initialHeights: number[]) {
    this.parent = new Int32Array(n).map((_, i) => i);
    this.rank = new Uint8Array(n);
    this.minH = new Float64Array(initialHeights);
    this.maxH = new Float64Array(initialHeights);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path compression
      x = this.parent[x];
    }
    return x;
  }

  /**
   * Cố gắng gộp hai cụm a và b.
   * Chỉ cho phép gộp nếu dải độ cao kết hợp max - min <= maxDeltaElevM.
   */
  tryUnion(a: number, b: number, maxDeltaElevM: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;

    const combinedMin = Math.min(this.minH[ra], this.minH[rb]);
    const combinedMax = Math.max(this.maxH[ra], this.maxH[rb]);
    if (combinedMax - combinedMin > maxDeltaElevM) {
      return false; // Từ chối gộp để giữ nguyên các mảng phẳng con riêng biệt!
    }

    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
      this.minH[rb] = combinedMin;
      this.maxH[rb] = combinedMax;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
      this.minH[ra] = combinedMin;
      this.maxH[ra] = combinedMax;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
      this.minH[ra] = combinedMin;
      this.maxH[ra] = combinedMax;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Convex Hull — Andrew's Monotone Chain (O(n log n))
// ---------------------------------------------------------------------------

function cross2D(o: LatLonPoint, a: LatLonPoint, b: LatLonPoint): number {
  return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
}

function convexHull(points: LatLonPoint[]): LatLonPoint[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) =>
    a.lon !== b.lon ? a.lon - b.lon : a.lat - b.lat,
  );
  const lower: LatLonPoint[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LatLonPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

// ---------------------------------------------------------------------------
// Feature counting helper
// ---------------------------------------------------------------------------

function countFeatures(
  store: VectorFeatureStore | null,
  polygon: LatLonPoint[],
  lat: number,
  lon: number,
  radiusKm: number,
): {
  buildingCount: number;
  riverLengthKm: number;
  forestAreaM2: number;
  roadCount: number;
  hasWaterBody: boolean;
  waterWarning?: string;
} {
  if (!store) {
    return {
      buildingCount: 0,
      riverLengthKm: 0,
      forestAreaM2: 0,
      roadCount: 0,
      hasWaterBody: false,
    };
  }

  const nearby = queryFeaturesNear(store, lat, lon, radiusKm, [
    'building',
    'water_river',
    'water_stream',
    'water_body',
    'highway',
    'forest',
    'land',
  ]);

  let buildingCount = 0;
  let riverLengthKm = 0;
  let forestAreaM2 = 0;
  let roadCount = 0;
  let hasWaterBody = false;
  let waterWarning: string | undefined = undefined;

  for (const { feature } of nearby) {
    // Kiểm tra tâm của feature có nằm trong hoặc lân cận đa giác không
    const fCenter = {
      lat: (feature.bounds.minLat + feature.bounds.maxLat) / 2,
      lon: (feature.bounds.minLon + feature.bounds.maxLon) / 2,
    };
    const inPoly = isPointInPolygon(fCenter, polygon);

    switch (feature.kind) {
      case 'building':
        if (inPoly) buildingCount++;
        break;
      case 'water_body': {
        if (inPoly) {
          hasWaterBody = true;
          waterWarning = 'Vùng mặt nước / Hồ đầm lầy (Không phù hợp triển khai khí tài)';
        }
        break;
      }
      case 'water_river': {
        const dLat = (feature.bounds.maxLat - feature.bounds.minLat) * 111_000;
        const dLon =
          (feature.bounds.maxLon - feature.bounds.minLon) *
          111_000 *
          Math.cos((lat * Math.PI) / 180);
        const lenKm = Math.max(dLat, dLon) / 1000;
        if (inPoly) {
          riverLengthKm += lenKm;
          if (!waterWarning) {
            waterWarning = `Có sông lớn cắt qua mảng (~${lenKm.toFixed(2)} km)`;
          }
        }
        break;
      }
      case 'water_stream': {
        const dLat = (feature.bounds.maxLat - feature.bounds.minLat) * 111_000;
        const dLon =
          (feature.bounds.maxLon - feature.bounds.minLon) *
          111_000 *
          Math.cos((lat * Math.PI) / 180);
        const lenKm = Math.max(dLat, dLon) / 1000;
        if (inPoly) {
          riverLengthKm += lenKm;
          if (!waterWarning) {
            waterWarning = `Có khe suối cắt qua mảng (~${lenKm.toFixed(2)} km)`;
          }
        }
        break;
      }
      case 'forest':
      case 'land': {
        const dLat2 = (feature.bounds.maxLat - feature.bounds.minLat) * 111_000;
        const dLon2 =
          (feature.bounds.maxLon - feature.bounds.minLon) *
          111_000 *
          Math.cos((lat * Math.PI) / 180);
        if (inPoly) forestAreaM2 += dLat2 * dLon2 * 0.5;
        break;
      }
      case 'highway':
        if (inPoly) roadCount++;
        break;
    }
  }

  return { buildingCount, riverLengthKm, forestAreaM2, roadCount, hasWaterBody, waterWarning };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface FlatnessAnalysisOptions {
  /** Số điểm theo mỗi chiều của lưới. Mặc định 81 điểm (bước 25m trên đường kính 2000m). */
  gridSize?: number;
  /** Chênh lệch độ cao tối đa cho phép trong 1 mảng (m). Default 4. */
  maxDeltaElevM?: number;
  /** Độ dốc tối đa giữa 2 ô liền kề (°). Default 10. */
  maxSlopeDeg?: number;
  /** Diện tích tối thiểu của mảng (m²). Default 10000. */
  minPatchAreaM2?: number;
  /** Diện tích tối đa của mỗi mảng con (m²). Giới hạn trên, mặc định 10.000 m² (1 ha). */
  maxPatchAreaM2?: number;
  /** Cesium TerrainProvider. Bắt buộc để lấy DEM thực. */
  terrainProvider: Cesium.TerrainProvider | null;
  /** Cửa hàng dữ liệu vectơ (tuỳ chọn để đếm đối tượng). */
  vectorStore?: VectorFeatureStore | null;
}

/**
 * Phân tích địa hình bằng phẳng quanh điểm (centerLat, centerLon),
 * bán kính radiusKm.
 *
 * Trả về danh sách FlatPatch, mỗi patch là 1 vùng địa hình liên tục
 * đủ tiêu chuẩn độ dốc/chênh cao/diện tích.
 */
export async function analyzeTerrainFlatness(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  opts: FlatnessAnalysisOptions,
): Promise<FlatnessAnalysisResult> {
  const {
    gridSize = 81, // 81 điểm chia đường kính 2.000m thành 80 khoảng => 25m/khoảng đúng chuẩn yêu cầu 20-25m
    maxDeltaElevM = 4,
    maxSlopeDeg = 6,
    minPatchAreaM2 = 10_000,
    maxPatchAreaM2 = 10_000,
    terrainProvider,
    vectorStore = null,
  } = opts;

  if (!terrainProvider) {
    throw new Error('Chưa có TerrainProvider để lấy dữ liệu độ cao địa hình 3D (DEM).');
  }

  const radiusM = radiusKm * 1000;

  // --- 1. Sinh lưới điểm trong hình tròn bán kính radiusM ---
  const totalLatM = 2 * radiusM;
  const totalLonM = 2 * radiusM;
  const cellLatM = totalLatM / (gridSize - 1);
  const cellLonM = totalLonM / (gridSize - 1);

  const degPerMeterLat = 1 / 111_000;
  const degPerMeterLon = 1 / (111_000 * Math.cos((centerLat * Math.PI) / 180));

  interface GridCell {
    row: number;
    col: number;
    lat: number;
    lon: number;
    index: number;
  }

  const cells: GridCell[] = [];
  const positions: Cesium.Cartographic[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const offsetLatM = (row - (gridSize - 1) / 2) * cellLatM;
      const offsetLonM = (col - (gridSize - 1) / 2) * cellLonM;
      const lat = centerLat + offsetLatM * degPerMeterLat;
      const lon = centerLon + offsetLonM * degPerMeterLon;

      if (haversineM(centerLat, centerLon, lat, lon) > radiusM) continue;

      cells.push({ row, col, lat, lon, index: positions.length });
      positions.push(Cesium.Cartographic.fromDegrees(lon, lat));
    }
  }

  // --- 2. Lấy cao độ DEM cho tất cả ô (1 lượt batch) ---
  let heights: number[];
  try {
    heights = await sampleTerrainOptimized(terrainProvider, centerLon, centerLat, positions, 11);
  } catch {
    try {
      heights = await sampleTerrainOptimized(terrainProvider, centerLon, centerLat, positions, 8);
    } catch (err) {
      const msg = (err as Error)?.message || '';
      if (msg.includes('Terrain height unavailable') || msg.includes('unavailable for')) {
        throw new Error('Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ của gói DEM offline).');
      }
      throw new Error(`Không thể lấy dữ liệu độ cao địa hình (DEM): ${msg || 'Lỗi kết nối'}`);
    }
  }

  // Map (row, col) → cell data + height
  const gridMap = new Map<string, { cell: GridCell; height: number }>();
  for (const cell of cells) {
    const h = heights[cell.index];
    gridMap.set(`${cell.row}_${cell.col}`, { cell, height: isNaN(h) ? 0 : h });
  }

  // --- 3. Tính slope giữa các cặp ô liền kề 4-neighbor ---
  const neighborDistLat = cellLatM;
  const neighborDistLon = cellLonM;

  const slopeMap = new Map<string, number>();
  const neighbors4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (const { cell, height } of gridMap.values()) {
    for (const [dr, dc] of neighbors4) {
      const nr = cell.row + dr;
      const nc = cell.col + dc;
      const nKey = `${nr}_${nc}`;
      const neighbor = gridMap.get(nKey);
      if (!neighbor) continue;

      const dH = Math.abs(height - neighbor.height);
      const distM = dr !== 0 ? neighborDistLat : neighborDistLon;
      const slope = (Math.atan2(dH, distM) * 180) / Math.PI;

      const edgeKey = `${Math.min(cell.row, nr)}_${Math.min(cell.col, nc)}-${Math.max(cell.row, nr)}_${Math.max(cell.col, nc)}`;
      slopeMap.set(edgeKey, slope);
    }
  }

  // --- 4. Union-Find có kiểm soát biên độ cao độ [minH, maxH] ≤ maxDeltaElevM ---
  const cellList = [...gridMap.values()];
  const cellIndexMap = new Map<string, number>();
  cellList.forEach(({ cell }, i) => cellIndexMap.set(`${cell.row}_${cell.col}`, i));

  const initialHeights = cellList.map((c) => c.height);
  const uf = new ElevationBoundedUnionFind(cellList.length, initialHeights);

  for (const { cell } of cellList) {
    for (const [dr, dc] of neighbors4) {
      const nr = cell.row + dr;
      const nc = cell.col + dc;
      const nKey = `${nr}_${nc}`;
      const nData = gridMap.get(nKey);
      if (!nData) continue;

      const edgeKey = `${Math.min(cell.row, nr)}_${Math.min(cell.col, nc)}-${Math.max(cell.row, nr)}_${Math.max(cell.col, nc)}`;
      const slope = slopeMap.get(edgeKey) ?? 999;
      if (slope > maxSlopeDeg) continue;

      const ai = cellIndexMap.get(`${cell.row}_${cell.col}`)!;
      const bi = cellIndexMap.get(nKey)!;

      // Cố gắng gộp có kiểm soát dải độ cao cục bộ ≤ maxDeltaElevM
      uf.tryUnion(ai, bi, maxDeltaElevM);
    }
  }

  // --- 5. Gom cells theo cluster đại diện ---
  interface ClusterData {
    indices: number[];
    cells: { cell: GridCell; height: number }[];
    minH: number;
    maxH: number;
  }

  const clusters = new Map<number, ClusterData>();

  for (let i = 0; i < cellList.length; i++) {
    const root = uf.find(i);
    const existing = clusters.get(root);
    const { cell, height } = cellList[i];
    if (!existing) {
      clusters.set(root, {
        indices: [i],
        cells: [{ cell, height }],
        minH: height,
        maxH: height,
      });
    } else {
      existing.indices.push(i);
      existing.cells.push({ cell, height });
      if (height < existing.minH) existing.minH = height;
      if (height > existing.maxH) existing.maxH = height;
    }
  }

  // --- 6. Xây dựng FlatPatch, tính Convex Hull và diện tích Shoelace thực tế ---
  const patches: FlatPatch[] = [];
  let patchIndex = 0;
  let zoneIndex = 0;

  for (const [, cluster] of clusters) {
    const deltaH = cluster.maxH - cluster.minH;
    if (deltaH > maxDeltaElevM) continue;

    // Phải có ít nhất 4 điểm để tạo thành đa giác có diện tích
    if (cluster.cells.length < 4) continue;

    // Tâm của cụm
    const sumLat = cluster.cells.reduce((s, { cell }) => s + cell.lat, 0);
    const sumLon = cluster.cells.reduce((s, { cell }) => s + cell.lon, 0);
    const centerLat_ = sumLat / cluster.cells.length;
    const centerLon_ = sumLon / cluster.cells.length;

    // Convex hull của cụm
    const points: LatLonPoint[] = cluster.cells.map(({ cell }) => ({
      lat: cell.lat,
      lon: cell.lon,
    }));
    const hull = convexHull(points);
    if (hull.length < 3) continue;

    // Đóng đa giác
    const closedHull = [...hull];
    if (
      closedHull[0].lat !== closedHull[closedHull.length - 1].lat ||
      closedHull[0].lon !== closedHull[closedHull.length - 1].lon
    ) {
      closedHull.push({ lat: closedHull[0].lat, lon: closedHull[0].lon });
    }

    // Tính diện tích và chu vi đa giác vùng gốc
    const { areaM2: rootAreaM2, perimeterM: rootPerimeterM } = polygonAreaAndPerimeter(closedHull, centerLat_, centerLon_);
    // Vùng quá nhỏ không đủ diện tích triển khai bất kỳ trận địa nào
    const minThresholdM2 = Math.min(10_000, Math.max(1_000, minPatchAreaM2));
    if (rootAreaM2 < minThresholdM2) continue;

    // Kiểm tra các điểm địa hình bên trong Convex Hull để ngăn lọt đỉnh nhọn hoặc khe vực
    const clusterCellKeys = new Set(cluster.cells.map(({ cell }) => `${cell.row}_${cell.col}`));
    let interiorMinH = cluster.minH;
    let interiorMaxH = cluster.maxH;
    let hasExtremeElevation = false;

    for (const { cell, height } of gridMap.values()) {
      if (clusterCellKeys.has(`${cell.row}_${cell.col}`)) continue;
      if (isPointInPolygon({ lat: cell.lat, lon: cell.lon }, closedHull)) {
        if (height < interiorMinH) interiorMinH = height;
        if (height > interiorMaxH) interiorMaxH = height;
        if (interiorMaxH - interiorMinH > maxDeltaElevM) {
          hasExtremeElevation = true;
          break;
        }
      }
    }
    if (hasExtremeElevation) continue;

    // Tính độ dốc CHỈ giữa các điểm nội bộ cụm
    let maxSlope = 0;
    let totalSlope = 0;
    let slopeCount = 0;

    for (const { cell, height } of cluster.cells) {
      for (const [dr, dc] of neighbors4) {
        const nr = cell.row + dr;
        const nc = cell.col + dc;
        const nKey = `${nr}_${nc}`;
        if (!clusterCellKeys.has(nKey)) continue;
        const nData = gridMap.get(nKey);
        if (!nData) continue;

        const dH = Math.abs(height - nData.height);
        const distM = dr !== 0 ? neighborDistLat : neighborDistLon;
        const s = (Math.atan2(dH, distM) * 180) / Math.PI;
        if (s > maxSlope) maxSlope = s;
        totalSlope += s;
        slopeCount++;
      }
    }
    const meanSlopeDeg = slopeCount > 0 ? totalSlope / slopeCount : 0;

    const zoneId = `zone_${++zoneIndex}`;
    const targetMaxAreaM2 = maxPatchAreaM2 > 0 ? maxPatchAreaM2 : 10_000;

    // TH 1: Vùng gốc đã thỏa mãn giới hạn trên <= targetMaxAreaM2
    if (rootAreaM2 <= targetMaxAreaM2) {
      const approxRadiusKm = Math.sqrt(rootAreaM2) / 2 / 1000;
      const featureCounts = countFeatures(
        vectorStore,
        closedHull,
        centerLat_,
        centerLon_,
        Math.max(0.1, approxRadiusKm),
      );

      patches.push({
        id: `flatpatch_${patchIndex++}`,
        parentZoneId: zoneId,
        subIndex: 1,
        totalZoneAreaM2: Math.round(rootAreaM2),
        polygon: closedHull,
        centerLat: centerLat_,
        centerLon: centerLon_,
        areaM2: Math.round(rootAreaM2),
        perimeterM: Math.round(rootPerimeterM),
        minElevM: Math.round(interiorMinH * 10) / 10,
        maxElevM: Math.round(interiorMaxH * 10) / 10,
        deltaElevM: Math.round((interiorMaxH - interiorMinH) * 10) / 10,
        meanSlopeDeg: Math.round(meanSlopeDeg * 10) / 10,
        maxSlopeDeg: Math.round(maxSlope * 10) / 10,
        isDeployable: (interiorMaxH - interiorMinH) <= maxDeltaElevM && maxSlope <= maxSlopeDeg && !featureCounts.hasWaterBody,
        buildingCount: featureCounts.buildingCount,
        riverLengthKm: Math.round(featureCounts.riverLengthKm * 100) / 100,
        forestAreaM2: Math.round(featureCounts.forestAreaM2),
        roadCount: featureCounts.roadCount,
        waterWarning: featureCounts.waterWarning,
        samples: cluster.cells.map(({ cell, height }) => ({
          lat: cell.lat,
          lon: cell.lon,
          height,
        })),
      });
    } else {
      // TH 2: Vùng gốc lớn hơn targetMaxAreaM2 -> Chia thành các mảng con <= targetMaxAreaM2
      const stepM = Math.sqrt(targetMaxAreaM2);
      const mPerDegLat = 111_132.92;
      const mPerDegLon = 111_412.84 * Math.cos((centerLat_ * Math.PI) / 180);
      const stepLatDeg = stepM / mPerDegLat;
      const stepLonDeg = stepM / mPerDegLon;

      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const p of closedHull) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }

      const rootPolyGeo = turfPolygon([closedHull.map((p) => [p.lon, p.lat])]);
      let subIdx = 1;

      for (let lat = minLat; lat < maxLat + stepLatDeg * 0.1; lat += stepLatDeg) {
        for (let lon = minLon; lon < maxLon + stepLonDeg * 0.1; lon += stepLonDeg) {
          const cellCoords = [
            [lon, lat],
            [lon, lat + stepLatDeg],
            [lon + stepLonDeg, lat + stepLatDeg],
            [lon + stepLonDeg, lat],
            [lon, lat],
          ];
          const cellPoly = turfPolygon([cellCoords]);
          const isect = intersect(featureCollection([rootPolyGeo, cellPoly]));
          if (!isect || !isect.geometry) continue;

          const polyList: Array<{ coordinates: number[][][] }> = [];
          if (isect.geometry.type === 'Polygon') {
            polyList.push(isect.geometry as { coordinates: number[][][] });
          } else if (isect.geometry.type === 'MultiPolygon') {
            const multi = isect.geometry as { coordinates: number[][][][] };
            for (const coords of multi.coordinates) {
              polyList.push({ coordinates: coords });
            }
          }

          for (const polyGeom of polyList) {
            const subPolyFeature = turfPolygon(polyGeom.coordinates);
            const subAreaM2 = area(subPolyFeature);
            // Bỏ qua các vụn mép cắt quá nhỏ (< 1.000 m²)
            if (subAreaM2 < 1_000) continue;

            const subPoints: LatLonPoint[] = polyGeom.coordinates[0].map(([pLon, pLat]) => ({
              lat: pLat,
              lon: pLon,
            }));

            // Đảm bảo đa giác con đóng kín
            if (
              subPoints.length > 3 &&
              (subPoints[0].lat !== subPoints[subPoints.length - 1].lat ||
                subPoints[0].lon !== subPoints[subPoints.length - 1].lon)
            ) {
              subPoints.push({ lat: subPoints[0].lat, lon: subPoints[0].lon });
            }

            // Trọng tâm mảng con
            let sLat = 0, sLon = 0;
            const ptCount = subPoints.length - 1;
            for (let k = 0; k < ptCount; k++) {
              sLat += subPoints[k].lat;
              sLon += subPoints[k].lon;
            }
            const subCenterLat = sLat / ptCount;
            const subCenterLon = sLon / ptCount;

            // Lọc samples nằm trong mảng con
            const subSamples = cluster.cells
              .filter(({ cell }) => isPointInPolygon({ lat: cell.lat, lon: cell.lon }, subPoints))
              .map(({ cell, height }) => ({ lat: cell.lat, lon: cell.lon, height }));

            let subMinH = interiorMinH;
            let subMaxH = interiorMaxH;
            if (subSamples.length > 0) {
              subMinH = Math.min(...subSamples.map((s) => s.height));
              subMaxH = Math.max(...subSamples.map((s) => s.height));
            }
            const subDeltaH = subMaxH - subMinH;

            // Đếm đối tượng vector cho mảng con
            const subRadiusKm = Math.sqrt(subAreaM2) / 2 / 1000;
            const subFeatureCounts = countFeatures(
              vectorStore,
              subPoints,
              subCenterLat,
              subCenterLon,
              Math.max(0.08, subRadiusKm),
            );

            // Tính chu vi mảng con
            const { perimeterM: subPerimeterM } = polygonAreaAndPerimeter(
              subPoints,
              subCenterLat,
              subCenterLon,
            );

            patches.push({
              id: `flatpatch_${patchIndex++}`,
              parentZoneId: zoneId,
              subIndex: subIdx++,
              totalZoneAreaM2: Math.round(rootAreaM2),
              polygon: subPoints,
              centerLat: subCenterLat,
              centerLon: subCenterLon,
              areaM2: Math.round(subAreaM2),
              perimeterM: Math.round(subPerimeterM),
              minElevM: Math.round(subMinH * 10) / 10,
              maxElevM: Math.round(subMaxH * 10) / 10,
              deltaElevM: Math.round(subDeltaH * 10) / 10,
              meanSlopeDeg: Math.round(meanSlopeDeg * 10) / 10,
              maxSlopeDeg: Math.round(maxSlope * 10) / 10,
              isDeployable: subDeltaH <= maxDeltaElevM && maxSlope <= maxSlopeDeg && !subFeatureCounts.hasWaterBody,
              buildingCount: subFeatureCounts.buildingCount,
              riverLengthKm: Math.round(subFeatureCounts.riverLengthKm * 100) / 100,
              forestAreaM2: Math.round(subFeatureCounts.forestAreaM2),
              roadCount: subFeatureCounts.roadCount,
              waterWarning: subFeatureCounts.waterWarning,
              samples: subSamples.length > 0 ? subSamples : cluster.cells.slice(0, 8).map(({ cell, height }) => ({ lat: cell.lat, lon: cell.lon, height })),
            });
          }
        }
      }
    }
  }

  // Sắp xếp theo diện tích giảm dần
  patches.sort((a, b) => b.areaM2 - a.areaM2);

  const totalAreaM2 = patches.reduce((s, p) => s + p.areaM2, 0);
  const deployableAreaM2 = patches.filter((p) => p.isDeployable).reduce((s, p) => s + p.areaM2, 0);

  return {
    centerLat,
    centerLon,
    radiusKm,
    patches,
    totalAreaM2,
    deployableAreaM2,
    sampledAt: Date.now(),
  };
}
