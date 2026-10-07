import type { Scenario } from '../types/scenario';
import type { Plan } from '../types/plan';
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../types/equipment';
import type { SimulationState, SimulationRun } from '../types/simulation';
import type { LegacyPresentationState } from '../adapters/legacyEquipmentAdapter';

export const CANONICAL_SCHEMA_VERSION = 1;

export interface CanonicalStatePackageV1 {
  schemaVersion: 1;
  metadata: {
    exportedAt: string;
    layoutName?: string;
  };
  context: {
    activeScenarioId: string | null;
    activePlanId: string | null;
    activeSimulationRunId: string | null;
  };
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
  placements: Record<string, EquipmentPlacement>;
  definitions: Record<string, EquipmentDefinition>;
  observations: Record<string, ObservationState>;
  simulationRuns: Record<string, SimulationRun>;
  simulations: Record<string, Record<string, SimulationState>>;
  visuals: Record<string, LegacyPresentationState>;
}

export function validateCanonicalStatePackageV1(pkg: any): asserts pkg is CanonicalStatePackageV1 {
  if (!pkg || typeof pkg !== 'object') {
    throw new Error('Package must be an object');
  }
  if (pkg.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${pkg.schemaVersion}`);
  }
  if (!pkg.context || !pkg.scenarios || !pkg.plans || !pkg.placements || !pkg.definitions || !pkg.observations || !pkg.simulationRuns || !pkg.simulations || !pkg.visuals) {
    throw new Error('Malformed CanonicalStatePackageV1: missing required registries or context');
  }
  
  // Validate context references
  const { activeScenarioId, activePlanId, activeSimulationRunId } = pkg.context;
  if (activeScenarioId && !pkg.scenarios[activeScenarioId]) {
    throw new Error(`Context references missing Scenario ${activeScenarioId}`);
  }
  if (activePlanId && !pkg.plans[activePlanId]) {
    throw new Error(`Context references missing Plan ${activePlanId}`);
  }
  if (activeSimulationRunId && !pkg.simulationRuns[activeSimulationRunId]) {
    throw new Error(`Context references missing SimulationRun ${activeSimulationRunId}`);
  }

  // Map Key / Record ID Consistency
  for (const [key, scenario] of Object.entries(pkg.scenarios as Record<string, Scenario>)) {
    if (key !== scenario.id) throw new Error(`Scenario registry key mismatch: ${key} vs ${scenario.id}`);
  }
  for (const [key, plan] of Object.entries(pkg.plans as Record<string, Plan>)) {
    if (key !== plan.id) throw new Error(`Plan registry key mismatch: ${key} vs ${plan.id}`);
  }
  for (const [key, placement] of Object.entries(pkg.placements as Record<string, EquipmentPlacement>)) {
    if (key !== placement.id) throw new Error(`Placement registry key mismatch: ${key} vs ${placement.id}`);
  }
  for (const [key, def] of Object.entries(pkg.definitions as Record<string, EquipmentDefinition>)) {
    if (key !== def.id) throw new Error(`Definition registry key mismatch: ${key} vs ${def.id}`);
  }
  for (const [key, run] of Object.entries(pkg.simulationRuns as Record<string, SimulationRun>)) {
    if (key !== run.id) throw new Error(`SimulationRun registry key mismatch: ${key} vs ${run.id}`);
  }

  // Validate active context relations
  if (activePlanId && !activeScenarioId) {
    throw new Error(`Context cannot have activePlanId without activeScenarioId`);
  }
  
  if (activeScenarioId && activePlanId) {
    if (pkg.plans[activePlanId].scenarioId !== activeScenarioId) {
      throw new Error(`Active Plan ${activePlanId} belongs to Scenario ${pkg.plans[activePlanId].scenarioId}, not Active Scenario ${activeScenarioId}`);
    }
  }

  if (activeSimulationRunId) {
    const activeRun = pkg.simulationRuns[activeSimulationRunId];
    if (activeRun.planId !== activePlanId) {
      throw new Error(`Active SimulationRun ${activeSimulationRunId} belongs to Plan ${activeRun.planId}, not Active Plan ${activePlanId}`);
    }
    if (activeRun.scenarioId !== activeScenarioId) {
      throw new Error(`Active SimulationRun ${activeSimulationRunId} belongs to Scenario ${activeRun.scenarioId}, not Active Scenario ${activeScenarioId}`);
    }
  }

  // Validate ownership / graph references
  for (const [placementId, placement] of Object.entries(pkg.placements as Record<string, EquipmentPlacement>)) {
    if (!pkg.plans[placement.planId]) {
      throw new Error(`Placement ${placementId} references missing Plan ${placement.planId}`);
    }
    if (!pkg.definitions[placement.definitionId]) {
      throw new Error(`Placement ${placementId} references missing Definition ${placement.definitionId}`);
    }
    if (pkg.definitions[placement.definitionId].planId !== placement.planId) {
      throw new Error(`Placement ${placementId} references cross-plan Definition ${placement.definitionId}`);
    }
    if (!pkg.observations[placementId]) {
      throw new Error(`Placement ${placementId} missing current Observation`);
    }
    if (!pkg.visuals[placementId]) {
      throw new Error(`Placement ${placementId} missing current Visual`);
    }
    if (placement.network?.commandedBy) {
      const commandedBy = placement.network.commandedBy;
      if (!pkg.placements[commandedBy]) {
        throw new Error(`Placement ${placementId} references missing commandedBy Placement ${commandedBy}`);
      }
      if (pkg.placements[commandedBy].planId !== placement.planId) {
        throw new Error(`Placement ${placementId} references cross-plan commandedBy Placement ${commandedBy}`);
      }
    }
  }
  
  for (const visualKey of Object.keys(pkg.visuals)) {
    if (!pkg.placements[visualKey]) {
      throw new Error(`Visual ${visualKey} is missing current Placement`);
    }
  }

  for (const [defId, def] of Object.entries(pkg.definitions as Record<string, EquipmentDefinition>)) {
    if (!pkg.plans[def.planId]) {
      throw new Error(`Definition ${defId} references missing Plan ${def.planId}`);
    }
  }
  for (const [planId, plan] of Object.entries(pkg.plans as Record<string, Plan>)) {
    if (!pkg.scenarios[plan.scenarioId]) {
      throw new Error(`Plan ${planId} references missing Scenario ${plan.scenarioId}`);
    }
  }
  for (const [runId, run] of Object.entries(pkg.simulationRuns as Record<string, SimulationRun>)) {
    if (!pkg.plans[run.planId]) {
      throw new Error(`SimulationRun ${runId} references missing Plan ${run.planId}`);
    }
    if (!pkg.scenarios[run.scenarioId]) {
      throw new Error(`SimulationRun ${runId} references missing Scenario ${run.scenarioId}`);
    }
    if (pkg.plans[run.planId].scenarioId !== run.scenarioId) {
      throw new Error(`SimulationRun ${runId} Plan mismatch with Scenario`);
    }
  }
}
