import { describe, it, expect, beforeEach } from 'vitest';
import {
  useTacticalStore,
  selectSimulationClockByRunId,
  selectActiveSimulationClock,
  selectSimulationClockPhase,
  selectSimulationClockTimeMs,
  selectSimulationClockTimeNs,
  selectSimulationClockTimeScale,
  computePlanInputFingerprint,
} from '../useTacticalStore';
import type { EquipmentInstance } from '../../types/equipment';

describe('Checkpoint 2C.2: Simulation Clock Store Integration Tests', () => {
  const resetStore = () => {
    useTacticalStore.setState({
      scenarios: {
        scen_clock: {
          id: 'scen_clock',
          name: 'Clock Scenario',
          terrainVersion: 'v1',
          createdAt: Date.now(),
          status: 'active',
        },
      },
      plans: {
        plan_clock: {
          id: 'plan_clock',
          scenarioId: 'scen_clock',
          version: 1,
          name: 'Clock Plan',
          status: 'draft',
          alternativeId: 'plan_clock',
          revisionNumber: 1,
          baseRevisionPlanId: null,
        },
      },
      activeScenarioId: 'scen_clock',
      activePlanId: 'plan_clock',
      activeSimulationRunId: null,
      simulationRuns: {},
      simulationClocks: {},
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

  describe('1. Deterministic Stepping & Selectors', () => {
    it('initializes, starts, and steps clock deterministically with full selector parity', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
        autoActivate: true,
      });

      // 1. Initial state via initSimulationClock (must start at idle)
      const clockInit = store.initSimulationClock(handle, { timeScale: 1.0 });
      expect(clockInit.simTimeNs).toBe(0);
      expect(clockInit.simTimeMs).toBe(0);
      expect(clockInit.fractionalCarryMs).toBe(0);
      expect(clockInit.phase).toBe('idle');
      expect(clockInit.timeScale).toBe(1.0);
      expect(clockInit.tickCount).toBe(0);

      // Selectors check
      const state1 = useTacticalStore.getState();
      expect(selectSimulationClockByRunId(state1, handle.runId)).toEqual(clockInit);
      expect(selectActiveSimulationClock(state1)).toEqual(clockInit);
      expect(selectSimulationClockPhase(state1, handle.runId)).toBe('idle');
      expect(selectSimulationClockTimeNs(state1, handle.runId)).toBe(0);
      expect(selectSimulationClockTimeMs(state1, handle.runId)).toBe(0);
      expect(selectSimulationClockTimeScale(state1, handle.runId)).toBe(1.0);

      // 2. Start clock -> advancing
      store.startSimulationClock(handle);
      const state2 = useTacticalStore.getState();
      expect(selectSimulationClockPhase(state2, handle.runId)).toBe('advancing');

      // 3. Step clock by 100ms
      const step1 = store.stepSimulationClock(handle, 100);
      expect(step1.simTimeNs).toBe(100_000_000);
      expect(step1.simTimeMs).toBe(100);
      expect(step1.tickCount).toBe(1);
      expect(step1.lastStepRealMs).toBe(100);
      expect(step1.lastSimDeltaMs).toBe(100);

      const state3 = useTacticalStore.getState();
      expect(selectSimulationClockTimeNs(state3, handle.runId)).toBe(100_000_000);
      expect(selectSimulationClockTimeMs(state3, handle.runId)).toBe(100);

      // 4. Change scale to 2x and step 50ms -> 100ms sim delta
      store.setSimulationClockScale(handle, 2.0);
      const step2 = store.stepSimulationClock(handle, 50);
      expect(step2.simTimeNs).toBe(200_000_000);
      expect(step2.simTimeMs).toBe(200); // 100 + 50 * 2 = 200
      expect(step2.lastSimDeltaMs).toBe(100);
      expect(step2.timeScale).toBe(2.0);

      // 5. Change scale to 0.25x and step 40ms -> 10ms sim delta
      store.setSimulationClockScale(handle, 0.25);
      const step3 = store.stepSimulationClock(handle, 40);
      expect(step3.simTimeNs).toBe(210_000_000);
      expect(step3.simTimeMs).toBe(210); // 200 + 40 * 0.25 = 210
      expect(step3.lastSimDeltaMs).toBe(10);
    });

    it('rejects invalid stepping parameters and scale out-of-bounds', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      expect(() => store.stepSimulationClock(handle, -10)).toThrow(/cannot be negative/);
      expect(() => store.stepSimulationClock(handle, NaN)).toThrow(/finite number/);
      expect(() => store.setSimulationClockScale(handle, 0.1)).toThrow(/out of bounds/);
      expect(() => store.setSimulationClockScale(handle, 20)).toThrow(/out of bounds/);
    });
  });

  describe('2. B1: Duplicate Initialization Prevention', () => {
    it('B1: rejects duplicate initialization and prevents silent overwriting of active clock state', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      // 1. First initialization
      store.initSimulationClock(handle, { timeScale: 2.0 });
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 250); // simTimeMs = 500, tickCount = 1

      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(500);

      // 2. Duplicate initialization attempt must THROW
      expect(() => store.initSimulationClock(handle, { timeScale: 1.0 })).toThrow(
        /Cannot initialize simulation clock for SimulationRun .* Clock session already exists/
      );

      // 3. Verify state was NOT overwritten or reset
      const clockAfter = selectSimulationClockByRunId(useTacticalStore.getState(), handle.runId);
      expect(clockAfter?.simTimeMs).toBe(500);
      expect(clockAfter?.tickCount).toBe(1);
      expect(clockAfter?.timeScale).toBe(2.0);
      expect(clockAfter?.phase).toBe('advancing');
    });
  });

  describe('3. B2: Store Fractional Elapsed Carry Accumulation', () => {
    it('B2: preserves sub-precision carry across repeated small steps in actual store', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      // 100 steps of 0.4 nanoseconds (0.0000004 ms)
      // Expected total: 100 * 0.0000004 = 0.00004 ms (40 nanoseconds)
      for (let i = 0; i < 100; i++) {
        store.stepSimulationClock(handle, 0.0000004);
      }

      const clock = selectSimulationClockByRunId(useTacticalStore.getState(), handle.runId);
      expect(clock?.simTimeNs).toBe(40);
      expect(clock?.simTimeMs).toBe(0.00004);
      expect(selectSimulationClockTimeNs(useTacticalStore.getState(), handle.runId)).toBe(40);
      expect(clock?.tickCount).toBe(100);
    });
  });

  describe('4. B3: Paused Invariant (No Bypass)', () => {
    it('B3: strictly rejects advancement when clock is paused; no allowWhenPaused bypass exists', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 100);
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(100);

      // Pause clock
      store.pauseSimulationClock(handle);
      expect(selectSimulationClockPhase(useTacticalStore.getState(), handle.runId)).toBe('paused');

      // Attempting to advance while paused throws Error unconditionally
      expect(() => store.stepSimulationClock(handle, 100)).toThrow(/Clock is paused/);
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(100);

      // Resume clock
      store.resumeSimulationClock(handle);
      expect(selectSimulationClockPhase(useTacticalStore.getState(), handle.runId)).toBe('advancing');

      // Advancing succeeds
      store.stepSimulationClock(handle, 100);
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(200);
    });
  });

  describe('5. B4: Initialization & Reset Semantics (Strict Lifecycle)', () => {
    it('B4: rejects stepping when clock is in idle phase without startSimulationClock', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle); // phase is 'idle'

      // Stepping in idle phase must fail (no implicit startSimulationClock bypass)
      expect(() => store.stepSimulationClock(handle, 100)).toThrow(
        /Clock is in idle phase \(must call startSimulationClock before stepping\)/
      );
    });

    it('B4: rejects stepping or starting if clock was never initialized', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      // No initSimulationClock called
      expect(() => store.stepSimulationClock(handle, 100)).toThrow(
        /Clock session has not been initialized/
      );
      expect(() => store.startSimulationClock(handle)).toThrow(
        /Clock session has not been initialized/
      );
    });

    it('B4: strictly forbids resetting an already advanced clock (no runtime rewinding)', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 100);

      // Attempting to reset advanced clock must throw
      expect(() => store.resetSimulationClockSession(handle)).toThrow(
        /Cannot reset simulation clock.*Clock has already advanced.*Runtime rewinding is disallowed/
      );
    });

    it('B4: allows pre-execution preparation reset of an idle, un-advanced clock', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'pending',
      });

      store.initSimulationClock(handle, { timeScale: 4.0 });
      expect(selectSimulationClockTimeScale(useTacticalStore.getState(), handle.runId)).toBe(4.0);

      // Safe pre-execution reset (e.g. restoring default scale) succeeds
      store.resetSimulationClockSession(handle, { preserveTimeScale: false });
      expect(selectSimulationClockTimeScale(useTacticalStore.getState(), handle.runId)).toBe(1.0);
    });
  });

  describe('6. Pending Run Constraints', () => {
    it('allows pending Run to prepare clock session but strictly forbids advancing', () => {
      const store = useTacticalStore.getState();
      const pendingHandle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'pending',
      });

      // Preparing clock on pending run is ALLOWED
      const clock = store.initSimulationClock(pendingHandle, { timeScale: 2.0 });
      expect(clock.simTimeMs).toBe(0);
      expect(clock.timeScale).toBe(2.0);

      // Resetting or scaling clock on pending run is ALLOWED
      store.setSimulationClockScale(pendingHandle, 4.0);
      store.resetSimulationClockSession(pendingHandle);

      // Advancing or starting clock on pending run is FORBIDDEN
      expect(() => store.stepSimulationClock(pendingHandle, 100)).toThrow(
        /Cannot advance simulation clock for pending SimulationRun/
      );
      expect(() => store.startSimulationClock(pendingHandle)).toThrow(
        /Cannot advance simulation clock for pending SimulationRun/
      );

      // Once transitioned to running, advancing is permitted
      store.updateSimulationRunStatus(pendingHandle, 'running');
      store.startSimulationClock(pendingHandle);
      const stepped = store.stepSimulationClock(pendingHandle, 100);
      expect(stepped.simTimeMs).toBe(400); // 100 * 4.0
    });
  });

  describe('7. Terminal Run Lock', () => {
    it('locks clock mutation when SimulationRun reaches completed, failed, or cancelled', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 150);
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(150);

      // Complete the run
      store.updateSimulationRunStatus(handle, 'completed');

      // Clock is now locked
      expect(() => store.stepSimulationClock(handle, 50)).toThrow(/terminal SimulationRun/);
      expect(() => store.startSimulationClock(handle)).toThrow(/terminal SimulationRun/);
      expect(() => store.pauseSimulationClock(handle)).toThrow(/terminal SimulationRun/);
      expect(() => store.resumeSimulationClock(handle)).toThrow(/terminal SimulationRun/);
      expect(() => store.setSimulationClockScale(handle, 2.0)).toThrow(/terminal SimulationRun/);
      expect(() => store.resetSimulationClockSession(handle)).toThrow(/terminal SimulationRun/);

      // Existing clock time remains readable
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(150);
    });
  });

  describe('8. Incarnation Token Enforcement (Wrong Token Guard)', () => {
    it('rejects clock operations if token is wrong or missing', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      // Wrong token passed via options to init
      expect(() =>
        store.initSimulationClock(handle.runId, { runToken: 'fraudulent_token' })
      ).toThrow(/Invalid or missing execution incarnation token/);

      // Missing token passed when runId string used
      expect(() => store.initSimulationClock(handle.runId)).toThrow(
        /Invalid or missing execution incarnation token/
      );

      // Matching token succeeds
      store.initSimulationClock(handle.runId, { runToken: handle.runToken });
      store.startSimulationClock(handle.runId, { runToken: handle.runToken });
      const clock = store.stepSimulationClock(handle.runId, 100, { runToken: handle.runToken });
      expect(clock.simTimeMs).toBe(100);
    });
  });

  describe('9. Provenance & Freshness Guard (Stale / Unknown Run)', () => {
    it('rejects advancing clock if Run is stale or lacks verified provenance', () => {
      const store = useTacticalStore.getState();

      // Add equipment to plan
      const radar: EquipmentInstance = {
        instanceId: 'rad_clock',
        templateId: 'radar_36d6',
        name: 'Radar Clock Test',
        category: 'RadarCanhGioi',
        latitude: 21.0,
        longitude: 105.0,
        altitude: 10,
        antennaHeightAGL: 15,
        rangeKm: 100,
        scanSpeed: 6,
        minElevationDeg: 0,
        maxElevationDeg: 30,
        coverageHeightKm: 20,
        status: 'Active',
        color: '#06b6d4',
        showDome: true,
        showSweep: true,
      };
      store.addEquipment(radar);

      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 100);

      // Mutate plan equipment coordinates -> invalidates run provenance, making run stale
      store.updateEquipment('rad_clock', { latitude: 25.5 });

      // Stepping clock now throws stale error
      expect(() => store.stepSimulationClock(handle, 100)).toThrow(/Run is not fresh/);
    });
  });

  describe('10. Workspace Import Replacement Invalidation', () => {
    it('invalidates old clock sessions and resets clock state on workspace import', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 500);
      expect(selectSimulationClockTimeMs(useTacticalStore.getState(), handle.runId)).toBe(500);

      // Export package
      const pkg = store.exportCanonicalPackageV2('Backup');

      // Import canonical package -> replaces workspace generation and increments lastImportGen
      store.importCanonicalPackage(pkg);

      const stateAfterImport = useTacticalStore.getState();
      // Ephemeral clock dictionary is completely cleared
      expect(stateAfterImport.simulationClocks).toEqual({});
      expect(selectSimulationClockByRunId(stateAfterImport, handle.runId)).toBeNull();

      // Calling stepSimulationClock with old handle throws generation mismatch
      expect(() => store.stepSimulationClock(handle, 100)).toThrow(
        /Workspace was replaced by import after registration/
      );
    });
  });

  describe('11. Run A/B and Plan A/B Isolation', () => {
    it('isolates clocks across multiple runs and plans without cross-contamination', () => {
      const store = useTacticalStore.getState();

      // 1. Run A in Plan A
      const handleA = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });
      store.initSimulationClock(handleA, { timeScale: 1.0 });
      store.startSimulationClock(handleA);
      store.stepSimulationClock(handleA, 300);

      // 2. Branch to Plan B and create Run B
      store.createPlanAlternative('plan_clock', 'Plan Clock Alternative B');
      const planBId = useTacticalStore.getState().activePlanId!;
      expect(planBId).not.toBe('plan_clock');

      const handleB = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: planBId,
        initialStatus: 'running',
      });
      store.initSimulationClock(handleB, { timeScale: 4.0 });
      store.startSimulationClock(handleB);
      store.stepSimulationClock(handleB, 50); // 50 * 4 = 200ms

      const state = useTacticalStore.getState();
      const clockA = selectSimulationClockByRunId(state, handleA.runId);
      const clockB = selectSimulationClockByRunId(state, handleB.runId);

      expect(clockA?.simTimeMs).toBe(300);
      expect(clockA?.timeScale).toBe(1.0);
      expect(clockA?.tickCount).toBe(1);

      expect(clockB?.simTimeMs).toBe(200);
      expect(clockB?.timeScale).toBe(4.0);
      expect(clockB?.tickCount).toBe(1);

      // Step Run B again: Run A is completely unaffected
      store.stepSimulationClock(handleB, 25);
      const state2 = useTacticalStore.getState();
      expect(selectSimulationClockTimeMs(state2, handleA.runId)).toBe(300);
      expect(selectSimulationClockTimeMs(state2, handleB.runId)).toBe(300); // 200 + 25 * 4 = 300
    });
  });

  describe('12. No Per-Tick Audit Event Generation', () => {
    it('does NOT create audit events or revisions on clock advancement', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      const auditCountBefore = useTacticalStore.getState().auditEventOrder.length;

      // Advance 100 ticks
      for (let i = 0; i < 100; i++) {
        store.stepSimulationClock(handle, 10);
      }

      const auditCountAfter = useTacticalStore.getState().auditEventOrder.length;
      expect(auditCountAfter).toBe(auditCountBefore); // Strictly 0 audit events added!
    });
  });

  describe('13. Serialization Schema Compatibility', () => {
    it('keeps V1 and V2 canonical exports clean of runtime clock sessions', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);
      store.stepSimulationClock(handle, 1000);

      // Export V1 package
      const pkgV1 = store.exportCanonicalPackage('V1 Export');
      expect((pkgV1 as any).simulationClocks).toBeUndefined();

      // Export V2 package
      const pkgV2 = store.exportCanonicalPackageV2('V2 Export');
      expect((pkgV2 as any).simulationClocks).toBeUndefined();
    });
  });

  describe('14. Clock Does Not Auto-Complete SimulationRun', () => {
    it('advancing past configured duration does not change run status to completed', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
        configSnapshot: { durationSeconds: 2 }, // 2000ms
      });
      store.initSimulationClock(handle);
      store.startSimulationClock(handle);

      // Advance well past 2000ms
      store.stepSimulationClock(handle, 5000);
      const state = useTacticalStore.getState();
      expect(selectSimulationClockTimeMs(state, handle.runId)).toBe(5000);

      // Run status remains 'running', not auto-completed!
      const run = state.simulationRuns[handle.runId];
      expect(run.status).toBe('running');
      expect(run.completedAt).toBeUndefined();
    });
  });

  describe('15. B5: Reject Historical Runs Without Active Execution Incarnation', () => {
    it('rejects imported historical Run with valid provenance/status but no runToken when caller omits token', () => {
      const store = useTacticalStore.getState();
      const historicalRunId = 'run_hist_tokenless';
      useTacticalStore.setState((s) => ({
        simulationRuns: {
          ...s.simulationRuns,
          [historicalRunId]: {
            id: historicalRunId,
            scenarioId: 'scen_clock',
            scenarioVersion: 1,
            planId: 'plan_clock',
            planVersion: 1,
            timestamp: Date.now(),
            config: {},
            planInputFingerprint: computePlanInputFingerprint(s, 'plan_clock'),
            status: 'running',
            createdAt: Date.now(),
            startedAt: Date.now(),
            importGen: 1,
            // Strictly NO runToken (historical / imported run record)
          },
        },
      }));

      // Caller omitting token must fail with clear B5 rejection error
      expect(() => store.initSimulationClock(historicalRunId)).toThrow(
        /Cannot initialize simulation clock for SimulationRun run_hist_tokenless: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() => store.startSimulationClock(historicalRunId)).toThrow(
        /Cannot start simulation clock for SimulationRun run_hist_tokenless: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() => store.stepSimulationClock(historicalRunId, 100)).toThrow(
        /Cannot advance simulation clock for SimulationRun run_hist_tokenless: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() => store.setSimulationClockScale(historicalRunId, 2.0)).toThrow(
        /Cannot set simulation clock scale for SimulationRun run_hist_tokenless: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() => store.resetSimulationClockSession(historicalRunId)).toThrow(
        /Cannot reset simulation clock for SimulationRun run_hist_tokenless: Record is an imported historical run without an active execution incarnation token/
      );
    });

    it('rejects imported historical Run when caller provides a fabricated token', () => {
      const store = useTacticalStore.getState();
      const historicalRunId = 'run_hist_fabricated_token';
      useTacticalStore.setState((s) => ({
        simulationRuns: {
          ...s.simulationRuns,
          [historicalRunId]: {
            id: historicalRunId,
            scenarioId: 'scen_clock',
            scenarioVersion: 1,
            planId: 'plan_clock',
            planVersion: 1,
            timestamp: Date.now(),
            config: {},
            planInputFingerprint: computePlanInputFingerprint(s, 'plan_clock'),
            status: 'running',
            createdAt: Date.now(),
            startedAt: Date.now(),
            importGen: 1,
            // Strictly NO runToken
          },
        },
      }));

      // Caller providing fabricated token must fail
      expect(() =>
        store.initSimulationClock(historicalRunId, { runToken: 'fabricated_token_123' })
      ).toThrow(
        /Cannot initialize simulation clock for SimulationRun run_hist_fabricated_token: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() =>
        store.startSimulationClock(historicalRunId, { runToken: 'fabricated_token_123' })
      ).toThrow(
        /Cannot start simulation clock for SimulationRun run_hist_fabricated_token: Record is an imported historical run without an active execution incarnation token/
      );
      expect(() =>
        store.stepSimulationClock(historicalRunId, 100, { runToken: 'fabricated_token_123' })
      ).toThrow(
        /Cannot advance simulation clock for SimulationRun run_hist_fabricated_token: Record is an imported historical run without an active execution incarnation token/
      );
    });

    it('genuine registered Run with the correct handle continues to work seamlessly', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      expect(handle.runToken).toBeDefined();
      expect(typeof handle.runToken).toBe('string');

      // Genuine handle operates clock normally
      const clock = store.initSimulationClock(handle, { timeScale: 1.5 });
      expect(clock.runToken).toBe(handle.runToken);
      expect(clock.timeScale).toBe(1.5);

      store.startSimulationClock(handle);
      const stepped = store.stepSimulationClock(handle, 100);
      expect(stepped.simTimeMs).toBe(150);
      expect(stepped.tickCount).toBe(1);
    });

    it('import-generation rejection remains intact for both caller generation and run record generation', () => {
      const store = useTacticalStore.getState();
      const handle = store.registerSimulationRun({
        scenarioId: 'scen_clock',
        planId: 'plan_clock',
        initialStatus: 'running',
      });

      // Caller passing obsolete import generation
      expect(() =>
        store.initSimulationClock(handle, { importGen: 999 })
      ).toThrow(/Workspace was replaced by import after registration/);

      // Run record having obsolete import generation
      useTacticalStore.setState((s) => ({
        simulationRuns: {
          ...s.simulationRuns,
          [handle.runId]: {
            ...s.simulationRuns[handle.runId],
            importGen: 999,
          },
        },
      }));

      expect(() => store.initSimulationClock(handle)).toThrow(
        /Workspace was replaced by import after registration/
      );
    });
  });
});
