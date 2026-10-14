import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTacticalStore,
  selectSimulationTimelineByRunId,
  selectActiveSimulationTimeline,
  selectSimulationEventsByRunId,
  selectActiveSimulationEvents,
  selectSimulationEventCount,
  computePlanInputFingerprint,
} from '../useTacticalStore';
import type { SimulationRunHandle } from '../../domain/types/simulation';

describe('Checkpoint 2C.3: Simulation Timeline Store Integration Tests', () => {
  const resetStore = () => {
    useTacticalStore.setState({
      scenarios: {
        scen_timeline: {
          id: 'scen_timeline',
          name: 'Timeline Scenario',
          terrainVersion: 'v1',
          createdAt: Date.now(),
          status: 'active',
        },
      },
      plans: {
        plan_timeline: {
          id: 'plan_timeline',
          scenarioId: 'scen_timeline',
          version: 1,
          name: 'Timeline Plan',
          status: 'draft',
          alternativeId: 'plan_timeline',
          revisionNumber: 1,
          baseRevisionPlanId: null,
        },
      },
      activeScenarioId: 'scen_timeline',
      activePlanId: 'plan_timeline',
      activeSimulationRunId: null,
      simulationRuns: {},
      simulationClocks: {},
      simulationTimelines: {},
      placements: {},
      definitions: {},
      observations: {},
      simulations: {},
      visuals: {},
      revisions: {},
      revisionHeads: {},
      auditEvents: {},
      auditEventOrder: [],
      canonicalInitialized: true,
      workspaceContextGeneration: 1,
      lastImportGen: 1,
    });
  };

  beforeEach(() => {
    resetStore();
  });

  const setupRunningExecution = (
    runIdSuffix = '01'
  ): { handle: SimulationRunHandle; runId: string } => {
    const store = useTacticalStore.getState();
    const handle = store.registerSimulationRun({
      scenarioId: 'scen_timeline',
      planId: 'plan_timeline',
      initialStatus: 'running',
      customRunId: `run_${runIdSuffix}`,
    });

    store.initSimulationClock(handle);
    store.startSimulationClock(handle);
    store.initSimulationTimeline(handle);

    return { handle, runId: handle.runId };
  };

  describe('1. Timeline Session Initialization & Duplicate Prevention', () => {
    it('initializes an empty timeline session bound to run incarnation', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_timeline',
        planId: 'plan_timeline',
        initialStatus: 'running',
      });

      const timeline = store.initSimulationTimeline(handle);
      expect(timeline.runId).toBe(handle.runId);
      expect(timeline.runToken).toBe(handle.runToken);
      expect(timeline.importGen).toBe(1);
      expect(timeline.events).toEqual([]);

      const stored = useTacticalStore.getState().simulationTimelines[handle.runId];
      expect(stored).toBeDefined();
      expect(stored.events.length).toBe(0);
    });

    it('strictly rejects duplicate timeline initialization without silent overwrite', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      expect(() => store.initSimulationTimeline(handle)).toThrow(
        /session already exists for SimulationRun/
      );
    });
  });

  describe('2. Clock-Owned Timestamp Capture & Ordering', () => {
    it('captures authoritative simTimeNs directly from active canonical clock', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      // Step clock by 500 ms (500,000,000 ns)
      store.stepSimulationClock(handle, 500);

      const event = store.appendSimulationEvent(handle, {
        eventType: 'RADAR_SCAN',
        payload: { targetCount: 3 },
      });

      expect(event.simTimeNs).toBe(500_000_000);
      expect(event.sequence).toBe(0);
      expect(event.runId).toBe(runId);
      expect(event.runToken).toBe(handle.runToken);
      expect(event.eventId).toBe(`evt:${runId}:${handle.runToken}:1:0`);

      // Step clock by another 250 ms (now 750,000,000 ns)
      store.stepSimulationClock(handle, 250);

      const event2 = store.appendSimulationEvent(handle, {
        eventType: 'MISSILE_FIRED',
        payload: { missileId: 'M1' },
      });

      expect(event2.simTimeNs).toBe(750_000_000);
      expect(event2.sequence).toBe(1);
      expect(event2.eventId).toBe(`evt:${runId}:${handle.runToken}:1:1`);

      const timeline = useTacticalStore.getState().simulationTimelines[runId];
      expect(timeline.events.length).toBe(2);
      expect(timeline.events[0]).toEqual(event);
      expect(timeline.events[1]).toEqual(event2);
    });

    it('preserves sequence order when multiple events occur at the same simTimeNs', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const e0 = store.appendSimulationEvent(handle, { eventType: 'EVT_ZERO' });
      const e1 = store.appendSimulationEvent(handle, { eventType: 'EVT_ONE' });
      const e2 = store.appendSimulationEvent(handle, { eventType: 'EVT_TWO' });

      expect(e0.simTimeNs).toBe(0);
      expect(e0.sequence).toBe(0);
      expect(e1.simTimeNs).toBe(0);
      expect(e1.sequence).toBe(1);
      expect(e2.simTimeNs).toBe(0);
      expect(e2.sequence).toBe(2);

      const timeline = useTacticalStore.getState().simulationTimelines[runId];
      expect(timeline.events.map((e) => e.sequence)).toEqual([0, 1, 2]);
    });

    it('rejects caller attempts to provide timestamps or internal identifiers', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      expect(() =>
        store.appendSimulationEvent(handle, {
          eventType: 'BAD',
          simTimeNs: 12345,
        } as any)
      ).toThrow(/caller must not supply/);

      expect(() =>
        store.appendSimulationEvent(handle, {
          eventType: 'BAD',
          sequence: 0,
        } as any)
      ).toThrow(/caller must not supply/);

      expect(() =>
        store.appendSimulationEvent(handle, {
          eventType: 'BAD',
          eventId: 'spoofed_id',
        } as any)
      ).toThrow(/caller must not supply/);
    });
  });

  describe('3. Clock Phase & Lifecycle Status Guards', () => {
    it('rejects appending when clock is in idle phase', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_timeline',
        planId: 'plan_timeline',
        initialStatus: 'running',
      });
      store.initSimulationClock(handle); // Idle phase
      store.initSimulationTimeline(handle);

      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'TEST' })
      ).toThrow(/Clock phase must be advancing \(current phase: idle\)/);
    });

    it('rejects appending when clock is paused', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      store.pauseSimulationClock(handle);

      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'TEST' })
      ).toThrow(/Clock phase must be advancing \(current phase: paused\)/);
    });

    it('rejects appending when run status is pending', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_timeline',
        planId: 'plan_timeline',
        initialStatus: 'pending',
      });
      store.initSimulationClock(handle);
      store.initSimulationTimeline(handle);

      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'TEST' })
      ).toThrow(/Run must be in running status \(current status: pending\)/);
    });

    it('rejects appending when run is in terminal status (completed, failed, cancelled)', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      store.updateSimulationRunStatus(handle, 'completed');

      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'POST_TERMINAL' })
      ).toThrow(/Cannot append simulation event for terminal SimulationRun/);
    });
  });

  describe('4. Execution Incarnation Token & Workspace Generation Guards', () => {
    it('rejects historical runs lacking an active execution incarnation token', () => {
      const store = useTacticalStore.getState();
      const historicalId = 'hist_run_999';
      useTacticalStore.setState((s) => ({
        simulationRuns: {
          ...s.simulationRuns,
          [historicalId]: {
            id: historicalId,
            planId: 'plan_timeline',
            scenarioId: 'scen_timeline',
            timestamp: Date.now(),
            config: {},
            status: 'running',
            planInputFingerprint: computePlanInputFingerprint(s, 'plan_timeline'),
            // runToken is missing!
          },
        },
      }));

      expect(() => store.initSimulationTimeline(historicalId)).toThrow(
        /Record is an imported historical run without an active execution incarnation token/
      );
    });

    it('rejects mismatched or fraudulent execution incarnation tokens', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      expect(() =>
        store.appendSimulationEvent(
          handle.runId,
          { eventType: 'TEST' },
          { runToken: 'fraudulent_token_xyz' }
        )
      ).toThrow(/Invalid or missing execution incarnation token/);
    });

    it('rejects handles issued in an obsolete workspace import generation', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      expect(() =>
        store.appendSimulationEvent(
          handle.runId,
          { eventType: 'TEST' },
          { runToken: handle.runToken, importGen: 999 }
        )
      ).toThrow(/Workspace was replaced by import after registration/);
    });

    it('rejects when clock session or timeline session does not exist', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_timeline',
        planId: 'plan_timeline',
        initialStatus: 'running',
      });

      // No clock session initialized yet
      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'TEST' })
      ).toThrow(/Clock session does not exist/);

      // Now init clock and advance it, but omit timeline session
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      expect(() =>
        store.appendSimulationEvent(handle, { eventType: 'TEST' })
      ).toThrow(/Timeline session does not exist/);
    });
  });

  describe('5. Run A/B Isolation & Independence from activeSimulationRunId', () => {
    it('strictly isolates timelines between two concurrent runs', () => {
      const runA = setupRunningExecution('A');
      const runB = setupRunningExecution('B');
      const store = useTacticalStore.getState();

      // Set activeSimulationRunId to Run A
      store.setActiveSimulationRunId(runA.runId);

      // Advance Run A by 100 ms and append
      store.stepSimulationClock(runA.handle, 100);
      const evtA = store.appendSimulationEvent(runA.handle, { eventType: 'EVENT_A' });

      // Advance Run B by 500 ms and append while Run A is active in UI
      store.stepSimulationClock(runB.handle, 500);
      const evtB = store.appendSimulationEvent(runB.handle, { eventType: 'EVENT_B' });

      expect(evtA.simTimeNs).toBe(100_000_000);
      expect(evtA.runId).toBe(runA.runId);

      expect(evtB.simTimeNs).toBe(500_000_000);
      expect(evtB.runId).toBe(runB.runId);

      const timelineA = useTacticalStore.getState().simulationTimelines[runA.runId];
      const timelineB = useTacticalStore.getState().simulationTimelines[runB.runId];

      expect(timelineA.events.length).toBe(1);
      expect(timelineA.events[0].eventType).toBe('EVENT_A');

      expect(timelineB.events.length).toBe(1);
      expect(timelineB.events[0].eventType).toBe('EVENT_B');
    });
  });

  describe('6. Workspace Import Invalidation & Serialization Exclusion', () => {
    it('atomically invalidates all timeline sessions on workspace package import', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();
      store.appendSimulationEvent(handle, { eventType: 'BEFORE_IMPORT' });

      expect(useTacticalStore.getState().simulationTimelines[runId].events.length).toBe(1);

      // Export package and import back (simulating replacement)
      const pkg = store.exportCanonicalPackageV2('Backup');
      store.importCanonicalPackage(pkg);

      const stateAfter = useTacticalStore.getState();
      expect(stateAfter.simulationTimelines).toEqual({});
      expect(stateAfter.simulationClocks).toEqual({});
    });

    it('excludes simulationTimelines from CanonicalStatePackage V1 and V2 exports', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();
      store.appendSimulationEvent(handle, { eventType: 'EVENT_FOR_EXPORT' });

      const pkgV1 = store.exportCanonicalPackage('V1 Export');
      expect((pkgV1 as any).simulationTimelines).toBeUndefined();

      const pkgV2 = store.exportCanonicalPackageV2('V2 Export');
      expect((pkgV2 as any).simulationTimelines).toBeUndefined();
    });
  });

  describe('7. Audit & Provenance Neutrality', () => {
    it('appending events does not emit AuditEvents or mutate revisions', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const initialAuditCount = store.auditEventOrder.length;
      const initialPlanRev = store.plans['plan_timeline'].revisionNumber;
      const initialRevisions = { ...store.revisions };

      store.appendSimulationEvent(handle, {
        eventType: 'TACTICAL_EVENT',
        payload: { detail: 'neutral' },
      });

      const updatedStore = useTacticalStore.getState();
      expect(updatedStore.auditEventOrder.length).toBe(initialAuditCount);
      expect(updatedStore.plans['plan_timeline'].revisionNumber).toBe(initialPlanRev);
      expect(updatedStore.revisions).toEqual(initialRevisions);
    });
  });

  describe('8. Selectors Query Operations', () => {
    it('retrieves timeline, events by range, and event counts through selectors', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();
      store.setActiveSimulationRunId(runId);

      store.appendSimulationEvent(handle, { eventType: 'INIT' }); // 0 ns
      store.stepSimulationClock(handle, 200);
      store.appendSimulationEvent(handle, { eventType: 'AT_200' }); // 200,000,000 ns
      store.stepSimulationClock(handle, 300);
      store.appendSimulationEvent(handle, { eventType: 'AT_500' }); // 500,000,000 ns

      const currentState = useTacticalStore.getState();

      // selectSimulationTimelineByRunId & selectActiveSimulationTimeline
      const timeline = selectSimulationTimelineByRunId(currentState, runId);
      const activeTimeline = selectActiveSimulationTimeline(currentState);
      expect(timeline).toBe(activeTimeline);
      expect(timeline?.events.length).toBe(3);

      // selectSimulationEventsByRunId with range filter [100ms, 500ms)
      const rangeEvents = selectSimulationEventsByRunId(currentState, runId, {
        fromNs: 100_000_000,
        toNs: 500_000_000,
      });
      expect(rangeEvents.map((e) => e.eventType)).toEqual(['AT_200']);

      // selectActiveSimulationEvents
      const allActiveEvents = selectActiveSimulationEvents(currentState);
      expect(allActiveEvents.length).toBe(3);

      // selectSimulationEventCount
      expect(selectSimulationEventCount(currentState, runId)).toBe(3);
      expect(selectSimulationEventCount(currentState)).toBe(3);
      expect(selectSimulationEventCount(currentState, 'non_existent_run')).toBe(0);
    });
  });
});
