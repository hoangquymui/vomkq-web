import type { StoreSet, StoreGet } from '../types';
import type { Plan } from '../../domain/types/plan';
import type { AnalysisResult } from '../../domain/types/analysis';
import type { SpxCoverageResult } from '../../types/spxRadarCoverage';
import { validatePlanGraph } from '../../domain/plan/planValidation';
import { isScenarioEligibleForPurge } from '../../domain/scenario/scenarioPurgeRules';
import { appendAuditToState } from '../internal/auditHelper';

export interface ScenarioSlice {
  createScenario: (name: string, terrainVersion?: string) => string;
  switchScenario: (scenarioId: string) => void;
  renameScenario: (scenarioId: string, newName: string) => void;
  archiveScenario: (scenarioId: string) => void;
  restoreScenario: (scenarioId: string) => void;
  trashDraftScenario: (scenarioId: string) => void;
  restoreDraftScenario: (scenarioId: string) => void;
  purgeTrashedScenario: (scenarioId: string) => void;
}

export const createScenarioSlice = (
  set: StoreSet,
  _get: StoreGet
): ScenarioSlice => ({
  createScenario: (name: string, terrainVersion = 'v1') => {
    if (!name || !name.trim()) throw new Error('createScenario: Scenario name cannot be empty');
    let createdScenarioId = '';
    set((state) => {
      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newScenarioId = generateUniqueId('scen', state.scenarios);
      createdScenarioId = newScenarioId;
      const newScenario = {
        id: newScenarioId,
        name: name.trim(),
        terrainVersion: terrainVersion || 'v1',
        createdAt: Date.now(),
        status: 'draft' as const,
      };

      const baselinePlanId = generateUniqueId('plan_' + newScenarioId + '_base', state.plans);
      const baselinePlan: Plan = {
        id: baselinePlanId,
        scenarioId: newScenarioId,
        version: 1,
        name: 'Phương án gốc',
        status: 'draft' as const,
        alternativeId: baselinePlanId,
        revisionNumber: 1,
        baseRevisionPlanId: null,
      };

      const nextState = {
        scenarios: { ...state.scenarios, [newScenarioId]: newScenario },
        plans: { ...state.plans, [baselinePlanId]: baselinePlan },
        activeScenarioId: newScenarioId,
        activePlanId: baselinePlanId,
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
        { type: 'WORKSPACE', id: 'canonical-root' },
        'ADD',
        'SCENARIO',
        [newScenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    });
    return createdScenarioId;
  },

  switchScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('switchScenario: Target scenario does not exist');
      if (scenario.status === 'trashed')
        throw new Error('switchScenario: Cannot switch to trashed scenario');

      const matchingPlans = Object.values(state.plans).filter(
        (p) =>
          p.scenarioId === scenarioId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      );
      let targetPlanId: string | null = null;
      if (matchingPlans.length > 0) {
        matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        targetPlanId = matchingPlans[0].id;
        validatePlanGraph(state, targetPlanId);
      }

      const planSpxResults: Record<string, SpxCoverageResult> = {};
      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      if (targetPlanId) {
        const instanceIds = new Set<string>();
        Object.values(state.analysisResults).forEach((res) => {
          if (
            res.planId === targetPlanId &&
            res.analysisId === 'spx_radar_coverage' &&
            res.appliedToOverlay
          ) {
            instanceIds.add(res.instanceId);
          }
        });
        for (const instId of instanceIds) {
          const targetKey: string = `${targetPlanId}:${instId}`;
          const activeResId = state.spxActiveResultIds?.[targetKey];
          let selectedRecord: AnalysisResult | undefined;
          if (activeResId && state.analysisResults[activeResId]?.appliedToOverlay) {
            selectedRecord = state.analysisResults[activeResId];
          } else {
            const matches = Object.values(state.analysisResults).filter(
              (r) =>
                r.planId === targetPlanId &&
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
            nextActiveResultIds[targetKey] = selectedRecord.id;
          }
        }
      }

      return {
        activeScenarioId: scenarioId,
        activePlanId: targetPlanId,
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

  renameScenario: (scenarioId: string, newName: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('renameScenario: Scenario does not exist');
      if (scenario.status === 'archived')
        throw new Error('renameScenario: Cannot rename archived scenario');
      if (scenario.status === 'trashed')
        throw new Error('renameScenario: Cannot rename trashed scenario');
      if (!newName || !newName.trim())
        throw new Error('renameScenario: Scenario name cannot be empty');

      const nextState = {
        scenarios: {
          ...state.scenarios,
          [scenarioId]: { ...scenario, name: newName.trim() },
        },
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'UPDATE',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  archiveScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('archiveScenario: Target scenario does not exist');
      if (scenario.status === 'archived')
        throw new Error('archiveScenario: Scenario is already archived');
      if (scenario.status === 'trashed')
        throw new Error('archiveScenario: Cannot archive trashed scenario');

      const isTargetActive = state.activeScenarioId === scenarioId;
      const contextHygiene = isTargetActive
        ? {
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
          }
        : {};

      const nextState = {
        scenarios: {
          ...state.scenarios,
          [scenarioId]: {
            ...scenario,
            status: 'archived' as const,
            archivedAt: Date.now(),
          },
        },
        ...contextHygiene,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'ARCHIVE',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  restoreScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('restoreScenario: Target scenario does not exist');
      if (scenario.status !== 'archived')
        throw new Error('restoreScenario: Scenario is not archived');

      const nextState = {
        scenarios: {
          ...state.scenarios,
          [scenarioId]: {
            ...scenario,
            status: 'active' as const,
            archivedAt: undefined,
          },
        },
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'RESTORE',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  trashDraftScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('trashDraftScenario: Target scenario does not exist');
      if (scenario.status === 'trashed')
        throw new Error('trashDraftScenario: Scenario is already trashed');
      if (scenario.status === 'archived')
        throw new Error('trashDraftScenario: Cannot trash archived scenario. Restore first.');

      const childPlans = Object.values(state.plans).filter((p) => p.scenarioId === scenarioId);
      const nonDraftPlans = childPlans.filter(
        (p) =>
          p.status === 'proposed' ||
          p.status === 'approved' ||
          p.status === 'withdrawn' ||
          p.status === 'archived'
      );
      if (nonDraftPlans.length > 0) {
        throw new Error(
          'trashDraftScenario: Cannot trash scenario containing proposed or approved plans. Use archive instead.'
        );
      }
      const hasSimulationRuns = Object.values(state.simulationRuns).some(
        (r) => r.scenarioId === scenarioId
      );
      if (hasSimulationRuns) {
        throw new Error(
          'trashDraftScenario: Cannot trash scenario referenced by simulation runs. Use archive instead.'
        );
      }

      let nextActiveScenarioId = state.activeScenarioId;
      let nextActivePlanId = state.activePlanId;
      if (state.activeScenarioId === scenarioId) {
        const remainingScenarios = Object.values(state.scenarios).filter(
          (s) => s.id !== scenarioId && s.status !== 'trashed'
        );
        if (remainingScenarios.length > 0) {
          nextActiveScenarioId = remainingScenarios[0].id;
          const matchingPlans = Object.values(state.plans).filter(
            (p) =>
              p.scenarioId === nextActiveScenarioId &&
              p.status !== 'trashed' &&
              p.status !== 'withdrawn' &&
              p.status !== 'archived'
          );
          matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
          nextActivePlanId = matchingPlans.length > 0 ? matchingPlans[0].id : null;
        } else {
          nextActiveScenarioId = null;
          nextActivePlanId = null;
        }
      }

      const nextState = {
        scenarios: {
          ...state.scenarios,
          [scenarioId]: {
            ...scenario,
            status: 'trashed' as const,
            trashedAt: Date.now(),
          },
        },
        activeScenarioId: nextActiveScenarioId,
        activePlanId: nextActivePlanId,
        activeSimulationRunId:
          state.activeScenarioId === scenarioId ? null : state.activeSimulationRunId,
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
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'TRASH',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  restoreDraftScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('restoreDraftScenario: Target scenario does not exist');
      if (scenario.status !== 'trashed')
        throw new Error('restoreDraftScenario: Scenario is not trashed');

      const nextState = {
        scenarios: {
          ...state.scenarios,
          [scenarioId]: {
            ...scenario,
            status: 'draft' as const,
            trashedAt: undefined,
          },
        },
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'RESTORE',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),

  purgeTrashedScenario: (scenarioId: string) =>
    set((state) => {
      const scenario = state.scenarios[scenarioId];
      if (!scenario) throw new Error('purgeTrashedScenario: Target scenario does not exist');
      const el = isScenarioEligibleForPurge(state, scenarioId);
      if (!el.eligible) {
        throw new Error(`purgeTrashedScenario: ${el.reason || 'Scenario is not eligible for purge'}`);
      }

      const childPlans = Object.values(state.plans).filter((p) => p.scenarioId === scenarioId);
      const childPlanIds = new Set(childPlans.map((p) => p.id));

      const scenarioPlacementIds = new Set(
        Object.values(state.placements)
          .filter((p) => childPlanIds.has(p.planId))
          .map((p) => p.id)
      );
      const scenarioDefIds = new Set(
        Object.values(state.definitions)
          .filter((d) => childPlanIds.has(d.planId))
          .map((d) => d.id)
      );

      const nextPlacements = { ...state.placements };
      for (const pId of scenarioPlacementIds) delete nextPlacements[pId];

      const nextDefinitions = { ...state.definitions };
      for (const dId of scenarioDefIds) delete nextDefinitions[dId];

      const nextObservations = { ...state.observations };
      for (const pId of scenarioPlacementIds) delete nextObservations[pId];

      const nextVisuals = { ...state.visuals };
      for (const pId of scenarioPlacementIds) delete nextVisuals[pId];

      const nextPlans = { ...state.plans };
      for (const pId of childPlanIds) delete nextPlans[pId];

      const nextScenarios = { ...state.scenarios };
      delete nextScenarios[scenarioId];

      const nextCoverageVolumes = { ...state.coverageVolumes };
      const nextSpxResults = { ...state.spxResults };
      const nextSamVolumes = { ...state.samVolumes };
      const nextCoverageResults = { ...state.coverageResults };
      const nextCoverageFields = { ...state.coverageFields };
      for (const pId of scenarioPlacementIds) {
        delete nextCoverageVolumes[pId];
        delete nextSpxResults[pId];
        delete nextSamVolumes[pId];
        delete nextCoverageResults[pId];
        delete nextCoverageFields[pId];
      }

      const nextAnalysisResults = { ...state.analysisResults };
      for (const resId in nextAnalysisResults) {
        if (nextAnalysisResults[resId].scenarioId === scenarioId) {
          delete nextAnalysisResults[resId];
        }
      }

      const nextSamEngagementModes = { ...state.samEngagementModes };
      for (const pId of scenarioPlacementIds) {
        delete nextSamEngagementModes[pId];
      }

      let nextActiveScenarioId = state.activeScenarioId;
      let nextActivePlanId = state.activePlanId;
      let contextHygiene = {};

      if (state.activeScenarioId === scenarioId) {
        const remainingScenarios = Object.values(nextScenarios).filter(
          (s) => s.id !== scenarioId && s.status !== 'trashed'
        );
        if (remainingScenarios.length > 0) {
          nextActiveScenarioId = remainingScenarios[0].id;
          const matchingPlans = Object.values(nextPlans).filter(
            (p) =>
              p.scenarioId === nextActiveScenarioId &&
              p.status !== 'trashed' &&
              p.status !== 'withdrawn' &&
              p.status !== 'archived'
          );
          matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
          nextActivePlanId = matchingPlans.length > 0 ? matchingPlans[0].id : null;
        } else {
          nextActiveScenarioId = null;
          nextActivePlanId = null;
        }
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
        scenarios: nextScenarios,
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
          Object.entries(state.spxRequestRegistry || {}).filter(([_, r]) => !childPlanIds.has(r.planId))
        ),
        spxSequenceCounters: Object.fromEntries(
          Object.entries(state.spxSequenceCounters || {}).filter(
            ([k]) => !childPlanIds.has(k.split(':')[0])
          )
        ),
        spxAcceptedSequences: Object.fromEntries(
          Object.entries(state.spxAcceptedSequences || {}).filter(
            ([k]) => !childPlanIds.has(k.split(':')[0])
          )
        ),
        spxActiveResultIds: Object.fromEntries(
          Object.entries(state.spxActiveResultIds || {}).filter(
            ([k]) => !childPlanIds.has(k.split(':')[0])
          )
        ),
        activeScenarioId: nextActiveScenarioId,
        activePlanId: nextActivePlanId,
        ...contextHygiene,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'REMOVE',
        'SCENARIO',
        [scenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    }),
});
