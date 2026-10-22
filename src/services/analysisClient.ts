import type { AnalysisReport, AnalysisResult, AnalysisRunRecord, AnalysisSnapshot, AnalysisWorkflowId, EvidenceRef } from '../types/analysis';
import { askVectorAi, VECTOR_AI_BASE_URL } from './vectorAiClient';
import type { VectorAiRunEvent } from './vectorAiClient';

/** HTTP metadata requests use 30 s; inference retains the existing 120 s profile.
 * Limits bound local transport waits and do not claim anything about model quality. */
const REQUEST_TIMEOUT_MS = 30_000;
export interface AnalysisDocument { id: string; version: number; title: string; enabled: boolean; lifecycle?: string }
export interface AnalysisQuery {
  model: string;
  workflowId: AnalysisWorkflowId;
  snapshot?: AnalysisSnapshot | null;
  documentIds?: string[];
  reportIds?: string[];
  question: string;
  signal?: AbortSignal;
  onRunStarted?: (id: string) => void;
  onEvent?: (event: VectorAiRunEvent) => void;
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(`${VECTOR_AI_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body); } catch { /* retain HTTP diagnostic */ }
    throw new Error(`AI local: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 500)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function saveAnalysisSnapshot(snapshot: AnalysisSnapshot, signal?: AbortSignal): Promise<void> {
  await request('/api/v1/analysis/snapshots', { method: 'POST', body: JSON.stringify({ snapshot }) }, signal);
}
export async function getAnalysisSnapshot(id: string, signal?: AbortSignal): Promise<AnalysisSnapshot> {
  const data = await request<{ snapshot: AnalysisSnapshot }>(`/api/v1/analysis/snapshots/${encodeURIComponent(id)}`, {}, signal);
  return data.snapshot;
}
export async function getAnalysisRun(id: string, signal?: AbortSignal): Promise<AnalysisRunRecord> {
  const data = await request<{ run: AnalysisRunRecord }>(`/api/v1/analysis/runs/${encodeURIComponent(id)}`, {}, signal);
  return data.run;
}
export async function listAnalysisHistory(): Promise<AnalysisRunRecord[]> {
  return (await request<{ runs: AnalysisRunRecord[] }>('/api/v1/analysis/history')).runs;
}
export async function listAnalysisReports(): Promise<AnalysisReport[]> {
  return (await request<{ reports: AnalysisReport[] }>('/api/v1/analysis/reports')).reports;
}
export async function saveAnalysisReport(report: AnalysisReport): Promise<AnalysisReport> {
  return (await request<{ report: AnalysisReport }>('/api/v1/analysis/reports', { method: 'POST', body: JSON.stringify({ report }) })).report;
}
export async function listAnalysisDocuments(): Promise<AnalysisDocument[]> {
  const data = await request<{ documents: AnalysisDocument[] }>('/api/v1/documents');
  return data.documents.filter((doc) => doc.enabled && doc.lifecycle !== 'trashed' && doc.lifecycle !== 'archived');
}
export async function importAnalysisDocument(file: File): Promise<{ id: string; run_id: string }> {
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error('Bản đầu chỉ nhập tài liệu TXT hoặc Markdown.');
  // Match the Core upload API: 100 MiB maximum compressed/file input.
  if (file.size > 100 * 1024 * 1024) throw new Error('Tài liệu vượt giới hạn 100 MiB.');
  const form = new FormData();
  form.append('file', file);
  form.append('scope', JSON.stringify({ builtin: true }));
  return request('/api/v1/documents', { method: 'POST', body: form });
}
export async function readAnalysisDocumentSource(ref: EvidenceRef): Promise<string> {
  if (ref.excerpt) return ref.excerpt;
  if (!ref.documentId || !ref.chunkId) throw new Error('Nguồn này không có đoạn tài liệu để mở.');
  const path = `/api/v1/documents/${encodeURIComponent(ref.documentId)}/tree/source/${encodeURIComponent(ref.chunkId)}?version=${encodeURIComponent(ref.version)}`;
  const data = await request<{ chunk: { text?: string } }>(path);
  return data.chunk.text ?? 'Đoạn nguồn không có văn bản.';
}

/** Publish only the durable, validated result. Token deltas remain temporary and
 * are deliberately not returned as an analysis answer. Reconnect uses GET, not SSE replay. */
export async function runAnalysisQuery(query: AnalysisQuery): Promise<AnalysisResult> {
  if (query.snapshot) await saveAnalysisSnapshot(query.snapshot, query.signal);
  let runId = '';
  const streamed = await askVectorAi({
    model: query.model,
    mode: 'FAST',
    workflowId: query.workflowId,
    snapshotId: query.snapshot?.id,
    documentIds: query.documentIds ?? [],
    reportIds: query.reportIds ?? [],
    strictSources: true,
    messages: [{ role: 'user', content: query.question }],
    signal: query.signal,
    onEvent: query.onEvent,
    onRunStarted: (id) => { runId = id; query.onRunStarted?.(id); },
  });
  if (query.signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');
  if (!runId) throw new Error(streamed.ok ? 'Backend không trả mã lượt chạy.' : streamed.error.message);
  const run = await getAnalysisRun(runId, query.signal);
  if (run.status !== 'completed' || !run.result) {
    throw new Error(run.error || (!streamed.ok ? streamed.error.message : `Lượt chạy đang ở trạng thái ${run.status}. Dùng Khôi phục để đọc lại kết quả.`));
  }
  if (!run.result.validation?.valid || (streamed.ok && streamed.value.truncated)) {
    throw new Error('Kết quả chưa qua kiểm chứng hoặc bị cắt; chưa công bố báo cáo.');
  }
  return run.result;
}
