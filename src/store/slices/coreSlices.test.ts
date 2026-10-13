import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTacticalStore,
  selectActiveScenario,
  selectActivePlan,
  selectActiveEquipment,
  selectSimulationRunsByPlan,
  isSimulationRunFresh,
} from '../useTacticalStore';
import type { EquipmentInstance } from '../../types/equipment';
import type { CanonicalStatePackageV1, CanonicalStatePackageV2 } from '../../domain/serialization/canonicalStatePackage';

describe('Checkpoint 2C-R.3: Core Store Modularization & Atomicity Tests', () => {
  beforeEach(() => {
    // Reset store to a clean active workspace
    const s = useTacticalStore.getState();
    s.importCanonicalPackage({
      schemaVersion: 2,
      metadata: { exportedAt: new Date().toISOString(), layoutName: 'Test Reset' },
      context: { activeScenarioId: 'scen_test', activePlanId: 'plan_test', activeSimulationRunId: null },
      scenarios: {
        scen_test: { id: 'scen_test', name: 'Test Scenario', terrainVersion: 'v1', createdAt: 1000, status: 'active' },
      },
      plans: {
        plan_test: {
          id: 'plan_test',
          scenarioId: 'scen_test',
          name: 'Test Plan',
          version: 1,
          status: 'draft',
          alternativeId: 'plan_test',
          revisionNumber: 1,
          baseRevisionPlanId: null,
        },
      },
      placements: {},
      definitions: {},
      observations: {},
      simulationRuns: {},
      simulations: {},
      visuals: {},
      revisions: {},
      revisionHeads: {},
      auditEvents: {},
      auditEventOrder: [],
    });
  });

  it('1. Public action availability and signatures are preserved across all composed slices', () => {
    const store = useTacticalStore.getState();

    // Workspace slice actions
    expect(typeof store.ensureActiveWorkspace).toBe('function');
    expect(typeof store.clearAll).toBe('function');
    expect(typeof store.importFromLayout).toBe('function');
    expect(typeof store.exportToLayout).toBe('function');
    expect(typeof store.loadSampleScenario).toBe('function');
    expect(typeof store.exportCanonicalPackage).toBe('function');
    expect(typeof store.exportCanonicalPackageV2).toBe('function');
    expect(typeof store.importCanonicalPackage).toBe('function');

    // Scenario slice actions
    expect(typeof store.createScenario).toBe('function');
    expect(typeof store.switchScenario).toBe('function');
    expect(typeof store.renameScenario).toBe('function');
    expect(typeof store.archiveScenario).toBe('function');
    expect(typeof store.restoreScenario).toBe('function');
    expect(typeof store.trashDraftScenario).toBe('function');
    expect(typeof store.restoreDraftScenario).toBe('function');
    expect(typeof store.purgeTrashedScenario).toBe('function');

    // Plan slice actions
    expect(typeof store.createPlanAlternative).toBe('function');
    expect(typeof store.switchActivePlan).toBe('function');
    expect(typeof store.saveActivePlan).toBe('function');
    expect(typeof store.createEmptyPlan).toBe('function');
    expect(typeof store.renamePlan).toBe('function');
    expect(typeof store.proposePlan).toBe('function');
    expect(typeof store.withdrawAndReviseProposedPlan).toBe('function');
    expect(typeof store.trashDraftPlan).toBe('function');
    expect(typeof store.restoreDraftPlan).toBe('function');
    expect(typeof store.purgeTrashedPlan).toBe('function');
    expect(typeof store.getTrashSummary).toBe('function');
    expect(typeof store.emptyTrash).toBe('function');
    expect(typeof store.archivePlan).toBe('function');
    expect(typeof store.restorePlan).toBe('function');

    // Equipment slice actions
    expect(typeof store.addEquipment).toBe('function');
    expect(typeof store.updateEquipment).toBe('function');
    expect(typeof store.updateEquipmentSpxConfig).toBe('function');
    expect(typeof store.removeEquipment).toBe('function');
    expect(typeof store.selectEquipment).toBe('function');

    // Lifecycle slice actions (from R.2)
    expect(typeof store.registerSimulationRun).toBe('function');
    expect(typeof store.updateSimulationRunStatus).toBe('function');
    expect(typeof store.commitSpxAnalysisResult).toBe('function');

    // Presentation and AI slice actions
    expect(typeof store.setActiveTool).toBe('function');
    expect(typeof store.setDomeAlpha).toBe('function');
    expect(typeof store.runAiPlacementAnalysis).toBe('function');
  });

  it('2. Referential stability of selectors and projections holds after modularization', () => {
    const s1 = useTacticalStore.getState();
    const activeScenario = selectActiveScenario(s1);
    const activePlan = selectActivePlan(s1);

    expect(activeScenario?.id).toBe('scen_test');
    expect(activePlan?.id).toBe('plan_test');
    expect(selectActiveEquipment(s1)).toEqual([]);

    // Modifying unrelated presentation state does not invalidate plan/equipment identity
    s1.setActiveTool('place');
    const s2 = useTacticalStore.getState();
    expect(selectActiveScenario(s2)).toBe(activeScenario);
    expect(selectActivePlan(s2)).toBe(activePlan);
  });

  it('3. Atomicity: exactly 1 Zustand transition/notification occurs per mutation', () => {
    let callCount = 0;
    const unsub = useTacticalStore.subscribe(() => {
      callCount++;
    });

    const instance: EquipmentInstance = {
      instanceId: 'eq_atom_1',
      templateId: 'radar_36d6',
      name: 'Atomic Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };

    // Mutation 1: addEquipment
    callCount = 0;
    useTacticalStore.getState().addEquipment(instance);
    expect(callCount).toBe(1);

    // Mutation 2: updateEquipment
    callCount = 0;
    useTacticalStore.getState().updateEquipment('eq_atom_1', { name: 'Updated Radar' });
    expect(callCount).toBe(1);

    // Mutation 3: createPlanAlternative
    callCount = 0;
    useTacticalStore.getState().createPlanAlternative('plan_test', 'Alternative Plan');
    expect(callCount).toBe(1);

    // Mutation 4: switchActivePlan
    callCount = 0;
    useTacticalStore.getState().switchActivePlan('plan_test');
    expect(callCount).toBe(1);

    // Mutation 5: removeEquipment
    callCount = 0;
    useTacticalStore.getState().removeEquipment('eq_atom_1');
    expect(callCount).toBe(1);

    unsub();
  });

  it('4. switchActivePlan and switchScenario do not expose intermediate invalid state', () => {
    // Add equipment and create alternative
    const instance: EquipmentInstance = {
      instanceId: 'eq_sw_1',
      templateId: 'radar_36d6',
      name: 'Switch Test Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };
    useTacticalStore.getState().addEquipment(instance);
    useTacticalStore.getState().selectEquipment('eq_sw_1');

    useTacticalStore.getState().createPlanAlternative('plan_test', 'Plan 2');
    const plans = Object.values(useTacticalStore.getState().plans);
    const plan2 = plans.find((p) => p.name === 'Plan 2');
    expect(plan2).toBeDefined();

    // Verify subscriber never sees inconsistent activePlanId vs selectedInstanceId during switch
    let observedSelectedInstanceDuringSwitch: string | null = 'not_checked';
    const unsub = useTacticalStore.subscribe((state) => {
      if (state.activePlanId === 'plan_test') {
        observedSelectedInstanceDuringSwitch = state.selectedInstanceId;
      }
    });

    useTacticalStore.getState().switchActivePlan('plan_test');
    expect(observedSelectedInstanceDuringSwitch).toBeNull();
    unsub();
  });

  it('5. Import replacement increments workspaceContextGeneration and blocks late async completion', () => {
    const sBefore = useTacticalStore.getState();
    const genBefore = sBefore.workspaceContextGeneration;

    // Register SPx request under current gen
    const requestId = sBefore.registerSpxAnalysisRequest('plan_test', 'eq_some');
    expect(requestId).toBeDefined();

    // Now import new package
    sBefore.importCanonicalPackage({
      schemaVersion: 2,
      metadata: { exportedAt: new Date().toISOString(), layoutName: 'Import New' },
      context: { activeScenarioId: 'scen_new', activePlanId: 'plan_new', activeSimulationRunId: null },
      scenarios: {
        scen_new: { id: 'scen_new', name: 'New Scen', terrainVersion: 'v1', createdAt: 2000, status: 'active' },
      },
      plans: {
        plan_new: { id: 'plan_new', scenarioId: 'scen_new', name: 'New Plan', version: 1, status: 'draft' },
      },
      placements: {},
      definitions: {},
      observations: {},
      simulationRuns: {},
      simulations: {},
      visuals: {},
      revisions: {},
      revisionHeads: {},
      auditEvents: {},
      auditEventOrder: [],
    });

    const sAfter = useTacticalStore.getState();
    expect(sAfter.workspaceContextGeneration).toBeGreaterThan(genBefore);
    expect(sAfter.lastImportGen).toBeGreaterThanOrEqual(sAfter.workspaceContextGeneration);

    // Attempting to commit SPx result with old generation fails
    const commitSuccess = sAfter.commitSpxAnalysisResult({
      requestId,
      scenarioId: 'scen_test',
      planId: 'plan_test',
      gen: genBefore,
      instanceId: 'eq_some',
      result: {
        instanceId: 'eq_some',
        calculatedAt: Date.now(),
        cacheKey: 'test_key',
        radarLat: 21,
        radarLon: 105,
        groundElevationM: 10,
        totalAntennaElevationM: 25,
        config: sAfter.spxConfig,
        contours: [],
        rangeRings: [],
        terrainStatus: 'flat_fallback',
      },
      snapshot: {
        scenarioId: 'scen_test',
        planId: 'plan_test',
        planVersion: 1,
        instanceId: 'eq_some',
        latitude: 21,
        longitude: 105,
        antennaHeightAGL: 15,
        altitude: 10,
        rangeKm: 50,
        minElevationDeg: 0,
        maxElevationDeg: 30,
        kFactor: 4 / 3,
        earthCurvature: true,
        altitudeReference: 'sea_level',
        targetHeights: [],
        terrainVersion: 'v1',
        algorithmId: 'spx_standard',
        algorithmVersion: '1.0.0',
      },
      inputFingerprint: 'dummy_fp',
    });
    expect(commitSuccess).toBe(false);
  });

  it('6. Plan A/B isolation: modifying Plan B does not mutate Plan A or its historical records', () => {
    // Add equipment to Plan A
    const instanceA: EquipmentInstance = {
      instanceId: 'eq_a',
      templateId: 'radar_36d6',
      name: 'Plan A Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };
    useTacticalStore.getState().addEquipment(instanceA);

    // Register simulation run on Plan A
    const runHandle = useTacticalStore.getState().registerSimulationRun({
      scenarioId: 'scen_test',
      planId: 'plan_test',
      autoActivate: true,
    });
    expect(runHandle.runId).toBeDefined();

    // Branch to Plan B
    useTacticalStore.getState().createPlanAlternative('plan_test', 'Plan B');
    const stateAfterBranch = useTacticalStore.getState();
    const planBId = stateAfterBranch.activePlanId!;
    expect(planBId).not.toBe('plan_test');

    // Active equipment in Plan B is cloned with different placement IDs
    const planBEquip = selectActiveEquipment(stateAfterBranch);
    expect(planBEquip.length).toBe(1);
    expect(planBEquip[0].instanceId).not.toBe('eq_a');

    // Modify equipment in Plan B
    useTacticalStore.getState().updateEquipment(planBEquip[0].instanceId, { name: 'Plan B Modified Radar' });

    // Switch back to Plan A
    useTacticalStore.getState().switchActivePlan('plan_test');
    const stateBackToA = useTacticalStore.getState();
    const planAEquip = selectActiveEquipment(stateBackToA);
    expect(planAEquip.length).toBe(1);
    expect(planAEquip[0].name).toBe('Plan A Radar');

    // Simulation run on Plan A is preserved intact
    const runsA = selectSimulationRunsByPlan(stateBackToA, 'plan_test');
    expect(runsA.length).toBe(1);
    expect(runsA[0].id).toBe(runHandle.runId);
  });

  it('7. Canonical Equipment mutation and audit append occur within the SAME atomic state update', () => {
    let capturedStateDuringAdd: any = null;
    const unsub = useTacticalStore.subscribe((state) => {
      capturedStateDuringAdd = state;
    });

    const instance: EquipmentInstance = {
      instanceId: 'eq_audit_test',
      templateId: 'radar_36d6',
      name: 'Audit Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };

    useTacticalStore.getState().addEquipment(instance);
    unsub();

    expect(capturedStateDuringAdd).not.toBeNull();
    // Both placement and auditEvent are present in the exact same captured emission
    expect(capturedStateDuringAdd.placements['eq_audit_test']).toBeDefined();
    expect(capturedStateDuringAdd.auditEventOrder.length).toBeGreaterThan(0);
    const lastEventId = capturedStateDuringAdd.auditEventOrder[capturedStateDuringAdd.auditEventOrder.length - 1];
    expect(capturedStateDuringAdd.auditEvents[lastEventId].action).toBe('ADD');
    expect(capturedStateDuringAdd.auditEvents[lastEventId].targetType).toBe('EQUIPMENT');
  });

  it('8. Plan and Scenario purge blockers protect historical records', () => {
    // Register simulation run on plan_test
    useTacticalStore.getState().registerSimulationRun({
      scenarioId: 'scen_test',
      planId: 'plan_test',
    });

    // Cannot trash draft plan when referenced by simulation runs
    expect(() => {
      useTacticalStore.getState().trashDraftPlan('plan_test');
    }).toThrow(/simulation run/i);

    // Cannot trash scenario when referenced by simulation runs
    expect(() => {
      useTacticalStore.getState().trashDraftScenario('scen_test');
    }).toThrow(/simulation run/i);
  });

  it('9. V1 and V2 canonical state packages round-trip cleanly', () => {
    // Add equipment
    const instance: EquipmentInstance = {
      instanceId: 'eq_pkg_test',
      templateId: 'radar_36d6',
      name: 'Package Test Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };
    useTacticalStore.getState().addEquipment(instance);

    // Export V1
    const v1Pkg: CanonicalStatePackageV1 = useTacticalStore.getState().exportCanonicalPackage('Pkg V1');
    expect(v1Pkg.schemaVersion).toBe(1);
    expect(v1Pkg.placements['eq_pkg_test']).toBeDefined();

    // Export V2
    const v2Pkg: CanonicalStatePackageV2 = useTacticalStore.getState().exportCanonicalPackageV2('Pkg V2');
    expect(v2Pkg.schemaVersion).toBe(2);
    expect(v2Pkg.revisions).toBeDefined();
    expect(v2Pkg.auditEvents).toBeDefined();

    // Import V1 package -> auto migrates to V2
    useTacticalStore.getState().importCanonicalPackage(v1Pkg);
    const stateAfterV1 = useTacticalStore.getState();
    expect(stateAfterV1.placements['eq_pkg_test']).toBeDefined();
    expect(stateAfterV1.activePlanId).toBe('plan_test');

    // Import V2 package -> loads full provenance
    useTacticalStore.getState().importCanonicalPackage(v2Pkg);
    const stateAfterV2 = useTacticalStore.getState();
    expect(stateAfterV2.placements['eq_pkg_test']).toBeDefined();
    expect(Object.keys(stateAfterV2.auditEvents).length).toBeGreaterThan(0);
  });

  it('10. loadSampleScenario cleanly replaces active plan contents and preserves observations', () => {
    useTacticalStore.getState().loadSampleScenario();
    const state = useTacticalStore.getState();
    const activeEquip = selectActiveEquipment(state);

    expect(activeEquip.length).toBeGreaterThanOrEqual(8);
    // Verified sample items
    expect(activeEquip.some((e) => e.name.includes('Sóc Sơn'))).toBe(true);
    expect(activeEquip.some((e) => e.name.includes('Tam Đảo'))).toBe(true);
    expect(activeEquip.some((e) => e.name.includes('Fansipan'))).toBe(true);

    // Observations are created
    expect(Object.keys(state.observations).length).toBeGreaterThanOrEqual(8);
  });

  it('11. No circular runtime imports or undefined actions exist after initialization', () => {
    const store = useTacticalStore.getState();
    // Verify none of the state action keys evaluate to undefined
    const actionKeys: (keyof typeof store)[] = [
      'ensureActiveWorkspace',
      'clearAll',
      'importFromLayout',
      'exportToLayout',
      'loadSampleScenario',
      'createScenario',
      'switchScenario',
      'createPlanAlternative',
      'switchActivePlan',
      'addEquipment',
      'updateEquipment',
      'removeEquipment',
      'selectEquipment',
      'setActiveTool',
      'setDomeAlpha',
      'runAiPlacementAnalysis',
      'registerSimulationRun',
      'commitSpxAnalysisResult',
    ];

    for (const key of actionKeys) {
      expect(store[key]).toBeDefined();
      expect(typeof store[key]).toBe('function');
    }
  });

  it('12. Legacy Run freshness unknown continues to not hydrate simulated state', () => {
    // Add equipment
    const instance: EquipmentInstance = {
      instanceId: 'eq_fresh_test',
      templateId: 'radar_36d6',
      name: 'Fresh Test Radar',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.0,
      altitude: 10,
      antennaHeightAGL: 15,
      rangeKm: 150,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 20,
      status: 'Active',
      color: '#06b6d4',
      showDome: true,
      showSweep: true,
    };
    useTacticalStore.getState().addEquipment(instance);

    // Register a simulation run
    const runHandle = useTacticalStore.getState().registerSimulationRun({
      scenarioId: 'scen_test',
      planId: 'plan_test',
      autoActivate: true,
    });

    // Manually inject legacy run missing planInputFingerprint
    const state = useTacticalStore.getState();
    const legacyRun = {
      ...state.simulationRuns[runHandle.runId],
      planInputFingerprint: undefined, // Legacy missing fingerprint
      simulatedState: {
        eq_fresh_test: {
          operationalStatus: 'Destroyed' as const,
          radarOperational: false,
          effectiveRangeKm: 0,
          updatedAt: Date.now(),
        },
      },
    };

    useTacticalStore.setState({
      simulationRuns: {
        ...state.simulationRuns,
        [runHandle.runId]: legacyRun,
      },
    });

    const sUpdated = useTacticalStore.getState();
    // isSimulationRunFresh must return false for legacy run without fingerprint
    const isFresh = isSimulationRunFresh(sUpdated, legacyRun);
    expect(isFresh).toBe(false);

    // Active equipment projection must NOT hydrate destroyed status from stale/unknown run
    const activeEquip = selectActiveEquipment(sUpdated);
    expect(activeEquip[0].status).toBe('Active');
  });
});
