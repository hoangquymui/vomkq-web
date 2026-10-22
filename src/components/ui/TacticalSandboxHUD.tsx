/**
 * BẢNG ĐIỀU KHIỂN SA BÀN TÁC CHIẾN MÔ PHỎNG (TACTICAL RADAR SANDBOX HUD)
 * ====================================================================
 * 
 * Floating HUD tương tác chuyên nghiệp cho Sa bàn:
 * 1. Chuyển đổi bộ phối màu (Monochrome SAR, CRT Phosphor Green, Amber HUD).
 * 2. Khay lực lượng tác chiến (MANPADS Igla-S, Đài quan sát, Pháo 23mm, Trận địa giả).
 * 3. Bảng điều khiển mô phỏng UAV bay luồn khe núi & Đánh giá đón lõng.
 * 4. AI Cố vấn đề xuất điểm cao chốt chặn (Tactical AI Co-pilot).
 */

import React, { useState } from 'react';
import {
  Crosshair,
  Eye,
  ShieldAlert,
  Radio,
  Building,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Sparkles,
  X,
  Layers,
  ChevronDown,
  ChevronUp,
  MapPin,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useTacticalSandboxStore } from '../../store/useTacticalSandboxStore';
import { useTacticalStore } from '../../store/useTacticalStore';
import { TACTICAL_UNIT_PRESETS, type TacticalUnitRole } from '../../types/tacticalSandbox';
import { useShallow } from 'zustand/react/shallow';

export const TacticalSandboxHUD: React.FC = () => {
  const {
    isSandboxActive,
    theme,
    deployedUnits,
    activePlacementRole,
    activeInfiltrationRoute,
    isSimulating,
    simulationSpeedMultiplier,
    aiSuggestions,
    showWEZDomes,
    exitSandbox,
    setTheme,
    setActivePlacementRole,
    removeUnit,
    clearAllDeployedUnits,
    generateRouteForField,
    setSimulationProgress,
    toggleSimulation,
    setSimulationSpeed,
    fetchAiSuggestions,
    applyAiSuggestion,
    setShowWEZDomes,
  } = useTacticalSandboxStore();

  const { coverageFields, selectedInstanceId, instances } = useTacticalStore(
    useShallow((state) => ({
      coverageFields: state.coverageFields,
      selectedInstanceId: state.selectedInstanceId,
      instances: state.instances,
    }))
  );

  const [activeTab, setActiveTab] = useState<'deploy' | 'simulate' | 'ai'>('deploy');
  const [isMinimized, setIsMinimized] = useState(false);

  if (!isSandboxActive) return null;

  // Lấy coverage field của đài radar hiện tại (hoặc đài đầu tiên có trường radar)
  const activeField =
    (selectedInstanceId && coverageFields[selectedInstanceId]) ||
    Object.values(coverageFields)[0];

  const activeRadar = instances.find((i) => i.instanceId === selectedInstanceId);

  const handleGenerateRoute = () => {
    if (activeField) {
      generateRouteForField(activeField);
      setActiveTab('simulate');
    }
  };

  const handleFetchAi = () => {
    if (activeField) {
      fetchAiSuggestions(activeField);
      setActiveTab('ai');
    }
  };

  return (
    <div className="absolute left-6 top-16 z-40 w-[420px] max-w-[calc(100vw-48px)] flex flex-col rounded-2xl border border-cyan-500/50 bg-slate-950/95 backdrop-blur-xl text-slate-200 shadow-[0_0_35px_rgba(6,182,212,0.25)] select-none animate-in fade-in slide-in-from-top-4 duration-300">
      {/* HEADER CỦA SA BÀN */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/60 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.4)]">
            <Crosshair className="w-4 h-4 text-cyan-300 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-cyan-200 tracking-wider uppercase flex items-center gap-1.5">
              Sa Bàn Tác Chiến Mô Phỏng
            </h2>
            <p className="text-[10px] text-slate-400 font-mono">
              {activeRadar ? `Đài trung tâm: ${activeRadar.name}` : 'Chế độ khảo sát hẻm núi 3D'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
            title={isMinimized ? 'Mở rộng' : 'Thu gọn'}
          >
            {isMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            onClick={exitSandbox}
            className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition-colors"
            title="Thoát chế độ Sa bàn (trở về bản đồ bình thường)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="p-3 space-y-3">
          {/* 1. CHỌN BỘ PHỐI MÀU THỊ GIÁC (THEME) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-cyan-400" />
                Bộ Hiển Thị Bản Đồ
              </span>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showWEZDomes}
                  onChange={(e) => setShowWEZDomes(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-cyan-500"
                />
                Hiện vòm hỏa lực
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => setTheme('monochrome')}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                  theme === 'monochrome'
                    ? 'bg-slate-800 text-white border-white shadow-[0_0_10px_rgba(255,255,255,0.3)]'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                Đen - Trắng (SAR)
              </button>
              <button
                onClick={() => setTheme('crt_green')}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                  theme === 'crt_green'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                Xanh CRT (P-18)
              </button>
              <button
                onClick={() => setTheme('amber')}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                  theme === 'amber'
                    ? 'bg-amber-950 text-amber-300 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                Vàng Hổ Phách
              </button>
            </div>
          </div>

          {/* THANH TAB ĐIỀU HƯỚNG */}
          <div className="flex border-b border-slate-800 pb-1 gap-1">
            <button
              onClick={() => setActiveTab('deploy')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'deploy'
                  ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              Bố trí lực lượng ({deployedUnits.length})
            </button>
            <button
              onClick={() => setActiveTab('simulate')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'simulate'
                  ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              Mô phỏng UAV
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 ${
                activeTab === 'ai'
                  ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Sparkles className="w-3 h-3 text-cyan-400" />
              AI Cố vấn
            </button>
          </div>

          {/* TAB 1: BỐ TRÍ LỰC LƯỢNG */}
          {activeTab === 'deploy' && (
            <div className="space-y-3">
              <div>
                <span className="text-[10px] text-slate-400 block mb-1.5">
                  Chọn khí tài cần bố trí (sau đó nhấp chuột lên đỉnh núi trên bản đồ):
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['manpads_igla', 'visual_observer', 'aa_gun_23mm', 'decoy_radar', 'command_post'] as TacticalUnitRole[]).map((role) => {
                    const preset = TACTICAL_UNIT_PRESETS[role];
                    const isSelected = activePlacementRole === role;
                    return (
                      <button
                        key={role}
                        onClick={() =>
                          setActivePlacementRole(isSelected ? null : role)
                        }
                        className={`p-2 rounded-xl border text-left flex items-start gap-2 transition-all ${
                          isSelected
                            ? 'bg-cyan-950 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                            : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: `${preset.colorHex}25`, color: preset.colorHex }}
                        >
                          {role === 'manpads_igla' && <Crosshair className="w-4 h-4" />}
                          {role === 'visual_observer' && <Eye className="w-4 h-4" />}
                          {role === 'aa_gun_23mm' && <ShieldAlert className="w-4 h-4" />}
                          {role === 'decoy_radar' && <Radio className="w-4 h-4" />}
                          {role === 'command_post' && <Building className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] font-bold text-slate-200 truncate">
                            {preset.shortName}
                          </span>
                          <span className="block text-[9px] text-slate-400 font-mono">
                            Tầm {preset.rangeM / 1000}km
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activePlacementRole && (
                <div className="p-2.5 rounded-xl border border-cyan-500/60 bg-cyan-950/40 text-cyan-200 text-[11px] flex items-center justify-between animate-pulse">
                  <span>👉 Nhấp chuột lên đỉnh núi / mỏm cao để cắm chốt</span>
                  <button
                    onClick={() => setActivePlacementRole(null)}
                    className="text-[10px] text-cyan-400 underline font-semibold hover:text-white"
                  >
                    Hủy
                  </button>
                </div>
              )}

              {/* Danh sách các đơn vị đã cắm */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Lực lượng đã triển khai ({deployedUnits.length})
                  </span>
                  {deployedUnits.length > 0 && (
                    <button
                      onClick={clearAllDeployedUnits}
                      className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Xóa tất cả
                    </button>
                  )}
                </div>

                {deployedUnits.length === 0 ? (
                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 text-center text-[11px] text-slate-500">
                    Chưa có đơn vị nào được bố trí. Chọn một khí tài ở trên để cắm chốt lên đỉnh núi.
                  </div>
                ) : (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {deployedUnits.map((unit) => (
                      <div
                        key={unit.id}
                        className="p-2 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: unit.colorHex }}
                          />
                          <div className="min-w-0">
                            <span className="block font-semibold text-slate-200 truncate text-[11px]">
                              {unit.name}
                            </span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              Độ cao: {unit.altitudeM}m · Tầm: {unit.rangeM / 1000}km
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => removeUnit(unit.id)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                          title="Gỡ bỏ đơn vị này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MÔ PHỎNG UAV ĐỘT KÍCH */}
          {activeTab === 'simulate' && (
            <div className="space-y-3">
              {!activeInfiltrationRoute ? (
                <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 text-center space-y-2">
                  <p className="text-[11px] text-slate-400">
                    AI sẽ tự động dò tìm hẻm núi có bóng che khuất dài nhất từ đài radar để dựng đường bay đột kích.
                  </p>
                  <button
                    onClick={handleGenerateRoute}
                    disabled={!activeField}
                    className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_12px_rgba(6,182,212,0.5)] transition-all disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Sinh Đường Bay Luồn Khe Núi
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Trạng thái tác chiến của UAV */}
                  <div
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
                      activeInfiltrationRoute.status === 'intercepted'
                        ? 'bg-orange-950/60 border-orange-500/80 text-orange-200'
                        : activeInfiltrationRoute.status === 'detected'
                        ? 'bg-rose-950/60 border-rose-500/80 text-rose-200'
                        : 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {activeInfiltrationRoute.status === 'intercepted' && (
                        <CheckCircle2 className="w-4 h-4 text-orange-400" />
                      )}
                      {activeInfiltrationRoute.status === 'detected' && (
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                      )}
                      {activeInfiltrationRoute.status === 'stealth' && (
                        <Crosshair className="w-4 h-4 text-emerald-400" />
                      )}
                      {activeInfiltrationRoute.status === 'intercepted'
                        ? 'BỊ ĐÓN LÕNG TIÊU DIỆT'
                        : activeInfiltrationRoute.status === 'detected'
                        ? 'BỊ RADAR PHÁT HIỆN'
                        : 'LẨN TRỐN KHE NÚI (STEALTH)'}
                    </span>
                    <span className="text-[10px] font-mono">
                      {(activeInfiltrationRoute.currentProgress * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Thanh kéo tiến độ mô phỏng */}
                  <div className="space-y-1">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.005"
                      value={activeInfiltrationRoute.currentProgress}
                      onChange={(e) => setSimulationProgress(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                  </div>

                  {/* Cụm nút Play / Pause / Reset / Tốc độ */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleSimulation}
                        className={`p-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                          isSimulating
                            ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.5)]'
                            : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                        }`}
                      >
                        {isSimulating ? (
                          <>
                            <Pause className="w-3.5 h-3.5 fill-current" />
                            <span>Tạm dừng</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Chạy mô phỏng</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setSimulationProgress(0)}
                        className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                        title="Về điểm xuất phát"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Bộ chọn tốc độ */}
                    <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                      {[1, 2, 4].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => setSimulationSpeed(spd)}
                          className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors ${
                            simulationSpeedMultiplier === spd
                              ? 'bg-cyan-600 text-slate-950'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Thông số hiệu quả chiến thuật */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="block text-[9px] text-slate-400 uppercase">Tỷ lệ Lộ diện Radar</span>
                      <span className="text-xs font-bold font-mono text-rose-400">
                        {activeInfiltrationRoute.detectedRatioPercent}%
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="block text-[9px] text-slate-400 uppercase">Đón lõng bao quát</span>
                      <span className="text-xs font-bold font-mono text-emerald-400">
                        {activeInfiltrationRoute.interceptedRatioPercent}%
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleGenerateRoute}
                    className="w-full py-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 underline font-mono text-center"
                  >
                    Đổi khe núi khác (Tạo lại)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AI CỐ VẤN ĐIỂM CAO (TACTICAL AI CO-PILOT) */}
          {activeTab === 'ai' && (
            <div className="space-y-3">
              {aiSuggestions.length === 0 ? (
                <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 text-center space-y-2">
                  <p className="text-[11px] text-slate-400">
                    AI sẽ phân tích sườn núi đón sóng, độ nhô địa hình và góc khống chế thung lũng để gợi ý vị trí đón lõng tối ưu.
                  </p>
                  <button
                    onClick={handleFetchAi}
                    disabled={!activeField}
                    className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.5)] transition-all disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Quét & Gợi Ý Điểm Cao Khống Chế
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Đề xuất đón lõng ({aiSuggestions.length})
                    </span>
                    <button
                      onClick={handleFetchAi}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    >
                      Quét lại
                    </button>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {aiSuggestions.map((sug) => {
                      const preset = TACTICAL_UNIT_PRESETS[sug.role];
                      return (
                        <div
                          key={sug.id}
                          className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/80 space-y-2 hover:border-cyan-500/50 transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="font-bold text-xs text-slate-200">
                                {preset.shortName} (Cao {sug.elevationM}m)
                              </span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                              {sug.score}/100đ
                            </span>
                          </div>

                          <p className="text-[10px] text-slate-400 leading-relaxed">
                            {sug.reason}
                          </p>

                          <button
                            onClick={() => applyAiSuggestion(sug.id)}
                            className="w-full py-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1 transition-colors"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Bố trí chốt chặn này
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
