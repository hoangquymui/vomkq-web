import { create } from 'zustand';
import type { AnalysisAoi, AnalysisGeometry, AnalysisReport, AnalysisResult, AnalysisRunRecord, AnalysisSnapshot, AnalysisTerrainSampler, AnalysisWorkflowId, DraftAnnotation, EvidenceRef } from '../types/analysis';
import { createCircleAoi, createPolygonAoi, validateAnalysisAoi } from '../services/analysisGeometry';
import { measureAnalysisRegion, registeredAnalysisRegions } from '../services/analysisWorkerClient';
import { getAnalysisRun, getAnalysisSnapshot, importAnalysisDocument, listAnalysisDocuments, listAnalysisHistory, listAnalysisReports, readAnalysisDocumentSource, runAnalysisQuery, saveAnalysisReport } from '../services/analysisClient';
import type { AnalysisDocument } from '../services/analysisClient';
import { assertAnalysisReport, assertAnalysisResult, exportAnalysisPackage, importAnalysisPackage } from '../services/analysisPackage';
import { cancelVectorAiRun, checkVectorAiHealth, ensureVectorAiReady, listVectorAiModels } from '../services/vectorAiClient';

export const ANALYSIS_FEATURE_FLAG = 'vompk.analysis.v2.enabled';
export type AnalysisTab = 'analysis' | 'chat' | 'documents';
type Busy = 'idle' | 'measuring' | 'running' | 'recovering' | 'importing';
function initialEnabled(): boolean { try { return localStorage.getItem(ANALYSIS_FEATURE_FLAG) === 'true'; } catch { return false; } }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
let controller: AbortController | null = null;
let operation = 0;
let terrainSampler: AnalysisTerrainSampler | null = null;

/** Local draft persistence is separate from Core databases and never overwrites
 * teammate imports. IndexedDB holds large geometry without localStorage quota pressure. */
async function draftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('vompk-analysis-drafts-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('reports', { keyPath: 'id' });
    opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
}
async function persistDraft(report: AnalysisReport): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await draftDb();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('reports', 'readwrite'); tx.objectStore('reports').put(report); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
async function readDrafts(): Promise<AnalysisReport[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await draftDb();
  try { return await new Promise((resolve, reject) => { const req = db.transaction('reports').objectStore('reports').getAll(); req.onsuccess = () => resolve(req.result as AnalysisReport[]); req.onerror = () => reject(req.error); }); } finally { db.close(); }
}

/** Numeric differences remain independent of AI prose. Changed source/version or
 * method is shown before a delta so incompatible observations aren't compared silently. */
export function compareAnalysisReports(before: AnalysisReport, after: AnalysisReport): string[] {
  const lines: string[] = [];
  if (JSON.stringify(before.snapshot?.aoi.geometry) !== JSON.stringify(after.snapshot?.aoi.geometry)) lines.push('Vùng phân tích đã thay đổi; số đo không cùng phạm vi.');
  const oldDatasets = new Map(before.snapshot?.datasets.map((d) => [d.id, d]) ?? []);
  for (const d of after.snapshot?.datasets ?? []) {
    const previous = oldDatasets.get(d.id);
    if (!previous || previous.version !== d.version || previous.hash !== d.hash) lines.push(`Nguồn thay đổi: ${d.id} (${previous?.version ?? 'không có'} → ${d.version}).`);
  }
  for (const d of before.snapshot?.datasets ?? []) if (!after.snapshot?.datasets.some((next) => next.id === d.id)) lines.push(`Nguồn bị bỏ: ${d.id}.`);
  const oldMeasurements = new Map(before.snapshot?.measurements.map((m) => [m.id, m]) ?? []);
  for (const m of after.snapshot?.measurements ?? []) {
    const previous = oldMeasurements.get(m.id);
    if (!previous) { lines.push(`Số đo mới: ${m.label}.`); continue; }
    if (previous.method !== m.method || previous.unit !== m.unit) { lines.push(`${m.label}: phương pháp/đơn vị thay đổi, không tính chênh lệch.`); continue; }
    if (previous.status !== m.status) lines.push(`${m.label}: trạng thái ${previous.status} → ${m.status}.`);
    if (m.value !== previous.value) lines.push(`${m.label}: ${previous.value ?? 'chưa có'} → ${m.value ?? 'chưa có'} ${m.unit}${m.value !== null && previous.value !== null ? ` (Δ ${Number((m.value - previous.value).toPrecision(8))})` : ''}.`);
  }
  return lines.length ? lines : ['Không có thay đổi số đo, nguồn hoặc phương pháp.'];
}

interface AnalysisState {
  enabled: boolean; panelOpen: boolean; tab: AnalysisTab;
  drawMode: 'point' | 'circle' | 'polygon' | null; drawVertices: [number, number][];
  aoi: AnalysisAoi | null; radiusKm: number; contextRevision: number;
  snapshot: AnalysisSnapshot | null; result: AnalysisResult | null;
  busy: Busy; stage: string; error: string | null; activeRunId: string | null;
  highlightGeometry: AnalysisGeometry | null; appliedAnnotations: DraftAnnotation[];
  serviceStatus: 'unknown' | 'offline' | 'starting' | 'ready'; models: string[]; selectedModel: string;
  documents: AnalysisDocument[]; selectedDocumentIds: string[];
  selectedVectorRegions: string[];
  history: AnalysisRunRecord[]; reports: AnalysisReport[]; localOnlyReportIds: string[];
  reportTitle: string; notes: string; activeReportId: string | null;
  source: EvidenceRef | null; sourceExcerpt: string | null;
  setEnabled: (value: boolean) => void; togglePanel: () => void; setPanelOpen: (open: boolean) => void; setTab: (tab: AnalysisTab) => void;
  setDrawMode: (mode: AnalysisState['drawMode']) => void; addDrawVertex: (lon: number, lat: number) => void; completeDraw: () => void; cancelDraw: () => void;
  setAoi: (aoi: AnalysisAoi | null) => void; setRadiusKm: (radius: number) => void;
  setHighlightGeometry: (geometry: AnalysisGeometry | null) => void; setTerrainSampler: (sampler: AnalysisTerrainSampler | null) => void;
  cancel: () => void; measure: () => Promise<void>;
  refreshServices: (start?: boolean) => Promise<void>; refreshDocuments: () => Promise<void>; refreshReports: () => Promise<void>;
  setModel: (model: string) => void; selectDocument: (id: string, selected: boolean) => void;
  selectVectorRegion: (region: string, selected: boolean) => void;
  run: (workflow: AnalysisWorkflowId, question?: string, reportIds?: string[]) => Promise<void>;
  recover: (runId?: string) => Promise<void>; openReport: (id: string) => void;
  setReportTitle: (title: string) => void; setNotes: (notes: string) => void; saveReport: () => Promise<void>;
  applyDraftAnnotation: (id: string) => void; removeAnnotation: (id: string) => void;
  openSource: (source: EvidenceRef | null) => Promise<void>;
  importDocument: (file: File) => Promise<void>; importPackage: (file: File) => Promise<void>; exportPackage: () => Promise<Uint8Array | null>;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  enabled: initialEnabled(), panelOpen: false, tab: 'analysis', drawMode: null, drawVertices: [], aoi: null,
  // 1 km is the visible initial user-editable GIS inspection radius, not a domain threshold.
  radiusKm: 1, contextRevision: 0, snapshot: null, result: null, busy: 'idle', stage: '', error: null, activeRunId: null,
  highlightGeometry: null, appliedAnnotations: [], serviceStatus: 'unknown', models: [], selectedModel: '', documents: [], selectedDocumentIds: [],
  selectedVectorRegions: registeredAnalysisRegions(),
  history: [], reports: [], localOnlyReportIds: [], reportTitle: 'Phân tích GIS', notes: '', activeReportId: null, source: null, sourceExcerpt: null,
  setEnabled: (enabled) => { if (!enabled) get().cancel(); try { localStorage.setItem(ANALYSIS_FEATURE_FLAG, String(enabled)); } catch { /* flag remains session-local */ } set({ enabled, panelOpen: enabled, drawMode: null, drawVertices: [] }); },
  togglePanel: () => get().setPanelOpen(!get().panelOpen),
  setPanelOpen: (panelOpen) => { if (!panelOpen) get().cancel(); set({ panelOpen, ...(!panelOpen ? { drawMode: null, drawVertices: [] } : {}) }); },
  setTab: (tab) => set({ tab }),
  setDrawMode: (drawMode) => { get().cancel(); set({ drawMode, drawVertices: [], highlightGeometry: null, stage: drawMode === 'polygon' ? 'Bấm các đỉnh trên bản đồ, rồi Hoàn tất vùng.' : 'Bấm trên bản đồ để chọn tâm vùng.', error: null }); },
  addDrawVertex: (lon, lat) => {
    if (!get().drawMode || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
    const drawVertices: [number, number][] = [...get().drawVertices, [lon, lat]];
    set({ drawVertices }); if (get().drawMode !== 'polygon') get().completeDraw();
  },
  completeDraw: () => {
    const { drawMode, drawVertices, radiusKm } = get();
    if (!drawMode) return;
    try {
      const aoi = drawMode === 'polygon' ? createPolygonAoi(drawVertices) : createCircleAoi(drawVertices[0]?.[0], drawVertices[0]?.[1], radiusKm);
      if (drawMode === 'point') { aoi.mode = 'point'; aoi.label = `Vùng lân cận điểm (${radiusKm} km)`; }
      get().setAoi(aoi); set({ drawMode: null, drawVertices: [], stage: 'Đã chọn vùng. Bấm Đo dữ liệu để chụp snapshot.' });
    } catch (error) { set({ error: message(error) }); }
  },
  cancelDraw: () => set({ drawMode: null, drawVertices: [], stage: '' }),
  setAoi: (aoi) => {
    if (aoi) { try { validateAnalysisAoi(aoi); } catch (error) { set({ error: message(error) }); return; } }
    get().cancel(); set({ aoi, contextRevision: get().contextRevision + 1, snapshot: null, result: null, highlightGeometry: null, source: null, sourceExcerpt: null, error: null, activeReportId: null, appliedAnnotations: [] });
  },
  setRadiusKm: (radiusKm) => { if (!Number.isFinite(radiusKm) || radiusKm <= 0) return; set({ radiusKm }); const aoi = get().aoi; if (aoi && aoi.mode !== 'polygon') { const ring = aoi.geometry.coordinates[0]; const points = ring.slice(0, -1); const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length, lat = points.reduce((sum, p) => sum + p[1], 0) / points.length; const next = createCircleAoi(lon, lat, radiusKm); next.mode = aoi.mode; get().setAoi(next); } },
  setHighlightGeometry: (highlightGeometry) => set({ highlightGeometry }),
  setTerrainSampler: (sampler) => { terrainSampler = sampler; },
  cancel: () => { operation++; controller?.abort(); controller = null; const current = get(); if (current.activeRunId && current.busy === 'running') void cancelVectorAiRun(current.activeRunId); set({ busy: 'idle', stage: current.busy !== 'idle' ? 'Đã hủy; dữ liệu đã hoàn tất vẫn được giữ.' : current.stage }); },
  measure: async () => {
    const aoi = get().aoi, regions = [...get().selectedVectorRegions]; if (!aoi) { set({ error: 'Chọn một vùng trên bản đồ trước.' }); return; }
    get().cancel(); const token = ++operation, revision = get().contextRevision; controller = new AbortController(); const signal = controller.signal;
    set({ busy: 'measuring', error: null, stage: 'Đang đọc dữ liệu GIS local…' });
    try {
      let terrainSamples;
      if (terrainSampler) {
        const ring = aoi.geometry.coordinates[0].slice(0, -1);
        // At most 25 bounded observations (AOI vertices + center) keep local terrain
        // sampling responsive. These are sampled observations, never whole-area extrema.
        const positions: [number, number][] = [];
        const step = Math.max(1, Math.ceil(ring.length / 24));
        for (let i = 0; i < ring.length && positions.length < 24; i += step) positions.push([ring[i][0], ring[i][1]]);
        if (ring.length) positions.push([ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length]);
        terrainSamples = await terrainSampler(positions, signal);
      }
      const snapshot = await measureAnalysisRegion(aoi, { signal, regions, terrainSamples, onStage: (stage) => { if (token === operation) set({ stage }); } });
      if (token !== operation || revision !== get().contextRevision || signal.aborted) return;
      set({ snapshot, result: null, busy: 'idle', stage: 'Snapshot local đã hoàn tất. Số đo chưa phải diễn giải AI.', activeReportId: null });
    } catch (error) { if (token === operation) set({ busy: 'idle', error: signal.aborted ? null : message(error), stage: signal.aborted ? 'Đã hủy.' : '' }); }
    finally { if (token === operation) controller = null; }
  },
  refreshServices: async (start = false) => {
    set({ serviceStatus: start ? 'starting' : get().serviceStatus });
    if (start) { const ready = await ensureVectorAiReady(); if (!ready.ok) { set({ serviceStatus: 'offline', error: ready.error.message }); return; } }
    const health = await checkVectorAiHealth();
    if (!health.ok || health.value.status !== 'ready') { set({ serviceStatus: 'offline' }); return; }
    const models = await listVectorAiModels();
    const installed = models.ok ? models.value : [];
    const selectedModel = installed.includes(get().selectedModel) ? get().selectedModel : installed.find((m) => m.toLowerCase().startsWith('qwen2.5:3b')) ?? installed[0] ?? '';
    set({ serviceStatus: 'ready', models: installed, selectedModel });
  },
  refreshDocuments: async () => { try { set({ documents: await listAnalysisDocuments() }); } catch (error) { set({ error: message(error) }); } },
  refreshReports: async () => {
    const local = await readDrafts().catch(() => []);
    try { const [reports, history] = await Promise.all([listAnalysisReports(), listAnalysisHistory()]); const remoteIds = new Set(reports.map((r) => r.id)); const localOnly = local.filter((r) => !remoteIds.has(r.id)); set({ reports: [...reports, ...localOnly], localOnlyReportIds: localOnly.map((r) => r.id), history }); }
    catch { set({ reports: local, localOnlyReportIds: local.map((r) => r.id) }); }
  },
  setModel: (selectedModel) => { get().cancel(); set({ selectedModel, contextRevision: get().contextRevision + 1 }); },
  selectVectorRegion: (region, selected) => {
    if (!registeredAnalysisRegions().includes(region)) return;
    const regions = new Set(get().selectedVectorRegions); if (selected) regions.add(region); else regions.delete(region);
    get().setAoi(get().aoi); set({ selectedVectorRegions: [...regions] });
  },
  selectDocument: (id, selected) => { get().cancel(); const ids = new Set(get().selectedDocumentIds); if (selected) ids.add(id); else ids.delete(id); set({ selectedDocumentIds: [...ids], contextRevision: get().contextRevision + 1, result: null }); },
  run: async (workflowId, question, reportIds = []) => {
    const before = get();
    if (['gis-analysis-v1', 'data-quality-v1'].includes(workflowId) && !before.snapshot) { set({ error: 'Đo dữ liệu để tạo snapshot trước khi phân tích.' }); return; }
    if (workflowId === 'document-qa-v1' && !before.selectedDocumentIds.length) { set({ error: 'Chọn ít nhất một tài liệu nguồn trong tab Tài liệu.' }); return; }
    if (workflowId === 'report-summary-v1' && !reportIds.length && !before.snapshot) { set({ error: 'Chọn một báo cáo hoặc đo dữ liệu trước.' }); return; }
    get().cancel(); const token = ++operation, revision = get().contextRevision; controller = new AbortController(); const signal = controller.signal;
    set({ busy: 'running', error: null, stage: 'Đang chuẩn bị AI local…', result: null, activeRunId: null });
    try {
      await get().refreshServices(true); if (signal.aborted || token !== operation) return;
      const model = get().selectedModel; if (!model) throw new Error('Chưa có model local sẵn sàng. Dữ liệu GIS vẫn đọc được; không tự tải model.');
      const result = await runAnalysisQuery({ model, workflowId, snapshot: before.snapshot, documentIds: before.selectedDocumentIds, reportIds, question: question?.trim() || (workflowId === 'data-quality-v1' ? 'Kiểm tra tính đầy đủ và giới hạn của dữ liệu vùng đã chọn.' : 'Tóm tắt dữ liệu hiện có và chỉ rõ điều chưa đủ nguồn.'), signal,
        onRunStarted: (activeRunId) => { if (token === operation) set({ activeRunId }); else void cancelVectorAiRun(activeRunId); },
        onEvent: (event) => { if (token === operation && event.type !== 'delta') set({ stage: event.message || (event.stage ? `Đang xử lý: ${event.stage}` : get().stage) }); },
      });
      assertAnalysisResult(result);
      if (signal.aborted || token !== operation || revision !== get().contextRevision) return;
      set({ result, busy: 'idle', stage: 'Kết quả đã hoàn tất và qua kiểm tra nguồn.', activeReportId: null });
      void get().refreshReports();
    } catch (error) { if (token === operation) set({ busy: 'idle', error: signal.aborted ? null : message(error), stage: signal.aborted ? 'Đã hủy.' : 'Có thể dùng Khôi phục để đọc trạng thái đã lưu.' }); }
    finally { if (token === operation) controller = null; }
  },
  recover: async (requestedId) => {
    const id = requestedId ?? get().activeRunId; if (!id) return;
    get().cancel(); const token = ++operation; set({ busy: 'recovering', error: null, stage: 'Đang đọc kết quả đã lưu…' });
    try {
      const run = await getAnalysisRun(id);
      if (run.status !== 'completed' || !run.result) throw new Error(run.error || `Lượt chạy: ${run.status}. Chưa có kết quả hoàn tất.`);
      assertAnalysisResult(run.result);
      const snapshot = run.snapshotId ? await getAnalysisSnapshot(run.snapshotId) : null;
      if (token !== operation) return;
      set({ result: run.result, snapshot, aoi: snapshot?.aoi ?? null, activeRunId: id, contextRevision: get().contextRevision + 1, busy: 'idle', stage: 'Đã đọc bản hoàn tất; không chạy lại model.', activeReportId: null });
    } catch (error) { if (token === operation) set({ busy: 'idle', error: message(error) }); }
  },
  openReport: (id) => { const report = get().reports.find((r) => r.id === id); if (!report) return; get().cancel(); set({ activeReportId: id, reportTitle: report.title, notes: report.notes, snapshot: report.snapshot, result: report.result, aoi: report.snapshot?.aoi ?? null, contextRevision: get().contextRevision + 1, appliedAnnotations: [], source: null, sourceExcerpt: null, tab: 'chat', error: null, stage: 'Đã mở kết quả đã lưu.' }); },
  setReportTitle: (reportTitle) => set({ reportTitle }), setNotes: (notes) => set({ notes }),
  saveReport: async () => {
    const state = get(); if (!state.result?.validation.valid) { set({ error: 'Cần một kết quả đã hoàn tất để tạo báo cáo.' }); return; }
    const parent = state.reports.find((r) => r.id === state.activeReportId), now = new Date().toISOString();
    const report: AnalysisReport = { schemaVersion: 1, id: crypto.randomUUID(), revision: parent ? parent.revision + 1 : 1, ...(parent ? { parentId: parent.id } : {}), ...(parent?.importedFrom ? { importedFrom: parent.importedFrom } : {}), title: state.reportTitle.trim() || 'Phân tích GIS', createdAt: now, updatedAt: now, snapshot: state.snapshot, result: state.result, notes: state.notes, annotations: state.appliedAnnotations };
    try {
      assertAnalysisReport(report); await persistDraft(report);
      let saved = report, localOnly = true, syncError = '';
      const synced = new Map<string, AnalysisReport>();
      try {
        // Offline revisions must reach Core in parent order. Imported files are
        // new roots with separate provenance, never a foreign parent chain.
        const pending: AnalysisReport[] = [], seen = new Set<string>();
        let ancestor = parent;
        while (ancestor && get().localOnlyReportIds.includes(ancestor.id)) {
          if (seen.has(ancestor.id) || seen.size >= 200) throw new Error('Chuỗi phiên bản local không hợp lệ.');
          seen.add(ancestor.id); pending.unshift(ancestor);
          ancestor = get().reports.find((r) => r.id === ancestor?.parentId);
        }
        for (const item of pending) {
          const remote = await saveAnalysisReport(item); await persistDraft(remote); synced.set(remote.id, remote);
        }
        saved = await saveAnalysisReport(report); await persistDraft(saved); localOnly = false;
      } catch (error) { syncError = message(error); }
      set({ reports: [saved, ...get().reports.map((r) => synced.get(r.id) ?? r)], activeReportId: saved.id,
        localOnlyReportIds: [...get().localOnlyReportIds.filter((id) => !synced.has(id)), ...(localOnly ? [saved.id] : [])],
        stage: localOnly ? 'Đã lưu bản nháp trên máy; chưa đồng bộ được với Core.' : 'Đã lưu phiên bản báo cáo mới.',
        error: localOnly ? `Đồng bộ báo cáo: ${syncError}` : null });
    } catch (error) { set({ error: message(error) }); }
  },
  applyDraftAnnotation: (id) => { const a = get().result?.draftAnnotations.find((item) => item.id === id) ?? get().reports.find((r) => r.id === get().activeReportId)?.annotations.find((item) => item.id === id); if (a && !get().appliedAnnotations.some((item) => item.id === id)) set({ appliedAnnotations: [...get().appliedAnnotations, a] }); },
  removeAnnotation: (id) => set({ appliedAnnotations: get().appliedAnnotations.filter((a) => a.id !== id) }),
  openSource: async (source) => {
    set({ source, sourceExcerpt: null, highlightGeometry: source?.geometry ?? null }); if (!source) return;
    try { const excerpt = source.kind === 'document' ? await readAnalysisDocumentSource(source) : source.excerpt ?? `${source.fieldPath ?? source.label}: ${source.value ?? 'chưa có số đo'} ${source.unit ?? ''}`; if (get().source?.id === source.id) set({ sourceExcerpt: excerpt }); }
    catch (error) { if (get().source?.id === source.id) set({ sourceExcerpt: message(error) }); }
  },
  importDocument: async (file) => { set({ busy: 'importing', error: null }); try { await get().refreshServices(true); const imported = await importAnalysisDocument(file); await get().refreshDocuments(); get().selectDocument(imported.id, true); set({ stage: 'Đã nhận tài liệu. Core đang lập chỉ mục; cập nhật danh sách nguồn khi hoàn tất.', busy: 'idle' }); } catch (error) { set({ busy: 'idle', error: message(error) }); } },
  importPackage: async (file) => { set({ busy: 'importing', error: null }); try { if (file.size > 100 * 1024 * 1024) throw new Error('Gói vượt giới hạn nén 100 MiB.'); const report = await importAnalysisPackage(new Uint8Array(await file.arrayBuffer())); await persistDraft(report); set({ reports: [report, ...get().reports], localOnlyReportIds: [...get().localOnlyReportIds, report.id], busy: 'idle' }); get().openReport(report.id); set({ stage: 'Đã nhập thành bản nháp mới; chưa áp dụng ghi chú bản đồ.' }); } catch (error) { set({ busy: 'idle', error: message(error) }); } },
  exportPackage: async () => { const state = get(); let report = state.reports.find((r) => r.id === state.activeReportId); if (!report && state.result) { const now = new Date().toISOString(); report = { schemaVersion: 1, id: crypto.randomUUID(), revision: 1, title: state.reportTitle.trim() || 'Phân tích GIS', createdAt: now, updatedAt: now, snapshot: state.snapshot, result: state.result, notes: state.notes, annotations: state.result.draftAnnotations }; } if (!report) { set({ error: 'Chưa có báo cáo để xuất.' }); return null; } try { return await exportAnalysisPackage({ ...report, notes: state.notes, title: state.reportTitle }); } catch (error) { set({ error: message(error) }); return null; } },
}));
