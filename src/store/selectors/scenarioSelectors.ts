import type { TacticalState } from '../types';
import type { Scenario } from '../../domain/types/scenario';
import type { Plan } from '../../domain/types/plan';

export const selectScenarios = (() => {
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: Scenario[] = [];

  return (state: TacticalState): Scenario[] => {
    if (lastScenarios === state.scenarios) {
      return lastResult;
    }
    lastScenarios = state.scenarios;
    lastResult = Object.values(state.scenarios).filter((s) => s.status !== 'trashed');
    return lastResult;
  };
})();

export const selectAllScenarios = (() => {
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: Scenario[] = [];

  return (state: TacticalState): Scenario[] => {
    if (lastScenarios === state.scenarios) {
      return lastResult;
    }
    lastScenarios = state.scenarios;
    lastResult = Object.values(state.scenarios);
    return lastResult;
  };
})();

export const selectPlansForActiveScenario = (() => {
  let lastPlans: Record<string, Plan> | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastResult: Plan[] = [];

  return (state: TacticalState): Plan[] => {
    if (
      lastPlans === state.plans &&
      lastActiveScenarioId === state.activeScenarioId
    ) {
      return lastResult;
    }
    lastPlans = state.plans;
    lastActiveScenarioId = state.activeScenarioId;
    lastResult = state.activeScenarioId
      ? Object.values(state.plans).filter(
        (p) =>
          p.scenarioId === state.activeScenarioId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      )
      : [];
    return lastResult;
  };
})();

export const selectAllPlansForActiveScenario = (() => {
  let lastPlans: Record<string, Plan> | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastResult: Plan[] = [];

  return (state: TacticalState): Plan[] => {
    if (
      lastPlans === state.plans &&
      lastActiveScenarioId === state.activeScenarioId
    ) {
      return lastResult;
    }
    lastPlans = state.plans;
    lastActiveScenarioId = state.activeScenarioId;
    lastResult = state.activeScenarioId
      ? Object.values(state.plans).filter((p) => p.scenarioId === state.activeScenarioId)
      : [];
    return lastResult;
  };
})();

export const selectActiveScenario = (state: TacticalState): Scenario | null =>
  state.activeScenarioId ? state.scenarios[state.activeScenarioId] || null : null;

export const selectActivePlan = (state: TacticalState): Plan | null => {
  if (!state.activeScenarioId || !state.activePlanId) return null;
  const scenario = state.scenarios[state.activeScenarioId];
  if (!scenario) return null;
  const plan = state.plans[state.activePlanId];
  if (!plan) return null;
  if (plan.scenarioId !== state.activeScenarioId) return null;
  return plan;
};
