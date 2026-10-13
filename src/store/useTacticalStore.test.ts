import { test, expect, describe, beforeEach } from 'vitest';
import {
  useTacticalStore,
  validatePlanGraph,
  selectActiveEquipment,
  selectActivePlan,
  selectActivePlacements,
  selectEquipmentById,
  selectDefinitionForPlacement,
  selectObservationForPlacement,
  selectVisualForPlacement,
  selectSimulationRunById,
  selectSimulationRunsByPlan,
  selectSimulationRunsByScenario,
  selectActiveSimulationRun,
  isSimulationRunFresh,
  evaluateSimulationRunFreshness,
  computePlanInputFingerprint,
  isPlanEligibleForPurge,
} from './useTacticalStore';
import { computeWorkspacePayload, computeHash } from '../domain/audit/auditEngine';

test('1C Store Constraints - Extended', () => {
  console.log('Running useTacticalStore tests...');

  // Clear state for clean run
  useTacticalStore.setState({
    scenarios: {},
    plans: {},
    placements: {},
    definitions: {},
    observations: {},
    visuals: {},
    activeScenarioId: null,
    activePlanId: null,
    canonicalInitialized: false
  });


  // Test 1: Bootstrap with existing Scenario + missing Plan
  useTacticalStore.setState({
    scenarios: {
      'scen-1': { id: 'scen-1', name: 'Scen 1', terrainVersion: 'v1', createdAt: Date.now(), status: 'active' }
    },
    activeScenarioId: 'scen-1',
    activePlanId: null
  });

  useTacticalStore.getState().ensureActiveWorkspace();
  let state = useTacticalStore.getState();
  expect(state.activePlanId).toBe('plan_scen-1_default');
  expect(state.plans['plan_scen-1_default']).toBeDefined();

  // Test 2: Definition ownership inference
  useTacticalStore.setState({
    placements: {
      'p-1': { id: 'p-1', definitionId: 'd-1', planId: 'plan_scen-1_default', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    },
    definitions: {
      'd-1': { id: 'd-1', planId: 'unowned' as any, templateId: 'tpl-1', category: 'RadarCanhGioi', name: 'T1' } as any,
      'd-orphan': { id: 'd-orphan', planId: 'unowned' as any, templateId: 'tpl-1', category: 'RadarCanhGioi', name: 'T1' } as any,
      'd-conflict': { id: 'd-conflict', planId: 'unowned' as any, templateId: 'tpl-1', category: 'RadarCanhGioi', name: 'T1' } as any
    },
    plans: {
      ...state.plans,
      'plan-other': { id: 'plan-other', scenarioId: 'scen-1', version: 1, name: 'Other', status: 'draft' }
    }
  });

  // Successful inference
  useTacticalStore.setState((s) => ({
    definitions: {
      'd-1': { ...s.definitions['d-1'], planId: 'unowned' as any }
    }
  }));
  useTacticalStore.getState().ensureActiveWorkspace();
  expect(useTacticalStore.getState().definitions['d-1'].planId).toBe('plan_scen-1_default');

  // Orphan definition throws
  useTacticalStore.setState((s) => ({
    definitions: {
      'd-orphan': { ...s.definitions['d-orphan'], planId: 'unowned' as any }
    }
  }));
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/Orphan definition/);

  // Conflict definition throws
  useTacticalStore.setState((s) => ({
    placements: {
      'p-1': { ...s.placements['p-1'], definitionId: 'd-conflict' },
      'p-2': { id: 'p-2', definitionId: 'd-conflict', planId: 'plan-other', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    },
    definitions: {
      'd-conflict': { ...s.definitions['d-conflict'], planId: 'unowned' as any }
    }
  }));
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/conflicting plans/);

  // Clean up state for next tests
  useTacticalStore.setState({
    scenarios: {
      'default-scenario': { id: 'default-scenario', name: 'Default', terrainVersion: 'v1', createdAt: Date.now(), status: 'active' }
    },
    plans: {
      'default-plan': { id: 'default-plan', scenarioId: 'default-scenario', version: 1, name: 'Default Plan', status: 'draft' }
    },
    activeScenarioId: 'default-scenario',
    activePlanId: 'default-plan',
    placements: {},
    definitions: {},
    observations: {},
    visuals: {}
  });

  state = useTacticalStore.getState();

  // Test 3: Clone network reference remapping
  useTacticalStore.setState({
    placements: {
      'p-cmd': { id: 'p-cmd', definitionId: 'd-cmd', planId: 'default-plan', network: {}, position: { lat: 0, lon: 0, altM: 0, aglM: 0 } } as any,
      'p-radar': { id: 'p-radar', definitionId: 'd-radar', planId: 'default-plan', network: { commandedBy: 'p-cmd' }, position: { lat: 0, lon: 0, altM: 0, aglM: 0 } } as any
    },
    definitions: {
      'd-cmd': { id: 'd-cmd', planId: 'default-plan', category: 'SoChiHuy', capabilities: {} } as any,
      'd-radar': { id: 'd-radar', planId: 'default-plan', category: 'RadarCanhGioi', capabilities: {} } as any
    },
    visuals: {
      'p-cmd': {} as any,
      'p-radar': {} as any
    },
    observations: {
      'p-cmd': { status: 'Active' } as any,
      'p-radar': { status: 'Active' } as any
    }
  });

  useTacticalStore.getState().createPlanAlternative();
  state = useTacticalStore.getState();
  const altPlanId = state.activePlanId!;
  const altPlacements = Object.values(state.placements).filter(p => p.planId === altPlanId);
  const altRadar = altPlacements.find(p => state.definitions[p.definitionId].category === 'RadarCanhGioi');
  const altCmd = altPlacements.find(p => state.definitions[p.definitionId].category === 'SoChiHuy');

  expect(altRadar).toBeDefined();
  expect(altCmd).toBeDefined();
  expect(altRadar?.network?.commandedBy).toBe(altCmd?.id);
  expect(altRadar?.network?.commandedBy).not.toBe('p-cmd');

  // Test 4: Repeated loadSampleScenario ID uniqueness
  useTacticalStore.getState().loadSampleScenario();
  state = useTacticalStore.getState();
  const sample1Placements = Object.values(state.placements).filter(p => p.planId === altPlanId);
  const sample1Ids = sample1Placements.map(p => p.id);

  useTacticalStore.getState().loadSampleScenario();
  state = useTacticalStore.getState();
  const sample2Placements = Object.values(state.placements).filter(p => p.planId === altPlanId);
  const sample2Ids = sample2Placements.map(p => p.id);

  for (const id of sample1Ids) {
    expect(sample2Ids).not.toContain(id);
  }

  // Test 5: Clone historical data preservation
  // When cloning, old observation is kept for old placement, new one is fresh.
  const oldRadarObs = state.observations['p-radar'];
  expect(oldRadarObs).toBeDefined(); // Still exists in state
  const altRadarObs = state.observations[altRadar!.id];
  expect(altRadarObs).toBeDefined();
  expect(altRadarObs).not.toBe(oldRadarObs); // Not the same object

  // Test 6: Save orphan validation
  useTacticalStore.setState({
    definitions: {
      ...state.definitions,
      'd-orphan-save': { id: 'd-orphan-save', planId: altPlanId } as any
    }
  });
  expect(() => useTacticalStore.getState().saveActivePlan()).toThrow(/Orphan definition/);

  useTacticalStore.setState({
    definitions: state.definitions // Restore without orphan
  });

  // Valid save does not throw
  expect(() => useTacticalStore.getState().saveActivePlan()).not.toThrow();

  // Test 7: loadSampleScenario network remapping
  // Clear instances first to make finding easy
  useTacticalStore.getState().clearAll();
  useTacticalStore.getState().loadSampleScenario();
  state = useTacticalStore.getState();
  const sampleRadar = selectActiveEquipment(state).find(i => i.templateId === 'radar_36d6');
  const sampleCmd = selectActiveEquipment(state).find(i => i.templateId === 'c2_command_post');
  expect(sampleRadar).toBeDefined();
  expect(sampleCmd).toBeDefined();
  expect(sampleRadar?.commandedByInstanceId).toBe(sampleCmd?.instanceId);
  expect(sampleRadar?.commandedByInstanceId).not.toBe('eq_c2_hanoi');

  // Test 8: importFromLayout network remapping
  useTacticalStore.getState().clearAll();
  useTacticalStore.getState().importFromLayout({
    layoutName: 'test',
    savedAtIso8601: '',
    equipments: [
      { instanceId: 'old-cmd', templateId: 'c2_command_post', latitude: 0, longitude: 0, groundElevationMeters: 0, posX: 0, posY: 0, posZ: 0, antennaHeightAGL: 0, currentRange: 0, currentScanSpeed: 0, currentMinElevation: 0, currentMaxElevation: 0, currentCoverageHeight: 0, status: 0 },
      { instanceId: 'old-radar', templateId: 'radar_nebo_m', commandedByInstanceId: 'old-cmd', latitude: 0, longitude: 0, groundElevationMeters: 0, posX: 0, posY: 0, posZ: 0, antennaHeightAGL: 0, currentRange: 0, currentScanSpeed: 0, currentMinElevation: 0, currentMaxElevation: 0, currentCoverageHeight: 0, status: 0 }
    ]
  });
  state = useTacticalStore.getState();
  const importRadar = selectActiveEquipment(state).find(i => i.templateId === 'radar_nebo_m');
  const importCmd = selectActiveEquipment(state).find(i => i.templateId === 'c2_command_post');
  expect(importRadar).toBeDefined();
  expect(importCmd).toBeDefined();
  expect(importRadar?.commandedByInstanceId).toBe(importCmd?.instanceId);
  expect(importRadar?.commandedByInstanceId).not.toBe('old-cmd');

  // Verify importFromLayout selected first placement belonging to Plan
  expect(state.selectedInstanceId).toBe(importCmd?.instanceId);
  expect(state.placements[state.selectedInstanceId!]).toBeDefined();
  expect(state.placements[state.selectedInstanceId!].planId).toBe(state.activePlanId);

  // Test 9: switch invalid graph rejection and state preservation
  const oldActivePlanId = state.activePlanId;
  const oldInstancesLength = selectActiveEquipment(state).length;
  useTacticalStore.setState({
    plans: {
      ...state.plans,
      'plan-invalid': { id: 'plan-invalid', scenarioId: 'default-scenario', version: 1, name: 'Invalid', status: 'draft' }
    },
    placements: {
      ...state.placements,
      'p-invalid': { id: 'p-invalid', definitionId: 'd-missing', planId: 'plan-invalid', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    }
  });
  expect(() => useTacticalStore.getState().switchActivePlan('plan-invalid')).toThrow();
  expect(useTacticalStore.getState().activePlanId).toBe(oldActivePlanId);
  expect(selectActiveEquipment(useTacticalStore.getState()).length).toBe(oldInstancesLength);

  console.log('All Extended 1C Store Tests passed!');
});

// =========================================================
// REGRESSION TESTS A–L (1C issue list)
// =========================================================

test('A. createPlanAlternative twice -> unique Plan IDs', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-src': { id: 'plan-src', scenarioId: 'scen', version: 1, name: 'Source', status: 'draft' } },
    placements: {
      'p1': { id: 'p1', definitionId: 'd1', planId: 'plan-src', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: { 'd1': { id: 'd1', planId: 'plan-src', category: 'RadarCanhGioi', capabilities: {} } as any },
    observations: { 'p1': { status: 'Active' } as any },
    visuals: { 'p1': {} as any },
    activeScenarioId: 'scen',
    activePlanId: 'plan-src'
  });

  useTacticalStore.getState().createPlanAlternative('plan-src');
  const id1 = useTacticalStore.getState().activePlanId!;
  // Switch back to source to clone again
  useTacticalStore.setState({ activePlanId: 'plan-src' });
  useTacticalStore.getState().createPlanAlternative('plan-src');
  const id2 = useTacticalStore.getState().activePlanId!;

  expect(id1).not.toBe(id2);
  expect(id1).not.toBe('plan-src');
  expect(id2).not.toBe('plan-src');
  const finalState = useTacticalStore.getState();
  expect(finalState.plans[id1]).toBeDefined();
  expect(finalState.plans[id2]).toBeDefined();
  expect(finalState.plans['plan-src']).toBeDefined();
});

test('B. cross-plan network reference -> validatePlanGraph rejects', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' },
      'plan-b': { id: 'plan-b', scenarioId: 'scen', version: 1, name: 'B', status: 'draft' },
    },
    placements: {
      'p-a': { id: 'p-a', definitionId: 'd-a', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      'p-b': { id: 'p-b', definitionId: 'd-b', planId: 'plan-b', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: { commandedBy: 'p-a' } } as any,
    },
    definitions: {
      'd-a': { id: 'd-a', planId: 'plan-a', capabilities: {} } as any,
      'd-b': { id: 'd-b', planId: 'plan-b', capabilities: {} } as any,
    },
    observations: { 'p-a': { status: 'Active' } as any, 'p-b': { status: 'Active' } as any },
    visuals: { 'p-a': {} as any, 'p-b': {} as any },
    activeScenarioId: 'scen',
    activePlanId: 'plan-b'
  });
  // plan-b has p-b.commandedBy = p-a which belongs to plan-a -> cross-plan network ref
  expect(() => validatePlanGraph(useTacticalStore.getState(), 'plan-b')).toThrow(/cross-plan/);
});

test('C. missing planId on Placement -> validatePlanGraph rejects', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {
      'p-no-plan': { id: 'p-no-plan', definitionId: 'd-a', planId: undefined as any, position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: { 'd-a': { id: 'd-a', planId: 'plan-a', capabilities: {} } as any },
    observations: {},
    visuals: {},
    activeScenarioId: 'scen',
    activePlanId: 'plan-a'
  });
  expect(() => validatePlanGraph(useTacticalStore.getState(), 'plan-a')).toThrow();
});

test('D. unowned Placement + cross-plan Definition -> ensureActiveWorkspace rejects', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' },
      'plan-b': { id: 'plan-b', scenarioId: 'scen', version: 1, name: 'B', status: 'draft' },
    },
    placements: {
      'p-unowned': { id: 'p-unowned', definitionId: 'd-owned-by-b', planId: undefined as any, position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {
      // Definition already owned by plan-b
      'd-owned-by-b': { id: 'd-owned-by-b', planId: 'plan-b', capabilities: {} } as any,
    },
    observations: {},
    visuals: {},
    activeScenarioId: 'scen',
    activePlanId: 'plan-a',
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/contradictory ownership/);
});

test('E. unowned Definition referenced by exactly one Plan -> inferred successfully', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {
      'p-a': { id: 'p-a', definitionId: 'd-unowned', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {
      'd-unowned': { id: 'd-unowned', planId: undefined as any, capabilities: {} } as any,
    },
    observations: {},
    visuals: {},
    activeScenarioId: 'scen',
    activePlanId: 'plan-a',
  });
  useTacticalStore.getState().ensureActiveWorkspace();
  expect(useTacticalStore.getState().definitions['d-unowned'].planId).toBe('plan-a');
});

test('F. conflicting Definition ownership (referenced by two Plans) -> rejects', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' },
      'plan-b': { id: 'plan-b', scenarioId: 'scen', version: 1, name: 'B', status: 'draft' },
    },
    placements: {
      'p-a': { id: 'p-a', definitionId: 'd-shared', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      'p-b': { id: 'p-b', definitionId: 'd-shared', planId: 'plan-b', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {
      'd-shared': { id: 'd-shared', planId: undefined as any, capabilities: {} } as any,
    },
    observations: {},
    visuals: {},
    activeScenarioId: 'scen',
    activePlanId: 'plan-a',
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/conflicting plans/);
});

  test('G. canonical-only Definition data is strictly preserved without reverse-sync', () => {
    const canonicalOnlyField = 'extra-canonical-value';
    useTacticalStore.setState({
      scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
      plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
      placements: {
        'p-a': { id: 'p-a', definitionId: 'p-a', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      },
      definitions: {
        'p-a': {
          id: 'p-a', planId: 'plan-a', capabilities: {},
          canonicalOnlyData: canonicalOnlyField,
        } as any,
      },
      observations: { 'p-a': { status: 'Active' } as any },
      visuals: { 'p-a': {} as any },
      activeScenarioId: 'scen',
      activePlanId: 'plan-a',
      canonicalInitialized: false,
    });

    useTacticalStore.getState().updateEquipment('p-a', { latitude: 10 });

    const state = useTacticalStore.getState();
    expect((state.definitions['p-a'] as any).canonicalOnlyData).toBe(canonicalOnlyField);
    expect(state.placements['p-a'].id).toBe('p-a');
    expect(state.definitions['p-a'].id).toBe('p-a');
  });

  test('H. shared Definition safe from cross-plan deletion', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' },
      'plan-b': { id: 'plan-b', scenarioId: 'scen', version: 1, name: 'B', status: 'draft' },
    },
    placements: {
      'p-a': { id: 'p-a', definitionId: 'd-shared', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      'p-b': { id: 'p-b', definitionId: 'd-shared', planId: 'plan-b', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {
      'd-shared': { id: 'd-shared', planId: 'plan-a', capabilities: {} } as any,
    },
    observations: { 'p-a': { status: 'Active' } as any, 'p-b': { status: 'Active' } as any },
    visuals: { 'p-a': {} as any, 'p-b': {} as any },
    activeScenarioId: 'scen',
    activePlanId: 'plan-a',
  });
  // clearAll on plan-a should NOT delete d-shared because plan-b's p-b still references it
  useTacticalStore.getState().clearAll();
  const state = useTacticalStore.getState();
  expect(state.definitions['d-shared']).toBeDefined();
  expect(state.placements['p-b']).toBeDefined();
});

test('I. saveActivePlan validates proposed/approved context without mutation', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-proposed': { id: 'plan-proposed', scenarioId: 'scen', version: 1, name: 'Proposed', status: 'proposed' } },
    placements: {},
    definitions: {},
    observations: {},
    visuals: {},
    activeScenarioId: 'scen',
    activePlanId: 'plan-proposed',
  });
  // proposed Plan should be validatable without throwing 'not draft'
  expect(() => useTacticalStore.getState().saveActivePlan()).not.toThrow();
  // State must NOT be mutated
  expect(useTacticalStore.getState().plans['plan-proposed'].status).toBe('proposed');
});

test('J. failed switch leaves activePlanId + instances[] unchanged', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-good': { id: 'plan-good', scenarioId: 'scen', version: 1, name: 'Good', status: 'draft' },
      'plan-bad': { id: 'plan-bad', scenarioId: 'scen', version: 1, name: 'Bad', status: 'draft' },
    },
    placements: {
      'p-good': { id: 'p-good', definitionId: 'd-good', planId: 'plan-good', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      // plan-bad has broken graph: missing definition
      'p-bad': { id: 'p-bad', definitionId: 'd-missing', planId: 'plan-bad', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: { 'd-good': { id: 'd-good', planId: 'plan-good', capabilities: {} } as any },
    observations: {
      'p-good': { status: 'Active' } as any,
      'p-bad': { status: 'Active' } as any,
    },
    visuals: { 'p-good': {} as any, 'p-bad': {} as any },
    activeScenarioId: 'scen',
    activePlanId: 'plan-good'
  });

  const beforePlanId = useTacticalStore.getState().activePlanId;
  const beforeInstances = selectActiveEquipment(useTacticalStore.getState()).length;

  expect(() => useTacticalStore.getState().switchActivePlan('plan-bad')).toThrow();
  expect(useTacticalStore.getState().activePlanId).toBe(beforePlanId);
  expect(selectActiveEquipment(useTacticalStore.getState()).length).toBe(beforeInstances);
});

test('K. duplicate import source IDs reject atomically', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {},
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  expect(() => useTacticalStore.getState().importFromLayout({
    layoutName: 'test', savedAtIso8601: '',
    equipments: [
      { instanceId: 'dup-1', templateId: 'c2_command_post' } as any,
      { instanceId: 'dup-1', templateId: 'radar_nebo_m' } as any,
    ]
  })).toThrow(/duplicate source instance ID/);
});

test('L. dangling imported commandedBy reference rejects atomically', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {},
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  expect(() => useTacticalStore.getState().importFromLayout({
    layoutName: 'test', savedAtIso8601: '',
    equipments: [
      { instanceId: 'radar-1', templateId: 'radar_nebo_m', commandedByInstanceId: 'missing-cmd' } as any,
    ]
  })).toThrow(/dangling commandedByInstanceId/);
});

test('M. default bootstrap detects default-plan -> wrong-scenario mismatch', () => {
  useTacticalStore.setState({
    scenarios: { 'default-scenario': { id: 'default-scenario', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'default-plan': { id: 'default-plan', scenarioId: 'another-scenario', version: 1, name: 'DP', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {},
    activeScenarioId: null, activePlanId: null
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/belongs to a different scenario/);
});

test('N. loadSampleScenario preserves the original sample dataset semantics', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {},
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  useTacticalStore.getState().loadSampleScenario();
  const state = useTacticalStore.getState();

  // Total sample items should be 9
  expect(selectActiveEquipment(state).length).toBe(9);

  // Check exact data points from original dataset
  const tdao = selectActiveEquipment(state).find(i => i.templateId === 'radar_36d6' && i.shortId === 'R-01');
  expect(tdao).toBeDefined();
  expect(tdao?.altitude).toBe(950);
  expect(tdao?.name).toContain('Tam Đảo');

  const fansipan = selectActiveEquipment(state).find(i => i.templateId === 'radar_kolchuga' && i.shortId === 'ESM-01');
  expect(fansipan).toBeDefined();
  expect(fansipan?.altitude).toBe(3140);

  // Verify selectedInstanceId points to a valid canonical Placement
  expect(state.selectedInstanceId).toBeDefined();
  expect(state.placements[state.selectedInstanceId!]).toBeDefined();
  expect(state.placements[state.selectedInstanceId!].id).toBe(state.selectedInstanceId);
});

test('O. invalid source Plan prevents createPlanAlternative atomically', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {
      'p1': { id: 'p1', definitionId: 'd-missing', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {}, observations: {}, visuals: {},
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  const beforeLen = Object.keys(useTacticalStore.getState().plans).length;
  expect(() => useTacticalStore.getState().createPlanAlternative()).toThrow(/validatePlanGraph/);
  expect(Object.keys(useTacticalStore.getState().plans).length).toBe(beforeLen);
});

test('P. scenario-specific default plan belongs to wrong scenario -> ensureActiveWorkspace throws', () => {
  useTacticalStore.setState({
    scenarios: { 'scen1': { id: 'scen1', name: 'S1', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan_scen1_default': { id: 'plan_scen1_default', scenarioId: 'wrong-scen', version: 1, name: 'DP', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {},
    activeScenarioId: 'scen1', activePlanId: null
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/belongs to a different scenario/);
});

test('Q. orphan Visual with no Placement -> saveActivePlan throws', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {},
    visuals: { 'v-orphan': {} as any },
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  expect(() => useTacticalStore.getState().saveActivePlan()).toThrow(/Orphan visual v-orphan/);
});

test('R. valid Visual belonging to another Plan does not invalidate target Plan', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: {
      'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' },
      'plan-b': { id: 'plan-b', scenarioId: 'scen', version: 1, name: 'B', status: 'draft' }
    },
    placements: {
      'p-b': { id: 'p-b', definitionId: 'd-b', planId: 'plan-b', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {
      'd-b': { id: 'd-b', planId: 'plan-b', category: 'RadarCanhGioi', capabilities: {} } as any
    },
    observations: { 'p-b': { status: 'Active' } as any },
    visuals: { 'p-b': {} as any },
    activeScenarioId: 'scen', activePlanId: 'plan-a' // target is plan-a
  });
  expect(() => useTacticalStore.getState().saveActivePlan()).not.toThrow();
});

test('1D Canonical Read Model Parity Invariants', () => {
  console.log('Running 1D Parity Invariants...');

  useTacticalStore.setState({
    scenarios: { scen1: { id: 'scen1', name: 'Scen 1', createdAt: 0 } as any },
    plans: {
      plan1: { id: 'plan1', scenarioId: 'scen1', name: 'Plan 1', parentPlanId: null, createdAt: 0 } as any,
      plan2: { id: 'plan2', scenarioId: 'scen1', name: 'Plan 2', parentPlanId: null, createdAt: 0 } as any
    },
    placements: {
      p1: { id: 'p1', planId: 'plan1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 30, aglM: 5 }, network: { commandedByInstanceId: null } } as any,
      p2: { id: 'p2', planId: 'plan2', definitionId: 'd2', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      p1_missing_obs: { id: 'p1_missing_obs', planId: 'plan1', definitionId: 'd1', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      p1_missing_vis: { id: 'p1_missing_vis', planId: 'plan1', definitionId: 'd1', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    },
    definitions: {
      d1: { id: 'd1', planId: 'plan1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
      d2: { id: 'd2', planId: 'plan2', category: 'RadarCanhGioi', rangeKm: 200, capabilities: {} } as any
    },
    observations: {
      p1: { placementId: 'p1', status: 'Active' } as any,
      p2: { placementId: 'p2', status: 'Active' } as any,
      p1_missing_vis: { placementId: 'p1_missing_vis', status: 'Active' } as any,
      p_hist: { placementId: 'p_hist', status: 'Inactive' } as any
    },
    visuals: {
      p1: { color: '#ff0000', showDome: true } as any,
      p2: { color: '#0000ff', showDome: false } as any,
      p1_missing_obs: { color: '#00ff00', showDome: true } as any
    },
    activeScenarioId: 'scen1',
    activePlanId: 'plan1',
    canonicalInitialized: true
  });

  const state = useTacticalStore.getState();
  const activeEq = selectActiveEquipment(state);

  // Independent semantic assertions
  expect(activeEq.length).toBe(1);

  // Active plan filtering / other plan excluded
  expect(activeEq.find(e => e.instanceId === 'p2')).toBeUndefined();

  // Missing observation / visual excluded
  expect(activeEq.find(e => e.instanceId === 'p1_missing_obs')).toBeUndefined();
  expect(activeEq.find(e => e.instanceId === 'p1_missing_vis')).toBeUndefined();

  // Historical observation excluded
  expect(activeEq.find(e => e.instanceId === 'p_hist')).toBeUndefined();

  // Expected equipment fields are correct
  const eq1 = activeEq.find(e => e.instanceId === 'p1');
  expect(eq1).toBeDefined();
  expect(eq1?.latitude).toBe(10);
  expect(eq1?.longitude).toBe(20);
  expect(eq1?.rangeKm).toBe(100);
  expect(eq1?.color).toBe('#ff0000');
  expect(eq1?.status).toBe('Active');

  // Parity assertion
  expect(activeEq.length).toBeGreaterThan(0);

  // Direct selectors
  expect(selectEquipmentById(state, 'p1')).toEqual(eq1);
  expect(selectEquipmentById(state, 'p2')).toBeNull();

  expect(selectDefinitionForPlacement(state, 'p1')?.id).toBe('d1');
  expect(selectObservationForPlacement(state, 'p1')?.status).toBe('Active');
  expect(selectVisualForPlacement(state, 'p1')?.color).toBe('#ff0000');

  // switchActivePlan changes canonical read model correctly
  useTacticalStore.getState().switchActivePlan('plan2');
  const state2 = useTacticalStore.getState();
  const activeEq2 = selectActiveEquipment(state2);

  expect(activeEq2.length).toBe(1);
  expect(activeEq2[0].instanceId).toBe('p2');
  expect(selectEquipmentById(state2, 'p2')).toBeDefined();
  expect(selectEquipmentById(state2, 'p1')).toBeNull();

  // Verify projection properties match plan2 canonical placement, definition, observation, and visual
  expect(activeEq2[0].latitude).toBe(state2.placements['p2'].position.lat);
  expect(activeEq2[0].longitude).toBe(state2.placements['p2'].position.lon);
  expect(activeEq2[0].rangeKm).toBe(state2.definitions['d2'].rangeKm);
  expect(activeEq2[0].status).toBe(state2.observations['p2'].status);
  expect(activeEq2[0].color).toBe(state2.visuals['p2'].color);
});


test('1D Canonical Selectors Referential Stability', () => {
  useTacticalStore.setState({
    scenarios: { scen1: { id: 'scen1', name: 'Scen 1', createdAt: 0 } as any },
    plans: {
      plan1: { id: 'plan1', scenarioId: 'scen1', name: 'Plan 1', parentPlanId: null, createdAt: 0 } as any
    },
    placements: {
      p1: { id: 'p1', planId: 'plan1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 30, aglM: 5 }, network: { commandedByInstanceId: null } } as any
    },
    definitions: {
      d1: { id: 'd1', planId: 'plan1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any
    },
    observations: {
      p1: { placementId: 'p1', status: 'Active' } as any
    },
    visuals: {
      p1: { color: '#ff0000', showDome: true } as any
    },
    activeScenarioId: 'scen1',
    activePlanId: 'plan1',
    canonicalInitialized: true
  });

  const state1 = useTacticalStore.getState();
  const eq1 = selectActiveEquipment(state1);
  const placements1 = selectActivePlacements(state1);

  // Unrelated update
  useTacticalStore.setState({ showSpxPanel: true });
  const state2 = useTacticalStore.getState();
  const eq2 = selectActiveEquipment(state2);
  const placements2 = selectActivePlacements(state2);

  // Identity matches
  expect(eq2).toBe(eq1);
  expect(placements2).toBe(placements1);

  // Meaningful update
  useTacticalStore.setState({
    visuals: {
      ...state2.visuals,
      p1: { ...state2.visuals.p1, color: '#00ff00' }
    }
  });
  const state3 = useTacticalStore.getState();
  const eq3 = selectActiveEquipment(state3);

  expect(eq3).not.toBe(eq1);
  expect(eq3[0].color).toBe('#00ff00');
});

test('1D Cross-Plan Selector Isolation', () => {
  useTacticalStore.setState({
    scenarios: { scen1: { id: 'scen1', name: 'Scen 1', createdAt: 0 } as any },
    plans: {
      planA: { id: 'planA', scenarioId: 'scen1', name: 'Plan A', parentPlanId: null, createdAt: 0 } as any,
      planB: { id: 'planB', scenarioId: 'scen1', name: 'Plan B', parentPlanId: null, createdAt: 0 } as any
    },
    placements: {
      pA: { id: 'pA', planId: 'planA', definitionId: 'dA', position: { lat: 10, lon: 20, altM: 30, aglM: 5 }, network: { commandedByInstanceId: null } } as any,
      pB: { id: 'pB', planId: 'planB', definitionId: 'dB', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
      pA_bad: { id: 'pA_bad', planId: 'planA', definitionId: 'dB', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    },
    definitions: {
      dA: { id: 'dA', planId: 'planA', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
      dB: { id: 'dB', planId: 'planB', category: 'RadarCanhGioi', rangeKm: 200, capabilities: {} } as any
    },
    observations: {
      pA: { placementId: 'pA', status: 'Active' } as any,
      pB: { placementId: 'pB', status: 'Active' } as any,
      pA_bad: { placementId: 'pA_bad', status: 'Active' } as any
    },
    visuals: {
      pA: { color: '#ff0000', showDome: true } as any,
      pB: { color: '#0000ff', showDome: true } as any,
      pA_bad: { color: '#00ff00', showDome: true } as any
    },
    activeScenarioId: 'scen1',
    activePlanId: 'planA',
    canonicalInitialized: true
  });

  let state = useTacticalStore.getState();

  // pB belongs to planB, but activePlan is planA.
  expect(selectEquipmentById(state, 'pB')).toBeNull();
  expect(selectDefinitionForPlacement(state, 'pB')).toBeNull();
  expect(selectObservationForPlacement(state, 'pB')).toBeNull();
  expect(selectVisualForPlacement(state, 'pB')).toBeNull();

  // pA_bad belongs to planA, but references definition from planB
  expect(selectDefinitionForPlacement(state, 'pA_bad')).toBeNull();
  expect(selectEquipmentById(state, 'pA_bad')).toBeNull();
  expect(selectActiveEquipment(state).find(e => e.instanceId === 'pA_bad')).toBeUndefined();

  // Switch to planB
  useTacticalStore.setState({ activePlanId: 'planB' });
  state = useTacticalStore.getState();

  // Now pB works
  expect(selectEquipmentById(state, 'pB')).toBeDefined();
  expect(selectDefinitionForPlacement(state, 'pB')?.id).toBe('dB');
  expect(selectObservationForPlacement(state, 'pB')?.status).toBe('Active');
  expect(selectVisualForPlacement(state, 'pB')?.color).toBe('#0000ff');
});


test('1D Cross-Scenario Active Context Isolation', () => {
  useTacticalStore.setState({
    scenarios: {
      scenarioA: { id: 'scenarioA', name: 'Scenario A', createdAt: 0 } as any,
      scenarioB: { id: 'scenarioB', name: 'Scenario B', createdAt: 0 } as any
    },
    plans: {
      planA: { id: 'planA', scenarioId: 'scenarioA', name: 'Plan A', parentPlanId: null, createdAt: 0 } as any,
      planB: { id: 'planB', scenarioId: 'scenarioB', name: 'Plan B', parentPlanId: null, createdAt: 0 } as any
    },
    placements: {
      pA: { id: 'pA', planId: 'planA', definitionId: 'dA', position: { lat: 10, lon: 20, altM: 30, aglM: 5 }, network: { commandedByInstanceId: null } } as any,
      pB: { id: 'pB', planId: 'planB', definitionId: 'dB', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
    },
    definitions: {
      dA: { id: 'dA', planId: 'planA', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
      dB: { id: 'dB', planId: 'planB', category: 'RadarCanhGioi', rangeKm: 200, capabilities: {} } as any
    },
    observations: {
      pA: { placementId: 'pA', status: 'Active' } as any,
      pB: { placementId: 'pB', status: 'Active' } as any
    },
    visuals: {
      pA: { color: '#ff0000', showDome: true } as any,
      pB: { color: '#0000ff', showDome: true } as any
    },
    activeScenarioId: 'scenarioA',
    activePlanId: 'planB', // INVALID STATE: activePlan belongs to a different scenario
    canonicalInitialized: true
  });

  let state = useTacticalStore.getState();

  // Everything should safely return null/empty
  expect(selectActivePlan(state)).toBeNull();
  expect(selectActivePlacements(state)).toEqual([]);
  expect(selectActiveEquipment(state)).toEqual([]);
  expect(selectEquipmentById(state, 'pB')).toBeNull();
  expect(selectDefinitionForPlacement(state, 'pB')).toBeNull();
  expect(selectObservationForPlacement(state, 'pB')).toBeNull();
  expect(selectVisualForPlacement(state, 'pB')).toBeNull();

  // Set valid scenario context
  useTacticalStore.setState({ activeScenarioId: 'scenarioB' });
  state = useTacticalStore.getState();

  // Now it works
  expect(selectActivePlan(state)?.id).toBe('planB');
  expect(selectActivePlacements(state).length).toBe(1);
  expect(selectActiveEquipment(state).length).toBe(1);
  expect(selectEquipmentById(state, 'pB')).toBeDefined();
});


test('1D Scenario Memoization Invalidation', () => {
  useTacticalStore.setState({
    scenarios: { scenarioA: { id: 'scenarioA', name: 'Scenario A', createdAt: 0 } as any },
    plans: {
      planA: { id: 'planA', scenarioId: 'scenarioA', name: 'Plan A', parentPlanId: null, createdAt: 0 } as any
    },
    placements: {
      pA: { id: 'pA', planId: 'planA', definitionId: 'dA', position: { lat: 10, lon: 20, altM: 30, aglM: 5 }, network: { commandedByInstanceId: null } } as any
    },
    definitions: {
      dA: { id: 'dA', planId: 'planA', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any
    },
    observations: {
      pA: { placementId: 'pA', status: 'Active' } as any
    },
    visuals: {
      pA: { color: '#ff0000', showDome: true } as any
    },
    activeScenarioId: 'scenarioA',
    activePlanId: 'planA',
    canonicalInitialized: true
  });

  const state1 = useTacticalStore.getState();
  const placements1 = selectActivePlacements(state1);
  const equipment1 = selectActiveEquipment(state1);

  expect(placements1.length).toBe(1);
  expect(equipment1.length).toBe(1);

  // Replace ONLY scenarios registry so scenarioA no longer exists
  useTacticalStore.setState({
    scenarios: {} // Empty scenarios
  });

  const state2 = useTacticalStore.getState();
  const placements2 = selectActivePlacements(state2);
  const equipment2 = selectActiveEquipment(state2);

  expect(selectActivePlan(state2)).toBeNull();
  expect(placements2).toEqual([]);
  expect(equipment2).toEqual([]);
  expect(placements2).not.toBe(placements1);
  expect(equipment2).not.toBe(equipment1);
});


describe('1E Canonical Mutation Boundary', () => {
  const setupBase = () => {
    useTacticalStore.setState({
      scenarios: {
        s1: { id: 's1', name: 'S1', status: 'draft', createdAt: 0 } as any
      },
      plans: {
        p1: { id: 'p1', scenarioId: 's1', status: 'draft', name: 'P1', createdAt: 0 } as any
      },
      placements: {
        c1: { id: 'c1', planId: 'p1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 0, aglM: 0 }, network: {} } as any
      },
      definitions: {
        d1: { id: 'd1', planId: 'p1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any
      },
      visuals: {
        c1: { color: 'red', showDome: true } as any
      },
      instances: [
        { instanceId: 'fake_instance_only' } as any, // Only exists in projection
        { instanceId: 'c1', latitude: 10, longitude: 20, name: 'c1_orig' } as any // Valid projection
      ],
      simulations: { sim1: { c1: { status: 'Running', parameters: {} } } as any },
      activeSimulationRunId: 'sim1',
      activeScenarioId: 's1',
      activePlanId: 'p1',
      canonicalInitialized: true
    } as any);
  };

  test('B. fake item existing only in instances[] cannot be updated', () => {
    setupBase();
    expect(() => useTacticalStore.getState().updateEquipment('fake_instance_only', { name: 'test' })).toThrow(/Placement not found/);

    // State remains untouched
    const state = useTacticalStore.getState();
    expect(selectActiveEquipment(state).find(i => i.instanceId === 'fake_instance_only')).toBeUndefined();
  });

  test('C. fake item existing only in instances[] cannot be removed', () => {
    setupBase();
    expect(() => useTacticalStore.getState().removeEquipment('fake_instance_only')).toThrow(/Target equipment fake_instance_only does not exist/);
  });

  test('D. cross-plan Placement mutation is rejected', () => {
    setupBase();
    useTacticalStore.setState((s) => ({
      plans: { ...s.plans, p2: { id: 'p2', scenarioId: 's1', status: 'draft', name: 'P2', createdAt: 0 } as any },
      definitions: { ...s.definitions, d2: { id: 'd2', planId: 'p2', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any },
      placements: { ...s.placements, c2: { id: 'c2', planId: 'p2', definitionId: 'd2', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any }
    }));

    // c2 belongs to p2, but activePlanId is p1
    expect(() => useTacticalStore.getState().updateEquipment('c2', { name: 'test' })).toThrow(/Placement belongs to another plan/);
    expect(() => useTacticalStore.getState().removeEquipment('c2')).toThrow(/Target equipment c2 belongs to another plan/);
  });


  test('E. archived Scenario mutation is rejected', () => {
    setupBase();
    useTacticalStore.setState((s) => ({
      scenarios: {
        ...s.scenarios,
        s1: { ...s.scenarios.s1, status: 'archived' }
      }
    }));

    expect(() => useTacticalStore.getState().updateEquipment('c1', { name: 'test' })).toThrow(/Scenario is archived/);
    expect(() => useTacticalStore.getState().clearAll()).toThrow(/Scenario is archived/);
  });

  test('F. proposed/approved Plan mutation is rejected', () => {
    setupBase();
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        p1: { ...s.plans.p1, status: 'proposed' }
      }
    }));

    expect(() => useTacticalStore.getState().updateEquipment('c1', { name: 'test' })).toThrow(/Active plan is not draft/);

    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        p1: { ...s.plans.p1, status: 'approved' }
      }
    }));

    expect(() => useTacticalStore.getState().removeEquipment('c1')).toThrow(/Active plan is not draft/);
  });

  test('A, G. update mutation resolves target only from canonical Placement and updates projection', () => {
    setupBase();
    useTacticalStore.getState().updateEquipment('c1', { name: 'c1_updated', latitude: 50 });

    const state = useTacticalStore.getState();
    const inst = selectActiveEquipment(state).find(i => i.instanceId === 'c1');
    expect(inst).toBeDefined();
    expect(inst?.name).toBe('c1_updated');
    expect(inst?.latitude).toBe(50);
    expect(state.placements['c1'].position.lat).toBe(50);
  });

  test('I. remove preserves historical Observation/Simulation', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');

    const state = useTacticalStore.getState();
    // Placement, Definition, Visual should be gone
    expect(state.placements['c1']).toBeUndefined();
    expect(state.definitions['d1']).toBeUndefined();
    expect(state.visuals['c1']).toBeUndefined();

    // Observation must SURVIVE
    expect(state.observations['c1']).toBeDefined();
    // Simulation must SURVIVE
    expect(state.simulations['sim1']['c1']).toBeDefined();
  });



  test('H. canonical mutations do not rebuild canonical state from instances[] (No Reverse Sync)', () => {
    setupBase();

    // Intentionally create a stale legacy entry
    useTacticalStore.setState(((s: any) => ({
      instances: ((s.instances || []) as any[]).map((inst: any) =>
        inst.instanceId === 'c1' ? { ...inst, latitude: -99 } : inst
      )
    })) as any);

    // Update canonical state using the public action
    useTacticalStore.getState().updateEquipment('c1', { latitude: 50 });

    const state = useTacticalStore.getState();

    // The canonical Placement MUST reflect the update
    expect(state.placements['c1'].position.lat).toBe(50);
    // The projection must be generated from canonical (50), NOT reverse-syncing the stale -99
    expect(selectActiveEquipment(state).find(i => i.instanceId === 'c1')?.latitude).toBe(50);
  });

  test('J. clearAll remains active-plan scoped', () => {
    setupBase();
    useTacticalStore.setState((s) => ({
      plans: { ...s.plans, p2: { id: 'p2', scenarioId: 's1', status: 'draft', name: 'P2', createdAt: 0 } as any },
      placements: {
        ...s.placements,
        c2: { id: 'c2', planId: 'p2', definitionId: 'd2', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any
      },
      definitions: {
        ...s.definitions,
        d2: { id: 'd2', planId: 'p2', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any
      },
      visuals: {
        ...s.visuals,
        c2: { color: 'blue', showDome: true } as any
      },
      observations: {
        ...s.observations,
        c2: { placementId: 'c2', status: 'Active' } as any
      }
    }));

    useTacticalStore.getState().clearAll();

    const state = useTacticalStore.getState();

    // c1 (plan p1) is removed
    expect(state.placements['c1']).toBeUndefined();
    expect(state.definitions['d1']).toBeUndefined();

    // c2 (plan p2) SURVIVES
    expect(state.placements['c2']).toBeDefined();
    expect(state.definitions['d2']).toBeDefined();
    expect(state.visuals['c2']).toBeDefined();

    // Observation for c1 MUST survive
    expect(state.observations['c1']).toBeDefined();
  });

});


describe('1F Cesium Render Read Parity', () => {
  const setupBase = () => {
    useTacticalStore.setState({
      scenarios: {
        s1: { id: 's1', name: 'S1', status: 'draft', createdAt: 0 } as any
      },
      plans: {
        p1: { id: 'p1', scenarioId: 's1', status: 'draft', name: 'P1', createdAt: 0 } as any,
        p2: { id: 'p2', scenarioId: 's1', status: 'draft', name: 'P2', createdAt: 0 } as any
      },
      placements: {
        c1: { id: 'c1', planId: 'p1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 0, aglM: 0 }, network: {} } as any,
        c2: { id: 'c2', planId: 'p2', definitionId: 'd2', position: { lat: 30, lon: 40, altM: 0, aglM: 0 }, network: {} } as any
      },
      definitions: {
        d1: { id: 'd1', planId: 'p1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
        d2: { id: 'd2', planId: 'p2', category: 'RadarCanhGioi', rangeKm: 200, capabilities: {} } as any
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any,
        c2: { placementId: 'c2', status: 'Active' } as any
      },
      visuals: {
        c1: { color: 'red', showDome: true } as any,
        c2: { color: 'blue', showDome: true } as any
      },
      simulations: {
        sim1: {
          c1: { status: 'Running', parameters: {} } as any,
          c2: { status: 'Running', parameters: {} } as any
        }
      },
      activeSimulationRunId: 'sim1',
      activeScenarioId: 's1',
      activePlanId: 'p1',
      canonicalInitialized: true
    });
  };

  test('A. active Plan A render input excludes Plan B', () => {
    setupBase();
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    expect(renderInput.length).toBe(1);
    expect(renderInput[0].instanceId).toBe('c1');
  });

  test('B. switchActivePlan changes render input correctly', () => {
    setupBase();
    useTacticalStore.setState({ activePlanId: 'p2' });
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    expect(renderInput.length).toBe(1);
    expect(renderInput[0].instanceId).toBe('c2');
  });

  test('C. canonical equipment update changes render input', () => {
    setupBase();
    useTacticalStore.getState().updateEquipment('c1', { latitude: 99 });
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    expect(renderInput[0].latitude).toBe(99);
  });

  test('D. removed Placement disappears from active render input', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    expect(renderInput.length).toBe(0);
  });

  test('E. historical Observation does not resurrect removed equipment', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');
    const state = useTacticalStore.getState();
    // Observation still exists
    expect(state.observations['c1']).toBeDefined();
    // But it's not in the render input
    const renderInput = selectActiveEquipment(state);
    expect(renderInput.find(e => e.instanceId === 'c1')).toBeUndefined();
  });

  test('F. legacy instances[] poisoning does not alter canonical render input', () => {
    setupBase();
    useTacticalStore.setState({
      instances: [{ instanceId: 'c1', latitude: -99 }]
    } as any);

    // update canonically
    useTacticalStore.getState().updateEquipment('c1', { latitude: 50 });
    const renderInput = selectActiveEquipment(useTacticalStore.getState());

    // Poison ignored, canonical wins
    expect(renderInput[0].latitude).toBe(50);
  });

  test('G. selector/render input remains semantically compatible with existing Cesium expectations', () => {
    setupBase();
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    const inst = renderInput[0];

    // Test that hydrateLegacyInstance is providing Cesium what it expects
    expect(inst.instanceId).toBe('c1');
    expect(inst.latitude).toBe(10);
    expect(inst.longitude).toBe(20);
    expect(inst.color).toBe('red');
    expect(inst.showDome).toBe(true);
    expect(inst.status).toBe('Active'); // from Simulation/Observation
  });

  test('H. triggerRadarCameraPreset sets correct flyToTarget based on canonical equipment', () => {
    setupBase();
    useTacticalStore.setState({ activePlanId: 'p1' });

    // Clear flyToTarget explicitly
    useTacticalStore.getState().clearFlyTo();

    // Create equipment with non-default lat/lon
    useTacticalStore.getState().addEquipment({ instanceId: 'radar_1', templateId: 'radar_36d6', latitude: 15.555, longitude: 105.777 } as any);

    // Select the new equipment
    const state = useTacticalStore.getState();
    const activeEq = selectActiveEquipment(state);
    const inst = activeEq.find(i => i.templateId === 'radar_36d6' && i.latitude === 15.555);
    expect(inst).toBeDefined();

    useTacticalStore.getState().selectEquipment(inst!.instanceId);

    // Trigger preset
    useTacticalStore.getState().triggerRadarCameraPreset('top-down');

    const nextState = useTacticalStore.getState();
    expect(nextState.flyToTarget).toBeDefined();

    // Assert coordinates match the real target canonical coordinates
    expect(nextState.flyToTarget?.latitude).toBe(15.555);
    expect(nextState.flyToTarget?.longitude).toBe(105.777);
    expect(nextState.flyToTarget?.pitch).toBe(-89.5);
  });
});

describe('1G Simulation and Observation Canonical Boundary', () => {
  const setupBase = () => {
    useTacticalStore.setState({
      scenarios: {
        s1: { id: 's1', name: 'S1', status: 'draft', createdAt: 0 } as any
      },
      plans: {
        p1: { id: 'p1', scenarioId: 's1', status: 'draft', name: 'P1', createdAt: 0, version: 1 } as any,
        p2: { id: 'p2', scenarioId: 's1', status: 'draft', name: 'P2', createdAt: 0, version: 1 } as any
      },
      placements: {
        c1: { id: 'c1', planId: 'p1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 0, aglM: 0 }, network: {} } as any,
        c2: { id: 'c2', planId: 'p2', definitionId: 'd2', position: { lat: 30, lon: 40, altM: 0, aglM: 0 }, network: {} } as any
      },
      definitions: {
        d1: { id: 'd1', planId: 'p1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
        d2: { id: 'd2', planId: 'p2', category: 'RadarCanhGioi', rangeKm: 200, capabilities: {} } as any
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any,
        c2: { placementId: 'c2', status: 'Active' } as any
      },
      visuals: {
        c1: { color: 'red', showDome: true } as any,
        c2: { color: 'blue', showDome: true } as any
      },
      simulations: {
        sim1: {
          c1: { runId: 'sim1', placementId: 'c1', timeOffset: 0, currentSweepHeading: 123 } as any,
          c2: { runId: 'sim1', placementId: 'c2', timeOffset: 0, currentSweepHeading: 456 } as any
        }
      },
      simulationRuns: {},
      activeSimulationRunId: 'sim1',
      activeScenarioId: 's1',
      activePlanId: 'p1',
      canonicalInitialized: true
    });

    const fp = computePlanInputFingerprint(useTacticalStore.getState(), 'p1');
    useTacticalStore.setState({
      simulationRuns: {
        sim1: {
          id: 'sim1',
          planId: 'p1',
          scenarioId: 's1',
          timestamp: 0,
          config: {},
          status: 'completed',
          planVersion: 1,
          planInputFingerprint: fp,
        } as any,
      }
    });
  };

  test('A. simulation registry is keyed by canonical Placement ID', () => {
    setupBase();
    // Empty out instances[] completely to prove no instances[] lookup participates
    useTacticalStore.setState({ instances: [] } as any);

    // Canonical read model must address simulations[runId][placementId] via Placement.id
    const renderInput = selectActiveEquipment(useTacticalStore.getState());
    const c1Render = renderInput.find(e => e.instanceId === 'c1');

    expect(c1Render).toBeDefined();
    expect(c1Render?.currentSweepHeading).toBe(123); // Proves hydration read that exact record directly
  });

  // Direct simulation mutation checks are NOT APPLICABLE for this checkpoint because no public API exposes direct SimulationState mutation.
  test('B. instances-only fake equipment cannot receive Observation mutation via updateEquipment', () => {
    setupBase();
    useTacticalStore.setState({
      instances: [{ instanceId: 'fake1', status: 'Active' }]
    } as any);
    expect(() => useTacticalStore.getState().updateEquipment('fake1', { status: 'Offline' })).toThrow(/Placement not found/);
  });

  test('C. removeEquipment preserves historical SimulationState', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');
    const state = useTacticalStore.getState();
    // Placement removed
    expect(state.placements['c1']).toBeUndefined();
    // Visual removed
    expect(state.visuals['c1']).toBeUndefined();
    // Definition removed when unreferenced
    expect(state.definitions['d1']).toBeUndefined();
    // Observation preserved
    expect(state.observations['c1']).toBeDefined();
    // simulations[runId][placementId] preserved
    expect(state.simulations['sim1']['c1']).toBeDefined();
  });

  test('D. Observation survives removal but does not make removed equipment active', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');
    const state = useTacticalStore.getState();

    // Observation survives
    expect(state.observations['c1']).toBeDefined();
    // Placement is absent
    expect(state.placements['c1']).toBeUndefined();

    // selectActiveEquipment excludes it
    const renderInput = selectActiveEquipment(state);
    expect(renderInput.find(e => e.instanceId === 'c1')).toBeUndefined();
  });

  test('E. clearAll preserves SimulationState for removed active-plan Placements', () => {
    setupBase();
    useTacticalStore.getState().clearAll();
    const state = useTacticalStore.getState();
    expect(state.placements['c1']).toBeUndefined();
    expect(state.simulations['sim1']['c1']).toBeDefined();
    expect(state.observations['c1']).toBeDefined();
  });

  test('F. historical SimulationState does not resurrect removed equipment', () => {
    setupBase();
    useTacticalStore.getState().removeEquipment('c1');
    const state = useTacticalStore.getState();
    expect(state.simulations['sim1']['c1']).toBeDefined(); // Still exists
    const renderInput = selectActiveEquipment(state);
    expect(renderInput.find(e => e.instanceId === 'c1')).toBeUndefined(); // Does not render
  });

  test('G. switchActivePlan does not delete or move SimulationState', () => {
    setupBase();
    useTacticalStore.getState().switchActivePlan('p2');
    const state = useTacticalStore.getState();
    expect(state.simulations['sim1']['c1']).toBeDefined(); // c1 is plan1, survives
    expect(state.simulations['sim1']['c2']).toBeDefined(); // c2 is plan2, survives
    expect(state.observations['c1']).toBeDefined();
    expect(state.observations['c2']).toBeDefined();
  });

  test('H. no-reverse-sync for 1G boundary', () => {
    setupBase();
    // Poison instances[] with conflicting state
    useTacticalStore.setState({
      instances: [{ instanceId: 'c1', status: 'Offline' }]
    } as any);

    // Exercise an existing canonical Observation/equipment mutation path
    useTacticalStore.getState().updateEquipment('c1', { status: 'Standby' });
    const state = useTacticalStore.getState();

    // Canonical state wins
    expect(state.observations['c1'].status).toBe('Standby');

    // active equipment projection comes from canonical state
    const renderInput = selectActiveEquipment(state);
    expect(renderInput.find(e => e.instanceId === 'c1')?.status).toBe('Standby');
  });

  test('I. import/load replacement creates new Placement IDs and does not bind historical SimulationState to new equipment', () => {
    setupBase();
    const importedEquipment = [{
      instanceId: 'imp1', templateId: 'radar_36d6', latitude: 10, longitude: 20
    }] as any;

    useTacticalStore.getState().importFromLayout({ equipments: importedEquipment } as any);
    const state = useTacticalStore.getState();

    expect(state.placements['c1']).toBeUndefined();
    expect(state.simulations['sim1']['c1']).toBeDefined();

    const newPlacementId = Object.keys(state.placements).find(id => state.placements[id].planId === 'p1');
    expect(newPlacementId).toBeDefined();
    expect(newPlacementId).not.toBe('c1');
    expect(state.simulations['sim1'][newPlacementId!]).toBeUndefined();
    expect(state.selectedInstanceId).toBe(newPlacementId);
    expect(state.placements[state.selectedInstanceId!]).toBeDefined();
  });

});



describe('1K Phase A - Business Logic Read Migration & Edge Cases', () => {
  beforeEach(() => {
    delete (useTacticalStore.getState() as any).instances;
    useTacticalStore.setState({
      activePlanId: 'p1',
      activeScenarioId: 's1',
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      auditEvents: {},
      auditEventOrder: [],
      revisions: {},
      revisionHeads: {}
    });
  });

  test('normal store has no own property instances', () => {
    const state = useTacticalStore.getState();
    expect(Object.prototype.hasOwnProperty.call(state, 'instances')).toBe(false);
    expect('instances' in state).toBe(false);
  });

  test('initial store state has selectedInstanceId as null and no instances property', () => {
    const initial = useTacticalStore.getInitialState();
    expect(initial.selectedInstanceId).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(initial, 'instances')).toBe(false);
    expect('instances' in initial).toBe(false);
  });

  test('ShortId uniqueness and deletion edge cases', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e1', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any);
    store.addEquipment({ instanceId: 'e2', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any);

    let active = selectActiveEquipment(useTacticalStore.getState());
    expect(active.length).toBe(2);
    expect(active[0].shortId).toBe('R-01');
    expect(active[1].shortId).toBe('R-02');

    // Delete the highest one
    useTacticalStore.getState().removeEquipment('e2');

    // Add a new one
    useTacticalStore.getState().addEquipment({ instanceId: 'e3', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any);

    active = selectActiveEquipment(useTacticalStore.getState());
    expect(active.length).toBe(2);
    // The existing one was R-01, the new one should be R-02 because max was 1. Reusing is allowed by contract.
    const shortIds = active.map(i => i.shortId).sort();
    expect(shortIds).toEqual(['R-01', 'R-02']);
  });

  test('Advisor viewport equipment data (canonical payload)', async () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e_adv_vp', templateId: 'radar_36d6', shortId: 'R-VP', latitude: 10, longitude: 20 } as any);

    const vectorClient = await import('../services/vectorAiClient');
    const vi = await import('vitest').then(m => m.vi);

    const checkSpy = vi.spyOn(vectorClient, 'checkVectorAiHealth').mockResolvedValue({ ok: true, value: { status: 'ready' } } as any);
    let requestPayload: any = null;
    const askSpy = vi.spyOn(vectorClient, 'askVectorAi').mockImplementation(async (opts: any) => {
      // The context is embedded in messages
      requestPayload = opts.messages.find((m: any) => m.content.includes('R-VP'))?.content;
      return { ok: true, value: { text: JSON.stringify({ summary: 'ok', suggestions: [], route: [] }) } } as any;
    });

    try {
      await useTacticalStore.getState().runAiPlacementAnalysis('test-model');
      expect(requestPayload).toBeDefined();
      expect(requestPayload).toContain('R-VP');
      expect(requestPayload).toContain('10, 20');
    } finally {
      checkSpy.mockRestore();
      askSpy.mockRestore();
    }
  });

  test('Malformed custom shortId behavior', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e_custom', templateId: 'radar_36d6', category: 'RadarCanhGioi', shortId: 'R-CUSTOM' } as any);
    store.addEquipment({ instanceId: 'e_next', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any);

    const active = selectActiveEquipment(useTacticalStore.getState());
    const shortIds = active.map(i => i.shortId).sort();
    // It should have 'R-CUSTOM' and the next normal one which should be 'R-01' because 'R-CUSTOM' doesn't contribute to maxNumber.
    expect(shortIds).toContain('R-CUSTOM');
    expect(shortIds).toContain('R-01');
  });

  test('Accepted mutation audit behavior', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e4', templateId: 'radar_36d6' } as any);
    const state = useTacticalStore.getState();

    // Check audit
    expect(state.auditEventOrder).toBeDefined();
    expect(state.auditEventOrder.length).toBeGreaterThan(0);
    const lastEventId = state.auditEventOrder[state.auditEventOrder.length - 1];
    const lastAudit = state.auditEvents[lastEventId];
    expect(lastAudit.action).toBe('ADD');
    expect(lastAudit.targetType).toBe('EQUIPMENT');

    // Check revision heads updated
    const revisionScope = 'PLAN:' + state.activePlanId;
    expect(state.revisionHeads[revisionScope]).toBeDefined();
  });

  test('Rejected mutation audit behavior (Atomic)', () => {
    const store = useTacticalStore.getState();
    const beforeAuditLen = store.auditEventOrder?.length || 0;
    const beforeRevision = store.revisionHeads['PLAN:p1'];

    expect(() => {
      store.updateEquipment('non-existent', { altitude: 100 });
    }).toThrow();

    const state = useTacticalStore.getState();
    const afterAuditLen = state.auditEventOrder?.length || 0;
    expect(afterAuditLen).toBe(beforeAuditLen); // No audit recorded for rejected mutation
    expect(state.revisionHeads['PLAN:p1']).toBe(beforeRevision);
  });

  test('Cross-Plan isolation for ID generation and export', () => {
    const store = useTacticalStore.getState();

    // Mock valid scenario and plan
    useTacticalStore.setState({
      scenarios: { 's1': { id: 's1', name: 'S1', status: 'active', terrainVersion: 'v1', createdAt: 0 } },
      plans: { 'p1': { id: 'p1', scenarioId: 's1', name: 'P1', status: 'draft', sourcePlanId: null, createdAt: 0, createdBy: 'u', version: 1 } }
    } as any);

    store.addEquipment({ instanceId: 'e5', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any); // R-01 in p1

    store.createPlanAlternative('p1');

    // In p2, the cloned equipment gets a new ID. We must remove that cloned one, not 'e5'.
    const activeP2 = selectActiveEquipment(useTacticalStore.getState());
    const clonedId = activeP2[0].instanceId;

    store.removeEquipment(clonedId); // Remove from p2
    store.addEquipment({ instanceId: 'e6', templateId: 'radar_36d6', category: 'RadarCanhGioi' } as any); // Should be R-01 again because p2 is empty

    const active = selectActiveEquipment(useTacticalStore.getState());
    expect(active.length).toBe(1);
    expect(active[0].shortId).toBe('R-01');

    store.switchActivePlan('p1');
    const activeP1 = selectActiveEquipment(useTacticalStore.getState());
    expect(activeP1.length).toBe(1);
    expect(activeP1[0].shortId).toBe('R-01');
  });

  test('Legacy layout export fields', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e7', templateId: 'radar_36d6', shortId: 'R-LAY', latitude: 11, longitude: 22, altitude: 33, antennaHeightAGL: 44, rangeKm: 55, scanSpeed: 66, minElevationDeg: 77, maxElevationDeg: 88, status: 'Standby' } as any);

    // Mangle state.instances manually to simulate legacy projection drift
    useTacticalStore.setState({ instances: [] } as any);

    const layout = useTacticalStore.getState().exportToLayout('test');
    expect(layout.equipments.length).toBe(1); // Derived from canonical, not instances[]
    const eq = layout.equipments[0];
    expect(eq.instanceId).toBe('e7');
    expect(eq.shortId).toBe('R-LAY');
    expect(eq.latitude).toBe(11);
    expect(eq.longitude).toBe(22);
    expect(eq.groundElevationMeters).toBe(33);
    expect(eq.antennaHeightAGL).toBe(44);
    expect(eq.currentRange).toBe(55);
    expect(eq.currentScanSpeed).toBe(66);
    expect(eq.currentMinElevation).toBe(77);
    expect(eq.currentMaxElevation).toBe(88);
    expect(eq.status).toBe(1); // 'Standby' mapped to 1
  });

  test('Radar camera preset behavior', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e_cam', templateId: 'radar_36d6' } as any);
    useTacticalStore.setState({ selectedInstanceId: 'e_cam' });

    useTacticalStore.getState().triggerRadarCameraPreset('top-down');
    const state = useTacticalStore.getState();
    expect(state.flyToTarget).toBeDefined();
    expect(state.flyToTarget?.height).toBeGreaterThan(0);
  });

  test('Selected equipment -> advisor template resolution (via placeEquipmentAtSuggestion)', () => {
    const store = useTacticalStore.getState();
    store.addEquipment({ instanceId: 'e_adv1', templateId: 'radar_vrs2dm' } as any);
    store.addEquipment({ instanceId: 'e_adv2', templateId: 'radar_36d6' } as any);

    useTacticalStore.setState({
      selectedInstanceId: 'e_adv2', // should pick radar_36d6 explicitly because it's selected
      aiAdvisorTemplateId: null,
      aiAdvisorSuggestions: [{ latitude: 10, longitude: 20 }] as any
    });

    const prevCount = selectActiveEquipment(useTacticalStore.getState()).length;
    useTacticalStore.getState().placeEquipmentAtSuggestion(0);
    const active = selectActiveEquipment(useTacticalStore.getState());
    expect(active.length).toBe(prevCount + 1);
    expect(active[active.length - 1].templateId).toBe('radar_36d6');
    expect(active[active.length - 1].latitude).toBe(10);
    // verify indexing behavior by checking the generated name
    expect(active[active.length - 1].name).toMatch(/3/);
  });
});

describe('Checkpoint 2C.1 — SimulationRun Foundation & Lifecycle', () => {
  const setup2CTestState = () => {
    useTacticalStore.setState({
      scenarios: {
        scen_alpha: {
          id: 'scen_alpha',
          name: 'Kịch Bản Alpha',
          terrainVersion: 'terrain_tamdao_v1',
          createdAt: 1000,
          status: 'active',
        },
        scen_beta: {
          id: 'scen_beta',
          name: 'Kịch Bản Beta',
          terrainVersion: 'terrain_tamdao_v1',
          createdAt: 2000,
          status: 'draft',
        },
        scen_trashed: {
          id: 'scen_trashed',
          name: 'Kịch Bản Thùng Rác',
          terrainVersion: 'terrain_tamdao_v1',
          createdAt: 3000,
          status: 'trashed',
        },
      },
      plans: {
        plan_alpha_1: {
          id: 'plan_alpha_1',
          scenarioId: 'scen_alpha',
          version: 2,
          name: 'Phương Án Alpha 1',
          status: 'draft',
        },
        plan_alpha_2: {
          id: 'plan_alpha_2',
          scenarioId: 'scen_alpha',
          version: 1,
          name: 'Phương Án Alpha 2',
          status: 'draft',
        },
        plan_beta_1: {
          id: 'plan_beta_1',
          scenarioId: 'scen_beta',
          version: 1,
          name: 'Phương Án Beta 1',
          status: 'draft',
        },
        plan_trashed: {
          id: 'plan_trashed',
          scenarioId: 'scen_alpha',
          version: 1,
          name: 'Phương Án Rác',
          status: 'trashed',
        },
      },
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      simulationRuns: {},
      simulations: {},
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      activeSimulationRunId: null,
      canonicalInitialized: true,
    });
  };

  beforeEach(() => {
    setup2CTestState();
  });

  test('1. New run contains correct provenance from canonical Scenario and Plan (defaults to pending)', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      configSnapshot: { timeStepSeconds: 2, durationSeconds: 120 },
      randomSeed: 42,
    });
    const runId = handle.runId;

    const state = useTacticalStore.getState();
    const run = state.simulationRuns[runId];

    expect(run).toBeDefined();
    expect(run.id).toBe(runId);
    expect(run.runToken).toBe(handle.runToken);
    expect(run.importGen).toBe(0);
    expect(run.planInputFingerprint).toBeDefined();
    expect(run.scenarioId).toBe('scen_alpha');
    expect(run.planId).toBe('plan_alpha_1');
    expect(run.planVersion).toBe(2); // Reads canonical plan.version (2), not arbitrary
    expect(run.modelVersion).toBe('v2.0-canonical');
    expect(run.simulationVersion).toBe('1.0.0');
    expect(run.status).toBe('pending'); // Default status must be pending, not running
    expect(run.startedAt).toBeUndefined(); // startedAt must be undefined while pending
    expect(run.completedAt).toBeUndefined();
    expect(run.resultSummary).toBeUndefined();
    expect(run.eventCount).toBe(0);
    expect(run.randomSeed).toBe(42);
    expect(run.configSnapshot?.timeStepSeconds).toBe(2);
    expect(run.configSnapshot?.durationSeconds).toBe(120);
    // Legacy backward-compatibility fields preserved
    expect(run.timestamp).toBeDefined();
    expect(run.config).toEqual(run.configSnapshot);

    // InitialStatus 'running' explicitly sets startedAt
    const runningHandle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });
    const runningRun = useTacticalStore.getState().simulationRuns[runningHandle.runId];
    expect(runningRun.status).toBe('running');
    expect(runningRun.startedAt).toBeDefined();
  });

  test('2. Snapshot is deep cloned and deeply frozen against post-registration and post-completion mutation', () => {
    const mutableCfg = { timeStepSeconds: 5, durationSeconds: 300, nested: { speed: 10 } };
    const handle = useTacticalStore.getState().registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      configSnapshot: mutableCfg as any,
    });
    const runId = handle.runId;

    // Mutate original object externally
    mutableCfg.nested.speed = 999;
    (mutableCfg as any).newField = 'polluted';

    const run = useTacticalStore.getState().simulationRuns[runId];
    expect((run.configSnapshot as any).nested.speed).toBe(10);
    expect((run.configSnapshot as any).newField).toBeUndefined();
    expect((run.config as any).nested.speed).toBe(10);

    // Deep immutability after registration: mutating nested objects throws TypeError
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.configSnapshot)).toBe(true);
    expect(Object.isFrozen((run.configSnapshot as any).nested)).toBe(true);
    expect(Object.isFrozen(run.config)).toBe(true);
    expect(Object.isFrozen((run.config as any).nested)).toBe(true);
    expect(Object.isFrozen(run.diagnostics)).toBe(true);
    expect(Object.isFrozen(run.diagnostics?.warnings)).toBe(true);
    expect(() => {
      (run.configSnapshot as any).nested.speed = 999;
    }).toThrow(TypeError);
    expect(() => {
      (run.config as any).nested.speed = 999;
    }).toThrow(TypeError);

    // Transition to running and completed with resultSummary and diagnostics
    const store = useTacticalStore.getState();
    store.updateSimulationRunStatus(handle, 'running');
    store.updateSimulationRunStatus(handle, 'completed', {
      resultSummary: { nestedScore: { value: 100 } },
      diagnostics: { durationMs: 50, warnings: ['w1'], errors: [] },
    });

    const completedRun = useTacticalStore.getState().simulationRuns[runId];
    expect(Object.isFrozen(completedRun)).toBe(true);
    expect(Object.isFrozen(completedRun.resultSummary)).toBe(true);
    expect(Object.isFrozen((completedRun.resultSummary as any).nestedScore)).toBe(true);
    expect(() => {
      (completedRun.resultSummary as any).nestedScore.value = 999;
    }).toThrow(TypeError);
    expect(() => {
      (completedRun.diagnostics?.warnings as any).push('illegal warning push');
    }).toThrow(TypeError);
  });

  test('3. Registry key strictly equals run.id', () => {
    const handle = useTacticalStore.getState().registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
    });
    const runId = handle.runId;
    const state = useTacticalStore.getState();
    expect(Object.keys(state.simulationRuns)).toContain(runId);
    expect(state.simulationRuns[runId].id).toBe(runId);
  });

  test('4. Validation of Scenario and Plan ownership & rejection of trashed/mismatched contexts', () => {
    const store = useTacticalStore.getState();

    // Missing scenario
    expect(() =>
      store.registerSimulationRun({ scenarioId: 'non_existent', planId: 'plan_alpha_1' })
    ).toThrow(/Scenario non_existent not found/);

    // Trashed scenario
    expect(() =>
      store.registerSimulationRun({ scenarioId: 'scen_trashed', planId: 'plan_alpha_1' })
    ).toThrow(/is trashed/);

    // Missing plan
    expect(() =>
      store.registerSimulationRun({ scenarioId: 'scen_alpha', planId: 'non_existent_plan' })
    ).toThrow(/Plan non_existent_plan not found/);

    // Trashed plan
    expect(() =>
      store.registerSimulationRun({ scenarioId: 'scen_alpha', planId: 'plan_trashed' })
    ).toThrow(/is trashed/);

    // Cross-scenario plan ownership mismatch
    expect(() =>
      store.registerSimulationRun({ scenarioId: 'scen_alpha', planId: 'plan_beta_1' })
    ).toThrow(/belongs to Scenario scen_beta, not scen_alpha/);
  });

  test('5. Valid and invalid lifecycle transitions (State Machine & Payload Guards)', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'pending',
    });
    const runId = handle.runId;

    let run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.status).toBe('pending');
    expect(run.startedAt).toBeUndefined();
    expect(run.completedAt).toBeUndefined();

    // Invalid transition: pending -> completed directly is rejected
    expect(() => store.updateSimulationRunStatus(handle, 'completed')).toThrow(
      /pending cannot transition directly to completed/
    );

    // Non-terminal lifecycle rejects completedAt and resultSummary
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { completedAt: Date.now() })
    ).toThrow(/Cannot provide completedAt for non-terminal/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { resultSummary: { speed: 10 } })
    ).toThrow(/Cannot provide resultSummary for non-terminal/);

    // eventCount validation: non-integers, negative, and infinite values rejected
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { eventCount: -1 })
    ).toThrow(/finite non-negative integer/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { eventCount: 3.14 })
    ).toThrow(/finite non-negative integer/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { eventCount: Infinity })
    ).toThrow(/finite non-negative integer/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { eventCount: NaN })
    ).toThrow(/finite non-negative integer/);

    // Valid transition: pending -> running
    store.updateSimulationRunStatus(handle, 'running');
    run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.status).toBe('running');
    expect(run.startedAt).toBeDefined();

    // Invalid transition: running -> pending rejected
    expect(() => store.updateSimulationRunStatus(handle, 'pending')).toThrow(
      /running cannot transition to pending/
    );

    // Payload validation: completedAt must be valid positive finite timestamp
    expect(() =>
      store.updateSimulationRunStatus(handle, 'completed', { completedAt: -500 })
    ).toThrow(/valid positive finite timestamp/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'completed', { completedAt: Infinity })
    ).toThrow(/valid positive finite timestamp/);
    expect(() =>
      store.updateSimulationRunStatus(handle, 'completed', { completedAt: NaN })
    ).toThrow(/valid positive finite timestamp/);

    // Payload validation: completedAt earlier than startedAt rejected
    expect(() =>
      store.updateSimulationRunStatus(handle, 'completed', { completedAt: (run.startedAt ?? 0) - 1000 })
    ).toThrow(/completedAt .* cannot be earlier than startedAt/);

    // Valid transition: running -> completed
    const completionTime = Date.now() + 500;
    store.updateSimulationRunStatus(handle, 'completed', {
      completedAt: completionTime,
      eventCount: 42,
      resultSummary: { successRate: 1.0 },
      diagnostics: { durationMs: 500, warnings: ['mild test warning'], errors: [] },
    });

    run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.status).toBe('completed');
    expect(run.completedAt).toBe(completionTime);
    expect(run.eventCount).toBe(42);
    expect(run.resultSummary).toEqual({ successRate: 1.0 });
    expect(run.diagnostics?.warnings).toEqual(['mild test warning']);
  });

  test('6. Terminal run is immutable with respect to status and results', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });
    const runId = handle.runId;

    store.updateSimulationRunStatus(handle, 'completed', { resultSummary: { score: 100 } });

    // Attempt transition from completed -> running
    expect(() => store.updateSimulationRunStatus(handle, 'running')).toThrow(
      /Cannot transition terminal SimulationRun .* to running/
    );

    // Attempt transition from completed -> failed
    expect(() => store.updateSimulationRunStatus(handle, 'failed')).toThrow(
      /Cannot transition terminal SimulationRun .* to failed/
    );

    // Result remains pristine
    const run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.status).toBe('completed');
    expect(run.resultSummary).toEqual({ score: 100 });
  });

  test('7. Cannot activate SimulationRun cross Plan or cross Scenario', () => {
    const store = useTacticalStore.getState();
    // run belongs to plan_alpha_1 in scen_alpha
    const handleAlpha = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
    });
    const runAlphaId = handleAlpha.runId;

    // Switch active plan to plan_alpha_2
    store.switchActivePlan('plan_alpha_2');
    expect(useTacticalStore.getState().activePlanId).toBe('plan_alpha_2');

    // Attempt to set runAlphaId as active while activePlanId is plan_alpha_2 -> Must throw
    expect(() => store.setActiveSimulationRunId(runAlphaId)).toThrow(/Context mismatch/);
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();

    // Switch active scenario to scen_beta (and plan_beta_1)
    store.switchScenario('scen_beta');
    expect(() => store.setActiveSimulationRunId(runAlphaId)).toThrow(/Context mismatch/);

    // SelectActiveSimulationRun returns null
    expect(selectActiveSimulationRun(useTacticalStore.getState())).toBeNull();
  });

  test('8. Context switch resets activeSimulationRunId while preserving run history', () => {
    const store = useTacticalStore.getState();
    const handleAlpha = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      autoActivate: true,
    });
    const runAlphaId = handleAlpha.runId;

    expect(useTacticalStore.getState().activeSimulationRunId).toBe(runAlphaId);
    expect(selectActiveSimulationRun(useTacticalStore.getState())?.id).toBe(runAlphaId);

    // Switching active plan resets activeSimulationRunId to null
    store.switchActivePlan('plan_alpha_2');
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();
    expect(selectActiveSimulationRun(useTacticalStore.getState())).toBeNull();

    // History is completely preserved
    const planAlpha1Runs = selectSimulationRunsByPlan(useTacticalStore.getState(), 'plan_alpha_1');
    expect(planAlpha1Runs.length).toBe(1);
    expect(planAlpha1Runs[0].id).toBe(runAlphaId);
  });

  test('9. Plan version guard protects in-flight runs and preserves historical runs without mutation', () => {
    const store = useTacticalStore.getState();
    // Registered when plan_alpha_1 has version 2
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });
    const runId = handle.runId;

    expect(useTacticalStore.getState().simulationRuns[runId].planVersion).toBe(2);

    // Increment plan version to 3
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        plan_alpha_1: { ...s.plans.plan_alpha_1, version: 3 },
      },
    }));

    // Historical run still captures version 2
    const run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.planVersion).toBe(2);
    // Historical run is NOT deleted or converted to failed just because plan was incremented
    expect(run.status).toBe('running');

    // Attempting to complete the run with stale planVersion throws Error
    expect(() => store.updateSimulationRunStatus(handle, 'completed')).toThrow(
      /stale/
    );

    // Attempting to activate the run with stale planVersion throws Error
    expect(() => store.setActiveSimulationRunId(runId)).toThrow(
      /stale/
    );

    // Legacy run (planVersion === undefined) remains compatible in history, but cannot be activated as current without provenance
    const legacyRun = {
      id: 'legacy_run_compat',
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      timestamp: 100,
      config: {},
    };
    useTacticalStore.setState((s) => ({
      simulationRuns: { ...s.simulationRuns, legacy_run_compat: legacyRun },
    }));
    expect(selectSimulationRunById(useTacticalStore.getState(), 'legacy_run_compat')).toEqual(legacyRun);
    expect(evaluateSimulationRunFreshness(useTacticalStore.getState(), legacyRun as any)).toBe('unknown');
    expect(isSimulationRunFresh(useTacticalStore.getState(), legacyRun as any)).toBe(false);
    expect(() => store.setActiveSimulationRunId('legacy_run_compat')).toThrow(/unverified provenance/);
  });

  test('10. Late async completion after workspace replacement rejected via generation guards', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      autoActivate: true,
    });
    const runId = handle.runId;

    const run = useTacticalStore.getState().simulationRuns[runId];
    expect(run.importGen).toBe(0);

    // Mismatched expectedWorkspaceGeneration rejected
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running', { expectedWorkspaceGeneration: (run.workspaceGeneration ?? 0) + 99 })
    ).toThrow(/Workspace generation mismatch/);

    // Simulate workspace replacement (lastImportGen incremented)
    useTacticalStore.setState((s) => ({
      lastImportGen: (s.lastImportGen || 0) + 1,
    }));

    // Late completion attempt rejected because run belongs to older generation
    expect(() =>
      store.updateSimulationRunStatus(handle, 'running')
    ).toThrow(/Workspace was replaced by import after registration/);

    // Run in store remains unmodified
    expect(useTacticalStore.getState().simulationRuns[runId].status).toBe('pending');
  });

  test('11. Legacy SimulationRun missing extended fields is readable and round-trips safely without unverified activation or lifecycle mutation', () => {
    const legacyRun = {
      id: 'legacy_run_01',
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      timestamp: 123456789,
      config: { scanSpeedRpm: 12 },
    };

    useTacticalStore.setState((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [legacyRun.id]: legacyRun,
      },
    }));

    const state = useTacticalStore.getState();
    // 1. Readable via read selectors
    expect(selectSimulationRunById(state, 'legacy_run_01')).toEqual(legacyRun);
    expect(selectSimulationRunsByPlan(state, 'plan_alpha_1')).toContainEqual(legacyRun);
    expect(selectSimulationRunsByScenario(state, 'scen_alpha')).toContainEqual(legacyRun);

    // 2. Freshness is unknown, isSimulationRunFresh is false (not assumed current)
    expect(evaluateSimulationRunFreshness(state, legacyRun as any)).toBe('unknown');
    expect(isSimulationRunFresh(state, legacyRun as any)).toBe(false);

    // 3. Cannot be activated as current (blocks unverified activation)
    expect(() => state.setActiveSimulationRunId('legacy_run_01')).toThrow(/unverified provenance/);
    expect(selectActiveSimulationRun(useTacticalStore.getState())).toBeNull();

    // 4. Historical legacy record without status is read-only (cannot transition to completed)
    expect(() =>
      state.updateSimulationRunStatus('legacy_run_01', 'completed')
    ).toThrow(/Historical legacy run without execution lifecycle status is read-only/);

    // 5. Preserved in round-trip via package export/import without fabricating status or metadata
    const pkg = state.exportCanonicalPackageV2('test_legacy_roundtrip');
    expect(pkg.simulationRuns['legacy_run_01']).toEqual(legacyRun);
    state.importCanonicalPackage(pkg);
    const importedRun = selectSimulationRunById(useTacticalStore.getState(), 'legacy_run_01');
    expect(importedRun).toEqual(legacyRun);
    expect(importedRun?.status).toBeUndefined();
    expect(importedRun?.startedAt).toBeUndefined();
    expect(importedRun?.resultSummary).toBeUndefined();
  });

  test('12. Purge blockers remain strictly effective for SimulationRun', () => {
    const store = useTacticalStore.getState();
    store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
    });

    // 1. Draft plan with simulation runs cannot even be moved to trash
    expect(() => store.trashDraftPlan('plan_alpha_1')).toThrow(
      /Cannot trash plan referenced by simulation runs/
    );

    // 2. For an already trashed plan that has a SimulationRun, isPlanEligibleForPurge blocks it with SimulationRun reason
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        plan_trashed_with_run: {
          id: 'plan_trashed_with_run',
          scenarioId: 'scen_alpha',
          version: 1,
          name: 'Phương Án Rác Có Run',
          status: 'trashed',
        },
      },
      simulationRuns: {
        ...s.simulationRuns,
        run_trashed: {
          id: 'run_trashed',
          scenarioId: 'scen_alpha',
          planId: 'plan_trashed_with_run',
          timestamp: 100,
          config: {},
        },
      },
    }));

    const el = isPlanEligibleForPurge(useTacticalStore.getState(), 'plan_trashed_with_run');
    expect(el.eligible).toBe(false);
    expect(el.reason).toMatch(/SimulationRun/);

    const summary = store.getTrashSummary('plans');
    const retained = summary.retainedPlans.find((r) => r.plan.id === 'plan_trashed_with_run');
    expect(retained).toBeDefined();
    expect(retained?.reason).toMatch(/SimulationRun/);

    // 3. Scenario with simulation runs cannot be trashed
    expect(() => store.trashDraftScenario('scen_alpha')).toThrow(
      /Cannot trash scenario referenced by simulation runs/
    );
  });

  test('13. SimulationRun operations do not trigger unintentional SPx recalculation', () => {
    const store = useTacticalStore.getState();
    const initialToken = store.spxRecalculateToken || 0;

    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
      autoActivate: true,
    });
    store.updateSimulationRunStatus(handle, 'completed');
    store.setActiveSimulationRunId(null);

    // SPx recalculate token must not have changed
    expect(useTacticalStore.getState().spxRecalculateToken || 0).toBe(initialToken);
  });

  test('14. Workspace audit hash changes on run creation and status transition, remaining deterministic under key sorting', () => {
    const stateBefore = useTacticalStore.getState();
    const payloadBefore = computeWorkspacePayload(stateBefore);
    const hashBefore = computeHash(JSON.stringify(payloadBefore));

    // Register a new run
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
    });
    const runId = handle.runId;

    const stateRegistered = useTacticalStore.getState();
    const payloadRegistered = computeWorkspacePayload(stateRegistered);
    const hashRegistered = computeHash(JSON.stringify(payloadRegistered));

    // Proves hash and payload change on run creation
    expect(payloadRegistered.simulationRuns.length).toBe(payloadBefore.simulationRuns.length + 1);
    expect(payloadRegistered.simulationRuns.some((r: any) => r.id === runId)).toBe(true);
    expect(hashRegistered).not.toBe(hashBefore);

    // Transition run status: pending -> running
    store.updateSimulationRunStatus(handle, 'running');
    const stateRunning = useTacticalStore.getState();
    const payloadRunning = computeWorkspacePayload(stateRunning);
    const hashRunning = computeHash(JSON.stringify(payloadRunning));

    // Proves hash changes on run status update
    expect(hashRunning).not.toBe(hashRegistered);

    // Transition run status: running -> completed
    store.updateSimulationRunStatus(handle, 'completed', { resultSummary: { test: true } });
    const stateCompleted = useTacticalStore.getState();
    const payloadCompleted = computeWorkspacePayload(stateCompleted);
    const hashCompleted = computeHash(JSON.stringify(payloadCompleted));

    expect(hashCompleted).not.toBe(hashRunning);

    // Deterministic sorting proof: inserting runs into store in reversed key order produces identical payload
    const runA = {
      id: 'sim_det_1',
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      timestamp: 1000,
      config: { a: 1 },
      status: 'completed' as const,
    };
    const runB = {
      id: 'sim_det_2',
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      timestamp: 2000,
      config: { b: 2 },
      status: 'pending' as const,
    };

    useTacticalStore.setState({
      simulationRuns: {
        sim_det_2: runB,
        sim_det_1: runA, // Out of order
      },
    });

    const payloadDet1 = computeWorkspacePayload(useTacticalStore.getState());

    useTacticalStore.setState({
      simulationRuns: {
        sim_det_1: runA,
        sim_det_2: runB, // In order
      },
    });

    const payloadDet2 = computeWorkspacePayload(useTacticalStore.getState());
    expect(JSON.stringify(payloadDet1)).toBe(JSON.stringify(payloadDet2));
    expect(computeHash(JSON.stringify(payloadDet1))).toBe(computeHash(JSON.stringify(payloadDet2)));
  });

  test('15. selectActiveEquipment does not leak simulated state on dangling or mismatched activeSimulationRunId', () => {
    // Setup state with placement c1
    useTacticalStore.setState({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 0, aglM: 0 }, network: {} } as any,
      },
      definitions: {
        d1: { id: 'd1', planId: 'plan_alpha_1', category: 'RadarCanhGioi', rangeKm: 100, capabilities: {} } as any,
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any,
      },
      visuals: {
        c1: { color: 'red', showDome: true } as any,
      },
      simulations: {
        dangling_run: {
          c1: { runId: 'dangling_run', placementId: 'c1', timeOffset: 0, currentSweepHeading: 99 } as any,
        },
        other_plan_run: {
          c1: { runId: 'other_plan_run', placementId: 'c1', timeOffset: 0, currentSweepHeading: 88 } as any,
        },
        valid_matching_run: {
          c1: { runId: 'valid_matching_run', placementId: 'c1', timeOffset: 0, currentSweepHeading: 77 } as any,
        },
      },
    });

    const matchingFp = computePlanInputFingerprint(useTacticalStore.getState(), 'plan_alpha_1');
    useTacticalStore.setState({
      simulationRuns: {
        other_plan_run: {
          id: 'other_plan_run',
          scenarioId: 'scen_alpha',
          planId: 'plan_other', // Different plan!
          timestamp: 10,
          config: {},
        } as any,
        valid_matching_run: {
          id: 'valid_matching_run',
          scenarioId: 'scen_alpha',
          planId: 'plan_alpha_1', // Matching!
          planVersion: 2,
          timestamp: 20,
          config: {},
          status: 'completed',
          planInputFingerprint: matchingFp,
        } as any,
      },
    });

    // Case A: Dangling activeSimulationRunId (does not exist in simulationRuns) -> Must NOT read simulations
    useTacticalStore.setState({ activeSimulationRunId: 'dangling_run' });
    let activeEquipment = selectActiveEquipment(useTacticalStore.getState());
    expect(activeEquipment.length).toBe(1);
    expect(activeEquipment[0].currentSweepHeading).toBeUndefined();

    // Case B: Cross-plan activeSimulationRunId (run exists, but planId is plan_other) -> Must NOT read simulations
    useTacticalStore.setState({ activeSimulationRunId: 'other_plan_run' });
    activeEquipment = selectActiveEquipment(useTacticalStore.getState());
    expect(activeEquipment.length).toBe(1);
    expect(activeEquipment[0].currentSweepHeading).toBeUndefined();

    // Case C: Valid matching activeSimulationRunId -> Reads simulations
    useTacticalStore.setState({ activeSimulationRunId: 'valid_matching_run' });
    activeEquipment = selectActiveEquipment(useTacticalStore.getState());
    expect(activeEquipment.length).toBe(1);
    expect(activeEquipment[0].currentSweepHeading).toBe(77);
  });

  // === CHECKPOINT 2C.1 REGRESSION TESTS (Round 2) ===

  test('16. Plan A Run in-flight completes into Plan A history when switched to Plan B, active Plan B untouched', () => {
    // Setup equipment for plan_alpha_1 and plan_alpha_2
    useTacticalStore.setState((s) => ({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        ...s.placements,
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 0, aglM: 0 }, network: {} } as any,
        c2: { id: 'c2', planId: 'plan_alpha_2', definitionId: 'd2', position: { lat: 15, lon: 25, altM: 0, aglM: 0 }, network: {} } as any,
      },
      definitions: {
        ...s.definitions,
        d1: { id: 'd1', planId: 'plan_alpha_1', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 1', rangeKm: 100, capabilities: {} } as any,
        d2: { id: 'd2', planId: 'plan_alpha_2', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 2', rangeKm: 100, capabilities: {} } as any,
      },
      observations: {
        ...s.observations,
        c1: { placementId: 'c1', status: 'Active' } as any,
        c2: { placementId: 'c2', status: 'Active' } as any,
      },
      visuals: {
        ...s.visuals,
        c1: { color: 'red', showDome: true } as any,
        c2: { color: 'blue', showDome: true } as any,
      },
    }));

    const store = useTacticalStore.getState();
    expect(store.activePlanId).toBe('plan_alpha_1');

    const handleA = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });

    // Switch active plan to plan_alpha_2
    store.switchActivePlan('plan_alpha_2');
    expect(useTacticalStore.getState().activePlanId).toBe('plan_alpha_2');
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();

    // Completion of Plan A run completes successfully into Plan A history
    store.updateSimulationRunStatus(handleA, 'completed', {
      resultSummary: { finalScore: 95 },
    });

    const state = useTacticalStore.getState();
    const runA = state.simulationRuns[handleA.runId];
    expect(runA.status).toBe('completed');
    expect(runA.resultSummary).toEqual({ finalScore: 95 });

    // Active context of Plan B remains untouched
    expect(state.activePlanId).toBe('plan_alpha_2');
    expect(state.activeSimulationRunId).toBeNull();

    // Simulated state does NOT leak onto Plan B
    const activeEquipment = selectActiveEquipment(state);
    expect(activeEquipment.length).toBeGreaterThan(0);
    for (const eq of activeEquipment) {
      expect(eq.currentSweepHeading).toBeUndefined();
    }
  });

  test('17. Workspace replacement via import strictly rejects late async completion', () => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });

    // Simulate workspace replacement (lastImportGen bumped)
    useTacticalStore.setState((s) => ({
      lastImportGen: (s.lastImportGen || 0) + 1,
    }));

    // Late completion attempt rejected
    expect(() =>
      store.updateSimulationRunStatus(handle, 'completed')
    ).toThrow(/Workspace was replaced by import after registration/);

    // Run remains running and unmodified
    expect(useTacticalStore.getState().simulationRuns[handle.runId].status).toBe('running');
  });

  test('18. Reused runId across execution incarnation strictly rejects stale caller', () => {
    const store = useTacticalStore.getState();

    // Execution 1 registers with customRunId 'shared_run_id'
    const handle1 = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      customRunId: 'shared_run_id',
      initialStatus: 'running',
    });
    expect(handle1.runId).toBe('shared_run_id');
    const token1 = handle1.runToken;

    // Reviewer Point 1: registerSimulationRun MUST reject customRunId that already exists in active registry
    expect(() =>
      store.registerSimulationRun({
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha_1',
        customRunId: 'shared_run_id',
        initialStatus: 'running',
      })
    ).toThrow(/already exists in active registry/);

    // Reviewer Point 1: Workspace replacement via real import where new workspace re-uses the same runId
    const currentPkg = store.exportCanonicalPackageV2('pre_replacement');
    // Prepare replaced package without 'shared_run_id' so it can be registered anew in the new workspace
    delete currentPkg.simulationRuns['shared_run_id'];
    store.importCanonicalPackage(currentPkg);

    // Verify lastImportGen bumped and run removed by import replacement
    expect(useTacticalStore.getState().simulationRuns['shared_run_id']).toBeUndefined();

    // Execution 2 in the new workspace generation registers with the same customRunId 'shared_run_id'
    const handle2 = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      customRunId: 'shared_run_id',
      initialStatus: 'running',
    });
    expect(handle2.runId).toBe('shared_run_id');
    const token2 = handle2.runToken;
    expect(token2).not.toBe(token1);

    // Stale caller holding token1 (or old handle from previous workspace) attempts to complete the run
    expect(() =>
      store.updateSimulationRunStatus('shared_run_id', 'completed')
    ).toThrow(/Invalid or missing execution incarnation token/);

    expect(() =>
      store.updateSimulationRunStatus(handle1, 'completed')
    ).toThrow(); // Rejected by caller generation or token check

    // Newly registered run in store is NOT modified by the stale caller
    expect(useTacticalStore.getState().simulationRuns['shared_run_id'].status).toBe('running');
    expect(useTacticalStore.getState().simulationRuns['shared_run_id'].runToken).toBe(token2);

    // Legitimate caller holding token2 can complete the run
    store.updateSimulationRunStatus(handle2, 'completed', { resultSummary: { incarnation: 2 } });
    expect(useTacticalStore.getState().simulationRuns['shared_run_id'].status).toBe('completed');
    expect(useTacticalStore.getState().simulationRuns['shared_run_id'].resultSummary).toEqual({ incarnation: 2 });
  });

  test('19. Mutating numerical plan inputs invalidates active simulated state without bumping version, restoring inputs restores freshness', () => {
    // Setup state with placement c1 and definition d1 in plan_alpha_1
    useTacticalStore.setState((s) => ({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        ...s.placements,
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10.0, lon: 20.0, altM: 100, aglM: 20 }, network: {} } as any,
      },
      definitions: {
        ...s.definitions,
        d1: { id: 'd1', planId: 'plan_alpha_1', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 1', rangeKm: 150, scanSpeed: 12, minElevationDeg: 0, maxElevationDeg: 30, coverageHeightKm: 20, capabilities: {} } as any,
      },
      observations: {
        ...s.observations,
        c1: { placementId: 'c1', status: 'Active' } as any,
      },
      visuals: {
        ...s.visuals,
        c1: { color: 'blue', showDome: true } as any,
      },
    }));

    const store = useTacticalStore.getState();

    // Ensure we are on scen_alpha and plan_alpha_1 with placement c1
    store.switchActivePlan('plan_alpha_1');
    const state0 = useTacticalStore.getState();
    const placementC1 = state0.placements['c1'];
    expect(placementC1).toBeDefined();
    const originalLat = placementC1.position.lat;
    const initialPlanVersion = state0.plans['plan_alpha_1'].version;

    // Register and complete a simulation run
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
      autoActivate: true,
    });
    store.updateSimulationRunStatus(handle, 'completed');
    store.setActiveSimulationRunId(handle.runId);

    // Attach simulated operational state
    useTacticalStore.setState((s) => ({
      simulations: {
        ...s.simulations,
        [handle.runId]: {
          c1: { runId: handle.runId, placementId: 'c1', timeOffset: 0, currentSweepHeading: 275 } as any,
        },
      },
    }));

    // Verify initially active and fresh
    let state = useTacticalStore.getState();
    let run = state.simulationRuns[handle.runId];
    expect(isSimulationRunFresh(state, run)).toBe(true);
    expect(selectActiveSimulationRun(state)?.id).toBe(handle.runId);
    let activeEquipment = selectActiveEquipment(state);
    expect(activeEquipment.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(275);

    // Real plan mutation: mutate numerical coordinates via store action (does NOT bump plan.version)
    store.updateEquipment('c1', { latitude: originalLat + 0.15 });

    state = useTacticalStore.getState();
    // Confirm plan.version did NOT change
    expect(state.plans['plan_alpha_1'].version).toBe(initialPlanVersion);

    // Run is now stale
    run = state.simulationRuns[handle.runId];
    expect(isSimulationRunFresh(state, run)).toBe(false);

    // selectActiveSimulationRun returns null
    expect(selectActiveSimulationRun(state)).toBeNull();

    // selectActiveEquipment does NOT hydrate simulated state
    activeEquipment = selectActiveEquipment(state);
    expect(activeEquipment.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBeUndefined();

    // Trying to re-activate the stale run throws error
    expect(() => store.setActiveSimulationRunId(handle.runId)).toThrow(/Run is stale/);

    // Run execution status in history remains completed (not modified or corrupted)
    expect(state.simulationRuns[handle.runId].status).toBe('completed');

    // Restoring exact numerical inputs restores freshness
    store.updateEquipment('c1', { latitude: originalLat });

    state = useTacticalStore.getState();
    run = state.simulationRuns[handle.runId];
    expect(isSimulationRunFresh(state, run)).toBe(true);
    expect(selectActiveSimulationRun(state)?.id).toBe(handle.runId);
    activeEquipment = selectActiveEquipment(state);
    expect(activeEquipment.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(275);
  });

  test('20. Memoized selectActiveEquipment invalidates projection on plan.version, scenario status, or lastImportGen change', () => {
    // Setup state with active plan, placement c1 and active fresh simulation run
    useTacticalStore.setState((s) => ({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        ...s.placements,
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 100, aglM: 20 }, network: {} } as any,
      },
      definitions: {
        ...s.definitions,
        d1: { id: 'd1', planId: 'plan_alpha_1', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 1', rangeKm: 150, scanSpeed: 12, minElevationDeg: 0, maxElevationDeg: 30, coverageHeightKm: 20, capabilities: {} } as any,
      },
      observations: {
        ...s.observations,
        c1: { placementId: 'c1', status: 'Active' } as any,
      },
      visuals: {
        ...s.visuals,
        c1: { color: 'blue', showDome: true } as any,
      },
    }));

    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
      autoActivate: true,
    });
    store.updateSimulationRunStatus(handle, 'completed');
    store.setActiveSimulationRunId(handle.runId);

    useTacticalStore.setState((s) => ({
      simulations: {
        ...s.simulations,
        [handle.runId]: {
          c1: { runId: handle.runId, placementId: 'c1', timeOffset: 0, currentSweepHeading: 315 } as any,
        },
      },
    }));

    // Initially active and fresh, simulated heading is projected
    let eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(315);

    // Case A: Bump plan.version without changing placements -> must invalidate cached projection
    const prevPlan = useTacticalStore.getState().plans['plan_alpha_1'];
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        plan_alpha_1: { ...prevPlan, version: prevPlan.version + 1 },
      },
    }));
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBeUndefined();

    // Restoring plan.version restores cached projection
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        plan_alpha_1: prevPlan,
      },
    }));
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(315);

    // Case B: Scenario lifecycle change (trashed) without changing placements -> must invalidate cached projection
    const prevScenario = useTacticalStore.getState().scenarios['scen_alpha'];
    useTacticalStore.setState((s) => ({
      scenarios: {
        ...s.scenarios,
        scen_alpha: { ...prevScenario, status: 'trashed' as const },
      },
    }));
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBeUndefined();

    // Restoring scenario status restores cached projection
    useTacticalStore.setState((s) => ({
      scenarios: {
        ...s.scenarios,
        scen_alpha: prevScenario,
      },
    }));
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(315);

    // Case C: lastImportGen change without changing placements -> must invalidate cached projection
    const prevImportGen = useTacticalStore.getState().lastImportGen;
    useTacticalStore.setState((s) => ({
      lastImportGen: (s.lastImportGen || 0) + 1,
    }));
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBeUndefined();

    // Restoring lastImportGen restores cached projection
    useTacticalStore.setState({ lastImportGen: prevImportGen });
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(315);

    // Case D: activeTerrainProviderKey change without changing placements -> must invalidate cached projection
    const prevTerrainKey = useTacticalStore.getState().activeTerrainProviderKey;
    useTacticalStore.setState({ activeTerrainProviderKey: 'vietnam_dem_highres' });
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBeUndefined();

    useTacticalStore.setState({ activeTerrainProviderKey: prevTerrainKey });
    eq = selectActiveEquipment(useTacticalStore.getState());
    expect(eq.find((e) => e.instanceId === 'c1')?.currentSweepHeading).toBe(315);
  });

  test('21. Semantic fingerprint reflects terrain and execution inputs, while presentation changes do not cause false-stale', () => {
    useTacticalStore.setState({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 100, aglM: 20 }, network: {} } as any,
      },
      definitions: {
        d1: { id: 'd1', planId: 'plan_alpha_1', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 1', rangeKm: 150, scanSpeed: 12, minElevationDeg: 0, maxElevationDeg: 30, coverageHeightKm: 20, capabilities: {} } as any,
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any,
      },
      visuals: {
        c1: { color: 'blue', showDome: true } as any,
      },
    });

    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      configSnapshot: { timeStepSeconds: 2, durationSeconds: 120 },
      randomSeed: 42,
      initialStatus: 'running',
    });
    store.updateSimulationRunStatus(handle, 'completed');

    let state = useTacticalStore.getState();
    let run = state.simulationRuns[handle.runId];
    expect(isSimulationRunFresh(state, run)).toBe(true);

    // Changing terrain provider key invalidates freshness (execution-impacting input)
    const originalProviderKey = state.activeTerrainProviderKey;
    store.setActiveTerrainProviderKey('custom_srtm_provider');
    state = useTacticalStore.getState();
    expect(isSimulationRunFresh(state, run)).toBe(false);

    // Restoring terrain provider restores freshness
    store.setActiveTerrainProviderKey(originalProviderKey as any);
    state = useTacticalStore.getState();
    expect(isSimulationRunFresh(state, run)).toBe(true);

    // Presentation changes: display name, visual color, plan display name must NOT cause false-stale
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        plan_alpha_1: { ...s.plans['plan_alpha_1'], name: 'Tên Phương Án Trình Diễn Đã Sửa' },
      },
      visuals: {
        ...s.visuals,
        c1: { ...s.visuals['c1'], color: '#00ffcc', showDome: false },
      },
      definitions: {
        ...s.definitions,
        d1: { ...s.definitions['d1'], name: 'Radar 36D6 Mới Hiển Thị' },
      },
    }));

    state = useTacticalStore.getState();
    // Freshness remains true (semantic inputs untouched, no false-stale)
    expect(isSimulationRunFresh(state, run)).toBe(true);

    // Physical C2 command chain change invalidates freshness
    useTacticalStore.setState((s) => ({
      placements: {
        ...s.placements,
        c1: { ...s.placements['c1'], network: { commandedBy: 'c2_regiment_hanoi' } },
      },
    }));
    state = useTacticalStore.getState();
    expect(isSimulationRunFresh(state, run)).toBe(false);
  });

  test('22. Canonical package import distinguishes historical runs from old async handles', () => {
    const store = useTacticalStore.getState();

    // Register a live in-flight run in current workspace
    const oldHandle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });

    // Create a canonical package representing an imported workspace with an imported historical run
    const histRunId = 'hist_run_imported_v1';
    const importedPkg = store.exportCanonicalPackageV2('hist_test');
    importedPkg.simulationRuns[histRunId] = {
      id: histRunId,
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      timestamp: 5000,
      config: { durationSeconds: 30 },
      status: 'completed',
      // Legacy imported runs do NOT have runToken or importGen
    };

    // Execute real import action
    store.importCanonicalPackage(importedPkg);

    const state = useTacticalStore.getState();

    // 1. Historical imported run is fully readable via selectors
    const histRun = selectSimulationRunById(state, histRunId);
    expect(histRun).toBeDefined();
    expect(histRun?.status).toBe('completed');
    expect(histRun?.config).toEqual({ durationSeconds: 30 });

    const planRuns = selectSimulationRunsByPlan(state, 'plan_alpha_1');
    expect(planRuns.some((r) => r.id === histRunId)).toBe(true);

    // 2. Old async handle from previous workspace generation is strictly blocked
    expect(() =>
      store.updateSimulationRunStatus(oldHandle, 'completed')
    ).toThrow(/Workspace was replaced by import after registration/);

    // 3. Historical imported run cannot be mutated with an active execution token
    expect(() =>
      store.updateSimulationRunStatus(histRunId, 'completed', { runToken: 'rt_fake_active_token' })
    ).toThrow(/Record is an imported historical run without an active execution incarnation token/);
  });

  test('23. Stale inputs do not delete or alter completed executionStatus of historical runs', () => {
    useTacticalStore.setState({
      activeScenarioId: 'scen_alpha',
      activePlanId: 'plan_alpha_1',
      placements: {
        c1: { id: 'c1', planId: 'plan_alpha_1', definitionId: 'd1', position: { lat: 10, lon: 20, altM: 100, aglM: 20 }, network: {} } as any,
      },
      definitions: {
        d1: { id: 'd1', planId: 'plan_alpha_1', templateId: 'radar_36d6', category: 'RadarCanhGioi', name: 'Radar 1', rangeKm: 150, scanSpeed: 12, minElevationDeg: 0, maxElevationDeg: 30, coverageHeightKm: 20, capabilities: {} } as any,
      },
      observations: {
        c1: { placementId: 'c1', status: 'Active' } as any,
      },
      visuals: {
        c1: { color: 'blue', showDome: true } as any,
      },
    });

    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_alpha',
      planId: 'plan_alpha_1',
      initialStatus: 'running',
    });
    store.updateSimulationRunStatus(handle, 'completed', {
      resultSummary: { finalScore: 98 },
    });

    let state = useTacticalStore.getState();
    let run = selectSimulationRunById(state, handle.runId);
    expect(run?.status).toBe('completed');
    expect(isSimulationRunFresh(state, run)).toBe(true);

    // Plan input changes drastically (e.g. coordinates shift)
    useTacticalStore.setState((s) => ({
      placements: {
        ...s.placements,
        c1: { ...s.placements['c1'], position: { lat: 99.0, lon: 99.0, altM: 500, aglM: 10 } },
      },
    }));

    state = useTacticalStore.getState();
    run = selectSimulationRunById(state, handle.runId);

    // Run is still present in history and status remains 'completed'
    expect(run).toBeDefined();
    expect(run?.status).toBe('completed');
    expect(run?.resultSummary).toEqual({ finalScore: 98 });

    // Freshness is false, but executionStatus was NOT mutated or deleted
    expect(isSimulationRunFresh(state, run)).toBe(false);

    // Restoring plan input restores freshness while executionStatus remains 'completed'
    useTacticalStore.setState((s) => ({
      placements: {
        ...s.placements,
        c1: { ...s.placements['c1'], position: { lat: 10, lon: 20, altM: 100, aglM: 20 } },
      },
    }));

    state = useTacticalStore.getState();
    run = selectSimulationRunById(state, handle.runId);
    expect(run?.status).toBe('completed');
    expect(isSimulationRunFresh(state, run)).toBe(true);
  });
});
