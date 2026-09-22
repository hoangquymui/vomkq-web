/**
 * PANEL "AI GỢI Ý VỊ TRÍ ĐẶT KHÍ TÀI" — cố vấn bố trí dùng VECTOR AI chạy local.
 *
 * - Trạng thái kết nối backend: kiểm tra qua proxy /vector-ai (xem vite.config.ts).
 * - Chọn khí tài + model, bấm "Phân tích" -> store gọi backend và parse JSON an toàn.
 * - Danh sách gợi ý hiển thị toạ độ / điểm / lý do, mỗi gợi ý có nút "Đặt tại đây".
 * - Khi mở panel, tự khởi động các dịch vụ local còn thiếu rồi nạp danh sách model.
 */
import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Bot,
  X,
  RefreshCw,
  Trash2,
  MapPin,
  Loader2,
  WifiOff,
  Navigation,
  AlertTriangle,
  Crosshair,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { ensureVectorAiReady, listVectorAiModels, VECTOR_AI_BASE_URL } from '../../services/vectorAiClient';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import type { AiAdvisorStatus } from '../../store/useTacticalStore';

/** Nhãn trạng thái cố vấn hiển thị cho người dùng */
const STATUS_LABEL: Record<AiAdvisorStatus, string> = {
  idle: 'Chưa phân tích',
  checking: 'Đang kiểm tra VECTOR AI...',
  thinking: 'Đang phân tích...',
  ready: 'Đã có gợi ý',
  error: 'Lỗi phân tích',
  offline: 'VECTOR AI chưa kết nối',
};

/** Màu badge theo trạng thái */
function statusBadgeClass(status: AiAdvisorStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50';
    case 'checking':
    case 'thinking':
      return 'bg-amber-950/80 text-amber-300 border-amber-500/50';
    case 'offline':
      return 'bg-rose-950/80 text-rose-300 border-rose-500/50';
    case 'error':
      return 'bg-orange-950/80 text-orange-300 border-orange-500/50';
    default:
      return 'bg-slate-900 text-slate-400 border-slate-700';
  }
}

export const AiPlacementAdvisorPanel: React.FC = () => {
  const {
    aiAdvisorPanelOpen,
    setAiAdvisorPanelOpen,
    aiAdvisorStatus,
    aiAdvisorError,
    aiAdvisorSummary,
    aiAdvisorSuggestions,
    aiAdvisorRoute,
    aiAdvisorTemplateId,
    setAiAdvisorTemplateId,
    runAiPlacementAnalysis,
    clearAiPlacementSuggestions,
    placeEquipmentAtSuggestion,
    selectedInstanceId,
    instances,
  } = useTacticalStore();

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  // Mở panel hoặc thử lại -> khởi động dịch vụ còn thiếu -> nạp danh sách model.
  useEffect(() => {
    if (!aiAdvisorPanelOpen) return;

    let cancelled = false;
    void (async () => {
      setConnectionStatus('connecting');
      setModelsError(null);
      const started = await ensureVectorAiReady();
      if (cancelled) return;
      if (!started.ok) {
        setConnectionStatus('error');
        setModelsError(started.error.message);
        setModels([]);
        return;
      }
      const result = await listVectorAiModels();
      if (cancelled) return;
      if (!result.ok) {
        setConnectionStatus('error');
        setModelsError(result.error.message);
        setModels([]);
        return;
      }
      setModels(result.value);
      setSelectedModel((prev) => result.value.includes(prev) ? prev : result.value[0] || '');
      setConnectionStatus('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [aiAdvisorPanelOpen, connectionAttempt]);

  const isLoadingModels = connectionStatus === 'connecting';

  /** Counter làm effect chạy lại kể cả khi danh sách model đang rỗng do lỗi. */
  const refreshModels = () => {
    setConnectionAttempt((attempt) => attempt + 1);
  };

  if (!aiAdvisorPanelOpen) return null;

  const selectedInstance = instances.find((i) => i.instanceId === selectedInstanceId);
  const isBusy = aiAdvisorStatus === 'checking' || aiAdvisorStatus === 'thinking';
  const canAnalyze = !isBusy && connectionStatus === 'ready' && models.includes(selectedModel);
  const displayStatus = aiAdvisorStatus === 'offline' && connectionStatus === 'ready' ? 'idle' : aiAdvisorStatus;

  return (
    <aside className="absolute top-16 left-[336px] z-30 w-80 max-h-[62vh] overflow-y-auto bg-slate-950/95 backdrop-blur-md border border-cyan-500/50 rounded-2xl shadow-[0_0_34px_rgba(0,0,0,0.75)] select-none flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 bg-slate-900/60 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold font-mono text-cyan-300">AI GỢI Ý VỊ TRÍ ĐẶT KHÍ TÀI</span>
        </div>
        <button
          onClick={() => setAiAdvisorPanelOpen(false)}
          className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
          title="Đóng panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3 text-xs">
        <p role="status" aria-live="polite" className={`text-[11px] ${connectionStatus === 'error' ? 'text-rose-300' : 'text-cyan-300'}`}>
          {isLoadingModels
            ? 'Đang khởi động và kết nối VECTOR AI… Lần đầu có thể mất khoảng một phút.'
            : connectionStatus === 'ready'
              ? 'Đã kết nối VECTOR AI'
              : 'Không kết nối được VECTOR AI. Bấm nút thử lại bên dưới.'}
        </p>
        {/* 1. Trạng thái kết nối backend */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono ${statusBadgeClass(
              displayStatus
            )}`}
            title={`Backend VECTOR AI: ${VECTOR_AI_BASE_URL} (proxy -> http://127.0.0.1:8000)`}
          >
            {displayStatus === 'offline' ? (
              <WifiOff className="w-3 h-3" />
            ) : isBusy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Bot className="w-3 h-3" />
            )}
            <span>{STATUS_LABEL[displayStatus]}</span>
          </span>

          <button
            onClick={refreshModels}
            disabled={isLoadingModels || isBusy}
            className="p-1.5 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 transition-colors"
            title="Kiểm tra lại kết nối VECTOR AI"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Cảnh báo offline đúng như yêu cầu */}
        {aiAdvisorStatus === 'offline' && connectionStatus !== 'ready' && !isLoadingModels && !modelsError && (
          <p className="p-2 rounded bg-rose-950/40 border border-rose-900/60 text-rose-300 text-[11px] leading-relaxed">
            VECTOR AI chưa kết nối (127.0.0.1:8000)
            {aiAdvisorError ? <span className="block text-rose-400/80 mt-1">{aiAdvisorError}</span> : null}
          </p>
        )}

        {aiAdvisorStatus === 'error' && aiAdvisorError && (
          <p className="flex items-start gap-1.5 p-2 rounded bg-orange-950/40 border border-orange-900/60 text-orange-300 text-[11px] leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{aiAdvisorError}</span>
          </p>
        )}

        {modelsError && !isBusy && (
          <p className="p-2 rounded bg-rose-950/40 border border-rose-900/60 text-rose-300 text-[11px] leading-relaxed">
            VECTOR AI chưa kết nối (127.0.0.1:8000)
            <span className="block text-rose-400/80 mt-1">{modelsError}</span>
          </p>
        )}

        {/* 2. Chọn model + khí tài */}
        <div>
          <span className="text-[10px] text-slate-400 block mb-1">Model VECTOR AI (Ollama local)</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={models.length === 0 || isBusy || isLoadingModels}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[11px] font-mono text-cyan-300 focus:outline-none focus:border-cyan-500 disabled:text-slate-500"
          >
            {models.length === 0 ? (
              <option value="">{isLoadingModels ? 'Đang nạp danh sách model...' : 'Chưa có model'}</option>
            ) : (
              models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            )}
          </select>
        </div>

        {connectionStatus === 'ready' && models.length === 0 && (
          <p className="text-[11px] text-amber-300">Đã kết nối nhưng Ollama chưa có model. Hãy thêm model vào Ollama rồi bấm thử lại.</p>
        )}

        <div>
          <span className="text-[10px] text-slate-400 block mb-1">Khí tài cần đặt</span>
          <select
            value={aiAdvisorTemplateId ?? ''}
            onChange={(e) => setAiAdvisorTemplateId(e.target.value || null)}
            disabled={isBusy}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">
              {selectedInstance ? `Theo khí tài đang chọn: ${selectedInstance.name}` : '-- Chọn khí tài --'}
            </option>
            {EQUIPMENT_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Nút phân tích / xoá */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runAiPlacementAnalysis(selectedModel)}
            disabled={!canAnalyze}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-semibold transition-colors ${
              canAnalyze
                ? 'border-cyan-500/60 bg-cyan-950/60 hover:bg-cyan-900/70 text-cyan-300'
                : 'border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed'
            }`}
            title="Gửi thông số khí tài + vùng quan tâm cho VECTOR AI để xin gợi ý vị trí"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
            <span>{isBusy ? 'Đang phân tích...' : 'Phân tích'}</span>
          </button>

          <button
            onClick={clearAiPlacementSuggestions}
            disabled={isBusy || (aiAdvisorSuggestions.length === 0 && aiAdvisorRoute.length === 0)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors disabled:text-slate-600 disabled:hover:bg-slate-900"
            title="Xoá toàn bộ gợi ý và tuyến khỏi bản đồ"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xoá gợi ý</span>
          </button>
        </div>

        {/* 4. Tóm tắt + danh sách gợi ý */}
        {aiAdvisorSummary && (
          <div className="p-2 rounded bg-slate-900/70 border border-slate-800 text-[11px] text-slate-300 leading-relaxed">
            <span className="block text-[9px] font-mono text-cyan-400 mb-1">TÓM TẮT CỦA AI</span>
            {aiAdvisorSummary}
          </div>
        )}

        {aiAdvisorSuggestions.length === 0 && aiAdvisorStatus === 'ready' && (
          <p className="text-[11px] text-slate-500 italic">
            AI không đề xuất vị trí nào trong vùng quan tâm hiện tại.
          </p>
        )}

        {aiAdvisorSuggestions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-cyan-400">
                GỢI Ý ({aiAdvisorSuggestions.length})
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                TUYẾN: {aiAdvisorRoute.length} điểm
              </span>
            </div>

            {aiAdvisorSuggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.latitude.toFixed(4)}_${suggestion.longitude.toFixed(4)}_${index}`}
                className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-200">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    <span>
                      {suggestion.latitude.toFixed(4)}, {suggestion.longitude.toFixed(4)}
                    </span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-600/50 text-cyan-300 text-[10px] font-mono">
                    {Math.round(suggestion.score * 100)}%
                  </span>
                </div>

                {suggestion.reason && (
                  <p className="text-[11px] text-slate-400 leading-snug">{suggestion.reason}</p>
                )}

                <button
                  onClick={() => placeEquipmentAtSuggestion(index)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-emerald-600/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 text-[11px] font-semibold transition-colors"
                  title="Đặt khí tài đang chọn tại toạ độ gợi ý này"
                >
                  <Navigation className="w-3 h-3" />
                  <span>Đặt tại đây</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
