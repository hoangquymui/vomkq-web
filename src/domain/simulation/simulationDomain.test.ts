import { describe, it, expect } from 'vitest';
import {
  computePlanInputFingerprint,
} from './simulationFingerprint';
import {
  evaluateSimulationRunFreshness,
  isSimulationRunFresh,
  type SimulationFreshnessContext,
} from './simulationFreshness';
import { deepFreeze } from '../../utils/deepFreeze';
import * as storeExports from '../../store/useTacticalStore';
import type { Plan } from '../types/plan';
import type { Scenario } from '../types/scenario';
import type { EquipmentDefinition, EquipmentPlacement } from '../types/equipment';
import type { SimulationRun } from '../types/simulation';

describe('2C-R.1 Simulation Domain Foundation & Behavioral Parity', () => {
  const createBaseFixture = (): SimulationFreshnessContext => {
    const scenario: Scenario = {
      id: 'scen_alpha',
      name: 'Alpha Scenario',
      status: 'active',
      terrainVersion: 'v1',
      createdAt: 1000,
    };
    const plan: Plan = {
      id: 'plan_alpha',
      scenarioId: 'scen_alpha',
      version: 1,
      name: 'Alpha Plan',
      status: 'draft',
      alternativeId: 'plan_alpha',
      revisionNumber: 1,
      baseRevisionPlanId: null,
    };
    const def1: EquipmentDefinition = {
      id: 'def_1',
      planId: 'plan_alpha',
      name: 'Radar P-37',
      category: 'RadarCanhGioi',
      templateId: 'p37',
      rangeKm: 250,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 25,
      capabilities: {},
    };
    const def2: EquipmentDefinition = {
      id: 'def_2',
      planId: 'plan_alpha',
      name: 'Radar PRV-13',
      category: 'RadarCanhGioi',
      templateId: 'prs3',
      rangeKm: 180,
      scanSpeed: 12,
      minElevationDeg: -2,
      maxElevationDeg: 45,
      coverageHeightKm: 20,
      capabilities: {},
    };
    const p1: EquipmentPlacement = {
      id: 'p_alpha_01',
      planId: 'plan_alpha',
      definitionId: 'def_1',
      position: { lat: 21.0, lon: 105.8, altM: 50, aglM: 15 },
      network: { commandedBy: null },
    };
    const p2: EquipmentPlacement = {
      id: 'p_alpha_02',
      planId: 'plan_alpha',
      definitionId: 'def_2',
      position: { lat: 20.8, lon: 106.2, altM: 30, aglM: 10 },
      network: { commandedBy: 'p_alpha_01' },
    };

    return {
      scenarios: { scen_alpha: scenario },
      plans: { plan_alpha: plan },
      definitions: { def_1: def1, def_2: def2 },
      placements: { p_alpha_01: p1, p_alpha_02: p2 },
      activeTerrainProviderKey: 'flat_v1',
      lastImportGen: 1,
    };
  };

  describe('A. computePlanInputFingerprint', () => {
    it('generates deterministic byte-identical hash for identical inputs', () => {
      const fixtureA = createBaseFixture();
      const fixtureB = createBaseFixture();
      const hashA = computePlanInputFingerprint(fixtureA, 'plan_alpha');
      const hashB = computePlanInputFingerprint(fixtureB, 'plan_alpha');
      expect(hashA).toMatch(/^pifp_[0-9a-f]{16}$/);
      expect(hashA).toBe(hashB);
    });

    it('is invariant to placements insertion order (canonical sorting by placement id)', () => {
      const fixtureA = createBaseFixture();
      // Reverse insertion order in placements map
      const fixtureB = createBaseFixture();
      fixtureB.placements = {
        p_alpha_02: fixtureA.placements.p_alpha_02,
        p_alpha_01: fixtureA.placements.p_alpha_01,
      };

      const hashA = computePlanInputFingerprint(fixtureA, 'plan_alpha');
      const hashB = computePlanInputFingerprint(fixtureB, 'plan_alpha');
      expect(hashA).toBe(hashB);
    });

    it('changes when numerical position or profile changes', () => {
      const fixture = createBaseFixture();
      const originalHash = computePlanInputFingerprint(fixture, 'plan_alpha');

      // Mutate latitude
      const mutatedFixture = createBaseFixture();
      mutatedFixture.placements.p_alpha_01 = {
        ...mutatedFixture.placements.p_alpha_01,
        position: { ...mutatedFixture.placements.p_alpha_01.position, lat: 21.0001 },
      };
      const mutatedHash = computePlanInputFingerprint(mutatedFixture, 'plan_alpha');
      expect(mutatedHash).not.toBe(originalHash);
    });

    it('changes when terrain version or terrain provider key changes', () => {
      const fixture = createBaseFixture();
      const originalHash = computePlanInputFingerprint(fixture, 'plan_alpha');

      const terrainMutated = createBaseFixture();
      terrainMutated.activeTerrainProviderKey = 'cesium_world_terrain_v2';
      expect(computePlanInputFingerprint(terrainMutated, 'plan_alpha')).not.toBe(originalHash);
    });

    it('returns empty string if target plan does not exist', () => {
      const fixture = createBaseFixture();
      expect(computePlanInputFingerprint(fixture, 'non_existing_plan')).toBe('');
    });
  });

  describe('B. evaluateSimulationRunFreshness & isSimulationRunFresh', () => {
    it('evaluates matching run as current, and isSimulationRunFresh returns true', () => {
      const fixture = createBaseFixture();
      const fp = computePlanInputFingerprint(fixture, 'plan_alpha');

      const run: SimulationRun = {
        id: 'run_101',
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha',
        planVersion: 1,
        planInputFingerprint: fp,
        importGen: 1,
        status: 'completed',
        timestamp: Date.now(),
        config: {},
      };

      expect(evaluateSimulationRunFreshness(fixture, run)).toBe('current');
      expect(isSimulationRunFresh(fixture, run)).toBe(true);
    });

    it('evaluates run as stale when numerical inputs change, restoring inputs restores current', () => {
      const fixture = createBaseFixture();
      const fp = computePlanInputFingerprint(fixture, 'plan_alpha');

      const run: SimulationRun = {
        id: 'run_101',
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha',
        planVersion: 1,
        planInputFingerprint: fp,
        importGen: 1,
        status: 'completed',
        timestamp: Date.now(),
        config: {},
      };

      // Mutate coordinate -> stale
      const originalLon = fixture.placements.p_alpha_01.position.lon;
      fixture.placements.p_alpha_01.position.lon = 105.95;
      expect(evaluateSimulationRunFreshness(fixture, run)).toBe('stale');
      expect(isSimulationRunFresh(fixture, run)).toBe(false);

      // Restore coordinate -> current
      fixture.placements.p_alpha_01.position.lon = originalLon;
      expect(evaluateSimulationRunFreshness(fixture, run)).toBe('current');
      expect(isSimulationRunFresh(fixture, run)).toBe(true);
    });

    it('evaluates legacy run without planInputFingerprint or planVersion strictly as unknown (not current)', () => {
      const fixture = createBaseFixture();
      const legacyRunA: SimulationRun = {
        id: 'legacy_run_no_fp',
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha',
        planVersion: 1,
        // missing planInputFingerprint
        timestamp: Date.now(),
        config: {},
      };
      const legacyRunB: SimulationRun = {
        id: 'legacy_run_no_version',
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha',
        planInputFingerprint: 'pifp_abc',
        // missing planVersion
        timestamp: Date.now(),
        config: {},
      };

      expect(evaluateSimulationRunFreshness(fixture, legacyRunA)).toBe('unknown');
      expect(isSimulationRunFresh(fixture, legacyRunA)).toBe(false);

      expect(evaluateSimulationRunFreshness(fixture, legacyRunB)).toBe('unknown');
      expect(isSimulationRunFresh(fixture, legacyRunB)).toBe(false);
    });

    it('evaluates run as stale if workspace was replaced by import after run was registered', () => {
      const fixture = createBaseFixture();
      const fp = computePlanInputFingerprint(fixture, 'plan_alpha');

      const run: SimulationRun = {
        id: 'run_101',
        scenarioId: 'scen_alpha',
        planId: 'plan_alpha',
        planVersion: 1,
        planInputFingerprint: fp,
        importGen: 1,
        timestamp: Date.now(),
        config: {},
      };

      // Bump workspace import generation
      fixture.lastImportGen = 2;
      expect(evaluateSimulationRunFreshness(fixture, run)).toBe('stale');
      expect(isSimulationRunFresh(fixture, run)).toBe(false);
    });

    it('returns unknown if run is null or undefined', () => {
      const fixture = createBaseFixture();
      expect(evaluateSimulationRunFreshness(fixture, null)).toBe('unknown');
      expect(evaluateSimulationRunFreshness(fixture, undefined)).toBe('unknown');
      expect(isSimulationRunFresh(fixture, null)).toBe(false);
    });
  });

  describe('C. deepFreeze', () => {
    it('recursively freezes nested objects and arrays', () => {
      const payload = {
        planId: 'p1',
        config: {
          radar: { frequency: 3.5, gains: [10, 20, 30] },
        },
      };

      const frozen = deepFreeze(payload);
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(frozen.config)).toBe(true);
      expect(Object.isFrozen(frozen.config.radar)).toBe(true);
      expect(Object.isFrozen(frozen.config.radar.gains)).toBe(true);

      expect(() => {
        (frozen.config.radar as any).frequency = 5.0;
      }).toThrow();
      expect(() => {
        (frozen.config.radar.gains as any).push(40);
      }).toThrow();
    });

    it('passes through primitives and null safely', () => {
      expect(deepFreeze(null)).toBeNull();
      expect(deepFreeze(42)).toBe(42);
      expect(deepFreeze('string')).toBe('string');
      expect(deepFreeze(undefined)).toBeUndefined();
    });
  });

  describe('D. Public API Reference Identity Parity', () => {
    it('guarantees useTacticalStore re-exports exact identity of domain functions', () => {
      expect(storeExports.computePlanInputFingerprint).toBe(computePlanInputFingerprint);
      expect(storeExports.evaluateSimulationRunFreshness).toBe(evaluateSimulationRunFreshness);
      expect(storeExports.isSimulationRunFresh).toBe(isSimulationRunFresh);
      expect(storeExports.deepFreeze).toBe(deepFreeze);
    });
  });
});
