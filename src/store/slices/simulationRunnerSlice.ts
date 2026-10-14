/**
 * @fileoverview Zustand store slice for the Deterministic Simulation Runner MVP.
 * Part of Checkpoint 2C.4.
 *
 * Implements atomic, manual execution step orchestration connecting the
 * SimulationRun Registry (2C.1), Deterministic Clock (2C.2), and
 * Simulation Event Timeline (2C.3).
 */

import type { StoreSet, StoreGet } from '../types';
import type {
  SimulationRunStatus,
  SimulationRunHandle,
} from '../../domain/types/simulation';
import type {
  SimulationStepInput,
  SimulationStepOptions,
  SimulationStepResult,
} from '../../domain/types/simulationRunner';
import { executeSimulationStep } from '../../domain/simulation/simulationRunner';
import { isSimulationRunFresh } from '../../domain/simulation/simulationFreshness';
import { evaluateRadarSurveillanceForPlan } from '../../domain/simulation/radarSurveillanceEvaluation';
import { deepFreeze } from '../../utils/deepFreeze';

const TERMINAL_STATUSES: Set<SimulationRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export interface SimulationRunnerSlice {
  stepSimulation: (
    runIdOrHandle: string | SimulationRunHandle,
    input: SimulationStepInput,
    options?: SimulationStepOptions
  ) => SimulationStepResult;
  stepSimulationWithRadarEvaluation: (
    runIdOrHandle: string | SimulationRunHandle,
    input: {
      elapsedRealMs: number;
      targetAltitudeM?: number;
    },
    options?: SimulationStepOptions
  ) => SimulationStepResult;
}

export const createSimulationRunnerSlice = (
  set: StoreSet,
  get: StoreGet
): SimulationRunnerSlice => ({
  stepSimulation: (runIdOrHandle, input, options) => {
    const state = get();

    // 1. Resolve runId, token, and importGen from handle or arguments
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

    // 2. Target SimulationRun exists
    const run = state.simulationRuns[runId];
    if (!run) {
      throw new Error(`Cannot step simulation: SimulationRun ${runId} not found`);
    }

    // 3. Caller generation check: reject if handle was issued in an obsolete generation
    if (
      providedImportGen !== undefined &&
      state.lastImportGen !== undefined &&
      providedImportGen !== state.lastImportGen
    ) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Workspace was replaced by import after registration (caller generation: ${providedImportGen}, current: ${state.lastImportGen})`
      );
    }

    // 4. Incarnation token enforcement (B5 invariant)
    if (!run.runToken || typeof run.runToken !== 'string' || run.runToken.trim() === '') {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Record is an imported historical run without an active execution incarnation token`
      );
    }

    if (!providedToken || providedToken !== run.runToken) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Invalid or missing execution incarnation token (expected ${run.runToken}, got ${providedToken ?? 'none'})`
      );
    }

    // 5. Workspace replacement guard on run record
    if (
      run.importGen !== undefined &&
      state.lastImportGen !== undefined &&
      run.importGen !== (state.lastImportGen ?? 0)
    ) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Workspace was replaced by import after registration (run import generation: ${run.importGen}, current: ${state.lastImportGen ?? 0})`
      );
    }

    // 6. Source plan and scenario validity
    const plan = state.plans[run.planId];
    if (!plan || plan.status === 'trashed') {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Plan ${run.planId} does not exist or is trashed`
      );
    }
    const scenario = state.scenarios[run.scenarioId];
    if (!scenario || scenario.status === 'trashed') {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Scenario ${run.scenarioId} does not exist or is trashed`
      );
    }

    // 7. Historical legacy record check
    if (!run.status) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Historical legacy run without execution lifecycle status is read-only`
      );
    }

    // 8. Provenance / Freshness check
    if (!isSimulationRunFresh(state, run)) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Run is not fresh (stale or unverified provenance)`
      );
    }

    // 9. Terminal status lock
    if (TERMINAL_STATUSES.has(run.status)) {
      throw new Error(
        `Cannot step simulation for terminal SimulationRun ${runId} (status: ${run.status})`
      );
    }

    // 10. Status must be running
    if (run.status !== 'running') {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Run must be in running status (current status: ${run.status})`
      );
    }

    const currentImportGen = run.importGen ?? state.lastImportGen ?? 0;

    // 11. Clock session exists & incarnation matches
    const clock = state.simulationClocks?.[runId];
    if (!clock) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Clock session does not exist`
      );
    }
    if (
      clock.runId !== runId ||
      clock.runToken !== run.runToken ||
      clock.importGen !== currentImportGen
    ) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Clock session incarnation mismatch`
      );
    }

    // 12. Clock phase allows advancement
    if (clock.phase !== 'advancing') {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Clock phase must be advancing (current phase: ${clock.phase})`
      );
    }

    // 13. Timeline session exists & incarnation matches
    const timeline = state.simulationTimelines?.[runId];
    if (!timeline) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Timeline session does not exist`
      );
    }
    if (
      timeline.runId !== runId ||
      timeline.runToken !== run.runToken ||
      timeline.importGen !== currentImportGen
    ) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Timeline session incarnation mismatch`
      );
    }

    const initialClock = clock;
    const initialTimeline = timeline;
    const initialRun = run;
    const stateAtStart = state;

    // 14. Input validation
    if (!input || typeof input !== 'object') {
      throw new TypeError('Cannot step simulation: input must be a valid SimulationStepInput object');
    }
    if (input.events !== undefined && !Array.isArray(input.events)) {
      throw new TypeError('Cannot step simulation: input.events must be an array when provided');
    }

    // 15. Pure step calculation (atomic, rollback on any clock or event error)
    const { nextClock, nextTimeline, recordedEvents } = executeSimulationStep(
      initialClock,
      initialTimeline,
      input
    );

    // 16. Authoritative execution context / concurrency guard:
    // If synchronous reentrant behavior (e.g. getters on input) modified store state,
    // reject immediately to prevent committing a stale candidate or overwriting newer state.
    const stateAfterCalc = get();

    if (stateAfterCalc.lastImportGen !== stateAtStart.lastImportGen) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Workspace was replaced by import during candidate calculation (initial generation: ${stateAtStart.lastImportGen ?? 0}, current: ${stateAfterCalc.lastImportGen ?? 0})`
      );
    }

    if (stateAfterCalc.simulationClocks?.[runId] !== initialClock) {
      const currentClock = stateAfterCalc.simulationClocks?.[runId];
      const detail = currentClock ? `current phase: ${currentClock.phase}` : 'session was removed';
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Clock session was modified during candidate calculation (${detail})`
      );
    }

    if (stateAfterCalc.simulationTimelines?.[runId] !== initialTimeline) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Timeline session was modified during candidate calculation`
      );
    }

    if (stateAfterCalc.simulationRuns?.[runId] !== initialRun) {
      const currentRun = stateAfterCalc.simulationRuns?.[runId];
      const detail = currentRun ? `current status: ${currentRun.status}` : 'run was removed';
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: SimulationRun record was modified during candidate calculation (${detail})`
      );
    }

    if (stateAfterCalc !== stateAtStart) {
      throw new Error(
        `Cannot step simulation for SimulationRun ${runId}: Store state was modified during candidate calculation`
      );
    }

    // 17. Commit next clock and timeline in ONE synchronous state update
    set((s) => {
      // Re-verify against updater snapshot s to ensure atomic non-stale commit
      if (
        s.lastImportGen !== stateAtStart.lastImportGen ||
        s.simulationClocks?.[runId] !== initialClock ||
        s.simulationTimelines?.[runId] !== initialTimeline ||
        s.simulationRuns?.[runId] !== initialRun ||
        s !== stateAfterCalc
      ) {
        throw new Error(
          `Cannot step simulation for SimulationRun ${runId}: Authoritative state was modified before commit`
        );
      }

      return {
        simulationClocks: {
          ...s.simulationClocks,
          [runId]: nextClock,
        },
        simulationTimelines: {
          ...s.simulationTimelines,
          [runId]: nextTimeline,
        },
      };
    });

    // 16. Return immutable execution report
    return deepFreeze({
      runId,
      runToken: run.runToken,
      importGen: currentImportGen,
      clock: nextClock,
      events: recordedEvents,
      timeline: nextTimeline,
    });
  },

  stepSimulationWithRadarEvaluation: (runIdOrHandle, input, options) => {
    const stateAtEntry = get();

    if (!input || typeof input !== 'object') {
      throw new TypeError(
        'Cannot step simulation with radar evaluation: input must be a valid object'
      );
    }

    // 1. Materialize all caller input values and handles first to execute any synchronous getters
    const elapsedRealMs = input.elapsedRealMs;
    const targetAltitudeM = input.targetAltitudeM;

    let runId: string;
    let safeRunIdOrHandle: string | SimulationRunHandle;
    if (typeof runIdOrHandle === 'object' && runIdOrHandle !== null) {
      // Materialize each property from the execution handle exactly ONCE (Blocker B4)
      const capturedRunId = runIdOrHandle.runId;
      const capturedRunToken = runIdOrHandle.runToken;
      const capturedImportGen = runIdOrHandle.importGen;

      runId = capturedRunId;
      safeRunIdOrHandle = {
        runId: capturedRunId,
        runToken: capturedRunToken,
        importGen: capturedImportGen,
      };
    } else {
      runId = runIdOrHandle;
      safeRunIdOrHandle = runIdOrHandle;
    }

    let safeOptions = options;
    if (options && typeof options === 'object') {
      const capturedOptToken = options.runToken;
      const capturedOptGen = options.importGen;
      safeOptions = {
        runToken: capturedOptToken,
        importGen: capturedOptGen,
      };
    }

    // 2. Authoritative source context check: verify state was not modified during input preparation
    const stateAtStart = get();
    if (
      stateAtStart !== stateAtEntry ||
      stateAtStart.lastImportGen !== stateAtEntry.lastImportGen
    ) {
      throw new Error(
        `Cannot step simulation with radar evaluation: Store state or workspace generation was modified during input preparation`
      );
    }

    if (!runId || typeof runId !== 'string') {
      throw new TypeError(
        'Cannot step simulation with radar evaluation: runId must be a valid non-empty string'
      );
    }

    const run = stateAtStart.simulationRuns?.[runId];
    if (!run) {
      throw new Error(
        `Cannot step simulation with radar evaluation: SimulationRun ${runId} not found`
      );
    }

    // 3. Evaluate radar surveillance purely against authoritative canonical state
    const evaluationEvent = evaluateRadarSurveillanceForPlan(
      run.planId,
      run.scenarioId,
      stateAtStart.placements,
      stateAtStart.definitions,
      { targetAltitudeM }
    );

    // 4. Concurrency check: verify store state was not modified during evaluation
    const stateAfterEval = get();
    if (
      stateAfterEval !== stateAtStart ||
      stateAfterEval.lastImportGen !== stateAtStart.lastImportGen ||
      stateAfterEval.simulationRuns?.[runId] !== run ||
      stateAfterEval.placements !== stateAtStart.placements ||
      stateAfterEval.definitions !== stateAtStart.definitions
    ) {
      throw new Error(
        `Cannot step simulation with radar evaluation: Store state or workspace generation was modified during domain evaluation`
      );
    }

    // 5. Delegate to existing atomic runner action stepSimulation
    // Ensures all 13 guards, atomicity rollback, and anti-stale/reentrant checks execute
    return get().stepSimulation(
      safeRunIdOrHandle,
      {
        elapsedRealMs,
        events: [evaluationEvent],
      },
      safeOptions
    );
  },
});
