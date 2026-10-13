import type { TacticalState } from '../types';
import type { SimulationRun } from '../../domain/types/simulation';
import { isSimulationRunFresh } from '../../domain/simulation/simulationFreshness';

export const selectSimulationRunById = (
  state: TacticalState,
  runId: string
): SimulationRun | null => {
  return state.simulationRuns[runId] || null;
};

export const selectSimulationRunsByPlan = (
  state: TacticalState,
  planId: string
): SimulationRun[] => {
  return Object.values(state.simulationRuns).filter((r) => r.planId === planId);
};

export const selectSimulationRunsByScenario = (
  state: TacticalState,
  scenarioId: string
): SimulationRun[] => {
  return Object.values(state.simulationRuns).filter((r) => r.scenarioId === scenarioId);
};

export const selectActiveSimulationRun = (
  state: TacticalState
): SimulationRun | null => {
  if (!state.activeSimulationRunId) return null;
  const run = state.simulationRuns[state.activeSimulationRunId];
  if (!run) return null;
  if (run.planId !== state.activePlanId || run.scenarioId !== state.activeScenarioId) {
    return null;
  }
  if (!isSimulationRunFresh(state, run)) return null;
  return run;
};
