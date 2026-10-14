import { describe, it, expect, vi } from 'vitest';
import {
  createSimulationClock,
  advanceSimulationClock,
  setSimulationClockPhase,
  setSimulationClockTimeScale,
  resetSimulationClock,
  isValidTimeScale,
  isValidClockPhase,
} from './simulationClock';
import {
  MIN_SIMULATION_TIME_SCALE,
  MAX_SIMULATION_TIME_SCALE,
  DEFAULT_SIMULATION_TIME_SCALE,
  MAX_SUPPORTED_SIM_TIME_NS,
  MIN_FRACTIONAL_RESOLUTION_MS,
  type SimulationClockState,
} from '../types/simulationClock';

describe('Checkpoint 2C.2: Simulation Clock Domain Foundation', () => {
  const baseParams = {
    runId: 'sim_run_test_01',
    runToken: 'token_abc_123',
    importGen: 1,
  };

  describe('1. Initialization & Invariants (B4 Contract)', () => {
    it('creates clock strictly starting at simTimeNs: 0, simTimeMs: 0, tickCount: 0, phase: idle, fractionalCarryMs: 0', () => {
      const clock = createSimulationClock(baseParams);
      expect(clock.runId).toBe('sim_run_test_01');
      expect(clock.runToken).toBe('token_abc_123');
      expect(clock.importGen).toBe(1);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.simTimeMs).toBe(0);
      expect(clock.fractionalCarryMs).toBe(0);
      expect(clock.phase).toBe('idle');
      expect(clock.timeScale).toBe(DEFAULT_SIMULATION_TIME_SCALE);
      expect(clock.tickCount).toBe(0);
      expect(clock.lastStepRealMs).toBe(0);
      expect(clock.lastSimDeltaMs).toBe(0);
    });

    it('respects optional custom initialTimeScale', () => {
      const clock = createSimulationClock({
        ...baseParams,
        initialTimeScale: 2.5,
      });
      expect(clock.timeScale).toBe(2.5);
      expect(clock.phase).toBe('idle'); // Must always be idle on creation
    });

    it('rejects invalid or missing runId and runToken', () => {
      expect(() => createSimulationClock({ ...baseParams, runId: '' })).toThrow(/runId/);
      expect(() => createSimulationClock({ ...baseParams, runId: '   ' })).toThrow(/runId/);
      expect(() => createSimulationClock({ ...baseParams, runToken: '' })).toThrow(/runToken/);
    });

    it('rejects invalid importGen', () => {
      expect(() => createSimulationClock({ ...baseParams, importGen: -1 })).toThrow(/importGen/);
      expect(() => createSimulationClock({ ...baseParams, importGen: 1.5 })).toThrow(/importGen/);
      expect(() => createSimulationClock({ ...baseParams, importGen: NaN })).toThrow(/importGen/);
    });

    it('returns an immutable frozen object', () => {
      const clock = createSimulationClock(baseParams);
      expect(Object.isFrozen(clock)).toBe(true);
      expect(() => {
        (clock as any).simTimeMs = 500;
      }).toThrow();
    });
  });

  describe('2. Deterministic Advancement & Fractional Carry Accumulation (B2 Contract)', () => {
    it('requires advancing phase to advance; rejects stepping while idle (B4 negative reproduction)', () => {
      const clock = createSimulationClock(baseParams);
      expect(clock.phase).toBe('idle');
      expect(() => advanceSimulationClock(clock, 100)).toThrow(
        /Clock is in idle phase \(must call startSimulationClock before stepping\)/
      );
    });

    it('advances simTimeMs deterministically by elapsedRealMs * timeScale when advancing', () => {
      let clock = createSimulationClock(baseParams);
      clock = setSimulationClockPhase(clock, 'advancing');

      const step1 = advanceSimulationClock(clock, 100); // 1.0x -> 100ms
      expect(step1.simTimeMs).toBe(100);
      expect(step1.tickCount).toBe(1);
      expect(step1.lastStepRealMs).toBe(100);
      expect(step1.lastSimDeltaMs).toBe(100);
      expect(step1.phase).toBe('advancing');

      // Original clock was untouched
      expect(clock.simTimeMs).toBe(0);
      expect(clock.tickCount).toBe(0);

      const step2 = advanceSimulationClock(step1, 250);
      expect(step2.simTimeMs).toBe(350);
      expect(step2.tickCount).toBe(2);
      expect(step2.lastStepRealMs).toBe(250);
      expect(step2.lastSimDeltaMs).toBe(250);
    });

    it('correctly scales advancement at 0.25x, 2x, 4x, 16x', () => {
      const cQuarter = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 0.25 }),
        'advancing'
      );
      const sQuarter = advanceSimulationClock(cQuarter, 100);
      expect(sQuarter.simTimeMs).toBe(25);
      expect(sQuarter.lastSimDeltaMs).toBe(25);

      const cDouble = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 2.0 }),
        'advancing'
      );
      const sDouble = advanceSimulationClock(cDouble, 100);
      expect(sDouble.simTimeMs).toBe(200);
      expect(sDouble.lastSimDeltaMs).toBe(200);

      const cMax = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 16.0 }),
        'advancing'
      );
      const sMax = advanceSimulationClock(cMax, 50);
      expect(sMax.simTimeMs).toBe(800);
      expect(sMax.lastSimDeltaMs).toBe(800);
    });

    it('handles 0ms elapsedRealMs gracefully (tickCount increments, simDeltaMs is 0)', () => {
      let clock = createSimulationClock(baseParams);
      clock = setSimulationClockPhase(clock, 'advancing');
      const step = advanceSimulationClock(clock, 0);
      expect(step.simTimeMs).toBe(0);
      expect(step.tickCount).toBe(1);
      expect(step.lastStepRealMs).toBe(0);
      expect(step.lastSimDeltaMs).toBe(0);
    });

    it('B2: preserves sub-nanosecond fractional carry across repeated small steps without precision loss', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // Step with 0.0000004 ms (0.4 nanoseconds = 400 picoseconds)
      // Step 1: total = 400 ps, delta = 0 ns, carry = 400 ps (0.0000004 ms)
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeMs).toBe(0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Step 2: total = 800 ps, delta = 0 ns, carry = 800 ps (0.0000008 ms)
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeMs).toBe(0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000008, 9);

      // Step 3: total = 1200 ps -> delta = 1 ns (0.000001 ms), carry = 200 ps (0.0000002 ms)
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeMs).toBe(0.000001);
      expect(clock.lastSimDeltaMs).toBe(0.000001);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000002, 9);

      // Step 4: total = 600 ps -> delta = 0 ns, carry = 600 ps (0.0000006 ms)
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeMs).toBe(0.000001);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000006, 9);

      // Step 5: total = 1000 ps -> delta = 1 ns (0.000001 ms), carry = 0 ps
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeMs).toBe(0.000002);
      expect(clock.fractionalCarryMs).toBe(0);

      // Total 5 steps of 0.4 ns equals exactly 2 ns (0.000002 ms) with 0 lost!
    });

    it('B2: accumulates 1,000 sub-precision steps deterministically without zero-rounding erosion', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // 1,000 steps of 0.0000004 ms (0.4 nanoseconds)
      // Expected total: 1000 * 0.0000004 = 0.0004 ms (400 nanoseconds)
      for (let i = 0; i < 1000; i++) {
        clock = advanceSimulationClock(clock, 0.0000004);
      }
      expect(clock.simTimeMs).toBe(0.0004);
      expect(clock.fractionalCarryMs).toBe(0);
      expect(clock.tickCount).toBe(1000);
    });

    it('B2: preserves carry across mixed non-trivial time scales', () => {
      // Scale 0.75x with 0.4 nanosecond steps (0.0000004 ms * 0.75 = 0.3 ns = 300 ps per step)
      let clock = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 0.75 }),
        'advancing'
      );

      // 10 steps of 0.4 ns at 0.75x: total simulated time = 10 * 0.3 ns = 3 ns (0.000003 ms) exactly
      for (let i = 0; i < 10; i++) {
        clock = advanceSimulationClock(clock, 0.0000004);
      }
      expect(clock.simTimeMs).toBe(0.000003);
      expect(clock.fractionalCarryMs).toBe(0);

      // Scale 0.3333333333333333 (1/3)
      let clockThird = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 1.0 / 3.0 }),
        'advancing'
      );
      clockThird = advanceSimulationClock(clockThird, 1.0);
      clockThird = advanceSimulationClock(clockThird, 1.0);
      clockThird = advanceSimulationClock(clockThird, 1.0);
      expect(clockThird.simTimeMs).toBeCloseTo(1.0, 5);
    });

    it('prevents IEEE-754 drift over repeated fractional steps', () => {
      let clock = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 1.0 }),
        'advancing'
      );
      // 100 steps of 0.1ms should equal exactly 10.0ms, not 9.99999999999998
      for (let i = 0; i < 100; i++) {
        clock = advanceSimulationClock(clock, 0.1);
      }
      expect(clock.simTimeMs).toBe(10);
      expect(clock.tickCount).toBe(100);
    });

    it('guarantees strict monotonicity for non-negative inputs', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      let prevSimTime = clock.simTimeMs;
      const steps = [10, 0, 5.5, 0.25, 100, 0.000001, 1000];
      for (const step of steps) {
        clock = advanceSimulationClock(clock, step);
        expect(clock.simTimeMs).toBeGreaterThanOrEqual(prevSimTime);
        prevSimTime = clock.simTimeMs;
      }
    });
  });

  describe('3. Numerical Boundaries & Validation', () => {
    it('validates timeScale within [0.25, 16.0]', () => {
      expect(isValidTimeScale(MIN_SIMULATION_TIME_SCALE)).toBe(true);
      expect(isValidTimeScale(MAX_SIMULATION_TIME_SCALE)).toBe(true);
      expect(isValidTimeScale(1.0)).toBe(true);
      expect(isValidTimeScale(8.5)).toBe(true);

      // Boundaries
      expect(isValidTimeScale(0.2499)).toBe(false);
      expect(isValidTimeScale(16.0001)).toBe(false);
      expect(isValidTimeScale(0)).toBe(false);
      expect(isValidTimeScale(-1)).toBe(false);
      expect(isValidTimeScale(NaN)).toBe(false);
      expect(isValidTimeScale(Infinity)).toBe(false);
      expect(isValidTimeScale(-Infinity)).toBe(false);
      expect(isValidTimeScale('2.0')).toBe(false);
      expect(isValidTimeScale(null)).toBe(false);
    });

    it('throws when setting out-of-bounds timeScale', () => {
      const clock = createSimulationClock(baseParams);
      expect(() => setSimulationClockTimeScale(clock, 0.2)).toThrow(/out of bounds/);
      expect(() => setSimulationClockTimeScale(clock, 16.5)).toThrow(/out of bounds/);
      expect(() => setSimulationClockTimeScale(clock, NaN)).toThrow(/finite number/);
      expect(() => setSimulationClockTimeScale(clock, Infinity)).toThrow(/finite number/);
    });

    it('rejects invalid elapsedRealMs in advanceSimulationClock', () => {
      const clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      expect(() => advanceSimulationClock(clock, -1)).toThrow(/cannot be negative/);
      expect(() => advanceSimulationClock(clock, -0.0001)).toThrow(/cannot be negative/);
      expect(() => advanceSimulationClock(clock, NaN)).toThrow(/finite number/);
      expect(() => advanceSimulationClock(clock, Infinity)).toThrow(/finite number/);
      expect(() => advanceSimulationClock(clock, '100' as any)).toThrow(/finite number/);
    });

    it('protects against integer overflow exceeding MAX_SAFE_INTEGER', () => {
      const clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: Number.MAX_SAFE_INTEGER - 10,
        simTimeMs: (Number.MAX_SAFE_INTEGER - 10) / 1e6,
      };
      expect(() => advanceSimulationClock(clock, 20)).toThrow(RangeError);
    });

    it('B2: reproduces and explicitly rejects large simTimeNs overflow at 10^10 ms (preventing 2ns phantom generation)', () => {
      const clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: 1e16, // 10^10 ms = 10^16 ns > MAX_SUPPORTED_SIM_TIME_NS
        simTimeMs: 1e10,
      };
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(
        /Simulation clock time overflow: current simTimeNs 10000000000000000ns/
      );
    });

    it('B2: reproduces and explicitly rejects large simTimeNs at 10^12 ms (preventing silent loss of 1ns step)', () => {
      const clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: 1e18, // 10^12 ms = 10^18 ns > MAX_SUPPORTED_SIM_TIME_NS
        simTimeMs: 1e12,
      };
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(
        /Simulation clock time overflow: current simTimeNs 1000000000000000000ns/
      );
    });

    it('B2.1: at 8_999_999_999 ms, consecutive 1 ns steps advance authoritative simTimeNs by exactly 1 ns each time, never 0 or 2 ns', () => {
      let clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: 8_999_999_999_000_000, // 8,999,999,999 ms in exact integer nanoseconds
        simTimeMs: 8_999_999_999,
      };

      for (let i = 1; i <= 10; i++) {
        const prevNs = clock.simTimeNs;
        clock = advanceSimulationClock(clock, 0.000001); // 1 nanosecond (0.000001 ms)
        expect(clock.simTimeNs).toBe(prevNs + 1);
        expect(clock.lastSimDeltaMs).toBe(0.000001);
      }
      expect(clock.simTimeNs).toBe(8_999_999_999_000_010);
      expect(clock.tickCount).toBe(10);
    });

    it('B2.1: preserves integer-nanosecond identity across 10,000 discrete 1 ns steps near the horizon', () => {
      let clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: 8_999_999_990_000_000,
        simTimeMs: 8_999_999_990,
      };

      const startNs = clock.simTimeNs;
      for (let i = 0; i < 10000; i++) {
        clock = advanceSimulationClock(clock, 0.000001);
      }
      expect(clock.simTimeNs).toBe(startNs + 10000);
      expect(clock.tickCount).toBe(10000);
      expect(clock.fractionalCarryMs).toBe(0);
    });

    it('B2.1: preserves fractional picosecond carry across discrete steps and scale changes', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // Step with 0.4 ns (0.0000004 ms = 400 ps carry)
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Change scale to 2x: fractional carry must be preserved!
      clock = setSimulationClockTimeScale(clock, 2.0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Step with 0.4 ns at 2x: 0.4 * 2 = 0.8 ns = 800 ps. Total = 800 + 400 = 1200 ps -> 1 ns + 200 ps carry
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeNs).toBe(1);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000002, 9);
    });

    it('B2.2: rejects Number.MAX_VALUE with scale 16 and throws RangeError without NaN or Infinity', () => {
      const clock = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 16.0 }),
        'advancing'
      );

      expect(() => advanceSimulationClock(clock, Number.MAX_VALUE)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, Number.MAX_VALUE)).toThrow(
        /Simulation clock advancement delta overflow/
      );

      expect(Number.isFinite(clock.simTimeNs)).toBe(true);
      expect(Number.isFinite(clock.simTimeMs)).toBe(true);
      expect(Number.isFinite(clock.fractionalCarryMs)).toBe(true);
      expect(Number.isNaN(clock.simTimeNs)).toBe(false);
      expect(Number.isNaN(clock.simTimeMs)).toBe(false);
    });

    it('B2.2: rejects advancement when fractional carry would place effective time beyond supported horizon', () => {
      let clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: MAX_SUPPORTED_SIM_TIME_NS - 1, // 1 ns below maximum
        simTimeMs: (MAX_SUPPORTED_SIM_TIME_NS - 1) / 1e6,
        fractionalCarryMs: 0,
      };

      // Exactly 1 ns with 0 carry lands exactly at MAX_SUPPORTED_SIM_TIME_NS: SUCCEEDS
      const landed = advanceSimulationClock(clock, 0.000001);
      expect(landed.simTimeNs).toBe(MAX_SUPPORTED_SIM_TIME_NS);
      expect(landed.fractionalCarryMs).toBe(0);

      // Attempting to advance 1.0000005 ms (1 ns + 0.5 ns carry) from (MAX_SUPPORTED_SIM_TIME_NS - 1):
      // Effective time would be MAX_SUPPORTED_SIM_TIME_NS + 500 ps > MAX_SUPPORTED_SIM_TIME_NS!
      // Must THROW RangeError!
      expect(() => advanceSimulationClock(clock, 0.0000015)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 0.0000015)).toThrow(
        /exceeds the maximum supported horizon/
      );
    });

    it('B2.3: exact negative reproduction — rejects 9e9 ms step when 400ps carry places effective time beyond horizon without mutating input', () => {
      // 1. Create clock; phase advancing; time scale 1.
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      expect(clock.simTimeNs).toBe(0);
      expect(clock.timeScale).toBe(1.0);

      // 2. advanceSimulationClock(clock, 0.0000004) gives simTimeNs=0, carry=400ps.
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Snapshot prior clock state
      const clockBefore = { ...clock };

      // 3. advanceSimulationClock(clock, 9_000_000_000) MUST throw RangeError:
      // effective time exceeds the 9e9 ms horizon by 400ps.
      expect(() => advanceSimulationClock(clock, 9_000_000_000)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 9_000_000_000)).toThrow(
        /exceeds the maximum supported horizon/
      );

      // Verify input clock was not changed/mutated
      expect(clock.simTimeNs).toBe(clockBefore.simTimeNs);
      expect(clock.fractionalCarryMs).toBe(clockBefore.fractionalCarryMs);
      expect(clock.tickCount).toBe(clockBefore.tickCount);
    });

    it('B2.3: a large in-horizon advancement preserves existing 400ps carry without floating-point truncation', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // Set 400 ps carry
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Large in-horizon step: 5,000,000,000 ms (5e9 ms = ~58 days)
      const stepped = advanceSimulationClock(clock, 5_000_000_000);
      expect(stepped.simTimeNs).toBe(5_000_000_000_000_000);
      expect(stepped.simTimeMs).toBe(5_000_000_000);
      // Existing 400 ps carry is 100% preserved!
      expect(stepped.fractionalCarryMs).toBeCloseTo(0.0000004, 9);
      expect(stepped.tickCount).toBe(2);
    });

    it('B2.3: fractional carry survives changes in time scale and subsequent advancement', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // Set 400 ps carry
      clock = advanceSimulationClock(clock, 0.0000004);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Change time scale from 1.0x to 4.0x
      clock = setSimulationClockTimeScale(clock, 4.0);
      expect(clock.timeScale).toBe(4.0);
      expect(clock.fractionalCarryMs).toBeCloseTo(0.0000004, 9);

      // Step with 0.15 ns (0.00000015 ms) at 4x:
      // rawDelta = 0.15 * 4 = 0.6 ns = 600 ps.
      // Total = 600 ps + 400 ps prior carry = 1000 ps = 1 ns with 0 carry!
      clock = advanceSimulationClock(clock, 0.00000015);
      expect(clock.simTimeNs).toBe(1);
      expect(clock.fractionalCarryMs).toBe(0);
    });

    it('B2.2: handles inputs smaller than picosecond resolution (rounds to nearest picosecond, no claim of unlimited precision)', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      // Step with 0.1 picoseconds (1e-10 ms): rounds to 0 ps
      clock = advanceSimulationClock(clock, 1e-10);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.fractionalCarryMs).toBe(0);

      // Step with 0.6 picoseconds (6e-10 ms): rounds to 1 ps (1e-9 ms = MIN_FRACTIONAL_RESOLUTION_MS)
      clock = advanceSimulationClock(clock, 6e-10);
      expect(clock.simTimeNs).toBe(0);
      expect(clock.fractionalCarryMs).toBe(MIN_FRACTIONAL_RESOLUTION_MS);
    });

    it('B2.2: verifies no valid clock operation ever produces NaN or Infinity', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      clock = advanceSimulationClock(clock, 123.456);
      clock = setSimulationClockTimeScale(clock, 3.5);
      clock = advanceSimulationClock(clock, 0.000789);

      for (const [key, val] of Object.entries(clock)) {
        if (typeof val === 'number') {
          expect(Number.isFinite(val), `Property ${key} must be finite`).toBe(true);
          expect(Number.isNaN(val), `Property ${key} must not be NaN`).toBe(false);
        }
      }
    });

    it('B2: advances exactly at minimum representable advancement resolution (1 nanosecond = 0.000001 ms)', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      clock = advanceSimulationClock(clock, 0.000001); // 1 nanosecond
      expect(clock.simTimeNs).toBe(1);
      expect(clock.simTimeMs).toBe(0.000001);
      expect(clock.lastSimDeltaMs).toBe(0.000001);
      expect(clock.fractionalCarryMs).toBe(0);

      clock = advanceSimulationClock(clock, 0.000001);
      expect(clock.simTimeNs).toBe(2);
      expect(clock.simTimeMs).toBe(0.000002);
      expect(clock.lastSimDeltaMs).toBe(0.000001);
    });

    it('B2: maintains exact precision and strict monotonicity near the maximum supported horizon (9e9 ms)', () => {
      let clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: MAX_SUPPORTED_SIM_TIME_NS - 1_000_000, // 1 ms below 9,000,000,000 ms
        simTimeMs: 8_999_999_999,
      };

      // Step 0.5 ms -> 500,000 ns
      clock = advanceSimulationClock(clock, 0.5);
      expect(clock.simTimeNs).toBe(MAX_SUPPORTED_SIM_TIME_NS - 500_000);
      expect(clock.simTimeMs).toBe(8_999_999_999.5);

      // Step 0.5 ms -> reaches exactly 9_000_000_000 ms (MAX_SUPPORTED_SIM_TIME_MS)
      clock = advanceSimulationClock(clock, 0.5);
      expect(clock.simTimeNs).toBe(MAX_SUPPORTED_SIM_TIME_NS);
      expect(clock.simTimeMs).toBe(9_000_000_000);

      // Attempting to advance further when at maximum horizon throws RangeError
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 0.000001)).toThrow(
        /is at or exceeds the maximum supported horizon/
      );
    });

    it('B2: rejects advancing when step delta would cross the maximum supported horizon', () => {
      const clock: SimulationClockState = {
        ...createSimulationClock(baseParams),
        phase: 'advancing',
        simTimeNs: MAX_SUPPORTED_SIM_TIME_NS - 1_000_000, // 1 ms below max
        simTimeMs: 8_999_999_999,
      };

      // Advancing by 2 ms would reach 9_000_000_001 ms > 9e9 ms
      expect(() => advanceSimulationClock(clock, 2.0)).toThrow(RangeError);
      expect(() => advanceSimulationClock(clock, 2.0)).toThrow(
        /exceeds the maximum supported horizon/
      );
    });

    it('B2: validates timeScale changes near maximum supported horizon', () => {
      let clock: SimulationClockState = {
        ...createSimulationClock({ ...baseParams, initialTimeScale: 16.0 }),
        phase: 'advancing',
        simTimeNs: MAX_SUPPORTED_SIM_TIME_NS - 100_000_000, // 100 ms below max
        simTimeMs: 8_999_999_900,
      };

      // Step 5 ms at 16x -> simDelta 80 ms -> simTimeNs advances by 80_000_000 ns
      clock = advanceSimulationClock(clock, 5.0);
      expect(clock.simTimeNs).toBe(MAX_SUPPORTED_SIM_TIME_NS - 20_000_000);
      expect(clock.simTimeMs).toBe(8_999_999_980);

      // Step 2 ms at 16x -> simDelta 32 ms -> would reach 9_000_000_012 ms > 9e9 ms -> throws RangeError
      expect(() => advanceSimulationClock(clock, 2.0)).toThrow(RangeError);
    });
  });

  describe('4. Phase Transitions & Paused Invariant (B3 Contract)', () => {
    it('B3: strictly rejects advancement when clock is paused; no bypass allowed', () => {
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      clock = advanceSimulationClock(clock, 50); // simTimeMs = 50
      clock = setSimulationClockPhase(clock, 'paused');
      expect(clock.phase).toBe('paused');

      expect(() => advanceSimulationClock(clock, 50)).toThrow(/Clock is paused/);
      // simTimeMs remains unchanged
      expect(clock.simTimeMs).toBe(50);
    });

    it('transitions phase between idle, advancing, and paused', () => {
      let clock = createSimulationClock(baseParams);
      expect(clock.phase).toBe('idle');

      clock = setSimulationClockPhase(clock, 'advancing');
      expect(clock.phase).toBe('advancing');

      clock = setSimulationClockPhase(clock, 'paused');
      expect(clock.phase).toBe('paused');

      clock = setSimulationClockPhase(clock, 'idle');
      expect(clock.phase).toBe('idle');
    });

    it('validates phase strings and rejects invalid values', () => {
      expect(isValidClockPhase('idle')).toBe(true);
      expect(isValidClockPhase('advancing')).toBe(true);
      expect(isValidClockPhase('paused')).toBe(true);
      expect(isValidClockPhase('stopped')).toBe(false);
      expect(isValidClockPhase('running')).toBe(false); // execution status, not clock phase!

      const clock = createSimulationClock(baseParams);
      expect(() => setSimulationClockPhase(clock, 'running' as any)).toThrow(/Invalid simulation clock phase/);
    });

    it('returns the same object when setting the existing phase or scale', () => {
      const clock = createSimulationClock(baseParams);
      const samePhase = setSimulationClockPhase(clock, 'idle');
      expect(samePhase).toBe(clock);

      const sameScale = setSimulationClockTimeScale(clock, 1.0);
      expect(sameScale).toBe(clock);
    });
  });

  describe('5. Reset Clock Semantics (B4 Contract)', () => {
    it('B4: strictly forbids resetting/rewinding an already advanced clock (simTimeMs > 0)', () => {
      let clock = setSimulationClockPhase(
        createSimulationClock({ ...baseParams, initialTimeScale: 2.0 }),
        'advancing'
      );
      clock = advanceSimulationClock(clock, 100);
      expect(clock.simTimeMs).toBe(200);

      expect(() => resetSimulationClock(clock)).toThrow(
        /Cannot reset simulation clock.*Clock has already advanced/
      );
    });

    it('B4: strictly forbids resetting a clock that is not in idle phase', () => {
      const clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      expect(() => resetSimulationClock(clock)).toThrow(
        /Reset is only allowed during pre-execution preparation in idle phase/
      );
    });

    it('allows pre-execution reset of an idle, un-advanced clock', () => {
      const clock = createSimulationClock({ ...baseParams, initialTimeScale: 4.0 });
      expect(clock.phase).toBe('idle');
      expect(clock.simTimeMs).toBe(0);

      const reset = resetSimulationClock(clock, { preserveTimeScale: false });
      expect(reset.simTimeMs).toBe(0);
      expect(reset.timeScale).toBe(DEFAULT_SIMULATION_TIME_SCALE);
      expect(reset.phase).toBe('idle');
    });
  });

  describe('6. Purity & No Browser Timer Dependency', () => {
    it('does not call Date.now() or performance.now() during clock advancement', () => {
      const dateSpy = vi.spyOn(Date, 'now');
      let clock = setSimulationClockPhase(createSimulationClock(baseParams), 'advancing');
      advanceSimulationClock(clock, 100);
      advanceSimulationClock(clock, 200);
      expect(dateSpy).not.toHaveBeenCalled();
      dateSpy.mockRestore();
    });
  });
});
