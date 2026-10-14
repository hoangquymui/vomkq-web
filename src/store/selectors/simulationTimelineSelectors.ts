/**
 * @fileoverview Pure read-only selectors for the simulation event timeline.
 * Part of Checkpoint 2C.3.
 *
 * Invariants:
 * - Read-only queries without state mutation.
 * - Do not change activeSimulationRunId.
 * - Do not advance simulation clock or write AuditEvents.
 */

import type { TacticalState } from '../types';
import type {
  SimulationEvent,
  SimulationTimelineState,
  QuerySimulationEventsRange,
} from '../../domain/types/simulationTimeline';
import { querySimulationEvents } from '../../domain/simulation/simulationTimeline';

/**
 * Selects a SimulationTimelineState by runId from runtime session state.
 */
export const selectSimulationTimelineByRunId = (
  state: TacticalState,
  runId: string | null | undefined
): SimulationTimelineState | null => {
  if (!runId || !state.simulationTimelines) return null;
  return state.simulationTimelines[runId] || null;
};

/**
 * Selects the SimulationTimelineState for the currently active SimulationRun.
 */
export const selectActiveSimulationTimeline = (
  state: TacticalState
): SimulationTimelineState | null => {
  if (!state.activeSimulationRunId || !state.simulationTimelines) return null;
  return state.simulationTimelines[state.activeSimulationRunId] || null;
};

/**
 * Selects events for a specific runId within an optional [fromNs, toNs) range.
 */
export const selectSimulationEventsByRunId = (
  state: TacticalState,
  runId: string | null | undefined,
  range?: QuerySimulationEventsRange
): readonly SimulationEvent[] => {
  const timeline = selectSimulationTimelineByRunId(state, runId);
  if (!timeline) return Object.freeze([]);
  return querySimulationEvents(timeline, range);
};

/**
 * Selects events for the currently active SimulationRun within an optional [fromNs, toNs) range.
 */
export const selectActiveSimulationEvents = (
  state: TacticalState,
  range?: QuerySimulationEventsRange
): readonly SimulationEvent[] => {
  const timeline = selectActiveSimulationTimeline(state);
  if (!timeline) return Object.freeze([]);
  return querySimulationEvents(timeline, range);
};

/**
 * Selects the total event count for a specific runId, or active run if omitted.
 */
export const selectSimulationEventCount = (
  state: TacticalState,
  runId?: string | null
): number => {
  const targetRunId = runId ?? state.activeSimulationRunId;
  const timeline = selectSimulationTimelineByRunId(state, targetRunId);
  return timeline ? timeline.events.length : 0;
};
