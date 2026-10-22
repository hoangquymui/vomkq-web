/**
 * DỊCH VỤ KHẢO SÁT VÙNG GIS 1 KM (REGION INVENTORY SERVICE)
 * ========================================================
 *
 * Vai trò: Thống kê tự động toàn bộ dữ liệu GIS trong phạm vi vòng tròn bán kính 1.000m
 * ngay khi người dùng chọn một tọa độ trên bản đồ.
 *
 * TÁI SỬ DỤNG TỪ TÍNH NĂNG "PHÂN TÍCH VÙNG PHỦ":
 * - createCircleAoi(lon, lat, 1.0): Tạo đa giác tròn 64 cạnh WGS84 chuẩn xác.
 * - clipGeometryToAoi(): Cắt xén hình học:
 *     + Đường / sông xuyên qua vùng: Chỉ tính chiều dài đoạn nằm BÊN TRONG vòng tròn.
 *     + Polygon công trình / hồ / rừng: Chỉ tính diện tích phần GIAO BÊN TRONG vòng tròn.
 * - lengthKm(): Tính chiều dài geodesic đoạn đường/sông đã cắt.
 * - areaKm2() & unionAreaKm2(): Tính diện tích đa giác đã cắt (tránh đếm trùng).
 * - loadVectorFeatureStore() & queryFeaturesInRadius(): Nạp kho dữ liệu vector offline.
 * - sampleTerrainOptimized(): Lấy mẫu nhanh độ cao DEM để khảo sát min/max/delta/slope.
 *
 * NGUYÊN TẮC QUAN TRỌNG:
 * - Phân biệt rõ:
 *     + 'observed': Có dữ liệu, đếm chính xác (kể cả khi số lượng = 0).
 *     + 'missing': Chưa có dữ liệu / ngoài phạm vi bao phủ (hiển thị "Chưa có dữ liệu", KHÔNG để số 0).
 *     + 'partial': Dữ liệu chỉ bao phủ một phần.
 */

import * as Cesium from 'cesium';
import {
  createCircleAoi,
  clipGeometryToAoi,
  lengthKm,
  unionAreaKm2,
} from './analysisGeometry';
import type { AnalysisGeometry } from '../types/analysis';
import type { VectorFeatureStore } from './vectorFeatureStore';
import { loadVectorFeatureStore, queryFeaturesInRadius } from './vectorFeatureStore';
import { getTerrainProvider, ensureTerrainProvider } from '../utils/featureAwareness';
import { sampleTerrainOptimized } from '../utils/terrainSampler';
import type { VectorFeatureKind, VectorGeometry } from '../types/vectorFeature';

export type InventoryDataStatus = 'observed' | 'partial' | 'missing' | 'unavailable' | 'outside';

export interface TerrainInventory {
  status: InventoryDataStatus;
  minElevationM: number | null;
  maxElevationM: number | null;
  deltaElevationM: number | null;
  meanSlopeDeg: number | null;
  sampleCount: number;
  validSampleCount: number;
}

export interface BuildingInventory {
  status: InventoryDataStatus;
  count: number | null;
  totalAreaM2: number | null;
  types: Record<string, number>;
}

export interface WaterInventory {
  status: InventoryDataStatus;
  riverCount: number | null;
  riverLengthKm: number | null;
  lakeCount: number | null;
  lakeAreaM2: number | null;
}

export interface ForestInventory {
  status: InventoryDataStatus;
  polygonCount: number | null;
  totalAreaM2: number | null;
  coveragePercent: number | null;
}

export interface HighwayInventory {
  status: InventoryDataStatus;
  segmentCount: number | null;
  totalLengthKm: number | null;
  types: Record<string, number>;
}

export interface OtherGisInventory {
  status: InventoryDataStatus;
  peakCount: number | null;
  placeCount: number | null;
  landAreaM2: number | null;
}

export interface RegionInventoryResult {
  centerLat: number;
  centerLon: number;
  radiusM: number; // 1000m
  areaKm2: number; // π * 1² ≈ 3.14159 km²
  sampledAt: number;
  terrain: TerrainInventory;
  building: BuildingInventory;
  water: WaterInventory;
  forest: ForestInventory;
  highway: HighwayInventory;
  other: OtherGisInventory;
  vectorStoreLoaded: boolean;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Khảo sát nhanh DEM trong bán kính 1km bằng lưới 21x21 điểm (441 điểm phân bố đều).
 * Tốc độ lấy mẫu batch < 100ms, không làm đơ giao diện.
 */
async function sampleRegionTerrain(
  centerLat: number,
  centerLon: number,
  radiusM: number,
): Promise<TerrainInventory> {
  let terrainProvider = getTerrainProvider();
  if (!terrainProvider) {
    terrainProvider = await ensureTerrainProvider();
  }

  if (!terrainProvider) {
    return {
      status: 'missing',
      minElevationM: null,
      maxElevationM: null,
      deltaElevationM: null,
      meanSlopeDeg: null,
      sampleCount: 0,
      validSampleCount: 0,
    };
  }

  const gridSize = 21;
  const cellM = (2 * radiusM) / (gridSize - 1);
  const degPerMeterLat = 1 / 111_000;
  const degPerMeterLon = 1 / (111_000 * Math.cos((centerLat * Math.PI) / 180));

  const positions: Cesium.Cartographic[] = [];
  const coords: { lat: number; lon: number; row: number; col: number }[] = [];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const offsetLatM = (r - (gridSize - 1) / 2) * cellM;
      const offsetLonM = (c - (gridSize - 1) / 2) * cellM;
      const lat = centerLat + offsetLatM * degPerMeterLat;
      const lon = centerLon + offsetLonM * degPerMeterLon;

      if (haversineM(centerLat, centerLon, lat, lon) <= radiusM) {
        coords.push({ lat, lon, row: r, col: c });
        positions.push(Cesium.Cartographic.fromDegrees(lon, lat));
      }
    }
  }

  try {
    let heights: number[];
    try {
      heights = await sampleTerrainOptimized(terrainProvider, centerLon, centerLat, positions, 11);
    } catch {
      heights = await sampleTerrainOptimized(terrainProvider, centerLon, centerLat, positions, 8);
    }

    const validHeights: number[] = [];
    const heightGrid = new Map<string, number>();

    for (let i = 0; i < coords.length; i++) {
      const h = heights[i];
      if (typeof h === 'number' && Number.isFinite(h) && !isNaN(h)) {
        validHeights.push(h);
        heightGrid.set(`${coords[i].row}_${coords[i].col}`, h);
      }
    }

    if (validHeights.length === 0) {
      return {
        status: 'missing',
        minElevationM: null,
        maxElevationM: null,
        deltaElevationM: null,
        meanSlopeDeg: null,
        sampleCount: positions.length,
        validSampleCount: 0,
      };
    }

    // Tính độ dốc trung bình giữa các ô liền kề
    const slopes: number[] = [];
    const neighbors = [
      [1, 0],
      [0, 1],
    ];

    for (const coord of coords) {
      const h1 = heightGrid.get(`${coord.row}_${coord.col}`);
      if (h1 === undefined) continue;

      for (const [dr, dc] of neighbors) {
        const h2 = heightGrid.get(`${coord.row + dr}_${coord.col + dc}`);
        if (h2 === undefined) continue;

        const dH = Math.abs(h2 - h1);
        const dist = cellM;
        const slopeDeg = (Math.atan(dH / dist) * 180) / Math.PI;
        slopes.push(slopeDeg);
      }
    }

    const minElev = Math.min(...validHeights);
    const maxElev = Math.max(...validHeights);
    const deltaElev = maxElev - minElev;
    const meanSlope = slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : 0;
    const isFull = validHeights.length === positions.length;

    return {
      status: isFull ? 'observed' : 'partial',
      minElevationM: Math.round(minElev * 10) / 10,
      maxElevationM: Math.round(maxElev * 10) / 10,
      deltaElevationM: Math.round(deltaElev * 10) / 10,
      meanSlopeDeg: Math.round(meanSlope * 10) / 10,
      sampleCount: positions.length,
      validSampleCount: validHeights.length,
    };
  } catch {
    return {
      status: 'missing',
      minElevationM: null,
      maxElevationM: null,
      deltaElevationM: null,
      meanSlopeDeg: null,
      sampleCount: positions.length,
      validSampleCount: 0,
    };
  }
}

/**
 * Chuyển đổi VectorGeometry sang AnalysisGeometry để sử dụng với clipGeometryToAoi.
 */
function convertToAnalysisGeometry(geom: VectorGeometry): AnalysisGeometry | null {
  if (!geom || !geom.type) return null;
  if (geom.type === 'Point') {
    return { type: 'Point', coordinates: [geom.coordinates[0], geom.coordinates[1]] };
  }
  if (geom.type === 'LineString') {
    return {
      type: 'LineString',
      coordinates: geom.coordinates.map((pt) => [pt[0], pt[1]]),
    };
  }
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map((ring) => ring.map((pt) => [pt[0], pt[1]])),
    };
  }
  return null;
}

/**
 * Khảo sát toàn diện đối tượng GIS trong phạm vi bán kính 1 km.
 */
export async function surveyRegionInventory(
  centerLat: number,
  centerLon: number,
  radiusKm = 1.0,
): Promise<RegionInventoryResult> {
  const radiusM = radiusKm * 1000;
  const circleAoi = createCircleAoi(centerLon, centerLat, radiusKm);
  const aoiPolygon = circleAoi.geometry;
  const aoiAreaKm2 = circleAoi.geometry ? Math.PI * radiusKm * radiusKm : Math.PI;

  // 1. Khảo sát dữ liệu DEM
  const terrainResult = await sampleRegionTerrain(centerLat, centerLon, radiusM);

  // 2. Nạp kho dữ liệu vector offline
  let vectorStore: VectorFeatureStore | null = null;
  try {
    vectorStore = await loadVectorFeatureStore();
  } catch (err) {
    console.warn('Không thể nạp kho dữ liệu vector:', err);
  }

  // Khởi tạo trạng thái mặc định
  let vectorStatus: InventoryDataStatus = 'missing';

  const buildings: { geom: AnalysisGeometry; type: string }[] = [];
  const rivers: AnalysisGeometry[] = [];
  const streams: AnalysisGeometry[] = [];
  const lakes: AnalysisGeometry[] = [];
  const forests: AnalysisGeometry[] = [];
  const highways: { geom: AnalysisGeometry; type: string }[] = [];
  const peaks: AnalysisGeometry[] = [];
  const places: AnalysisGeometry[] = [];
  const lands: AnalysisGeometry[] = [];

  if (vectorStore && vectorStore.featureCount > 0) {
    // Kiểm tra xem vùng có nằm trong phạm vi của bất kỳ gói vector nào không
    const packsInRange = vectorStore.packs.filter((pack) => {
      const distM = haversineM(centerLat, centerLon, pack.info.centerLat, pack.info.centerLon);
      return distM <= (pack.info.radiusKm + radiusKm) * 1000;
    });

    if (packsInRange.length > 0) {
      vectorStatus = 'observed';
    } else {
      vectorStatus = 'outside';
    }

    // Lấy tất cả feature trong bounding box của vòng tròn 1 km
    const candidates = queryFeaturesInRadius(vectorStore, centerLat, centerLon, radiusKm);

    for (const f of candidates) {
      const aGeom = convertToAnalysisGeometry(f.geometry);
      if (!aGeom) continue;

      // CẮT HÌNH HỌC VÀO VÒNG TRÒN 1 KM (Chỉ lấy phần nằm trong vòng tròn)
      const clipped = clipGeometryToAoi(aGeom, aoiPolygon);
      if (!clipped) continue;

      const kind = f.properties.kind as VectorFeatureKind;
      const subType =
        f.properties.building ||
        f.properties.highway ||
        f.properties.waterway ||
        f.properties.natural ||
        f.properties.landuse ||
        'standard';

      switch (kind) {
        case 'building':
          buildings.push({ geom: clipped, type: subType });
          break;
        case 'water_river':
          rivers.push(clipped);
          break;
        case 'water_stream':
          streams.push(clipped);
          break;
        case 'water_body':
          lakes.push(clipped);
          break;
        case 'forest':
          forests.push(clipped);
          break;
        case 'highway':
          highways.push({ geom: clipped, type: subType });
          break;
        case 'peak':
          peaks.push(clipped);
          break;
        case 'place':
          places.push(clipped);
          break;
        case 'land':
          lands.push(clipped);
          break;
      }
    }
  }

  // --- Tính toán thống kê chi tiết ---

  // Công trình (building)
  let buildingInventory: BuildingInventory;
  if (vectorStatus === 'missing' || vectorStatus === 'outside') {
    buildingInventory = {
      status: vectorStatus,
      count: null,
      totalAreaM2: null,
      types: {},
    };
  } else {
    const buildingPolygons = buildings
      .map((b) => b.geom)
      .filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon');
    const totalAreaKm2 = unionAreaKm2(buildingPolygons);
    const types: Record<string, number> = {};
    for (const b of buildings) {
      types[b.type] = (types[b.type] || 0) + 1;
    }
    buildingInventory = {
      status: 'observed',
      count: buildings.length,
      totalAreaM2: Math.round(totalAreaKm2 * 1_000_000),
      types,
    };
  }

  // Sông suối & Mặt nước
  let waterInventory: WaterInventory;
  if (vectorStatus === 'missing' || vectorStatus === 'outside') {
    waterInventory = {
      status: vectorStatus,
      riverCount: null,
      riverLengthKm: null,
      lakeCount: null,
      lakeAreaM2: null,
    };
  } else {
    const allWaterLines = [...rivers, ...streams];
    const totalRiverLengthKm = allWaterLines.reduce((sum, g) => sum + lengthKm(g), 0);
    const lakePolygons = lakes.filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon');
    const totalLakeAreaKm2 = unionAreaKm2(lakePolygons);

    waterInventory = {
      status: 'observed',
      riverCount: allWaterLines.length,
      riverLengthKm: Math.round(totalRiverLengthKm * 100) / 100,
      lakeCount: lakes.length,
      lakeAreaM2: Math.round(totalLakeAreaKm2 * 1_000_000),
    };
  }

  // Rừng (forest)
  let forestInventory: ForestInventory;
  if (vectorStatus === 'missing' || vectorStatus === 'outside') {
    forestInventory = {
      status: vectorStatus,
      polygonCount: null,
      totalAreaM2: null,
      coveragePercent: null,
    };
  } else {
    const forestPolygons = forests.filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon');
    const totalForestAreaKm2 = unionAreaKm2(forestPolygons);
    const coveragePercent = (totalForestAreaKm2 / aoiAreaKm2) * 100;

    forestInventory = {
      status: 'observed',
      polygonCount: forests.length,
      totalAreaM2: Math.round(totalForestAreaKm2 * 1_000_000),
      coveragePercent: Math.min(100, Math.round(coveragePercent * 10) / 10),
    };
  }

  // Đường giao thông (highway)
  let highwayInventory: HighwayInventory;
  if (vectorStatus === 'missing' || vectorStatus === 'outside') {
    highwayInventory = {
      status: vectorStatus,
      segmentCount: null,
      totalLengthKm: null,
      types: {},
    };
  } else {
    const totalRoadLengthKm = highways.reduce((sum, h) => sum + lengthKm(h.geom), 0);
    const types: Record<string, number> = {};
    for (const h of highways) {
      types[h.type] = (types[h.type] || 0) + 1;
    }
    highwayInventory = {
      status: 'observed',
      segmentCount: highways.length,
      totalLengthKm: Math.round(totalRoadLengthKm * 100) / 100,
      types,
    };
  }

  // Dữ liệu khác
  let otherInventory: OtherGisInventory;
  if (vectorStatus === 'missing' || vectorStatus === 'outside') {
    otherInventory = {
      status: vectorStatus,
      peakCount: null,
      placeCount: null,
      landAreaM2: null,
    };
  } else {
    const landPolygons = lands.filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon');
    const totalLandAreaKm2 = unionAreaKm2(landPolygons);
    otherInventory = {
      status: 'observed',
      peakCount: peaks.length,
      placeCount: places.length,
      landAreaM2: Math.round(totalLandAreaKm2 * 1_000_000),
    };
  }

  return {
    centerLat,
    centerLon,
    radiusM,
    areaKm2: Math.round(aoiAreaKm2 * 100) / 100,
    sampledAt: Date.now(),
    terrain: terrainResult,
    building: buildingInventory,
    water: waterInventory,
    forest: forestInventory,
    highway: highwayInventory,
    other: otherInventory,
    vectorStoreLoaded: vectorStore !== null && vectorStore.featureCount > 0,
  };
}
