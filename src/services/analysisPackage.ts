import { zip, unzip } from 'fflate';
import type { AnalysisGeometry, AnalysisReport, AnalysisResult, AnalysisSnapshot, EvidenceRef, SharedAnalysis } from '../types/analysis';

/** Engineering guards for user-shared local files, not dataset/model limits.
 * Compressed input matches the existing Core upload ceiling (100 MiB);
 * expanded input is capped at 256 MiB to bound allocation before decompression. */
export const ANALYSIS_PACKAGE_COMPRESSED_LIMIT = 100 * 1024 * 1024;
export const ANALYSIS_PACKAGE_EXPANDED_LIMIT = 256 * 1024 * 1024;
const MANIFEST_LIMIT = 64 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const workflows = new Set(['gis-analysis-v1', 'data-quality-v1', 'document-qa-v1', 'report-summary-v1']);
type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: cần object.`);
  return value as JsonObject;
}
function text(value: unknown, label: string, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error(`${label}: cần văn bản.`);
}
function array(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}: cần danh sách.`);
}
function strings(value: unknown, label: string): void { array(value, label); value.forEach((item) => text(item, label)); }
function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}: số không hợp lệ.`);
}
function date(value: unknown, label: string): void { text(value, label); if (!Number.isFinite(Date.parse(value))) throw new Error(`${label}: thời điểm không hợp lệ.`); }
/** Property order may differ between canonical Core JSON and worker GeoJSON. */
function exact(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => exact(item, right[i]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as JsonObject, b = right as JsonObject, keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && exact(a[key], b[key]));
}
function uniqueIds(values: unknown[], label: string): void {
  const ids = new Set<string>();
  for (const raw of values) { const row = object(raw, label); text(row.id, `${label}.id`); if (ids.has(row.id)) throw new Error(`${label}: ID bị lặp.`); ids.add(row.id); }
}
function position(value: unknown): void {
  array(value, 'Tọa độ');
  if (value.length < 2 || value.length > 3) throw new Error('Tọa độ WGS84 phải có 2–3 chiều.');
  value.forEach((n) => finite(n, 'Tọa độ'));
  if (Math.abs(value[0] as number) > 180 || Math.abs(value[1] as number) > 90) throw new Error('Tọa độ ngoài WGS84.');
}
function positions(value: unknown, minimum: number): void {
  array(value, 'Tọa độ'); if (value.length < minimum) throw new Error('Hình học chưa đủ điểm.'); value.forEach(position);
}
function polygon(value: unknown): void {
  array(value, 'Polygon'); if (!value.length) throw new Error('Polygon trống.');
  for (const ring of value) {
    positions(ring, 4);
    const points = ring as number[][];
    if (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1]) throw new Error('Polygon chưa đóng vòng.');
  }
}
export function assertAnalysisGeometry(value: unknown): asserts value is AnalysisGeometry {
  const g = object(value, 'Hình học');
  switch (g.type) {
    case 'Point': position(g.coordinates); break;
    case 'MultiPoint': positions(g.coordinates, 1); break;
    case 'LineString': positions(g.coordinates, 2); break;
    case 'MultiLineString': array(g.coordinates, 'MultiLineString'); g.coordinates.forEach((line) => positions(line, 2)); break;
    case 'Polygon': polygon(g.coordinates); break;
    case 'MultiPolygon': array(g.coordinates, 'MultiPolygon'); if (!g.coordinates.length) throw new Error('MultiPolygon trống.'); g.coordinates.forEach(polygon); break;
    default: throw new Error('Loại hình học không được hỗ trợ.');
  }
}
function evidence(value: unknown): asserts value is EvidenceRef {
  const e = object(value, 'Nguồn');
  for (const key of ['id', 'sourceId', 'version', 'label']) text(e[key], `Nguồn.${key}`);
  if (e.kind !== 'gis' && e.kind !== 'document') throw new Error('Nguồn có loại không hợp lệ.');
  for (const key of ['fieldPath', 'unit', 'excerpt', 'documentId', 'chunkId']) if (e[key] !== undefined) text(e[key], `Nguồn.${key}`, true);
  for (const key of ['snapshotId', 'originEvidenceId']) if (e[key] !== undefined) { text(e[key], `Nguồn.${key}`); if (e[key].length > 256) throw new Error(`Nguồn.${key} vượt 256 ký tự.`); }
  if (e.kind === 'document') {
    for (const key of ['documentId', 'chunkId', 'excerpt']) text(e[key], `Nguồn tài liệu.${key}`);
    if (e.sourceId !== e.documentId) throw new Error('Nguồn tài liệu sourceId không khớp documentId.');
  }
  if (e.value !== undefined && e.value !== null) finite(e.value, 'Nguồn.value');
  if (e.geometry !== undefined) assertAnalysisGeometry(e.geometry);
}
function annotation(value: unknown): void {
  const a = object(value, 'Ghi chú bản đồ'); text(a.id, 'Ghi chú.id'); text(a.label, 'Ghi chú.label');
  strings(a.evidenceIds, 'Ghi chú.evidenceIds'); assertAnalysisGeometry(a.geometry);
}
export function assertAnalysisSnapshot(value: unknown): asserts value is AnalysisSnapshot {
  const s = object(value, 'Snapshot'); if (s.schemaVersion !== 1) throw new Error('Phiên bản snapshot chưa hỗ trợ.');
  text(s.id, 'Snapshot.id'); date(s.createdAt, 'Snapshot.createdAt');
  const aoi = object(s.aoi, 'Vùng phân tích');
  if (!['point', 'circle', 'polygon'].includes(String(aoi.mode))) throw new Error('Kiểu vùng phân tích không hợp lệ.');
  text(aoi.label, 'Vùng.label'); assertAnalysisGeometry(aoi.geometry);
  if ((aoi.geometry as AnalysisGeometry).type !== 'Polygon') throw new Error('Vùng phân tích phải là Polygon.');
  array(s.datasets, 'Datasets');
  uniqueIds(s.datasets, 'Datasets');
  s.datasets.forEach((raw) => {
    const d = object(raw, 'Dataset'); text(d.id, 'Dataset.id'); text(d.version, 'Dataset.version');
    if (!['observed', 'partial', 'outside', 'unknown'].includes(String(d.coverage))) throw new Error('Trạng thái dataset không hợp lệ.');
    if (d.downloadedAt !== null) date(d.downloadedAt, 'Dataset.downloadedAt');
    if (d.bounds !== undefined) { array(d.bounds, 'Dataset.bounds'); if (d.bounds.length !== 4) throw new Error('Bounds phải có bốn số.'); d.bounds.forEach((n) => finite(n, 'Bounds')); }
    if (d.hash !== undefined && d.hash !== null) text(d.hash, 'Dataset.hash');
  });
  array(s.measurements, 'Measurements');
  uniqueIds(s.measurements, 'Measurements');
  s.measurements.forEach((raw) => {
    const m = object(raw, 'Đo lường'); for (const key of ['id', 'label', 'unit', 'method']) text(m[key], `Đo lường.${key}`, key === 'unit');
    if (m.value !== null) finite(m.value, 'Đo lường.value');
    if (!['observed', 'missing', 'outside', 'partial', 'unknown'].includes(String(m.status))) throw new Error('Trạng thái số đo không hợp lệ.');
    if (['missing', 'outside'].includes(String(m.status)) && m.value !== null) throw new Error('Số đo missing/outside phải có value=null.');
    if (m.status === 'observed' && m.value === null) throw new Error('Số đo observed phải có giá trị.');
    strings(m.sourceIds, 'Đo lường.sourceIds');
  });
  array(s.findings, 'Findings');
  uniqueIds(s.findings, 'Findings');
  s.findings.forEach((raw) => { const f = object(raw, 'Nhận xét'); for (const key of ['id', 'code', 'message']) text(f[key], `Nhận xét.${key}`); if (!['info', 'warning', 'error'].includes(String(f.severity))) throw new Error('Mức nhận xét không hợp lệ.'); strings(f.sourceIds, 'Nhận xét.sourceIds'); if (f.geometry !== undefined) assertAnalysisGeometry(f.geometry); });
  array(s.evidence, 'Evidence'); uniqueIds(s.evidence, 'Evidence'); s.evidence.forEach(evidence);
  if (s.features !== undefined) { array(s.features, 'Features'); s.features.forEach((raw) => { const f = object(raw, 'Feature'); if (f.type !== 'Feature') throw new Error('GeoJSON Feature không hợp lệ.'); assertAnalysisGeometry(f.geometry); object(f.properties, 'Feature.properties'); }); }
  const datasetVersions = new Map((s.datasets as AnalysisSnapshot['datasets']).map((d) => [d.id, d.version]));
  for (const raw of [...s.measurements, ...s.findings]) {
    const row = raw as { sourceIds: string[] };
    if (row.sourceIds.some((id) => !datasetVersions.has(id))) throw new Error('Snapshot trỏ dataset không có trong nguồn.');
  }
  if (s.terrainSamples !== undefined) {
    array(s.terrainSamples, 'Terrain samples');
    if (s.terrainSamples.length > 50_000) throw new Error('Terrain samples vượt giới hạn 50.000 của Core.');
    s.terrainSamples.forEach((raw) => {
      const sample = object(raw, 'Terrain sample'); position([sample.lon, sample.lat]);
      text(sample.sourceId, 'Terrain sample.sourceId');
      if (!datasetVersions.has(sample.sourceId)) throw new Error('Terrain sample trỏ dataset không có trong nguồn.');
      if (sample.height !== null) finite(sample.height, 'Terrain sample.height');
    });
  }
  const typed = s as unknown as AnalysisSnapshot;
  for (const ref of typed.evidence) {
    if (ref.kind !== 'gis') continue;
    if (!datasetVersions.has(ref.sourceId) || datasetVersions.get(ref.sourceId) !== ref.version) throw new Error('GIS evidence không khớp nguồn/phiên bản dataset.');
    const path = ref.fieldPath ?? '';
    if (path.startsWith('measurements.')) {
      const id = path.slice('measurements.'.length);
      const measured = typed.measurements.find((m) => m.id === id) ?? (/^\d+$/.test(id) ? typed.measurements[Number(id)] : undefined);
      if (!measured || !measured.sourceIds.includes(ref.sourceId) || !exact(ref.value, measured.value) || ref.unit !== measured.unit || ref.label !== measured.label) throw new Error('GIS evidence khác số đo/đơn vị/nhãn/nguồn snapshot.');
    } else if (path.startsWith('findings.')) {
      const finding = typed.findings.find((f) => f.id === path.slice('findings.'.length));
      if (!finding || !finding.sourceIds.includes(ref.sourceId) || ref.excerpt !== finding.message) throw new Error('GIS evidence khác finding snapshot.');
    } else if (path.startsWith('features.')) {
      const index = path.slice('features.'.length), feature = /^\d+$/.test(index) ? typed.features?.[Number(index)] : undefined;
      if (!feature || !Array.isArray(feature.properties.sourceIds) || !feature.properties.sourceIds.includes(ref.sourceId) || !exact(ref.geometry, feature.geometry) || ref.value !== undefined) throw new Error('GIS evidence khác feature snapshot.');
    } else if (path.startsWith('terrainSamples.')) {
      const index = path.slice('terrainSamples.'.length), sample = /^\d+$/.test(index) ? typed.terrainSamples?.[Number(index)] : undefined;
      if (!sample || sample.sourceId !== ref.sourceId || ref.value !== sample.height || ref.unit !== 'm' || !exact(ref.geometry, { type: 'Point', coordinates: [sample.lon, sample.lat] })) throw new Error('GIS evidence khác terrain sample snapshot.');
    } else throw new Error('GIS evidence thiếu fieldPath nguồn được hỗ trợ.');
  }
  if (s.contentHash !== undefined) text(s.contentHash, 'Snapshot.contentHash');
}
export function assertAnalysisResult(value: unknown): asserts value is AnalysisResult {
  const r = object(value, 'Kết quả');
  if (r.schemaVersion !== 1 || !workflows.has(String(r.workflowId))) throw new Error('Phiên bản hoặc workflow kết quả không hợp lệ.');
  text(r.runId, 'Kết quả.runId'); if (r.snapshotId !== null) text(r.snapshotId, 'Kết quả.snapshotId');
  date(r.createdAt, 'Kết quả.createdAt'); text(r.answer, 'Kết quả.answer', true); text(r.model, 'Kết quả.model', true);
  if (!['complete', 'partial', 'insufficient'].includes(String(r.status))) throw new Error('Trạng thái kết quả không hợp lệ.');
  array(r.citations, 'Citations'); r.citations.forEach(evidence);
  strings(r.missingData, 'Missing data'); strings(r.warnings, 'Warnings');
  array(r.draftAnnotations, 'Annotations'); r.draftAnnotations.forEach(annotation);
  const validation = object(r.validation, 'Validation'); if (validation.valid !== true) throw new Error('Kết quả chưa qua kiểm chứng.'); strings(validation.issues, 'Validation.issues');
  object(r.usage, 'Usage');
  if (r.sourceSnapshots !== undefined) {
    array(r.sourceSnapshots, 'Kết quả.sourceSnapshots');
    // Same limit as the Core report-source evidence bundle.
    if (r.sourceSnapshots.length > 32) throw new Error('sourceSnapshots vượt giới hạn 32 của Core.');
    r.sourceSnapshots.forEach(assertAnalysisSnapshot);
  }
}
export function assertAnalysisReport(value: unknown): asserts value is AnalysisReport {
  const r = object(value, 'Báo cáo'); if (r.schemaVersion !== 1) throw new Error('Phiên bản báo cáo chưa hỗ trợ.');
  for (const key of ['id', 'title']) text(r[key], `Báo cáo.${key}`);
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) throw new Error('Revision báo cáo không hợp lệ.');
  if (r.importedFrom !== undefined) {
    const origin = object(r.importedFrom, 'Báo cáo.importedFrom');
    text(origin.reportId, 'importedFrom.reportId');
    // Match the Core report-ID ceiling; revisions must be positive safe JS
    // integers so metadata survives JSON roundtrip without precision loss.
    if (origin.reportId.length > 256) throw new Error('importedFrom.reportId vượt 256 ký tự.');
    if (!Number.isSafeInteger(origin.revision) || (origin.revision as number) < 1) throw new Error('importedFrom.revision không hợp lệ.');
    text(origin.importedAt, 'importedFrom.importedAt');
    if (origin.importedAt.length > 100 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(origin.importedAt)) throw new Error('importedFrom.importedAt cần thời điểm ISO có múi giờ, tối đa 100 ký tự.');
    date(origin.importedAt, 'importedFrom.importedAt');
  }
  date(r.createdAt, 'Báo cáo.createdAt'); date(r.updatedAt, 'Báo cáo.updatedAt'); text(r.notes, 'Báo cáo.notes', true);
  if (r.snapshot !== null) assertAnalysisSnapshot(r.snapshot);
  assertAnalysisResult(r.result);
  if ((r.snapshot as AnalysisSnapshot | null)?.id !== (r.result as AnalysisResult).snapshotId && !(r.snapshot === null && (r.result as AnalysisResult).snapshotId === null)) throw new Error('Snapshot và kết quả không cùng phiên bản.');
  const result = r.result as AnalysisResult;
  const snapshots = new Map<string, AnalysisSnapshot>();
  for (const snapshot of [...(r.snapshot ? [r.snapshot as AnalysisSnapshot] : []), ...(result.sourceSnapshots ?? [])]) {
    const previous = snapshots.get(snapshot.id);
    if (previous && !exact(previous, snapshot)) throw new Error('sourceSnapshots trùng ID nhưng khác nội dung.');
    snapshots.set(snapshot.id, snapshot);
  }
  for (const ref of result.citations) {
    if (ref.kind !== 'gis') continue;
    if ((ref.snapshotId === undefined) !== (ref.originEvidenceId === undefined)) throw new Error('GIS citation cần đủ snapshotId và originEvidenceId.');
    const origin = snapshots.get(ref.snapshotId ?? (r.snapshot as AnalysisSnapshot | null)?.id ?? '')?.evidence.find((e) => e.id === (ref.originEvidenceId ?? ref.id));
    if (!origin || origin.kind !== 'gis') throw new Error('GIS citation không có nguồn gốc trong snapshot.');
    for (const key of ['fieldPath', 'label', 'sourceId', 'version', 'value', 'unit', 'geometry', 'excerpt'] as const) {
      if (!exact(ref[key], origin[key])) throw new Error(`GIS citation khác ${key} của snapshot nguồn.`);
    }
  }
  array(r.annotations, 'Báo cáo.annotations'); r.annotations.forEach(annotation);
  const refs = new Set(result.citations.map((e) => e.id));
  for (const a of [...r.annotations, ...(r.result as AnalysisResult).draftAnnotations]) {
    if ((a as { evidenceIds: string[] }).evidenceIds.some((id) => !refs.has(id))) throw new Error('Ghi chú tham chiếu nguồn không có trong citations của kết quả.');
  }
}

/** Guard JSON depth/nonfinite values and prototype keys before exposing imported state. */
function safeJson(value: unknown): void {
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > 24) throw new Error('Gói có cấu trúc JSON quá sâu.');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Gói có số không hữu hạn.');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Gói có khóa không an toàn.');
        pending.push([child, depth + 1]);
      }
    }
  }
}
async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

/** Inspect ZIP metadata before fflate allocates outputs. Only two fixed entries
 * are accepted; no directories, encryption, symlinks, ZIP64 or path extraction. */
export function inspectAnalysisZip(bytes: Uint8Array): void {
  if (bytes.byteLength > ANALYSIS_PACKAGE_COMPRESSED_LIMIT) throw new Error('Gói vượt giới hạn nén 100 MiB.');
  if (bytes.byteLength < 22) throw new Error('ZIP không hợp lệ.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('ZIP nhiều đĩa hoặc không hợp lệ.');
  const count = view.getUint16(end + 10, true);
  if (count !== 2 || view.getUint16(end + 8, true) !== count) throw new Error('Gói phải chứa manifest.json và analysis.json.');
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + view.getUint32(end + 12, true);
  if (directoryEnd !== end || offset > end) throw new Error('Danh mục ZIP không hợp lệ.');
  let total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Danh mục ZIP bị hỏng.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw new Error('Danh mục ZIP vượt phạm vi.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!['manifest.json', 'analysis.json'].includes(name) || names.has(name)) throw new Error('Tên tệp ZIP không an toàn hoặc bị lặp.');
    if (flags & 1 || ![0, 8].includes(method) || (view.getUint32(offset + 38, true) >>> 16 & 0xf000) === 0xa000) throw new Error('ZIP dùng kiểu lưu trữ không được hỗ trợ.');
    if (expanded === 0xffffffff || compressed === 0xffffffff) throw new Error('ZIP64 chưa được hỗ trợ.');
    total += expanded;
    if (total > ANALYSIS_PACKAGE_EXPANDED_LIMIT || (name === 'manifest.json' && expanded > MANIFEST_LIMIT)) throw new Error('Gói vượt giới hạn giải nén.');
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error('Header tệp ZIP không hợp lệ.');
    const localNameLength = view.getUint16(local + 26, true), localExtraLength = view.getUint16(local + 28, true);
    const dataOffset = local + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressed > view.getUint32(end + 16, true) || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) throw new Error('Nội dung ZIP vượt phạm vi hoặc đổi tên.');
    names.add(name); offset = next;
  }
  if (offset !== directoryEnd) throw new Error('Danh mục ZIP có nội dung thừa.');
}

export async function exportAnalysisPackage(report: AnalysisReport): Promise<Uint8Array> {
  assertAnalysisReport(report); safeJson(report);
  const payload: SharedAnalysis = { schemaVersion: 1, format: 'vompk-analysis', createdAt: new Date().toISOString(), report };
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.byteLength > ANALYSIS_PACKAGE_EXPANDED_LIMIT - MANIFEST_LIMIT) throw new Error('Báo cáo vượt giới hạn gói.');
  const manifest = encoder.encode(JSON.stringify({ schemaVersion: 1, format: 'vompk-analysis-zip', entries: [{ path: 'analysis.json', size: bytes.byteLength, sha256: await sha256(bytes) }] }));
  const packed = await new Promise<Uint8Array>((resolve, reject) => zip({ 'manifest.json': manifest, 'analysis.json': bytes }, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
  inspectAnalysisZip(packed);
  return packed;
}
export async function importAnalysisPackage(bytes: Uint8Array): Promise<AnalysisReport> {
  inspectAnalysisZip(bytes);
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, (error, data) => error ? reject(error) : resolve(data)));
  if (Object.values(files).reduce((sum, b) => sum + b.byteLength, 0) > ANALYSIS_PACKAGE_EXPANDED_LIMIT) throw new Error('Gói vượt giới hạn giải nén.');
  const manifest = object(JSON.parse(decoder.decode(files['manifest.json'])), 'Manifest');
  if (manifest.schemaVersion !== 1 || manifest.format !== 'vompk-analysis-zip') throw new Error('Manifest không được hỗ trợ.');
  array(manifest.entries, 'Manifest.entries'); if (manifest.entries.length !== 1) throw new Error('Manifest phải khai báo analysis.json.');
  const entry = object(manifest.entries[0], 'Manifest.entry');
  const content = files['analysis.json'];
  if (entry.path !== 'analysis.json' || entry.size !== content.byteLength || entry.sha256 !== await sha256(content)) throw new Error('Checksum/kích thước gói không khớp.');
  const payload = object(JSON.parse(decoder.decode(content)), 'Gói'); safeJson(payload);
  if (payload.schemaVersion !== 1 || payload.format !== 'vompk-analysis') throw new Error('Phiên bản gói chưa hỗ trợ.');
  assertAnalysisReport(payload.report);
  // A teammate's report starts a new local revision chain. An external parent
  // does not exist in this Core database; preserve its identity as provenance,
  // without changing the archived result's source-validation record.
  const importedAt = new Date().toISOString();
  const imported: AnalysisReport = {
    ...payload.report, id: crypto.randomUUID(), revision: 1, updatedAt: importedAt,
    importedFrom: { reportId: payload.report.id, revision: payload.report.revision, importedAt },
  };
  delete imported.parentId;
  assertAnalysisReport(imported);
  return imported;
}
