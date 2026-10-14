/**
 * @fileoverview Defines domain types and invariants for the Simulation Clock Foundation.
 * Part of the Canonical Domain Model (session-only runtime state).
 */

export const MIN_SIMULATION_TIME_SCALE = 0.25;
export const MAX_SIMULATION_TIME_SCALE = 16.0;
export const DEFAULT_SIMULATION_TIME_SCALE = 1.0;

/**
 * Minimum representable discrete advancement resolution in milliseconds:
 * 1 nanosecond (10^-6 ms = 10^-9 s).
 * Discrete advancements are quantized to integer nanoseconds.
 */
export const MIN_SIMULATION_RESOLUTION_MS = 0.000001; // 1 nanosecond

/**
 * Minimum fractional carry resolution in milliseconds:
 * 1 picosecond (10^-9 ms = 10^-12 s).
 * Sub-nanosecond fractional steps accumulate into fractionalCarryMs at picosecond resolution.
 * Inputs smaller than 1 picosecond round to the nearest integer picosecond.
 * Unlimited precision is explicitly not claimed.
 */
export const MIN_FRACTIONAL_RESOLUTION_MS = 0.000000001; // 1 picosecond

/**
 * Maximum supported simulation time horizon in milliseconds:
 * 9,000,000,000 ms = 9,000,000 seconds = 2,500 hours = 104.16 days.
 */
export const MAX_SUPPORTED_SIM_TIME_MS = 9_000_000_000; // 9e9 ms (104.16 days)

/**
 * Maximum supported simulation time horizon in integer nanoseconds:
 * 9,000,000,000,000,000 ns (9e15 ns).
 *
 * In IEEE-754 double precision (53-bit mantissa, MAX_SAFE_INTEGER = 9,007,199,254,740,991):
 * All integers in [0, 9e15] are exact safe integers (Number.isSafeInteger === true).
 * The canonical accumulator `simTimeNs` stores time directly in integer nanoseconds,
 * guaranteeing exact single-nanosecond increment identity across the entire horizon.
 */
export const MAX_SUPPORTED_SIM_TIME_NS = 9_000_000_000_000_000; // 9e15 ns

export type SimulationClockPhase = 'idle' | 'advancing' | 'paused';

/**
 * Immutable domain representation of a session-only Simulation Clock
 * bound strictly to a single SimulationRun execution incarnation.
 */
export interface SimulationClockState {
  readonly runId: string;
  readonly runToken: string;
  readonly importGen: number;
  /**
   * Authoritative canonical integer-nanosecond time accumulator.
   * Stored as a non-negative safe integer in [0, MAX_SUPPORTED_SIM_TIME_NS].
   * All advancement, horizon checking, and monotonicity calculations operate
   * directly on this value to preserve nanosecond identity.
   */
  readonly simTimeNs: number;
  /**
   * Derived read projection in milliseconds (simTimeNs / 1e6) provided for compatibility.
   * NOTE: In IEEE-754 double precision, at magnitudes near the 9e9 ms horizon (where the
   * mantissa spacing is larger than 1 ns in ms units), floating-point milliseconds
   * may not uniquely represent every individual nanosecond. The canonical authoritative
   * time source is simTimeNs.
   */
  readonly simTimeMs: number;
  /**
   * Sub-nanosecond fractional carry in milliseconds (stored with picosecond resolution: 10^-9 ms = 1 ps),
   * preserved across discrete ticks and scale changes to prevent sub-precision erosion.
   */
  readonly fractionalCarryMs: number;
  readonly phase: SimulationClockPhase;
  readonly timeScale: number;
  readonly tickCount: number;
  readonly lastStepRealMs: number;
  readonly lastSimDeltaMs: number;
}

export interface CreateSimulationClockParams {
  runId: string;
  runToken: string;
  importGen?: number;
  initialTimeScale?: number;
}
