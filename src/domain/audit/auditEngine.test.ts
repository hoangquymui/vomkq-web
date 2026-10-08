import { describe, it, expect, beforeEach } from 'vitest';
import { useTacticalStore } from '../../store/useTacticalStore';
const TEST_INSTANCE = {
  instanceId: 'test-inst-1',
  templateId: 'eq_radar_tamdao',
  shortId: 'EQ-01',
  name: 'Test Radar',
  category: 'RadarCanhGioi',
  latitude: 21.0,
  longitude: 105.0,
  altitude: 100,
  antennaHeightAGL: 10,
  rangeKm: 300,
  minElevationDeg: 0,
  maxElevationDeg: 30,
  coverageHeightKm: 30,
  reactionTimeSeconds: 10,
  frequencyRangeGhz: 'VHF',
  networkGroupId: 'NET-1',
} as any;

describe('Checkpoint 1I: Final Semantic Correction', () => {
  beforeEach(() => {
    // Deep reset unconditionally
    useTacticalStore.setState({
      scenarios: {},
      plans: {},
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      instances: [],
      simulationRuns: {},
      simulations: {},
      revisions: {},
      revisionHeads: {},
      auditEvents: {},
      auditEventOrder: [],
      activeScenarioId: null,
      activePlanId: null,
      canonicalInitialized: false
    });
    useTacticalStore.getState().ensureActiveWorkspace();
  });

  const getStore = () => useTacticalStore.getState();
  const getAuditSize = () => getStore().auditEventOrder.length;
  const getHeadRevision = (type: 'PLAN' | 'SCENARIO' | 'WORKSPACE', id: string) => {
    const revId = getStore().revisionHeads[`${type}:${id}`];
    return revId ? getStore().revisions[revId] : null;
  };

  describe('1. FINGERPRINT CORRECTNESS', () => {
    it('null vs empty string is not ambiguous', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      const fp1 = getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      // Update with empty string name
      store.updateEquipment('test-inst-1', { name: '' });
      const fp2 = getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      // Update with null networkGroupId
      store.updateEquipment('test-inst-1', { networkGroupId: null as any });
      const fp3 = getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      expect(fp1).not.toBe(fp2);
      expect(fp2).not.toBe(fp3);
      expect(fp1).not.toBe(fp3);
    });

    it('string delimiter ambiguities are prevented', () => {
      // If we had two fields A="1", B="2" vs A="12", B="", they must produce different fingerprints
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);

      store.updateEquipment('test-inst-1', { name: 'A', networkGroupId: 'B' });
      const fp1 = getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      store.updateEquipment('test-inst-1', { name: 'AB', networkGroupId: '' });
      const fp2 = getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      expect(fp1).not.toBe(fp2);
    });

    it('identical canonical input produces identical fingerprint', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      getHeadRevision('PLAN', store.activePlanId!)!.canonicalFingerprint;

      // Create a brand new workspace with the exported package
      const pkg = store.exportCanonicalPackage();

      useTacticalStore.setState({
        scenarios: {}, plans: {}, placements: {}, definitions: {}, observations: {},
        simulationRuns: {}, simulations: {},
        revisions: {}, revisionHeads: {}, auditEvents: {}, auditEventOrder: [],
        activeScenarioId: null, activePlanId: null
      });

      getStore().importCanonicalPackage(pkg);
      // We check WORKSPACE fingerprint consistency
      const fpWorkspace = getHeadRevision('WORKSPACE', 'canonical-root')!.canonicalFingerprint;

      // Import again
      useTacticalStore.setState({
        scenarios: {}, plans: {}, placements: {}, definitions: {}, observations: {},
        simulationRuns: {}, simulations: {},
        revisions: {}, revisionHeads: {}, auditEvents: {}, auditEventOrder: [],
        activeScenarioId: null, activePlanId: null
      });
      getStore().importCanonicalPackage(pkg);
      const fpWorkspace2 = getHeadRevision('WORKSPACE', 'canonical-root')!.canonicalFingerprint;

      expect(fpWorkspace).toBe(fpWorkspace2);
    });
  });

  describe('2. SCENARIO REVISION SEMANTICS', () => {
    it('rejects SCENARIO revision creation', async () => {
      const { createAuditAppend } = await import('./auditEngine');
      expect(() => {
        createAuditAppend(
          { type: 'SCENARIO', id: 'scen-1' },
          {},
          {},
          {},
          {},
          'ADD',
          'EQUIPMENT',
          ['eq-1'],
          { type: 'HUMAN' },
          'USER_ACTION'
        );
      }).toThrow('SCENARIO revision creation is unsupported in 1I');
    });
  });

  describe('3. UNIFY SCOPE KEY', () => {
    it('PLAN and WORKSPACE scopes with same ID are isolated in auditEngine', async () => {
      const { createAuditAppend } = await import('./auditEngine');

      const heads = { 'WORKSPACE:canonical-root': 'rev-w1', 'PLAN:canonical-root': 'rev-p1' };
      const revisions = {
        'rev-w1': { revisionId: 'rev-w1', sequence: 1, canonicalFingerprint: 'A' } as any,
        'rev-p1': { revisionId: 'rev-p1', sequence: 1, canonicalFingerprint: 'B' } as any
      };

      const mockPrev = { scenarios: {}, plans: { 'canonical-root': { id: 'canonical-root' } as any }, placements: {}, definitions: {}, observations: {}, simulationRuns: {}, simulations: {}, activePlanId: 'canonical-root' };
      const mockNext = { ...mockPrev, placements: { 'eq': { id: 'eq', planId: 'canonical-root', name: 'A' } } as any };

      const resultW = createAuditAppend(
        { type: 'WORKSPACE', id: 'canonical-root' }, mockPrev, mockNext, revisions, heads,
        'IMPORT', 'WORKSPACE', ['canonical-root'], { type: 'HUMAN' }, 'USER_ACTION'
      );

      const resultP = createAuditAppend(
        { type: 'PLAN', id: 'canonical-root' }, mockPrev, mockNext, revisions, heads,
        'ADD', 'EQUIPMENT', ['eq'], { type: 'HUMAN' }, 'USER_ACTION'
      );

      expect(resultW!.revision.parentRevisionId).toBe('rev-w1');
      expect(resultP!.revision.parentRevisionId).toBe('rev-p1');
    });
  });

  describe('4. STRENGTHEN EXECUTABLE TESTS', () => {
    it('ADD, UPDATE, REMOVE, CLEAR audit counts', () => {
      const store = getStore();
      let auditCount = getAuditSize();

      store.addEquipment(TEST_INSTANCE);
      expect(getAuditSize()).toBe(auditCount + 1);
      auditCount = getAuditSize();

      store.updateEquipment('test-inst-1', { rangeKm: 400 });
      expect(getAuditSize()).toBe(auditCount + 1);
      auditCount = getAuditSize();

      store.removeEquipment('test-inst-1');
      expect(getAuditSize()).toBe(auditCount + 1);
      auditCount = getAuditSize();

      store.addEquipment(TEST_INSTANCE);
      auditCount = getAuditSize();
      store.clearAll();
      expect(getAuditSize()).toBe(auditCount + 1);

      // Test clearAll on an already-empty plan
      auditCount = getAuditSize();
      store.clearAll();
      expect(getAuditSize()).toBe(auditCount); // No new audit events
    });

    it('BRANCH parent and derived-from linkage', () => {
      getStore().addEquipment(TEST_INSTANCE);
      const plan1 = getStore().activePlanId!;
      const rev1 = getHeadRevision('PLAN', plan1)!;

      getStore().createPlanAlternative();
      const plan2 = getStore().activePlanId!;
      const rev2 = getHeadRevision('PLAN', plan2)!;

      expect(rev2.parentRevisionId).toBeNull();
      expect(rev2.derivedFromRevisionId).toBe(rev1.revisionId);
    });

    it('importFromLayout uses PLAN scope', () => {
      const store = getStore();
      store.importFromLayout({
        name: 'Layout', version: 1, equipments: [
          { ...TEST_INSTANCE, instanceId: 'test-layout-1' } as any
        ]
      } as any);

      const rev = getHeadRevision('PLAN', store.activePlanId!);
      expect(rev).not.toBeNull();
      expect(rev!.source).toBe('IMPORT');
    });

    it('importCanonicalPackage uses WORKSPACE scope, no per-plan fanout', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      const pkg = store.exportCanonicalPackage();

      useTacticalStore.setState({
        scenarios: {}, plans: {}, placements: {}, definitions: {}, observations: {},
        simulationRuns: {}, simulations: {},
        revisions: {}, revisionHeads: {}, auditEvents: {}, auditEventOrder: [],
        activeScenarioId: null, activePlanId: null
      });

      getStore().importCanonicalPackage(pkg);
      const revWorkspace = getHeadRevision('WORKSPACE', 'canonical-root');
      expect(revWorkspace).not.toBeNull();

      // Verify no plan scoped revisions exist
      const heads = Object.keys(getStore().revisionHeads);
      expect(heads.length).toBe(1);
      expect(heads[0]).toBe('WORKSPACE:canonical-root');
    });

    it('existing records remain unchanged after later appends', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      const rev1 = { ...getHeadRevision('PLAN', store.activePlanId!)! };

      store.updateEquipment('test-inst-1', { rangeKm: 400 });
      const rev1Later = getStore().revisions[rev1.revisionId];

      expect(rev1Later).toEqual(rev1);
    });

    it('failed mutation produces no audit/revision', () => {
      const store = getStore();
      const count = getAuditSize();
      try {
        store.updateEquipment('non-existent', { rangeKm: 400 });
      } catch {}
      expect(getAuditSize()).toBe(count);
    });

    it('historical SimulationState remains unchanged after import', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);

      useTacticalStore.setState({
        simulations: {
          'orphan-run': { 'orphan-inst': { state: 'moving' } as any }
        }
      });

      const pkg = store.exportCanonicalPackage();
      getStore().importCanonicalPackage(pkg);
      expect((getStore().simulations['orphan-run']['orphan-inst'] as any).state).toBe('moving');
    });

    it('one Zustand subscriber notification contains both new canonical state and corresponding audit/revision records', () => {
      const store = getStore();
      let subscriberCallCount = 0;
      let observedValid = false;

      const unsub = useTacticalStore.subscribe((state, prevState) => {
        if (state.placements['test-inst-1'] && !prevState.placements['test-inst-1']) {
          subscriberCallCount++;
          // When placement appears, audit must also appear in the exact same state snapshot
          const revId = state.revisionHeads[`PLAN:${state.activePlanId}`];
          const rev = state.revisions[revId];
          const eventId = state.auditEventOrder[state.auditEventOrder.length - 1];
          const event = state.auditEvents[eventId];

          if (
            revId &&
            rev &&
            event &&
            event.revisionId === revId &&
            state.placements['test-inst-1'] != null
          ) {
            observedValid = true;
          } else {
            console.log('Subscriber validation failed:', { revId, rev, eventId, event });
          }
        }
      });

      store.addEquipment(TEST_INSTANCE);
      unsub();

      expect(subscriberCallCount).toBe(1);
      expect(observedValid).toBe(true);
    });

    it('UI/instances changes produce no audit revision', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      const count = getAuditSize();

      useTacticalStore.setState({ selectedInstanceId: 'test-inst-1' });
      expect(getAuditSize()).toBe(count);
    });

    it('genuine no-op edit produces no audit revision', () => {
      const store = getStore();
      store.addEquipment(TEST_INSTANCE);
      const count = getAuditSize();

      // Update with exact same data
      store.updateEquipment('test-inst-1', { rangeKm: 300 });
      expect(getAuditSize()).toBe(count);
    });
  });
});
