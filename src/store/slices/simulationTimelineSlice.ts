/**
 * @fileoverview Zustand store slice for the Simulation Event Timeline Foundation.
 * Part of Checkpoint 2C.3.
 *
 * Enforces execution incarnation tokens, provenance freshness, Run lifecycle status,
 * clock session synchronization, append-only semantics, and isolation.
 */

import type { StoreSet, StoreGet, TacticalState } from '../types';
import type {
  SimulationRun,
  SimulationRunStatus,
  SimulationRunHandle,
} from '../../domain/types/simulation';
import type {
  SimulationEvent,
  SimulationTimelineState,
} from '../../domain/types/simulationTimeline';
import {
  createSimulationTimeline,
  appendSimulationTimelineEvent,
} from '../../domain/simulation/simulationTimeline';
import { isSimulationRunFresh } from '../../domain/simulation/simulationFreshness';

const TERMINAL_STATUSES: Set<SimulationRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export interface SimulationTimelineSlice {
  initSimulationTimeline: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: {
      runToken?: string;
      importGen?: number;
    }
  ) => SimulationTimelineState;

  appendSimulationEvent: (
    runIdOrHandle: string | SimulationRunHandle,
    eventInput: {
      eventType: string;
      payload?: unknown;
    },
    options?: {
      runToken?: string;
      importGen?: number;
    }
  ) => SimulationEvent;
}

interface ResolvedRunContext {
  runId: string;
  run: SimulationRun;
  providedToken: string | undefined;
  providedImportGen: number | undefined;
}

function resolveAndValidateRunForTimeline(
  state: TacticalState,
  runIdOrHandle: string | SimulationRunHandle,
  options: { runToken?: string; importGen?: number } | undefined,
  actionName: string
): ResolvedRunContext {
  let runId: string;
  let providedToken: string | undefined = options?.runToken;
  let providedImportGen: number | undefined = options?.importGen;

  if (typeof runIdOrHandle === 'object' && runIdOrHandle !== null) {
    runId = runIdOrHandle.runId;
    if (options?.runToken !== undefined) {
      providedToken = options.runToken;
    } else if (runIdOrHandle.runToken) {
      providedToken = runIdOrHandle.runToken;
    }
    if (options?.importGen !== undefined) {
      providedImportGen = options.importGen;
    } else if (runIdOrHandle.importGen !== undefined) {
      providedImportGen = runIdOrHandle.importGen;
    }
  } else {
    runId = runIdOrHandle;
  }

  const run = state.simulationRuns[runId];
  if (!run) {
    throw new Error(`Cannot ${actionName}: SimulationRun ${runId} not found`);
  }

  // Caller generation check: reject if handle was issued in an obsolete workspace generation replaced by import
  if (
    providedImportGen !== undefined &&
    state.lastImportGen !== undefined &&
    providedImportGen !== state.lastImportGen
  ) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Workspace was replaced by import after registration (caller generation: ${providedImportGen}, current: ${state.lastImportGen})`
    );
  }

  // Incarnation token enforcement (B5): strictly require run.runToken and matching providedToken
  if (!run.runToken || typeof run.runToken !== 'string' || run.runToken.trim() === '') {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Record is an imported historical run without an active execution incarnation token`
    );
  }

  if (!providedToken || providedToken !== run.runToken) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Invalid or missing execution incarnation token (expected ${run.runToken}, got ${providedToken ?? 'none'})`
    );
  }

  // Workspace replacement guard on run record
  if (
    run.importGen !== undefined &&
    state.lastImportGen !== undefined &&
    run.importGen !== (state.lastImportGen ?? 0)
  ) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Workspace was replaced by import after registration (run import generation: ${run.importGen}, current: ${state.lastImportGen ?? 0})`
    );
  }

  // Source ownership validation: Plan and Scenario must exist and not be trashed
  const plan = state.plans[run.planId];
  if (!plan || plan.status === 'trashed') {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Plan ${run.planId} does not exist or is trashed`
    );
  }
  const scenario = state.scenarios[run.scenarioId];
  if (!scenario || scenario.status === 'trashed') {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Scenario ${run.scenarioId} does not exist or is trashed`
    );
  }

  // Historical legacy record policy: cannot arbitrarily execute or append
  if (!run.status) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Historical legacy run without execution lifecycle status is read-only`
    );
  }

  // Provenance / Freshness guard: stale or unknown runs cannot run timeline
  if (!isSimulationRunFresh(state, run)) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Run is not fresh (stale or unverified provenance)`
    );
  }

  // Terminal status lock
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new Error(
      `Cannot ${actionName} for terminal SimulationRun ${runId} (status: ${run.status})`
    );
  }

  return { runId, run, providedToken, providedImportGen };
}

export const createSimulationTimelineSlice = (
  set: StoreSet,
  get: StoreGet
): SimulationTimelineSlice => ({
  initSimulationTimeline: (runIdOrHandle, options) => {
    const state = get();
    const { runId, run } = resolveAndValidateRunForTimeline(
      state,
      runIdOrHandle,
      options,
      'initialize simulation timeline'
    );

    // Reject duplicate timeline initialization
    if (state.simulationTimelines?.[runId]) {
      throw new Error(
        `Cannot initialize simulation timeline: session already exists for SimulationRun ${runId}`
      );
    }

    const importGen = run.importGen ?? state.lastImportGen ?? 0;
    const timeline = createSimulationTimeline(runId, run.runToken!, importGen);

    set((s) => ({
      simulationTimelines: {
        ...s.simulationTimelines,
        [runId]: timeline,
      },
    }));

    return timeline;
  },

  appendSimulationEvent: (runIdOrHandle, eventInput, options) => {
    const state = get();
    const { runId, run } = resolveAndValidateRunForTimeline(
      state,
      runIdOrHandle,
      options,
      'append simulation event'
    );

    // Guard: Run must be currently in 'running' status
    if (run.status !== 'running') {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Run must be in running status (current status: ${run.status})`
      );
    }

    const currentImportGen = run.importGen ?? state.lastImportGen ?? 0;

    // Guard: Clock session must exist and match execution incarnation
    const clock = state.simulationClocks?.[runId];
    if (!clock) {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Clock session does not exist`
      );
    }
    if (
      clock.runId !== runId ||
      clock.runToken !== run.runToken ||
      clock.importGen !== currentImportGen
    ) {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Clock session incarnation mismatch`
      );
    }

    // Guard: Clock phase must be 'advancing'
    if (clock.phase !== 'advancing') {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Clock phase must be advancing (current phase: ${clock.phase})`
      );
    }

    // Guard: Timeline session must exist and match execution incarnation
    const timeline = state.simulationTimelines?.[runId];
    if (!timeline) {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Timeline session does not exist`
      );
    }
    if (
      timeline.runId !== runId ||
      timeline.runToken !== run.runToken ||
      timeline.importGen !== currentImportGen
    ) {
      throw new Error(
        `Cannot append simulation event for SimulationRun ${runId}: Timeline session incarnation mismatch`
      );
    }

    // Capture authoritative integer-nanosecond timestamp from canonical SimulationClock
    const simTimeNs = clock.simTimeNs;

    // Pure domain append transition
    const { nextTimeline, event } = appendSimulationTimelineEvent(
      timeline,
      eventInput,
      simTimeNs
    );

    // Update Zustand state atomically without mutating revisions, plans, scenarios, or audit events
    set((s) => ({
      simulationTimelines: {
        ...s.simulationTimelines,
        [runId]: nextTimeline,
      },
    }));

    return event;
  },
});
