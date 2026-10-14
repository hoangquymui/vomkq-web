import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTacticalStore,
  selectSimulationClockByRunId,
  selectSimulationTimelineByRunId,
  computePlanInputFingerprint,
} from '../useTacticalStore';
import type { SimulationRunHandle } from '../../domain/types/simulation';

describe('Checkpoint 2C.4: Simulation Runner Store Integration Tests', () => {
  const resetStore = () => {
    useTacticalStore.setState({
      scenarios: {
        scen_runner: {
          id: 'scen_runner',
          name: 'Runner Scenario',
          terrainVersion: 'v1',
          createdAt: Date.now(),
          status: 'active',
        },
      },
      plans: {
        plan_runner: {
          id: 'plan_runner',
          scenarioId: 'scen_runner',
          version: 1,
          name: 'Runner Plan',
          status: 'draft',
          alternativeId: 'plan_runner',
          revisionNumber: 1,
          baseRevisionPlanId: null,
        },
      },
      activeScenarioId: 'scen_runner',
      activePlanId: 'plan_runner',
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
      scenarioId: 'scen_runner',
      planId: 'plan_runner',
      initialStatus: 'running',
      customRunId: `run_${runIdSuffix}`,
    });

    store.initSimulationClock(handle);
    store.startSimulationClock(handle);
    store.initSimulationTimeline(handle);

    return { handle, runId: handle.runId };
  };

  describe('Gate 1 & 2: Clock Advancement & Zero Artificial Events', () => {
    it('advances the correct canonical clock and produces zero artificial events when events omitted', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const result = store.stepSimulation(handle, { elapsedRealMs: 500 });

      expect(result.runId).toBe(runId);
      expect(result.clock.simTimeNs).toBe(500_000_000);
      expect(result.clock.simTimeMs).toBe(500);
      expect(result.clock.tickCount).toBe(1);
      expect(result.events).toEqual([]);
      expect(result.timeline.events.length).toBe(0);

      // Verify Zustand store state reflects the update
      const state = useTacticalStore.getState();
      const storedClock = selectSimulationClockByRunId(state, runId);
      const storedTimeline = selectSimulationTimelineByRunId(state, runId);

      expect(storedClock?.simTimeNs).toBe(500_000_000);
      expect(storedClock?.tickCount).toBe(1);
      expect(storedTimeline?.events.length).toBe(0);
    });
  });

  describe('Gate 3 & 4: Event Ordering & Deterministic Replay', () => {
    it('assigns post-advancement timestamp and preserves sequence/input order for multiple events', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const result = store.stepSimulation(handle, {
        elapsedRealMs: 200,
        events: [
          { eventType: 'EVT_FIRST', payload: { rank: 1 } },
          { eventType: 'EVT_SECOND', payload: { rank: 2 } },
          { eventType: 'EVT_THIRD', payload: { rank: 3 } },
        ],
      });

      expect(result.clock.simTimeNs).toBe(200_000_000);
      expect(result.events.length).toBe(3);

      for (let i = 0; i < 3; i++) {
        expect(result.events[i].simTimeNs).toBe(200_000_000);
        expect(result.events[i].sequence).toBe(i);
      }
      expect(result.events[0].eventType).toBe('EVT_FIRST');
      expect(result.events[1].eventType).toBe('EVT_SECOND');
      expect(result.events[2].eventType).toBe('EVT_THIRD');

      const state = useTacticalStore.getState();
      const storedTimeline = selectSimulationTimelineByRunId(state, runId);
      expect(storedTimeline?.events.length).toBe(3);
    });

    it('guarantees deterministic replay across identical steps', () => {
      const exec1 = setupRunningExecution('rep1');
      const store1 = useTacticalStore.getState();

      const res1 = store1.stepSimulation(exec1.handle, {
        elapsedRealMs: 150,
        events: [{ eventType: 'DET_1', payload: { val: 'a' } }],
      });

      const exec2 = setupRunningExecution('rep2');
      const store2 = useTacticalStore.getState();

      const res2 = store2.stepSimulation(exec2.handle, {
        elapsedRealMs: 150,
        events: [{ eventType: 'DET_1', payload: { val: 'a' } }],
      });

      expect(res1.clock.simTimeNs).toBe(res2.clock.simTimeNs);
      expect(res1.clock.fractionalCarryMs).toBe(res2.clock.fractionalCarryMs);
      expect(res1.events[0].simTimeNs).toBe(res2.events[0].simTimeNs);
      expect(res1.events[0].eventType).toBe(res2.events[0].eventType);
      expect(res1.events[0].payload).toEqual(res2.events[0].payload);
    });
  });

  describe('Gate 5 & 6: Critical Atomicity & Rollback Guarantees', () => {
    it('rolls back entirely if a later event in a batch fails validation (no partial commit)', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const cyclicPayload: any = { name: 'cycle' };
      cyclicPayload.self = cyclicPayload;

      // Batch of 3 events where the 3rd event has a cyclic payload
      expect(() =>
        store.stepSimulation(handle, {
          elapsedRealMs: 100,
          events: [
            { eventType: 'VALID_1' },
            { eventType: 'VALID_2' },
            { eventType: 'BAD_EVENT', payload: cyclicPayload },
          ],
        })
      ).toThrow(/cyclic/i);

      // Verify full rollback: clock is NOT advanced, and NEITHER event 1 nor 2 was committed
      const stateAfter = useTacticalStore.getState();
      const storedClock = selectSimulationClockByRunId(stateAfter, runId);
      const storedTimeline = selectSimulationTimelineByRunId(stateAfter, runId);

      expect(storedClock?.simTimeNs).toBe(0);
      expect(storedClock?.tickCount).toBe(0);
      expect(storedTimeline?.events.length).toBe(0);
    });

    it('rolls back entirely if clock advancement fails (paused/idle/invalid elapsed)', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      // Pause the clock
      store.pauseSimulationClock(handle);

      expect(() =>
        store.stepSimulation(handle, {
          elapsedRealMs: 100,
          events: [{ eventType: 'EVT_SHOULD_FAIL' }],
        })
      ).toThrow(/Clock phase must be advancing/);

      // Verify timeline was not touched
      const stateAfter = useTacticalStore.getState();
      const storedTimeline = selectSimulationTimelineByRunId(stateAfter, runId);
      expect(storedTimeline?.events.length).toBe(0);
    });

    it('rolls back entirely if an event has an accessor property without executing it', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      let getterRan = false;
      const payloadWithGetter = {
        get evil() {
          getterRan = true;
          return 'hacked';
        },
      };

      expect(() =>
        store.stepSimulation(handle, {
          elapsedRealMs: 100,
          events: [{ eventType: 'EXPLOIT', payload: payloadWithGetter }],
        })
      ).toThrow(/accessor properties/);

      expect(getterRan).toBe(false);

      const stateAfter = useTacticalStore.getState();
      expect(selectSimulationClockByRunId(stateAfter, runId)?.simTimeNs).toBe(0);
      expect(selectSimulationTimelineByRunId(stateAfter, runId)?.events.length).toBe(0);
    });
  });

  describe('Gate 7: Execution Guards & Token Enforcement', () => {
    it('rejects step on historical runs lacking an active execution incarnation token', () => {
      const store = useTacticalStore.getState();
      const histId = 'hist_run_no_token';
      useTacticalStore.setState((s) => ({
        simulationRuns: {
          ...s.simulationRuns,
          [histId]: {
            id: histId,
            planId: 'plan_runner',
            scenarioId: 'scen_runner',
            timestamp: Date.now(),
            config: {},
            status: 'running',
            planInputFingerprint: computePlanInputFingerprint(s, 'plan_runner'),
          },
        },
      }));

      expect(() =>
        store.stepSimulation(histId, { elapsedRealMs: 100 })
      ).toThrow(/imported historical run without an active execution incarnation token/);
    });

    it('rejects step with mismatched execution token or stale import generation', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      expect(() =>
        store.stepSimulation(
          handle.runId,
          { elapsedRealMs: 100 },
          { runToken: 'fraudulent_token_999' }
        )
      ).toThrow(/Invalid or missing execution incarnation token/);

      expect(() =>
        store.stepSimulation(
          handle.runId,
          { elapsedRealMs: 100 },
          { runToken: handle.runToken, importGen: 999 }
        )
      ).toThrow(/Workspace was replaced by import after registration/);
    });

    it('rejects step on pending or terminal runs', () => {
      const store = useTacticalStore.getState();
      const pendingHandle = store.registerSimulationRun({
        scenarioId: 'scen_runner',
        planId: 'plan_runner',
        initialStatus: 'pending',
      });
      store.initSimulationClock(pendingHandle);
      store.initSimulationTimeline(pendingHandle);

      expect(() =>
        store.stepSimulation(pendingHandle, { elapsedRealMs: 100 })
      ).toThrow(/Run must be in running status/);

      // Now test completed terminal run
      const { handle } = setupRunningExecution('term');
      store.updateSimulationRunStatus(handle, 'completed');

      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100 })
      ).toThrow(/Cannot step simulation for terminal SimulationRun/);
    });

    it('rejects step if clock or timeline session is missing', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_runner',
        planId: 'plan_runner',
        initialStatus: 'running',
      });

      // No clock session initialized yet
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100 })
      ).toThrow(/Clock session does not exist/);

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      // Timeline session not initialized yet
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100 })
      ).toThrow(/Timeline session does not exist/);
    });
  });

  describe('Gate 8: Run A/B Isolation', () => {
    it('steps Run B independently without altering Run A, even when UI selects Run A', () => {
      const runA = setupRunningExecution('A');
      const runB = setupRunningExecution('B');
      const store = useTacticalStore.getState();

      // UI selects Run A
      store.setActiveSimulationRunId(runA.runId);

      // Step Run B
      const resultB = store.stepSimulation(runB.handle, {
        elapsedRealMs: 300,
        events: [{ eventType: 'RUN_B_EVENT' }],
      });

      expect(resultB.runId).toBe(runB.runId);
      expect(resultB.clock.simTimeNs).toBe(300_000_000);
      expect(resultB.events.length).toBe(1);

      // Verify Run A's state in Zustand was NOT affected at all
      const state = useTacticalStore.getState();
      const clockA = selectSimulationClockByRunId(state, runA.runId);
      const timelineA = selectSimulationTimelineByRunId(state, runA.runId);

      expect(clockA?.simTimeNs).toBe(0);
      expect(clockA?.tickCount).toBe(0);
      expect(timelineA?.events.length).toBe(0);

      // activeSimulationRunId still points to Run A
      expect(state.activeSimulationRunId).toBe(runA.runId);
    });
  });

  describe('Gate 9 & 10: Neutrality & Workspace Import Invalidation', () => {
    it('stepSimulation does not emit AuditEvents or mutate Plan/Scenario revisions or auto-complete run', () => {
      const { handle, runId } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const initialAuditCount = store.auditEventOrder.length;
      const initialPlanRev = store.plans['plan_runner'].revisionNumber;
      const initialRevisions = { ...store.revisions };

      store.stepSimulation(handle, {
        elapsedRealMs: 1000,
        events: [{ eventType: 'TACTICAL_EVENT' }],
      });

      const updatedState = useTacticalStore.getState();
      expect(updatedState.auditEventOrder.length).toBe(initialAuditCount);
      expect(updatedState.plans['plan_runner'].revisionNumber).toBe(initialPlanRev);
      expect(updatedState.revisions).toEqual(initialRevisions);
      expect(updatedState.simulationRuns[runId].status).toBe('running');
    });

    it('invalidates Runner execution sessions on workspace package import', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      store.stepSimulation(handle, { elapsedRealMs: 200 });

      // Export package and import back (simulating replacement)
      const pkg = store.exportCanonicalPackageV2('Backup');
      store.importCanonicalPackage(pkg);

      // Attempting to step with the pre-import handle must now fail
      const stateAfter = useTacticalStore.getState();
      expect(stateAfter.simulationClocks).toEqual({});
      expect(stateAfter.simulationTimelines).toEqual({});

      // 1. Calling with pre-import handle fails on stale caller import generation
      expect(() =>
        stateAfter.stepSimulation(handle, { elapsedRealMs: 100 })
      ).toThrow(/Workspace was replaced by import after registration \(caller generation: 1, current: 2\)/);

      // 2. Even when caller provides current generation, the run itself has stale import generation from previous workspace
      expect(() =>
        stateAfter.stepSimulation(
          handle.runId,
          { elapsedRealMs: 100 },
          { runToken: handle.runToken, importGen: stateAfter.lastImportGen ?? 0 }
        )
      ).toThrow(/Workspace was replaced by import after registration \(run import generation: 1, current: 2\)/);
    });
  });

  describe('Gate 11: Reentrant Concurrency & Atomic Commit Guards (Fix Round 1)', () => {
    it('rejects step and preserves newer paused state if a getter pauses the run during candidate calculation', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      // Verify clock starts advancing
      expect(store.simulationClocks[handle.runId].phase).toBe('advancing');
      expect(store.simulationClocks[handle.runId].simTimeNs).toBe(0);

      // Input with a getter that synchronously pauses the same run during calculation
      const maliciousInput = {
        get elapsedRealMs() {
          useTacticalStore.getState().pauseSimulationClock(handle);
          return 500;
        },
      };

      expect(() =>
        store.stepSimulation(handle, maliciousInput)
      ).toThrow(/Clock session was modified during candidate calculation \(current phase: paused\)/);

      // Assert final store state: the newer paused state must NOT be overwritten by the advancing candidate
      const finalState = useTacticalStore.getState();
      expect(finalState.simulationClocks[handle.runId].phase).toBe('paused');
      expect(finalState.simulationClocks[handle.runId].simTimeNs).toBe(0);
      expect(finalState.simulationTimelines[handle.runId].events.length).toBe(0);
    });

    it('rejects step and does not recreate invalidated sessions if a getter replaces workspace during candidate calculation', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      // Export package to simulate workspace replacement
      const pkg = store.exportCanonicalPackageV2('Backup');

      // Input with a getter that synchronously imports workspace package during calculation
      const maliciousInput = {
        get elapsedRealMs() {
          useTacticalStore.getState().importCanonicalPackage(pkg);
          return 500;
        },
      };

      expect(() =>
        store.stepSimulation(handle, maliciousInput)
      ).toThrow(/Workspace was replaced by import during candidate calculation/);

      // Assert final store state: sessions must remain invalidated and NOT resurrected
      const finalState = useTacticalStore.getState();
      expect(finalState.simulationClocks).toEqual({});
      expect(finalState.simulationTimelines).toEqual({});
      expect(finalState.simulationClocks[handle.runId]).toBeUndefined();
      expect(finalState.simulationTimelines[handle.runId]).toBeUndefined();
    });

    it('rejects malformed non-array events values and preserves store state', () => {
      const { handle } = setupRunningExecution();
      const store = useTacticalStore.getState();

      const initialClock = store.simulationClocks[handle.runId];

      // 1. Empty object {}
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100, events: {} as any })
      ).toThrow(/input.events must be an array when provided/);

      // 2. Object with length property { length: 0 }
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100, events: { length: 0 } as any })
      ).toThrow(/input.events must be an array when provided/);

      // 3. String
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100, events: 'not-an-array' as any })
      ).toThrow(/input.events must be an array when provided/);

      // 4. Null
      expect(() =>
        store.stepSimulation(handle, { elapsedRealMs: 100, events: null as any })
      ).toThrow(/input.events must be an array when provided/);

      // Final store state must remain untouched
      const finalState = useTacticalStore.getState();
      expect(finalState.simulationClocks[handle.runId]).toBe(initialClock);
      expect(finalState.simulationClocks[handle.runId].simTimeNs).toBe(0);
      expect(finalState.simulationTimelines[handle.runId].events.length).toBe(0);
    });
  });
});
