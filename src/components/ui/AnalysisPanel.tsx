import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import type { AnalysisTab } from '../../store/useAnalysisStore';
import type { EvidenceRef } from '../../types/analysis';
import { VECTOR_AI_BASE_URL } from '../../services/vectorAiClient';
import { useTacticalStore } from '../../store/useTacticalStore';
import { AiPlacementAdvisorPanel } from './AiPlacementAdvisorPanel';

const tabs: [AnalysisTab, string][] = [['analysis', 'AI phân tích'], ['chat', 'Chat'], ['documents', 'Tài liệu']];
const statusLabels: Record<string, string> = { observed: 'Có quan sát', partial: 'Một phần', unknown: 'Chưa xác minh', missing: 'Thiếu dữ liệu', outside: 'Ngoài phạm vi' };
const button = 'rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded border border-slate-600 bg-slate-900 p-2 text-xs focus:outline-none focus:border-emerald-400';
function number(value: number | null): string { return value === null ? 'Chưa có' : value.toLocaleString('vi-VN', { maximumSignificantDigits: 8 }); }

export function AnalysisPanel() {
  const s = useAnalysisStore();
  const [question, setQuestion] = useState('');
  const [capabilities, setCapabilities] = useState<{ retrievalMode?: string; denseAvailable?: boolean; ocr?: { tesseract?: boolean; pix2text?: boolean } } | null>(null);
  useEffect(() => {
    if (!s.enabled || !s.panelOpen) return;
    const store = useAnalysisStore.getState();
    void store.refreshServices(); void store.refreshDocuments();
    const controller = new AbortController();
    void fetch(`${VECTOR_AI_BASE_URL}/api/v1/analysis/capabilities`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null).then(setCapabilities).catch(() => {});
    return () => controller.abort();
  }, [s.enabled, s.panelOpen]);
  // Reuse the existing layer visibility lifecycle for the embedded analysis.
  useEffect(() => {
    if (!s.enabled || !s.panelOpen || s.tab !== 'analysis') return;
    const tactical = useTacticalStore.getState();
    tactical.setAiAdvisorPanelOpen(true);
    return () => tactical.setAiAdvisorPanelOpen(false);
  }, [s.enabled, s.panelOpen, s.tab]);
  if (!s.enabled || !s.panelOpen) return null;
  const busy = s.busy !== 'idle';
  const openSource = (ref?: EvidenceRef) => { if (ref) void s.openSource(ref); };
  return <aside aria-label="Trợ lý GIS có nguồn" className="absolute right-4 top-16 bottom-6 z-40 w-[490px] max-w-[calc(100vw-32px)] flex flex-col rounded-xl border border-emerald-500/50 bg-slate-950/95 text-slate-200 shadow-2xl">
    <header className="flex items-center justify-between border-b border-slate-700 p-3">
      <div><h2 className="font-bold text-emerald-300">GIS AI · local</h2><p className="text-[11px] text-slate-400">AI phân tích · hỏi đáp tài liệu có nguồn</p></div>
      <button className={button} onClick={() => s.setPanelOpen(false)} aria-label="Đóng trợ lý GIS">✕</button>
    </header>
    <nav className="flex gap-1 p-2 border-b border-slate-700" aria-label="Các phần phân tích">{tabs.map(([id, label]) => <button key={id} onClick={() => s.setTab(id)} className={`${button} flex-1 ${s.tab === id ? 'border-emerald-400 text-emerald-200 bg-emerald-950' : ''}`}>{label}</button>)}</nav>
    {s.tab !== 'analysis' && <div className="flex items-center gap-2 px-3 py-2 text-[11px] border-b border-slate-800">
      <span className={s.serviceStatus === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>Core: {s.serviceStatus === 'ready' ? 'đã kết nối' : s.serviceStatus === 'starting' ? 'đang bật' : 'chưa kết nối'}</span>
      <span className="text-slate-400">Tìm nguồn: {capabilities?.retrievalMode ?? 'chưa kiểm tra'}</span>
      <button className={`${button} ml-auto`} onClick={() => void s.refreshServices(true)} disabled={busy}>Kết nối local</button>
    </div>}
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      {s.tab !== 'analysis' && s.error && <div role="alert" className="border border-rose-500/50 rounded p-2 text-xs text-rose-200 whitespace-pre-wrap">{s.error}</div>}
      {s.tab !== 'analysis' && s.stage && <div role="status" className="text-xs text-emerald-200 flex items-center justify-between gap-2"><span>{s.stage}</span>{busy && <button className={button} onClick={s.cancel}>Hủy</button>}</div>}

      {s.tab === 'analysis' && <AiPlacementAdvisorPanel embedded />}

      {s.tab === 'chat' && <>
        <p className="text-xs text-slate-400">Hỏi các tài liệu đã chọn. Xem gợi ý vị trí khí tài trong mục AI phân tích.</p>
        <label className="block text-xs">Model đã có trên máy<select className={`${input} mt-1`} value={s.selectedModel} onChange={(e) => s.setModel(e.target.value)}><option value="">Chưa có model</option>{s.models.map((model) => <option key={model}>{model}</option>)}</select></label>
        <button className={`${button} w-full text-left`} onClick={() => s.setTab('documents')}>Nguồn: {s.selectedDocumentIds.length} tài liệu đã chọn · bấm để chọn</button>
        <textarea aria-label="Câu hỏi cho trợ lý GIS" className={input} rows={4} maxLength={4000} placeholder="Hỏi bằng tiếng Việt về tài liệu đã chọn…" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <div className="flex flex-wrap gap-1">{['Tóm tắt nội dung chính của tài liệu đã chọn.', 'Trích đoạn tài liệu giải thích chỉ số này.', 'Nguồn đang thiếu những thông tin nào?'].map((q) => <button key={q} className={`${button} text-[10px]`} onClick={() => setQuestion(q)}>{q}</button>)}</div>
        <div className="flex gap-2"><button className={button} disabled={busy || !s.selectedDocumentIds.length} onClick={() => void s.run('document-qa-v1', question.trim() || 'Tóm tắt nội dung chính của tài liệu đã chọn.')}>Gửi câu hỏi</button>{s.activeRunId && <button className={button} disabled={busy} onClick={() => void s.recover()}>Khôi phục kết quả</button>}</div>
        <p className="text-[11px] text-slate-400">Chỉ dùng nguồn đã chọn. Diễn giải bằng lời vẫn cần bạn xem lại.</p>
      </>}

      {s.tab === 'documents' && <>
        <p className="text-xs text-slate-400">Nhập TXT/Markdown local và chọn tài liệu dùng cho lượt hỏi. Tài liệu đang lập chỉ mục chưa phải nguồn sẵn sàng.</p>
        <p className="text-[11px] text-slate-400">Tìm nguồn: {capabilities?.retrievalMode ?? 'chưa kiểm tra'} · Dense: {capabilities ? capabilities.denseAvailable ? 'sẵn sàng' : 'chưa sẵn sàng' : 'chưa kiểm tra'} · OCR: {capabilities?.ocr?.tesseract || capabilities?.ocr?.pix2text ? 'có extractor local' : 'chưa sẵn sàng'}</p>
        <input aria-label="Nhập tài liệu TXT Markdown" className="text-xs w-full" type="file" accept=".txt,.md" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void s.importDocument(file); e.target.value = ''; }} />
        <button className={button} onClick={() => void s.refreshDocuments()}>Cập nhật danh sách</button>
        {s.documents.map((doc) => <label key={doc.id} className="flex gap-2 items-start p-2 bg-slate-900 rounded text-xs"><input type="checkbox" checked={s.selectedDocumentIds.includes(doc.id)} onChange={(e) => s.selectDocument(doc.id, e.target.checked)} /><span>{doc.title}<span className="block text-slate-500">Phiên bản {doc.version}</span></span></label>)}
        <p className="text-xs text-emerald-200">Đã chọn {s.selectedDocumentIds.length} tài liệu.</p>
        <button className={button} onClick={() => s.setTab('chat')}>Hỏi tài liệu đã chọn</button>
      </>}

      {s.result && s.tab === 'chat' && <section className="border-t border-slate-700 pt-3 space-y-2">
        <h3 className="font-semibold text-emerald-200 text-sm">Kết quả · {s.result.status === 'complete' ? 'có nguồn' : s.result.status === 'partial' ? 'một phần' : 'thiếu nguồn'}</h3>
        <p className="text-[10px] text-slate-500">{s.result.usage.modelInvoked === false ? 'Trả từ dữ liệu bằng code' : `Model của lượt này: ${s.result.model}`} · {s.result.workflowId}{typeof s.result.usage.durationSeconds === 'number' ? ` · ${number(s.result.usage.durationSeconds)} giây` : ''}</p>
        <div className="text-xs whitespace-pre-wrap leading-relaxed break-words">{s.result.answer.split(/(\[[^\]]+\])/g).map((part, index) => {
          const refIndex = s.result!.citations.findIndex((ref) => part === `[${ref.id}]`);
          return refIndex < 0 ? <span key={index}>{part}</span> : <button key={index} className="text-cyan-300 underline" onClick={() => openSource(s.result!.citations[refIndex])}>[{refIndex + 1}]</button>;
        })}</div>
        {(s.result.missingData.length > 0 || s.result.warnings.length > 0) && <details className="rounded border border-amber-800 p-2"><summary className="cursor-pointer text-xs text-amber-200">Giới hạn dữ liệu ({s.result.missingData.length + s.result.warnings.length}) · mở để xem</summary>{[...s.result.missingData, ...s.result.warnings].map((line, i) => <p key={i} className="mt-1 text-[11px] text-amber-200">{line.replace(/: (observed|partial|unknown|missing|outside)\b/g, (_, status: string) => `: ${statusLabels[status]}`)}</p>)}</details>}
        <h4 className="text-xs font-semibold">Nguồn · bấm để xem</h4>{s.result.citations.map((ref, index) => <button key={ref.id} className={`${button} w-full text-left break-all`} onClick={() => openSource(ref)}>[{index + 1}] {ref.label}<span className="block text-[10px] text-slate-400">{ref.sourceId} · {ref.version}</span></button>)}
      </section>}
      {s.source && s.tab !== 'analysis' && <section className="rounded border border-cyan-700 p-2 text-xs space-y-1"><div className="flex justify-between"><b>Nguồn: {s.source.label}</b><button onClick={() => void s.openSource(null)} aria-label="Đóng nguồn">✕</button></div><p className="break-all text-slate-400">{s.source.sourceId} · {s.source.version}</p><p className="whitespace-pre-wrap break-words">{s.sourceExcerpt ?? 'Đang mở đoạn nguồn…'}</p></section>}
    </div>
  </aside>;
}
