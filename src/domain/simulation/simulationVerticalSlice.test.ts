/**
 * @fileoverview End-to-end integration tests for Checkpoint 2C.5 First Functional Simulation Vertical Slice.
 *
 * Verifies the complete operational loop:
 * Scenario / Plan -> SimulationRun -> Deterministic Clock -> Radar Surveillance Horizon Evaluation -> Atomic Runner -> Event Timeline -> UI Store State.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { EquipmentPlacement, EquipmentDefinition } from '../types/equipment';
import { RADAR_SURVEILLANCE_EVENT_TYPE, type RadarSurveillanceEvaluationPayload } from './radarSurveillanceEvaluation';
import { resolvePlanRuns, resolveActiveSimulationRun, deriveSimulationRunFreshness } from '../../components/ui/SimulationRunnerPanel';

describe('Checkpoint 2C.5: Functional Simulation Vertical Slice Integration', () => {
  const SCENARIO_ID = 'scen_vs_01';
  const PLAN_ID = 'plan_vs_01';

  const mockRadarDef1: EquipmentDefinition = {
    id: 'def_vs_36d6',
    planId: PLAN_ID,
    templateId: 'tmpl_36d6',
    category: 'RadarCanhGioi',
    name: 'Radar Cảnh giới 36D6',
    rangeKm: 150,
    scanSpeed: 6,
    minElevationDeg: 0.5,
    maxElevationDeg: 45,
    coverageHeightKm: 20,
    capabilities: {},
  };

  const mockPlacement1: EquipmentPlacement = {
    id: 'placement_vs_01',
    planId: PLAN_ID,
    definitionId: 'def_vs_36d6',
    position: {
      lat: 21.0285,
      lon: 105.8542,
      altM: 10,
      aglM: 15, // 15m mast height
    },
    network: {},
  };

  const mockRadarDef2: EquipmentDefinition = {
    id: 'def_vs_kolchuga',
    planId: PLAN_ID,
    templateId: 'tmpl_kolchuga',
    category: 'RadarCanhGioi',
    name: 'Radar Kolchuga',
    rangeKm: 300,
    scanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 30,
    coverageHeightKm: 30,
    capabilities: {},
  };

  const mockPlacement2: EquipmentPlacement = {
    id: 'placement_vs_02',
    planId: PLAN_ID,
    definitionId: 'def_vs_kolchuga',
    position: {
      lat: 20.8449,
      lon: 106.6881,
      altM: 5,
      aglM: 25, // 25m mast height
    },
    network: {},
  };

  beforeEach(() => {
    // Reset store to known clean state with scenario and plan
    useTacticalStore.setState((s) => ({
      ...s,
      activeScenarioId: SCENARIO_ID,
      activePlanId: PLAN_ID,
      scenarios: {
        [SCENARIO_ID]: {
          id: SCENARIO_ID,
          name: 'Kịch bản Thử nghiệm 2C.5',
          status: 'active',
          terrainVersion: 'v1',
          createdAt: 1000,
        },
      },
      plans: {
        [PLAN_ID]: {
          id: PLAN_ID,
          scenarioId: SCENARIO_ID,
          version: 1,
          name: 'Phương án Phòng không 01',
          status: 'approved',
        },
      },
      definitions: {
        [mockRadarDef1.id]: mockRadarDef1,
        [mockRadarDef2.id]: mockRadarDef2,
      },
      placements: {
        [mockPlacement1.id]: mockPlacement1,
        [mockPlacement2.id]: mockPlacement2,
      },
      observations: {
        [mockPlacement1.id]: { placementId: mockPlacement1.id, status: 'Active' },
        [mockPlacement2.id]: { placementId: mockPlacement2.id, status: 'Active' },
      },
      visuals: {
        [mockPlacement1.id]: { placementId: mockPlacement1.id, color: '#06b6d4', showDome: true, showSweep: false },
        [mockPlacement2.id]: { placementId: mockPlacement2.id, color: '#06b6d4', showDome: true, showSweep: false },
      },
      simulationRuns: {},
      activeSimulationRunId: null,
      simulationClocks: {},
      simulationTimelines: {},
      showSimulationPanel: false,
    }));
  });

  it('Gate 1 & 2: Executes full vertical workflow and records real domain radar evaluation', () => {
    const store = useTacticalStore.getState();

    // 1. Register SimulationRun
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
      autoActivate: true,
    });
    expect(handle.runId).toBeDefined();
    expect(handle.runToken).toBeDefined();

    // 2. Initialize Clock & Timeline sessions
    const clock = store.initSimulationClock(handle);
    const timeline = store.initSimulationTimeline(handle);
    expect(clock.phase).toBe('idle');
    expect(timeline.events.length).toBe(0);

    // 3. Start clock to advancing
    store.startSimulationClock(handle);
    expect(useTacticalStore.getState().simulationClocks[handle.runId].phase).toBe('advancing');

    // 4. Perform manual deterministic step with domain evaluation
    const result = store.stepSimulationWithRadarEvaluation(handle, {
      elapsedRealMs: 1000,
      targetAltitudeM: 1000,
    });

    // 5. Verify clock outcome
    expect(result.clock.simTimeNs).toBe(1_000_000_000); // 1 sec in integer ns
    expect(result.clock.simTimeMs).toBe(1000);
    expect(result.clock.tickCount).toBe(1);

    // 6. Verify timeline outcome & event timestamping
    expect(result.events.length).toBe(1);
    const event = result.events[0];
    expect(event.eventType).toBe(RADAR_SURVEILLANCE_EVENT_TYPE);
    expect(event.simTimeNs).toBe(1_000_000_000); // Canonical post-advancement timestamp
    expect(event.sequence).toBe(0);

    // 7. Verify real domain evaluation payload content
    const payload = event.payload as unknown as RadarSurveillanceEvaluationPayload;
    expect(payload.radarCount).toBe(2);
    expect(payload.evaluatedRadars.length).toBe(2);

    const r1 = payload.evaluatedRadars.find((r) => r.placementId === 'placement_vs_01')!;
    expect(r1.name).toBe('Radar Cảnh giới 36D6');
    expect(r1.radarHorizonKm).toBeCloseTo(146.24, 1);
    expect(r1.coneOfSilenceRadiusKm).toBe(1.0);
    expect(r1.isHorizonConstrained).toBe(true);

    const r2 = payload.evaluatedRadars.find((r) => r.placementId === 'placement_vs_02')!;
    expect(r2.name).toBe('Radar Kolchuga');
    // Horizon: 4.12 * (sqrt(25) + sqrt(1000)) = 4.12 * (5 + 31.62277) = 150.88 km
    expect(r2.radarHorizonKm).toBeCloseTo(150.88, 1);
    expect(r2.isHorizonConstrained).toBe(true); // 150.88 < 300 km

    // Pairwise baseline between Hanoi and Hai Phong
    expect(payload.interStationBaselinesKm?.length).toBe(1);
    expect(payload.interStationBaselinesKm![0].distanceKm).toBeGreaterThan(80);

    // Store state reflects the committed clock and timeline
    const finalState = useTacticalStore.getState();
    expect(finalState.simulationClocks[handle.runId].simTimeNs).toBe(1_000_000_000);
    expect(finalState.simulationTimelines[handle.runId].events.length).toBe(1);
  });

  it('Gate 3 & 4: Multi-step progression, event sequence ordering, and deterministic replay', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // Step 1: 500ms
    store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 500, targetAltitudeM: 1000 });
    // Step 2: 1500ms
    store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1500, targetAltitudeM: 2000 });

    const state = useTacticalStore.getState();
    const clock = state.simulationClocks[handle.runId];
    const timeline = state.simulationTimelines[handle.runId];

    expect(clock.simTimeNs).toBe(2_000_000_000); // 500ms + 1500ms = 2s
    expect(clock.tickCount).toBe(2);
    expect(timeline.events.length).toBe(2);

    expect(timeline.events[0].sequence).toBe(0);
    expect(timeline.events[0].simTimeNs).toBe(500_000_000);
    expect(timeline.events[1].sequence).toBe(1);
    expect(timeline.events[1].simTimeNs).toBe(2_000_000_000);

    // In step 2, target altitude was 2000m -> Cone of silence: 2000 * cot(45deg) = 2.0 km
    const p2 = timeline.events[1].payload as unknown as RadarSurveillanceEvaluationPayload;
    expect(p2.targetAltitudeM).toBe(2000);
    expect(p2.evaluatedRadars[0].coneOfSilenceRadiusKm).toBe(2.0);
  });

  it('Gate 5 & 6: Atomicity and full rollback on paused clock or invalid parameters', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // Pause clock
    store.pauseSimulationClock(handle);

    // Attempting to step when paused must throw and rollback completely
    expect(() =>
      store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000 })
    ).toThrow(/Clock phase must be advancing/);

    const stateAfterReject = useTacticalStore.getState();
    expect(stateAfterReject.simulationClocks[handle.runId].simTimeNs).toBe(0);
    expect(stateAfterReject.simulationTimelines[handle.runId].events.length).toBe(0);

    // Resume clock
    store.resumeSimulationClock(handle);

    // Invalid negative target altitude must throw before commit and leave clock unchanged
    expect(() =>
      store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000, targetAltitudeM: -500 })
    ).toThrow(/targetAltitudeM must be a non-negative finite number/);

    const stateAfterBadAltitude = useTacticalStore.getState();
    expect(stateAfterBadAltitude.simulationClocks[handle.runId].simTimeNs).toBe(0);
    expect(stateAfterBadAltitude.simulationTimelines[handle.runId].events.length).toBe(0);
  });

  it('Gate 7: Rejects stale token and workspace replacement', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // 1. Stale token
    expect(() =>
      store.stepSimulationWithRadarEvaluation(
        handle.runId,
        { elapsedRealMs: 1000 },
        { runToken: 'stale_token_xyz', importGen: handle.importGen }
      )
    ).toThrow(/Invalid or missing execution incarnation token/);

    // 2. Workspace package import invalidates execution sessions
    const pkg = store.exportCanonicalPackageV2('Backup');
    store.importCanonicalPackage(pkg);

    const stateAfterImport = useTacticalStore.getState();
    expect(stateAfterImport.simulationClocks).toEqual({});
    expect(stateAfterImport.simulationTimelines).toEqual({});

    expect(() =>
      stateAfterImport.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000 })
    ).toThrow(/Workspace was replaced by import after registration/);
  });

  it('Gate 8: Strict Run A / Run B session and evaluation isolation', () => {
    const store = useTacticalStore.getState();

    // Create Plan B with its own valid EquipmentDefinition (Blocker B3)
    const PLAN_B_ID = 'plan_vs_02';
    const mockRadarDefB: EquipmentDefinition = {
      id: 'def_vs_b_01',
      planId: PLAN_B_ID,
      templateId: 'tmpl_kolchuga',
      category: 'RadarCanhGioi',
      name: 'Radar Plan B Kolchuga',
      rangeKm: 250,
      scanSpeed: 0,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 25,
      capabilities: {},
    };

    useTacticalStore.setState((s) => ({
      ...s,
      plans: {
        ...s.plans,
        [PLAN_B_ID]: {
          id: PLAN_B_ID,
          scenarioId: SCENARIO_ID,
          version: 1,
          name: 'Phương án B (1 Đài)',
          status: 'approved',
        },
      },
      definitions: {
        ...s.definitions,
        [mockRadarDefB.id]: mockRadarDefB,
      },
      placements: {
        ...s.placements,
        placement_b_01: {
          id: 'placement_b_01',
          planId: PLAN_B_ID,
          definitionId: mockRadarDefB.id,
          position: { lat: 16.0544, lon: 108.2022, altM: 50, aglM: 30 },
          network: {},
        },
      },
      observations: {
        ...s.observations,
        placement_b_01: { placementId: 'placement_b_01', status: 'Active' },
      },
      visuals: {
        ...s.visuals,
        placement_b_01: { placementId: 'placement_b_01', color: '#06b6d4', showDome: true, showSweep: false },
      },
    }));

    // Register Run A on Plan A (2 radars) and Run B on Plan B (1 radar)
    const handleA = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_ID, initialStatus: 'running' });
    store.initSimulationClock(handleA);
    store.initSimulationTimeline(handleA);
    store.startSimulationClock(handleA);

    const handleB = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_B_ID, initialStatus: 'running' });
    store.initSimulationClock(handleB);
    store.initSimulationTimeline(handleB);
    store.startSimulationClock(handleB);

    // Step Run A: 1000ms
    store.stepSimulationWithRadarEvaluation(handleA, { elapsedRealMs: 1000 });

    const stateMid = useTacticalStore.getState();
    expect(stateMid.simulationClocks[handleA.runId].simTimeNs).toBe(1_000_000_000);
    expect(stateMid.simulationTimelines[handleA.runId].events.length).toBe(1);
    // Run B remains completely unstepped
    expect(stateMid.simulationClocks[handleB.runId].simTimeNs).toBe(0);
    expect(stateMid.simulationTimelines[handleB.runId].events.length).toBe(0);

    // Step Run B: 2000ms
    store.stepSimulationWithRadarEvaluation(handleB, { elapsedRealMs: 2000 });

    const stateFinal = useTacticalStore.getState();
    expect(stateFinal.simulationClocks[handleB.runId].simTimeNs).toBe(2_000_000_000);
    expect(stateFinal.simulationTimelines[handleB.runId].events.length).toBe(1);

    // Run A's timeline evaluated 2 radars
    const pA = stateFinal.simulationTimelines[handleA.runId].events[0].payload as unknown as RadarSurveillanceEvaluationPayload;
    expect(pA.radarCount).toBe(2);

    // Run B's timeline evaluated only 1 radar (Plan B)
    const pB = stateFinal.simulationTimelines[handleB.runId].events[0].payload as unknown as RadarSurveillanceEvaluationPayload;
    expect(pB.radarCount).toBe(1);
    expect(pB.evaluatedRadars[0].placementId).toBe('placement_b_01');
  });

  it('Gate 9 & 10: Audit, revision, and persistence neutrality; UI panel toggles', () => {
    const store = useTacticalStore.getState();
    const initialPlanRev = store.plans[PLAN_ID].revisionNumber ?? 1;
    const initialAuditCount = store.auditEventOrder.length;

    const handle = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_ID, initialStatus: 'running' });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000 });

    const stateAfterStep = useTacticalStore.getState();

    // Revisions, audits, and plan data remain untouched
    expect(stateAfterStep.plans[PLAN_ID].revisionNumber ?? 1).toBe(initialPlanRev);
    expect(stateAfterStep.auditEventOrder.length).toBe(initialAuditCount);

    // V2 Export serialization does NOT leak runtime session clocks or timelines
    const pkg = store.exportCanonicalPackageV2('Test Export');
    expect((pkg as any).simulationClocks).toBeUndefined();
    expect((pkg as any).simulationTimelines).toBeUndefined();

    // UI state toggle
    expect(stateAfterStep.showSimulationPanel).toBe(false);
    store.toggleSimulationPanel();
    expect(useTacticalStore.getState().showSimulationPanel).toBe(true);
    store.setShowSimulationPanel(false);
    expect(useTacticalStore.getState().showSimulationPanel).toBe(false);
  });

  it('Blocker B1 Regression: Prevents stale domain evaluation when reentrant activity replaces workspace or modifies store during input preparation or evaluation', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // Initial state check
    const initialSimTimeNs = useTacticalStore.getState().simulationClocks[handle.runId].simTimeNs;
    const initialEventCount = useTacticalStore.getState().simulationTimelines[handle.runId].events.length;
    expect(initialSimTimeNs).toBe(0);
    expect(initialEventCount).toBe(0);

    // Case 1: Caller passes input with getter that replaces workspace via import during materialization
    const maliciousInputWorkspaceReplace = {
      elapsedRealMs: 1000,
      get targetAltitudeM() {
        const currentStore = useTacticalStore.getState();
        const pkg = currentStore.exportCanonicalPackageV2('Package Before Reentrant Import');
        currentStore.importCanonicalPackage(pkg);
        return 1000;
      },
    };

    expect(() =>
      store.stepSimulationWithRadarEvaluation(handle, maliciousInputWorkspaceReplace)
    ).toThrow(/Store state or workspace generation was modified during input preparation/);

    // Case 2: Re-register on fresh store, getter modifies canonical placements without import
    const freshHandle = useTacticalStore.getState().registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    useTacticalStore.getState().initSimulationClock(freshHandle);
    useTacticalStore.getState().initSimulationTimeline(freshHandle);
    useTacticalStore.getState().startSimulationClock(freshHandle);

    const maliciousInputStoreMutate = {
      elapsedRealMs: 500,
      get targetAltitudeM() {
        useTacticalStore.setState((s) => ({
          ...s,
          placements: {
            ...s.placements,
            hacked_placement: {
              id: 'hacked_placement',
              planId: PLAN_ID,
              definitionId: mockRadarDef1.id,
              position: { lat: 10, lon: 10, altM: 0, aglM: 10 },
              network: {},
            },
          },
        }));
        return 500;
      },
    };

    expect(() =>
      useTacticalStore.getState().stepSimulationWithRadarEvaluation(freshHandle, maliciousInputStoreMutate)
    ).toThrow(/Store state or workspace generation was modified during input preparation/);

    // Confirm that clock was NOT advanced and no event was committed to timeline
    const freshState = useTacticalStore.getState();
    expect(freshState.simulationClocks[freshHandle.runId].simTimeNs).toBe(0);
    expect(freshState.simulationTimelines[freshHandle.runId].events.length).toBe(0);
  });

  it('Blocker B2 Regression: UI-selected Run strictly binds to active Plan and Scenario upon Plan switching', () => {
    const store = useTacticalStore.getState();
    const PLAN_B_ID = 'plan_vs_02';
    const SCENARIO_2_ID = 'scen_vs_02';
    const PLAN_SCEN_2_ID = 'plan_scen_02';

    useTacticalStore.setState((s) => ({
      ...s,
      scenarios: {
        ...s.scenarios,
        [SCENARIO_2_ID]: {
          id: SCENARIO_2_ID,
          name: 'Kịch bản 2',
          status: 'active',
          terrainVersion: 'v1',
          createdAt: 2000,
        },
      },
      plans: {
        ...s.plans,
        [PLAN_B_ID]: {
          id: PLAN_B_ID,
          scenarioId: SCENARIO_ID,
          version: 1,
          name: 'Phương án B',
          status: 'approved',
        },
        [PLAN_SCEN_2_ID]: {
          id: PLAN_SCEN_2_ID,
          scenarioId: SCENARIO_2_ID,
          version: 1,
          name: 'Phương án Kịch bản 2',
          status: 'approved',
        },
      },
    }));

    // Register 2 runs for Plan A (Scenario 1)
    const runA1 = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_ID, initialStatus: 'running' });
    const runA2 = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_ID, initialStatus: 'running' });

    // Register 2 runs for Plan B (Scenario 1)
    const runB1 = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_B_ID, initialStatus: 'running' });
    const runB2 = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_B_ID, initialStatus: 'running' });

    // Register 1 run for Scenario 2 (Plan SCEN 2)
    const runScen2 = store.registerSimulationRun({ scenarioId: SCENARIO_2_ID, planId: PLAN_SCEN_2_ID, initialStatus: 'running' });

    const runs = useTacticalStore.getState().simulationRuns;

    // 1. Resolve runs for active Plan A and Scenario 1
    const planARuns = resolvePlanRuns(runs, PLAN_ID, SCENARIO_ID);
    expect(planARuns.map((r) => r.id)).toEqual([runA1.runId, runA2.runId]);

    // 2. Explicit selection of Run A1 within Plan A
    const currentRunA1 = resolveActiveSimulationRun(runA1.runId, planARuns);
    expect(currentRunA1?.id).toBe(runA1.runId);

    // 3. User switches to Plan B: previous selection 'runA1' MUST NOT resolve to Plan A's run!
    const planBRuns = resolvePlanRuns(runs, PLAN_B_ID, SCENARIO_ID);
    expect(planBRuns.map((r) => r.id)).toEqual([runB1.runId, runB2.runId]);

    const resolvedAfterPlanSwitch = resolveActiveSimulationRun(runA1.runId, planBRuns);
    // Falls back to latest eligible run of Plan B (runB2), NEVER runA1
    expect(resolvedAfterPlanSwitch?.id).toBe(runB2.runId);
    expect(resolvedAfterPlanSwitch?.planId).toBe(PLAN_B_ID);

    // 4. Explicit selection within Plan B is preserved
    const explicitB1 = resolveActiveSimulationRun(runB1.runId, planBRuns);
    expect(explicitB1?.id).toBe(runB1.runId);

    // 5. Switching to a Plan with no runs falls back to null (no-run state)
    const emptyPlanRuns = resolvePlanRuns(runs, 'plan_empty', SCENARIO_ID);
    const resolvedEmpty = resolveActiveSimulationRun(runA1.runId, emptyPlanRuns);
    expect(resolvedEmpty).toBeNull();

    // 6. Runs from other scenarios are never leaked
    const scen2Runs = resolvePlanRuns(runs, PLAN_SCEN_2_ID, SCENARIO_2_ID);
    expect(scen2Runs.map((r) => r.id)).toEqual([runScen2.runId]);
  });

  it('Blocker B3 Regression: Rejects cross-plan EquipmentDefinition reference and prevents partial commit', () => {
    const store = useTacticalStore.getState();
    const OTHER_PLAN_ID = 'other_plan_owner';

    const foreignDef: EquipmentDefinition = {
      id: 'def_foreign_plan',
      planId: OTHER_PLAN_ID,
      templateId: 'tmpl_foreign',
      category: 'RadarCanhGioi',
      name: 'Radar from Foreign Plan',
      rangeKm: 200,
      scanSpeed: 6,
      minElevationDeg: 0.5,
      maxElevationDeg: 45,
      coverageHeightKm: 20,
      capabilities: {},
    };

    const crossPlanPlacement: EquipmentPlacement = {
      id: 'placement_cross_plan',
      planId: PLAN_ID,
      definitionId: foreignDef.id,
      position: { lat: 21.0, lon: 105.8, altM: 10, aglM: 15 },
      network: {},
    };

    useTacticalStore.setState((s) => ({
      ...s,
      definitions: {
        ...s.definitions,
        [foreignDef.id]: foreignDef,
      },
      placements: {
        ...s.placements,
        [crossPlanPlacement.id]: crossPlanPlacement,
      },
      observations: {
        ...s.observations,
        [crossPlanPlacement.id]: { placementId: crossPlanPlacement.id, status: 'Active' },
      },
      visuals: {
        ...s.visuals,
        [crossPlanPlacement.id]: { placementId: crossPlanPlacement.id, color: '#06b6d4', showDome: true, showSweep: false },
      },
    }));

    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // Stepping simulation with cross-plan definition reference MUST throw before any commit
    expect(() =>
      store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000 })
    ).toThrow(/Cross-plan ownership mismatch! Placement "placement_cross_plan" belongs to plan "plan_vs_01", but references definition "def_foreign_plan" owned by plan "other_plan_owner"/);

    // Verify zero partial commit: clock unchanged, timeline unchanged
    const state = useTacticalStore.getState();
    expect(state.simulationClocks[handle.runId].simTimeNs).toBe(0);
    expect(state.simulationTimelines[handle.runId].events.length).toBe(0);
  });

  it('Blocker B4 Regression: Materializes execution handle exactly once and prevents alternating handle from cross-committing between runs', () => {
    const store = useTacticalStore.getState();

    // 1. Setup Plan B with its own definition and placement
    const PLAN_B_ID = 'plan_vs_b4_02';
    const mockRadarDefB: EquipmentDefinition = {
      id: 'def_b4_b_01',
      planId: PLAN_B_ID,
      templateId: 'tmpl_kolchuga',
      category: 'RadarCanhGioi',
      name: 'Radar Plan B Station',
      rangeKm: 250,
      scanSpeed: 0,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 25,
      capabilities: {},
    };

    useTacticalStore.setState((s) => ({
      ...s,
      plans: {
        ...s.plans,
        [PLAN_B_ID]: {
          id: PLAN_B_ID,
          scenarioId: SCENARIO_ID,
          version: 1,
          name: 'Phương án B4 B',
          status: 'approved',
        },
      },
      definitions: {
        ...s.definitions,
        [mockRadarDefB.id]: mockRadarDefB,
      },
      placements: {
        ...s.placements,
        placement_b4_b_01: {
          id: 'placement_b4_b_01',
          planId: PLAN_B_ID,
          definitionId: mockRadarDefB.id,
          position: { lat: 16.0, lon: 108.0, altM: 50, aglM: 30 },
          network: {},
        },
      },
      observations: {
        ...s.observations,
        placement_b4_b_01: { placementId: 'placement_b4_b_01', status: 'Active' },
      },
      visuals: {
        ...s.visuals,
        placement_b4_b_01: { placementId: 'placement_b4_b_01', color: '#06b6d4', showDome: true, showSweep: false },
      },
    }));

    // 2. Register two legitimate running executions, A and B, with matching clock/timeline sessions
    const handleA = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_ID, initialStatus: 'running' });
    store.initSimulationClock(handleA);
    store.initSimulationTimeline(handleA);
    store.startSimulationClock(handleA);

    const handleB = store.registerSimulationRun({ scenarioId: SCENARIO_ID, planId: PLAN_B_ID, initialStatus: 'running' });
    store.initSimulationClock(handleB);
    store.initSimulationTimeline(handleB);
    store.startSimulationClock(handleB);

    // Initial state check for both executions
    expect(useTacticalStore.getState().simulationClocks[handleA.runId].simTimeNs).toBe(0);
    expect(useTacticalStore.getState().simulationTimelines[handleA.runId].events.length).toBe(0);
    expect(useTacticalStore.getState().simulationClocks[handleB.runId].simTimeNs).toBe(0);
    expect(useTacticalStore.getState().simulationTimelines[handleB.runId].events.length).toBe(0);

    // 3. Create an adversarial handle whose runId getter alternates between Run A and Run B,
    // but carries valid runToken and importGen for Run B
    let readCount = 0;
    const alternatingHandle = {
      get runId() {
        readCount++;
        return readCount % 2 === 1 ? handleA.runId : handleB.runId;
      },
      runToken: handleB.runToken,
      importGen: handleB.importGen,
    };

    // 4. Stepping with this alternating handle MUST NOT evaluate A and commit into B.
    // Because runId is materialized exactly once (returns handleA.runId), safeRunIdOrHandle receives handleA.runId
    // combined with handleB.runToken, which the Runner rejects due to token mismatch for Run A.
    expect(() =>
      store.stepSimulationWithRadarEvaluation(alternatingHandle as any, { elapsedRealMs: 1000 })
    ).toThrow(/Invalid or missing execution incarnation token/);

    // 5. Verify final clock and timeline states for BOTH executions: zero partial commit
    const stateAfterAdversarial = useTacticalStore.getState();
    expect(stateAfterAdversarial.simulationClocks[handleA.runId].simTimeNs).toBe(0);
    expect(stateAfterAdversarial.simulationTimelines[handleA.runId].events.length).toBe(0);
    expect(stateAfterAdversarial.simulationClocks[handleB.runId].simTimeNs).toBe(0);
    expect(stateAfterAdversarial.simulationTimelines[handleB.runId].events.length).toBe(0);

    // 6. Confirm that legitimate handle B steps Run B only, evaluating Plan B (1 radar)
    store.stepSimulationWithRadarEvaluation(handleB, { elapsedRealMs: 1000 });

    const stateFinal = useTacticalStore.getState();
    // Run A remains untouched
    expect(stateFinal.simulationClocks[handleA.runId].simTimeNs).toBe(0);
    expect(stateFinal.simulationTimelines[handleA.runId].events.length).toBe(0);
    // Run B advanced cleanly
    expect(stateFinal.simulationClocks[handleB.runId].simTimeNs).toBe(1_000_000_000);
    expect(stateFinal.simulationTimelines[handleB.runId].events.length).toBe(1);
    const pB = stateFinal.simulationTimelines[handleB.runId].events[0].payload as unknown as RadarSurveillanceEvaluationPayload;
    expect(pB.radarCount).toBe(1);
    expect(pB.planId).toBe(PLAN_B_ID);
  });

  it('Gate G7 & G12: Workspace import invalidation and fresh execution re-initialization', () => {
    const store = useTacticalStore.getState();

    // 1. Create and start a pre-import execution
    const preImportHandle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(preImportHandle);
    store.initSimulationTimeline(preImportHandle);
    store.startSimulationClock(preImportHandle);

    const initialGen = store.lastImportGen ?? 0;
    expect(preImportHandle.importGen ?? 0).toBe(initialGen);

    // 2. Perform workspace import while execution is active
    const pkg = store.exportCanonicalPackageV2('Backup for Import Invalidation');
    store.importCanonicalPackage(pkg);

    const statePostImport = useTacticalStore.getState();
    const newGen = statePostImport.lastImportGen ?? 0;
    expect(newGen).toBeGreaterThan(initialGen);

    // Clocks and timelines are invalidated/cleared from runtime state
    expect(statePostImport.simulationClocks[preImportHandle.runId]).toBeUndefined();
    expect(statePostImport.simulationTimelines[preImportHandle.runId]).toBeUndefined();

    // Stale pre-import handle MUST be rejected
    expect(() =>
      statePostImport.stepSimulationWithRadarEvaluation(preImportHandle, { elapsedRealMs: 1000 })
    ).toThrow(/Workspace was replaced by import after registration/);

    // 3. User can cleanly initialize a fresh, valid execution for the active Plan
    const freshHandle = statePostImport.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    expect(freshHandle.importGen).toBe(newGen);

    statePostImport.initSimulationClock(freshHandle);
    statePostImport.initSimulationTimeline(freshHandle);
    statePostImport.startSimulationClock(freshHandle);

    // Fresh execution steps and records domain evaluation cleanly
    const stepResult = statePostImport.stepSimulationWithRadarEvaluation(freshHandle, { elapsedRealMs: 1000 });
    expect(stepResult.clock.simTimeNs).toBe(1_000_000_000);
    expect(stepResult.events.length).toBe(1);
    expect(stepResult.events[0].eventType).toBe(RADAR_SURVEILLANCE_EVENT_TYPE);
  });

  it('Gate G8: Source changes invalidate Run freshness and prevent step with zero partial commit', () => {
    const store = useTacticalStore.getState();

    // 1. Register and start an initial fresh execution
    const handle = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handle);
    store.initSimulationTimeline(handle);
    store.startSimulationClock(handle);

    // Initial state: run is fresh
    expect(useTacticalStore.getState().simulationRuns[handle.runId].status).toBe('running');
    expect(useTacticalStore.getState().simulationClocks[handle.runId].simTimeNs).toBe(0);
    expect(useTacticalStore.getState().simulationTimelines[handle.runId].events.length).toBe(0);

    // 2. Modify canonical source placement (change mast height from 15m to 40m)
    useTacticalStore.setState((s) => ({
      ...s,
      placements: {
        ...s.placements,
        [mockPlacement1.id]: {
          ...s.placements[mockPlacement1.id],
          position: {
            ...s.placements[mockPlacement1.id].position,
            aglM: 40,
          },
        },
      },
    }));

    // 3. Step execution MUST be rejected because plan input fingerprint no longer matches
    expect(() =>
      store.stepSimulationWithRadarEvaluation(handle, { elapsedRealMs: 1000 })
    ).toThrow(/Run is not fresh \(stale or unverified provenance\)/);

    // 4. Verify zero partial commit: clock unchanged at 0 ns, timeline has 0 events
    const stateAfterStaleStep = useTacticalStore.getState();
    expect(stateAfterStaleStep.simulationClocks[handle.runId].simTimeNs).toBe(0);
    expect(stateAfterStaleStep.simulationTimelines[handle.runId].events.length).toBe(0);
  });

  it('Checkpoint 2C.6 Fix Round 1: UI freshness derivation reacts immediately to canonical placement changes', () => {
    const store = useTacticalStore.getState();

    // 1. Register an initial SimulationRun for active Plan
    const handleA = store.registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    store.initSimulationClock(handleA);
    store.initSimulationTimeline(handleA);
    store.startSimulationClock(handleA);

    const runA = useTacticalStore.getState().simulationRuns[handleA.runId];
    expect(runA).toBeDefined();

    // 2. Initial derivation is fresh (true)
    const initialFreshness = deriveSimulationRunFreshness(useTacticalStore.getState(), runA);
    expect(initialFreshness).toBe(true);

    // 3. Set up a Zustand subscription mimicking the reactive UI selector
    let reportedFreshness: boolean = initialFreshness;
    let subscriptionCallCount = 0;
    const unsubscribe = useTacticalStore.subscribe((state) => {
      subscriptionCallCount++;
      reportedFreshness = deriveSimulationRunFreshness(state, runA);
    });

    // Capture references to prove memo dependency failure mode
    const preMutationPlan = useTacticalStore.getState().plans[PLAN_ID];
    const preMutationRun = useTacticalStore.getState().simulationRuns[handleA.runId];
    const preMutationGen = useTacticalStore.getState().lastImportGen ?? 0;

    // 4. Update canonical placement coordinates (lat moved)
    useTacticalStore.setState((s) => ({
      ...s,
      placements: {
        ...s.placements,
        [mockPlacement1.id]: {
          ...s.placements[mockPlacement1.id],
          position: {
            ...s.placements[mockPlacement1.id].position,
            lat: 21.0500,
          },
        },
      },
    }));

    // 5. Verify the subscription immediately reacted and derived stale (false)
    expect(subscriptionCallCount).toBeGreaterThan(0);
    expect(reportedFreshness).toBe(false);
    expect(deriveSimulationRunFreshness(useTacticalStore.getState(), runA)).toBe(false);

    // 6. Demonstrate that prior useMemo dependencies ([currentRun, currentGen, activePlan]) were blind to placement updates:
    // Notice that runA, plan, and importGen object references were NOT changed by placement mutation!
    expect(useTacticalStore.getState().simulationRuns[handleA.runId]).toBe(preMutationRun);
    expect(useTacticalStore.getState().plans[PLAN_ID]).toBe(preMutationPlan);
    expect((useTacticalStore.getState().lastImportGen ?? 0)).toBe(preMutationGen);

    // 7. Verify step execution is rejected on stale run
    expect(() =>
      store.stepSimulationWithRadarEvaluation(handleA, { elapsedRealMs: 1000 })
    ).toThrow(/Run is not fresh \(stale or unverified provenance\)/);

    // 8. User can cleanly initialize a new valid Run B for the updated state
    const handleB = useTacticalStore.getState().registerSimulationRun({
      scenarioId: SCENARIO_ID,
      planId: PLAN_ID,
      initialStatus: 'running',
    });
    useTacticalStore.getState().initSimulationClock(handleB);
    useTacticalStore.getState().initSimulationTimeline(handleB);
    useTacticalStore.getState().startSimulationClock(handleB);

    const runB = useTacticalStore.getState().simulationRuns[handleB.runId];
    expect(runB).toBeDefined();

    // 9. Run B is fresh; Run A remains stale (Run A/B selectivity preserved)
    expect(deriveSimulationRunFreshness(useTacticalStore.getState(), runB)).toBe(true);
    expect(deriveSimulationRunFreshness(useTacticalStore.getState(), runA)).toBe(false);

    // 10. Fresh Run B steps successfully with zero errors
    const stepB = useTacticalStore.getState().stepSimulationWithRadarEvaluation(handleB, { elapsedRealMs: 1000 });
    expect(stepB.clock.simTimeNs).toBe(1_000_000_000);
    expect(stepB.events.length).toBe(1);

    unsubscribe();
  });
});
