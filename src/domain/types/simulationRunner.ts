/**
 * @fileoverview Domain types and contracts for the Deterministic Simulation Runner.
 * Part of Checkpoint 2C.4.
 *
 * Connects the Deterministic Simulation Clock (2C.2) and the Simulation Event Timeline (2C.3)
 * into a single atomic, deterministic manual advancement step.
 */

import type { SimulationClockState } from './simulationClock';
import type {
  SimulationEvent,
  SimulationTimelineState,
  AppendSimulationEventParams,
} from './simulationTimeline';

/**
 * Caller input for advancing a simulation execution step.
 */
export interface SimulationStepInput {
  /** Elapsed real time in milliseconds to advance the clock by */
  readonly elapsedRealMs: number;
  /** Optional generic event inputs to record at the stepped simulation time */
  readonly events?: readonly AppendSimulationEventParams[];
}

/**
 * Execution incarnation token and workspace generation options for step verification.
 */
export interface SimulationStepOptions {
  readonly runToken?: string;
  readonly importGen?: number;
}

/**
 * Immutable report of a committed simulation step execution.
 */
export interface SimulationStepResult {
  readonly runId: string;
  readonly runToken: string;
  readonly importGen: number;
  readonly clock: SimulationClockState;
  readonly events: readonly SimulationEvent[];
  readonly timeline: SimulationTimelineState;
}
