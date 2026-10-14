/**
 * @fileoverview Pure domain calculations, validations, and state transitions
 * for the Simulation Event Timeline Foundation.
 * Part of Checkpoint 2C.3.
 *
 * Invariants:
 * - Deterministic, pure domain functions with zero wall-clock dependencies.
 * - Append-only: events cannot be mutated, retroactively inserted, or renumbered.
 * - Monotonic ordering: new event timestamp must be >= last event timestamp.
 * - Equal-timestamp preservation: events at identical simTimeNs preserve append order via sequence.
 * - Complete immutability: deepFreeze applied to all stored events, payloads, and timelines.
 * - Robust payload isolation: caller-side mutation of original payload cannot affect history.
 */

import { MAX_SUPPORTED_SIM_TIME_NS } from '../types/simulationClock';
import type {
  SimulationEvent,
  SimulationTimelineState,
  SimulationEventPayload,
  AppendSimulationEventParams,
  QuerySimulationEventsRange,
} from '../types/simulationTimeline';
import { deepFreeze } from '../../utils/deepFreeze';

/**
 * Deterministically generates an unambiguous event ID for a simulation event.
 * Encodes identity components to eliminate delimiter-collision ambiguity.
 *
 * Format: evt:<encodedRunId>:<encodedRunToken>:<importGen>:<sequence>
 * Since encodeURIComponent encodes colons as %3A, colons in runId or runToken
 * can never collide with the structural colon delimiters.
 */
export function generateSimulationEventId(
  runId: string,
  runToken: string,
  importGen: number,
  sequence: number
): string {
  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    throw new TypeError('generateSimulationEventId: runId must be a non-empty string');
  }
  if (!runToken || typeof runToken !== 'string' || runToken.trim() === '') {
    throw new TypeError('generateSimulationEventId: runToken must be a non-empty string');
  }
  if (!Number.isSafeInteger(importGen) || importGen < 0) {
    throw new RangeError('generateSimulationEventId: importGen must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('generateSimulationEventId: sequence must be a non-negative safe integer');
  }

  return `evt:${encodeURIComponent(runId)}:${encodeURIComponent(runToken)}:${importGen}:${sequence}`;
}

/**
 * Recursively validates and clones an event payload value to ensure JSON-compatibility,
 * absence of cycles, absence of functions/symbols/bigints/undefined, and strict immutability.
 */
function validateAndClonePayloadValue(
  value: unknown,
  activePath: Set<object>
): unknown {
  if (value === undefined) {
    throw new TypeError('Simulation event payload: undefined values are not permitted');
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Simulation event payload: non-finite number (${value}) is not permitted`);
    }
    return value;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Simulation event payload: BigInt values are not permitted');
  }
  if (typeof value === 'symbol') {
    throw new TypeError('Simulation event payload: Symbol values are not permitted');
  }
  if (typeof value === 'function') {
    throw new TypeError('Simulation event payload: functions are not permitted');
  }

  if (typeof value === 'object') {
    if (activePath.has(value)) {
      throw new TypeError('Simulation event payload: cyclic structures are not permitted');
    }
    activePath.add(value);

    try {
      if (Array.isArray(value)) {
        const symbolProps = Object.getOwnPropertySymbols(value);
        if (symbolProps.length > 0) {
          throw new TypeError(
            'Simulation event payload: Symbol properties on arrays are not permitted'
          );
        }

        const ownPropNames = Object.getOwnPropertyNames(value);
        const len = value.length;

        if (ownPropNames.length !== len + 1) {
          throw new TypeError(
            'Simulation event payload: arrays with holes or extra properties are not permitted'
          );
        }

        for (const prop of ownPropNames) {
          if (prop === 'length') continue;
          const indexNum = Number(prop);
          if (
            !Number.isInteger(indexNum) ||
            indexNum < 0 ||
            indexNum >= len ||
            String(indexNum) !== prop
          ) {
            throw new TypeError(
              `Simulation event payload: extra own property "${prop}" on array is not permitted`
            );
          }
        }

        const clonedArray: unknown[] = new Array(len);
        for (let i = 0; i < len; i++) {
          const key = String(i);
          const desc = Object.getOwnPropertyDescriptor(value, key);
          if (!desc) {
            throw new TypeError(
              `Simulation event payload: array index ${i} is missing (sparse array hole)`
            );
          }
          if (desc.get !== undefined || desc.set !== undefined) {
            throw new TypeError(
              `Simulation event payload: accessor properties (getters/setters) on array index ${i} are not permitted`
            );
          }
          if (!desc.enumerable) {
            throw new TypeError(
              `Simulation event payload: non-enumerable array index ${i} is not permitted`
            );
          }
          const elemVal = desc.value;
          if (elemVal === undefined) {
            throw new TypeError(
              `Simulation event payload: undefined element at array index ${i} is not permitted`
            );
          }
          clonedArray[i] = validateAndClonePayloadValue(elemVal, activePath);
        }
        return deepFreeze(clonedArray);
      }

      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) {
        const typeName = proto?.constructor?.name ?? 'unknown';
        throw new TypeError(
          `Simulation event payload: unsupported object type (${typeName}), only plain objects and arrays are permitted`
        );
      }

      const symbolProps = Object.getOwnPropertySymbols(value);
      if (symbolProps.length > 0) {
        throw new TypeError('Simulation event payload: Symbol property keys are not permitted');
      }

      const clonedObj: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc) continue;
        if (desc.get !== undefined || desc.set !== undefined) {
          throw new TypeError(
            `Simulation event payload: accessor properties (getters/setters) are not permitted on key "${key}"`
          );
        }
        const propVal = desc.value;
        if (propVal === undefined) {
          throw new TypeError(
            `Simulation event payload: undefined value for key "${key}" is not permitted`
          );
        }
        const clonedVal = validateAndClonePayloadValue(propVal, activePath);
        Object.defineProperty(clonedObj, key, {
          value: clonedVal,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return deepFreeze(clonedObj);
    } finally {
      activePath.delete(value);
    }
  }

  throw new TypeError(`Simulation event payload: unsupported value type (${typeof value})`);
}

/**
 * Validates, deep-clones, and deep-freezes a caller-supplied event payload.
 * Returns undefined if payload was omitted (undefined).
 */
export function cloneEventPayload(payload?: unknown): SimulationEventPayload | undefined {
  if (payload === undefined) {
    return undefined;
  }
  if (payload === null || typeof payload !== 'object') {
    throw new TypeError('Simulation event payload: must be a plain object or array');
  }
  return validateAndClonePayloadValue(payload, new Set()) as SimulationEventPayload;
}

/**
 * Initializes a new pure-domain simulation event timeline for an execution incarnation.
 */
export function createSimulationTimeline(
  runId: string,
  runToken: string,
  importGen: number
): SimulationTimelineState {
  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    throw new TypeError('createSimulationTimeline: runId must be a non-empty string');
  }
  if (!runToken || typeof runToken !== 'string' || runToken.trim() === '') {
    throw new TypeError('createSimulationTimeline: runToken must be a non-empty string');
  }
  if (!Number.isSafeInteger(importGen) || importGen < 0) {
    throw new RangeError('createSimulationTimeline: importGen must be a non-negative safe integer');
  }

  return deepFreeze({
    runId,
    runToken,
    importGen,
    events: [],
  });
}

/**
 * Pure domain function to append an event to an existing simulation timeline.
 * Returns the updated immutable timeline state and the created event.
 *
 * Invariants enforced:
 * - Caller cannot override eventId, sequence, or timestamps.
 * - Event timestamp must be >= last recorded event timestamp.
 * - Monotonic sequence allocation starting from 0.
 * - Deeply frozen payload with strict caller mutation isolation.
 * - Input timeline is never mutated.
 */
export function appendSimulationTimelineEvent(
  timeline: SimulationTimelineState,
  input: AppendSimulationEventParams,
  simTimeNs: number
): { readonly nextTimeline: SimulationTimelineState; readonly event: SimulationEvent } {
  if (!timeline || typeof timeline !== 'object') {
    throw new TypeError('appendSimulationTimelineEvent: timeline must be a valid SimulationTimelineState');
  }
  if (!Array.isArray(timeline.events)) {
    throw new TypeError('appendSimulationTimelineEvent: timeline.events must be an array');
  }

  // Reject caller-supplied internal fields if present on input
  const rawInput = input as unknown as Record<string, unknown>;
  if (
    'simTimeNs' in rawInput ||
    'simTimeMs' in rawInput ||
    'timestamp' in rawInput ||
    'sequence' in rawInput ||
    'eventId' in rawInput
  ) {
    throw new Error(
      'appendSimulationTimelineEvent: caller must not supply simTimeNs, simTimeMs, sequence, or eventId'
    );
  }

  // Validate eventType
  if (!input.eventType || typeof input.eventType !== 'string' || input.eventType.trim() === '') {
    throw new TypeError('appendSimulationTimelineEvent: eventType must be a non-empty string');
  }

  // Validate simTimeNs
  if (typeof simTimeNs !== 'number' || !Number.isSafeInteger(simTimeNs) || simTimeNs < 0) {
    throw new RangeError(
      `appendSimulationTimelineEvent: simTimeNs must be a non-negative safe integer (got ${simTimeNs})`
    );
  }
  if (simTimeNs > MAX_SUPPORTED_SIM_TIME_NS) {
    throw new RangeError(
      `appendSimulationTimelineEvent: simTimeNs (${simTimeNs} ns) exceeds maximum supported horizon (${MAX_SUPPORTED_SIM_TIME_NS} ns)`
    );
  }

  // Monotonic ordering check
  if (timeline.events.length > 0) {
    const lastEvent = timeline.events[timeline.events.length - 1];
    if (simTimeNs < lastEvent.simTimeNs) {
      throw new RangeError(
        `appendSimulationTimelineEvent: new event time (${simTimeNs} ns) precedes last event time (${lastEvent.simTimeNs} ns)`
      );
    }
  }

  // Clone and freeze payload
  const clonedPayload = cloneEventPayload(input.payload);

  // Allocate sequence and eventId
  const sequence = timeline.events.length;
  const eventId = generateSimulationEventId(
    timeline.runId,
    timeline.runToken,
    timeline.importGen,
    sequence
  );

  const event: SimulationEvent = deepFreeze({
    eventId,
    runId: timeline.runId,
    runToken: timeline.runToken,
    importGen: timeline.importGen,
    sequence,
    simTimeNs,
    eventType: input.eventType.trim(),
    ...(clonedPayload !== undefined ? { payload: clonedPayload } : {}),
  });

  const nextTimeline: SimulationTimelineState = deepFreeze({
    runId: timeline.runId,
    runToken: timeline.runToken,
    importGen: timeline.importGen,
    events: [...timeline.events, event],
  });

  return { nextTimeline, event };
}

/**
 * Pure domain query function supporting interval queries on a timeline or event array.
 * Half-open interval [fromNs, toNs) — inclusive at start, exclusive at end.
 * Preserves append sequence order for events with identical timestamps.
 */
export function querySimulationEvents(
  timelineOrEvents: SimulationTimelineState | readonly SimulationEvent[],
  range?: QuerySimulationEventsRange
): readonly SimulationEvent[] {
  if (!timelineOrEvents) {
    return deepFreeze([]);
  }

  const events: readonly SimulationEvent[] = Array.isArray(timelineOrEvents)
    ? timelineOrEvents
    : (timelineOrEvents as SimulationTimelineState).events;

  if (!Array.isArray(events)) {
    throw new TypeError(
      'querySimulationEvents: invalid input, expected SimulationTimelineState or events array'
    );
  }

  if (!range || (range.fromNs === undefined && range.toNs === undefined)) {
    return events;
  }

  let fromNs: number | undefined = undefined;
  if (range.fromNs !== undefined) {
    if (typeof range.fromNs !== 'number' || !Number.isSafeInteger(range.fromNs) || range.fromNs < 0) {
      throw new RangeError(
        `querySimulationEvents: fromNs must be a non-negative safe integer (got ${range.fromNs})`
      );
    }
    fromNs = range.fromNs;
  }

  let toNs: number | undefined = undefined;
  if (range.toNs !== undefined) {
    if (typeof range.toNs !== 'number' || !Number.isSafeInteger(range.toNs) || range.toNs < 0) {
      throw new RangeError(
        `querySimulationEvents: toNs must be a non-negative safe integer (got ${range.toNs})`
      );
    }
    toNs = range.toNs;
  }

  if (fromNs !== undefined && toNs !== undefined && fromNs > toNs) {
    throw new RangeError(
      `querySimulationEvents: invalid range: fromNs (${fromNs}) cannot be greater than toNs (${toNs})`
    );
  }

  // Consistent empty-range handling: [t, t) interval is always empty
  if (fromNs !== undefined && toNs !== undefined && fromNs === toNs) {
    return deepFreeze([]);
  }

  const min = fromNs ?? 0;
  const max = toNs ?? Infinity;

  // Filter [min, max) preserving original array sequence
  const filtered = events.filter(e => e.simTimeNs >= min && e.simTimeNs < max);
  return deepFreeze(filtered);
}
