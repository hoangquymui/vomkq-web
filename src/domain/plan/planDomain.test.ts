import { describe, it, expect } from 'vitest';
import {
  validateMutationGuard,
  validatePlanGraph,
  type MutationGuardContext,
  type PlanGraphValidationContext,
} from './planValidation';
import { isPlanEligibleForPurge, type PlanPurgeContext } from './planPurgeRules';
import { isScenarioEligibleForPurge, type ScenarioPurgeContext } from '../scenario/scenarioPurgeRules';
import * as storeExports from '../../store/useTacticalStore';
import type { Plan } from '../types/plan';
import type { Scenario } from '../types/scenario';
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../types/equipment';
import type { LegacyPresentationState } from '../adapters/legacyEquipmentAdapter';

describe('2C-R.1 Plan & Scenario Domain Rules Behavioral Parity', () => {
  const createValidGraph = () => {
    const scenario: Scenario = {
      id: 'scen_1',
      name: 'Scenario 1',
      status: 'draft',
      terrainVersion: 'v1',
      createdAt: 100,
    };
    const plan: Plan = {
      id: 'plan_1',
      scenarioId: 'scen_1',
      version: 1,
      name: 'Plan 1',
      status: 'draft',
      alternativeId: 'plan_1',
      revisionNumber: 1,
      baseRevisionPlanId: null,
    };
    const def: EquipmentDefinition = {
      id: 'def_1',
      planId: 'plan_1',
      name: 'Radar 1',
      category: 'RadarCanhGioi',
      templateId: 'p37',
      rangeKm: 100,
      scanSpeed: 6,
      minElevationDeg: 0,
      maxElevationDeg: 30,
      coverageHeightKm: 25,
      capabilities: {},
    };
    const placement: EquipmentPlacement = {
      id: 'p_1',
      planId: 'plan_1',
      definitionId: 'def_1',
      position: { lat: 10, lon: 20, altM: 0, aglM: 0 },
      network: {},
    };
    const observation: ObservationState = {
      placementId: 'p_1',
      status: 'Active',
    };
    const visual: LegacyPresentationState = {
      color: '#fff',
      showDome: true,
      showSweep: false,
    };

    const ctx: PlanGraphValidationContext & MutationGuardContext = {
      activeScenarioId: 'scen_1',
      activePlanId: 'plan_1',
      scenarios: { scen_1: scenario },
      plans: { plan_1: plan },
      definitions: { def_1: def },
      placements: { p_1: placement },
      observations: { p_1: observation },
      visuals: { p_1: visual },
    };
    return ctx;
  };

  describe('A. validateMutationGuard', () => {
    it('passes silently when active scenario exists and active plan is draft', () => {
      const ctx = createValidGraph();
      expect(() => validateMutationGuard(ctx)).not.toThrow();
    });

    it('throws with exact messages on missing context or non-draft status', () => {
      const ctx = createValidGraph();

      // No active scenario
      expect(() => validateMutationGuard({ ...ctx, activeScenarioId: null })).toThrow('No active scenario');

      // Scenario archived
      const archivedScen = { ...ctx.scenarios.scen_1, status: 'archived' as const };
      expect(() => validateMutationGuard({ ...ctx, scenarios: { scen_1: archivedScen } })).toThrow('Scenario is archived');

      // Scenario trashed
      const trashedScen = { ...ctx.scenarios.scen_1, status: 'trashed' as const };
      expect(() => validateMutationGuard({ ...ctx, scenarios: { scen_1: trashedScen } })).toThrow('Scenario is trashed');

      // No active plan
      expect(() => validateMutationGuard({ ...ctx, activePlanId: null })).toThrow('No active plan');

      // Plan belongs to wrong scenario
      const mismatchedPlan = { ...ctx.plans.plan_1, scenarioId: 'other_scen' };
      expect(() => validateMutationGuard({ ...ctx, plans: { plan_1: mismatchedPlan } })).toThrow('Plan does not belong to active scenario');

      // Plan is not draft (e.g. proposed)
      const proposedPlan = { ...ctx.plans.plan_1, status: 'proposed' as const };
      expect(() => validateMutationGuard({ ...ctx, plans: { plan_1: proposedPlan } })).toThrow('Active plan is not draft');
    });
  });

  describe('B. validatePlanGraph', () => {
    it('passes silently on complete and consistent graph', () => {
      const ctx = createValidGraph();
      expect(() => validatePlanGraph(ctx, 'plan_1')).not.toThrow();
    });

    it('rejects target plan missing or scenario missing', () => {
      const ctx = createValidGraph();
      expect(() => validatePlanGraph(ctx, 'non_existent')).toThrow(/Target plan does not exist/);

      const orphanPlan = { ...ctx.plans.plan_1, scenarioId: 'missing_scen' };
      expect(() => validatePlanGraph({ ...ctx, plans: { plan_1: orphanPlan } }, 'plan_1')).toThrow(/Plan references missing scenario/);
    });

    it('rejects cross-plan definition and orphan visual', () => {
      const ctx = createValidGraph();

      // Cross-plan definition
      ctx.definitions.def_1.planId = 'other_plan';
      expect(() => validatePlanGraph(ctx, 'plan_1')).toThrow(/references cross-plan definition/);
      ctx.definitions.def_1.planId = 'plan_1';

      // Orphan visual (no placement)
      ctx.visuals['orphan_vis'] = { color: 'red', showDome: true, showSweep: false };
      expect(() => validatePlanGraph(ctx, 'plan_1')).toThrow(/Orphan visual orphan_vis/);
    });

    it('rejects orphan definition unreferenced by any placement', () => {
      const ctx = createValidGraph();
      ctx.definitions['def_orphan'] = {
        id: 'def_orphan',
        planId: 'plan_1',
        name: 'Orphan Radar',
        templateId: 'prs3',
        scanSpeed: 12,
        minElevationDeg: -2,
        maxElevationDeg: 45,
        coverageHeightKm: 20,
        category: 'RadarCanhGioi',
        rangeKm: 50,
        capabilities: {},
      };
      expect(() => validatePlanGraph(ctx, 'plan_1')).toThrow(/Orphan definition def_orphan/);
    });
  });

  describe('C. isPlanEligibleForPurge', () => {
    it('is ineligible if plan is not in trashed status', () => {
      const ctx: PlanPurgeContext = {
        scenarios: { s1: { id: 's1', name: 'S1', status: 'draft', terrainVersion: 'v1', createdAt: 0 } },
        plans: { p1: { id: 'p1', scenarioId: 's1', status: 'draft', version: 1, name: 'P1', alternativeId: 'p1', revisionNumber: 1, baseRevisionPlanId: null } },
        simulationRuns: {},
        placements: {},
      };
      const res = isPlanEligibleForPurge(ctx, 'p1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toMatch(/Chỉ có thể xóa vĩnh viễn phương án đang trong Thùng rác/);
    });

    it('is ineligible if plan was withdrawn or has simulation runs', () => {
      const ctx: PlanPurgeContext = {
        scenarios: { s1: { id: 's1', name: 'S1', status: 'draft', terrainVersion: 'v1', createdAt: 0 } },
        plans: {
          p1: {
            id: 'p1',
            scenarioId: 's1',
            status: 'trashed',
            version: 1,
            name: 'P1',
            alternativeId: 'p1',
            revisionNumber: 1,
            baseRevisionPlanId: null,
            withdrawnAt: 12345,
          },
        },
        simulationRuns: {},
        placements: {},
      };
      expect(isPlanEligibleForPurge(ctx, 'p1').eligible).toBe(false);

      // Now with simulation runs
      delete ctx.plans.p1.withdrawnAt;
      ctx.simulationRuns['run_1'] = {
        id: 'run_1',
        scenarioId: 's1',
        planId: 'p1',
        timestamp: 0,
        config: {},
      };
      const runRes = isPlanEligibleForPurge(ctx, 'p1');
      expect(runRes.eligible).toBe(false);
      expect(runRes.reason).toMatch(/liên kết với kết quả mô phỏng/);
    });

    it('is eligible when trashed with clean history', () => {
      const ctx: PlanPurgeContext = {
        scenarios: { s1: { id: 's1', name: 'S1', status: 'draft', terrainVersion: 'v1', createdAt: 0 } },
        plans: {
          p1: {
            id: 'p1',
            scenarioId: 's1',
            status: 'trashed',
            version: 1,
            name: 'P1',
            alternativeId: 'p1',
            revisionNumber: 1,
            baseRevisionPlanId: null,
          },
        },
        simulationRuns: {},
        placements: {},
      };
      expect(isPlanEligibleForPurge(ctx, 'p1').eligible).toBe(true);
    });
  });

  describe('D. isScenarioEligibleForPurge', () => {
    it('is ineligible if scenario is not trashed or has simulation runs', () => {
      const ctx: ScenarioPurgeContext = {
        scenarios: { s1: { id: 's1', name: 'S1', status: 'active', terrainVersion: 'v1', createdAt: 0 } },
        plans: {},
        simulationRuns: {},
        placements: {},
      };
      expect(isScenarioEligibleForPurge(ctx, 's1').eligible).toBe(false);

      ctx.scenarios.s1.status = 'trashed';
      ctx.simulationRuns['run_scen'] = {
        id: 'run_scen',
        scenarioId: 's1',
        planId: 'p_other',
        timestamp: 0,
        config: {},
      };
      const res = isScenarioEligibleForPurge(ctx, 's1');
      expect(res.eligible).toBe(false);
      expect(res.reason).toMatch(/liên kết với kết quả mô phỏng/);
    });

    it('is eligible when scenario is trashed with no blockers', () => {
      const ctx: ScenarioPurgeContext = {
        scenarios: { s1: { id: 's1', name: 'S1', status: 'trashed', terrainVersion: 'v1', createdAt: 0 } },
        plans: {
          p1: {
            id: 'p1',
            scenarioId: 's1',
            status: 'draft',
            version: 1,
            name: 'P1',
            alternativeId: 'p1',
            revisionNumber: 1,
            baseRevisionPlanId: null,
          },
        },
        simulationRuns: {},
        placements: {},
      };
      expect(isScenarioEligibleForPurge(ctx, 's1').eligible).toBe(true);
    });
  });

  describe('E. Public API Reference Identity Parity', () => {
    it('guarantees useTacticalStore re-exports exact identity of domain functions', () => {
      expect(storeExports.validateMutationGuard).toBe(validateMutationGuard);
      expect(storeExports.validatePlanGraph).toBe(validatePlanGraph);
      expect(storeExports.isPlanEligibleForPurge).toBe(isPlanEligibleForPurge);
      expect(storeExports.isScenarioEligibleForPurge).toBe(isScenarioEligibleForPurge);
    });
  });
});
