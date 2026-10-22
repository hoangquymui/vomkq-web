/**
 * PANEL "AI GỢI Ý VỊ TRÍ ĐẶT KHÍ TÀI".
 *
 * - Toạ độ + điểm số do ĐỘNG CƠ CLIENT tính từ dữ liệu thật (terrain + lớp vectơ OSM);
 *   VECTOR AI chỉ XẾP HẠNG và viết diễn giải thêm (không bịa toạ độ).
 * - Trạng thái kết nối backend kiểm tra qua proxy /vector-ai (xem vite.config.ts).
 * - Bấm "Phân tích" LUÔN chạy được; nếu AI chưa kết nối thì vẫn có gợi ý kèm số liệu thật.
 * - Danh sách gợi ý hiển thị toạ độ / điểm / số liệu / lý do, mỗi gợi ý có nút "Đặt tại đây".
 * - Khi mở panel, tự khởi động các dịch vụ local còn thiếu rồi nạp danh sách model.
 */
import React, { useEffect, useRef, useState } from 'react';
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
  Layers,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import { ensureVectorAiReady, listVectorAiModels, VECTOR_AI_BASE_URL } from '../../services/vectorAiClient';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { useTacticalSandboxStore } from '../../store/useTacticalSandboxStore';
import type { AiAdvisorStatus } from '../../store/useTacticalStore';
import type { AiPlacementSuggestion } from '../../utils/aiPlacementAdvisor';

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

/**
 * Mô tả ngắn các SỐ LIỆU THẬT của 1 gợi ý để hiển thị dạng chip.
 * Nhờ vậy người dùng thấy được "vì sao vị trí này" thay vì chỉ một con số % trơ.
 */
function describeSuggestionMetrics(suggestion: AiPlacementSuggestion): string[] {
  const criteria = suggestion.criteria;
  if (!criteria) return [];

  const chips: string[] = [];
  if (criteria.hasTerrainData) {
    chips.push(`Cao ${criteria.elevationM} m`);
    chips.push(`Nhô ${criteria.reliefM} m`);
    chips.push(`Dốc ${criteria.localSlopeDeg.toFixed(1)}°`);
  }
  if (criteria.hasVectorData) {
    chips.push(
      criteria.nearestBuildingKm === null
        ? 'Không nhà trong bán kính quét'
        : `Nhà ${criteria.nearestBuildingKm.toFixed(1)} km`
    );
    if (criteria.nearestWaterKm !== null) chips.push(`Nước ${criteria.nearestWaterKm.toFixed(1)} km`);
    if (criteria.nearestHighwayKm !== null) {
      chips.push(`Đường ${criteria.nearestHighwayKm.toFixed(1)} km`);
    }
  }
  if (criteria.nearestPlacedKm !== null) {
    chips.push(`Đài khác ${criteria.nearestPlacedKm.toFixed(1)} km`);
  }
  return chips;
}

interface AiPlacementAdvisorPanelProps {
  /** Render the existing analysis controls inside the GIS AI panel. */
  embedded?: boolean;
}

export const AiPlacementAdvisorPanel: React.FC<AiPlacementAdvisorPanelProps> = ({ embedded = false }) => {
  const {
    aiAdvisorPanelOpen,
    setAiAdvisorPanelOpen,
    aiAdvisorStatus,
    aiAdvisorError,
    aiAdvisorDegraded,
    aiAdvisorSummary,
    aiAdvisorSuggestions,
    aiAdvisorRoute,
    aiAdvisorTemplateId,
    setAiAdvisorTemplateId,
    runAiPlacementAnalysis,
    clearAiPlacementSuggestions,
    placeEquipmentAtSuggestion,
    selectedAdvisorSuggestionIndex,
    selectAdvisorSuggestion,
    triggerFlyTo,
    selectedInstanceId,
    instances,
    showVectorLayer,
    setShowVectorLayer,
    vectorPackCount,
    showMapOverlays,
    setShowMapOverlays,
    isSelectingFlatnessCenter,
    isAnalyzingFlatness,
    analysisRegion,
    analysisStatus,
    analysisError,
    flatnessAnalysisResult,
    runFlatnessAnalysis,
    startFlatnessSelection,
    cancelFlatnessSelection,
    clearFlatnessResult,
  } = useTacticalStore(useShallow((state) => ({
    aiAdvisorPanelOpen: state.aiAdvisorPanelOpen,
    setAiAdvisorPanelOpen: state.setAiAdvisorPanelOpen,
    aiAdvisorStatus: state.aiAdvisorStatus,
    aiAdvisorError: state.aiAdvisorError,
    aiAdvisorDegraded: state.aiAdvisorDegraded,
    aiAdvisorSummary: state.aiAdvisorSummary,
    aiAdvisorSuggestions: state.aiAdvisorSuggestions,
    aiAdvisorRoute: state.aiAdvisorRoute,
    aiAdvisorTemplateId: state.aiAdvisorTemplateId,
    setAiAdvisorTemplateId: state.setAiAdvisorTemplateId,
    runAiPlacementAnalysis: state.runAiPlacementAnalysis,
    clearAiPlacementSuggestions: state.clearAiPlacementSuggestions,
    placeEquipmentAtSuggestion: state.placeEquipmentAtSuggestion,
    selectedAdvisorSuggestionIndex: state.selectedAdvisorSuggestionIndex,
    selectAdvisorSuggestion: state.selectAdvisorSuggestion,
    triggerFlyTo: state.triggerFlyTo,
    selectedInstanceId: state.selectedInstanceId,
    instances: state.instances,
    showVectorLayer: state.showVectorLayer,
    setShowVectorLayer: state.setShowVectorLayer,
    vectorPackCount: state.vectorPackCount,
    showMapOverlays: state.showMapOverlays,
    setShowMapOverlays: state.setShowMapOverlays,
    isSelectingFlatnessCenter: state.isSelectingFlatnessCenter,
    isAnalyzingFlatness: state.isAnalyzingFlatness,
    analysisRegion: state.analysisRegion,
    analysisStatus: state.analysisStatus,
    analysisError: state.analysisError,
    flatnessAnalysisResult: state.flatnessAnalysisResult,
    runFlatnessAnalysis: state.runFlatnessAnalysis,
    startFlatnessSelection: state.startFlatnessSelection,
    cancelFlatnessSelection: state.cancelFlatnessSelection,
    clearFlatnessResult: state.clearFlatnessResult,
  })));

  const { isSandboxActive, enterSandbox, exitSandbox } = useTacticalSandboxStore(
    useShallow((state) => ({
      isSandboxActive: state.isSandboxActive,
      enterSandbox: state.enterSandbox,
      exitSandbox: state.exitSandbox,
    }))
  );

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const isVisible = embedded || aiAdvisorPanelOpen;

  // Ref tới card của gợi ý đang chọn, để cuộn card đó vào khung nhìn khi người dùng
  // bấm marker TRÊN BẢN ĐỒ (bản đồ không cuộn được panel nên phải tự cuộn giúp).
  const suggestionCardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Cuộn card đang chọn vào khung nhìn. `block: 'nearest'` để danh sách không bị
  // nhảy lên đầu khi gợi ý đã hiện sẵn trong khung nhìn.
  useEffect(() => {
    if (selectedAdvisorSuggestionIndex === null) return;
    const node = suggestionCardRefs.current[selectedAdvisorSuggestionIndex];
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedAdvisorSuggestionIndex, aiAdvisorSuggestions]);

  // Mở panel hoặc thử lại -> khởi động dịch vụ còn thiếu -> nạp danh sách model.
  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    void (async () => {
      setConnectionStatus('connecting');
      setModelsError(null);
      const started = await ensureVectorAiReady();
      if (cancelled) return;
      const result = started.ok ? await listVectorAiModels() : started;
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
  }, [isVisible, connectionAttempt]);

  const isLoadingModels = connectionStatus === 'connecting';

  /** Counter làm effect chạy lại kể cả khi danh sách model đang rỗng do lỗi. */
  const refreshModels = () => {
    setConnectionAttempt((attempt) => attempt + 1);
  };

  if (!isVisible) return null;

  const selectedInstance = instances.find((i) => i.instanceId === selectedInstanceId);
  const isBusy = aiAdvisorStatus === 'checking' || aiAdvisorStatus === 'thinking';
  // Nút Phân tích LUÔN dùng được miễn không đang chạy: động cơ client tính gợi ý từ dữ liệu
  // thật kể cả khi VECTOR AI chưa kết nối (khi đó chỉ thiếu phần diễn giải của AI).
  const canAnalyze = !isBusy;
  const displayStatus = aiAdvisorStatus === 'offline' && connectionStatus === 'ready' ? 'idle' : aiAdvisorStatus;
  const PanelContainer = embedded ? 'div' : 'aside';

  return (
    <PanelContainer className={embedded
      ? 'w-full select-none flex flex-col'
      : 'absolute top-16 left-[336px] z-30 w-80 max-h-[62vh] overflow-y-auto bg-slate-950/95 backdrop-blur-md border border-cyan-500/50 rounded-2xl shadow-[0_0_34px_rgba(0,0,0,0.75)] select-none flex flex-col'}>
      {/* Header */}
      {!embedded && (
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800 bg-slate-900/60 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold font-mono text-cyan-300">AI PHÂN TÍCH</span>
        </div>
        <button
          onClick={() => setAiAdvisorPanelOpen(false)}
          className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
          title="Đóng panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      )}

      <div className={`${embedded ? '' : 'p-3 '}space-y-3 text-xs`}>
        {/* NÚT BẬT LỚP ĐỐI TƯỢNG
            Đặt ở đầu panel vì cả bảng đặc tính vùng phủ lẫn gợi ý vị trí đều dựa
            trên dữ liệu đó — không bật thì con số trên bản đồ và trong bảng không
            khớp nhau. */}
        <button
          onClick={() => setShowVectorLayer(!showVectorLayer)}
          disabled={vectorPackCount === 0}
          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            showVectorLayer
              ? 'border-emerald-600/60 bg-emerald-950/50 text-emerald-300'
              : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-emerald-600/50'
          }`}
          title={
            vectorPackCount === 0
              ? 'Chưa có gói dữ liệu vectơ. Chạy: npm run download-vector-tamdao'
              : 'Bật/Tắt lớp đối tượng (nhà, sông, suối, núi, đường, rừng) để đối chiếu với số liệu bên dưới'
          }
        >
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            Lớp đối tượng trên bản đồ
          </span>
          {showVectorLayer ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5 opacity-60" />
          )}
        </button>

        {/* NÚT KÍCH HOẠT SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL RADAR SANDBOX) */}
        <button
          onClick={() => {
            if (isSandboxActive) {
              exitSandbox();
            } else {
              enterSandbox(selectedInstanceId ?? undefined);
            }
          }}
          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all shadow-lg ${
            isSandboxActive
              ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.6)]'
              : 'bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-950 border-cyan-500/50 text-cyan-200 hover:border-cyan-400 hover:text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Crosshair className={`w-4 h-4 ${isSandboxActive ? 'animate-spin' : 'text-cyan-400'}`} />
            <div className="text-left">
              <span className="block font-bold">
                {isSandboxActive ? 'Đang bật Sa bàn Tác chiến 3D' : 'Phân tích chiến thuật & Sa bàn 3D'}
              </span>
              <span className="block text-[10px] font-normal opacity-80">
                {isSandboxActive
                  ? 'Nhấp để thoát chế độ Sa bàn'
                  : 'Chế độ nền đen núi trắng, phát hiện khe mù & đón lõng UAV'}
              </span>
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${
              isSandboxActive
                ? 'bg-slate-950 text-cyan-300 border-cyan-800'
                : 'bg-cyan-950/80 text-cyan-300 border-cyan-600/60'
            }`}
          >
            {isSandboxActive ? 'ĐANG BẬT' : 'MỞ SA BÀN'}
          </span>
        </button>

        {/* Bật lại các bảng nổi (Chú giải / Hiệu năng) đã bị ẩn khi mở bảng này. */}
        {!showMapOverlays && (
          <button
            onClick={() => setShowMapOverlays(true)}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/40 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            title="Hiện lại bảng chú giải (đang ẩn để không che bản đồ)"
          >
            <EyeOff className="w-3 h-3" />
            Hiện lại bảng chú giải
          </button>
        )}

        <div className="border-t border-slate-800 pt-3 space-y-3">
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

        {/* Kết quả suy giảm: toạ độ/điểm vẫn do hệ thống tính từ dữ liệu thật, chỉ thiếu diễn giải AI. */}
        {aiAdvisorDegraded && aiAdvisorSuggestions.length > 0 && (
          <p className="flex items-start gap-1.5 p-2 rounded bg-amber-950/40 border border-amber-900/60 text-amber-200 text-[10px] leading-relaxed">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Toạ độ và điểm số do hệ thống tính từ dữ liệu địa hình &amp; hiện trạng thực; VECTOR AI
              chưa diễn giải được nên phần &quot;AI:&quot; có thể thiếu.
            </span>
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

        {/* 2.5 Phân tích địa hình bằng phẳng trong bán kính 1km */}
        <div className="p-2.5 rounded-lg border border-emerald-500/50 bg-gradient-to-br from-emerald-950/40 to-slate-900/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5 uppercase tracking-wide">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Địa hình Bằng phẳng (1km)
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-400">
              ΔH ≤ 4m · ≥ 1ha
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Chọn 1 vùng bán kính 1km để tự động quét tìm các bãi đất bằng phẳng (≥ 10.000 m², chênh cao ≤ 4m, kể cả khe núi) đủ điều kiện triển khai trận địa khí tài.
          </p>

          <div className="flex items-center gap-2 pt-1">
            {isSelectingFlatnessCenter ? (
              <button
                onClick={cancelFlatnessSelection}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-amber-500/60 bg-amber-950/60 hover:bg-amber-900/70 text-amber-300 text-xs font-semibold animate-pulse transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Hủy chọn tâm trên bản đồ</span>
              </button>
            ) : analysisRegion ? (
              <>
                <button
                  onClick={startFlatnessSelection}
                  disabled={isAnalyzingFlatness}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-cyan-500/60 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 text-xs font-semibold transition-colors disabled:opacity-50"
                  title="Chọn một toạ độ tâm khác trên bản đồ"
                >
                  <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Chọn vùng khác</span>
                </button>

                {analysisStatus === 'error' && (
                  <button
                    onClick={() => runFlatnessAnalysis(analysisRegion.lat, analysisRegion.lon)}
                    disabled={isAnalyzingFlatness}
                    className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-rose-500/60 bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 text-xs font-semibold transition-colors"
                    title="Thử quét lại vùng này"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Quét lại</span>
                  </button>
                )}

                <button
                  onClick={clearFlatnessResult}
                  className="p-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Xóa vùng phân tích"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={startFlatnessSelection}
                disabled={isAnalyzingFlatness}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-500/60 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                <span>Chọn vùng trên bản đồ (1km)</span>
              </button>
            )}
          </div>

          {/* Trạng thái quét & kết quả */}
          {analysisStatus === 'running' && (
            <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 p-2 rounded border border-cyan-800/50 flex items-center gap-2 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
              <span>Đang quét phân tích địa hình vùng đã chọn...</span>
            </div>
          )}

          {analysisStatus === 'success' && flatnessAnalysisResult && (
            <div className="text-[10px] font-mono text-emerald-400/90 bg-emerald-950/30 p-1.5 rounded border border-emerald-900/40 flex items-center justify-between">
              <span>Tìm thấy {flatnessAnalysisResult.patches.length} mảng bằng phẳng</span>
              <span>{(flatnessAnalysisResult.deployableAreaM2 / 10000).toFixed(1)} ha khả dụng</span>
            </div>
          )}

          {analysisStatus === 'empty' && (
            <div className="text-[11px] text-amber-300 bg-amber-950/30 p-2 rounded border border-amber-900/40 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Không tìm thấy mảng nào đạt chuẩn (≥ 10.000 m², ΔH ≤ 4m) trong bán kính 1km.</span>
            </div>
          )}

          {analysisStatus === 'error' && (
            <div className="text-[11px] text-rose-300 bg-rose-950/40 p-2 rounded border border-rose-900/40 flex items-start justify-between gap-2">
              <span className="leading-snug break-words" title={analysisError || 'Quét địa hình thất bại'}>
                Lỗi: {analysisError || 'Quét địa hình thất bại'}
              </span>
              {analysisRegion && (
                <button
                  onClick={() => runFlatnessAnalysis(analysisRegion.lat, analysisRegion.lon)}
                  className="px-2 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-[10px] font-medium shrink-0 mt-0.5"
                >
                  Thử lại
                </button>
              )}
            </div>
          )}
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
            title="Phân tích: hệ thống tính ứng viên từ dữ liệu địa hình & hiện trạng thực; nếu VECTOR AI sẵn sàng thì AI xếp hạng và viết diễn giải thêm"
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

            {aiAdvisorSuggestions.map((suggestion, index) => {
              const isSelected = selectedAdvisorSuggestionIndex === index;
              return (
              <div
                key={`${suggestion.latitude.toFixed(4)}_${suggestion.longitude.toFixed(4)}_${index}`}
                ref={(el) => {
                  suggestionCardRefs.current[index] = el;
                }}
                onClick={() => selectAdvisorSuggestion(index)}
                // Gợi ý đang chọn: viền vàng + nền sáng hơn để khớp với marker đang
                // toả sáng trên bản đồ. Nút bên trong có `stopPropagation` nên bấm
                // nút "Đặt tại đây" không bị đổi ý định sang chỉ chọn.
                className={`p-2 rounded-lg border space-y-1.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-amber-950/40 border-amber-500/80'
                    : 'bg-slate-900/70 border-slate-800 hover:border-cyan-600/50'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-200">
                    <MapPin className={`w-3 h-3 ${isSelected ? 'text-amber-300' : 'text-cyan-400'}`} />
                    <span>
                      {suggestion.latitude.toFixed(4)}, {suggestion.longitude.toFixed(4)}
                    </span>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                      isSelected
                        ? 'bg-amber-950 border-amber-500/70 text-amber-200'
                        : 'bg-cyan-950 border border-cyan-600/50 text-cyan-300'
                    }`}
                  >
                    {Math.round(suggestion.score * 100)}%
                  </span>
                </div>

                {suggestion.reason && (
                  <p className="text-[11px] text-slate-400 leading-snug">{suggestion.reason}</p>
                )}

                {suggestion.aiReason && (
                  <p className="text-[11px] text-cyan-300/90 leading-snug">
                    <span className="text-[9px] font-mono text-cyan-500">AI: </span>
                    {suggestion.aiReason}
                  </p>
                )}

                {describeSuggestionMetrics(suggestion).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {describeSuggestionMetrics(suggestion).map((metric) => (
                      <span
                        key={metric}
                        className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700 text-slate-300 text-[9px] font-mono"
                      >
                        {metric}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerFlyTo({
                        id: `advisor-suggestion-${index}`,
                        name: `Gợi ý vị trí #${index + 1}`,
                        latitude: suggestion.latitude,
                        longitude: suggestion.longitude,
                        height: 95000,
                      });
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-cyan-600/60 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 text-[11px] font-semibold transition-colors"
                    title="Bay camera tới toạ độ gợi ý này"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Tới vị trí</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      placeEquipmentAtSuggestion(index);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-emerald-600/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 text-[11px] font-semibold transition-colors"
                    title="Đặt khí tài đang chọn tại toạ độ gợi ý này"
                  >
                    <Navigation className="w-3 h-3" />
                    <span>Đặt tại đây</span>
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
        </div>
      </div>
    </PanelContainer>
  );
};
