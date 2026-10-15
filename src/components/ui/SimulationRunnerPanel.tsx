/**
 * @fileoverview Compact, deterministic Simulation Runner & Evaluation Control Surface.
 * Part of Checkpoint 2C.5 First Functional Simulation Vertical Slice.
 *
 * Implements end-to-end user-operated workflow:
 * Scenario / Plan -> SimulationRun -> Deterministic Clock -> Radar Surveillance Horizon Evaluation -> Atomic Runner -> Event Timeline -> Minimal UI.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  StepForward,
  Radio,
  Layers,
  Globe2,
  AlertTriangle,
  Info,
  Trash2,
  Ban,
} from 'lucide-react';
import {
  useTacticalStore,
  selectActiveScenario,
  selectActivePlan,
  selectPlansForActiveScenario,
  isSimulationRunFresh,
} from '../../store/useTacticalStore';
import type { SimulationRun, SimulationRunHandle } from '../../domain/types/simulation';
import type { RadarSurveillanceEvaluationPayload } from '../../domain/simulation/radarSurveillanceEvaluation';
import { RADAR_SURVEILLANCE_EVENT_TYPE } from '../../domain/simulation/radarSurveillanceEvaluation';
import { getEligibleCleanupRunIds } from '../../store/slices/simulationRunSlice';
export { getEligibleCleanupRunIds };

/**
 * Pure helper to resolve all eligible runs belonging to the currently active Plan and Scenario.
 * Retains all runs (including terminal/cancelled) for session management and review.
 */
export function resolvePlanRuns(
  simulationRuns: Record<string, SimulationRun>,
  activePlanId: string | null | undefined,
  activeScenarioId: string | null | undefined
): SimulationRun[] {
  if (!activePlanId || !activeScenarioId) return [];
  return Object.values(simulationRuns || {}).filter(
    (r) =>
      r &&
      r.planId === activePlanId &&
      r.scenarioId === activeScenarioId
  );
}

/**
 * Pure helper to resolve the active SimulationRun record for the UI:
 * - If `selectedRunId` is provided and exists in `planRuns` (i.e. belongs to active Plan & Scenario), use it.
 * - Otherwise (e.g. on Plan switch, or initial render), falls back to the latest eligible Run from `planRuns`.
 * - If `planRuns` is empty, returns null (no-run state). (Blocker B2)
 */
export function resolveActiveSimulationRun(
  selectedRunId: string | null | undefined,
  planRuns: readonly SimulationRun[]
): SimulationRun | null {
  if (selectedRunId) {
    const match = planRuns.find((r) => r.id === selectedRunId);
    if (match) return match;
  }
  return planRuns.length > 0 ? planRuns[planRuns.length - 1] : null;
}

/**
 * Pure selector/derivation helper for UI freshness of the active SimulationRun.
 * Reactive to canonical state changes (placements, definitions, terrain, importGen).
 */
export function deriveSimulationRunFreshness(
  state: Parameters<typeof isSimulationRunFresh>[0],
  currentRun: SimulationRun | null | undefined
): boolean {
  if (!currentRun) return false;
  return isSimulationRunFresh(state, currentRun);
}

export const SimulationRunnerPanel: React.FC = () => {
  const {
    showSimulationPanel,
    setShowSimulationPanel,
    simulationRuns,
    simulationClocks,
    simulationTimelines,
    registerSimulationRun,
    initSimulationClock,
    startSimulationClock,
    pauseSimulationClock,
    resumeSimulationClock,
    initSimulationTimeline,
    stepSimulationWithRadarEvaluation,
    switchActivePlan,
    lastImportGen,
    activeSimulationRunId,
    cancelSimulationRun,
    deleteSimulationRun,
    cleanupSimulationRuns,
  } = useTacticalStore();

  const activeScenario = useTacticalStore(selectActiveScenario);
  const activePlan = useTacticalStore(selectActivePlan);
  const plansForScenario = useTacticalStore(selectPlansForActiveScenario);

  // Local interaction state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [elapsedRealMs, setElapsedRealMs] = useState<number>(1000);
  const [targetAltitudeM, setTargetAltitudeM] = useState<number>(1000);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Scoped to runId and sequence number to prevent cross-run leak (Blocker B2)
  const [selectedEventScope, setSelectedEventScope] = useState<{
    runId: string;
    sequence: number;
  } | null>(null);

  // Available valid runs for the active plan and scenario (Blocker B2 & G5)
  const planRuns = useMemo(() => {
    return resolvePlanRuns(simulationRuns, activePlan?.id, activeScenario?.id);
  }, [simulationRuns, activePlan?.id, activeScenario?.id]);

  // Authoritative current run strictly bound to the active Plan and Scenario (Blocker B2)
  const currentRun = useMemo(() => {
    return resolveActiveSimulationRun(selectedRunId, planRuns);
  }, [selectedRunId, planRuns]);

  // Lightweight session and event counters derived from runtime state (Checkpoint 2C.7)
  const sessionCounters = useMemo(() => {
    let totalRuns = planRuns.length;
    let runningCount = 0;
    let terminalCount = 0;
    let totalEvents = 0;

    for (const r of planRuns) {
      if (r.status === 'running') runningCount++;
      else if (r.status === 'completed' || r.status === 'cancelled' || r.status === 'failed') {
        terminalCount++;
      }
      const tl = simulationTimelines[r.id];
      totalEvents += tl?.events?.length ?? r.eventCount ?? 0;
    }

    return { totalRuns, runningCount, terminalCount, totalEvents };
  }, [planRuns, simulationTimelines]);

  // Derived cleanup preview strictly aligned with cleanup action and preserveActive=true (Blocker B2)
  const eligibleCleanupRunIds = useMemo(() => {
    return getEligibleCleanupRunIds(simulationRuns, {
      planId: activePlan?.id,
      scenarioId: activeScenario?.id,
      activeRunId: activeSimulationRunId,
      preserveActive: true,
    });
  }, [simulationRuns, activePlan?.id, activeScenario?.id, activeSimulationRunId]);

  const clock = currentRun ? simulationClocks[currentRun.id] : undefined;
  const timeline = currentRun ? simulationTimelines[currentRun.id] : undefined;

  // Operational Lifecycle Invariant Guards (Gates G7, G8, G12)
  const currentGen = lastImportGen ?? 0;
  const isInvalidatedByImport = Boolean(
    currentRun && currentRun.importGen !== undefined && currentRun.importGen !== currentGen
  );

  // Authoritative canonical source freshness subscription (reacts immediately to placement, definition, or import changes)
  const isFresh = useTacticalStore(
    useCallback(
      (state) => deriveSimulationRunFreshness(state, currentRun),
      [currentRun]
    )
  );

  const hasClockSession = Boolean(clock);
  const hasTimelineSession = Boolean(timeline);
  const isClockAdvancing = clock?.phase === 'advancing';
  const isClockPaused = clock?.phase === 'paused';

  const canStartOrResume = Boolean(
    currentRun &&
      currentRun.status === 'running' &&
      hasClockSession &&
      !isInvalidatedByImport &&
      isFresh
  );

  const canStep = Boolean(
    currentRun &&
      currentRun.status === 'running' &&
      isClockAdvancing &&
      hasClockSession &&
      hasTimelineSession &&
      !isInvalidatedByImport &&
      isFresh
  );

  // Selected or latest event on timeline (strictly scoped to currentRun.id to prevent cross-run leak - Blocker B2)
  const selectedEvent = useMemo(() => {
    if (!currentRun || !timeline?.events || timeline.events.length === 0) return null;
    if (selectedEventScope && selectedEventScope.runId === currentRun.id) {
      const match = timeline.events.find((e) => e.sequence === selectedEventScope.sequence);
      if (match) return match;
    }
    return timeline.events[timeline.events.length - 1] || null;
  }, [currentRun?.id, timeline, selectedEventScope]);

  if (!showSimulationPanel) return null;

  // Create run handle for store calls
  const currentHandle: SimulationRunHandle | null = currentRun && currentRun.runToken
    ? {
        runId: currentRun.id,
        runToken: currentRun.runToken,
        importGen: currentRun.importGen ?? 0,
      }
    : null;

  // Handler: Initialize a fresh, valid SimulationRun execution for this Scenario/Plan
  const handleInitializeRun = () => {
    setErrorMessage(null);
    if (!activeScenario || !activePlan) {
      setErrorMessage('Vui lòng chọn Kịch bản và Phương án hợp lệ trước khi khởi tạo mô phỏng.');
      return;
    }
    try {
      const handle = registerSimulationRun({
        scenarioId: activeScenario.id,
        planId: activePlan.id,
        initialStatus: 'running',
        autoActivate: true,
      });
      initSimulationClock(handle);
      initSimulationTimeline(handle);
      setSelectedRunId(handle.runId);
      setSelectedEventScope(null);
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Start or set clock to advancing
  const handleStartAdvancing = () => {
    setErrorMessage(null);
    if (!currentHandle) return;
    try {
      startSimulationClock(currentHandle);
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Pause clock
  const handlePause = () => {
    setErrorMessage(null);
    if (!currentHandle) return;
    try {
      pauseSimulationClock(currentHandle);
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Resume clock
  const handleResume = () => {
    setErrorMessage(null);
    if (!currentHandle) return;
    try {
      resumeSimulationClock(currentHandle);
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Execute manual deterministic step with domain evaluation
  const handleStep = () => {
    setErrorMessage(null);
    if (!currentHandle) {
      setErrorMessage('Không có phiên mô phỏng hợp lệ nào đang hoạt động.');
      return;
    }
    try {
      const result = stepSimulationWithRadarEvaluation(currentHandle, {
        elapsedRealMs,
        targetAltitudeM,
      });
      if (result.events && result.events.length > 0) {
        setSelectedEventScope({
          runId: currentHandle.runId,
          sequence: result.events[result.events.length - 1].sequence,
        });
      }
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Cancel active or selected simulation run (stops further execution, preserves timeline)
  const handleCancelRun = (run: SimulationRun) => {
    setErrorMessage(null);
    if (!window.confirm('Xác nhận dừng/hủy phiên mô phỏng này? Quá trình chạy sẽ dừng lại, kết quả và nhật ký sự kiện đã ghi nhận sẽ được lưu giữ.')) {
      return;
    }
    try {
      cancelSimulationRun(run.id, {
        runToken: run.runToken,
        importGen: run.importGen,
      });
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Delete individual terminal simulation run (requires prior cancellation if running)
  const handleDeleteRun = (runId: string) => {
    setErrorMessage(null);
    if (!window.confirm(`Xác nhận xóa hoàn toàn phiên mô phỏng ${runId}? Dữ liệu đồng hồ và nhật ký sự kiện liên quan sẽ bị xóa khỏi bộ nhớ.`)) {
      return;
    }
    try {
      deleteSimulationRun(runId);
      const postState = useTacticalStore.getState();
      if (selectedRunId === runId || (selectedRunId && !postState.simulationRuns[selectedRunId])) {
        setSelectedRunId(null);
      }
      if (selectedEventScope?.runId === runId || (selectedEventScope && !postState.simulationRuns[selectedEventScope.runId])) {
        setSelectedEventScope(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };

  // Handler: Bulk cleanup of terminal/cancelled runs for this plan
  const handleBulkCleanup = () => {
    setErrorMessage(null);
    const affectedCount = eligibleCleanupRunIds.length;
    if (affectedCount === 0) return;
    if (!window.confirm(`Xác nhận dọn dẹp ${affectedCount} phiên kết thúc/đã hủy của phương án này? Các phiên đang chạy và phiên hoạt động sẽ được bảo toàn.`)) {
      return;
    }
    try {
      cleanupSimulationRuns({
        planId: activePlan?.id,
        scenarioId: activeScenario?.id,
        preserveActive: true,
      });
      // Authoritative post-cleanup state check (NOT stale render closure - Blocker B2)
      const postState = useTacticalStore.getState();
      if (selectedRunId && !postState.simulationRuns[selectedRunId]) {
        setSelectedRunId(null);
      }
      if (selectedEventScope && !postState.simulationRuns[selectedEventScope.runId]) {
        setSelectedEventScope(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
    }
  };
  return (
    <div
      role="dialog"
      aria-label="Bảng Điều Khiển Mô Phỏng & Đánh Giá Tác Chiến"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm select-none"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-cyan-800/60 rounded-xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-cyan-900/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-500/50 text-cyan-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wide text-cyan-300 font-mono">
                BẢNG ĐIỀU KHIỂN MÔ PHỎNG & ĐÁNH GIÁ CHÂN TRỜI RADAR
              </h2>
              <p className="text-[11px] text-slate-400">
                Mô phỏng tiền định theo bước thủ công • Khám phá chướng ngại địa hình & khu mù đỉnh
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSimulationPanel(false)}
            aria-label="Đóng bảng điều khiển"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-rose-950/90 border-b border-rose-700/60 text-rose-200 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span className="flex-1 truncate">{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-200 text-xs font-bold cursor-pointer"
            >
              Bỏ qua
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-sans">
          {/* Section 1: Context & Run Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
            {/* Scenario & Plan Context */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Kịch bản:</span>
                <span className="font-bold text-slate-200">
                  {activeScenario ? activeScenario.name : 'Chưa chọn'}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Phương án tác chiến:</span>
                {plansForScenario.length > 0 ? (
                  <select
                    value={activePlan?.id || ''}
                    onChange={(e) => {
                      switchActivePlan(e.target.value);
                      setSelectedRunId(null);
                      setSelectedEventScope(null);
                      setErrorMessage(null);
                    }}
                    className="bg-slate-900 text-cyan-300 font-bold border border-slate-700 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                  >
                    {plansForScenario.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-500 italic">Chưa có phương án</span>
                )}
              </div>
            </div>

            {/* Run Selection & Init */}
            <div className="flex items-center justify-between md:justify-end gap-2">
              {planRuns.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-400">Phiên:</span>
                  <select
                    value={currentRun?.id || ''}
                    onChange={(e) => {
                      setSelectedRunId(e.target.value);
                      setSelectedEventScope(null);
                    }}
                    className="bg-slate-900 text-slate-200 font-mono border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none"
                  >
                    {planRuns.map((r) => {
                      const isRInvalidated = r.importGen !== undefined && r.importGen !== currentGen;
                      return (
                        <option key={r.id} value={r.id}>
                          {r.id} ({isRInvalidated ? 'vô hiệu (import)' : r.status || 'running'})
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <span className="text-slate-500 font-mono text-[11px] italic">
                  Chưa có phiên mô phỏng nào
                </span>
              )}

              <button
                onClick={handleInitializeRun}
                className="px-2.5 py-1 text-xs font-bold font-mono rounded bg-cyan-700 hover:bg-cyan-600 text-white shadow transition-all cursor-pointer"
                title="Khởi tạo một phiên mô phỏng mới gắn liền với phương án này"
              >
                + Khởi tạo Phiên Mới
              </button>
            </div>
          </div>

          {/* Section 1.5: Session Management & Overview (Checkpoint 2C.7) */}
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wide">
                  Danh Sách Phiên Mô Phỏng ({sessionCounters.totalRuns})
                </span>
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/40">
                    Chạy: {sessionCounters.runningCount}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    Kết thúc: {sessionCounters.terminalCount}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/40">
                    Sự kiện: {sessionCounters.totalEvents}
                  </span>
                </div>
              </div>

              <button
                onClick={handleBulkCleanup}
                disabled={eligibleCleanupRunIds.length === 0}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-mono font-bold rounded bg-slate-800 hover:bg-rose-950/70 hover:text-rose-300 hover:border-rose-700/50 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Dọn dẹp tất cả các phiên đã kết thúc/hủy của phương án này (bảo toàn phiên đang chạy và phiên hoạt động)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Dọn dẹp kết thúc ({eligibleCleanupRunIds.length})</span>
              </button>
            </div>

            {planRuns.length > 0 ? (
              <div className="max-h-40 overflow-y-auto border border-slate-800/80 rounded bg-slate-900/40">
                <table className="w-full text-left font-mono text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-950/90 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
                      <th className="py-1 px-2">Mã Phiên</th>
                      <th className="py-1 px-2">Trạng thái</th>
                      <th className="py-1 px-2">Thời gian sim</th>
                      <th className="py-1 px-2">Số bước</th>
                      <th className="py-1 px-2">Sự kiện</th>
                      <th className="py-1 px-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRuns.map((r) => {
                      const isSelected = currentRun?.id === r.id;
                      const rClock = simulationClocks[r.id];
                      const rTimeline = simulationTimelines[r.id];
                      const isRInvalidated = r.importGen !== undefined && r.importGen !== currentGen;
                      const evtCount = rTimeline?.events?.length ?? r.eventCount ?? 0;
                      const simTimeSec = rClock ? (rClock.simTimeNs / 1e9).toFixed(3) : '0.000';
                      const tickCount = rClock?.tickCount ?? 0;
                      const isRunning = r.status === 'running';

                      return (
                        <tr
                          key={r.id}
                          className={`border-b border-slate-800/40 transition-colors ${
                            isSelected
                              ? 'bg-cyan-950/40 text-cyan-200'
                              : 'hover:bg-slate-800/40 text-slate-300'
                          }`}
                        >
                          <td className="py-1 px-2 font-bold" title={r.id}>
                            <span className="truncate max-w-[130px] inline-block align-bottom">
                              {r.id.length > 18 ? `${r.id.substring(0, 16)}...` : r.id}
                            </span>
                            {isSelected && (
                              <span className="ml-1 text-[9px] text-cyan-400 font-normal">
                                [active]
                              </span>
                            )}
                          </td>
                          <td className="py-1 px-2">
                            <span
                              className={`text-[9px] uppercase font-bold px-1 py-0.5 rounded border ${
                                isRInvalidated
                                  ? 'bg-rose-950 text-rose-300 border-rose-500/40'
                                  : isRunning
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                                  : r.status === 'cancelled'
                                  ? 'bg-amber-950 text-amber-300 border-amber-500/40'
                                  : r.status === 'completed'
                                  ? 'bg-blue-950 text-blue-300 border-blue-500/40'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {isRInvalidated ? 'vô hiệu' : r.status || 'unknown'}
                            </span>
                          </td>
                          <td className="py-1 px-2 text-slate-300">{simTimeSec}s</td>
                          <td className="py-1 px-2 text-slate-400">{tickCount}</td>
                          <td className="py-1 px-2 text-slate-400">{evtCount}</td>
                          <td className="py-1 px-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isSelected && (
                                <button
                                  onClick={() => {
                                    setSelectedRunId(r.id);
                                    setSelectedEventScope(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-cyan-900 text-slate-200 hover:text-cyan-200 border border-slate-700 cursor-pointer"
                                  title="Chọn phiên này để theo dõi/điều khiển"
                                >
                                  Chọn
                                </button>
                              )}
                              {isRunning && (
                                <button
                                  onClick={() => handleCancelRun(r)}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/60 hover:bg-amber-900 text-amber-300 border border-amber-700/50 cursor-pointer"
                                  title="Dừng và hủy phiên này"
                                >
                                  Hủy
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteRun(r.id)}
                                disabled={isRunning}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                title={isRunning ? 'Cần hủy phiên trước khi xóa' : 'Xóa vĩnh viễn phiên này'}
                              >
                                Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-2 text-slate-500 font-mono text-[11px] italic">
                Chưa có phiên mô phỏng nào cho phương án này. Bấm &quot;+ Khởi tạo Phiên Mới&quot; để tạo phiên.
              </div>
            )}
          </div>

          {/* Section 2: Canonical Simulation Status & Lifecycle Controls */}
          {currentRun ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Status & Clock metrics */}
                <div className="md:col-span-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase text-slate-400">Trạng thái:</span>
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                          isInvalidatedByImport
                            ? 'bg-rose-950 text-rose-300 border-rose-500/40'
                            : !isFresh
                            ? 'bg-amber-950 text-amber-300 border-amber-500/40'
                            : currentRun.status === 'running'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {isInvalidatedByImport
                          ? 'VÔ HIỆU (IMPORT)'
                          : !isFresh
                          ? 'LỖI THỜI (STALE)'
                          : currentRun.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase text-slate-400">Pha đồng hồ:</span>
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                          clock?.phase === 'advancing'
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-500/40'
                            : clock?.phase === 'paused'
                            ? 'bg-amber-950 text-amber-300 border-amber-500/40'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {clock?.phase || 'Chưa khởi tạo'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-slate-300 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Thời gian mô phỏng (Canonical simTimeNs):</span>
                      <span className="text-cyan-300 font-bold text-xs">
                        {clock ? (clock.simTimeNs / 1_000_000_000).toFixed(3) : '0.000'} s
                      </span>
                      <span className="text-[10px] text-slate-500 ml-1">
                        ({clock ? clock.simTimeNs.toLocaleString() : 0} ns)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Số bước thực thi (Tick count):</span>
                      <span className="text-slate-200 font-bold text-xs">
                        {clock?.tickCount ?? 0} bước
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lifecycle Actions */}
                <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 flex flex-col justify-between space-y-2">
                  <span className="text-[10px] font-mono uppercase text-slate-400">
                    Điều khiển Vòng đời:
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {!isClockAdvancing ? (
                      <button
                        onClick={isClockPaused ? handleResume : handleStartAdvancing}
                        disabled={!canStartOrResume}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 rounded font-mono font-bold text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow transition-all cursor-pointer"
                        title={
                          isInvalidatedByImport
                            ? 'Phiên đã bị vô hiệu hóa do import workspace'
                            : !isFresh
                            ? 'Phiên đã lỗi thời do dữ liệu thay đổi'
                            : !hasClockSession
                            ? 'Chưa có phiên đồng hồ hợp lệ'
                            : isClockPaused
                            ? 'Tiếp tục mô phỏng'
                            : 'Bắt đầu mô phỏng'
                        }
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>{isClockPaused ? 'Tiếp tục' : 'Bắt đầu'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={handlePause}
                        disabled={currentRun.status !== 'running'}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 rounded font-mono font-bold text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow transition-all cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Tạm dừng</span>
                      </button>
                    )}

                    <div className="text-[10px] font-mono text-slate-400 flex flex-col justify-center">
                      <span>Token: {currentRun.runToken?.substring(0, 8)}...</span>
                      <span>Gen: {currentRun.importGen ?? 0}</span>
                    </div>

                    {currentRun.status === 'running' && (
                      <button
                        onClick={() => handleCancelRun(currentRun)}
                        className="col-span-2 flex items-center justify-center gap-1 px-2 py-1 rounded font-mono font-bold text-[11px] bg-rose-950/80 hover:bg-rose-900 border border-rose-700/60 text-rose-200 transition-all cursor-pointer"
                        title="Dừng và hủy phiên mô phỏng hiện tại (giữ lại nhật ký sự kiện)"
                      >
                        <Ban className="w-3.5 h-3.5 text-rose-400" />
                        <span>Hủy phiên (Cancel)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Informative Lifecycle Alerts */}
              {isInvalidatedByImport && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/80 border border-rose-700/60 rounded text-rose-200 text-[11px] font-mono">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                  <span>Phiên mô phỏng này đã bị vô hiệu hóa do gói dữ liệu workspace vừa được import. Bấm &quot;+ Khởi tạo Phiên Mới&quot; để tiếp tục.</span>
                </div>
              )}
              {!isFresh && !isInvalidatedByImport && currentRun && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/80 border border-amber-700/60 rounded text-amber-200 text-[11px] font-mono">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <span>Dữ liệu phương án đã thay đổi so với khi khởi tạo phiên (trạng thái: lỗi thời / stale). Vui lòng khởi tạo phiên mới.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-center bg-slate-950/40 rounded-lg border border-dashed border-slate-800 text-slate-500 font-mono">
              Chưa chọn phiên mô phỏng. Bấm nút &quot;Khởi tạo Phiên Mới&quot; phía trên để bắt đầu.
            </div>
          )}

          {/* Section 3: Manual Step Execution Form */}
          {currentRun && (
            <div className="bg-slate-950/60 p-3.5 rounded-lg border border-cyan-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                  <StepForward className="w-4 h-4 text-cyan-400" />
                  BƯỚC THỦ CÔNG & ĐÁNH GIÁ VÙNG PHỦ RADAR
                </span>
                {!canStep && (
                  <span className="text-[10px] font-mono text-amber-400 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    {isInvalidatedByImport
                      ? 'Phiên đã bị vô hiệu do import workspace'
                      : !isFresh
                      ? 'Phiên đã lỗi thời do thay đổi dữ liệu phương án'
                      : !hasClockSession
                      ? 'Chưa khởi tạo phiên đồng hồ'
                      : clock?.phase !== 'advancing'
                      ? 'Đồng hồ cần ở trạng thái "advancing" để thực hiện bước'
                      : 'Phiên mô phỏng không khả dụng để bước'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">
                    Thời gian bước (elapsedRealMs):
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={elapsedRealMs}
                    onChange={(e) => setElapsedRealMs(Math.max(1, parseInt(e.target.value) || 1000))}
                    className="w-full bg-slate-900 text-slate-100 font-mono text-xs border border-slate-700 rounded px-2.5 py-1.5 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">
                    Độ cao mục tiêu giả định (H_mt - mét):
                  </label>
                  <input
                    type="number"
                    min="50"
                    step="100"
                    value={targetAltitudeM}
                    onChange={(e) => setTargetAltitudeM(Math.max(0, parseInt(e.target.value) || 1000))}
                    className="w-full bg-slate-900 text-slate-100 font-mono text-xs border border-slate-700 rounded px-2.5 py-1.5 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <button
                  onClick={handleStep}
                  disabled={!canStep}
                  className="w-full py-2 px-3 rounded font-mono font-bold text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-[0_0_12px_rgba(6,182,212,0.3)] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <StepForward className="w-4 h-4" />
                  <span>Bước & Đánh Giá</span>
                </button>
              </div>
            </div>
          )}

          {/* Section 4: Timeline & Domain Evaluation Inspector */}
          {timeline && timeline.events.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Event list */}
              <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2 max-h-64 overflow-y-auto">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">
                  Nhật ký Sự kiện ({timeline.events.length} sự kiện):
                </span>
                <div className="space-y-1">
                  {timeline.events.map((evt) => {
                    const isSelected = selectedEvent?.eventId === evt.eventId;
                    return (
                      <button
                        key={evt.eventId}
                        onClick={() => {
                          if (currentRun) {
                            setSelectedEventScope({
                              runId: currentRun.id,
                              sequence: evt.sequence,
                            });
                          }
                        }}
                        className={`w-full text-left p-1.5 rounded font-mono text-[10px] flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-950/90 text-cyan-200 border border-cyan-500/50'
                            : 'bg-slate-900/60 text-slate-300 hover:bg-slate-900 border border-transparent'
                        }`}
                      >
                        <span className="font-bold">#{evt.sequence} {evt.eventType}</span>
                        <span className="text-slate-500">{(evt.simTimeNs / 1e9).toFixed(3)}s</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Event Inspector / Outcome Details */}
              <div className="md:col-span-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
                <span className="text-[10px] font-mono uppercase text-slate-400 block border-b border-slate-800 pb-1">
                  Chi tiết Kết quả Đánh giá Sự kiện #{selectedEvent?.sequence}
                </span>

                {selectedEvent?.eventType === RADAR_SURVEILLANCE_EVENT_TYPE && selectedEvent.payload ? (
                  (() => {
                    const payload = (selectedEvent.payload as unknown) as RadarSurveillanceEvaluationPayload;
                    return (
                      <div className="space-y-3 font-mono text-xs">
                        {/* Summary Badges */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Số đài radar:</span>
                            <span className="font-bold text-cyan-300 text-sm">{payload.radarCount}</span>
                          </div>
                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Tổng bán kính hiệu dụng:</span>
                            <span className="font-bold text-emerald-300 text-sm">
                              {payload.summary.totalEffectiveCoverageKm} km
                            </span>
                          </div>
                          <div className="bg-slate-900 p-2 rounded border border-slate-800">
                            <span className="text-[10px] text-slate-500 block">Bị giới hạn chân trời:</span>
                            <span className={`font-bold text-sm ${payload.summary.horizonConstrainedCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                              {payload.summary.horizonConstrainedCount} đài
                            </span>
                          </div>
                        </div>

                        {/* Station details */}
                        {payload.evaluatedRadars.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {payload.evaluatedRadars.map((r) => (
                              <div
                                key={r.placementId}
                                className="p-2 bg-slate-900/90 rounded border border-slate-800 space-y-1"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-200">{r.name}</span>
                                  {r.isHorizonConstrained ? (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-600/40">
                                      Bị giới hạn chân trời
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/40">
                                      Đạt tầm cực đại
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px] text-slate-400">
                                  <div>Tháp anten: <span className="text-slate-200">{r.position.aglM}m</span></div>
                                  <div>Tầm máy R_max: <span className="text-cyan-300">{r.instrumentalRangeKm}km</span></div>
                                  <div>Chân trời D_nt: <span className="text-amber-300">{r.radarHorizonKm}km</span></div>
                                  <div>Vùng mù đỉnh R_kh: <span className="text-rose-300">{r.coneOfSilenceRadiusKm}km</span></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3 text-center text-slate-500 italic">
                            Phương án hiện tại không có đài radar nào được bố trí.
                          </div>
                        )}

                        {/* Pairwise Baselines if any */}
                        {payload.interStationBaselinesKm && payload.interStationBaselinesKm.length > 0 && (
                          <div className="text-[10px] text-slate-400 border-t border-slate-800 pt-1.5">
                            <span className="font-bold block mb-1">Cự ly cự điểm giữa các đài radar (Haversine):</span>
                            <div className="flex flex-wrap gap-2">
                              {payload.interStationBaselinesKm.map((b, idx) => (
                                <span key={idx} className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                  {b.fromPlacementId.substring(0, 8)} ↔ {b.toPlacementId.substring(0, 8)}: <strong className="text-slate-200">{b.distanceKm} km</strong>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="p-4 text-center text-slate-500 font-mono text-xs">
                    {selectedEvent ? 'Sự kiện không chứa dữ liệu đánh giá radar.' : 'Chưa có sự kiện nào.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
