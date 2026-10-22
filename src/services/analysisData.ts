import type {
  AnalysisAoi, AnalysisDataStatus, AnalysisDataset, AnalysisFeature, AnalysisFinding,
  AnalysisGeometry, AnalysisMeasurement, AnalysisSnapshot, AnalysisTerrainSample,
} from '../types/analysis';
import {
  areaKm2, boundsIntersect, clipGeometryToAoi, geometryBounds, isPositionInAoi,
  lengthKm, normalizeAnalysisGeometry, unionAreaKm2, validateAnalysisAoi,
} from './analysisGeometry';
import { VECTOR_FEATURE_KINDS, VECTOR_KIND_LABELS } from '../types/vectorFeature';

interface CoverageRequest {
  bbox: number[];
  kinds: string[];
  status: 'success' | 'empty' | 'failed' | 'unknown';
}
interface CoverageLedger {
  schemaVersion: 1;
  requestedKinds: string[];
  extraction?: string;
  requests: CoverageRequest[];
}
interface RawPack {
  type?: string;
  region?: string;
  bbox?: number[];
  downloadedAt?: string;
  cellDeg?: number;
  cells?: string[];
  cellBounds?: Record<string, number[]>;
  coverageLedger?: CoverageLedger;
  metadata?: { downloadedAt?: string; coverageLedger?: CoverageLedger };
  features?: unknown[];
}
interface RawFeature { type?: string; id?: string | number; geometry?: unknown; properties?: Record<string, unknown> }

export interface AnalysisDataOptions {
  baseUrl: string;
  regions: string[];
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
  terrainSamples?: AnalysisTerrainSample[];
  /** Dependency injection used by tests; browser implementation only fetches local same-origin files. */
  fetcher?: typeof fetch;
}

// Reuse the existing vector store's per-file limit. LRU cache is a bounded two-file working set.
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_CACHE_BYTES = 2 * MAX_FILE_BYTES;
// Four disk reads prevent one analysis monopolising browser connections; worker CPU stays sequential.
const FETCH_CONCURRENCY = 4;
const BATCH_SIZE = 1_024; // Yield/cancellation checkpoint; worker termination remains immediate on UI cancel.
const SNAPSHOT_FEATURE_LIMIT = 2_000; // Share/map preview budget; full metrics are computed before this cap.
const SNAPSHOT_GEOMETRY_BYTES = 4 * 1024 * 1024;
const cache = new Map<string, { value: RawPack; bytes: number; hash: string }>();
let cachedBytes = 0;

export function resetAnalysisDataCache(): void { cache.clear(); cachedBytes = 0; }

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');
}

async function yieldBatch(signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertActive(signal);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readPack(url: string, options: AnalysisDataOptions): Promise<{ value: RawPack; bytes: number; hash: string }> {
  assertActive(options.signal);
  const hit = cache.get(url);
  if (hit) { cache.delete(url); cache.set(url, hit); return hit; }
  const response = await (options.fetcher ?? fetch)(url, { signal: options.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error(`File vector vượt ${MAX_FILE_BYTES / 1024 / 1024} MiB.`);
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        assertActive(options.signal);
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) throw new Error('File vector quá lớn.');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder().decode(bytes);
  } else text = await response.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_FILE_BYTES) throw new Error('File vector quá lớn.');
  const value = JSON.parse(text) as RawPack;
  if (!value || !['FeatureCollection', 'vector-tile-index'].includes(value.type ?? '')) throw new Error('Gói vector không đúng định dạng.');
  const item = { value, bytes, hash: await sha256(text) };
  while (cachedBytes + bytes > MAX_CACHE_BYTES && cache.size) {
    const key = cache.keys().next().value!;
    cachedBytes -= cache.get(key)!.bytes;
    cache.delete(key);
  }
  cache.set(url, item);
  cachedBytes += bytes;
  return item;
}

function safeName(name: string): boolean { return /^[A-Za-z0-9_.-]+$/.test(name) && name !== '.' && name !== '..'; }

/** True cell bounds are required for complete ROI selection. Legacy names are only approximate anchors. */
export function selectAnalysisCells(index: RawPack, aoi: AnalysisAoi): string[] {
  const bounds = geometryBounds(aoi.geometry);
  const cellDeg = Number(index.cellDeg);
  return (Array.isArray(index.cells) ? index.cells : []).filter((name) => {
    if (!safeName(name)) return false;
    const exact = index.cellBounds?.[name];
    if (Array.isArray(exact) && exact.length === 4 && exact.every(Number.isFinite)) return boundsIntersect(exact, bounds);
    const match = /^(-?\d+)_(-?\d+)$/.exec(name);
    if (!match || !Number.isFinite(cellDeg) || cellDeg <= 0) return true; // Includes NaN_NaN: valid geometry must not be dropped.
    const row = Number(match[1]); const col = Number(match[2]);
    return boundsIntersect([col * cellDeg, row * cellDeg, (col + 1) * cellDeg, (row + 1) * cellDeg], bounds);
  });
}

function bboxPolygon(bounds: number[]): AnalysisGeometry {
  const [west, south, east, north] = bounds;
  return { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

/** Coverage means successful acquisition of this query scope, never completeness of the real world. */
export function coverageForKind(ledger: CoverageLedger | undefined, kind: string, aoi: AnalysisAoi): AnalysisDataStatus {
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.requests)) return 'unknown';
  const relevant = ledger.requests.filter((request) => Array.isArray(request.kinds) && request.kinds.includes(kind)
    && Array.isArray(request.bbox) && request.bbox.length === 4 && request.bbox.every(Number.isFinite)
    && boundsIntersect(request.bbox, geometryBounds(aoi.geometry)));
  if (!relevant.length) return 'unknown';
  const good = relevant.filter((request) => ['success', 'empty'].includes(request.status));
  if (!good.length) return relevant.some((request) => request.status === 'failed') ? 'missing' : 'unknown';
  const covered = good.map((request) => clipGeometryToAoi(bboxPolygon(request.bbox), aoi.geometry)).filter((part): part is AnalysisGeometry => Boolean(part));
  const enough = unionAreaKm2(covered) >= areaKm2(aoi.geometry) * (1 - 1e-7);
  // Old extraction drops some geometry by anchor and excludes unsupported OSM relations.
  // Transport success is recorded honestly but cannot justify a zero-object conclusion.
  return enough && ledger.extraction === 'complete-geojson-scope' ? 'observed' : 'partial';
}

function stableFeatureId(feature: RawFeature, sourceId: string, index: number): string {
  const id = feature.id;
  if (typeof id === 'string' && /(?:node|way|relation)\/\d+/.test(id)) return `osm:${id.match(/(?:node|way|relation)\/\d+/)![0]}`;
  if (id !== undefined) return `${sourceId}:feature:${String(id)}`;
  const properties = feature.properties ?? {};
  if (properties.osm_id !== undefined && properties.osm_type) return `osm:${String(properties.osm_type)}/${String(properties.osm_id)}`;
  return `${sourceId}:anonymous:${index}`;
}

/** Cheap conservative prefilter; never uses this unvalidated geometry in a measurement. */
function rawGeometryBounds(raw: unknown): number[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { coordinates?: unknown };
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  const pending: unknown[] = [candidate.coordinates];
  while (pending.length) {
    const coordinates = pending.pop();
    if (!Array.isArray(coordinates)) continue;
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) continue;
      west = Math.min(west, coordinates[0]); east = Math.max(east, coordinates[0]);
      south = Math.min(south, coordinates[1]); north = Math.max(north, coordinates[1]);
    } else for (const nested of coordinates) pending.push(nested);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

interface Candidate { id: string; kind: string; geometry: AnalysisGeometry; properties: Record<string, unknown>; sourceIds: string[]; signature: string }

/** Worker entrypoint also exposed for deterministic geometry/source tests. */
export async function measureAnalysisData(aoi: AnalysisAoi, options: AnalysisDataOptions): Promise<AnalysisSnapshot> {
  validateAnalysisAoi(aoi);
  assertActive(options.signal);
  const snapshot: AnalysisSnapshot = {
    schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), aoi: structuredClone(aoi),
    datasets: [{ id: 'analysis:aoi', version: 'wgs84-turf-7.4.0-v1', downloadedAt: null, coverage: 'observed', bounds: geometryBounds(aoi.geometry) }],
    measurements: [], findings: [], evidence: [], features: [],
  };
  const addFinding = (code: string, message: string, sourceIds: string[], severity: AnalysisFinding['severity'] = 'warning', geometry?: AnalysisGeometry) => {
    const finding: AnalysisFinding = { id: `finding:${snapshot.findings.length + 1}`, code, severity, message, sourceIds, geometry };
    snapshot.findings.push(finding);
    snapshot.evidence.push({ id: `evidence:${finding.id}`, kind: 'gis', sourceId: sourceIds[0] ?? 'analysis:aoi',
      version: snapshot.datasets.find((dataset) => dataset.id === sourceIds[0])?.version ?? '1', label: message,
      fieldPath: `findings.${finding.id}`, excerpt: message, geometry });
  };
  const addMeasurement = (measurement: AnalysisMeasurement) => {
    snapshot.measurements.push(measurement);
    snapshot.evidence.push({ id: `evidence:${measurement.id}`, kind: 'gis', sourceId: measurement.sourceIds[0] ?? 'analysis:aoi',
      version: snapshot.datasets.find((dataset) => dataset.id === measurement.sourceIds[0])?.version ?? '1',
      label: measurement.label, value: measurement.value, unit: measurement.unit, fieldPath: `measurements.${measurement.id}`, geometry: aoi.geometry });
  };
  addMeasurement({ id: 'aoi:area', label: 'Diện tích vùng đã chọn', value: areaKm2(aoi.geometry), unit: 'km²',
    method: 'Turf 7.4.0 spherical area, WGS84, diện tích đa giác đã chọn (vòng tròn xấp xỉ 64 cạnh)', status: 'observed', sourceIds: ['analysis:aoi'] });

  const candidates = new Map<string, Candidate>();
  const conflicts = new Set<string>();
  const kindStatus = new Map<string, AnalysisDataStatus[]>();
  const kindSources = new Map<string, string[]>();
  let invalid = 0; let duplicates = 0;
  const failedSources = new Set<string>();
  options.onStage?.('Đọc manifest và các ô giao vùng');
  const regions = [...new Set(options.regions)].filter(safeName);
  for (const region of regions) {
    assertActive(options.signal);
    const sourceId = `vector:${region}`;
    const base = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    let item: Awaited<ReturnType<typeof readPack>>;
    try { item = await readPack(`${base}offline-vector/${region}.geojson`, options); }
    catch (error) {
      assertActive(options.signal);
      snapshot.datasets.push({ id: sourceId, version: 'unavailable', downloadedAt: null, coverage: 'partial' });
      failedSources.add(sourceId);
      addFinding('pack-unavailable', `Không đọc được gói ${region}: ${String(error)}`, [sourceId], 'error', aoi.geometry);
      continue;
    }
    const pack = item.value;
    const bounds = Array.isArray(pack.bbox) && pack.bbox.length === 4 && pack.bbox.every(Number.isFinite) ? pack.bbox : undefined;
    const downloadedAt = pack.downloadedAt ?? pack.metadata?.downloadedAt ?? null;
    const ledger = pack.coverageLedger ?? pack.metadata?.coverageLedger;
    const outside = bounds ? !boundsIntersect(bounds, geometryBounds(aoi.geometry)) : false;
    const dataset: AnalysisDataset = { id: sourceId, version: downloadedAt ?? `sha256:${item.hash}`, downloadedAt,
      coverage: outside ? 'outside' : ledger ? 'partial' : 'unknown', bounds, hash: item.hash };
    snapshot.datasets.push(dataset);
    if (outside) continue;
    if (!ledger) addFinding('coverage-unverified', `Gói ${region} chưa có nhật ký truy vấn; chưa thể xác minh dữ liệu đầy đủ theo loại đối tượng.`, [sourceId], 'warning', aoi.geometry);
    for (const kind of VECTOR_FEATURE_KINDS) {
      const states = kindStatus.get(kind) ?? [];
      states.push(coverageForKind(ledger, kind, aoi)); kindStatus.set(kind, states);
      const sources = kindSources.get(kind) ?? []; sources.push(sourceId); kindSources.set(kind, sources);
    }
    let documents: RawPack[] = [];
    const sourceHashes: string[] = [item.hash];
    if (pack.type === 'FeatureCollection') documents = [pack];
    else {
      if (!Array.isArray(pack.cells)) {
        failedSources.add(sourceId);
        addFinding('cell-index-missing', `Gói ${region} không có danh sách ô; không suy đoán file tồn tại.`, [sourceId], 'error', aoi.geometry);
        continue;
      }
      const selected = selectAnalysisCells(pack, aoi);
      if (pack.cells.some((cell) => !pack.cellBounds?.[cell])) addFinding('legacy-spatial-index',
        `Gói ${region} dùng ô theo điểm đầu thay vì bounds hình học; thống kê chỉ phản ánh các đối tượng đã đọc, có thể thiếu hình học kéo dài từ ô khác.`, [sourceId], 'warning', aoi.geometry);
      for (let offset = 0; offset < selected.length; offset += FETCH_CONCURRENCY) {
        const names = selected.slice(offset, offset + FETCH_CONCURRENCY);
        const loaded = await Promise.allSettled(names.map((name) => readPack(`${base}offline-vector/${region}/${name}.geojson`, options)));
        for (let index = 0; index < loaded.length; index++) {
          const result = loaded[index];
          if (result.status === 'fulfilled' && result.value.value.type === 'FeatureCollection') {
            documents.push(result.value.value); sourceHashes.push(`${names[index]}:${result.value.hash}`);
          }
          else {
            assertActive(options.signal); failedSources.add(sourceId);
            addFinding('cell-unavailable', `Không đọc được ô ${region}/${names[index]}; ô thiếu khác với ô trả về rỗng.`, [sourceId], 'error', aoi.geometry);
          }
        }
      }
    }
    dataset.hash = await sha256(sourceHashes.sort().join('\n'));
    options.onStage?.(`Chuẩn hóa hình học ${region}`);
    let featureIndex = 0;
    for (const document of documents) {
      for (const unknownFeature of document.features ?? []) {
        if (featureIndex++ % BATCH_SIZE === 0) await yieldBatch(options.signal);
        const raw = unknownFeature as RawFeature;
        if (!raw || raw.type !== 'Feature') { invalid++; continue; }
        // Legacy NaN_NaN cells may hold an entire city's valid polygons. Validate topology only
        // after a conservative bounds intersection, keeping parsing/measurement off the main thread.
        const approximateBounds = rawGeometryBounds(raw.geometry);
        if (approximateBounds && !boundsIntersect(approximateBounds, geometryBounds(aoi.geometry))) continue;
        const geometry = normalizeAnalysisGeometry(raw.geometry);
        if (!geometry) { invalid++; continue; }
        if (!boundsIntersect(geometryBounds(geometry), geometryBounds(aoi.geometry))) continue;
        const kind = typeof raw.properties?.kind === 'string' ? raw.properties.kind : 'other';
        const id = stableFeatureId(raw, sourceId, featureIndex);
        const signature = JSON.stringify({ kind, geometry });
        if (conflicts.has(id)) continue;
        const existing = candidates.get(id);
        if (existing) {
          if (existing.signature === signature) { duplicates++; if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId); }
          else {
            conflicts.add(id); candidates.delete(id);
            addFinding('geometry-conflict', `Nguồn ${id} có hình học hoặc loại khác nhau; loại khỏi phép đo để tránh chọn phiên bản tùy ý.`, [...existing.sourceIds, sourceId], 'error', geometry);
          }
        } else candidates.set(id, { id, kind, geometry, properties: raw.properties ?? {}, sourceIds: [sourceId], signature });
      }
    }
    documents = [];
  }
  if (invalid) addFinding('invalid-geometry', `${invalid} đối tượng trong phần dữ liệu được xét có hình học lỗi và bị loại khỏi phép đo; không phải số lỗi của toàn gói.`, [...kindSources.values()].flat(), 'warning', aoi.geometry);
  if (duplicates) addFinding('duplicates-removed', `${duplicates} bản sao cùng định danh và hình học được khử trùng.`, [...kindSources.values()].flat(), 'info', aoi.geometry);
  if (failedSources.size) for (const states of kindStatus.values()) states.push('missing');
  if (!regions.length) addFinding('no-vector-packs', 'Chưa có gói vector local được đăng ký.', ['analysis:aoi'], 'warning', aoi.geometry);

  options.onStage?.('Cắt hình học và tính phép đo');
  const byKind = new Map<string, AnalysisGeometry[]>();
  const counts = new Map<string, number>();
  let geometryBytes = 0; let clippedCount = 0;
  for (const candidate of candidates.values()) {
    if (clippedCount % BATCH_SIZE === 0) await yieldBatch(options.signal);
    let clipped: AnalysisGeometry | null;
    try { clipped = clipGeometryToAoi(candidate.geometry, aoi.geometry); }
    catch {
      invalid++;
      addFinding('clipping-failed', `Không cắt được hình học ${candidate.id}; đối tượng bị loại khỏi phép đo.`, candidate.sourceIds, 'error', candidate.geometry);
      continue;
    }
    if (!clipped) continue;
    clippedCount++;
    const list = byKind.get(candidate.kind) ?? []; list.push(clipped); byKind.set(candidate.kind, list);
    counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1);
    const feature: AnalysisFeature = { type: 'Feature', id: candidate.id, geometry: clipped,
      properties: { ...candidate.properties, kind: candidate.kind, sourceIds: candidate.sourceIds } };
    const bytes = new TextEncoder().encode(JSON.stringify(feature)).byteLength;
    if (snapshot.features!.length < SNAPSHOT_FEATURE_LIMIT && geometryBytes + bytes <= SNAPSHOT_GEOMETRY_BYTES) {
      snapshot.features!.push(feature); geometryBytes += bytes;
      snapshot.evidence.push({ id: `evidence:feature:${candidate.id}`, kind: 'gis', sourceId: candidate.sourceIds[0],
        version: snapshot.datasets.find((dataset) => dataset.id === candidate.sourceIds[0])!.version,
        label: String(candidate.properties.name ?? candidate.id), fieldPath: `features.${snapshot.features!.length - 1}`, geometry: clipped });
    }
  }
  if (clippedCount > snapshot.features!.length) addFinding('preview-subset',
    `Bản chụp kèm ${snapshot.features!.length}/${clippedCount} hình học để giới hạn bộ nhớ và dung lượng chia sẻ; phép đo vẫn dùng tất cả đối tượng đọc được.`, ['analysis:aoi'], 'info', aoi.geometry);

  const kinds = new Set<string>([...VECTOR_FEATURE_KINDS, ...byKind.keys()]);
  const anyIntersecting = snapshot.datasets.some((dataset) => dataset.id.startsWith('vector:') && dataset.coverage !== 'outside');
  for (const kind of kinds) {
    const geometries = byKind.get(kind) ?? [];
    const count = counts.get(kind) ?? 0;
    const states = kindStatus.get(kind) ?? [];
    let status: AnalysisDataStatus = !anyIntersecting && regions.length ? 'outside'
      : states.includes('missing') || invalid || conflicts.size ? (count ? 'partial' : 'missing')
        : states.includes('observed') && !states.includes('partial') && !states.includes('unknown') ? 'observed'
          : count ? 'partial' : states.includes('partial') ? 'partial' : 'unknown';
    const sourceIds = [...new Set([...(kindSources.get(kind) ?? (failedSources.size ? [...failedSources] : [])), 'analysis:aoi'])];
    const label = VECTOR_KIND_LABELS[kind as keyof typeof VECTOR_KIND_LABELS] ?? kind;
    const countValue = count || status === 'observed' ? count : null;
    addMeasurement({ id: `vector:${kind}:count`, label: `${label}: đối tượng quan sát giao vùng`, value: countValue, unit: 'đối tượng',
      method: 'Khử trùng định danh nguồn, loại xung đột, giao hình học với AOI; số đếm thuộc các ô đã đọc', status, kind, sourceIds });
    const polygons = geometries.filter((geometry) => ['Polygon', 'MultiPolygon'].includes(geometry.type));
    const lines = geometries.filter((geometry) => ['LineString', 'MultiLineString'].includes(geometry.type));
    if (polygons.length) {
      let value: number | null = null;
      try { value = unionAreaKm2(polygons); }
      catch { status = 'missing'; addFinding('union-failed', `Không hợp nhất được vùng ${label}; diện tích chưa xác minh.`, sourceIds, 'error', aoi.geometry); }
      addMeasurement({ id: `vector:${kind}:area`, label: `${label}: diện tích hợp nhất trong vùng`, value, unit: 'km²',
        method: 'Turf 7.4.0 intersect AOI + union theo loại, spherical area / 1 000 000', status, kind, sourceIds });
      addMeasurement({ id: `vector:${kind}:area-share`, label: `${label}: tỷ lệ diện tích ghi nhận trong vùng`,
        value: value === null ? null : value / areaKm2(aoi.geometry) * 100, unit: '%',
        method: 'Diện tích hợp nhất đã cắt / diện tích AOI × 100; dữ liệu thiếu không được ngoại suy', status, kind, sourceIds });
    }
    if (lines.length) addMeasurement({ id: `vector:${kind}:length`, label: `${label}: chiều dài trong vùng`, value: lines.reduce((sum, geometry) => sum + lengthKm(geometry), 0), unit: 'km',
      method: 'Turf 7.4.0 chia tuyến tại biên và lỗ AOI (splitter precision 7 chữ số), giữ đoạn trong vùng, tổng chiều dài geodesic', status, kind, sourceIds });
  }

  const samples = (options.terrainSamples ?? [])
    .filter((sample) => typeof sample.sourceId === 'string' && sample.sourceId.length > 0 && isPositionInAoi(sample.lon, sample.lat, aoi.geometry))
    .map((sample) => ({ ...sample, height: typeof sample.height === 'number' && Number.isFinite(sample.height) ? sample.height : null }));
  snapshot.terrainSamples = samples;
  const validSamples = samples.filter((sample) => typeof sample.height === 'number' && Number.isFinite(sample.height));
  const terrainSources = [...new Set(samples.map((sample) => sample.sourceId))];
  if (!terrainSources.length) terrainSources.push('terrain:unavailable');
  for (const sourceId of terrainSources) {
    const sourceSamples = samples.filter((sample) => sample.sourceId === sourceId);
    const sourceValid = sourceSamples.filter((sample) => sample.height !== null);
    snapshot.datasets.push({ id: sourceId, version: sourceId === 'terrain:unavailable' ? 'unavailable' : 'sampled', downloadedAt: null,
      coverage: sourceValid.length ? sourceValid.length === sourceSamples.length ? 'observed' : 'partial' : 'unknown',
      // Fingerprint supplied samples, not a claim that the complete terrain archive was hashed.
      hash: await sha256(JSON.stringify(sourceSamples)),
    });
  }
  const heights = validSamples.map((sample) => sample.height!);
  const terrainStatus: AnalysisDataStatus = heights.length ? heights.length === samples.length ? 'observed' : 'partial' : 'missing';
  const terrainMethod = `Các điểm lấy mẫu trong AOI (${samples.length} điểm), nguồn ${terrainSources.join(', ')}; chỉ thống kê mẫu, không đại diện cực trị toàn vùng`;
  for (const [id, label, value] of [
    ['min', 'Cao độ thấp nhất trong các mẫu', heights.length ? Math.min(...heights) : null],
    ['max', 'Cao độ cao nhất trong các mẫu', heights.length ? Math.max(...heights) : null],
    ['mean', 'Cao độ trung bình các mẫu', heights.length ? heights.reduce((sum, height) => sum + height, 0) / heights.length : null],
  ] as const) addMeasurement({ id: `terrain:${id}`, label, value, unit: 'm', method: terrainMethod, status: terrainStatus, sourceIds: terrainSources });
  if (!samples.length || heights.length < samples.length) addFinding('terrain-missing', !samples.length
    ? 'Chưa có mẫu cao độ terrain hợp lệ trong vùng; không thay bằng cao độ 0.'
    : `${samples.length - heights.length}/${samples.length} mẫu cao độ chưa có dữ liệu; không thay bằng 0.`, terrainSources, 'warning', aoi.geometry);
  for (const [index, sample] of samples.entries()) if (typeof sample.height === 'number' && Number.isFinite(sample.height)) snapshot.evidence.push({ id: `evidence:terrain:${index}`, kind: 'gis', sourceId: sample.sourceId,
    version: 'sampled', fieldPath: `terrainSamples.${index}`, label: 'Mẫu cao độ địa hình', value: sample.height, unit: 'm', geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] } });
  options.onStage?.('Hoàn tất phép đo và kiểm tra nguồn');
  assertActive(options.signal);
  return snapshot;
}
