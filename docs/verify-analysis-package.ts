/** Independent local package regression suite; no backend/model/services needed.
 * Run: npx esbuild docs/verify-analysis-package.ts --bundle --platform=node
 *   --format=cjs --outfile=logs/analysis-verification/package-checks.cjs
 * then: node logs/analysis-verification/package-checks.cjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { exportAnalysisPackage, importAnalysisPackage, inspectAnalysisZip, ANALYSIS_PACKAGE_EXPANDED_LIMIT } from '../src/services/analysisPackage';
import type { AnalysisReport, AnalysisResult, AnalysisSnapshot } from '../src/types/analysis';

const encoder = new TextEncoder(), decoder = new TextDecoder();
let passed = 0;
async function check(name: string, callback: () => void | Promise<void>) {
  await callback(); passed++; console.log(`PASS ${name}`);
}
function clone<T>(value: T): T { return structuredClone(value); }
const geometry = { type: 'Polygon' as const, coordinates: [[[105, 21], [105.01, 21], [105.01, 21.01], [105, 21.01], [105, 21]]] };
const evidence = { id: 'e-zero', kind: 'gis' as const, sourceId: 'dataset-fixture', version: 'v1', label: 'Số đối tượng', fieldPath: 'measurements.object-count', value: 0, unit: 'đối tượng', geometry };
const snapshot: AnalysisSnapshot = {
  schemaVersion: 1, id: 'snapshot-fixture', createdAt: '2026-10-06T00:00:00Z',
  aoi: { mode: 'polygon', label: 'Vùng kiểm tra', geometry },
  datasets: [{ id: 'dataset-fixture', version: 'v1', downloadedAt: null, coverage: 'observed' }],
  measurements: [
    { id: 'object-count', label: 'Số đối tượng', value: 0, unit: 'đối tượng', status: 'observed', method: 'fixture-known-zero', sourceIds: ['dataset-fixture'] },
    { id: 'elevation', label: 'Cao độ', value: null, unit: 'm', status: 'missing', method: 'not-sampled', sourceIds: [] },
  ], findings: [{ id: 'terrain-missing', code: 'missing-terrain', severity: 'warning', message: 'Chưa lấy mẫu địa hình.', sourceIds: [] }],
  evidence: [evidence], features: [],
};
const result: AnalysisResult = {
  schemaVersion: 1, runId: 'run-fixture', snapshotId: snapshot.id, workflowId: 'gis-analysis-v1', createdAt: snapshot.createdAt,
  status: 'partial', answer: 'Số đối tượng quan sát: 0 [e-zero]. Chưa có cao độ.', citations: [evidence],
  missingData: ['Cao độ chưa lấy mẫu.'], warnings: ['Số đo này chỉ là fixture kiểm thử.'],
  draftAnnotations: [{ id: 'annotation-fixture', label: 'Vùng đã kiểm tra', geometry, evidenceIds: [evidence.id] }],
  validation: { valid: true, issues: [] }, model: 'fixture-no-inference', usage: {},
};
const report: AnalysisReport = {
  schemaVersion: 1, id: 'report-fixture', revision: 3, title: 'Báo cáo kiểm tra', createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt,
  snapshot, result, notes: 'Ghi chú của người dùng: dữ liệu tiếng Việt ✓', annotations: result.draftAnnotations,
};

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
/** Correct hashes let schema/geometry tests reach the intended validator rather
 * than all failing early at the checksum gate. */
async function packagePayload(payload: unknown): Promise<Uint8Array> {
  const bytes = encoder.encode(JSON.stringify(payload));
  const manifest = encoder.encode(JSON.stringify({ schemaVersion: 1, format: 'vompk-analysis-zip', entries: [{ path: 'analysis.json', size: bytes.length, sha256: await digest(bytes) }] }));
  return zipSync({ 'manifest.json': manifest, 'analysis.json': bytes });
}
function centralEntries(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22, count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true); const offsets: number[] = [];
  for (let i = 0; i < count; i++) { offsets.push(offset); offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true); }
  return offsets;
}
function mutateCentral(bytes: Uint8Array, callback: (view: DataView, offset: number) => void): Uint8Array {
  const copy = bytes.slice(), view = new DataView(copy.buffer); const offsets = centralEntries(copy);
  for (const offset of offsets) {
    const length = view.getUint16(offset + 28, true);
    if (decoder.decode(copy.subarray(offset + 46, offset + 46 + length)) === 'analysis.json') { callback(view, offset); return copy; }
  }
  throw new Error('Test fixture has no analysis entry');
}

async function main() {
  const packed = await exportAnalysisPackage(report);
  const payload = JSON.parse(decoder.decode(unzipSync(packed)['analysis.json']));
  await check('roundtrip retains measurements, source versions, null/zero, notes and geometry', async () => {
    const imported = await importAnalysisPackage(packed);
    assert.deepEqual(imported.snapshot, report.snapshot); assert.deepEqual(imported.result, report.result);
    assert.equal(imported.notes, report.notes); assert.deepEqual(imported.annotations, report.annotations);
    assert.equal(imported.snapshot!.measurements[0].value, 0); assert.equal(imported.snapshot!.measurements[1].value, null);
  });
  await check('every import starts a new local chain with bounded archive provenance', async () => {
    const a = await importAnalysisPackage(packed), b = await importAnalysisPackage(packed);
    assert.notEqual(a.id, report.id); assert.notEqual(a.id, b.id); assert.equal(a.parentId, undefined); assert.equal(a.revision, 1);
    assert.equal(a.importedFrom!.reportId, report.id); assert.equal(a.importedFrom!.revision, report.revision);
    assert.match(a.importedFrom!.importedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const withExternalParent = await importAnalysisPackage(await exportAnalysisPackage({ ...report, parentId: 'external-parent-not-in-local-core' }));
    assert.equal(withExternalParent.parentId, undefined); assert.equal(withExternalParent.importedFrom!.reportId, report.id);
    assert.deepEqual(a.result.validation, report.result.validation);
    for (const origin of [
      { reportId: '', revision: 1, importedAt: snapshot.createdAt },
      { reportId: 'x'.repeat(257), revision: 1, importedAt: snapshot.createdAt },
      { reportId: 'origin', revision: 0, importedAt: snapshot.createdAt },
      { reportId: 'origin', revision: 1.5, importedAt: snapshot.createdAt },
      { reportId: 'origin', revision: Number.MAX_SAFE_INTEGER + 1, importedAt: snapshot.createdAt },
      { reportId: 'origin', revision: 1, importedAt: '2026-10-06' },
      { reportId: 'origin', revision: 1, importedAt: '2026-99-06T00:00:00Z' },
      { reportId: 'origin', revision: 1, importedAt: 'x'.repeat(101) },
    ]) {
      const malformed = clone(payload); malformed.report.importedFrom = origin;
      await assert.rejects(importAnalysisPackage(await packagePayload(malformed)), /importedFrom/);
    }
    assert.equal(report.id, 'report-fixture'); assert.equal(report.revision, 3);
  });
  await check('package contains exactly manifest and analysis, no executable/runtime entries', () => {
    assert.deepEqual(Object.keys(unzipSync(packed)).sort(), ['analysis.json', 'manifest.json']);
  });
  await check('checksum mismatch is rejected', async () => {
    const files = unzipSync(packed); const altered = JSON.parse(decoder.decode(files['analysis.json']));
    altered.report.notes = 'đã bị thay đổi'; files['analysis.json'] = encoder.encode(JSON.stringify(altered));
    await assert.rejects(importAnalysisPackage(zipSync(files)), /Checksum/);
  });
  await check('path traversal and unexpected ZIP files are rejected before extraction', async () => {
    const files = unzipSync(packed);
    await assert.rejects(importAnalysisPackage(zipSync({ 'manifest.json': files['manifest.json'], '../analysis.json': files['analysis.json'] })), /Tên tệp ZIP/);
    await assert.rejects(importAnalysisPackage(zipSync({ ...files, 'ollama.exe': encoder.encode('not-an-executable') })), /phải chứa/);
  });
  await check('unknown package/report/snapshot/result schemas are rejected with valid checksum', async () => {
    for (const location of ['package', 'report', 'snapshot', 'result']) {
      const changed = clone(payload);
      const target = location === 'package' ? changed : location === 'report' ? changed.report : changed.report[location];
      target.schemaVersion = 99;
      await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /[Pp]hiên bản/);
    }
  });
  await check('declared expanded size exceeds 256 MiB guard before decompression', () => {
    const changed = mutateCentral(packed, (view, offset) => view.setUint32(offset + 24, ANALYSIS_PACKAGE_EXPANDED_LIMIT + 1, true));
    assert.throws(() => inspectAnalysisZip(changed), /giới hạn giải nén/);
  });
  await check('manifest expanded size is bounded before decompression', () => {
    const changed = packed.slice(), view = new DataView(changed.buffer);
    for (const offset of centralEntries(changed)) {
      const name = decoder.decode(changed.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true)));
      if (name === 'manifest.json') view.setUint32(offset + 24, 65537, true);
    }
    assert.throws(() => inspectAnalysisZip(changed), /giới hạn giải nén/);
  });
  await check('invalid WGS84 geometry and unclosed rings are rejected', async () => {
    const outOfBounds = clone(payload); outOfBounds.report.snapshot.aoi.geometry.coordinates[0][0][0] = 999;
    await assert.rejects(importAnalysisPackage(await packagePayload(outOfBounds)), /WGS84/);
    const unclosed = clone(payload); unclosed.report.snapshot.aoi.geometry.coordinates[0].pop();
    await assert.rejects(importAnalysisPackage(await packagePayload(unclosed)), /đóng vòng/);
  });
  await check('forged annotation source reference is rejected', async () => {
    const changed = clone(payload); changed.report.annotations[0].evidenceIds = ['source-not-in-package'];
    await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /nguồn không có/);
  });
  await check('snapshot/result mismatch and unvalidated results are rejected', async () => {
    const mismatch = clone(payload); mismatch.report.result.snapshotId = 'different-snapshot';
    await assert.rejects(importAnalysisPackage(await packagePayload(mismatch)), /không cùng phiên bản/);
    const invalid = clone(payload); invalid.report.result.validation.valid = false;
    await assert.rejects(importAnalysisPackage(await packagePayload(invalid)), /chưa qua kiểm chứng/);
  });
  await check('encrypted, symlink and unsupported compression metadata are rejected', () => {
    const encrypted = mutateCentral(packed, (view, offset) => view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true));
    const symlink = mutateCentral(packed, (view, offset) => view.setUint32(offset + 38, 0xa0000000, true));
    const codec = mutateCentral(packed, (view, offset) => view.setUint16(offset + 10, 99, true));
    for (const bytes of [encrypted, symlink, codec]) assert.throws(() => inspectAnalysisZip(bytes), /không được hỗ trợ/);
  });
  await check('truncated ZIP and local/central entry name mismatch are rejected', () => {
    assert.throws(() => inspectAnalysisZip(packed.slice(0, -1)), /ZIP/);
    const changed = mutateCentral(packed, (view, offset) => {
      const local = view.getUint32(offset + 42, true); view.setUint8(local + 30, 'X'.charCodeAt(0));
    });
    assert.throws(() => inspectAnalysisZip(changed), /đổi tên/);
  });
  await check('duplicate ZIP entry names are rejected', () => {
    const changed = mutateCentral(packed, (view, offset) => {
      const replacement = encoder.encode('manifest.json'); const local = view.getUint32(offset + 42, true);
      replacement.forEach((byte, i) => { view.setUint8(offset + 46 + i, byte); view.setUint8(local + 30 + i, byte); });
    });
    assert.throws(() => inspectAnalysisZip(changed), /bị lặp/);
  });
  await check('prototype injection is rejected even with a valid manifest', async () => {
    const changed = clone(payload);
    Object.defineProperty(changed.report, '__proto__', { enumerable: true, value: { injected: true } });
    await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /khóa không an toàn/);
    assert.equal(({} as Record<string, unknown>).injected, undefined);
  });
  await check('document-only report without a GIS snapshot remains portable', async () => {
    const docReport = clone(report); docReport.snapshot = null; docReport.result.snapshotId = null;
    docReport.result.workflowId = 'document-qa-v1'; docReport.result.draftAnnotations = []; docReport.annotations = [];
    docReport.result.citations = [{ id: 'doc-e1', kind: 'document', sourceId: 'doc1', documentId: 'doc1', chunkId: 'chunk1', version: '1', label: 'Tài liệu', excerpt: 'Đoạn tài liệu được chọn.' }];
    const imported = await importAnalysisPackage(await exportAnalysisPackage(docReport));
    assert.equal(imported.snapshot, null); assert.equal(imported.result.citations[0].excerpt, 'Đoạn tài liệu được chọn.');
  });
  await check('bounded larger Unicode payload exercises asynchronous fflate paths', async () => {
    const larger = clone(report); larger.notes = 'Ghi chú tiếng Việt ✓\n'.repeat(20_000);
    const imported = await importAnalysisPackage(await exportAnalysisPackage(larger));
    assert.equal(imported.notes, larger.notes); assert.deepEqual(imported.snapshot, larger.snapshot);
  });
  await check('GIS citations cannot alter snapshot numbers, units, versions, sources or geometry', async () => {
    const edits: [string, unknown][] = [
      ['value', 42], ['unit', 'm'], ['version', 'invented-version'], ['sourceId', 'fake-dataset'],
      ['fieldPath', 'measurements.elevation'], ['label', 'Invented label'], ['id', 'unknown-origin'],
      ['geometry', { type: 'Point', coordinates: [105, 21] }], ['excerpt', 'invented excerpt'],
    ];
    for (const [key, value] of edits) {
      const changed = clone(payload); changed.report.result.citations[0][key] = value;
      await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /GIS citation/);
    }
    const rewrittenSnapshot = clone(payload); rewrittenSnapshot.report.snapshot.evidence[0].value = 55;
    await assert.rejects(importAnalysisPackage(await packagePayload(rewrittenSnapshot)), /GIS evidence khác/);
  });
  await check('missing/outside metrics cannot masquerade as observed zero', async () => {
    for (const status of ['missing', 'outside']) {
      const changed = clone(payload); changed.report.snapshot.measurements[0].status = status;
      await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /missing\/outside.*null/);
    }
  });
  await check('terrain samples preserve zero/null and reject invalid numbers, coordinates and sources', async () => {
    const sampled = clone(report); sampled.snapshot!.terrainSamples = [
      { lon: 105, lat: 21, height: 0, sourceId: 'dataset-fixture' },
      { lon: 105.01, lat: 21, height: null, sourceId: 'dataset-fixture' },
    ];
    const roundtrip = await importAnalysisPackage(await exportAnalysisPackage(sampled));
    assert.deepEqual(roundtrip.snapshot!.terrainSamples, sampled.snapshot!.terrainSamples);
    for (const edit of [{ height: '0' }, { height: undefined }, { lon: 181 }, { lat: -91 }, { sourceId: 'fake-terrain-source' }]) {
      const changed = clone(payload); changed.report.snapshot.terrainSamples = [{ lon: 105, lat: 21, height: 0, sourceId: 'dataset-fixture', ...edit }];
      await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /Terrain sample|terrain|Tọa độ|WGS84/);
    }
    const nonfinite = clone(sampled); nonfinite.snapshot!.terrainSamples![0].height = Number.POSITIVE_INFINITY;
    await assert.rejects(exportAnalysisPackage(nonfinite), /Terrain sample.height/);
  });
  await check('document citations require exact excerpt, document/chunk identity and matching source', async () => {
    const documents = clone(payload); documents.report.snapshot = null; documents.report.result.snapshotId = null;
    documents.report.result.workflowId = 'document-qa-v1'; documents.report.result.draftAnnotations = []; documents.report.annotations = [];
    documents.report.result.citations = [{ id: 'd1', kind: 'document', sourceId: 'doc1', documentId: 'doc1', chunkId: 'chunk1', version: '1', label: 'Tài liệu', excerpt: 'Đoạn nguồn.' }];
    for (const edit of [{ excerpt: '' }, { documentId: 'doc2' }, { chunkId: undefined }, { documentId: undefined }]) {
      const changed = clone(documents); Object.assign(changed.report.result.citations[0], edit);
      await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /Nguồn tài liệu/);
    }
  });
  await check('namespaced report citations bind distinct immutable source snapshots and roundtrip', async () => {
    const summary = clone(report); summary.snapshot = null; summary.result.snapshotId = null; summary.result.workflowId = 'report-summary-v1';
    const second = clone(snapshot); second.id = 'snapshot-other-fixture'; second.measurements[0].value = 9; second.evidence[0].value = 9;
    summary.result.sourceSnapshots = [clone(snapshot), second];
    summary.result.citations = [
      { ...clone(evidence), id: 'report:first:e-zero', snapshotId: snapshot.id, originEvidenceId: evidence.id },
      { ...clone(evidence), id: 'report:second:e-zero', snapshotId: second.id, originEvidenceId: evidence.id, value: 9 },
    ];
    summary.result.draftAnnotations = []; summary.annotations = [];
    const imported = await importAnalysisPackage(await exportAnalysisPackage(summary));
    assert.deepEqual(imported.result.sourceSnapshots, summary.result.sourceSnapshots); assert.deepEqual(imported.result.citations, summary.result.citations);
    const missingSource = clone(summary); missingSource.result.sourceSnapshots = [second];
    await assert.rejects(exportAnalysisPackage(missingSource), /không có nguồn gốc/);
    const changedCitation = clone(summary); changedCitation.result.citations[1].value = 99;
    await assert.rejects(exportAnalysisPackage(changedCitation), /GIS citation khác value/);
    const partialIdentity = clone(summary); delete partialIdentity.result.citations[0].originEvidenceId;
    await assert.rejects(exportAnalysisPackage(partialIdentity), /đủ snapshotId/);
    const collision = clone(summary); collision.result.sourceSnapshots![1].id = snapshot.id;
    await assert.rejects(exportAnalysisPackage(collision), /trùng ID/);
  });
  await check('annotations must use published citations, not uncited snapshot evidence', async () => {
    const changed = clone(payload);
    changed.report.snapshot.measurements.push({ ...clone(snapshot.measurements[0]), id: 'unused-measurement', label: 'Số đo chưa trích dẫn', value: 1 });
    changed.report.snapshot.evidence.push({ ...clone(evidence), id: 'unused-evidence', fieldPath: 'measurements.unused-measurement', label: 'Số đo chưa trích dẫn', value: 1 });
    changed.report.annotations[0].evidenceIds = ['unused-evidence'];
    await assert.rejects(importAnalysisPackage(await packagePayload(changed)), /không có trong citations/);
  });
  const snapshotPath = resolve('logs/analysis-verification/real-snapshot.json'), resultPath = resolve('logs/analysis-verification/real-result.json');
  if (existsSync(snapshotPath) && existsSync(resultPath)) {
    await check('real offline GIS snapshot and validated backend result roundtrip', async () => {
      const realSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as AnalysisSnapshot;
      const realResult = JSON.parse(readFileSync(resultPath, 'utf8')) as AnalysisResult;
      const realReport: AnalysisReport = { ...report, id: 'real-gis-package-verification', snapshot: realSnapshot, result: realResult, annotations: realResult.draftAnnotations };
      const imported = await importAnalysisPackage(await exportAnalysisPackage(realReport));
      assert.deepEqual(imported.snapshot, realSnapshot); assert.deepEqual(imported.result, realResult);
    });
  }
  console.log(`ALL ${passed} PACKAGE CHECKS PASSED`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
