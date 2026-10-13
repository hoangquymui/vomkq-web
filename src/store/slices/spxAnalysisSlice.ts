import type { StoreSet, StoreGet } from '../types';
import type {
  AnalysisResult,
  SpxAnalysisInputSnapshot,
} from '../../domain/types/analysis';
import type {
  SpxRadarCoverageConfig,
  SpxCoverageResult,
} from '../../types/spxRadarCoverage';
import {
  buildSpxInputSnapshot,
  computeAnalysisFingerprint,
  resolveEffectiveSpxConfigFromCanonical,
} from '../../domain/analysis/analysisFingerprint';

export interface SpxAnalysisSlice {
  setShowSpxPanel: (show: boolean) => void;
  toggleSpxPanel: () => void;
  updateSpxConfig: (updates: Partial<SpxRadarCoverageConfig>) => void;
  setSpxResult: (instanceId: string, result: SpxCoverageResult) => void;
  setIsCalculatingSpx: (calculating: boolean) => void;
  clearSpxRecalculateRequest: () => void;
  recordAnalysisResult: (result: AnalysisResult<any>) => void;
  commitSpxAnalysisResult: (payload: {
    requestId: string;
    scenarioId: string;
    planId: string;
    gen: number;
    instanceId: string;
    result: SpxCoverageResult;
    snapshot: SpxAnalysisInputSnapshot;
    inputFingerprint: string;
  }) => boolean;
  clearAnalysisResult: (resultId: string) => void;
  clearPlanAnalysisResults: (planId: string) => void;
  triggerSpxRecalculate: (instanceId?: string) => void;
  registerSpxAnalysisRequest: (planId: string, instanceId: string, customRequestId?: string) => string;
}

export const createSpxAnalysisSlice = (
  set: StoreSet,
  get: StoreGet
): SpxAnalysisSlice => ({
  registerSpxAnalysisRequest: (planId, instanceId, customRequestId) => {
    const state = get();
    const key = `${planId}:${instanceId}`;
    const nextSeq = (state.spxSequenceCounters[key] || 0) + 1;
    const reqId = customRequestId || `req_spx_${planId}_${instanceId}_${Date.now()}_${nextSeq}`;
    set((s) => ({
      spxSequenceCounters: { ...s.spxSequenceCounters, [key]: nextSeq },
      spxRequestRegistry: {
        ...s.spxRequestRegistry,
        [reqId]: {
          planId,
          instanceId,
          sequenceNumber: nextSeq,
          registeredAt: Date.now(),
        },
      },
    }));
    return reqId;
  },

  setShowSpxPanel: (show) => set({ showSpxPanel: show }),
  toggleSpxPanel: () => set((state) => ({ showSpxPanel: !state.showSpxPanel })),
  updateSpxConfig: (updates) =>
    set((state) => ({ spxConfig: { ...state.spxConfig, ...updates } })),

  setSpxResult: (instanceId, result) =>
    set((state) => {
      const placement = state.placements[instanceId];
      const plan = state.activePlanId ? state.plans[state.activePlanId] : null;
      const def = placement ? state.definitions[placement.definitionId] : null;
      const scenId = state.activeScenarioId || 'unknown_scenario';
      let nextAnalysis = state.analysisResults;
      if (placement && plan && def) {
        const visual = state.visuals[placement.id];
        const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
          state.spxConfig,
          placement,
          def,
          visual?.spxConfig
        );
        const snapshot = buildSpxInputSnapshot(
          scenId,
          plan,
          placement,
          def,
          effectiveConfig,
          state.scenarios[scenId]?.terrainVersion || 'v1',
          state.activeTerrainProviderKey
        );
        const fp = computeAnalysisFingerprint(snapshot);
        const resId = `ar_spx_${plan.id}_${instanceId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const analysisRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId: scenId,
          planId: plan.id,
          planVersion: plan.version,
          instanceId,
          calculatedAt: Date.now(),
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint: fp,
          appliedToOverlay: true,
          executionStatus: 'completed',
          data: result,
        });
        nextAnalysis = { ...state.analysisResults, [resId]: analysisRecord };
        const key = `${plan.id}:${instanceId}`;
        return {
          spxResults: { ...state.spxResults, [instanceId]: result },
          analysisResults: nextAnalysis,
          spxActiveResultIds: { ...(state.spxActiveResultIds || {}), [key]: resId },
        };
      }
      return {
        spxResults: { ...state.spxResults, [instanceId]: result },
        analysisResults: nextAnalysis,
      };
    }),

  recordAnalysisResult: (result) =>
    set((state) => ({
      analysisResults: {
        ...state.analysisResults,
        [result.id]: Object.freeze({ ...result }),
      },
    })),

  commitSpxAnalysisResult: ({
    requestId,
    scenarioId,
    planId,
    gen,
    instanceId,
    result,
    snapshot,
    inputFingerprint,
  }) => {
    let appliedToOverlay = false;
    set((state) => {
      // P1-A: Validate target Scenario, Plan, Placement, Definition, and ownership
      const scenario = state.scenarios[scenarioId];
      if (!scenario || scenario.status === 'trashed') {
        return state;
      }

      const plan = state.plans[planId];
      if (!plan || plan.scenarioId !== scenarioId || plan.status === 'trashed') {
        return state;
      }

      const placement = state.placements[instanceId];
      if (!placement || placement.planId !== planId) {
        return state;
      }

      const def = state.definitions[placement.definitionId];
      if (!def || def.planId !== planId) {
        return state;
      }

      // Reject async job if started before package import (P1-A)
      if (state.lastImportGen && gen < state.lastImportGen) {
        return state;
      }

      // Request sequence tracking (P1-C)
      const key = `${planId}:${instanceId}`;
      let requestSeq: number;
      let nextRequestRegistry = state.spxRequestRegistry;
      let nextSequenceCounters = state.spxSequenceCounters;

      if (state.spxRequestRegistry && state.spxRequestRegistry[requestId]) {
        requestSeq = state.spxRequestRegistry[requestId].sequenceNumber;
      } else {
        const nextSeq = ((state.spxSequenceCounters && state.spxSequenceCounters[key]) || 0) + 1;
        requestSeq = nextSeq;
        nextSequenceCounters = { ...(state.spxSequenceCounters || {}), [key]: nextSeq };
        nextRequestRegistry = {
          ...(state.spxRequestRegistry || {}),
          [requestId]: {
            planId,
            instanceId,
            sequenceNumber: nextSeq,
            registeredAt: Date.now(),
          },
        };
      }

      const currentAcceptedSeq = (state.spxAcceptedSequences && state.spxAcceptedSequences[key]) || 0;
      const isOlderThanAccepted = currentAcceptedSeq > 0 && requestSeq < currentAcceptedSeq;

      const recordCalculatedAt = Date.now();
      const resId = `ar_spx_${planId}_${instanceId}_${recordCalculatedAt}_${Math.random().toString(36).substring(2, 7)}`;

      const isContextStale =
        state.activeScenarioId !== scenarioId ||
        state.activePlanId !== planId ||
        state.workspaceContextGeneration !== gen;

      if (isContextStale || isOlderThanAccepted) {
        const rejectedRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId,
          planId,
          planVersion: snapshot.planVersion,
          instanceId,
          calculatedAt: recordCalculatedAt,
          sequenceNumber: requestSeq,
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint,
          requestId,
          appliedToOverlay: false,
          executionStatus: 'completed',
          data: result,
        });
        return {
          analysisResults: { ...state.analysisResults, [resId]: rejectedRecord },
          spxRequestRegistry: nextRequestRegistry,
          spxSequenceCounters: nextSequenceCounters,
        };
      }

      // P1-B: Check if current input in store still matches the fingerprint of this result using effective config
      const visual = state.visuals[placement.id];
      const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
        state.spxConfig,
        placement,
        def,
        visual?.spxConfig
      );
      const currentSnapshot = buildSpxInputSnapshot(
        scenarioId,
        plan,
        placement,
        def,
        effectiveConfig,
        scenario.terrainVersion || 'v1',
        state.activeTerrainProviderKey
      );
      if (computeAnalysisFingerprint(currentSnapshot) !== inputFingerprint) {
        const mismatchedRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId,
          planId,
          planVersion: snapshot.planVersion,
          instanceId,
          calculatedAt: recordCalculatedAt,
          sequenceNumber: requestSeq,
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint,
          requestId,
          appliedToOverlay: false,
          executionStatus: 'completed',
          data: result,
        });
        return {
          analysisResults: { ...state.analysisResults, [resId]: mismatchedRecord },
          spxRequestRegistry: nextRequestRegistry,
          spxSequenceCounters: nextSequenceCounters,
        };
      }

      appliedToOverlay = true;
      const acceptedRecord: AnalysisResult = Object.freeze({
        id: resId,
        analysisId: 'spx_radar_coverage',
        scenarioId,
        planId,
        planVersion: snapshot.planVersion,
        instanceId,
        calculatedAt: recordCalculatedAt,
        sequenceNumber: requestSeq,
        algorithmVersion: snapshot.algorithmVersion,
        terrainVersion: snapshot.terrainVersion,
        inputSnapshot: snapshot,
        inputFingerprint,
        requestId,
        appliedToOverlay: true,
        executionStatus: 'completed',
        data: result,
      });

      return {
        analysisResults: { ...state.analysisResults, [resId]: acceptedRecord },
        spxResults: { ...state.spxResults, [instanceId]: result },
        spxAcceptedSequences: { ...(state.spxAcceptedSequences || {}), [key]: requestSeq },
        spxActiveResultIds: { ...(state.spxActiveResultIds || {}), [key]: resId },
        spxRequestRegistry: nextRequestRegistry,
        spxSequenceCounters: nextSequenceCounters,
      };
    });
    return appliedToOverlay;
  },

  triggerSpxRecalculate: (instanceId?: string) =>
    set((state) => ({
      spxRecalculateToken: (state.spxRecalculateToken || 0) + 1,
      spxRequestedRecalculateInstanceId: instanceId || 'all',
    })),

  clearSpxRecalculateRequest: () =>
    set({
      spxRequestedRecalculateInstanceId: null,
    }),

  clearAnalysisResult: (resultId) =>
    set((state) => {
      const targetRecord = state.analysisResults[resultId];
      const nextAnalysis = { ...state.analysisResults };
      delete nextAnalysis[resultId];

      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      const nextSpxResults = { ...state.spxResults };

      for (const [key, id] of Object.entries(nextActiveResultIds)) {
        if (id === resultId) {
          delete nextActiveResultIds[key];
          const [keyPlanId, instanceId] = key.split(':');
          if (keyPlanId === state.activePlanId) {
            delete nextSpxResults[instanceId];
          }
        }
      }

      if (targetRecord && targetRecord.planId === state.activePlanId) {
        const instId = targetRecord.instanceId;
        if (
          nextSpxResults[instId] &&
          (nextSpxResults[instId] === targetRecord.data ||
            nextSpxResults[instId]?.cacheKey === targetRecord.data?.cacheKey)
        ) {
          delete nextSpxResults[instId];
        }
      }

      return {
        analysisResults: nextAnalysis,
        spxActiveResultIds: nextActiveResultIds,
        spxResults: nextSpxResults,
      };
    }),

  clearPlanAnalysisResults: (planId) =>
    set((state) => {
      const nextAnalysis = { ...state.analysisResults };
      for (const k in nextAnalysis) {
        if (nextAnalysis[k].planId === planId) delete nextAnalysis[k];
      }

      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      const nextSpxResults = { ...state.spxResults };

      for (const key of Object.keys(nextActiveResultIds)) {
        if (key.startsWith(`${planId}:`)) {
          delete nextActiveResultIds[key];
          if (planId === state.activePlanId) {
            const instanceId = key.split(':')[1];
            delete nextSpxResults[instanceId];
          }
        }
      }

      return {
        analysisResults: nextAnalysis,
        spxActiveResultIds: nextActiveResultIds,
        spxResults: nextSpxResults,
      };
    }),

  setIsCalculatingSpx: (calculating) =>
    set((state) =>
      state.isCalculatingSpx === calculating ? state : { isCalculatingSpx: calculating }
    ),
});
