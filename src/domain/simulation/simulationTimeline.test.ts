import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSimulationEventId,
  createSimulationTimeline,
  appendSimulationTimelineEvent,
  querySimulationEvents,
  cloneEventPayload,
} from './simulationTimeline';
import { MAX_SUPPORTED_SIM_TIME_NS } from '../types/simulationClock';

describe('Checkpoint 2C.3 — Pure Domain Simulation Event Timeline', () => {
  const DEFAULT_RUN_ID = 'run_test_01';
  const DEFAULT_RUN_TOKEN = 'token_abc_123';
  const DEFAULT_IMPORT_GEN = 2;

  describe('1. Deterministic Event Identity & Collision Resistance', () => {
    it('generates deterministic event IDs derived strictly from identity components', () => {
      const id1 = generateSimulationEventId('run_A', 'tok_1', 0, 0);
      const id2 = generateSimulationEventId('run_A', 'tok_1', 0, 0);
      expect(id1).toBe(id2);
      expect(id1).toBe('evt:run_A:tok_1:0:0');
    });

    it('prevents delimiter-collision ambiguity when identifiers contain colons', () => {
      // Delimiter collision case: runId with colon vs runToken with colon
      const idA = generateSimulationEventId('run:1', 'tok', 0, 0);
      const idB = generateSimulationEventId('run', '1:tok', 0, 0);
      expect(idA).not.toBe(idB);
      expect(idA).toBe('evt:run%3A1:tok:0:0');
      expect(idB).toBe('evt:run:1%3Atok:0:0');
    });

    it('rejects invalid, negative, or non-safe-integer arguments for event ID generation', () => {
      expect(() => generateSimulationEventId('', 'tok', 0, 0)).toThrow(TypeError);
      expect(() => generateSimulationEventId('run', '', 0, 0)).toThrow(TypeError);
      expect(() => generateSimulationEventId('run', 'tok', -1, 0)).toThrow(RangeError);
      expect(() => generateSimulationEventId('run', 'tok', 0, -1)).toThrow(RangeError);
      expect(() => generateSimulationEventId('run', 'tok', 1.5, 0)).toThrow(RangeError);
      expect(() => generateSimulationEventId('run', 'tok', 0, Number.MAX_VALUE)).toThrow(RangeError);
    });
  });

  describe('2. Timeline Creation & Internal Sequence Allocation', () => {
    it('creates an empty, deeply frozen timeline state with sequence starting at 0', () => {
      const timeline = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      expect(timeline.runId).toBe(DEFAULT_RUN_ID);
      expect(timeline.runToken).toBe(DEFAULT_RUN_TOKEN);
      expect(timeline.importGen).toBe(DEFAULT_IMPORT_GEN);
      expect(timeline.events).toEqual([]);
      expect(Object.isFrozen(timeline)).toBe(true);
      expect(Object.isFrozen(timeline.events)).toBe(true);
    });

    it('allocates sequence monotonically starting at 0 and increments for each append', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const { nextTimeline: t1, event: e1 } = appendSimulationTimelineEvent(
        t0,
        { eventType: 'INITIALIZE' },
        0
      );
      expect(e1.sequence).toBe(0);
      expect(e1.eventId).toBe(`evt:${DEFAULT_RUN_ID}:${DEFAULT_RUN_TOKEN}:${DEFAULT_IMPORT_GEN}:0`);
      expect(t1.events.length).toBe(1);

      const { nextTimeline: t2, event: e2 } = appendSimulationTimelineEvent(
        t1,
        { eventType: 'STEP' },
        1000
      );
      expect(e2.sequence).toBe(1);
      expect(e2.eventId).toBe(`evt:${DEFAULT_RUN_ID}:${DEFAULT_RUN_TOKEN}:${DEFAULT_IMPORT_GEN}:1`);
      expect(t2.events.length).toBe(2);

      // Verify original timeline t0 was not mutated
      expect(t0.events.length).toBe(0);
    });

    it('strictly rejects caller attempts to inject sequence, eventId, or timestamps via input', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      expect(() =>
        appendSimulationTimelineEvent(
          t0,
          { eventType: 'TEST', sequence: 99 } as any,
          100
        )
      ).toThrow(/caller must not supply/);

      expect(() =>
        appendSimulationTimelineEvent(
          t0,
          { eventType: 'TEST', eventId: 'fake_id' } as any,
          100
        )
      ).toThrow(/caller must not supply/);

      expect(() =>
        appendSimulationTimelineEvent(
          t0,
          { eventType: 'TEST', simTimeNs: 999 } as any,
          100
        )
      ).toThrow(/caller must not supply/);

      expect(() =>
        appendSimulationTimelineEvent(
          t0,
          { eventType: 'TEST', simTimeMs: 1 } as any,
          100
        )
      ).toThrow(/caller must not supply/);
    });
  });

  describe('3. Payload Validation, Deep Cloning, and Caller Isolation', () => {
    it('accepts valid JSON-compatible plain data with nested objects and arrays', () => {
      const originalPayload = {
        name: 'Alpha',
        count: 42,
        active: true,
        score: null,
        tags: ['first', 'second'],
        nested: { inner: 'val', list: [1, 2, 3] },
      };

      const cloned = cloneEventPayload(originalPayload);
      expect(cloned).toEqual(originalPayload);
      expect(Object.isFrozen(cloned)).toBe(true);
      expect(Object.isFrozen((cloned as any).nested)).toBe(true);
      expect(Object.isFrozen((cloned as any).tags)).toBe(true);
    });

    it('isolates recorded event history from subsequent mutations of caller payload', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const mutablePayload = {
        target: 'Unit_01',
        coords: { x: 10, y: 20 },
      };

      const { event } = appendSimulationTimelineEvent(
        t0,
        { eventType: 'TARGET_ACQUIRED', payload: mutablePayload },
        5000
      );

      // Caller mutates the original object
      mutablePayload.target = 'MUTATED_UNIT';
      mutablePayload.coords.x = 999;

      // Event history remains completely unchanged
      expect(event.payload).toEqual({
        target: 'Unit_01',
        coords: { x: 10, y: 20 },
      });

      // Event payload is frozen
      expect(() => {
        (event.payload as any).target = 'HACKED';
      }).toThrow();
    });

    it('allows omitted (undefined) payload', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const { event } = appendSimulationTimelineEvent(t0, { eventType: 'HEARTBEAT' }, 100);
      expect(event.payload).toBeUndefined();
    });

    it('rejects undefined values inside supplied payload', () => {
      expect(() => cloneEventPayload({ a: undefined })).toThrow(TypeError);
      expect(() => cloneEventPayload({ list: [1, undefined] })).toThrow(TypeError);
    });

    it('rejects functions, symbols, and BigInt inside payload', () => {
      expect(() => cloneEventPayload({ fn: () => {} })).toThrow(TypeError);
      expect(() => cloneEventPayload({ sym: Symbol('bad') })).toThrow(TypeError);
      expect(() => cloneEventPayload({ big: 123n })).toThrow(TypeError);
      expect(() => cloneEventPayload({ [Symbol('key')]: 'bad' })).toThrow(TypeError);
    });

    it('rejects non-finite numbers (NaN, Infinity, -Infinity) inside payload', () => {
      expect(() => cloneEventPayload({ val: NaN })).toThrow(RangeError);
      expect(() => cloneEventPayload({ val: Infinity })).toThrow(RangeError);
      expect(() => cloneEventPayload({ val: -Infinity })).toThrow(RangeError);
    });

    it('rejects cyclic structures inside payload', () => {
      const cycle: any = { name: 'cycle' };
      cycle.self = cycle;
      expect(() => cloneEventPayload(cycle)).toThrow(/cyclic/i);
    });

    it('accepts shared acyclic references (DAGs) and clones them into plain JSON data (P1)', () => {
      const shared = { value: 1 };
      const payload = { left: shared, right: shared };
      const cloned = cloneEventPayload(payload) as any;

      expect(cloned).toEqual({ left: { value: 1 }, right: { value: 1 } });
      expect(cloned.left.value).toBe(1);
      expect(cloned.right.value).toBe(1);
      expect(Object.isFrozen(cloned.left)).toBe(true);
      expect(Object.isFrozen(cloned.right)).toBe(true);
    });

    it('preserves own __proto__ property and JSON value without altering prototype (P2)', () => {
      const payload = JSON.parse(
        '{"__proto__":{"source":"original"},"count":1}'
      );
      const cloned = cloneEventPayload(payload) as any;

      expect(Object.prototype.hasOwnProperty.call(cloned, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
      expect(cloned.count).toBe(1);
      expect(Object.getOwnPropertyDescriptor(cloned, '__proto__')?.value).toEqual({
        source: 'original',
      });
      expect(JSON.stringify(cloned)).toBe(
        '{"__proto__":{"source":"original"},"count":1}'
      );
      expect(Object.isFrozen(cloned)).toBe(true);
    });

    it('rejects accessor properties (getters/setters) without executing them', () => {
      let getterRan = false;
      const payloadWithGetter = {
        get hacked() {
          getterRan = true;
          return 'exploit';
        },
      };
      expect(() => cloneEventPayload(payloadWithGetter)).toThrow(/accessor properties/);
      expect(getterRan).toBe(false);
    });

    it('rejects array index getters without executing them', () => {
      let getterRan = false;
      const arrWithGetter = [10, 20];
      Object.defineProperty(arrWithGetter, '0', {
        get() {
          getterRan = true;
          return 999;
        },
        enumerable: true,
        configurable: true,
      });

      expect(() => cloneEventPayload({ arr: arrWithGetter })).toThrow(
        /accessor properties \(getters\/setters\) on array index/
      );
      expect(getterRan).toBe(false);
    });

    it('rejects sparse arrays even when prototype properties exist', () => {
      try {
        (Array.prototype as any)[1] = 'proto_polluted';
        const sparse = [10, , 30];
        expect(() => cloneEventPayload({ arr: sparse })).toThrow(
          /arrays with holes or extra properties/
        );
      } finally {
        delete (Array.prototype as any)[1];
      }
    });

    it('rejects sparse arrays with custom properties or extra own properties', () => {
      const sparse = [1, , 3];
      expect(() => cloneEventPayload({ arr: sparse })).toThrow(
        /arrays with holes or extra properties/
      );

      const trickySparse: any = [10, , 30];
      trickySparse.extra = 'custom_val';
      expect(() => cloneEventPayload({ arr: trickySparse })).toThrow(
        /extra own property "extra" on array is not permitted/
      );

      const arrayWithSymbol: any = [1, 2];
      arrayWithSymbol[Symbol('test')] = 'sym_val';
      expect(() => cloneEventPayload({ arr: arrayWithSymbol })).toThrow(
        /Symbol properties on arrays are not permitted/
      );
    });

    it('rejects non-plain objects, Map, Set, Date, and class instances', () => {
      expect(() => cloneEventPayload({ date: new Date() })).toThrow(TypeError);
      expect(() => cloneEventPayload({ map: new Map() })).toThrow(TypeError);
      expect(() => cloneEventPayload({ set: new Set() })).toThrow(TypeError);
      class CustomClass {
        value = 1;
      }
      expect(() => cloneEventPayload({ custom: new CustomClass() })).toThrow(TypeError);
    });
  });

  describe('4. Monotonic Ordering & Timestamp Invariants', () => {
    it('accepts strictly advancing simulated time', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const { nextTimeline: t1 } = appendSimulationTimelineEvent(t0, { eventType: 'A' }, 100);
      const { nextTimeline: t2 } = appendSimulationTimelineEvent(t1, { eventType: 'B' }, 200);
      expect(t2.events[0].simTimeNs).toBe(100);
      expect(t2.events[1].simTimeNs).toBe(200);
    });

    it('accepts equal timestamps and preserves sequence append order', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const { nextTimeline: t1 } = appendSimulationTimelineEvent(t0, { eventType: 'FIRST' }, 500);
      const { nextTimeline: t2 } = appendSimulationTimelineEvent(t1, { eventType: 'SECOND' }, 500);
      const { nextTimeline: t3 } = appendSimulationTimelineEvent(t2, { eventType: 'THIRD' }, 500);

      expect(t3.events.length).toBe(3);
      expect(t3.events[0].simTimeNs).toBe(500);
      expect(t3.events[0].sequence).toBe(0);
      expect(t3.events[0].eventType).toBe('FIRST');

      expect(t3.events[1].simTimeNs).toBe(500);
      expect(t3.events[1].sequence).toBe(1);
      expect(t3.events[1].eventType).toBe('SECOND');

      expect(t3.events[2].simTimeNs).toBe(500);
      expect(t3.events[2].sequence).toBe(2);
      expect(t3.events[2].eventType).toBe('THIRD');
    });

    it('strictly rejects backward simulated time with RangeError without mutating timeline', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      const { nextTimeline: t1 } = appendSimulationTimelineEvent(t0, { eventType: 'A' }, 1000);

      expect(() =>
        appendSimulationTimelineEvent(t1, { eventType: 'BACKWARD' }, 999)
      ).toThrow(RangeError);

      // t1 remains unmutated
      expect(t1.events.length).toBe(1);
    });

    it('rejects negative simulated time and time exceeding maximum horizon', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      expect(() => appendSimulationTimelineEvent(t0, { eventType: 'NEG' }, -1)).toThrow(RangeError);
      expect(() =>
        appendSimulationTimelineEvent(t0, { eventType: 'OVER' }, MAX_SUPPORTED_SIM_TIME_NS + 1)
      ).toThrow(RangeError);
    });

    it('rejects empty or whitespace-only eventType', () => {
      const t0 = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      expect(() => appendSimulationTimelineEvent(t0, { eventType: '' }, 0)).toThrow(TypeError);
      expect(() => appendSimulationTimelineEvent(t0, { eventType: '   ' }, 0)).toThrow(TypeError);
    });
  });

  describe('5. Query Contract [fromNs, toNs)', () => {
    let populatedTimeline: any;

    beforeEach(() => {
      let t = createSimulationTimeline(DEFAULT_RUN_ID, DEFAULT_RUN_TOKEN, DEFAULT_IMPORT_GEN);
      t = appendSimulationTimelineEvent(t, { eventType: 'E0' }, 0).nextTimeline;
      t = appendSimulationTimelineEvent(t, { eventType: 'E1' }, 100).nextTimeline;
      t = appendSimulationTimelineEvent(t, { eventType: 'E2_A' }, 200).nextTimeline;
      t = appendSimulationTimelineEvent(t, { eventType: 'E2_B' }, 200).nextTimeline;
      t = appendSimulationTimelineEvent(t, { eventType: 'E3' }, 300).nextTimeline;
      t = appendSimulationTimelineEvent(t, { eventType: 'E4' }, 500).nextTimeline;
      populatedTimeline = t;
    });

    it('returns all events when range is omitted', () => {
      const results = querySimulationEvents(populatedTimeline);
      expect(results.length).toBe(6);
    });

    it('filters strictly by half-open interval [fromNs, toNs)', () => {
      // [100, 300) should include 100, 200 (both events), but exclude 300
      const results = querySimulationEvents(populatedTimeline, { fromNs: 100, toNs: 300 });
      expect(results.map(e => e.eventType)).toEqual(['E1', 'E2_A', 'E2_B']);
    });

    it('preserves sequence ordering for events with equal timestamps', () => {
      const results = querySimulationEvents(populatedTimeline, { fromNs: 200, toNs: 201 });
      expect(results.length).toBe(2);
      expect(results[0].eventType).toBe('E2_A');
      expect(results[0].sequence).toBe(2);
      expect(results[1].eventType).toBe('E2_B');
      expect(results[1].sequence).toBe(3);
    });

    it('consistently returns an empty array for [t, t) interval', () => {
      const results = querySimulationEvents(populatedTimeline, { fromNs: 200, toNs: 200 });
      expect(results).toEqual([]);
      expect(Object.isFrozen(results)).toBe(true);
    });

    it('handles unbounded lower and upper ranges [0, toNs) and [fromNs, Infinity)', () => {
      const upTo200 = querySimulationEvents(populatedTimeline, { toNs: 200 });
      expect(upTo200.map(e => e.eventType)).toEqual(['E0', 'E1']);

      const from300 = querySimulationEvents(populatedTimeline, { fromNs: 300 });
      expect(from300.map(e => e.eventType)).toEqual(['E3', 'E4']);
    });

    it('rejects reversed ranges (fromNs > toNs) with RangeError', () => {
      expect(() => querySimulationEvents(populatedTimeline, { fromNs: 300, toNs: 200 })).toThrow(
        RangeError
      );
    });

    it('rejects negative, non-safe-integer, or non-finite range boundaries', () => {
      expect(() => querySimulationEvents(populatedTimeline, { fromNs: -1 })).toThrow(RangeError);
      expect(() => querySimulationEvents(populatedTimeline, { toNs: -10 })).toThrow(RangeError);
      expect(() => querySimulationEvents(populatedTimeline, { fromNs: 1.5 })).toThrow(RangeError);
      expect(() => querySimulationEvents(populatedTimeline, { toNs: NaN })).toThrow(RangeError);
      expect(() => querySimulationEvents(populatedTimeline, { fromNs: Infinity })).toThrow(RangeError);
    });

    it('query result is deeply frozen and does not mutate timeline state', () => {
      const results = querySimulationEvents(populatedTimeline, { fromNs: 0, toNs: 100 });
      expect(Object.isFrozen(results)).toBe(true);
      expect(populatedTimeline.events.length).toBe(6);
    });
  });
});
