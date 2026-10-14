/**
 * @fileoverview Pure domain calculations and validations for the Deterministic Simulation Runner.
 * Part of Checkpoint 2C.4.
 *
 * Coordinates deterministic clock advancement (2C.2) and immutable event recording (2C.3)
 * into a single pure, atomic execution step.
 */

import type { SimulationClockState } from '../types/simulationClock';
import type {
  SimulationEvent,
  SimulationTimelineState,
} from '../types/simulationTimeline';
import type { SimulationStepInput } from '../types/simulationRunner';
import { advanceSimulationClock } from './simulationClock';
import { appendSimulationTimelineEvent } from './simulationTimeline';
import { deepFreeze } from '../../utils/deepFreeze';

/**
 * Pure domain orchestration for executing a single simulation step.
 *
 * Invariants enforced:
 * - Pure function: inputs are never mutated.
 * - Incarnation matching: clock and timeline must belong to the exact same execution incarnation.
 * - Deterministic advancement: nextClock is calculated via canonical integer nanoseconds.
 * - Atomic event application: all supplied events are validated and recorded at the stepped simTimeNs.
 * - Rollback on failure: if clock advancement or any event validation fails, throws without returning partial state.
 * - Order preservation: events strictly maintain caller-supplied array order and sequence.
 */
export function executeSimulationStep(
  clock: SimulationClockState,
  timeline: SimulationTimelineState,
  input: SimulationStepInput
): {
  readonly nextClock: SimulationClockState;
  readonly nextTimeline: SimulationTimelineState;
  readonly recordedEvents: readonly SimulationEvent[];
} {
  if (!clock || typeof clock !== 'object') {
    throw new TypeError('executeSimulationStep: clock must be a valid SimulationClockState');
  }
  if (!timeline || typeof timeline !== 'object') {
    throw new TypeError('executeSimulationStep: timeline must be a valid SimulationTimelineState');
  }

  // Incarnation coherence guard
  if (
    clock.runId !== timeline.runId ||
    clock.runToken !== timeline.runToken ||
    clock.importGen !== timeline.importGen
  ) {
    throw new Error(
      `executeSimulationStep: Clock and Timeline incarnation mismatch (clock: ${clock.runId}/${clock.runToken}/${clock.importGen}, timeline: ${timeline.runId}/${timeline.runToken}/${timeline.importGen})`
    );
  }

  // Validate input presence
  if (!input || typeof input !== 'object') {
    throw new TypeError('executeSimulationStep: input must be a valid SimulationStepInput object');
  }

  if (input.events !== undefined && !Array.isArray(input.events)) {
    throw new TypeError('executeSimulationStep: input.events must be an array when provided');
  }

  // 1. Advance candidate clock (pure)
  // Enforces valid finite elapsed time, active phase ('advancing'), horizon boundaries, and carry.
  const nextClock = advanceSimulationClock(clock, input.elapsedRealMs);

  // 2. Prepare candidate timeline with all supplied events (pure)
  const stepSimTimeNs = nextClock.simTimeNs;
  let currentTimeline = timeline;
  const recordedEvents: SimulationEvent[] = [];

  if (input.events !== undefined) {
    for (const eventInput of input.events) {
      const { nextTimeline, event } = appendSimulationTimelineEvent(
        currentTimeline,
        eventInput,
        stepSimTimeNs
      );
      currentTimeline = nextTimeline;
      recordedEvents.push(event);
    }
  }

  return deepFreeze({
    nextClock,
    nextTimeline: currentTimeline,
    recordedEvents: Object.freeze(recordedEvents),
  });
}
