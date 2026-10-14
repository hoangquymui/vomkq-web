/**
 * @fileoverview Domain contracts and type definitions for the Simulation Event Timeline Foundation.
 * Part of Checkpoint 2C.3.
 *
 * The simulation event timeline is a pure-domain, deterministic, immutable,
 * and append-only log of events occurring during a SimulationRun execution incarnation.
 */

export type SimulationEventJsonPrimitive = string | number | boolean | null;

export type SimulationEventPayloadValue =
  | SimulationEventJsonPrimitive
  | readonly SimulationEventPayloadValue[]
  | { readonly [key: string]: SimulationEventPayloadValue };

export type SimulationEventPayload =
  | { readonly [key: string]: SimulationEventPayloadValue }
  | readonly SimulationEventPayloadValue[];

/**
 * Minimal canonical envelope for a recorded simulation event.
 */
export interface SimulationEvent {
  /** Deterministic event ID bound to runId, runToken, importGen, and sequence */
  readonly eventId: string;
  /** SimulationRun identifier */
  readonly runId: string;
  /** Active execution incarnation token */
  readonly runToken: string;
  /** Workspace import generation at time of execution */
  readonly importGen: number;

  /** Zero-based monotonically increasing sequence index allocated by timeline */
  readonly sequence: number;
  /** Authoritative integer-nanosecond timestamp captured from canonical SimulationClock */
  readonly simTimeNs: number;

  /** Valid nonempty event type identifier */
  readonly eventType: string;
  /** Optional validated, deeply frozen, acyclic JSON-compatible plain data payload */
  readonly payload?: Readonly<SimulationEventPayload>;
}

/**
 * Runtime state representing a simulation event timeline for one execution incarnation.
 */
export interface SimulationTimelineState {
  readonly runId: string;
  readonly runToken: string;
  readonly importGen: number;
  readonly events: readonly SimulationEvent[];
}

/**
 * Caller input parameters for appending an event to a timeline.
 * Explicitly excludes eventId, sequence, and timestamps.
 */
export interface AppendSimulationEventParams {
  readonly eventType: string;
  readonly payload?: unknown;
}

/**
 * Query range filter for retrieving simulation events.
 * Interval is half-open: [fromNs, toNs) — inclusive at start, exclusive at end.
 */
export interface QuerySimulationEventsRange {
  readonly fromNs?: number;
  readonly toNs?: number;
}
