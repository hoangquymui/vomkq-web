import type { TacticalState } from '../types';
import type {
  SimulationClockPhase,
  SimulationClockState,
} from '../../domain/types/simulationClock';

/**
 * Selects a SimulationClockState by runId from runtime session state.
 */
export const selectSimulationClockByRunId = (
  state: TacticalState,
  runId: string | null | undefined
): SimulationClockState | null => {
  if (!runId || !state.simulationClocks) return null;
  return state.simulationClocks[runId] || null;
};

/**
 * Selects the SimulationClockState for the currently active SimulationRun.
 */
export const selectActiveSimulationClock = (
  state: TacticalState
): SimulationClockState | null => {
  if (!state.activeSimulationRunId || !state.simulationClocks) return null;
  return state.simulationClocks[state.activeSimulationRunId] || null;
};

/**
 * Selects the current clock phase for a specific runId, or active run if omitted.
 */
export const selectSimulationClockPhase = (
  state: TacticalState,
  runId?: string | null
): SimulationClockPhase | null => {
  const targetRunId = runId ?? state.activeSimulationRunId;
  if (!targetRunId || !state.simulationClocks) return null;
  return state.simulationClocks[targetRunId]?.phase ?? null;
};

/**
 * Selects the simulated time in milliseconds (simTimeMs) for a specific runId, or active run if omitted.
 */
export const selectSimulationClockTimeMs = (
  state: TacticalState,
  runId?: string | null
): number | null => {
  const targetRunId = runId ?? state.activeSimulationRunId;
  if (!targetRunId || !state.simulationClocks) return null;
  const clock = state.simulationClocks[targetRunId];
  return clock !== undefined ? clock.simTimeMs : null;
};

/**
 * Selects the authoritative simulated time in integer nanoseconds (simTimeNs)
 * for a specific runId, or active run if omitted.
 */
export const selectSimulationClockTimeNs = (
  state: TacticalState,
  runId?: string | null
): number | null => {
  const targetRunId = runId ?? state.activeSimulationRunId;
  if (!targetRunId || !state.simulationClocks) return null;
  const clock = state.simulationClocks[targetRunId];
  return clock !== undefined ? clock.simTimeNs : null;
};

/**
 * Selects the timeScale for a specific runId, or active run if omitted.
 */
export const selectSimulationClockTimeScale = (
  state: TacticalState,
  runId?: string | null
): number | null => {
  const targetRunId = runId ?? state.activeSimulationRunId;
  if (!targetRunId || !state.simulationClocks) return null;
  const clock = state.simulationClocks[targetRunId];
  return clock !== undefined ? clock.timeScale : null;
};
