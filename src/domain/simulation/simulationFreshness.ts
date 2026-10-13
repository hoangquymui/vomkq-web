import type { SimulationRun, SimulationRunFreshness } from '../types/simulation';
import {
  computePlanInputFingerprint,
  type PlanFingerprintContext,
} from './simulationFingerprint';

/**
 * Narrow context interface containing strictly the state fields required
 * to evaluate SimulationRun freshness.
 */
export interface SimulationFreshnessContext extends PlanFingerprintContext {
  lastImportGen?: number;
}

/**
 * Evaluates the freshness status of a SimulationRun against canonical state:
 * - 'current': has sufficient provenance (planInputFingerprint & planVersion) and fingerprint matches current plan inputs.
 * - 'stale': has sufficient provenance but current plan inputs or planVersion do not match, or context was trashed/replaced.
 * - 'unknown': legacy record lacking planInputFingerprint or planVersion (cannot deterministically verify currency).
 */
export function evaluateSimulationRunFreshness(
  state: SimulationFreshnessContext,
  run: SimulationRun | null | undefined
): SimulationRunFreshness {
  if (!run) return 'unknown';

  // 1. Scenario existence and active lifecycle
  const scenario = state.scenarios[run.scenarioId];
  if (!scenario || scenario.status === 'trashed') return 'stale';

  // 2. Plan existence and active lifecycle
  const plan = state.plans[run.planId];
  if (!plan || plan.status === 'trashed') return 'stale';

  // 3. Essential provenance check:
  // If run lacks planInputFingerprint or planVersion, we cannot deterministically verify currency.
  // It is 'unknown', NEVER defaulted to 'current'.
  if (!run.planInputFingerprint || run.planVersion === undefined) {
    return 'unknown';
  }

  // 4. Workspace replacement guard:
  // If workspace was replaced by import after this run was registered, the run is stale
  if (
    run.importGen !== undefined &&
    state.lastImportGen !== undefined &&
    run.importGen !== (state.lastImportGen ?? 0)
  ) {
    return 'stale';
  }

  // 5. Plan version guard
  if (plan.version !== run.planVersion) {
    return 'stale';
  }

  // 6. Semantic input fingerprint guard
  const currentFingerprint = computePlanInputFingerprint(
    state,
    run.planId,
    run.configSnapshot,
    run.randomSeed
  );
  if (run.planInputFingerprint !== currentFingerprint) {
    return 'stale';
  }

  return 'current';
}

/**
 * Returns true strictly if the run is verified as 'current'.
 * Returns false if the run is 'stale' OR 'unknown' (legacy / lacking provenance).
 */
export function isSimulationRunFresh(
  state: SimulationFreshnessContext,
  run: SimulationRun | null | undefined
): boolean {
  return evaluateSimulationRunFreshness(state, run) === 'current';
}
