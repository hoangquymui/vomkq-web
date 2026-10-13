import type { TacticalState } from '../types';
import type {
  EquipmentDefinition,
  EquipmentPlacement,
  ObservationState,
} from '../../domain/types/equipment';
import type { EquipmentInstance } from '../../types/equipment';
import type { Plan } from '../../domain/types/plan';
import type { Scenario } from '../../domain/types/scenario';
import type { SimulationRun, SimulationState } from '../../domain/types/simulation';
import {
  hydrateLegacyInstance,
  type LegacyPresentationState,
} from '../../domain/adapters/legacyEquipmentAdapter';
import { isSimulationRunFresh } from '../../domain/simulation/simulationFreshness';
import { selectActivePlan } from './scenarioSelectors';

export const selectActivePlacements = (() => {
  let lastPlacements: Record<string, EquipmentPlacement> | null = null;
  let lastActivePlanId: string | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastPlans: Record<string, Plan> | null = null;
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: EquipmentPlacement[] = [];

  return (state: TacticalState): EquipmentPlacement[] => {
    if (
      lastPlacements === state.placements &&
      lastActivePlanId === state.activePlanId &&
      lastActiveScenarioId === state.activeScenarioId &&
      lastPlans === state.plans &&
      lastScenarios === state.scenarios
    ) {
      return lastResult;
    }
    lastPlacements = state.placements;
    lastActivePlanId = state.activePlanId;
    lastActiveScenarioId = state.activeScenarioId;
    lastPlans = state.plans;
    lastScenarios = state.scenarios;

    const activePlan = selectActivePlan(state);
    if (!activePlan) {
      lastResult = [];
    } else {
      lastResult = Object.values(state.placements).filter(p => p.planId === state.activePlanId);
    }
    return lastResult;
  };
})();

export const selectActiveEquipment = (() => {
  let lastActivePlanId: string | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastPlans: Record<string, Plan> | null = null;
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastPlacements: Record<string, EquipmentPlacement> | null = null;
  let lastDefinitions: Record<string, EquipmentDefinition> | null = null;
  let lastObservations: Record<string, ObservationState> | null = null;
  let lastVisuals: Record<string, LegacyPresentationState> | null = null;
  let lastActiveSimulationRunId: string | null = null;
  let lastSimulationRuns: Record<string, SimulationRun> | null = null;
  let lastSimulations: Record<string, Record<string, SimulationState>> | null = null;
  let lastImportGen: number | undefined = undefined;
  let lastActiveTerrainProviderKey: string | undefined = undefined;
  let lastPlanVersion: number | undefined = undefined;
  let lastScenarioStatus: string | undefined = undefined;
  let lastScenarioTerrainVersion: string | undefined = undefined;
  let lastResult: EquipmentInstance[] = [];

  return (state: TacticalState): EquipmentInstance[] => {
    const currentPlanVersion = state.activePlanId ? state.plans[state.activePlanId]?.version : undefined;
    const currentScenarioStatus = state.activeScenarioId ? state.scenarios[state.activeScenarioId]?.status : undefined;
    const currentScenarioTerrainVersion = state.activeScenarioId ? state.scenarios[state.activeScenarioId]?.terrainVersion : undefined;

    if (
      lastActivePlanId === state.activePlanId &&
      lastActiveScenarioId === state.activeScenarioId &&
      lastPlans === state.plans &&
      lastScenarios === state.scenarios &&
      lastPlacements === state.placements &&
      lastDefinitions === state.definitions &&
      lastObservations === state.observations &&
      lastVisuals === state.visuals &&
      lastActiveSimulationRunId === state.activeSimulationRunId &&
      lastSimulationRuns === state.simulationRuns &&
      lastSimulations === state.simulations &&
      lastImportGen === state.lastImportGen &&
      lastActiveTerrainProviderKey === state.activeTerrainProviderKey &&
      lastPlanVersion === currentPlanVersion &&
      lastScenarioStatus === currentScenarioStatus &&
      lastScenarioTerrainVersion === currentScenarioTerrainVersion
    ) {
      return lastResult;
    }

    lastActivePlanId = state.activePlanId;
    lastActiveScenarioId = state.activeScenarioId;
    lastPlans = state.plans;
    lastScenarios = state.scenarios;
    lastPlacements = state.placements;
    lastDefinitions = state.definitions;
    lastObservations = state.observations;
    lastVisuals = state.visuals;
    lastActiveSimulationRunId = state.activeSimulationRunId;
    lastSimulationRuns = state.simulationRuns;
    lastSimulations = state.simulations;
    lastImportGen = state.lastImportGen;
    lastActiveTerrainProviderKey = state.activeTerrainProviderKey;
    lastPlanVersion = currentPlanVersion;
    lastScenarioStatus = currentScenarioStatus;
    lastScenarioTerrainVersion = currentScenarioTerrainVersion;

    const placements = selectActivePlacements(state);
    if (placements.length === 0) {
      lastResult = [];
      return lastResult;
    }

    lastResult = placements
      .map(placement => {
        const definition = state.definitions[placement.definitionId];
        const observation = state.observations[placement.id];
        const visual = state.visuals[placement.id];
        const activeRun = state.activeSimulationRunId
          ? state.simulationRuns[state.activeSimulationRunId]
          : undefined;
        // Strictly require active Run record exists, ownership matches BOTH activePlanId and activeScenarioId, AND is fresh
        const isRunValidAndMatching = Boolean(
          activeRun &&
          activeRun.planId === state.activePlanId &&
          activeRun.scenarioId === state.activeScenarioId &&
          isSimulationRunFresh(state, activeRun)
        );
        const simulation = (state.activeSimulationRunId && isRunValidAndMatching)
          ? state.simulations[state.activeSimulationRunId]?.[placement.id]
          : undefined;
        if (!definition || !observation || !visual) return null;
        if (definition.planId !== placement.planId || definition.planId !== state.activePlanId) return null;

        return hydrateLegacyInstance(placement, definition, observation, visual, simulation);
      })
      .filter((inst): inst is EquipmentInstance => inst !== null);

    return lastResult;
  };
})();

export const selectEquipmentById = (state: TacticalState, id: string): EquipmentInstance | null => {
  return selectActiveEquipment(state).find(e => e.instanceId === id) || null;
};

export const selectDefinitionForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  const d = state.definitions[p.definitionId];
  if (!d || d.planId !== activePlan.id) return null;
  return d;
};

export const selectObservationForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  return state.observations[placementId] || null;
};

export const selectVisualForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  return state.visuals[placementId] || null;
};
