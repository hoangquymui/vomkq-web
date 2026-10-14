/**
 * @fileoverview Pure domain calculations, validations, and state transitions
 * for the Simulation Clock Foundation.
 *
 * Deterministic Numerical Representation across Supported Horizon:
 * - Time Unit: Integer nanoseconds (simTimeNs) with derived millisecond projection (simTimeMs = simTimeNs / 1e6).
 * - Minimum Discrete Advancement Resolution: 1 nanosecond (MIN_SIMULATION_RESOLUTION_MS = 0.000001 ms).
 * - Minimum Fractional Carry Resolution: 1 picosecond (MIN_FRACTIONAL_RESOLUTION_MS = 0.000000001 ms = 1 ps).
 * - Supported Time Horizon: [0, 9,000,000,000,000,000 ns] (MAX_SUPPORTED_SIM_TIME_NS = 9e15 ns = 9e9 ms = 104.16 days).
 *
 * Mathematical Design & Precision Invariants (B2.1, B2.2, B2.3):
 *   In IEEE-754 double precision (53-bit mantissa, MAX_SAFE_INTEGER = 9,007,199,254,740,991):
 *   Every integer up to 9e15 is represented with 100% exactness (Number.isSafeInteger === true).
 *   The authoritative accumulator `simTimeNs` stores time directly in integer nanoseconds.
 *
 *   On each discrete step (B2.3 independent partitioning):
 *     1. `rawDelta = elapsedRealMs * timeScale` is validated to be finite and <= MAX_SUPPORTED_SIM_TIME_MS.
 *     2. `rawDelta` is partitioned into integral milliseconds (`deltaIntMs = floor(rawDelta)`) and
 *        sub-millisecond fraction (`deltaFracMs = rawDelta - deltaIntMs`) BEFORE incorporating prior carry.
 *        This prevents IEEE-754 truncation of small sub-nanosecond carries when rawDelta is large.
 *     3. Sub-millisecond fraction is converted to integer picoseconds: `deltaFracPicoseconds = round(deltaFracMs * 1e9)`.
 *     4. Prior carry is converted to small safe integer picoseconds: `priorCarryPicoseconds = round(priorCarryMs * 1e9) < 1000`.
 *     5. Fractions are combined via small-integer picosecond arithmetic: `totalPicoseconds = deltaFracPicoseconds + priorCarryPicoseconds`.
 *     6. Rollover from picoseconds into milliseconds (1 ms = 10^9 ps) is explicitly normalized.
 *     7. Discrete advancement in integer nanoseconds: `deltaNs = (totalIntMs * 1e6) + floor(remainingPicosecondsAfterMs / 1000)`.
 *     8. Target nanoseconds: `nextNs = currentNs + deltaNs`.
 *     9. Sub-nanosecond remainder (`remainingPicosecondsAfterMs % 1000`) is preserved in `fractionalCarryMs`.
 *    10. Effective horizon overflow guard: if `nextNs > MAX_SUPPORTED_SIM_TIME_NS` or
 *        (`nextNs === MAX_SUPPORTED_SIM_TIME_NS && remainingPicoseconds > 0`), advancement is explicitly rejected
 *        with `RangeError`, guaranteeing that no step ever exceeds the supported horizon even by a single picosecond.
 *
 * Invariants:
 * - Pure immutable calculations (returns deeply frozen state).
 * - Deterministic advancement through explicit elapsedRealMs without browser/runtime timers.
 * - Clock initialization strictly starts in 'idle' phase.
 * - Advancing requires 'advancing' phase. Advancing while 'idle' or 'paused' is strictly prohibited.
 * - Runtime rewinding of an already advanced clock is strictly prohibited.
 * - Strict monotonicity on authoritative simTimeNs.
 */

import {
  DEFAULT_SIMULATION_TIME_SCALE,
  MAX_SIMULATION_TIME_SCALE,
  MIN_SIMULATION_TIME_SCALE,
  MAX_SUPPORTED_SIM_TIME_MS,
  MAX_SUPPORTED_SIM_TIME_NS,
  type CreateSimulationClockParams,
  type SimulationClockPhase,
  type SimulationClockState,
} from '../types/simulationClock';
import { deepFreeze } from '../../utils/deepFreeze';

const VALID_PHASES = new Set<SimulationClockPhase>(['idle', 'advancing', 'paused']);

export function isValidClockPhase(phase: unknown): phase is SimulationClockPhase {
  return typeof phase === 'string' && VALID_PHASES.has(phase as SimulationClockPhase);
}

export function validateClockPhase(phase: unknown): asserts phase is SimulationClockPhase {
  if (!isValidClockPhase(phase)) {
    throw new Error(
      `Invalid simulation clock phase: ${String(phase)}. Expected 'idle', 'advancing', or 'paused'.`
    );
  }
}

export function isValidTimeScale(scale: unknown): scale is number {
  return (
    typeof scale === 'number' &&
    Number.isFinite(scale) &&
    scale >= MIN_SIMULATION_TIME_SCALE &&
    scale <= MAX_SIMULATION_TIME_SCALE
  );
}

export function validateTimeScale(scale: unknown): asserts scale is number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    throw new Error(
      `Simulation clock timeScale must be a finite number, got: ${String(scale)}`
    );
  }
  if (scale < MIN_SIMULATION_TIME_SCALE || scale > MAX_SIMULATION_TIME_SCALE) {
    throw new Error(
      `Simulation clock timeScale ${scale} is out of bounds. Must be between ${MIN_SIMULATION_TIME_SCALE}x and ${MAX_SIMULATION_TIME_SCALE}x.`
    );
  }
}

export function validateElapsedRealMs(ms: unknown): asserts ms is number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new Error(
      `Simulation clock elapsedRealMs must be a finite number, got: ${String(ms)}`
    );
  }
  if (ms < 0) {
    throw new Error(
      `Simulation clock elapsedRealMs cannot be negative, got: ${ms}`
    );
  }
}

/**
 * Creates a new deterministic, session-only Simulation Clock state.
 * Lifecycle strictly begins in 'idle' phase with canonical simTimeNs: 0 and zero fractional carry.
 */
export function createSimulationClock(params: CreateSimulationClockParams): SimulationClockState {
  if (!params.runId || typeof params.runId !== 'string' || params.runId.trim() === '') {
    throw new Error('Simulation clock requires a non-empty runId');
  }
  if (!params.runToken || typeof params.runToken !== 'string' || params.runToken.trim() === '') {
    throw new Error('Simulation clock requires a non-empty runToken');
  }

  const importGen = params.importGen ?? 0;
  if (!Number.isFinite(importGen) || !Number.isInteger(importGen) || importGen < 0) {
    throw new Error(`Simulation clock importGen must be a non-negative integer, got: ${importGen}`);
  }

  const timeScale = params.initialTimeScale ?? DEFAULT_SIMULATION_TIME_SCALE;
  validateTimeScale(timeScale);

  const clock: SimulationClockState = {
    runId: params.runId,
    runToken: params.runToken,
    importGen,
    simTimeNs: 0,
    simTimeMs: 0,
    fractionalCarryMs: 0,
    phase: 'idle',
    timeScale,
    tickCount: 0,
    lastStepRealMs: 0,
    lastSimDeltaMs: 0,
  };

  return deepFreeze(clock);
}

/**
 * Pure calculation advancing the simulation clock by elapsedRealMs.
 * Enforces:
 * - Clock must be in 'advancing' phase. Paused and idle clocks cannot advance.
 * - Time horizon guard: simTimeNs cannot advance past MAX_SUPPORTED_SIM_TIME_NS (9e15 ns = 9e9 ms = 104.16 days).
 * - Authoritative canonical accumulator: operates directly on integer safe-nanoseconds simTimeNs.
 * - Intermediate arithmetic validation: rejects non-finite rawDelta, totalDelta, intermediate delta, and overflow.
 * - Picosecond sub-nanosecond fractional carry: preserves carry across ticks and scale changes.
 * - Near-horizon overflow guard: rejects advancement if effective time (ns + fractional carry) crosses horizon.
 * Returns a new deeply frozen state.
 */
export function advanceSimulationClock(
  clock: SimulationClockState,
  elapsedRealMs: number
): SimulationClockState {
  if (!clock || typeof clock !== 'object') {
    throw new Error('Invalid clock state passed to advanceSimulationClock');
  }

  validateElapsedRealMs(elapsedRealMs);

  if (clock.phase === 'paused') {
    throw new Error(
      `Cannot advance simulation clock for SimulationRun ${clock.runId}: Clock is paused`
    );
  }

  if (clock.phase === 'idle') {
    throw new Error(
      `Cannot advance simulation clock for SimulationRun ${clock.runId}: Clock is in idle phase (must call startSimulationClock before stepping)`
    );
  }

  // Canonical nanosecond accumulator validation
  const currentNs = clock.simTimeNs;
  if (
    typeof currentNs !== 'number' ||
    !Number.isFinite(currentNs) ||
    currentNs < 0 ||
    currentNs >= MAX_SUPPORTED_SIM_TIME_NS
  ) {
    throw new RangeError(
      `Simulation clock time overflow: current simTimeNs ${currentNs}ns is at or exceeds the maximum supported horizon of ${MAX_SUPPORTED_SIM_TIME_NS}ns (${MAX_SUPPORTED_SIM_TIME_MS}ms)`
    );
  }

  if (!Number.isSafeInteger(currentNs)) {
    throw new RangeError(
      `Simulation clock state corrupted: simTimeNs must be a non-negative safe integer, got ${currentNs}`
    );
  }

  // Intermediate arithmetic validation (B2.2):
  // Check rawDelta multiplication overflow (e.g. Number.MAX_VALUE * 16 -> Infinity)
  const rawDelta = elapsedRealMs * clock.timeScale;
  if (!Number.isFinite(rawDelta) || rawDelta > MAX_SUPPORTED_SIM_TIME_MS) {
    throw new RangeError(
      `Simulation clock advancement delta overflow: calculated delta (${rawDelta}) exceeds maximum supported horizon`
    );
  }

  const priorCarryMs = clock.fractionalCarryMs ?? 0;
  if (!Number.isFinite(priorCarryMs) || priorCarryMs < 0) {
    throw new RangeError(
      `Simulation clock state corrupted: fractionalCarryMs must be a non-negative finite number, got ${priorCarryMs}`
    );
  }

  // Convert prior carry to integer picoseconds (1 ms = 10^9 ps).
  // fractionalCarryMs is strictly sub-nanosecond (< 1e-6 ms = 1000 ps), so this is a small safe integer [0, 999].
  const priorCarryPicoseconds = Math.round(priorCarryMs * 1e9);
  if (!Number.isSafeInteger(priorCarryPicoseconds) || priorCarryPicoseconds < 0) {
    throw new RangeError(
      `Simulation clock state corrupted: prior carry picoseconds (${priorCarryPicoseconds}) is invalid`
    );
  }

  // B2.3: Partition the NEW raw delta into integral milliseconds and sub-millisecond fraction
  // BEFORE incorporating prior carry. This prevents IEEE-754 truncation when rawDelta is large.
  let deltaIntMs = Math.floor(rawDelta);
  const deltaFracMs = Math.max(0, rawDelta - deltaIntMs);

  // Convert new fraction to integer picoseconds (0 <= deltaFracMs < 1 -> 0 <= deltaFracPicoseconds < 10^9).
  // Sub-picosecond inputs (< 1 picosecond = 10^-9 ms) round to nearest integer picosecond.
  // Unlimited precision is explicitly not claimed.
  let deltaFracPicoseconds = Math.round(deltaFracMs * 1e9);
  if (deltaFracPicoseconds >= 1e9) {
    deltaIntMs += Math.floor(deltaFracPicoseconds / 1e9);
    deltaFracPicoseconds = deltaFracPicoseconds % 1e9;
  }

  // Combine fractional picoseconds with prior carry using small-integer picosecond arithmetic.
  // totalPicoseconds is bounded by (< 10^9 + < 10^3) ~ 10^9, completely immune to IEEE-754 truncation.
  const totalPicoseconds = deltaFracPicoseconds + priorCarryPicoseconds;

  // Handle rollover from picoseconds into milliseconds (1 ms = 10^9 ps)
  const rolloverMs = Math.floor(totalPicoseconds / 1e9);
  const remainingPicosecondsAfterMs = totalPicoseconds % 1e9;
  const totalIntMs = deltaIntMs + rolloverMs;

  // Extract integer nanoseconds from picoseconds (1 ns = 1000 ps) and sub-nanosecond remainder
  const deltaNanosFromFrac = Math.floor(remainingPicosecondsAfterMs / 1000);
  const remainingPicoseconds = remainingPicosecondsAfterMs % 1000;

  // Total discrete advancement in integer nanoseconds
  const deltaNs = (totalIntMs * 1e6) + deltaNanosFromFrac;

  if (!Number.isSafeInteger(deltaNs) || deltaNs < 0) {
    throw new RangeError(
      `Simulation clock advancement delta overflow: intermediate nanoseconds (${deltaNs}) is not a valid safe integer`
    );
  }

  // Sub-nanosecond remainder in picoseconds carried into next tick
  const nextFractionalCarryMs = remainingPicoseconds / 1e9;

  // Authoritative target nanoseconds calculation
  const nextNs = currentNs + deltaNs;

  if (!Number.isSafeInteger(nextNs)) {
    throw new RangeError(
      `Simulation clock time overflow: calculated simTimeNs (${nextNs}) exceeds safe integer representation limit`
    );
  }

  // Strict monotonicity verification on authoritative accumulator
  if (nextNs < currentNs) {
    throw new Error(
      `Simulation clock monotonicity violation: nextNs (${nextNs}) < currentNs (${currentNs})`
    );
  }

  // Horizon check on target time AND fractional carry (B2.2 near-horizon overflow check):
  // If nextNs exceeds horizon, or if nextNs is exactly at horizon but has a non-zero fractional carry,
  // effective simulated time strictly exceeds the maximum supported horizon.
  if (
    nextNs > MAX_SUPPORTED_SIM_TIME_NS ||
    (nextNs === MAX_SUPPORTED_SIM_TIME_NS && remainingPicoseconds > 0)
  ) {
    throw new RangeError(
      `Simulation clock time overflow: calculated simTimeNs ${nextNs}ns (${(nextNs / 1e6).toFixed(6)}ms) with ${remainingPicoseconds}ps carry exceeds the maximum supported horizon of ${MAX_SUPPORTED_SIM_TIME_NS}ns (${MAX_SUPPORTED_SIM_TIME_MS}ms)`
    );
  }

  // Derived read projections for compatibility
  const simDeltaMs = deltaNs / 1e6;
  const nextSimTimeMs = nextNs / 1e6;

  const nextClock: SimulationClockState = {
    runId: clock.runId,
    runToken: clock.runToken,
    importGen: clock.importGen,
    simTimeNs: nextNs,
    simTimeMs: nextSimTimeMs,
    fractionalCarryMs: nextFractionalCarryMs,
    phase: 'advancing',
    timeScale: clock.timeScale,
    tickCount: clock.tickCount + 1,
    lastStepRealMs: elapsedRealMs,
    lastSimDeltaMs: simDeltaMs,
  };

  return deepFreeze(nextClock);
}

/**
 * Transitions the clock phase to a new valid phase ('idle', 'advancing', 'paused').
 * Returns a new frozen state.
 */
export function setSimulationClockPhase(
  clock: SimulationClockState,
  nextPhase: SimulationClockPhase
): SimulationClockState {
  if (!clock || typeof clock !== 'object') {
    throw new Error('Invalid clock state passed to setSimulationClockPhase');
  }
  validateClockPhase(nextPhase);

  if (clock.phase === nextPhase) {
    return clock;
  }

  const nextClock: SimulationClockState = {
    ...clock,
    phase: nextPhase,
  };

  return deepFreeze(nextClock);
}

/**
 * Sets a new valid timeScale [0.25, 16.0].
 * Fractional carry is preserved across time scale changes.
 * Returns a new frozen state.
 */
export function setSimulationClockTimeScale(
  clock: SimulationClockState,
  timeScale: number
): SimulationClockState {
  if (!clock || typeof clock !== 'object') {
    throw new Error('Invalid clock state passed to setSimulationClockTimeScale');
  }
  validateTimeScale(timeScale);

  if (clock.timeScale === timeScale) {
    return clock;
  }

  const nextClock: SimulationClockState = {
    ...clock,
    timeScale,
  };

  return deepFreeze(nextClock);
}

/**
 * Resets the clock during pre-execution preparation.
 * STRICT INVARIANT: Rewinding an already advanced clock (simTimeNs > 0, simTimeMs > 0, or tickCount > 0)
 * is strictly prohibited to preserve historical simulation integrity.
 */
export function resetSimulationClock(
  clock: SimulationClockState,
  options?: { preserveTimeScale?: boolean }
): SimulationClockState {
  if (!clock || typeof clock !== 'object') {
    throw new Error('Invalid clock state passed to resetSimulationClock');
  }

  // Prevent runtime reset from rewinding an already advanced clock
  if (clock.simTimeNs > 0 || clock.simTimeMs > 0 || clock.tickCount > 0) {
    throw new Error(
      `Cannot reset simulation clock for SimulationRun ${clock.runId}: Clock has already advanced (${clock.tickCount} ticks, ${clock.simTimeNs}ns / ${clock.simTimeMs}ms). Runtime rewinding is disallowed.`
    );
  }

  if (clock.phase !== 'idle') {
    throw new Error(
      `Cannot reset simulation clock for SimulationRun ${clock.runId}: Reset is only allowed during pre-execution preparation in idle phase.`
    );
  }

  const timeScale =
    options?.preserveTimeScale === false
      ? DEFAULT_SIMULATION_TIME_SCALE
      : clock.timeScale;

  const resetClock: SimulationClockState = {
    runId: clock.runId,
    runToken: clock.runToken,
    importGen: clock.importGen,
    simTimeNs: 0,
    simTimeMs: 0,
    fractionalCarryMs: 0,
    phase: 'idle',
    timeScale,
    tickCount: 0,
    lastStepRealMs: 0,
    lastSimDeltaMs: 0,
  };

  return deepFreeze(resetClock);
}
