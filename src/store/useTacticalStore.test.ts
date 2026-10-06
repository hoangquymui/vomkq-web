// @ts-ignore
import { test, expect } from 'vitest';
import { useTacticalStore, validatePlanGraph, selectActiveEquipment, selectActivePlan, selectActivePlacements, selectEquipmentById, selectDefinitionForPlacement, selectObservationForPlacement, selectVisualForPlacement } from './useTacticalStore';

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
    instances: [],
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
    visuals: {},
    instances: []
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
  const sampleRadar = state.instances.find(i => i.templateId === 'radar_36d6');
  const sampleCmd = state.instances.find(i => i.templateId === 'c2_command_post');
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
  const importRadar = state.instances.find(i => i.templateId === 'radar_nebo_m');
  const importCmd = state.instances.find(i => i.templateId === 'c2_command_post');
  expect(importRadar).toBeDefined();
  expect(importCmd).toBeDefined();
  expect(importRadar?.commandedByInstanceId).toBe(importCmd?.instanceId);
  expect(importRadar?.commandedByInstanceId).not.toBe('old-cmd');

  // Test 9: switch invalid graph rejection and state preservation
  const oldActivePlanId = state.activePlanId;
  const oldInstancesLength = state.instances.length;
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
  expect(useTacticalStore.getState().instances.length).toBe(oldInstancesLength);

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
    activePlanId: 'plan-src',
    instances: [],
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
    activePlanId: 'plan-b',
    instances: [],
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
    activePlanId: 'plan-a',
    instances: [],
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
    instances: [],
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
    instances: [],
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
    instances: [],
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/conflicting plans/);
});

test('G. hydration preserves canonical-only Definition data', () => {
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
        // Canonical-only field not present in legacy EquipmentInstance
        canonicalOnlyData: canonicalOnlyField,
      } as any,
    },
    observations: { 'p-a': { status: 'Active' } as any },
    visuals: { 'p-a': {} as any },
    activeScenarioId: 'scen',
    activePlanId: 'plan-a',
    canonicalInitialized: false,
    instances: [{ instanceId: 'p-a', templateId: 'radar_nebo_m', category: 'RadarCanhGioi', shortId: 'R1', name: 'R1', latitude: 0, longitude: 0, altitude: 0, antennaHeightAGL: 0, rangeKm: 0, scanSpeed: 0, minElevationDeg: 0, maxElevationDeg: 0, coverageHeightKm: 0, status: 'Active', showDome: false, showSweep: false, color: 'blue' } as any],
  });
  useTacticalStore.getState()._hydrateLegacyToCanonical();
  const state = useTacticalStore.getState();
  // Canonical-only data must NOT be overwritten
  expect((state.definitions['p-a'] as any).canonicalOnlyData).toBe(canonicalOnlyField);
  // Identity must be unchanged
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
    instances: [],
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
    instances: [],
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
    activePlanId: 'plan-good',
    instances: [{ instanceId: 'p-good' } as any],
  });

  const beforePlanId = useTacticalStore.getState().activePlanId;
  const beforeInstances = useTacticalStore.getState().instances.length;

  expect(() => useTacticalStore.getState().switchActivePlan('plan-bad')).toThrow();
  expect(useTacticalStore.getState().activePlanId).toBe(beforePlanId);
  expect(useTacticalStore.getState().instances.length).toBe(beforeInstances);
});

test('K. duplicate import source IDs reject atomically', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {}, instances: [],
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
    placements: {}, definitions: {}, observations: {}, visuals: {}, instances: [],
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
    placements: {}, definitions: {}, observations: {}, visuals: {}, instances: [],
    activeScenarioId: null, activePlanId: null
  });
  expect(() => useTacticalStore.getState().ensureActiveWorkspace()).toThrow(/belongs to a different scenario/);
});

test('N. loadSampleScenario preserves the original sample dataset semantics', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {}, definitions: {}, observations: {}, visuals: {}, instances: [],
    activeScenarioId: 'scen', activePlanId: 'plan-a'
  });
  useTacticalStore.getState().loadSampleScenario();
  const state = useTacticalStore.getState();

  // Total sample items should be 9
  expect(state.instances.length).toBe(9);

  // Check exact data points from original dataset
  const tdao = state.instances.find(i => i.templateId === 'radar_36d6' && i.shortId === 'R-01');
  expect(tdao).toBeDefined();
  expect(tdao?.altitude).toBe(950);
  expect(tdao?.name).toContain('Tam Đảo');

  const fansipan = state.instances.find(i => i.templateId === 'radar_kolchuga' && i.shortId === 'ESM-01');
  expect(fansipan).toBeDefined();
  expect(fansipan?.altitude).toBe(3140);
});

test('O. invalid source Plan prevents createPlanAlternative atomically', () => {
  useTacticalStore.setState({
    scenarios: { 'scen': { id: 'scen', name: 'S', terrainVersion: 'v1', createdAt: 0, status: 'active' } },
    plans: { 'plan-a': { id: 'plan-a', scenarioId: 'scen', version: 1, name: 'A', status: 'draft' } },
    placements: {
      'p1': { id: 'p1', definitionId: 'd-missing', planId: 'plan-a', position: { lat: 0, lon: 0, altM: 0, aglM: 0 }, network: {} } as any,
    },
    definitions: {}, observations: {}, visuals: {}, instances: [],
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
    placements: {}, definitions: {}, observations: {}, visuals: {}, instances: [],
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
    instances: [],
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
    instances: [],
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
    instances: [],
    activeScenarioId: 'scen1',
    activePlanId: 'plan1',
    canonicalInitialized: true
  });

  useTacticalStore.getState()._syncLegacyInstances();

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
  expect(activeEq).toEqual(state.instances);

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

  // Still maintains parity after switch
  expect(activeEq2).toEqual(state2.instances);
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
    instances: [],
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
    instances: [],
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
    instances: [],
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
    instances: [],
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
