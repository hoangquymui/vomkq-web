import { describe, test, expect, beforeEach } from 'vitest';
import { useTacticalStore, selectActiveEquipment } from '../../store/useTacticalStore';
import { migrateLegacyLayoutToV1 } from './legacyLayoutMigration';
import type { LayoutSaveData } from '../../types/layout';

describe('1H Versioned Canonical Serialization', () => {
  const resetStore = () => {
    useTacticalStore.setState({
      scenarios: { 's_sample': { id: 's_sample', name: 'S', terrainVersion: 'v1', status: 'draft', createdAt: Date.now() } },
      plans: { 'p_sample': { id: 'p_sample', scenarioId: 's_sample', version: 1, name: 'P', status: 'draft' } },
      activeScenarioId: 's_sample',
      activePlanId: 'p_sample',
      activeSimulationRunId: null,
      simulationRuns: {},
      placements: {}, definitions: {}, observations: {}, simulations: {}, visuals: {},
      canonicalInitialized: true,
    });
  };

  beforeEach(() => {
    resetStore();
    useTacticalStore.getState().loadSampleScenario();
  });

  test('A. canonical export -> load round-trip matches identically', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    
    const reExported = useTacticalStore.getState().exportCanonicalPackage();
    expect(reExported.scenarios).toEqual(exported.scenarios);
    expect(reExported.plans).toEqual(exported.plans);
    expect(reExported.placements).toEqual(exported.placements);
    expect(reExported.definitions).toEqual(exported.definitions);
    expect(reExported.observations).toEqual(exported.observations);
    expect(reExported.simulations).toEqual(exported.simulations);
  });

  test('B. Scenario/Plan/Placement/Definition IDs preserved exactly', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    
    const storeState = useTacticalStore.getState();
    expect(Object.keys(storeState.scenarios)).toEqual(Object.keys(exported.scenarios));
    expect(Object.keys(storeState.plans)).toEqual(Object.keys(exported.plans));
    expect(Object.keys(storeState.placements)).toEqual(Object.keys(exported.placements));
    expect(Object.keys(storeState.definitions)).toEqual(Object.keys(exported.definitions));
  });

  test('C. placement.planId and definition.planId ownership preserved', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    
    const storeState = useTacticalStore.getState();
    for (const [id, placement] of Object.entries(storeState.placements)) {
      expect(placement.planId).toBe(exported.placements[id].planId);
    }
    for (const [id, def] of Object.entries(storeState.definitions)) {
      expect(def.planId).toBe(exported.definitions[id].planId);
    }
  });

  test('D. observations preserved by Placement ID', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    
    const storeState = useTacticalStore.getState();
    expect(Object.keys(storeState.observations)).toEqual(Object.keys(exported.observations));
  });

  test('E. simulations preserved by runId + Placement ID', () => {
    useTacticalStore.setState({
      simulations: {
        'run1': {
          'some_placement_id': { runId: 'run1', placementId: 'some_placement_id', timeOffset: 0, currentSweepHeading: 45 }
        }
      }
    });
    
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    expect(exported.simulations['run1']['some_placement_id'].currentSweepHeading).toBe(45);
    
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    
    expect(useTacticalStore.getState().simulations['run1']['some_placement_id'].currentSweepHeading).toBe(45);
  });

  test('F. poisoned instances[] does not affect canonical export', () => {
    const exportedBefore = useTacticalStore.getState().exportCanonicalPackage();
    
    // Poison instances
    useTacticalStore.setState({ instances: [{ instanceId: 'POISON' }] } as any);
    
    const exportedAfter = useTacticalStore.getState().exportCanonicalPackage();
    expect(exportedAfter.placements).toEqual(exportedBefore.placements);
    expect(exportedAfter.placements['POISON']).toBeUndefined();
  });

  test('G. canonical loader rejects missing schemaVersion', () => {
    const pkg: any = useTacticalStore.getState().exportCanonicalPackage();
    delete pkg.schemaVersion;
    expect(() => useTacticalStore.getState().importCanonicalPackage(pkg)).toThrow(/Unsupported schema version/);
  });

  test('H. explicit legacy adapter converts valid LayoutSaveData', () => {
    const legacy: LayoutSaveData = {
      layoutName: 'Test Legacy',
      savedAtIso8601: new Date().toISOString(),
      equipments: [
        {
          instanceId: 'leg_1',
          templateId: 'radar_36d6',
          shortId: 'R-01',
          latitude: 21,
          longitude: 105,
          groundElevationMeters: 10,
          antennaHeightAGL: 20,
          currentRange: 300,
          currentScanSpeed: 10,
          currentMinElevation: 0,
          currentMaxElevation: 30,
          currentCoverageHeight: 30,
          status: 0,
          posX: 0, posY: 0, posZ: 0
        }
      ]
    };
    const v1 = migrateLegacyLayoutToV1(legacy);
    expect(v1.schemaVersion).toBe(1);
    expect(Object.keys(v1.placements).length).toBe(1);
    expect(Object.keys(v1.definitions).length).toBe(1);
  });

  test('I. identical legacy input produces deterministic migration output', () => {
    const legacy: LayoutSaveData = {
      layoutName: 'Det',
      savedAtIso8601: '2023-01-01T00:00:00Z',
      equipments: [
        {
          instanceId: 'id1',
          templateId: 'radar_p18',
          posX: 0, posY: 0, posZ: 0,
          latitude: 0, longitude: 0, groundElevationMeters: 0,
          antennaHeightAGL: 10, currentRange: 100, currentScanSpeed: 10,
          currentMinElevation: 0, currentMaxElevation: 10, currentCoverageHeight: 10,
          status: 0
        }
      ]
    };
    const v1A = migrateLegacyLayoutToV1(legacy);
    const v1B = migrateLegacyLayoutToV1(legacy);
    
    expect(v1A).toEqual(v1B);
    expect(v1A.scenarios['s_legacy_migrated'].createdAt).toBe(new Date('2023-01-01T00:00:00Z').getTime());
  });

  test('J. future schemaVersion rejected', () => {
    const pkg: any = useTacticalStore.getState().exportCanonicalPackage();
    pkg.schemaVersion = 99;
    expect(() => useTacticalStore.getState().importCanonicalPackage(pkg)).toThrow(/Unsupported schema version: 99/);
  });

  test('K. malformed graph rejected before mutation', () => {
    const pkg: any = useTacticalStore.getState().exportCanonicalPackage();
    delete pkg.scenarios;
    expect(() => useTacticalStore.getState().importCanonicalPackage(pkg)).toThrow(/Malformed CanonicalStatePackageV1/);
  });

  test('L. failed load leaves previous store state unchanged', () => {
    const stateBefore = { ...useTacticalStore.getState().placements };
    const pkg: any = useTacticalStore.getState().exportCanonicalPackage();
    delete pkg.scenarios;
    try {
      useTacticalStore.getState().importCanonicalPackage(pkg);
    } catch (e) {}
    expect(useTacticalStore.getState().placements).toEqual(stateBefore);
  });

  test('M. package containing dangling Definition/Placement ownership fails', () => {
    const pkg = useTacticalStore.getState().exportCanonicalPackage();
    // Simulate a dangling placement (planId doesn't exist)
    const firstPlacementId = Object.keys(pkg.placements)[0];
    pkg.placements[firstPlacementId].planId = 'non_existent_plan';
    
    expect(() => useTacticalStore.getState().importCanonicalPackage(pkg)).toThrow(/references missing Plan non_existent_plan/);
  });

  test('N. canonical serialization never reconstructs authority from instances[]', () => {
    // 1. When canonical placements exist, emptying instances[] does not alter canonical export
    const canonicalCount = Object.keys(useTacticalStore.getState().placements).length;
    expect(canonicalCount).toBeGreaterThan(0);

    useTacticalStore.setState({ instances: [] } as any);
    const exportedFull = useTacticalStore.getState().exportCanonicalPackage();
    expect(Object.keys(exportedFull.placements).length).toBe(canonicalCount);

    // 2. When canonical state is reset/empty, rogue instances[] are never reconstructed into canonical package
    resetStore();
    expect(Object.keys(useTacticalStore.getState().placements).length).toBe(0);

    useTacticalStore.setState({
      instances: [
        { instanceId: 'ghost_legacy_1', name: 'Ghost Radar', templateId: 'radar_36d6' },
        { instanceId: 'ghost_legacy_2', name: 'Ghost SAM', templateId: 'sam_s300' }
      ]
    } as any);

    const exportedEmpty = useTacticalStore.getState().exportCanonicalPackage();
    expect(Object.keys(exportedEmpty.placements).length).toBe(0);
    expect(exportedEmpty.placements['ghost_legacy_1']).toBeUndefined();
    expect(exportedEmpty.placements['ghost_legacy_2']).toBeUndefined();
  });

  test('O. simulationRuns round-trip', () => {
    useTacticalStore.setState({
      simulationRuns: {
        'run1': { id: 'run1', planId: 'p_sample', scenarioId: 's_sample', timestamp: 123, config: {} }
      }
    });
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    expect(useTacticalStore.getState().simulationRuns['run1'].timestamp).toBe(123);
  });

  test('P. active context round-trip', () => {
    useTacticalStore.setState({
      simulationRuns: {
        'run1': { id: 'run1', planId: 'p_sample', scenarioId: 's_sample', timestamp: 123, config: {} }
      },
      activeSimulationRunId: 'run1'
    });
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    expect(useTacticalStore.getState().activeScenarioId).toBe('s_sample');
    expect(useTacticalStore.getState().activePlanId).toBe('p_sample');
    expect(useTacticalStore.getState().activeSimulationRunId).toBe('run1');
  });

  test('Q. stale active IDs cannot survive import', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.context.activeScenarioId = 'stale_scenario';
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/Context references missing Scenario stale_scenario/);
  });

  test('R. canonicalInitialized false -> canonical import -> true', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.setState({ canonicalInitialized: false });
    useTacticalStore.getState().importCanonicalPackage(exported);
    expect(useTacticalStore.getState().canonicalInitialized).toBe(true);
  });

  test('S. fresh instances projection produced inside same transition', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    expect(selectActiveEquipment(useTacticalStore.getState()).length).toBeGreaterThan(0);
  });

  test('T. exported package mutation cannot mutate store', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.context.activeScenarioId = 'mutated';
    expect(useTacticalStore.getState().activeScenarioId).not.toBe('mutated');
  });

  test('U. input package mutation after import cannot mutate store', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    resetStore();
    useTacticalStore.getState().importCanonicalPackage(exported);
    exported.context.activeScenarioId = 'mutated_after';
    expect(useTacticalStore.getState().activeScenarioId).not.toBe('mutated_after');
  });

  test('V. active plan belonging to another scenario is rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.plans['p_sample'].scenarioId = 'other_scenario';
    exported.scenarios['other_scenario'] = { ...exported.scenarios['s_sample'], id: 'other_scenario' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/Active Plan p_sample belongs to Scenario other_scenario, not Active Scenario s_sample/);
  });

  test('W. active simulation run belonging to another plan/scenario is rejected', () => {
    useTacticalStore.setState({
      simulationRuns: {
        'run1': { id: 'run1', planId: 'p_sample', scenarioId: 's_sample', timestamp: 123, config: {} }
      },
      activeSimulationRunId: 'run1'
    });
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    
    const badPlanPkg = structuredClone(exported);
    badPlanPkg.simulationRuns['run1'].planId = 'other_plan';
    expect(() => useTacticalStore.getState().importCanonicalPackage(badPlanPkg)).toThrow(/Active SimulationRun run1 belongs to Plan other_plan, not Active Plan p_sample/);

    const badScenarioPkg = structuredClone(exported);
    badScenarioPkg.simulationRuns['run1'].scenarioId = 'other_scenario';
    expect(() => useTacticalStore.getState().importCanonicalPackage(badScenarioPkg)).toThrow(/Active SimulationRun run1 belongs to Scenario other_scenario, not Active Scenario s_sample/);
  });

  test('X. failed relational validation leaves state unchanged', () => {
    const stateBefore = { ...useTacticalStore.getState().placements };
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.context.activePlanId = 'p_sample';
    exported.plans['p_sample'].scenarioId = 'other_scenario';
    exported.scenarios['other_scenario'] = { ...exported.scenarios['s_sample'], id: 'other_scenario' };
    try {
      useTacticalStore.getState().importCanonicalPackage(exported);
    } catch (e) {}
    expect(useTacticalStore.getState().placements).toEqual(stateBefore);
  });

  test('Y. cross-plan Definition rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    if (!Object.keys(exported.definitions).length) return;
    const defId = Object.keys(exported.definitions)[0];
    exported.definitions[defId].planId = 'some_other_plan';
    exported.plans['some_other_plan'] = { ...exported.plans['p_sample'], id: 'some_other_plan' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/cross-plan Definition/);
  });

  test('Z. Placement missing current Observation rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    if (!Object.keys(exported.placements).length) return;
    const placeId = Object.keys(exported.placements)[0];
    delete exported.observations[placeId];
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/missing current Observation/);
  });

  test('AA. Placement missing Visual rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    if (!Object.keys(exported.placements).length) return;
    const placeId = Object.keys(exported.placements)[0];
    delete exported.visuals[placeId];
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/missing current Visual/);
  });

  test('AB. orphan Visual rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.visuals['orphan_visual_id'] = {} as any;
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/is missing current Placement/);
  });

  test('AC. dangling commandedBy rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    if (!Object.keys(exported.placements).length) return;
    const placeId = Object.keys(exported.placements)[0];
    exported.placements[placeId].network = { commandedBy: 'non_existent_placement' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/missing commandedBy Placement non_existent_placement/);
  });

  test('AD. cross-plan commandedBy rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    if (!Object.keys(exported.placements).length) return;
    const placeId = Object.keys(exported.placements)[0];
    const defId = exported.placements[placeId].definitionId;
    
    exported.placements['other_placement'] = { ...exported.placements[placeId], id: 'other_placement', planId: 'other_plan', definitionId: 'other_def' };
    exported.plans['other_plan'] = { ...exported.plans['p_sample'], id: 'other_plan' };
    exported.definitions['other_def'] = { ...exported.definitions[defId], id: 'other_def', planId: 'other_plan' };
    exported.observations['other_placement'] = { ...exported.observations[placeId] };
    exported.visuals['other_placement'] = { ...exported.visuals[placeId] };
    
    exported.placements[placeId].network = { commandedBy: 'other_placement' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/cross-plan commandedBy Placement other_placement/);
  });

  test('AE. SimulationRun Plan/Scenario mismatch rejected', () => {
    useTacticalStore.setState({
      simulationRuns: {
        'run1': { id: 'run1', planId: 'p_sample', scenarioId: 's_sample', timestamp: 123, config: {} }
      }
    });
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.simulationRuns['run1'].scenarioId = 'other_scenario';
    exported.scenarios['other_scenario'] = { ...exported.scenarios['s_sample'], id: 'other_scenario' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/SimulationRun run1 Plan mismatch with Scenario/);
  });

  test('AF. registry key vs record.id mismatch rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.plans['p_mismatch'] = { ...exported.plans['p_sample'], id: 'p_correct' };
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/registry key mismatch/);
  });

  test('AG. historical Observation without current Placement remains valid', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.observations['historical_obs'] = { placementId: 'historical_obs', state: 'active', observationTime: 0 } as any;
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).not.toThrow();
  });

  test('AH. historical SimulationState for removed Placement remains valid', () => {
    useTacticalStore.setState({
      simulations: {
        'run1': {
          'historical_placement': { runId: 'run1', placementId: 'historical_placement', timeOffset: 0, currentSweepHeading: 45 }
        }
      },
      simulationRuns: {
        'run1': { id: 'run1', planId: 'p_sample', scenarioId: 's_sample', timestamp: 123, config: {} }
      }
    });
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).not.toThrow();
  });

  test('AI. activePlan without activeScenario rejected', () => {
    const exported = useTacticalStore.getState().exportCanonicalPackage();
    exported.context.activeScenarioId = null;
    exported.context.activePlanId = 'p_sample';
    expect(() => useTacticalStore.getState().importCanonicalPackage(exported)).toThrow(/Context cannot have activePlanId without activeScenarioId/);
  });
});
