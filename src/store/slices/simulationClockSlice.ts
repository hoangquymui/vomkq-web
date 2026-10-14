import type { StoreSet, StoreGet, TacticalState } from '../types';
import type {
  SimulationRun,
  SimulationRunStatus,
  SimulationRunHandle,
} from '../../domain/types/simulation';
import type {
  SimulationClockState,
} from '../../domain/types/simulationClock';
import {
  createSimulationClock,
  advanceSimulationClock,
  setSimulationClockPhase,
  setSimulationClockTimeScale,
  resetSimulationClock,
} from '../../domain/simulation/simulationClock';
import { isSimulationRunFresh } from '../../domain/simulation/simulationFreshness';

const TERMINAL_STATUSES: Set<SimulationRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export interface SimulationClockSlice {
  initSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: {
      runToken?: string;
      importGen?: number;
      timeScale?: number;
    }
  ) => SimulationClockState;

  startSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;

  pauseSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;

  resumeSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;

  stepSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    elapsedRealMs: number,
    options?: { runToken?: string; importGen?: number }
  ) => SimulationClockState;

  setSimulationClockScale: (
    runIdOrHandle: string | SimulationRunHandle,
    timeScale: number,
    options?: { runToken?: string; importGen?: number }
  ) => void;

  resetSimulationClockSession: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number; preserveTimeScale?: boolean }
  ) => SimulationClockState;
}

interface ResolvedRunContext {
  runId: string;
  run: SimulationRun;
  providedToken: string | undefined;
  providedImportGen: number | undefined;
}

function resolveAndValidateRunForClock(
  state: TacticalState,
  runIdOrHandle: string | SimulationRunHandle,
  options: { runToken?: string; importGen?: number } | undefined,
  actionName: string,
  isAdvancing: boolean
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

  // Historical legacy record policy: cannot arbitrarily run or advance
  if (!run.status) {
    throw new Error(
      `Cannot ${actionName} for SimulationRun ${runId}: Historical legacy run without execution lifecycle status is read-only`
    );
  }

  // Provenance / Freshness guard: stale or unknown runs cannot run clock
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

  // Pending run constraint: pending runs may prepare clock, but cannot advance
  if (isAdvancing && run.status === 'pending') {
    throw new Error(
      `Cannot advance simulation clock for pending SimulationRun ${runId}: Run must be in running status`
    );
  }

  return { runId, run, providedToken, providedImportGen };
}

export const createSimulationClockSlice = (
  set: StoreSet,
  get: StoreGet
): SimulationClockSlice => ({
  initSimulationClock: (runIdOrHandle, options) => {
    const state = get();
    const { runId, run } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'initialize simulation clock',
      false
    );

    // B1: Duplicate clock initialization guard. Do not overwrite existing session.
    if (state.simulationClocks?.[runId]) {
      throw new Error(
        `Cannot initialize simulation clock for SimulationRun ${runId}: Clock session already exists`
      );
    }

    // B4: Store clock initialization strictly starts at 'idle'.
    const clock = createSimulationClock({
      runId,
      runToken: run.runToken!,
      importGen: run.importGen ?? state.lastImportGen ?? 0,
      initialTimeScale: options?.timeScale,
    });

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: clock,
      },
    }));

    return clock;
  },

  startSimulationClock: (runIdOrHandle, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'start simulation clock',
      true
    );

    // Clock must be initialized before starting
    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot start simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    const nextClock = setSimulationClockPhase(currentClock, 'advancing');

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));
  },

  pauseSimulationClock: (runIdOrHandle, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'pause simulation clock',
      false
    );

    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot pause simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    const nextClock = setSimulationClockPhase(currentClock, 'paused');

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));
  },

  resumeSimulationClock: (runIdOrHandle, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'resume simulation clock',
      true
    );

    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot resume simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    const nextClock = setSimulationClockPhase(currentClock, 'advancing');

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));
  },

  stepSimulationClock: (runIdOrHandle, elapsedRealMs, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'advance simulation clock',
      true
    );

    // B4: Cannot implicitly bypass initialization
    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot advance simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    // B4: Cannot implicitly bypass startSimulationClock; stepping requires 'advancing' phase
    if (currentClock.phase === 'idle') {
      throw new Error(
        `Cannot advance simulation clock for SimulationRun ${runId}: Clock is in idle phase (must call startSimulationClock before stepping)`
      );
    }

    // B3: Paused clocks strictly reject advancement; no bypass allowed
    if (currentClock.phase === 'paused') {
      throw new Error(
        `Cannot advance simulation clock for SimulationRun ${runId}: Clock is paused`
      );
    }

    // B2: Pure advancement with fractional carry
    const nextClock = advanceSimulationClock(currentClock, elapsedRealMs);

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));

    return nextClock;
  },

  setSimulationClockScale: (runIdOrHandle, timeScale, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'set simulation clock scale',
      false
    );

    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot set scale on simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    const nextClock = setSimulationClockTimeScale(currentClock, timeScale);

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));
  },

  resetSimulationClockSession: (runIdOrHandle, options) => {
    const state = get();
    const { runId } = resolveAndValidateRunForClock(
      state,
      runIdOrHandle,
      options,
      'reset simulation clock',
      false
    );

    const currentClock = state.simulationClocks?.[runId];
    if (!currentClock) {
      throw new Error(
        `Cannot reset simulation clock for SimulationRun ${runId}: Clock session has not been initialized`
      );
    }

    // B4: Disallow rewinding an already advanced clock
    if (currentClock.simTimeMs > 0 || currentClock.tickCount > 0) {
      throw new Error(
        `Cannot reset simulation clock for SimulationRun ${runId}: Clock has already advanced (${currentClock.tickCount} ticks, ${currentClock.simTimeMs}ms). Runtime rewinding is disallowed.`
      );
    }

    if (currentClock.phase !== 'idle') {
      throw new Error(
        `Cannot reset simulation clock for SimulationRun ${runId}: Reset is only allowed during pre-execution preparation in idle phase.`
      );
    }

    const nextClock = resetSimulationClock(currentClock, {
      preserveTimeScale: options?.preserveTimeScale,
    });

    set((s) => ({
      simulationClocks: {
        ...s.simulationClocks,
        [runId]: nextClock,
      },
    }));

    return nextClock;
  },
});
