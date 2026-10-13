import { describe, it, expect, beforeEach } from 'vitest';
import { createSimulationRunSlice } from './simulationRunSlice';
import { createSpxAnalysisSlice } from './spxAnalysisSlice';
import type { TacticalState } from '../types';
import type { Scenario } from '../../domain/types/scenario';
import type { Plan } from '../../domain/types/plan';
import type { EquipmentPlacement, EquipmentDefinition } from '../../domain/types/equipment';
import type { SpxCoverageResult } from '../../types/spxRadarCoverage';
import {
  buildSpxInputSnapshot,
  computeAnalysisFingerprint,
  resolveEffectiveSpxConfigFromCanonical,
} from '../../domain/analysis/analysisFingerprint';
import { DEFAULT_SPX_CONFIG } from '../../types/spxRadarCoverage';

describe('Checkpoint 2C-R.2: Lifecycle Slices Extraction and Behavioral Parity', () => {
  let state: TacticalState;

  const mockSet = (
    updater:
      | Partial<TacticalState>
      | ((s: TacticalState) => Partial<TacticalState> | TacticalState)
  ) => {
    if (typeof updater === 'function') {
      const next = updater(state);
      state = { ...state, ...next };
    } else {
      state = { ...state, ...updater };
    }
  };

  const mockGet = (): TacticalState => state;

  beforeEach(() => {
    const scenario: Scenario = {
      id: 'scen_1',
      name: 'Scenario 1',
      status: 'draft',
      terrainVersion: 'v1',
      createdAt: 1000,
    };

    const planA: Plan = {
      id: 'plan_A',
      scenarioId: 'scen_1',
      name: 'Plan A',
      version: 1,
      status: 'draft',
    };

    const planB: Plan = {
      id: 'plan_B',
      scenarioId: 'scen_1',
      name: 'Plan B',
      version: 1,
      status: 'draft',
    };

    const placement: EquipmentPlacement = {
      id: 'p_1',
      planId: 'plan_A',
      definitionId: 'def_1',
      position: { lat: 21.0, lon: 105.0, altM: 10, aglM: 0 },
      network: { commandedBy: null },
    };

    const definition: EquipmentDefinition = {
      id: 'def_1',
      planId: 'plan_A',
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

    state = {
      scenarios: { scen_1: scenario },
      plans: { plan_A: planA, plan_B: planB },
      simulationRuns: {},
      definitions: { def_1: definition },
      placements: { p_1: placement },
      observations: { p_1: { placementId: 'p_1', status: 'Active' } },
      visuals: { p_1: { color: '#ffffff', showDome: true, showSweep: true } },
      simulations: {},
      revisions: {},
      revisionHeads: {},
      auditEvents: {},
      auditEventOrder: [],
      activeScenarioId: 'scen_1',
      activePlanId: 'plan_A',
      activeSimulationRunId: null,
      canonicalInitialized: true,
      workspaceContextGeneration: 1,
      lastImportGen: 1,
      activeTerrainProviderKey: 'provider_v1',
      spxConfig: DEFAULT_SPX_CONFIG,
      spxResults: {},
      analysisResults: {},
      spxRecalculateToken: 0,
      spxRequestedRecalculateInstanceId: null,
      isCalculatingSpx: false,
      spxRequestRegistry: {},
      spxSequenceCounters: {},
      spxAcceptedSequences: {},
      spxActiveResultIds: {},
    } as unknown as TacticalState;
  });

  describe('SimulationRunSlice', () => {
    it('registers a simulation run and returns execution handle with token', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      const handle = slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        initialStatus: 'pending',
      });

      expect(handle.runId).toBeDefined();
      expect(handle.runToken).toBeDefined();
      expect(handle.importGen).toBe(1);

      const record = state.simulationRuns[handle.runId];
      expect(record).toBeDefined();
      expect(record.status).toBe('pending');
      expect(record.planInputFingerprint).toBeDefined();
      expect(Object.isFrozen(record)).toBe(true);
    });

    it('rejects registration with duplicate customRunId', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        customRunId: 'custom_123',
      });

      expect(() => {
        slice.registerSimulationRun({
          scenarioId: 'scen_1',
          planId: 'plan_A',
          customRunId: 'custom_123',
        });
      }).toThrow(/already exists in active registry/);
    });

    it('transitions state machine pending -> running -> completed and enforces terminal immutability', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      const handle = slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        initialStatus: 'pending',
      });

      // 1. pending -> running
      slice.updateSimulationRunStatus(handle, 'running');
      expect(state.simulationRuns[handle.runId].status).toBe('running');

      // 2. running -> completed
      slice.updateSimulationRunStatus(handle, 'completed', {
        completedAt: Date.now(),
        resultSummary: { score: 100 },
      });
      expect(state.simulationRuns[handle.runId].status).toBe('completed');

      // 3. terminal status immutability: cannot transition out of completed
      expect(() => {
        slice.updateSimulationRunStatus(handle, 'failed');
      }).toThrow(/Cannot transition terminal SimulationRun/);
    });

    it('rejects update when execution token does not match (incarnation anti-race)', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      const handle = slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        initialStatus: 'running',
      });

      expect(() => {
        slice.updateSimulationRunStatus(
          { ...handle, runToken: 'wrong_token' },
          'completed'
        );
      }).toThrow(/Invalid or missing execution incarnation token/);
    });

    it('rejects update if handle was created before workspace import replacement', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      const handle = slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        initialStatus: 'running',
      });

      // Simulate workspace import that bumps lastImportGen
      state = { ...state, lastImportGen: 2 };

      expect(() => {
        slice.updateSimulationRunStatus(handle, 'completed');
      }).toThrow(/Workspace was replaced by import after registration/);
    });

    it('allows completion of Run for Plan A when active context has switched to Plan B', () => {
      const slice = createSimulationRunSlice(mockSet, mockGet);
      const handle = slice.registerSimulationRun({
        scenarioId: 'scen_1',
        planId: 'plan_A',
        initialStatus: 'running',
      });

      // User switches active plan to Plan B
      state = { ...state, activePlanId: 'plan_B' };

      // Background run for Plan A completes
      expect(() => {
        slice.updateSimulationRunStatus(handle, 'completed');
      }).not.toThrow();

      expect(state.simulationRuns[handle.runId].status).toBe('completed');
    });
  });

  describe('SpxAnalysisSlice', () => {
    it('registers analysis request with monotonic sequence numbers', () => {
      const slice = createSpxAnalysisSlice(mockSet, mockGet);
      const req1 = slice.registerSpxAnalysisRequest('plan_A', 'p_1');
      const req2 = slice.registerSpxAnalysisRequest('plan_A', 'p_1');

      expect(state.spxRequestRegistry[req1].sequenceNumber).toBe(1);
      expect(state.spxRequestRegistry[req2].sequenceNumber).toBe(2);
      expect(state.spxSequenceCounters['plan_A:p_1']).toBe(2);
    });

    it('commits SPx analysis result atomically to overlay when fingerprint and context match', () => {
      const slice = createSpxAnalysisSlice(mockSet, mockGet);
      const reqId = slice.registerSpxAnalysisRequest('plan_A', 'p_1');

      const mockResult: SpxCoverageResult = {
        data: 'mock_spx_data',
        timestamp: Date.now(),
      } as unknown as SpxCoverageResult;

      const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
        state.spxConfig,
        state.placements.p_1,
        state.definitions.def_1,
        state.visuals.p_1?.spxConfig
      );

      const snapshot = buildSpxInputSnapshot(
        'scen_1',
        state.plans.plan_A,
        state.placements.p_1,
        state.definitions.def_1,
        effectiveConfig,
        'v1',
        state.activeTerrainProviderKey
      );
      const fp = computeAnalysisFingerprint(snapshot);

      const applied = slice.commitSpxAnalysisResult({
        requestId: reqId,
        scenarioId: 'scen_1',
        planId: 'plan_A',
        gen: 1,
        instanceId: 'p_1',
        result: mockResult,
        snapshot,
        inputFingerprint: fp,
      });

      expect(applied).toBe(true);
      expect(state.spxResults['p_1']).toBe(mockResult);
      expect(state.spxAcceptedSequences['plan_A:p_1']).toBe(1);
      expect(Object.keys(state.analysisResults).length).toBe(1);
    });

    it('rejects out-of-order request from being applied to active overlay', () => {
      const slice = createSpxAnalysisSlice(mockSet, mockGet);
      const req1 = slice.registerSpxAnalysisRequest('plan_A', 'p_1');
      const req2 = slice.registerSpxAnalysisRequest('plan_A', 'p_1');

      const result1: SpxCoverageResult = { id: 1 } as unknown as SpxCoverageResult;
      const result2: SpxCoverageResult = { id: 2 } as unknown as SpxCoverageResult;

      const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
        state.spxConfig,
        state.placements.p_1,
        state.definitions.def_1,
        state.visuals.p_1?.spxConfig
      );

      const snapshot = buildSpxInputSnapshot(
        'scen_1',
        state.plans.plan_A,
        state.placements.p_1,
        state.definitions.def_1,
        effectiveConfig,
        'v1',
        state.activeTerrainProviderKey
      );
      const fp = computeAnalysisFingerprint(snapshot);

      // Commit newer request 2 first
      slice.commitSpxAnalysisResult({
        requestId: req2,
        scenarioId: 'scen_1',
        planId: 'plan_A',
        gen: 1,
        instanceId: 'p_1',
        result: result2,
        snapshot,
        inputFingerprint: fp,
      });

      expect(state.spxResults['p_1']).toBe(result2);

      // Late async arrival of older request 1
      const appliedOlder = slice.commitSpxAnalysisResult({
        requestId: req1,
        scenarioId: 'scen_1',
        planId: 'plan_A',
        gen: 1,
        instanceId: 'p_1',
        result: result1,
        snapshot,
        inputFingerprint: fp,
      });

      expect(appliedOlder).toBe(false);
      // Overlay must NOT be overwritten by older result
      expect(state.spxResults['p_1']).toBe(result2);
    });
  });
});
