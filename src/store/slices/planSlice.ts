import type { StoreSet, StoreGet } from '../types';
import type { Plan } from '../../domain/types/plan';
import type { Scenario } from '../../domain/types/scenario';
import type { AnalysisResult } from '../../domain/types/analysis';
import type { SpxCoverageResult } from '../../types/spxRadarCoverage';
import { validatePlanGraph } from '../../domain/plan/planValidation';
import { isPlanEligibleForPurge } from '../../domain/plan/planPurgeRules';
import { isScenarioEligibleForPurge } from '../../domain/scenario/scenarioPurgeRules';
import { revisionScopeKey } from '../../domain/audit/auditEngine';
import { appendAuditToState } from '../internal/auditHelper';

export interface PlanSlice {
  createPlanAlternative: (sourcePlanId?: string, name?: string) => void;
  switchActivePlan: (planId: string) => void;
  saveActivePlan: () => void;
  createEmptyPlan: (name?: string) => string;
  renamePlan: (planId: string, newName: string) => void;
  proposePlan: (planId: string) => void;
  withdrawAndReviseProposedPlan: (planId: string, reason: string) => string;
  trashDraftPlan: (planId: string) => void;
  restoreDraftPlan: (planId: string) => void;
  purgeTrashedPlan: (planId: string) => void;
  getTrashSummary: (scope?: 'all' | 'plans' | 'scenarios') => {
    eligiblePlans: Plan[];
    eligibleScenarios: Scenario[];
    retainedPlans: { plan: Plan; reason: string }[];
    retainedScenarios: { scenario: Scenario; reason: string }[];
  };
  emptyTrash: (scope?: 'all' | 'plans' | 'scenarios') => {
    purgedPlans: string[];
    purgedScenarios: string[];
    retainedPlans: { id: string; name: string; reason: string }[];
    retainedScenarios: { id: string; name: string; reason: string }[];
  };
  archivePlan: (planId: string) => void;
  restorePlan: (planId: string) => void;
}

export const createPlanSlice = (
  set: StoreSet,
  get: StoreGet
): PlanSlice => ({
  createPlanAlternative: (sourcePlanId?: string, name?: string) =>
    set((state) => {
      if (!state.activeScenarioId) throw new Error('createPlanAlternative: No active scenario');
      const scenario = state.scenarios[state.activeScenarioId];
      if (scenario?.status === 'archived')
        throw new Error('createPlanAlternative: Scenario is archived');
      if (scenario?.status === 'trashed')
        throw new Error('createPlanAlternative: Scenario is trashed');

      const srcId = sourcePlanId || state.activePlanId;
      if (!srcId) throw new Error('createPlanAlternative: No source plan');
      const sourcePlan = state.plans[srcId];
      if (!sourcePlan) throw new Error('createPlanAlternative: Source plan not found');
      if (sourcePlan.scenarioId !== state.activeScenarioId)
        throw new Error('createPlanAlternative: Source plan from another scenario');
      if (sourcePlan.status === 'trashed')
        throw new Error('createPlanAlternative: Cannot create alternative from trashed plan');

      validatePlanGraph(state, srcId);

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newPlanId = generateUniqueId('plan', state.plans);
      const plansInScenario = Object.values(state.plans).filter(
        (p) => p.scenarioId === state.activeScenarioId
      );
      const maxVersion = Math.max(
        ...plansInScenario.map((p) => p.version),
        sourcePlan.version
      );
      const newPlan: Plan = {
        id: newPlanId,
        scenarioId: sourcePlan.scenarioId,
        version: maxVersion + 1,
        name: (name && name.trim()) || `${sourcePlan.name} (Phương án thay thế)`,
        status: 'draft' as const,
        alternativeId: newPlanId,
        revisionNumber: 1,
        baseRevisionPlanId: null,
      };

      const nextPlans = { ...state.plans, [newPlanId]: newPlan };
      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextObservations = { ...state.observations };
      const nextVisuals = { ...state.visuals };

      const placementIdMap: Record<string, string> = {};

      for (const p of Object.values(state.placements)) {
        if (p.planId === srcId) {
          const newPlacementId = generateUniqueId('P_alt', nextPlacements);
          placementIdMap[p.id] = newPlacementId;

          const oldDefId = p.definitionId;
          const newDefId = generateUniqueId('D_alt', nextDefinitions);

          const oldDef = state.definitions[oldDefId];
          nextDefinitions[newDefId] = { ...oldDef, id: newDefId, planId: newPlanId };

          nextPlacements[newPlacementId] = {
            ...p,
            id: newPlacementId,
            planId: newPlanId,
            definitionId: newDefId,
          };

          const oldVisual = state.visuals[p.id];
          if (oldVisual) {
            nextVisuals[newPlacementId] = { ...oldVisual };
          }

          nextObservations[newPlacementId] = {
            placementId: newPlacementId,
            status: 'Active',
          };
        }
      }

      for (const pid of Object.values(placementIdMap)) {
        const p = nextPlacements[pid];
        if (p.network?.commandedBy && placementIdMap[p.network.commandedBy]) {
          p.network = { ...p.network, commandedBy: placementIdMap[p.network.commandedBy] };
        }
      }

      const nextState = {
        plans: nextPlans,
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        activePlanId: newPlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const derivedFromRevisionId =
        state.revisionHeads[revisionScopeKey({ type: 'PLAN', id: srcId })] || null;

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: newPlanId },
        'BRANCH',
        'PLAN',
        [newPlanId],
        'HUMAN',
        'USER_ACTION',
        derivedFromRevisionId
      );

      return { ...nextState, ...auditUpdates };
    }),

  switchActivePlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('switchActivePlan: Target plan does not exist');
      if (!state.activeScenarioId) throw new Error('switchActivePlan: Target Scenario missing');
      if (plan.scenarioId !== state.activeScenarioId)
        throw new Error('switchActivePlan: Target plan belongs to another scenario');
      if (plan.status === 'trashed') throw new Error('switchActivePlan: Cannot select trashed plan');
      if (plan.status === 'withdrawn')
        throw new Error('switchActivePlan: Cannot select withdrawn plan');
      if (plan.status === 'archived')
        throw new Error('switchActivePlan: Cannot select archived plan');

      validatePlanGraph(state, planId);

      const planSpxResults: Record<string, SpxCoverageResult> = {};
      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      const instanceIds = new Set<string>();
      Object.values(state.analysisResults).forEach((res) => {
        if (
          res.planId === planId &&
          res.analysisId === 'spx_radar_coverage' &&
          res.appliedToOverlay
        ) {
          instanceIds.add(res.instanceId);
        }
      });
      for (const instId of instanceIds) {
        const key = `${planId}:${instId}`;
        const activeResId = state.spxActiveResultIds?.[key];
        let selectedRecord: AnalysisResult | undefined;
        if (activeResId && state.analysisResults[activeResId]?.appliedToOverlay) {
          selectedRecord = state.analysisResults[activeResId];
        } else {
          const matches = Object.values(state.analysisResults).filter(
            (r) =>
              r.planId === planId &&
              r.instanceId === instId &&
              r.analysisId === 'spx_radar_coverage' &&
              r.appliedToOverlay
          );
          if (matches.length > 0) {
            matches.sort((a, b) => {
              const seqA = a.sequenceNumber ?? 0;
              const seqB = b.sequenceNumber ?? 0;
              if (seqA !== seqB) {
                return seqB - seqA;
              }
              return b.calculatedAt - a.calculatedAt;
            });
            selectedRecord = matches[0];
          }
        }
        if (selectedRecord?.data) {
          planSpxResults[instId] = selectedRecord.data;
          nextActiveResultIds[key] = selectedRecord.id;
        }
      }

      return {
        activePlanId: planId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: planSpxResults,
        spxActiveResultIds: nextActiveResultIds,
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };
    }),

  saveActivePlan: () => {
    const state = get();
    if (!state.activeScenarioId) throw new Error('saveActivePlan: No active scenario');
    const scenario = state.scenarios[state.activeScenarioId];
    if (!scenario) throw new Error('saveActivePlan: Active scenario does not exist');
    if (!state.activePlanId) throw new Error('saveActivePlan: No active plan');
    const plan = state.plans[state.activePlanId];
    if (!plan) throw new Error('saveActivePlan: Active plan does not exist');
    if (plan.scenarioId !== state.activeScenarioId)
      throw new Error('saveActivePlan: Plan belongs to wrong scenario');
    validatePlanGraph(state, state.activePlanId);
  },

  createEmptyPlan: (name?: string) => {
    let createdPlanId = '';
    set((state) => {
      if (!state.activeScenarioId) throw new Error('createEmptyPlan: No active scenario');
      const scenario = state.scenarios[state.activeScenarioId];
      if (!scenario) throw new Error('createEmptyPlan: Active scenario does not exist');
      if (scenario.status === 'archived') throw new Error('createEmptyPlan: Scenario is archived');
      if (scenario.status === 'trashed') throw new Error('createEmptyPlan: Scenario is trashed');

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newPlanId = generateUniqueId('plan', state.plans);
      createdPlanId = newPlanId;
      const plansInScenario = Object.values(state.plans).filter(
        (p) => p.scenarioId === state.activeScenarioId
      );
      const maxVersion =
        plansInScenario.length > 0 ? Math.max(...plansInScenario.map((p) => p.version)) : 0;
      const newPlan: Plan = {
        id: newPlanId,
        scenarioId: state.activeScenarioId,
        version: maxVersion + 1,
        name: (name && name.trim()) || 'Phương án mới',
        status: 'draft' as const,
        alternativeId: newPlanId,
        revisionNumber: 1,
        baseRevisionPlanId: null,
      };

      const nextState = {
        plans: { ...state.plans, [newPlanId]: newPlan },
        activePlanId: newPlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: newPlanId },
        'ADD',
        'PLAN',
        [newPlanId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    });
    return createdPlanId;
  },

  renamePlan: (planId: string, newName: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('renamePlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('renamePlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('renamePlan: Scenario is trashed');
      if (plan.scenarioId !== state.activeScenarioId)
        throw new Error('renamePlan: Plan does not belong to active scenario');
      if (plan.status !== 'draft') throw new Error('renamePlan: Only draft plans can be renamed');
      if (!newName || !newName.trim()) throw new Error('renamePlan: Plan name cannot be empty');

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: { ...plan, name: newName.trim() },
        },
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'UPDATE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  proposePlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('proposePlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('proposePlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('proposePlan: Scenario is trashed');
      if (plan.scenarioId !== state.activeScenarioId)
        throw new Error('proposePlan: Plan does not belong to active scenario');
      if (plan.status !== 'draft') throw new Error('proposePlan: Only draft plans can be proposed');
      validatePlanGraph(state, planId);

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: { ...plan, status: 'proposed' as const },
        },
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'UPDATE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  withdrawAndReviseProposedPlan: (planId: string, reason: string) => {
    if (!reason || !reason.trim()) {
      throw new Error('withdrawAndReviseProposedPlan: Reason is required to withdraw a proposal');
    }
    let createdRevisionPlanId = '';
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('withdrawAndReviseProposedPlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived')
        throw new Error('withdrawAndReviseProposedPlan: Scenario is archived');
      if (scenario?.status === 'trashed')
        throw new Error('withdrawAndReviseProposedPlan: Scenario is trashed');
      if (plan.scenarioId !== state.activeScenarioId)
        throw new Error('withdrawAndReviseProposedPlan: Plan does not belong to active scenario');
      if (plan.status !== 'proposed')
        throw new Error(
          'withdrawAndReviseProposedPlan: Only proposed plans can be withdrawn and revised'
        );

      validatePlanGraph(state, planId);

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newPlanId = generateUniqueId('plan', state.plans);
      createdRevisionPlanId = newPlanId;

      const currentAlternativeId = plan.alternativeId || plan.id;
      const nextRevisionNumber = (plan.revisionNumber || 1) + 1;

      const withdrawnPlan: Plan = {
        ...plan,
        status: 'withdrawn' as const,
        withdrawnAt: Date.now(),
        withdrawnReason: reason.trim(),
      };

      const newDraftPlan: Plan = {
        id: newPlanId,
        scenarioId: plan.scenarioId,
        version: plan.version,
        name: plan.name,
        status: 'draft' as const,
        alternativeId: currentAlternativeId,
        revisionNumber: nextRevisionNumber,
        baseRevisionPlanId: plan.id,
      };

      const nextPlans = {
        ...state.plans,
        [planId]: withdrawnPlan,
        [newPlanId]: newDraftPlan,
      };

      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextObservations = { ...state.observations };
      const nextVisuals = { ...state.visuals };

      const placementIdMap: Record<string, string> = {};

      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          const newPlacementId = generateUniqueId('P_rev', nextPlacements);
          placementIdMap[p.id] = newPlacementId;

          const oldDefId = p.definitionId;
          const newDefId = generateUniqueId('D_rev', nextDefinitions);

          const oldDef = state.definitions[oldDefId];
          nextDefinitions[newDefId] = { ...oldDef, id: newDefId, planId: newPlanId };

          nextPlacements[newPlacementId] = {
            ...p,
            id: newPlacementId,
            planId: newPlanId,
            definitionId: newDefId,
          };

          const oldVisual = state.visuals[p.id];
          if (oldVisual) {
            nextVisuals[newPlacementId] = { ...oldVisual };
          }

          nextObservations[newPlacementId] = {
            placementId: newPlacementId,
            status: 'Active',
          };
        }
      }

      for (const pid of Object.values(placementIdMap)) {
        const p = nextPlacements[pid];
        if (p.network?.commandedBy && placementIdMap[p.network.commandedBy]) {
          p.network = { ...p.network, commandedBy: placementIdMap[p.network.commandedBy] };
        }
      }

      const nextState = {
        plans: nextPlans,
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        activePlanId: newPlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const withdrawAudit = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'WITHDRAW',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION',
        null,
        reason.trim()
      );

      const stateWithWithdraw = { ...nextState, ...withdrawAudit };
      const derivedFromRevisionId =
        (stateWithWithdraw.revisionHeads || state.revisionHeads)[
          revisionScopeKey({ type: 'PLAN', id: planId })
        ] || null;

      const branchAudit = appendAuditToState(
        stateWithWithdraw,
        stateWithWithdraw,
        { type: 'PLAN', id: newPlanId },
        'BRANCH',
        'PLAN',
        [newPlanId],
        'HUMAN',
        'USER_ACTION',
        derivedFromRevisionId
      );

      return { ...stateWithWithdraw, ...branchAudit };
    });
    return createdRevisionPlanId;
  },

  trashDraftPlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('trashDraftPlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('trashDraftPlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('trashDraftPlan: Scenario is trashed');
      if (plan.status !== 'draft')
        throw new Error('trashDraftPlan: Only draft plans can be moved to trash');

      const hasSimulationRuns = Object.values(state.simulationRuns).some(
        (r) => r.planId === planId
      );
      if (hasSimulationRuns) {
        throw new Error('trashDraftPlan: Cannot trash plan referenced by simulation runs');
      }

      let nextActivePlanId = state.activePlanId;
      let contextHygiene = {};
      if (state.activePlanId === planId) {
        const remainingPlans = Object.values(state.plans).filter(
          (p) =>
            p.scenarioId === plan.scenarioId &&
            p.id !== planId &&
            p.status !== 'trashed' &&
            p.status !== 'withdrawn' &&
            p.status !== 'archived'
        );
        remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
        contextHygiene = {
          activeSimulationRunId: null,
          selectedInstanceId: null,
          activeTool: 'select' as const,
          pendingTemplate: null,
          measurePoints: [],
          coverageVolumes: {},
          spxResults: {},
          samVolumes: {},
          aiAdvisorSuggestions: [],
          aiAdvisorRoute: [],
          aiAdvisorSummary: '',
          aiAdvisorError: null,
          aiAdvisorStatus: 'idle' as const,
        };
      }

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: {
            ...plan,
            status: 'trashed' as const,
            trashedAt: Date.now(),
          },
        },
        activePlanId: nextActivePlanId,
        ...contextHygiene,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'TRASH',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  restoreDraftPlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('restoreDraftPlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived')
        throw new Error('restoreDraftPlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('restoreDraftPlan: Scenario is trashed');
      if (plan.status !== 'trashed') throw new Error('restoreDraftPlan: Plan is not trashed');

      let nextActivePlanId = state.activePlanId;
      if (!nextActivePlanId && state.activeScenarioId === plan.scenarioId) {
        nextActivePlanId = planId;
      }

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: {
            ...plan,
            status: 'draft' as const,
            trashedAt: undefined,
          },
        },
        activePlanId: nextActivePlanId,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'RESTORE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  purgeTrashedPlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('purgeTrashedPlan: Plan does not exist');
      const el = isPlanEligibleForPurge(state, planId);
      if (!el.eligible) {
        throw new Error(`purgeTrashedPlan: ${el.reason || 'Plan is not eligible for purge'}`);
      }

      const planPlacementIds = new Set(
        Object.values(state.placements)
          .filter((p) => p.planId === planId)
          .map((p) => p.id)
      );
      const planDefIds = new Set(
        Object.values(state.definitions)
          .filter((d) => d.planId === planId)
          .map((d) => d.id)
      );

      const nextPlacements = { ...state.placements };
      for (const pId of planPlacementIds) delete nextPlacements[pId];

      const nextDefinitions = { ...state.definitions };
      for (const dId of planDefIds) delete nextDefinitions[dId];

      const nextObservations = { ...state.observations };
      for (const pId of planPlacementIds) delete nextObservations[pId];

      const nextVisuals = { ...state.visuals };
      for (const pId of planPlacementIds) delete nextVisuals[pId];

      const nextPlans = { ...state.plans };
      delete nextPlans[planId];

      const nextCoverageVolumes = { ...state.coverageVolumes };
      const nextSpxResults = { ...state.spxResults };
      const nextSamVolumes = { ...state.samVolumes };
      const nextCoverageResults = { ...state.coverageResults };
      const nextCoverageFields = { ...state.coverageFields };
      for (const pId of planPlacementIds) {
        delete nextCoverageVolumes[pId];
        delete nextSpxResults[pId];
        delete nextSamVolumes[pId];
        delete nextCoverageResults[pId];
        delete nextCoverageFields[pId];
      }

      const nextAnalysisResults = { ...state.analysisResults };
      for (const resId in nextAnalysisResults) {
        if (nextAnalysisResults[resId].planId === planId) {
          delete nextAnalysisResults[resId];
        }
      }

      const nextSamEngagementModes = { ...state.samEngagementModes };
      for (const pId of planPlacementIds) {
        delete nextSamEngagementModes[pId];
      }

      let nextActivePlanId = state.activePlanId;
      let contextHygiene = {};
      if (state.activePlanId === planId) {
        const remainingPlans = Object.values(nextPlans).filter(
          (p) =>
            p.scenarioId === plan.scenarioId &&
            p.status !== 'trashed' &&
            p.status !== 'withdrawn' &&
            p.status !== 'archived'
        );
        remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
        contextHygiene = {
          activeSimulationRunId: null,
          selectedInstanceId: null,
          activeTool: 'select' as const,
          pendingTemplate: null,
          measurePoints: [],
          aiAdvisorSuggestions: [],
          aiAdvisorRoute: [],
          aiAdvisorSummary: '',
          aiAdvisorError: null,
          aiAdvisorStatus: 'idle' as const,
        };
      }

      const nextState = {
        plans: nextPlans,
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        coverageVolumes: nextCoverageVolumes,
        spxResults: nextSpxResults,
        analysisResults: nextAnalysisResults,
        samVolumes: nextSamVolumes,
        coverageResults: nextCoverageResults,
        coverageFields: nextCoverageFields,
        samEngagementModes: nextSamEngagementModes,
        spxRequestRegistry: Object.fromEntries(
          Object.entries(state.spxRequestRegistry || {}).filter(([_, r]) => r.planId !== planId)
        ),
        spxSequenceCounters: Object.fromEntries(
          Object.entries(state.spxSequenceCounters || {}).filter(([k]) => !k.startsWith(`${planId}:`))
        ),
        spxAcceptedSequences: Object.fromEntries(
          Object.entries(state.spxAcceptedSequences || {}).filter(([k]) => !k.startsWith(`${planId}:`))
        ),
        spxActiveResultIds: Object.fromEntries(
          Object.entries(state.spxActiveResultIds || {}).filter(([k]) => !k.startsWith(`${planId}:`))
        ),
        activePlanId: nextActivePlanId,
        ...contextHygiene,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'REMOVE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  getTrashSummary: (scope?: 'all' | 'plans' | 'scenarios') => {
    const state = get();
    const targetScope = scope || 'all';

    const eligiblePlans: Plan[] = [];
    const retainedPlans: { plan: Plan; reason: string }[] = [];
    const eligibleScenarios: Scenario[] = [];
    const retainedScenarios: { scenario: Scenario; reason: string }[] = [];

    if (targetScope === 'all' || targetScope === 'plans') {
      const trashedPlans = Object.values(state.plans).filter((p) => p.status === 'trashed');
      for (const p of trashedPlans) {
        const el = isPlanEligibleForPurge(state, p.id);
        if (el.eligible) {
          eligiblePlans.push(p);
        } else {
          retainedPlans.push({ plan: p, reason: el.reason || 'Bị bảo vệ lịch sử' });
        }
      }
    }

    if (targetScope === 'all' || targetScope === 'scenarios') {
      const trashedScenarios = Object.values(state.scenarios).filter((s) => s.status === 'trashed');
      for (const s of trashedScenarios) {
        const el = isScenarioEligibleForPurge(state, s.id);
        if (el.eligible) {
          eligibleScenarios.push(s);
        } else {
          retainedScenarios.push({ scenario: s, reason: el.reason || 'Bị bảo vệ lịch sử' });
        }
      }
    }

    return {
      eligiblePlans,
      eligibleScenarios,
      retainedPlans,
      retainedScenarios,
    };
  },

  emptyTrash: (scope?: 'all' | 'plans' | 'scenarios') => {
    const summary = get().getTrashSummary(scope);

    for (const p of summary.eligiblePlans) {
      get().purgeTrashedPlan(p.id);
    }
    for (const s of summary.eligibleScenarios) {
      get().purgeTrashedScenario(s.id);
    }

    return {
      purgedPlans: summary.eligiblePlans.map((p) => p.id),
      purgedScenarios: summary.eligibleScenarios.map((s) => s.id),
      retainedPlans: summary.retainedPlans.map((r) => ({
        id: r.plan.id,
        name: r.plan.name,
        reason: r.reason,
      })),
      retainedScenarios: summary.retainedScenarios.map((r) => ({
        id: r.scenario.id,
        name: r.scenario.name,
        reason: r.reason,
      })),
    };
  },

  archivePlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('archivePlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('archivePlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('archivePlan: Scenario is trashed');
      if (plan.status === 'archived') throw new Error('archivePlan: Plan is already archived');
      if (plan.status === 'trashed') throw new Error('archivePlan: Cannot archive trashed plan');

      let nextActivePlanId = state.activePlanId;
      let contextHygiene = {};
      if (state.activePlanId === planId) {
        const remainingPlans = Object.values(state.plans).filter(
          (p) =>
            p.scenarioId === plan.scenarioId &&
            p.id !== planId &&
            p.status !== 'trashed' &&
            p.status !== 'withdrawn' &&
            p.status !== 'archived'
        );
        remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
        contextHygiene = {
          activeSimulationRunId: null,
          selectedInstanceId: null,
          activeTool: 'select' as const,
          pendingTemplate: null,
          measurePoints: [],
          coverageVolumes: {},
          spxResults: {},
          samVolumes: {},
          aiAdvisorSuggestions: [],
          aiAdvisorRoute: [],
          aiAdvisorSummary: '',
          aiAdvisorError: null,
          aiAdvisorStatus: 'idle' as const,
        };
      }

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: {
            ...plan,
            status: 'archived' as const,
            archivedAt: Date.now(),
            archivedFromStatus: plan.status,
          },
        },
        activePlanId: nextActivePlanId,
        ...contextHygiene,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'ARCHIVE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  restorePlan: (planId: string) =>
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('restorePlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('restorePlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('restorePlan: Scenario is trashed');
      if (plan.status !== 'archived') throw new Error('restorePlan: Plan is not archived');

      const restoredStatus = plan.archivedFromStatus || 'draft';

      let nextActivePlanId = state.activePlanId;
      if (
        !nextActivePlanId &&
        state.activeScenarioId === plan.scenarioId &&
        restoredStatus !== 'withdrawn'
      ) {
        nextActivePlanId = planId;
      }

      const nextState = {
        plans: {
          ...state.plans,
          [planId]: {
            ...plan,
            status: restoredStatus,
            archivedAt: undefined,
            archivedFromStatus: undefined,
          },
        },
        activePlanId: nextActivePlanId,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'RESTORE',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),
});
