import type { StoreSet, StoreGet } from '../types';
import type {
  SimulationRun,
  SimulationRunStatus,
  SimulationConfigSnapshot,
  SimulationRunDiagnostics,
  SimulationRunHandle,
} from '../../domain/types/simulation';
import { deepFreeze } from '../../utils/deepFreeze';
import { computePlanInputFingerprint } from '../../domain/simulation/simulationFingerprint';
import {
  evaluateSimulationRunFreshness,
  isSimulationRunFresh,
} from '../../domain/simulation/simulationFreshness';

export interface SimulationRunSlice {
  registerSimulationRun: (params: {
    scenarioId: string;
    planId: string;
    configSnapshot?: SimulationConfigSnapshot;
    randomSeed?: number | string;
    initialStatus?: 'pending' | 'running';
    campaignId?: string;
    autoActivate?: boolean;
    customRunId?: string;
  }) => SimulationRunHandle;
  updateSimulationRunStatus: (
    runIdOrHandle: string | SimulationRunHandle,
    nextStatus: SimulationRunStatus,
    options?: {
      runToken?: string;
      completedAt?: number;
      resultSummary?: Record<string, unknown>;
      diagnostics?: SimulationRunDiagnostics;
      eventCount?: number;
      expectedWorkspaceGeneration?: number;
    }
  ) => void;
  setActiveSimulationRunId: (runId: string | null) => void;
}

export const createSimulationRunSlice = (
  set: StoreSet,
  get: StoreGet
): SimulationRunSlice => ({
  registerSimulationRun: (params) => {
    const state = get();
    const scenario = state.scenarios[params.scenarioId];
    if (!scenario) {
      throw new Error(`Cannot register SimulationRun: Scenario ${params.scenarioId} not found`);
    }
    if (scenario.status === 'trashed') {
      throw new Error(`Cannot register SimulationRun: Scenario ${params.scenarioId} is trashed`);
    }

    const plan = state.plans[params.planId];
    if (!plan) {
      throw new Error(`Cannot register SimulationRun: Plan ${params.planId} not found`);
    }
    if (plan.status === 'trashed') {
      throw new Error(`Cannot register SimulationRun: Plan ${params.planId} is trashed`);
    }
    if (plan.scenarioId !== params.scenarioId) {
      throw new Error(
        `Cannot register SimulationRun: Plan ${params.planId} belongs to Scenario ${plan.scenarioId}, not ${params.scenarioId}`
      );
    }

    if (params.customRunId && state.simulationRuns[params.customRunId]) {
      throw new Error(
        `Cannot register SimulationRun: Run ${params.customRunId} already exists in active registry`
      );
    }

    const runId = params.customRunId ?? `sim_run_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const runToken = `rt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    const configSnapshot: SimulationConfigSnapshot = params.configSnapshot
      ? JSON.parse(JSON.stringify(params.configSnapshot))
      : { timeStepSeconds: 1, durationSeconds: 60 };
    const legacyConfig: Record<string, unknown> = JSON.parse(JSON.stringify(configSnapshot));
    const initialStatus = params.initialStatus ?? 'pending';
    const now = Date.now();
    const importGen = state.lastImportGen ?? 0;
    const planInputFingerprint = computePlanInputFingerprint(
      state,
      params.planId,
      configSnapshot,
      params.randomSeed
    );

    const newRun: SimulationRun = {
      id: runId,
      scenarioId: params.scenarioId,
      planId: params.planId,
      timestamp: now,
      config: legacyConfig,
      status: initialStatus,
      planVersion: plan.version,
      modelVersion: 'v2.0-canonical',
      simulationVersion: '1.0.0',
      campaignId: params.campaignId,
      randomSeed: params.randomSeed,
      configSnapshot,
      startedAt: initialStatus === 'running' ? now : undefined,
      completedAt: undefined,
      eventCount: 0,
      diagnostics: { durationMs: 0, warnings: [], errors: [] },
      workspaceGeneration: state.workspaceContextGeneration ?? 0,
      importGen,
      planInputFingerprint,
      runToken,
    };

    deepFreeze(newRun);

    let shouldActivate = false;
    if (params.autoActivate) {
      if (state.activeScenarioId === params.scenarioId && state.activePlanId === params.planId) {
        shouldActivate = true;
      }
    }

    set((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [runId]: newRun,
      },
      activeSimulationRunId: shouldActivate ? runId : s.activeSimulationRunId,
    }));

    const handle: SimulationRunHandle = {
      runId,
      runToken,
      importGen,
    };
    (handle as any).toString = () => runId;
    return handle;
  },

  updateSimulationRunStatus: (runIdOrHandle, nextStatus, options) => {
    let runId: string;
    let providedToken: string | undefined = options?.runToken;
    let providedImportGen: number | undefined;
    if (typeof runIdOrHandle === 'object' && runIdOrHandle !== null) {
      runId = runIdOrHandle.runId;
      if (runIdOrHandle.runToken) {
        providedToken = runIdOrHandle.runToken;
      }
      if (runIdOrHandle.importGen !== undefined) {
        providedImportGen = runIdOrHandle.importGen;
      }
    } else {
      runId = runIdOrHandle;
    }

    const state = get();
    const currentRun = state.simulationRuns[runId];
    if (!currentRun) {
      throw new Error(`SimulationRun not found: ${runId}`);
    }

    // Caller generation check: reject if handle was issued in an obsolete workspace generation replaced by import
    if (
      providedImportGen !== undefined &&
      state.lastImportGen !== undefined &&
      providedImportGen !== state.lastImportGen
    ) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Workspace was replaced by import after registration (caller generation: ${providedImportGen}, current: ${state.lastImportGen})`
      );
    }

    // Incarnation enforcement (Blocker 2):
    // If run has runToken (newly created run), caller MUST present matching token.
    // Stale callers cannot update a replaced run with the same ID.
    // Legacy runs (without runToken) remain updateable without token for backwards compatibility.
    // However, if caller presents an active runToken for an imported historical run that has no runToken, reject it.
    if (currentRun.runToken !== undefined) {
      if (!providedToken || providedToken !== currentRun.runToken) {
        throw new Error(
          `Cannot update SimulationRun ${runId}: Invalid or missing execution incarnation token (expected ${currentRun.runToken}, got ${providedToken ?? 'none'})`
        );
      }
    } else if (providedToken !== undefined) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Record is an imported historical run without an active execution incarnation token`
      );
    }

    // Workspace replacement guard (Blocker 1):
    // Only import replacements or explicit generation expectations block completion;
    // plan context switching does not invalidate legitimate historical execution.
    if (options?.expectedWorkspaceGeneration !== undefined) {
      if (options.expectedWorkspaceGeneration !== state.workspaceContextGeneration) {
        throw new Error(
          `Cannot update SimulationRun ${runId}: Workspace generation mismatch (expected ${options.expectedWorkspaceGeneration}, current is ${state.workspaceContextGeneration})`
        );
      }
    }
    if (
      currentRun.importGen !== undefined &&
      state.lastImportGen !== undefined &&
      currentRun.importGen !== (state.lastImportGen ?? 0)
    ) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Workspace was replaced by import after registration (run import generation: ${currentRun.importGen}, current: ${state.lastImportGen ?? 0})`
      );
    }

    // Source ownership validation: plan and scenario must exist and not be trashed
    const plan = state.plans[currentRun.planId];
    if (!plan || plan.status === 'trashed') {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Plan ${currentRun.planId} does not exist or is trashed`
      );
    }
    const scenario = state.scenarios[currentRun.scenarioId];
    if (!scenario || scenario.status === 'trashed') {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Scenario ${currentRun.scenarioId} does not exist or is trashed`
      );
    }

    // Historical legacy record policy:
    // Historical legacy records lacking execution lifecycle status are read-only;
    // they cannot arbitrarily jump through the state machine.
    if (!currentRun.status) {
      throw new Error(
        `Cannot transition SimulationRun ${runId}: Historical legacy run without execution lifecycle status is read-only`
      );
    }

    const TERMINAL_STATUSES: Set<SimulationRunStatus> = new Set(['completed', 'failed', 'cancelled']);
    if (currentRun.status && TERMINAL_STATUSES.has(currentRun.status)) {
      throw new Error(
        `Cannot transition terminal SimulationRun ${runId} (status: ${currentRun.status}) to ${nextStatus}`
      );
    }

    // State machine transition validation
    if (currentRun.status === 'pending') {
      if (nextStatus !== 'running' && nextStatus !== 'cancelled') {
        throw new Error(
          `Invalid transition for SimulationRun ${runId}: pending cannot transition directly to ${nextStatus}`
        );
      }
    } else if (currentRun.status === 'running') {
      if (nextStatus === 'pending' || nextStatus === 'running') {
        throw new Error(
          `Invalid transition for SimulationRun ${runId}: running cannot transition to ${nextStatus}`
        );
      }
    }

    // Stale completion guard (Blocker 3):
    // Reject completion if plan inputs or plan version have changed since run was registered
    if (nextStatus === 'completed') {
      if (!isSimulationRunFresh(state, currentRun)) {
        throw new Error(
          `Cannot complete SimulationRun ${runId}: Plan inputs or version have changed since run was registered (stale)`
        );
      }
    }

    // Payload validation: eventCount must be finite non-negative integer
    if (options?.eventCount !== undefined) {
      if (
        typeof options.eventCount !== 'number' ||
        !Number.isFinite(options.eventCount) ||
        !Number.isInteger(options.eventCount) ||
        options.eventCount < 0
      ) {
        throw new Error(
          `SimulationRun eventCount must be a finite non-negative integer, got: ${options.eventCount}`
        );
      }
    }

    const isTerminal = TERMINAL_STATUSES.has(nextStatus);

    // Lifecycle constraints: completedAt and resultSummary are ONLY allowed for terminal statuses
    if (!isTerminal) {
      if (options?.completedAt !== undefined) {
        throw new Error(
          `Cannot provide completedAt for non-terminal SimulationRun status: ${nextStatus}`
        );
      }
      if (options?.resultSummary !== undefined) {
        throw new Error(
          `Cannot provide resultSummary for non-terminal SimulationRun status: ${nextStatus}`
        );
      }
    }

    let completedAt = currentRun.completedAt;
    if (isTerminal) {
      if (options?.completedAt !== undefined) {
        if (
          typeof options.completedAt !== 'number' ||
          !Number.isFinite(options.completedAt) ||
          options.completedAt <= 0
        ) {
          throw new Error(
            `SimulationRun completedAt must be a valid positive finite timestamp, got: ${options.completedAt}`
          );
        }
        completedAt = options.completedAt;
      } else {
        completedAt = Date.now();
      }

      if (currentRun.startedAt && completedAt < currentRun.startedAt) {
        throw new Error(
          `SimulationRun completedAt (${completedAt}) cannot be earlier than startedAt (${currentRun.startedAt})`
        );
      }
    }

    let startedAt = currentRun.startedAt;
    if (nextStatus === 'running' && !startedAt) {
      startedAt = Date.now();
    }

    const resultSummary = options?.resultSummary
      ? JSON.parse(JSON.stringify(options.resultSummary))
      : currentRun.resultSummary;
    const diagnostics = options?.diagnostics
      ? JSON.parse(JSON.stringify(options.diagnostics))
      : currentRun.diagnostics;
    const eventCount = options?.eventCount !== undefined
      ? options.eventCount
      : (currentRun.eventCount ?? 0);

    const updatedRun: SimulationRun = {
      ...currentRun,
      status: nextStatus,
      startedAt,
      completedAt,
      eventCount,
      resultSummary,
      diagnostics,
    };

    deepFreeze(updatedRun);

    set((s) => {
      if (!s.simulationRuns[runId]) {
        throw new Error(`SimulationRun not found during atomic update: ${runId}`);
      }
      return {
        simulationRuns: {
          ...s.simulationRuns,
          [runId]: updatedRun,
        },
      };
    });
  },

  setActiveSimulationRunId: (runId) => {
    if (runId === null) {
      set({ activeSimulationRunId: null });
      return;
    }
    const state = get();
    const run = state.simulationRuns[runId];
    if (!run) {
      throw new Error(`Cannot set active SimulationRun: Run ${runId} not found`);
    }
    if (!state.activeScenarioId || !state.activePlanId) {
      throw new Error(
        `Cannot activate SimulationRun ${runId}: No active Scenario and Plan context`
      );
    }
    if (run.planId !== state.activePlanId || run.scenarioId !== state.activeScenarioId) {
      throw new Error(
        `Cannot activate SimulationRun ${runId}: Context mismatch (run belongs to Plan ${run.planId}/Scenario ${run.scenarioId}, active context is Plan ${state.activePlanId}/Scenario ${state.activeScenarioId})`
      );
    }
    const freshness = evaluateSimulationRunFreshness(state, run);
    if (freshness !== 'current') {
      if (freshness === 'unknown') {
        throw new Error(
          `Cannot activate SimulationRun ${runId}: Run is not fresh (unverified provenance)`
        );
      }
      throw new Error(
        `Cannot activate SimulationRun ${runId}: Run is stale (inputs or plan have changed since registration)`
      );
    }
    set({ activeSimulationRunId: runId });
  },
});
