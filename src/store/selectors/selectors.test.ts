import { describe, it, expect, beforeEach } from 'vitest';
import * as StoreModule from '../useTacticalStore';
import * as ScenarioSelectors from './scenarioSelectors';
import * as EquipmentSelectors from './equipmentSelectors';
import * as AnalysisSelectors from './analysisSelectors';
import * as SimulationSelectors from './simulationSelectors';
import type { TacticalState } from '../types';
import type { EquipmentPlacement, EquipmentDefinition, ObservationState } from '../../domain/types/equipment';
import type { Scenario } from '../../domain/types/scenario';
import type { Plan } from '../../domain/types/plan';
import type { SimulationRun, SimulationState } from '../../domain/types/simulation';
import type { LegacyPresentationState } from '../../domain/adapters/legacyEquipmentAdapter';

describe('Checkpoint 2C-R.2: Selectors Extraction and Behavioral Parity', () => {
  it('preserves strict reference identity (===) for all 19 re-exported selectors', () => {
    // Scenario selectors
    expect(StoreModule.selectScenarios).toBe(ScenarioSelectors.selectScenarios);
    expect(StoreModule.selectAllScenarios).toBe(ScenarioSelectors.selectAllScenarios);
    expect(StoreModule.selectPlansForActiveScenario).toBe(ScenarioSelectors.selectPlansForActiveScenario);
    expect(StoreModule.selectAllPlansForActiveScenario).toBe(ScenarioSelectors.selectAllPlansForActiveScenario);
    expect(StoreModule.selectActiveScenario).toBe(ScenarioSelectors.selectActiveScenario);
    expect(StoreModule.selectActivePlan).toBe(ScenarioSelectors.selectActivePlan);

    // Equipment selectors
    expect(StoreModule.selectActivePlacements).toBe(EquipmentSelectors.selectActivePlacements);
    expect(StoreModule.selectActiveEquipment).toBe(EquipmentSelectors.selectActiveEquipment);
    expect(StoreModule.selectEquipmentById).toBe(EquipmentSelectors.selectEquipmentById);
    expect(StoreModule.selectDefinitionForPlacement).toBe(EquipmentSelectors.selectDefinitionForPlacement);
    expect(StoreModule.selectObservationForPlacement).toBe(EquipmentSelectors.selectObservationForPlacement);
    expect(StoreModule.selectVisualForPlacement).toBe(EquipmentSelectors.selectVisualForPlacement);

    // Analysis selectors
    expect(StoreModule.selectActivePlanAnalysisResults).toBe(AnalysisSelectors.selectActivePlanAnalysisResults);
    expect(StoreModule.selectInstanceAnalysisResult).toBe(AnalysisSelectors.selectInstanceAnalysisResult);
    expect(StoreModule.selectAnalysisFreshness).toBe(AnalysisSelectors.selectAnalysisFreshness);

    // Simulation selectors
    expect(StoreModule.selectSimulationRunById).toBe(SimulationSelectors.selectSimulationRunById);
    expect(StoreModule.selectSimulationRunsByPlan).toBe(SimulationSelectors.selectSimulationRunsByPlan);
    expect(StoreModule.selectSimulationRunsByScenario).toBe(SimulationSelectors.selectSimulationRunsByScenario);
    expect(StoreModule.selectActiveSimulationRun).toBe(SimulationSelectors.selectActiveSimulationRun);
  });

  describe('selectActiveEquipment memoization & referential stability', () => {
    let mockState: TacticalState;

    beforeEach(() => {
      const scenario: Scenario = {
        id: 'scen_1',
        name: 'Scenario 1',
        status: 'draft',
        terrainVersion: 'v1',
        createdAt: 1000,
      };

      const plan: Plan = {
        id: 'plan_1',
        scenarioId: 'scen_1',
        name: 'Plan 1',
        version: 1,
        status: 'draft',
      };

      const placement: EquipmentPlacement = {
        id: 'p_1',
        planId: 'plan_1',
        definitionId: 'def_1',
        position: { lat: 21.0, lon: 105.0, altM: 10, aglM: 0 },
        network: { commandedBy: null },
      };

      const definition: EquipmentDefinition = {
        id: 'def_1',
        planId: 'plan_1',
        templateId: 'radar_36d6',
        category: 'RadarCanhGioi',
        name: 'Radar 36D6',
        rangeKm: 150,
        scanSpeed: 6,
        minElevationDeg: 0,
        maxElevationDeg: 30,
        coverageHeightKm: 20,
        capabilities: {},
      };

      const observation: ObservationState = {
        placementId: 'p_1',
        status: 'Active',
      };

      const visual: LegacyPresentationState = {
        color: '#ffffff',
        showDome: true,
        showSweep: true,
      };

      mockState = {
        scenarios: { scen_1: scenario },
        plans: { plan_1: plan },
        simulationRuns: {},
        definitions: { def_1: definition },
        placements: { p_1: placement },
        observations: { p_1: observation },
        visuals: { p_1: visual },
        simulations: {},
        revisions: {},
        revisionHeads: {},
        auditEvents: {},
        auditEventOrder: [],
        activeScenarioId: 'scen_1',
        activePlanId: 'plan_1',
        activeSimulationRunId: null,
        canonicalInitialized: true,
        workspaceContextGeneration: 1,
        lastImportGen: 1,
        activeTerrainProviderKey: 'provider_v1',
      } as unknown as TacticalState;
    });

    it('returns exactly the same array instance (===) when state references are unchanged', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const result2 = EquipmentSelectors.selectActiveEquipment(mockState);
      expect(result1).toBe(result2);
      expect(result1.length).toBe(1);
      expect(result1[0].instanceId).toBe('p_1');
    });

    it('invalidates cache when plan version changes', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const updatedState = {
        ...mockState,
        plans: {
          ...mockState.plans,
          plan_1: { ...mockState.plans.plan_1, version: 2 },
        },
      };
      const result2 = EquipmentSelectors.selectActiveEquipment(updatedState);
      expect(result1).not.toBe(result2);
    });

    it('invalidates cache when scenario status changes', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const updatedState = {
        ...mockState,
        scenarios: {
          ...mockState.scenarios,
          scen_1: { ...mockState.scenarios.scen_1, status: 'active' as const },
        },
      };
      const result2 = EquipmentSelectors.selectActiveEquipment(updatedState);
      expect(result1).not.toBe(result2);
    });

    it('invalidates cache when scenario terrainVersion changes', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const updatedState = {
        ...mockState,
        scenarios: {
          ...mockState.scenarios,
          scen_1: { ...mockState.scenarios.scen_1, terrainVersion: 'v2' },
        },
      };
      const result2 = EquipmentSelectors.selectActiveEquipment(updatedState);
      expect(result1).not.toBe(result2);
    });

    it('invalidates cache when lastImportGen changes', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const updatedState = {
        ...mockState,
        lastImportGen: 2,
      };
      const result2 = EquipmentSelectors.selectActiveEquipment(updatedState);
      expect(result1).not.toBe(result2);
    });

    it('invalidates cache when activeTerrainProviderKey changes', () => {
      const result1 = EquipmentSelectors.selectActiveEquipment(mockState);
      const updatedState = {
        ...mockState,
        activeTerrainProviderKey: 'provider_v2',
      };
      const result2 = EquipmentSelectors.selectActiveEquipment(updatedState);
      expect(result1).not.toBe(result2);
    });

    it('does NOT hydrate simulated state if active SimulationRun is stale or unknown', () => {
      const run: SimulationRun = {
        id: 'run_1',
        scenarioId: 'scen_1',
        planId: 'plan_1',
        timestamp: 1000,
        config: {},
        status: 'completed',
        planVersion: 1,
        modelVersion: 'v2.0-canonical',
        simulationVersion: '1.0.0',
        planInputFingerprint: undefined, // legacy unknown!
      };

      const simState: SimulationState = {
        runId: 'run_1',
        placementId: 'p_1',
        timeOffset: 0,
        currentSweepHeading: 180,
      };

      const stateWithLegacyRun = {
        ...mockState,
        simulationRuns: { run_1: run },
        activeSimulationRunId: 'run_1',
        simulations: { run_1: { p_1: simState } },
      };

      const activeEq = EquipmentSelectors.selectActiveEquipment(stateWithLegacyRun);
      expect(activeEq.length).toBe(1);
      // currentSweepHeading should NOT be hydrated from an unverified legacy run
      expect(activeEq[0].currentSweepHeading).toBeUndefined();
    });
  });

  describe('selectPlansForActiveScenario filtering invariants', () => {
    it('filters out trashed, withdrawn, and archived plans', () => {
      const state = {
        activeScenarioId: 'scen_1',
        plans: {
          p1: { id: 'p1', scenarioId: 'scen_1', status: 'draft' } as Plan,
          p2: { id: 'p2', scenarioId: 'scen_1', status: 'proposed' } as Plan,
          p3: { id: 'p3', scenarioId: 'scen_1', status: 'approved' } as Plan,
          p4: { id: 'p4', scenarioId: 'scen_1', status: 'trashed' } as Plan,
          p5: { id: 'p5', scenarioId: 'scen_1', status: 'withdrawn' } as Plan,
          p6: { id: 'p6', scenarioId: 'scen_1', status: 'archived' } as Plan,
          p_other: { id: 'p_other', scenarioId: 'scen_2', status: 'draft' } as Plan,
        },
      } as unknown as TacticalState;

      const activePlans = ScenarioSelectors.selectPlansForActiveScenario(state);
      expect(activePlans.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);

      const allPlans = ScenarioSelectors.selectAllPlansForActiveScenario(state);
      expect(allPlans.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    });
  });
});
