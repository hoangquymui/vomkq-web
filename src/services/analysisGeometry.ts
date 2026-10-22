/** Generic WGS84 measurements. Turf 7.4.0 uses metres² for area and kilometres for length. */
import { area } from '@turf/area';
import { along } from '@turf/along';
import { bbox } from '@turf/bbox';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { booleanValid } from '@turf/boolean-valid';
import { circle } from '@turf/circle';
import { feature, featureCollection, lineString, polygon } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import { kinks } from '@turf/kinks';
import { length } from '@turf/length';
import { lineSplit } from '@turf/line-split';
import { union } from '@turf/union';
import type { Feature, LineString, Polygon, MultiPolygon, Position } from 'geojson';
import type { AnalysisAoi, AnalysisGeometry, AnalysisPolygon } from '../types/analysis';

export type AnalysisBounds = [number, number, number, number];

function position(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lon, lat] = value;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)
    || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

function positions(value: unknown, minimum: number, closed = false): Position[] | null {
  if (!Array.isArray(value) || value.length < minimum) return null;
  const points = value.map(position);
  if (points.some((point) => point === null)) return null;
  const result = points as Position[];
  if (closed && (result[0][0] !== result.at(-1)![0] || result[0][1] !== result.at(-1)![1])) return null;
  if (new Set(result.map((point) => `${point[0]},${point[1]}`)).size < (closed ? 3 : minimum)) return null;
  return result;
}

function rings(value: unknown): Position[][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result = value.map((ring) => positions(ring, 4, true));
  return result.some((ring) => ring === null) ? null : result as Position[][];
}

/** Reject invalid coordinates instead of silently removing vertices or filling polygon holes. */
export function normalizeAnalysisGeometry(raw: unknown): AnalysisGeometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { type?: string; coordinates?: unknown };
  let geometry: AnalysisGeometry | null = null;
  switch (candidate.type) {
    case 'Point': {
      const coordinates = position(candidate.coordinates);
      if (coordinates) geometry = { type: 'Point', coordinates };
      break;
    }
    case 'MultiPoint': {
      const coordinates = positions(candidate.coordinates, 1);
      if (coordinates) geometry = { type: 'MultiPoint', coordinates };
      break;
    }
    case 'LineString': {
      const coordinates = positions(candidate.coordinates, 2);
      if (coordinates) geometry = { type: 'LineString', coordinates };
      break;
    }
    case 'MultiLineString': {
      if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) break;
      const coordinates = candidate.coordinates.map((line) => positions(line, 2));
      if (coordinates.every((line) => line !== null)) geometry = { type: 'MultiLineString', coordinates: coordinates as Position[][] };
      break;
    }
    case 'Polygon': {
      const coordinates = rings(candidate.coordinates);
      if (coordinates) geometry = { type: 'Polygon', coordinates };
      break;
    }
    case 'MultiPolygon': {
      if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) break;
      const coordinates = candidate.coordinates.map(rings);
      if (coordinates.every((part) => part !== null)) geometry = { type: 'MultiPolygon', coordinates: coordinates as Position[][][] };
      break;
    }
  }
  if (!geometry) return null;
  try {
    if (!booleanValid(geometry)) return null;
    const bounds = geometryBounds(geometry);
    // Antimeridian geometry requires explicit unwrap/reprojection, which this v1 does not implement.
    if (bounds[2] - bounds[0] > 180) return null;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const coordinates of polygons) {
        if (area(polygon(coordinates)) <= 0 || kinks(polygon(coordinates)).features.length) return null;
        const outer = polygon([coordinates[0]]);
        for (const hole of coordinates.slice(1)) {
          if (!booleanPointInPolygon(hole[0], outer, { ignoreBoundary: true })) return null;
        }
      }
    }
    return geometry;
  } catch {
    return null;
  }
}

export function geometryBounds(geometry: AnalysisGeometry): AnalysisBounds {
  return bbox(geometry) as AnalysisBounds;
}

export function boundsIntersect(a: readonly number[], b: readonly number[]): boolean {
  return a.length === 4 && b.length === 4 && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function validateAnalysisAoi(aoi: AnalysisAoi): void {
  if (!aoi || !['point', 'circle', 'polygon'].includes(aoi.mode)
    || aoi.geometry?.type !== 'Polygon' || !normalizeAnalysisGeometry(aoi.geometry)) {
    throw new Error('Vùng phân tích phải là đa giác WGS84 hợp lệ, khép kín và không tự cắt.');
  }
}

/** 64 segments is Turf's default circle approximation; radius is an explicit user value in km. */
export function createCircleAoi(lon: number, lat: number, radiusKm: number): AnalysisAoi {
  if (!position([lon, lat]) || !Number.isFinite(radiusKm) || radiusKm <= 0) throw new Error('Tâm hoặc bán kính vùng không hợp lệ.');
  const geometry = circle([lon, lat], radiusKm, { steps: 64, units: 'kilometers' }).geometry;
  const aoi: AnalysisAoi = { mode: 'circle', label: `Vùng tròn ${radiusKm} km`, geometry };
  validateAnalysisAoi(aoi);
  return aoi;
}

export function createPolygonAoi(coordinates: number[][], label = 'Vùng đa giác'): AnalysisAoi {
  const ring = coordinates.map((point) => [...point]);
  if (ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])) ring.push([...ring[0]]);
  const aoi: AnalysisAoi = { mode: 'polygon', label, geometry: { type: 'Polygon', coordinates: [ring] } };
  validateAnalysisAoi(aoi);
  return aoi;
}

export function isPositionInAoi(lon: number, lat: number, aoi: AnalysisPolygon): boolean {
  return Boolean(position([lon, lat])) && booleanPointInPolygon([lon, lat], aoi);
}

/** Split each original segment at AOI boundaries, then keep inside pieces (including boundary). */
function clipLine(coordinates: number[][], aoi: AnalysisPolygon): number[][][] {
  const result: number[][][] = [];
  for (let index = 1; index < coordinates.length; index++) {
    const segment = lineString([coordinates[index - 1], coordinates[index]]);
    if (length(segment) === 0) continue;
    const pieces = lineSplit(segment, feature(aoi)).features;
    for (const part of pieces.length ? pieces : [segment]) {
      const midpoint = along(part, length(part) / 2).geometry.coordinates;
      if (booleanPointInPolygon(midpoint, aoi)) result.push(part.geometry.coordinates);
    }
  }
  return result;
}

export function clipGeometryToAoi(geometry: AnalysisGeometry, aoi: AnalysisPolygon): AnalysisGeometry | null {
  if (!boundsIntersect(geometryBounds(geometry), geometryBounds(aoi))) return null;
  if (geometry.type === 'Point') return booleanPointInPolygon(geometry.coordinates, aoi) ? geometry : null;
  if (geometry.type === 'MultiPoint') {
    const coordinates = geometry.coordinates.filter((point) => booleanPointInPolygon(point, aoi));
    return coordinates.length ? { type: 'MultiPoint', coordinates } : null;
  }
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const coordinates = lines.flatMap((line) => clipLine(line, aoi));
    return coordinates.length ? { type: 'MultiLineString', coordinates } : null;
  }
  return intersect(featureCollection([feature(geometry), feature(aoi)]))?.geometry ?? null;
}

export function areaKm2(geometry: AnalysisGeometry): number {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon' ? area(geometry) / 1_000_000 : 0;
}

export function lengthKm(geometry: AnalysisGeometry): number {
  return geometry.type === 'LineString' || geometry.type === 'MultiLineString' ? length(feature(geometry), { units: 'kilometers' }) : 0;
}

/** Balanced pairwise union keeps exact area without repeatedly unioning one growing geometry. */
export function unionAreaKm2(geometries: AnalysisGeometry[]): number {
  let level: Feature<Polygon | MultiPolygon>[] = geometries
    .filter((geometry): geometry is Polygon | MultiPolygon => geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
    .map((geometry) => feature(geometry));
  while (level.length > 1) {
    const next: typeof level = [];
    for (let index = 0; index < level.length; index += 2) {
      if (!level[index + 1]) { next.push(level[index]); continue; }
      const merged = union(featureCollection([level[index], level[index + 1]]));
      if (merged) next.push(merged);
    }
    level = next;
  }
  return level.length ? area(level[0]) / 1_000_000 : 0;
}

export type AnalysisLineFeature = Feature<LineString>;
