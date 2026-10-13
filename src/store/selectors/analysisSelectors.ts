import type { TacticalState } from '../types';
import type {
  AnalysisResult,
  FreshnessStatus,
  SpxAnalysisInputSnapshot,
} from '../../domain/types/analysis';
import {
  resolveEffectiveSpxConfigFromCanonical,
  buildSpxInputSnapshot,
  evaluateAnalysisFreshness,
} from '../../domain/analysis/analysisFingerprint';

export const selectActivePlanAnalysisResults = (state: TacticalState): AnalysisResult[] => {
  if (!state.activePlanId) return [];
  return Object.values(state.analysisResults).filter((r) => r.planId === state.activePlanId);
};

export const selectInstanceAnalysisResult = (
  state: TacticalState,
  instanceId: string,
  analysisId = 'spx_radar_coverage'
): AnalysisResult | null => {
  if (!state.activePlanId) return null;

  // SELECTED RESULT = DISPLAYED OVERLAY
  // If overlay is not displayed for this instance in active plan, there is no selected result
  const activeOverlay = state.spxResults[instanceId];
  if (!activeOverlay) return null;

  const key = `${state.activePlanId}:${instanceId}`;
  const activeResId = state.spxActiveResultIds?.[key];
  if (activeResId && state.analysisResults[activeResId]) {
    const candidate = state.analysisResults[activeResId];
    if (
      candidate.planId === state.activePlanId &&
      candidate.instanceId === instanceId &&
      (candidate.data === activeOverlay || (activeOverlay.cacheKey && candidate.data?.cacheKey === activeOverlay.cacheKey))
    ) {
      return candidate;
    }
  }

  // Fallback: strictly match actual active overlay by payload reference or cacheKey
  const matches = Object.values(state.analysisResults).filter(
    (r) =>
      r.planId === state.activePlanId &&
      r.instanceId === instanceId &&
      r.analysisId === analysisId &&
      (r.data === activeOverlay || (activeOverlay.cacheKey && r.data?.cacheKey === activeOverlay.cacheKey))
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const seqA = a.sequenceNumber ?? 0;
    const seqB = b.sequenceNumber ?? 0;
    if (seqA !== seqB) {
      return seqB - seqA;
    }
    return b.calculatedAt - a.calculatedAt;
  });
  return matches[0];
};

export const selectAnalysisFreshness = (
  state: TacticalState,
  instanceId: string
): {
  freshness: FreshnessStatus;
  currentSnapshot: SpxAnalysisInputSnapshot | null;
  result: AnalysisResult | null;
  hasResult: boolean;
} => {
  if (!state.activeScenarioId || !state.activePlanId) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const plan = state.plans[state.activePlanId];
  const placement = state.placements[instanceId];
  if (!plan || !placement || placement.planId !== plan.id) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const definition = state.definitions[placement.definitionId];
  if (!definition) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const scenario = state.scenarios[state.activeScenarioId];
  const terrainVersion = scenario?.terrainVersion || 'v1';
  const terrainProviderKey = state.activeTerrainProviderKey;

  const visual = state.visuals[placement.id];
  const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
    state.spxConfig,
    placement,
    definition,
    visual?.spxConfig
  );

  const currentSnapshot = buildSpxInputSnapshot(
    state.activeScenarioId,
    plan,
    placement,
    definition,
    effectiveConfig,
    terrainVersion,
    terrainProviderKey
  );
  const result = selectInstanceAnalysisResult(state, instanceId);
  const hasResult = result !== null;
  const freshness = evaluateAnalysisFreshness(currentSnapshot, result);
  return { freshness, currentSnapshot, result, hasResult };
};
