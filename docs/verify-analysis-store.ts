/** Real Zustand store + real client/package modules; only fetch is mocked.
 * No backend/model processes, IndexedDB, user data or actual network access.
 * Bundle as ESM with import.meta.env injected; see the command in DEBUG_NOTES.
 */
import assert from 'node:assert/strict';
import { useAnalysisStore } from '../src/store/useAnalysisStore';
import { exportAnalysisPackage } from '../src/services/analysisPackage';
import type { AnalysisAoi, AnalysisReport, AnalysisResult, AnalysisRunRecord, AnalysisSnapshot } from '../src/types/analysis';

const geometry = { type: 'Polygon' as const, coordinates: [[[105, 21], [105.01, 21], [105.01, 21.01], [105, 21.01], [105, 21]]] };
const ref = { id: 'e-fixture', kind: 'gis' as const, sourceId: 'dataset-fixture', version: 'v1', label: 'Số đối tượng', fieldPath: 'measurements.object-count', value: 0, unit: 'đối tượng', geometry };
const snapshot: AnalysisSnapshot = {
  schemaVersion: 1, id: 'snapshot-store-fixture', createdAt: '2026-10-06T00:00:00Z', aoi: { mode: 'polygon', label: 'Vùng fixture', geometry },
  datasets: [{ id: ref.sourceId, version: 'v1', downloadedAt: null, coverage: 'observed' }],
  measurements: [{ id: 'object-count', label: 'Số đối tượng', value: 0, unit: 'đối tượng', status: 'observed', method: 'fixture-no-measurement', sourceIds: [ref.sourceId] }],
  evidence: [ref], findings: [], features: [],
};
const result: AnalysisResult = {
  schemaVersion: 1, runId: 'run-store-fixture', snapshotId: snapshot.id, workflowId: 'gis-analysis-v1', createdAt: snapshot.createdAt,
  status: 'complete', answer: 'Số đối tượng: 0 [e-fixture].', citations: [ref], missingData: [], warnings: [],
  draftAnnotations: [{ id: 'draft-fixture', label: 'Vùng kiểm tra', geometry, evidenceIds: [ref.id] }],
  validation: { valid: true, issues: [] }, model: 'qwen2.5:3b', usage: {},
};
const originalReport: AnalysisReport = {
  schemaVersion: 1, id: 'external-report-fixture', revision: 9, parentId: 'external-parent-not-in-local-core', title: 'Báo cáo từ máy khác',
  createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt, snapshot, result, notes: 'Ghi chú nguồn', annotations: result.draftAnnotations,
};

function clone<T>(value: T): T { return structuredClone(value); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Mock API stage was not reached in 5 seconds.')), 5000); })]); }
  finally { clearTimeout(timeout); }
}
async function settle() { await new Promise<void>((done) => setTimeout(done, 0)); }

type MockMode = 'offline' | 'online' | 'reject';
let mode: MockMode = 'online';
let posts: AnalysisReport[] = [];
let runPosts: Record<string, unknown>[] = [];
let deletes: string[] = [];
let requests: string[] = [];
let remoteReports = new Map<string, AnalysisReport>();
let responseResult = clone(result);
let durableGate: ReturnType<typeof deferred<Response>> | null = null;
let durableSeen: ReturnType<typeof deferred<void>> | null = null;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://analysis.test.invalid');
  if (url.hostname !== 'analysis.test.invalid') throw new Error(`Unexpected external request ${url.origin}; no actual network is allowed.`);
  const path = url.pathname, method = init.method ?? 'GET';
  requests.push(`${method} ${path}`);
  if (path === '/api/v1/health') return json({ status: 'ready' });
  if (path === '/api/v1/models') return json({ models: [{ name: 'larger-model:9b' }, { name: 'qwen2.5:3b' }] });
  if (path === '/api/v1/analysis/reports' && method === 'POST') {
    const report = clone(JSON.parse(String(init.body)).report as AnalysisReport); posts.push(report);
    if (mode === 'offline') throw new TypeError('Core offline fixture');
    if (mode === 'reject') return json({ detail: 'fixture-rejected-report: source record needs review' }, 422);
    if (report.parentId) {
      const parent = remoteReports.get(report.parentId);
      if (!parent || report.revision !== parent.revision + 1) return json({ detail: 'fixture: missing parent or nonconsecutive revision' }, 409);
    } else if (report.revision !== 1) return json({ detail: 'fixture: root revision must be 1' }, 409);
    remoteReports.set(report.id, report); return json({ report });
  }
  if (path === '/api/v1/analysis/reports') return json({ reports: [...remoteReports.values()] });
  if (path === '/api/v1/analysis/history') return json({ runs: [] });
  if (path === '/api/v1/analysis/snapshots' && method === 'POST') return json({ snapshot: JSON.parse(String(init.body)).snapshot });
  if (path.startsWith('/api/v1/analysis/snapshots/')) return json({ snapshot });
  if (path === '/api/v1/runs' && method === 'POST') {
    runPosts.push(JSON.parse(String(init.body))); return json({ run_id: responseResult.runId });
  }
  if (path.endsWith('/events')) {
    const events = [
      { type: 'stage', stage: 'retrieval', message: 'Nguồn fixture', data: {} },
      { type: 'sources', data: { sources: [ref] } },
      { type: 'delta', data: { content: 'PROVISIONAL CLAIM MUST NOT BE PUBLISHED' } },
      { type: 'completed', data: { final_content: responseResult.answer, analysis_result: responseResult, truncated: false } },
    ];
    const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes); stream.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (path.startsWith('/api/v1/analysis/runs/')) {
    durableSeen?.resolve();
    // Intentionally ignores AbortSignal to simulate a late response from a
    // transport adapter; store operation/revision guards must still reject it.
    if (durableGate) return durableGate.promise;
    return completedResponse();
  }
  if (path.startsWith('/api/v1/runs/') && method === 'DELETE') {
    deletes.push(decodeURIComponent(path.split('/').at(-1)!)); return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected mock API route: ${method} ${path}`);
};

function completedResponse() {
  const run: AnalysisRunRecord = { runId: responseResult.runId, status: 'completed', snapshotId: snapshot.id, workflowId: responseResult.workflowId, result: responseResult };
  return json({ run });
}
function reset() {
  useAnalysisStore.getState().cancel();
  useAnalysisStore.setState({
    aoi: snapshot.aoi, snapshot: clone(snapshot), result: clone(result), busy: 'idle', stage: '', error: null, activeRunId: null,
    reports: [], history: [], localOnlyReportIds: [], activeReportId: null, reportTitle: 'Báo cáo fixture', notes: '',
    appliedAnnotations: [], selectedDocumentIds: [], selectedModel: '', serviceStatus: 'unknown', models: [], contextRevision: 0,
  });
  mode = 'online'; posts = []; runPosts = []; deletes = []; requests = []; remoteReports = new Map(); responseResult = clone(result);
  durableGate = null; durableSeen = null;
}
function changedAoi(): AnalysisAoi {
  return { mode: 'polygon', label: 'Vùng mới', geometry: { type: 'Polygon', coordinates: [[[106, 20], [106.01, 20], [106.01, 20.01], [106, 20.01], [106, 20]]] } };
}
let passed = 0;
async function check(name: string, callback: () => Promise<void>) {
  await callback(); await settle(); passed++; console.log(`PASS ${name}`);
}

async function main() {
  assert.equal(typeof indexedDB, 'undefined', 'This suite must never touch real/user IndexedDB.');
  await check('offline report revisions sync in parent order when Core returns', async () => {
    reset(); mode = 'offline';
    await useAnalysisStore.getState().saveReport(); const first = useAnalysisStore.getState().reports[0];
    useAnalysisStore.getState().setNotes('Bản nháp revision 2');
    await useAnalysisStore.getState().saveReport(); const second = useAnalysisStore.getState().reports[0];
    assert.equal(first.revision, 1); assert.equal(first.parentId, undefined); assert.equal(second.revision, 2); assert.equal(second.parentId, first.id);
    assert.deepEqual(new Set(useAnalysisStore.getState().localOnlyReportIds), new Set([first.id, second.id]));
    mode = 'online'; const start = posts.length;
    useAnalysisStore.getState().setNotes('Bản đồng bộ revision 3');
    await useAnalysisStore.getState().saveReport(); const third = useAnalysisStore.getState().reports[0];
    assert.deepEqual(posts.slice(start).map((r) => r.id), [first.id, second.id, third.id]);
    assert.deepEqual(posts.slice(start).map((r) => r.revision), [1, 2, 3]);
    assert.equal(third.parentId, second.id); assert.equal(remoteReports.size, 3);
    assert.deepEqual(useAnalysisStore.getState().localOnlyReportIds, []); assert.equal(useAnalysisStore.getState().error, null);
  });
  await check('imported report starts local revision 1 and syncs revision 2 with provenance', async () => {
    reset(); mode = 'offline'; const bytes = await exportAnalysisPackage(originalReport);
    await useAnalysisStore.getState().importPackage(new File([new Uint8Array(bytes).buffer], 'shared-analysis.zip', { type: 'application/zip' }));
    const imported = useAnalysisStore.getState().reports[0];
    assert.equal(imported.revision, 1); assert.equal(imported.parentId, undefined); assert.notEqual(imported.id, originalReport.id);
    assert.equal(imported.importedFrom!.reportId, originalReport.id); assert.equal(imported.importedFrom!.revision, originalReport.revision);
    assert.deepEqual(useAnalysisStore.getState().appliedAnnotations, []); assert.equal(requests.length, 0, 'Package import must not start backend/inference.');
    mode = 'online'; useAnalysisStore.getState().setNotes('Ghi chú local sau khi nhập');
    await useAnalysisStore.getState().saveReport(); const second = useAnalysisStore.getState().reports[0];
    assert.deepEqual(posts.map((r) => r.id), [imported.id, second.id]);
    assert.equal(second.parentId, imported.id); assert.equal(second.revision, 2);
    assert.deepEqual(second.importedFrom, imported.importedFrom); assert.deepEqual(second.result.validation, originalReport.result.validation);
    assert.equal(useAnalysisStore.getState().error, null); assert.deepEqual(useAnalysisStore.getState().localOnlyReportIds, []);
  });
  await check('Core HTTP 422 remains visible while the local draft is retained', async () => {
    reset(); mode = 'reject'; await useAnalysisStore.getState().saveReport();
    const state = useAnalysisStore.getState(); assert.equal(state.reports.length, 1);
    assert.deepEqual(state.localOnlyReportIds, [state.reports[0].id]); assert.match(state.error!, /HTTP 422/); assert.match(state.error!, /fixture-rejected-report/);
    assert.deepEqual(state.reports[0].result, result); assert.equal(remoteReports.size, 0);
  });
  await check('raw streamed claims remain unpublished until canonical durable GET completes', async () => {
    reset(); durableGate = deferred<Response>(); durableSeen = deferred<void>();
    const pending = useAnalysisStore.getState().run('gis-analysis-v1', 'Đọc dữ liệu fixture');
    await bounded(durableSeen.promise);
    assert.equal(useAnalysisStore.getState().result, null); assert.equal(useAnalysisStore.getState().busy, 'running');
    assert.equal(runPosts[0].strict_sources, true); assert.equal(runPosts[0].mode, 'FAST');
    assert.deepEqual(runPosts[0].document_ids, []); assert.equal(runPosts[0].snapshot_id, snapshot.id);
    assert.equal(runPosts[0].model, 'qwen2.5:3b');
    durableGate.resolve(completedResponse()); await bounded(pending); await settle();
    assert.deepEqual(useAnalysisStore.getState().result, result);
    assert.doesNotMatch(useAnalysisStore.getState().result!.answer, /PROVISIONAL/);
  });
  await check('changing AOI rejects a late completed run result and cancels the owned job', async () => {
    reset(); durableGate = deferred<Response>(); durableSeen = deferred<void>();
    const pending = useAnalysisStore.getState().run('gis-analysis-v1', 'Đọc vùng cũ');
    await bounded(durableSeen.promise); const next = changedAoi(); useAnalysisStore.getState().setAoi(next);
    durableGate.resolve(completedResponse()); await bounded(pending); await settle();
    assert.deepEqual(useAnalysisStore.getState().aoi, next); assert.equal(useAnalysisStore.getState().result, null); assert.equal(useAnalysisStore.getState().snapshot, null);
    assert.ok(deletes.includes(result.runId)); assert.equal(useAnalysisStore.getState().busy, 'idle');
  });
  await check('changing AOI rejects a late durable recovery without rerunning inference', async () => {
    reset(); useAnalysisStore.setState({ result: null }); durableGate = deferred<Response>(); durableSeen = deferred<void>();
    const pending = useAnalysisStore.getState().recover(result.runId);
    await bounded(durableSeen.promise); const next = changedAoi(); useAnalysisStore.getState().setAoi(next);
    durableGate.resolve(completedResponse()); await bounded(pending);
    assert.deepEqual(useAnalysisStore.getState().aoi, next); assert.equal(useAnalysisStore.getState().result, null); assert.equal(useAnalysisStore.getState().snapshot, null);
    assert.equal(runPosts.length, 0); assert.equal(useAnalysisStore.getState().busy, 'idle');
  });
  console.log(`ALL ${passed} STORE CHECKS PASSED`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  useAnalysisStore.getState().cancel(); globalThis.fetch = originalFetch;
});
