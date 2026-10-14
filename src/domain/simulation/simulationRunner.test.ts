import { describe, it, expect } from 'vitest';
import { executeSimulationStep } from './simulationRunner';
import {
  createSimulationClock,
  setSimulationClockPhase,
} from './simulationClock';
import { createSimulationTimeline } from './simulationTimeline';

describe('Checkpoint 2C.4 — Pure Domain Simulation Runner MVP', () => {
  const RUN_ID = 'run_runner_01';
  const RUN_TOKEN = 'tok_runner_abc';
  const IMPORT_GEN = 1;

  const createActiveSetup = () => {
    let clock = createSimulationClock({
      runId: RUN_ID,
      runToken: RUN_TOKEN,
      importGen: IMPORT_GEN,
      initialTimeScale: 1.0,
    });
    clock = setSimulationClockPhase(clock, 'advancing');
    const timeline = createSimulationTimeline(RUN_ID, RUN_TOKEN, IMPORT_GEN);
    return { clock, timeline };
  };

  describe('1. Valid Step Execution & Event Assignment', () => {
    it('advances clock with omitted/empty events and records zero artificial events', () => {
      const { clock, timeline } = createActiveSetup();

      const { nextClock, nextTimeline, recordedEvents } = executeSimulationStep(
        clock,
        timeline,
        { elapsedRealMs: 500 }
      );

      expect(nextClock.simTimeNs).toBe(500_000_000);
      expect(nextClock.simTimeMs).toBe(500);
      expect(nextClock.tickCount).toBe(1);
      expect(nextTimeline.events.length).toBe(0);
      expect(recordedEvents).toEqual([]);
      expect(Object.isFrozen(nextClock)).toBe(true);
      expect(Object.isFrozen(nextTimeline)).toBe(true);
    });

    it('records multiple valid events at the resulting post-advancement timestamp', () => {
      const { clock, timeline } = createActiveSetup();

      const { nextClock, nextTimeline, recordedEvents } = executeSimulationStep(
        clock,
        timeline,
        {
          elapsedRealMs: 250,
          events: [
            { eventType: 'SCAN_START', payload: { sector: 'N' } },
            { eventType: 'TARGET_DETECTED', payload: { id: 'T1' } },
            { eventType: 'TRACK_CONFIRMED', payload: { id: 'T1', confidence: 0.95 } },
          ],
        }
      );

      expect(nextClock.simTimeNs).toBe(250_000_000);
      expect(recordedEvents.length).toBe(3);
      expect(nextTimeline.events.length).toBe(3);

      // All events must share the post-advancement timestamp
      for (const evt of recordedEvents) {
        expect(evt.simTimeNs).toBe(250_000_000);
        expect(evt.runId).toBe(RUN_ID);
        expect(evt.runToken).toBe(RUN_TOKEN);
      }

      // Sequence numbers must be assigned monotonically and preserve array order
      expect(recordedEvents[0].sequence).toBe(0);
      expect(recordedEvents[0].eventType).toBe('SCAN_START');

      expect(recordedEvents[1].sequence).toBe(1);
      expect(recordedEvents[1].eventType).toBe('TARGET_DETECTED');

      expect(recordedEvents[2].sequence).toBe(2);
      expect(recordedEvents[2].eventType).toBe('TRACK_CONFIRMED');
    });

    it('chains consecutive steps with continuous sequence and monotonic time', () => {
      const { clock: c0, timeline: t0 } = createActiveSetup();

      // Step 1: 100 ms with 2 events
      const step1 = executeSimulationStep(c0, t0, {
        elapsedRealMs: 100,
        events: [{ eventType: 'E0' }, { eventType: 'E1' }],
      });

      expect(step1.nextClock.simTimeNs).toBe(100_000_000);
      expect(step1.nextTimeline.events.length).toBe(2);

      // Step 2: 200 ms with 1 event
      const step2 = executeSimulationStep(step1.nextClock, step1.nextTimeline, {
        elapsedRealMs: 200,
        events: [{ eventType: 'E2' }],
      });

      expect(step2.nextClock.simTimeNs).toBe(300_000_000);
      expect(step2.nextTimeline.events.length).toBe(3);
      expect(step2.recordedEvents[0].sequence).toBe(2);
      expect(step2.recordedEvents[0].simTimeNs).toBe(300_000_000);
    });

    it('guarantees deterministic replay across identical initial states and inputs', () => {
      const setupA = createActiveSetup();
      const setupB = createActiveSetup();

      const inputs = {
        elapsedRealMs: 150,
        events: [
          { eventType: 'ACTION_A', payload: { key: 1 } },
          { eventType: 'ACTION_B', payload: { key: 2 } },
        ],
      };

      const resultA = executeSimulationStep(setupA.clock, setupA.timeline, inputs);
      const resultB = executeSimulationStep(setupB.clock, setupB.timeline, inputs);

      expect(resultA.nextClock).toEqual(resultB.nextClock);
      expect(resultA.nextTimeline).toEqual(resultB.nextTimeline);
      expect(resultA.recordedEvents).toEqual(resultB.recordedEvents);
    });
  });

  describe('2. Incarnation Coherence & Error Rollback', () => {
    it('rejects step if clock and timeline incarnations do not match', () => {
      const { clock } = createActiveSetup();
      const mismatchedTimeline = createSimulationTimeline('different_run', RUN_TOKEN, IMPORT_GEN);

      expect(() =>
        executeSimulationStep(clock, mismatchedTimeline, { elapsedRealMs: 100 })
      ).toThrow(/Clock and Timeline incarnation mismatch/);
    });

    it('rejects step if clock is paused without changing timeline', () => {
      let { clock, timeline } = createActiveSetup();
      clock = setSimulationClockPhase(clock, 'paused');

      expect(() =>
        executeSimulationStep(clock, timeline, { elapsedRealMs: 100 })
      ).toThrow(/Clock is paused/);

      // Timeline remains completely unmodified
      expect(timeline.events.length).toBe(0);
    });

    it('rejects step if clock is in idle phase without changing timeline', () => {
      const clock = createSimulationClock({
        runId: RUN_ID,
        runToken: RUN_TOKEN,
        importGen: IMPORT_GEN,
      }); // Default phase is idle
      const timeline = createSimulationTimeline(RUN_ID, RUN_TOKEN, IMPORT_GEN);

      expect(() =>
        executeSimulationStep(clock, timeline, { elapsedRealMs: 100 })
      ).toThrow(/Clock is in idle phase/);

      expect(timeline.events.length).toBe(0);
    });

    it('aborts entirely if any event in a batch is invalid (P1/P2/validation rules)', () => {
      const { clock, timeline } = createActiveSetup();

      const cyclicObj: any = { name: 'cycle' };
      cyclicObj.self = cyclicObj;

      // Event 3 has a cyclic structure
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: [
            { eventType: 'VALID_1' },
            { eventType: 'VALID_2' },
            { eventType: 'INVALID_CYCLIC', payload: cyclicObj },
          ],
        })
      ).toThrow(/cyclic/i);

      // Original clock and timeline remain unmutated
      expect(clock.simTimeNs).toBe(0);
      expect(timeline.events.length).toBe(0);
    });

    it('aborts entirely if an event contains accessor properties', () => {
      const { clock, timeline } = createActiveSetup();
      const payloadWithGetter = {
        get evil() {
          return 'hacked';
        },
      };

      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: [{ eventType: 'BAD_GETTER', payload: payloadWithGetter }],
        })
      ).toThrow(/accessor properties/);

      expect(clock.simTimeNs).toBe(0);
      expect(timeline.events.length).toBe(0);
    });

    it('rejects malformed non-array events values including empty non-arrays', () => {
      const { clock, timeline } = createActiveSetup();

      // Empty object {}
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: {} as any,
        })
      ).toThrow(/input.events must be an array when provided/);

      // Object pretending to have length 0
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: { length: 0 } as any,
        })
      ).toThrow(/input.events must be an array when provided/);

      // Non-array string
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: 'not-an-array' as any,
        })
      ).toThrow(/input.events must be an array when provided/);

      // Null
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: null as any,
        })
      ).toThrow(/input.events must be an array when provided/);

      // Number
      expect(() =>
        executeSimulationStep(clock, timeline, {
          elapsedRealMs: 100,
          events: 42 as any,
        })
      ).toThrow(/input.events must be an array when provided/);

      // Original clock and timeline remain unmutated
      expect(clock.simTimeNs).toBe(0);
      expect(timeline.events.length).toBe(0);
    });
  });
});
