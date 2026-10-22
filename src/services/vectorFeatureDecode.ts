/** Shared normalization: worker and fallback preserve identical full-data semantics. */
import type { VectorFeature, VectorFeatureKind, VectorFeatureProperties, VectorGeometry, VectorPackInfo } from '../types/vectorFeature';
import { VECTOR_FEATURE_KINDS } from '../types/vectorFeature';
import { computeGeometryBounds } from '../utils/vectorGeometry';

/** Bản chữa GeoJSON thô, đúng những gì script tải ghi ra. */
export interface RawGeoJsonFeature {
  type?: string;
  id?: string | number;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Partial<VectorFeatureProperties> & { kind?: string };
}

export interface RawGeoJson {
  type?: string;
  name?: string;
  bbox?: number[];
  metadata?: {
    region?: string;
    center?: { lat?: number; lon?: number };
    radiusKm?: number;
    downloadedAt?: string;
    featureCount?: number;
    kindCounts?: Record<string, number>;
  };
  features?: RawGeoJsonFeature[];
}

/**
 * Index của gói đã chia ô (file `public/offline-vector/{region}.geojson` khi gói lớn).
 * Phần thật nằm ở các file `{region}/{row}_{col}.geojson`.
 */
export interface RawVectorTileIndex {
  type: 'vector-tile-index';
  region?: string;
  name?: string;
  bbox?: number[];
  cellDeg?: number;
  cellCount?: number;
  /**
   * Danh sách ô THẬT SỰ có dữ liệu, dạng `["row_col", ...]`.
   *
   * Không phải mọi ô trong bbox đều tồn tại: bbox là hình vuông còn dữ liệu lấy
   * trong hình tròn, nên các góc vuông luôn trống. Có danh sách này thì ứng dụng
   * biết chính xác cần tải ô nào — không dò, không 404.
   */
  cells?: string[];
  featureCount?: number;
  kindCounts?: Record<string, number>;
  center?: { lat?: number; lon?: number };
  radiusKm?: number;
  downloadedAt?: string;
}

/** Kiểm tra 1 chuỗi có phải loại đối tượng hợp lệ không. */
function isVectorFeatureKind(value: unknown): value is VectorFeatureKind {
  return typeof value === 'string' && (VECTOR_FEATURE_KINDS as readonly string[]).includes(value);
}

/**
 * Kiểm tra hình học thô có đúng cấu trúc GeoJSON mà hệ thống hỗ trợ không.
 * Hệ thống chỉ nhận `Point` / `LineString` / `Polygon`; mọi `Multi*` đã được loại ở
 * bước chuyển đổi trong script tải, nếu gặp `Multi*` ở đây thì dữ liệu bị lệch.
 */
function normalizeGeometry(raw: RawGeoJsonFeature['geometry']): VectorGeometry | null {
  const type = raw?.type;
  const coords = raw?.coordinates;
  if (!type || !Array.isArray(coords)) return null;

  if (type === 'Point') {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { type: 'Point', coordinates: [lon, lat] };
  }

  if (type === 'LineString') {
    const line = normalizeRing(coords);
    if (!line || line.length < 2) return null;
    return { type: 'LineString', coordinates: line };
  }

  if (type === 'Polygon') {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const rings: [number, number][][] = [];
    for (const rawRing of coords) {
      const ring = normalizeRing(rawRing);
      if (ring && ring.length >= 4) rings.push(ring);
    }
    if (rings.length === 0) return null;
    return { type: 'Polygon', coordinates: rings };
  }

  return null;
}

/** Chuẩn hoá một mảng toạ độ thô thành mảng cặp [lon, lat] hợp lệ. */
function normalizeRing(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const out: [number, number][] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  return out.length > 0 ? out : null;
}

/** Chuyển 1 feature thô thành `VectorFeature` đã có bounds. Trả null nếu không dùng được. */
export function toVectorFeature(raw: RawGeoJsonFeature, regionKey: string): VectorFeature | null {
  const kind = raw.properties?.kind;
  if (!isVectorFeatureKind(kind)) return null;

  const geometry = normalizeGeometry(raw.geometry);
  if (!geometry) return null;

  const bounds = computeGeometryBounds(geometry);
  if (!bounds) return null;

  const id = raw.id !== undefined ? String(raw.id) : `${kind}:${regionKey}:${Math.random()}`;

  return {
    id,
    kind,
    geometry,
    properties: { ...(raw.properties as VectorFeatureProperties), kind },
    bounds,
    regionKey,
  };
}

/** Chuyển metadata thô của file GeoJSON thành `VectorPackInfo`. */
export function toPackInfo(regionKey: string, raw: RawGeoJson): VectorPackInfo {
  const meta = raw.metadata ?? {};
  const bbox = Array.isArray(raw.bbox) ? raw.bbox : null;

  // Ưu tiên tâm do script ghi, fallback tính từ giữa bbox
  let centerLat = meta.center?.lat;
  let centerLon = meta.center?.lon;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
    if (bbox && bbox.length >= 4) {
      centerLon = (Number(bbox[0]) + Number(bbox[2])) / 2;
      centerLat = (Number(bbox[1]) + Number(bbox[3])) / 2;
    } else {
      centerLat = 0;
      centerLon = 0;
    }
  }

  const kindCounts: Partial<Record<VectorFeatureKind, number>> = {};
  if (meta.kindCounts && typeof meta.kindCounts === 'object') {
    for (const [key, value] of Object.entries(meta.kindCounts)) {
      if (isVectorFeatureKind(key) && Number.isFinite(value)) kindCounts[key] = value;
    }
  }

  return {
    regionKey: meta.region ?? regionKey,
    name: raw.name ?? regionKey,
    centerLat: centerLat as number,
    centerLon: centerLon as number,
    radiusKm: Number.isFinite(meta.radiusKm) ? (meta.radiusKm as number) : 0,
    featureCount: Number.isFinite(meta.featureCount) ? (meta.featureCount as number) : 0,
    kindCounts,
    downloadedAt: meta.downloadedAt ?? '',
  };
}

