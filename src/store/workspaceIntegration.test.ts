import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useTacticalStore,
  selectActiveEquipment,
  selectScenarios,
  selectPlansForActiveScenario,
  selectAllScenarios,
  selectAllPlansForActiveScenario,
  selectActiveScenario,
  selectActivePlan,
  validateMutationGuard,
  isScenarioEligibleForPurge,
} from './useTacticalStore';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';
import {
  validateCanonicalStatePackageV1,
  validateCanonicalStatePackageV2,
} from '../domain/serialization/canonicalStatePackage';
import * as vectorAiClient from '../services/vectorAiClient';

describe('Checkpoint 2A — Scenario and Plan Workspace Vertical Slice Integration', () => {
  beforeEach(() => {
    // Reset Zustand store state to pristine baseline before the test
    useTacticalStore.setState({
      scenarios: {},
      plans: {},
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      simulationRuns: {},
      auditEvents: {},
      auditEventOrder: [],
      revisions: {},
      revisionHeads: {},
      activeScenarioId: null,
      activePlanId: null,
      canonicalInitialized: false,
      selectedInstanceId: null,
      workspaceContextGeneration: 0,
      samEngagementModes: {},
      coverageVolumes: {},
      spxResults: {},
      samVolumes: {},
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle',
    });
  });

  it('executes full vertical slice: scenario/plan lifecycle, deterministic switching, context isolation, atomic read-only guards, async generation checks, and serialization round-trip', async () => {
    const store = useTacticalStore.getState();

    // =========================================================================
    // 1. SCENARIO CREATION & AUTOMATIC BASELINE PLAN INITIALIZATION
    // =========================================================================
    const initialGen = useTacticalStore.getState().workspaceContextGeneration;
    store.createScenario('Hanoi Air Defense 2026', 'Primary theater defense scenario');

    let state = useTacticalStore.getState();
    const activeScen = selectActiveScenario(state);
    const activePlan = selectActivePlan(state);
    const scenList = selectScenarios(state);
    const plansForScen = selectPlansForActiveScenario(state);

    expect(activeScen).toBeDefined();
    expect(activeScen?.name).toBe('Hanoi Air Defense 2026');
    expect(activeScen?.status).toBe('draft');
    expect(scenList.length).toBe(1);

    expect(activePlan).toBeDefined();
    expect(activePlan?.scenarioId).toBe(activeScen?.id);
    expect(activePlan?.status).toBe('draft');
    expect(activePlan?.version).toBe(1);
    expect(plansForScen.length).toBe(1);

    // Selector stability: successive calls on unchanged dependencies return identical array references
    expect(selectScenarios(state)).toBe(scenList);
    expect(selectPlansForActiveScenario(state)).toBe(plansForScen);
    useTacticalStore.setState({ selectedAltitudeM: 2500 });
    const stateAfterUnrelated = useTacticalStore.getState();
    expect(selectScenarios(stateAfterUnrelated)).toBe(scenList);
    expect(selectPlansForActiveScenario(stateAfterUnrelated)).toBe(plansForScen);

    // Context generation incremented
    expect(state.workspaceContextGeneration).toBe(initialGen + 1);

    // Audit trail recorded scenario addition
    expect(Object.values(state.auditEvents).some((e) => e.targetType === 'SCENARIO' && e.action === 'ADD')).toBe(true);

    const scenarioId1 = activeScen!.id;
    const baselinePlanId = activePlan!.id;

    // =========================================================================
    // 2. EQUIPMENT ADDITION TO DRAFT BASELINE PLAN
    // =========================================================================
    const tmplRadar = EQUIPMENT_TEMPLATES.find((t) => t.category === 'RadarCanhGioi') || EQUIPMENT_TEMPLATES[0];
    const radarInst = {
      instanceId: 'inst_radar_01',
      templateId: tmplRadar.id,
      name: 'Đài Radar Cảnh Giới 36D6',
      category: 'RadarCanhGioi',
      latitude: 21.0285,
      longitude: 105.8542,
      altitude: 120,
      rangeKm: tmplRadar.defaultRangeKm,
      status: 'Active',
      color: '#06b6d4',
      antennaHeightAGL: 15,
      showDome: true,
    } as any;

    store.addEquipment(radarInst);

    state = useTacticalStore.getState();
    let activeEquipment = selectActiveEquipment(state);
    expect(activeEquipment.length).toBe(1);
    expect(activeEquipment[0].name).toBe('Đài Radar Cảnh Giới 36D6');

    const placement1 = Object.values(state.placements).find((p) => p.planId === baselinePlanId);
    expect(placement1).toBeDefined();

    // User configures business data on placement (samEngagementModes) and sets selection
    useTacticalStore.setState({
      selectedInstanceId: radarInst.instanceId,
      samEngagementModes: { [placement1!.id]: 'tail_chase' },
    });
    expect(useTacticalStore.getState().selectedInstanceId).toBe(radarInst.instanceId);

    // =========================================================================
    // 3. PLAN ALTERNATIVE CREATION (CLONING & MONOTONIC VERSIONING)
    // =========================================================================
    const genBeforeAlt = useTacticalStore.getState().workspaceContextGeneration;
    // Note: store.createPlanAlternative returns void per verified API contract
    store.createPlanAlternative(baselinePlanId, 'Plan Alternative Bravo');

    state = useTacticalStore.getState();
    const altPlan = selectActivePlan(state);
    expect(altPlan).toBeDefined();
    expect(altPlan?.name).toBe('Plan Alternative Bravo');
    expect(altPlan?.version).toBe(2);
    expect(altPlan?.status).toBe('draft');
    expect(altPlan?.scenarioId).toBe(scenarioId1);
    expect(altPlan?.archivedAt).toBeUndefined();
    expect(altPlan?.archivedFromStatus).toBeUndefined();
    expect(altPlan?.withdrawnAt).toBeUndefined();
    expect(altPlan?.withdrawnReason).toBeUndefined();
    expect(altPlan?.trashedAt).toBeUndefined();

    // Selection must be reset to null on plan switch
    expect(state.selectedInstanceId).toBeNull();
    // Context generation incremented
    expect(state.workspaceContextGeneration).toBe(genBeforeAlt + 1);

    // Equipment from baseline plan must be cloned into new plan with separate placement IDs
    const altEquipment = selectActiveEquipment(state);
    expect(altEquipment.length).toBe(1);
    expect(altEquipment[0].name).toBe('Đài Radar Cảnh Giới 36D6');
    const placementAlt = Object.values(state.placements).find((p) => p.planId === altPlan!.id);
    expect(placementAlt).toBeDefined();
    expect(placementAlt!.id).not.toBe(placement1!.id);
    // Definition is cloned and owned by the alternative plan
    const defAlt = state.definitions[placementAlt!.definitionId];
    const def1 = state.definitions[placement1!.definitionId];
    expect(defAlt).toBeDefined();
    expect(defAlt.planId).toBe(altPlan!.id);
    expect(defAlt.templateId).toBe(def1.templateId);
    expect(defAlt.name).toBe(def1.name);

    // Add a second equipment (Missile S-125) ONLY to Alternative Bravo
    const tmplSam = EQUIPMENT_TEMPLATES.find((t) => t.category === 'TenLuaPhongKhong') || EQUIPMENT_TEMPLATES[1];
    const samInst = {
      instanceId: 'inst_sam_01',
      templateId: tmplSam.id,
      name: 'Tiểu đoàn Tên lửa S-125 Pechora',
      category: 'TenLuaPhongKhong',
      latitude: 21.0500,
      longitude: 105.8200,
      altitude: 80,
      rangeKm: tmplSam.defaultRangeKm,
      status: 'Active',
      color: '#f43f5e',
      antennaHeightAGL: 5,
      showDome: true,
    } as any;
    store.addEquipment(samInst);

    state = useTacticalStore.getState();
    expect(selectActiveEquipment(state).length).toBe(2);

    const altPlanId = altPlan!.id;

    // =========================================================================
    // 4. CONTEXT ISOLATION & SWITCHING A <-> B
    // =========================================================================
    // Populate transient caches to test purging
    useTacticalStore.setState({
      selectedInstanceId: samInst.instanceId,
      coverageVolumes: { dummy: {} as any },
      spxResults: { dummy: {} as any },
      samVolumes: { dummy: {} as any },
    });

    const genBeforeSwitch = useTacticalStore.getState().workspaceContextGeneration;
    store.switchActivePlan(baselinePlanId);

    state = useTacticalStore.getState();
    expect(state.activePlanId).toBe(baselinePlanId);
    // Baseline Plan still has strictly 1 equipment
    expect(selectActiveEquipment(state).length).toBe(1);
    expect(selectActiveEquipment(state)[0].instanceId).toBe(radarInst.instanceId);

    // Selection isolated
    expect(state.selectedInstanceId).toBeNull();
    // Transient caches purged
    expect(Object.keys(state.coverageVolumes).length).toBe(0);
    expect(Object.keys(state.spxResults).length).toBe(0);
    expect(Object.keys(state.samVolumes).length).toBe(0);
    // User configuration preserved across context switches
    expect(state.samEngagementModes[placement1!.id]).toBe('tail_chase');
    // Context generation incremented
    expect(state.workspaceContextGeneration).toBe(genBeforeSwitch + 1);

    // =========================================================================
    // 5. PLAN STATUS TRANSITION: PROPOSE & ATOMIC READ-ONLY GUARD
    // =========================================================================
    // Rename plan while in draft
    store.renamePlan(baselinePlanId, 'Baseline Hanoi Fortified');
    state = useTacticalStore.getState();
    expect(state.plans[baselinePlanId].name).toBe('Baseline Hanoi Fortified');

    // Propose plan
    store.proposePlan(baselinePlanId);
    state = useTacticalStore.getState();
    expect(state.plans[baselinePlanId].status).toBe('proposed');

    // Save snapshot of canonical state before rejected mutations
    const snapshotPlacements = { ...state.placements };
    const snapshotDefinitions = { ...state.definitions };
    const snapshotAuditLength = Object.keys(state.auditEvents).length;
    const snapshotRevisionsCount = Object.keys(state.revisions).length;

    // Invariant: Proposed plan rejects equipment mutations atomically
    expect(() => {
      store.addEquipment({
        instanceId: 'inst_illegal',
        templateId: tmplRadar.id,
        name: 'Illegal Equipment',
        category: 'RadarCanhGioi',
        latitude: 21.0,
        longitude: 105.0,
        altitude: 0,
        rangeKm: 50,
        status: 'Active',
        color: '#fff',
        showDome: false,
      } as any);
    }).toThrow('Active plan is not draft');

    // Verify atomic rejection: state, audit, and revision are completely unchanged
    let stateAfterReject = useTacticalStore.getState();
    expect(stateAfterReject.placements).toEqual(snapshotPlacements);
    expect(stateAfterReject.definitions).toEqual(snapshotDefinitions);
    expect(Object.keys(stateAfterReject.auditEvents).length).toBe(snapshotAuditLength);
    expect(Object.keys(stateAfterReject.revisions).length).toBe(snapshotRevisionsCount);

    // Invariant: Proposed plan cannot be renamed
    expect(() => {
      store.renamePlan(baselinePlanId, 'Illegal Rename Attempt');
    }).toThrow('renamePlan: Only draft plans can be renamed');
    expect(useTacticalStore.getState().plans[baselinePlanId].name).toBe('Baseline Hanoi Fortified');

    // Invariant: validateMutationGuard catches non-draft plan
    expect(() => validateMutationGuard(useTacticalStore.getState())).toThrow('Active plan is not draft');

    // =========================================================================
    // 6. CREATE EMPTY PLAN (BLANK SLATE)
    // =========================================================================
    store.createEmptyPlan('Plan Charlie Empty Slate');
    state = useTacticalStore.getState();
    const emptyPlan = selectActivePlan(state);
    expect(emptyPlan).toBeDefined();
    expect(emptyPlan?.name).toBe('Plan Charlie Empty Slate');
    expect(emptyPlan?.status).toBe('draft');
    expect(emptyPlan?.version).toBe(3); // Monotonic
    expect(selectActiveEquipment(state).length).toBe(0);

    // =========================================================================
    // 7. SCENARIO RENAMING & SECOND SCENARIO SWITCHING
    // =========================================================================
    store.renameScenario(scenarioId1, 'Capital Air Defense Command');
    expect(useTacticalStore.getState().scenarios[scenarioId1].name).toBe('Capital Air Defense Command');

    // Create a second scenario
    store.createScenario('Coastal Sector Hai Phong', 'Coastal defense corridor');
    state = useTacticalStore.getState();
    const scenario2 = selectActiveScenario(state);
    expect(scenario2).toBeDefined();
    expect(scenario2?.name).toBe('Coastal Sector Hai Phong');
    const scenarioId2 = scenario2!.id;

    // Switch back to Scenario 1 -> Deterministic Plan Selection
    // Scenario 1 has 3 plans: Baseline (v1, proposed), Bravo (v2, draft), Charlie (v3, draft).
    // Lowest version is Baseline (v1).
    store.switchScenario(scenarioId1);
    state = useTacticalStore.getState();
    expect(state.activeScenarioId).toBe(scenarioId1);
    expect(state.activePlanId).toBe(baselinePlanId);
    expect(selectActivePlan(state)?.version).toBe(1);

    // =========================================================================
    // 8. ARCHIVED SCENARIO GUARD (MUTATION BLOCKED ATOMICALY)
    // =========================================================================
    // Archive Scenario 2 using real store action
    store.archiveScenario(scenarioId2);

    store.switchScenario(scenarioId2);
    state = useTacticalStore.getState();
    expect(state.activeScenarioId).toBe(scenarioId2);
    expect(selectActiveScenario(state)?.status).toBe('archived');

    // Attempt mutation under archived scenario -> throws
    expect(() => {
      store.addEquipment({
        instanceId: 'inst_archived_fail',
        templateId: tmplRadar.id,
        name: 'Should Fail',
        category: 'RadarCanhGioi',
        latitude: 20.8,
        longitude: 106.6,
        altitude: 0,
        rangeKm: 50,
        status: 'Active',
        color: '#fff',
        showDome: false,
      } as any);
    }).toThrow('Scenario is archived');

    // Rename archived scenario -> throws
    expect(() => {
      store.renameScenario(scenarioId2, 'Cannot Rename Archived');
    }).toThrow('renameScenario: Cannot rename archived scenario');

    // Invariant: renamePlan and proposePlan on archived scenario must be rejected atomically
    const planInScen2 = Object.values(state.plans).find((p) => p.scenarioId === scenarioId2);
    expect(planInScen2).toBeDefined();
    const planInScen2Id = planInScen2!.id;
    const planInScen2Name = planInScen2!.name;

    const snapPlacementsArchived = { ...state.placements };
    const snapDefinitionsArchived = { ...state.definitions };
    const snapPlansArchived = { ...state.plans };
    const snapAuditCountArchived = Object.keys(state.auditEvents).length;
    const snapRevisionsCountArchived = Object.keys(state.revisions).length;

    expect(() => {
      store.renamePlan(planInScen2Id, 'Attempted Rename in Archived');
    }).toThrow('renamePlan: Scenario is archived');

    expect(() => {
      store.proposePlan(planInScen2Id);
    }).toThrow('proposePlan: Scenario is archived');

    // Verify atomicity: zero mutation to plans, placements, definitions, audits, or revisions
    const stateAfterArchivedRejects = useTacticalStore.getState();
    expect(stateAfterArchivedRejects.plans[planInScen2Id].name).toBe(planInScen2Name);
    expect(stateAfterArchivedRejects.plans[planInScen2Id].status).toBe(planInScen2!.status);
    expect(stateAfterArchivedRejects.plans).toEqual(snapPlansArchived);
    expect(stateAfterArchivedRejects.placements).toEqual(snapPlacementsArchived);
    expect(stateAfterArchivedRejects.definitions).toEqual(snapDefinitionsArchived);
    expect(Object.keys(stateAfterArchivedRejects.auditEvents).length).toBe(snapAuditCountArchived);
    expect(Object.keys(stateAfterArchivedRejects.revisions).length).toBe(snapRevisionsCountArchived);

    // =========================================================================
    // 9. ASYNC STALE RESULT ISOLATION (A -> B -> A REAL PRODUCT ACTION VALIDATION)
    // =========================================================================
    // Switch to Scenario 1, Plan Bravo (Plan A)
    store.switchScenario(scenarioId1);
    store.switchActivePlan(altPlanId);
    state = useTacticalStore.getState();

    const planAGeneration = state.workspaceContextGeneration;
    expect(state.activeScenarioId).toBe(scenarioId1);
    expect(state.activePlanId).toBe(altPlanId);

    // Mock vectorAiClient service to control async flow of runAiPlacementAnalysis
    const checkSpy = vi.spyOn(vectorAiClient, 'checkVectorAiHealth').mockResolvedValue({
      ok: true,
      value: { status: 'ready', models: ['mock-vector-model'] },
    } as any);

    // Deferred promise representing in-flight model response from askVectorAi
    let resolveStaleAsk!: (val: any) => void;
    const staleAskPromise = new Promise<any>((resolve) => {
      resolveStaleAsk = resolve;
    });

    let markAsked!: () => void;
    const askedPromise = new Promise<void>((resolve) => {
      markAsked = resolve;
    });

    const askSpy = vi.spyOn(vectorAiClient, 'askVectorAi').mockImplementationOnce(() => {
      markAsked();
      return staleAskPromise;
    });

    try {
      // 1. Khởi động async request thật sự qua action của Store tại Plan A
      const inFlightAnalysis = store.runAiPlacementAnalysis('mock-vector-model');

      // Chờ cho request tiến tới bước gọi askVectorAi (vượt qua health check)
      await askedPromise;
      expect(useTacticalStore.getState().aiAdvisorStatus).toBe('thinking');
      expect(askSpy).toHaveBeenCalledTimes(1);

      // 2. Trong khi request đang bay, người dùng chuyển đổi: Plan A -> Plan B -> Plan A
      store.switchActivePlan(emptyPlan!.id);
      expect(useTacticalStore.getState().aiAdvisorStatus).toBe('idle');
      expect(useTacticalStore.getState().aiAdvisorSuggestions).toEqual([]);

      store.switchActivePlan(altPlanId);
      expect(useTacticalStore.getState().aiAdvisorStatus).toBe('idle');
      expect(useTacticalStore.getState().aiAdvisorSuggestions).toEqual([]);

      const stateAfterSwitchBack = useTacticalStore.getState();
      expect(stateAfterSwitchBack.activePlanId).toBe(altPlanId);
      expect(stateAfterSwitchBack.activeScenarioId).toBe(scenarioId1);
      // Generation đã tăng đơn điệu dù planId và scenarioId trùng khớp
      expect(stateAfterSwitchBack.workspaceContextGeneration).toBeGreaterThan(planAGeneration);

      // 3. Resolve response cũ từ lượt chạy trước với payload gợi ý hợp lệ
      resolveStaleAsk({
        ok: true,
        value: {
          runId: 'stale_run_123',
          text: JSON.stringify({
            summary: 'Gợi ý cũ lẽ ra bị chặn',
            suggestions: [
              {
                lat: 21.05,
                lon: 105.88,
                role: 'main',
                rationaleVi: 'Vị trí cũ lẽ ra không được ghi vào active context',
              },
            ],
            route: [],
          }),
        },
      });

      // Chờ hoàn thành promise của lượt chạy cũ
      await inFlightAnalysis;

      // 4. Assert: kết quả cũ BỊ CHẶN HOÀN TOÀN — không cập nhật aiAdvisorSuggestions, status hoặc summary của active context
      const statePostStaleResolve = useTacticalStore.getState();
      expect(statePostStaleResolve.aiAdvisorSuggestions).toEqual([]);
      expect(statePostStaleResolve.aiAdvisorStatus).toBe('idle');
      expect(statePostStaleResolve.aiAdvisorSummary).toBe('');

      // 5. Kiểm chứng đối ứng: lượt gọi hợp lệ trong đúng ngữ cảnh hiện tại ĐƯỢC CHẤP NHẬN
      askSpy.mockImplementationOnce(async () => ({
        ok: true,
        value: {
          runId: 'valid_run_456',
          text: JSON.stringify({
            summary: 'Gợi ý hợp lệ trong đúng ngữ cảnh hiện tại',
            suggestions: [
              {
                lat: 21.03,
                lon: 105.85,
                score: 95,
                reason: 'Vị trí hợp lệ được chấp nhận',
              },
            ],
            route: [],
          }),
        },
      }));

      await store.runAiPlacementAnalysis('mock-vector-model');

      const stateValidContext = useTacticalStore.getState();
      expect(stateValidContext.aiAdvisorStatus).toBe('ready');
      expect(stateValidContext.aiAdvisorSummary).toBe('Gợi ý hợp lệ trong đúng ngữ cảnh hiện tại');
      expect(stateValidContext.aiAdvisorSuggestions.length).toBe(1);
      expect(stateValidContext.aiAdvisorSuggestions[0].reason).toBe('Vị trí hợp lệ được chấp nhận');

      // Chuyển phương án dọn sạch dữ liệu AI Advisor
      store.switchActivePlan(emptyPlan!.id);
      expect(useTacticalStore.getState().aiAdvisorSuggestions).toEqual([]);
      expect(useTacticalStore.getState().aiAdvisorStatus).toBe('idle');
      store.switchActivePlan(altPlanId);
    } finally {
      checkSpy.mockRestore();
      askSpy.mockRestore();
    }

    // =========================================================================
    // 10. CANONICAL STATE PACKAGE (SCHEMA V1 - 11 FIELDS) ROUND-TRIP
    // =========================================================================
    const pkg = store.exportCanonicalPackage();
    expect(pkg.schemaVersion).toBe(1);

    // Verify all 11 required fields of CanonicalStatePackageV1
    const requiredFields = [
      'schemaVersion',
      'metadata',
      'context',
      'scenarios',
      'plans',
      'definitions',
      'placements',
      'observations',
      'visuals',
      'simulationRuns',
      'simulations',
    ];
    for (const field of requiredFields) {
      expect(pkg).toHaveProperty(field);
    }
    expect(() => validateCanonicalStatePackageV1(pkg)).not.toThrow();

    expect(Object.keys(pkg.plans).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(pkg.placements).length).toBeGreaterThanOrEqual(2);

    // Reset store
    useTacticalStore.setState({
      scenarios: {},
      plans: {},
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      auditEvents: {},
      auditEventOrder: [],
      revisions: {},
      revisionHeads: {},
      activeScenarioId: null,
      activePlanId: null,
      selectedInstanceId: 'dummy_selection',
    });

    // Pre-populate transient caches and samEngagementModes to verify import invalidation
    useTacticalStore.setState({
      coverageVolumes: { stale_vol: {} as any },
      spxResults: { stale_spx: {} as any },
      samVolumes: { stale_sam: {} as any },
      coverageResults: { stale_cov: {} as any },
      coverageFields: { stale_fld: {} as any },
      aiAdvisorSuggestions: [{ id: 'stale_sug' } as any],
      samEngagementModes: { 'preserved_mode_01': 'tail_chase' },
    });

    const genBeforeImport = useTacticalStore.getState().workspaceContextGeneration;
    store.importCanonicalPackage(pkg);

    const restoredState = useTacticalStore.getState();
    expect(restoredState.scenarios[scenarioId1]).toBeDefined();
    expect(restoredState.plans[baselinePlanId]).toBeDefined();
    expect(restoredState.plans[altPlanId]).toBeDefined();
    expect(restoredState.selectedInstanceId).toBeNull();
    expect(restoredState.workspaceContextGeneration).toBe(genBeforeImport + 1);

    // Verify transient calculation caches and AI advisor are invalidated upon import
    expect(restoredState.coverageVolumes).toEqual({});
    expect(restoredState.spxResults).toEqual({});
    expect(restoredState.samVolumes).toEqual({});
    expect(restoredState.coverageResults).toEqual({});
    expect(restoredState.coverageFields).toEqual({});
    expect(restoredState.aiAdvisorSuggestions).toEqual([]);

    // Verify canonical business configuration (samEngagementModes) is preserved
    expect(restoredState.samEngagementModes['preserved_mode_01']).toBe('tail_chase');

    // Audit trail has IMPORT event
    expect(Object.values(restoredState.auditEvents).some((e) => e.action === 'IMPORT')).toBe(true);

    // =========================================================================
    // 11. SCENARIO LIFECYCLE: ARCHIVE, RESTORE, TRASH, AND RESTORE
    // =========================================================================
    // 11.1 Restore Scenario 2 from archive
    expect(useTacticalStore.getState().scenarios[scenarioId2].status).toBe('archived');
    store.restoreScenario(scenarioId2);
    expect(useTacticalStore.getState().scenarios[scenarioId2].status).toBe('active');
    expect(useTacticalStore.getState().scenarios[scenarioId2].archivedAt).toBeUndefined();
    // Audit recorded RESTORE
    expect(
      Object.values(useTacticalStore.getState().auditEvents).some(
        (e) => e.targetType === 'SCENARIO' && e.action === 'RESTORE' && e.targetIds.includes(scenarioId2)
      )
    ).toBe(true);

    // 11.2 Ineligible Trash check: Scenario with proposed/approved child plans cannot be trashed
    expect(() => {
      store.trashDraftScenario(scenarioId1); // Scenario 1 has baseline proposed plan
    }).toThrow('trashDraftScenario: Cannot trash scenario containing proposed or approved plans. Use archive instead.');

    // 11.3 Eligible Trash check: Draft scenario without proposed/approved plans can be moved to trash
    const cleanScenId = store.createScenario('Clean Draft Sector', 'v1');
    expect(selectScenarios(useTacticalStore.getState()).some((s) => s.id === cleanScenId)).toBe(true);

    store.trashDraftScenario(cleanScenId);
    const stateAfterTrashScen = useTacticalStore.getState();
    expect(stateAfterTrashScen.scenarios[cleanScenId].status).toBe('trashed');
    expect(stateAfterTrashScen.scenarios[cleanScenId].trashedAt).toBeDefined();
    // Normal selector omits trashed scenario by default
    expect(selectScenarios(stateAfterTrashScen).some((s) => s.id === cleanScenId)).toBe(false);
    // Cannot switch to trashed scenario
    expect(() => store.switchScenario(cleanScenId)).toThrow('switchScenario: Cannot switch to trashed scenario');

    // 11.4 Restore draft scenario from trash
    store.restoreDraftScenario(cleanScenId);
    const stateAfterRestoreScen = useTacticalStore.getState();
    expect(stateAfterRestoreScen.scenarios[cleanScenId].status).toBe('draft');
    expect(selectScenarios(stateAfterRestoreScen).some((s) => s.id === cleanScenId)).toBe(true);

    // =========================================================================
    // 12. PLAN ALTERNATIVE VS REVISION IDENTITY & WITHDRAW AND REVISE (THU HỒI ĐỂ SỬA)
    // =========================================================================
    // Switch to Scenario 1
    store.switchScenario(scenarioId1);
    const stateInScen1 = useTacticalStore.getState();

    // Baseline Plan was proposed in Phase 3
    const proposedBaseline = stateInScen1.plans[baselinePlanId];
    expect(proposedBaseline.status).toBe('proposed');
    expect(proposedBaseline.version).toBe(1);
    expect(proposedBaseline.revisionNumber).toBe(1);
    expect(proposedBaseline.alternativeId).toBe(baselinePlanId);

    // Placements count in proposed baseline: exactly 1 (radar)
    const baselinePlacements = Object.values(stateInScen1.placements).filter(
      (p) => p.planId === baselinePlanId
    );
    expect(baselinePlacements.length).toBe(1);

    // 12.1 Rejection without reason
    expect(() => {
      store.withdrawAndReviseProposedPlan(baselinePlanId, '   ');
    }).toThrow('withdrawAndReviseProposedPlan: Reason is required to withdraw a proposal');

    // 12.2 Successful Withdraw and Revise with reason
    const withdrawalReason = 'Bổ sung trận địa pháo phòng không ZU-23 bị sót sau thẩm định';
    const revisedPlanId = store.withdrawAndReviseProposedPlan(baselinePlanId, withdrawalReason);
    expect(revisedPlanId).toBeDefined();
    expect(revisedPlanId).not.toBe(baselinePlanId);

    const statePostWithdraw = useTacticalStore.getState();

    // Prior submitted snapshot is frozen as 'withdrawn' and completely unmodified
    const withdrawnSnapshot = statePostWithdraw.plans[baselinePlanId];
    expect(withdrawnSnapshot.status).toBe('withdrawn');
    expect(withdrawnSnapshot.withdrawnReason).toBe(withdrawalReason);
    expect(withdrawnSnapshot.withdrawnAt).toBeDefined();
    expect(
      Object.values(statePostWithdraw.placements).filter((p) => p.planId === baselinePlanId).length
    ).toBe(1);

    // Active context automatically switched to the new editable draft revision of the SAME alternative
    expect(statePostWithdraw.activePlanId).toBe(revisedPlanId);
    const newRevisionPlan = statePostWithdraw.plans[revisedPlanId];
    expect(newRevisionPlan.status).toBe('draft');
    expect(newRevisionPlan.version).toBe(1); // SAME candidate version (Alternative A)
    expect(newRevisionPlan.alternativeId).toBe(baselinePlanId); // SAME alternative identity
    expect(newRevisionPlan.revisionNumber).toBe(2); // Monotonic revision number incremented
    expect(newRevisionPlan.baseRevisionPlanId).toBe(baselinePlanId); // Provenance link to previous submission

    // Placements cloned into new revision
    const revisedPlacements = Object.values(statePostWithdraw.placements).filter(
      (p) => p.planId === revisedPlanId
    );
    expect(revisedPlacements.length).toBe(1);

    // 12.3 Contrast with Plan Alternative (e.g. altPlanId created via createPlanAlternative)
    const alternativePlan = statePostWithdraw.plans[altPlanId];
    expect(alternativePlan.version).toBe(2); // DIFFERENT candidate version (Alternative B)
    expect(alternativePlan.alternativeId).toBe(altPlanId); // DIFFERENT alternative identity
    expect(alternativePlan.revisionNumber).toBe(1);

    // 12.4 Add missing equipment to the new draft revision
    const tmplPhao = EQUIPMENT_TEMPLATES.find((t) => t.category === 'PhaoPhongKhong') || tmplRadar;
    store.addEquipment({
      instanceId: 'inst_phao_supplement',
      templateId: tmplPhao.id,
      name: 'Đại Đội Pháo Cao Xạ ZU-23-2',
      category: 'PhaoPhongKhong',
      latitude: 21.08,
      longitude: 105.82,
      altitude: 10,
      rangeKm: 2.5,
      status: 'Active',
      color: '#fbbf24',
      showDome: false,
    } as any);

    const stateWithSupplement = useTacticalStore.getState();
    const placementsInRevised = Object.values(stateWithSupplement.placements).filter(
      (p) => p.planId === revisedPlanId
    );
    expect(placementsInRevised.length).toBe(2); // 1 original cloned + 1 supplement = 2!

    // Immutable snapshot remains exactly 1 equipment: ZERO leakage
    const placementsInWithdrawn = Object.values(stateWithSupplement.placements).filter(
      (p) => p.planId === baselinePlanId
    );
    expect(placementsInWithdrawn.length).toBe(1);

    // 12.5 Resubmit (propose) the revised plan
    store.proposePlan(revisedPlanId);
    const statePostResubmit = useTacticalStore.getState();
    expect(statePostResubmit.plans[revisedPlanId].status).toBe('proposed');

    // Atomic rejection: cannot edit resubmitted proposal directly
    expect(() => {
      validateMutationGuard(statePostResubmit);
    }).toThrow('Active plan is not draft');

    // Atomic rejection: cannot switch to withdrawn snapshot as activePlanId
    expect(() => {
      store.switchActivePlan(baselinePlanId);
    }).toThrow('switchActivePlan: Cannot select withdrawn plan');

    // Active plan remains revised plan
    expect(useTacticalStore.getState().activePlanId).toBe(revisedPlanId);

    // =========================================================================
    // 13. DRAFT PLAN SOFT DELETE (TRASH) AND RESTORE
    // =========================================================================
    const draftPlanToDelete = store.createEmptyPlan('Temporary Staging Plan');
    expect(selectPlansForActiveScenario(useTacticalStore.getState()).some((p) => p.id === draftPlanToDelete)).toBe(true);

    // Trash draft plan
    store.trashDraftPlan(draftPlanToDelete);
    const statePostTrashPlan = useTacticalStore.getState();
    expect(statePostTrashPlan.plans[draftPlanToDelete].status).toBe('trashed');
    expect(statePostTrashPlan.plans[draftPlanToDelete].trashedAt).toBeDefined();

    // Selector omits trashed plan from normal active list
    expect(selectPlansForActiveScenario(statePostTrashPlan).some((p) => p.id === draftPlanToDelete)).toBe(false);

    // Cannot switch to trashed plan
    expect(() => store.switchActivePlan(draftPlanToDelete)).toThrow('switchActivePlan: Cannot select trashed plan');

    // Restore draft plan
    store.restoreDraftPlan(draftPlanToDelete);
    const statePostRestorePlan = useTacticalStore.getState();
    expect(statePostRestorePlan.plans[draftPlanToDelete].status).toBe('draft');
    expect(selectPlansForActiveScenario(statePostRestorePlan).some((p) => p.id === draftPlanToDelete)).toBe(true);

    // =========================================================================
    // 14. HISTORICAL OBSERVATIONS AND SIMULATIONS RETENTION
    // =========================================================================
    // Observations for placements in baseline, revised, and alt plans are all retained
    const allObservations = useTacticalStore.getState().observations;
    expect(Object.keys(allObservations).length).toBeGreaterThanOrEqual(5);
    for (const pl of Object.values(useTacticalStore.getState().placements)) {
      expect(allObservations[pl.id]).toBeDefined();
    }

    // =========================================================================
    // 15. LOSSLESS CANONICAL PACKAGE V2 ROUND-TRIP & POLYMORPHIC V1 MIGRATION
    // =========================================================================
    // 15.1 Export V2 lossless package
    const pkgV2 = store.exportCanonicalPackageV2('Checkpoint 2A Full Lossless Package');
    expect(pkgV2.schemaVersion).toBe(2);
    expect(pkgV2.revisions).toBeDefined();
    expect(pkgV2.revisionHeads).toBeDefined();
    expect(pkgV2.auditEvents).toBeDefined();
    expect(pkgV2.auditEventOrder).toBeDefined();
    expect(pkgV2.auditEventOrder.length).toBeGreaterThan(0);
    expect(() => validateCanonicalStatePackageV2(pkgV2)).not.toThrow();

    // Verify V2 package retains withdrawal records and revision lineage
    expect(pkgV2.plans[baselinePlanId].status).toBe('withdrawn');
    expect(pkgV2.plans[baselinePlanId].withdrawnReason).toBe(withdrawalReason);
    expect(pkgV2.plans[revisedPlanId].revisionNumber).toBe(2);
    expect(pkgV2.plans[revisedPlanId].baseRevisionPlanId).toBe(baselinePlanId);

    // 15.2 Reset and import V2 package
    useTacticalStore.setState({
      scenarios: {},
      plans: {},
      placements: {},
      definitions: {},
      observations: {},
      visuals: {},
      auditEvents: {},
      auditEventOrder: [],
      revisions: {},
      revisionHeads: {},
      activeScenarioId: null,
      activePlanId: null,
    });

    store.importCanonicalPackage(pkgV2);
    const restoredV2State = useTacticalStore.getState();

    // Full history restored losslessly
    expect(restoredV2State.plans[baselinePlanId].status).toBe('withdrawn');
    expect(restoredV2State.plans[baselinePlanId].withdrawnReason).toBe(withdrawalReason);
    expect(restoredV2State.plans[revisedPlanId].revisionNumber).toBe(2);
    expect(restoredV2State.plans[revisedPlanId].baseRevisionPlanId).toBe(baselinePlanId);

    // Exact ID-level verification of imported audit events, revisions and heads
    for (const [eventId, expectedEvt] of Object.entries(pkgV2.auditEvents)) {
      expect(restoredV2State.auditEvents[eventId]).toEqual(expectedEvt);
    }
    for (const [revId, expectedRev] of Object.entries(pkgV2.revisions)) {
      expect(restoredV2State.revisions[revId]).toEqual(expectedRev);
    }
    for (const [scopeKey, expectedHead] of Object.entries(pkgV2.revisionHeads)) {
      if (scopeKey !== 'WORKSPACE:canonical-root') {
        expect(restoredV2State.revisionHeads[scopeKey]).toBe(expectedHead);
      }
    }
    // Audit order preserves loaded history identically, with clean IMPORT event appended at end
    expect(restoredV2State.auditEventOrder.slice(0, pkgV2.auditEventOrder.length)).toEqual(pkgV2.auditEventOrder);
    expect(restoredV2State.auditEventOrder.length).toBe(pkgV2.auditEventOrder.length + 1);
    const importEventId = restoredV2State.auditEventOrder[pkgV2.auditEventOrder.length];
    expect(restoredV2State.auditEvents[importEventId].action).toBe('IMPORT');

    // 15.3 Polymorphic backward compatibility: V1 package import still succeeds seamlessly
    store.importCanonicalPackage(pkg); // pkg is V1 from Phase 10
    const statePostV1Import = useTacticalStore.getState();
    expect(statePostV1Import.canonicalInitialized).toBe(true);
    expect(statePostV1Import.scenarios[scenarioId1]).toBeDefined();
    // V1 import does not fabricate synthetic past plan history
    expect(statePostV1Import.revisionHeads[`PLAN:${baselinePlanId}`]).toBeUndefined();

    // =========================================================================
    // 16. TARGETED LIFECYCLE EXTENSIONS (ZUSTAND SELECTOR STABILITY, PLAN ARCHIVE, CONTEXT HYGIENE)
    // =========================================================================

    // 16.1 Zustand Selector Stability (Reference equality on unrelated state changes)
    const curScenariosRef1 = selectAllScenarios(useTacticalStore.getState());
    const curPlansRef1 = selectAllPlansForActiveScenario(useTacticalStore.getState());

    // Unrelated store state mutation (e.g. modal toggle / camera / tools)
    store.setShowWorkspaceModal(true);
    const stateAfterModalToggle = useTacticalStore.getState();

    const curScenariosRef2 = selectAllScenarios(stateAfterModalToggle);
    const curPlansRef2 = selectAllPlansForActiveScenario(stateAfterModalToggle);

    expect(curScenariosRef2).toBe(curScenariosRef1);
    expect(curPlansRef2).toBe(curPlansRef1);

    // 16.2 Withdrawn History Isolation: Scenario 1 contains withdrawn plan -> trash is rejected
    // Re-import V2 package to restore Scenario 1 with withdrawn baseline
    store.importCanonicalPackage(pkgV2);
    expect(() => {
      store.trashDraftScenario(scenarioId1);
    }).toThrow('trashDraftScenario: Cannot trash scenario containing proposed or approved plans. Use archive instead.');

    // 16.3 Plan Archive Contract & Context Hygiene
    // Create a new draft plan to verify plan archive
    const planForArchiveId = store.createEmptyPlan('Phương án Thử Nghiệm Lưu Trữ');
    expect(useTacticalStore.getState().activePlanId).toBe(planForArchiveId);

    // Set dirty interactive state (measurement mode, pending template, equipment selection)
    useTacticalStore.setState({
      activeTool: 'measure',
      pendingTemplate: tmplRadar,
      selectedInstanceId: 'inst_radar_01',
    });

    // Archive the active plan
    store.archivePlan(planForArchiveId);
    const statePostArchivePlan = useTacticalStore.getState();

    expect(statePostArchivePlan.plans[planForArchiveId].status).toBe('archived');
    expect(statePostArchivePlan.plans[planForArchiveId].archivedAt).toBeDefined();
    expect(statePostArchivePlan.plans[planForArchiveId].archivedFromStatus).toBe('draft');

    // Context hygiene: activeTool, pendingTemplate and selection must be cleanly reset
    expect(statePostArchivePlan.activeTool).toBe('select');
    expect(statePostArchivePlan.pendingTemplate).toBeNull();
    expect(statePostArchivePlan.selectedInstanceId).toBeNull();

    // Archived plan is excluded from active plan switcher selector
    expect(selectPlansForActiveScenario(statePostArchivePlan).some((p) => p.id === planForArchiveId)).toBe(false);

    // Cannot switch to archived plan
    expect(() => {
      store.switchActivePlan(planForArchiveId);
    }).toThrow('switchActivePlan: Cannot select archived plan');

    // Audit trail records ARCHIVE event for plan
    expect(
      Object.values(statePostArchivePlan.auditEvents).some(
        (e) => e.action === 'ARCHIVE' && e.targetIds.includes(planForArchiveId)
      )
    ).toBe(true);

    // Restore archived plan
    store.restorePlan(planForArchiveId);
    const statePostRestorePlanAgain = useTacticalStore.getState();
    expect(statePostRestorePlanAgain.plans[planForArchiveId].status).toBe('draft');
    expect(statePostRestorePlanAgain.plans[planForArchiveId].archivedAt).toBeUndefined();
    expect(statePostRestorePlanAgain.plans[planForArchiveId].archivedFromStatus).toBeUndefined();
    expect(selectPlansForActiveScenario(statePostRestorePlanAgain).some((p) => p.id === planForArchiveId)).toBe(true);

    // Audit trail records RESTORE event for plan
    expect(
      Object.values(statePostRestorePlanAgain.auditEvents).some(
        (e) => e.action === 'RESTORE' && e.targetIds.includes(planForArchiveId)
      )
    ).toBe(true);

    // 16.4 P1-A: switchScenario ignores archived plans and falls back deterministically (or null)
    const scenSwitchTestId = store.createScenario('Kịch bản Kiểm thử Switch Scenario');
    const scenSwitchBaselinePlanId = useTacticalStore.getState().activePlanId!;
    expect(scenSwitchBaselinePlanId).toBeDefined();

    // Archive the baseline plan so all plans in this scenario are archived
    store.archivePlan(scenSwitchBaselinePlanId);
    // Switch away to Scenario 1
    store.switchScenario(scenarioId1);
    // Switch back to the scenario whose only plan is archived
    store.switchScenario(scenSwitchTestId);
    expect(useTacticalStore.getState().activeScenarioId).toBe(scenSwitchTestId);
    expect(useTacticalStore.getState().activePlanId).toBeNull();

    // Create 2 plans in scenSwitchTestId: one archived, one valid draft
    const planArchivedId = store.createEmptyPlan('Phương án Lưu Trữ Test');
    const planValidDraftId = store.createEmptyPlan('Phương án Hợp Lệ Test');
    store.archivePlan(planArchivedId);

    // Switch away and switch back: should pick planValidDraftId deterministically, skipping planArchivedId
    store.switchScenario(scenarioId1);
    store.switchScenario(scenSwitchTestId);
    expect(useTacticalStore.getState().activePlanId).toBe(planValidDraftId);

    // 16.5 P1-B: restorePlan in an archived scenario is atomically rejected
    store.archiveScenario(scenSwitchTestId);
    expect(() => {
      store.restorePlan(planArchivedId);
    }).toThrow('restorePlan: Scenario is archived');
    // Verify atomic rejection: plan remains archived
    expect(useTacticalStore.getState().plans[planArchivedId].status).toBe('archived');

    // Restoring the parent scenario allows restorePlan to succeed
    store.restoreScenario(scenSwitchTestId);
    store.restorePlan(planArchivedId);
    expect(useTacticalStore.getState().plans[planArchivedId].status).toBe('draft');

    // 16.6 P1-C: Lifecycle transitions that change active context reset activeSimulationRunId
    const dummySimRunId = 'sim_run_lifecycle_test';
    useTacticalStore.setState((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [dummySimRunId]: {
          id: dummySimRunId,
          scenarioId: scenSwitchTestId,
          planId: scenSwitchBaselinePlanId,
          name: 'Simulation Run Test',
          runType: 'radar_coverage',
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        } as any,
      },
    }));

    // Test archivePlan resetting activeSimulationRunId
    store.switchActivePlan(planValidDraftId);
    useTacticalStore.setState({ activeSimulationRunId: dummySimRunId });
    expect(useTacticalStore.getState().activeSimulationRunId).toBe(dummySimRunId);
    store.archivePlan(planValidDraftId);
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();
    // Simulation registry remains intact
    expect(useTacticalStore.getState().simulationRuns[dummySimRunId]).toBeDefined();

    // Test trashDraftPlan resetting activeSimulationRunId
    store.restorePlan(planValidDraftId);
    store.switchActivePlan(planValidDraftId);
    useTacticalStore.setState({ activeSimulationRunId: dummySimRunId });
    store.trashDraftPlan(planValidDraftId);
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();
    expect(useTacticalStore.getState().simulationRuns[dummySimRunId]).toBeDefined();

    // Test trashDraftScenario resetting activeSimulationRunId
    const draftCleanScenForTrashId = store.createScenario('Clean Scenario For Trash Sim Test');
    store.switchScenario(draftCleanScenForTrashId);
    useTacticalStore.setState({ activeSimulationRunId: dummySimRunId });
    store.trashDraftScenario(draftCleanScenForTrashId);
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();
    expect(useTacticalStore.getState().simulationRuns[dummySimRunId]).toBeDefined();

    // =========================================================================
    // 17. CHECKPOINT 2A — SAFE TRASH CLEANUP & PERMANENT PURGE
    // =========================================================================

    // 17.1 (i) Eligible draft plan moved to trash -> purged -> gone from all registries and cannot be restored
    const purgeTestScenId = store.createScenario('Kịch bản Test Purge');
    const purgePlan2Id = store.createEmptyPlan('Phương án Purge 2 (Đủ điều kiện)');

    // Add equipment to purgePlan2 to verify payload deletion
    store.switchActivePlan(purgePlan2Id);
    store.addEquipment({
      instanceId: 'inst_purge_test_01',
      templateId: tmplRadar.id,
      name: 'Radar Purge Test',
      category: 'RadarCanhGioi',
      latitude: 21.05,
      longitude: 105.85,
      altitude: 10,
      rangeKm: tmplRadar.defaultRangeKm,
      status: 'Active',
      scanSpeed: 6,
      antennaHeightAGL: 10,
    } as any);
    expect(useTacticalStore.getState().placements['inst_purge_test_01']).toBeDefined();
    expect(useTacticalStore.getState().definitions['inst_purge_test_01']).toBeDefined();
    expect(useTacticalStore.getState().visuals['inst_purge_test_01']).toBeDefined();

    // Verify cannot purge while draft (not trashed)
    expect(() => {
      store.purgeTrashedPlan(purgePlan2Id);
    }).toThrow('Chỉ có thể xóa vĩnh viễn phương án đang trong Thùng rác');

    // Move to trash
    store.trashDraftPlan(purgePlan2Id);
    expect(useTacticalStore.getState().plans[purgePlan2Id].status).toBe('trashed');

    // Invariant: Cannot clone a trashed plan
    expect(() => {
      store.createPlanAlternative(purgePlan2Id);
    }).toThrow('createPlanAlternative: Cannot create alternative from trashed plan');

    // Pre-purge generation
    const genBeforePurge = useTacticalStore.getState().workspaceContextGeneration;

    // Execute purge
    store.purgeTrashedPlan(purgePlan2Id);

    // Assert plan and payload entities are completely deleted from domain state
    const statePostPurge = useTacticalStore.getState();
    expect(statePostPurge.plans[purgePlan2Id]).toBeUndefined();
    expect(statePostPurge.placements['inst_purge_test_01']).toBeUndefined();
    expect(statePostPurge.definitions['inst_purge_test_01']).toBeUndefined();
    expect(statePostPurge.visuals['inst_purge_test_01']).toBeUndefined();
    expect(statePostPurge.observations['inst_purge_test_01']).toBeUndefined();
    expect(statePostPurge.workspaceContextGeneration).toBe(genBeforePurge + 1);

    // Attempting to restore purged plan throws error
    expect(() => {
      store.restoreDraftPlan(purgePlan2Id);
    }).toThrow('restoreDraftPlan: Plan does not exist');

    // Audit trail recorded REMOVE action for PLAN
    expect(
      Object.values(statePostPurge.auditEvents).some(
        (e) => e.action === 'REMOVE' && e.targetType === 'PLAN' && e.targetIds.includes(purgePlan2Id)
      )
    ).toBe(true);

    // 17.2 (ii) Protected plan with simulation run or historical proposal is atomically rejected from purge
    // Test rejection: plan with simulation run
    const protectedSimPlanId = store.createEmptyPlan('Phương án Có Sim Run');
    const simRunProtectedId = 'sim_run_purge_protect';
    useTacticalStore.setState((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [simRunProtectedId]: {
          id: simRunProtectedId,
          scenarioId: purgeTestScenId,
          planId: protectedSimPlanId,
          name: 'Protected Run',
          runType: 'radar_coverage',
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        } as any,
      },
    }));
    // Try trashing (cannot trash directly due to run)
    expect(() => {
      store.trashDraftPlan(protectedSimPlanId);
    }).toThrow('Cannot trash plan referenced by simulation runs');

    // Test rejection: proposed & withdrawn plan (historical revision lineage)
    const proposedPlanId = store.createEmptyPlan('Phương án Proposed & Withdrawn');
    store.proposePlan(proposedPlanId);
    store.withdrawAndReviseProposedPlan(proposedPlanId, 'Lý do thu hồi test');
    expect(useTacticalStore.getState().plans[proposedPlanId].status).toBe('withdrawn');

    // Manually setting status to trashed to test store-level eligibility guard
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        [proposedPlanId]: {
          ...s.plans[proposedPlanId],
          status: 'trashed' as const,
        },
      },
    }));
    expect(() => {
      store.purgeTrashedPlan(proposedPlanId);
    }).toThrow('Phương án đã từng được đề xuất hoặc thu hồi trong lịch sử');
    // Verify atomic rejection: plan was NOT removed from store
    expect(useTacticalStore.getState().plans[proposedPlanId]).toBeDefined();

    // 17.3 (iii) Batch emptyTrash with mixed eligible and ineligible items
    const batchScenId = store.createScenario('Kịch bản Batch Clean Test');
    const eligibleDraftPlanA = store.createEmptyPlan('Bản nháp A (Eligible)');
    const eligibleDraftPlanB = store.createEmptyPlan('Bản nháp B (Eligible)');
    const protectedPlanC = store.createEmptyPlan('Bản nháp C (Ineligible - Sim run)');

    const simRunBatchC = 'sim_run_batch_c';
    useTacticalStore.setState((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [simRunBatchC]: {
          id: simRunBatchC,
          scenarioId: batchScenId,
          planId: protectedPlanC,
          name: 'Batch Run C',
          runType: 'radar_coverage',
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        } as any,
      },
      plans: {
        ...s.plans,
        [eligibleDraftPlanA]: { ...s.plans[eligibleDraftPlanA], status: 'trashed' as const },
        [eligibleDraftPlanB]: { ...s.plans[eligibleDraftPlanB], status: 'trashed' as const },
        [protectedPlanC]: { ...s.plans[protectedPlanC], status: 'trashed' as const },
      },
    }));

    // Dry-run preview
    const summary = store.getTrashSummary('plans');
    expect(summary.eligiblePlans.map((p) => p.id)).toContain(eligibleDraftPlanA);
    expect(summary.eligiblePlans.map((p) => p.id)).toContain(eligibleDraftPlanB);
    expect(summary.retainedPlans.some((r) => r.plan.id === protectedPlanC)).toBe(true);

    // Execute emptyTrash
    const batchResult = store.emptyTrash('plans');
    expect(batchResult.purgedPlans).toContain(eligibleDraftPlanA);
    expect(batchResult.purgedPlans).toContain(eligibleDraftPlanB);
    expect(batchResult.retainedPlans.some((r) => r.id === protectedPlanC)).toBe(true);

    // Verify eligible plans purged, protected plan retained
    expect(useTacticalStore.getState().plans[eligibleDraftPlanA]).toBeUndefined();
    expect(useTacticalStore.getState().plans[eligibleDraftPlanB]).toBeUndefined();
    expect(useTacticalStore.getState().plans[protectedPlanC]).toBeDefined();

    // 17.4 (iv) Scenario purge: eligible vs ineligible
    // Ineligible scenario (contains protected child plan protectedPlanC or simulation runs)
    useTacticalStore.setState((s) => ({
      scenarios: {
        ...s.scenarios,
        [batchScenId]: { ...s.scenarios[batchScenId], status: 'trashed' as const },
      },
    }));
    expect(() => {
      store.purgeTrashedScenario(batchScenId);
    }).toThrow();
    expect(useTacticalStore.getState().scenarios[batchScenId]).toBeDefined();

    // Ineligible scenario: equipment in another scenario still references equipment in this scenario
    const refScenA = store.createScenario('Scenario Ref A');
    const planA = useTacticalStore.getState().activePlanId!;
    store.addEquipment({
      instanceId: 'inst_cmd_target',
      templateId: tmplRadar.id,
      name: 'Command Target',
      category: 'RadarCanhGioi',
      latitude: 21.0,
      longitude: 105.8,
      altitude: 10,
      rangeKm: 50,
      status: 'Active',
      scanSpeed: 6,
      antennaHeightAGL: 10,
    } as any);

    store.createScenario('Scenario Ref B');
    store.addEquipment({
      instanceId: 'inst_cmd_source',
      templateId: tmplRadar.id,
      name: 'Command Source',
      category: 'RadarCanhGioi',
      latitude: 21.05,
      longitude: 105.85,
      altitude: 10,
      rangeKm: 50,
      status: 'Active',
      scanSpeed: 6,
      antennaHeightAGL: 10,
    } as any);
    useTacticalStore.setState((s) => ({
      placements: {
        ...s.placements,
        inst_cmd_source: {
          ...s.placements['inst_cmd_source'],
          network: { commandedBy: 'inst_cmd_target' },
        },
      },
    }));

    store.trashDraftScenario(refScenA);
    useTacticalStore.setState((s) => ({
      plans: { ...s.plans, [planA]: { ...s.plans[planA], status: 'trashed' as const } },
    }));

    expect(isScenarioEligibleForPurge(useTacticalStore.getState(), refScenA).eligible).toBe(false);
    expect(() => {
      store.purgeTrashedScenario(refScenA);
    }).toThrow('Khí tài trong kịch bản đang được liên kết chỉ huy bởi khí tài thuộc kịch bản khác');

    // Clear cross-scenario link to maintain canonical package graph validity for subsequent export step
    useTacticalStore.setState((s) => ({
      placements: {
        ...s.placements,
        inst_cmd_source: {
          ...s.placements['inst_cmd_source'],
          network: { commandedBy: undefined },
        },
      },
    }));

    // Eligible scenario (all draft child plans eligible)
    const cleanScenarioId = store.createScenario('Clean Scenario Purge Eligible');
    const cleanChildPlanId = useTacticalStore.getState().activePlanId!;
    store.trashDraftScenario(cleanScenarioId);
    // Mark child plan trashed as well
    useTacticalStore.setState((s) => ({
      plans: {
        ...s.plans,
        [cleanChildPlanId]: { ...s.plans[cleanChildPlanId], status: 'trashed' as const },
      },
    }));
    store.purgeTrashedScenario(cleanScenarioId);
    expect(useTacticalStore.getState().scenarios[cleanScenarioId]).toBeUndefined();
    expect(useTacticalStore.getState().plans[cleanChildPlanId]).toBeUndefined();

    // 17.5 (v) Canonical V2 Export/Import roundtrip passes without resurrecting purged data
    const exportedPkg = store.exportCanonicalPackageV2('Package Post Purge');
    validateCanonicalStatePackageV2(exportedPkg);
    expect(exportedPkg.plans[eligibleDraftPlanA]).toBeUndefined();
    expect(exportedPkg.plans[eligibleDraftPlanB]).toBeUndefined();
    expect(exportedPkg.scenarios[cleanScenarioId]).toBeUndefined();
    expect(exportedPkg.plans[protectedPlanC]).toBeDefined();

    // Re-import
    store.importCanonicalPackage(exportedPkg);
    const reimportedState = useTacticalStore.getState();
    expect(reimportedState.plans[eligibleDraftPlanA]).toBeUndefined();
    expect(reimportedState.plans[cleanChildPlanId]).toBeUndefined();
    expect(reimportedState.scenarios[cleanScenarioId]).toBeUndefined();
    expect(reimportedState.plans[protectedPlanC]).toBeDefined();

    // 17.6 (vi) Context fallback and context hygiene on active purged item
    const fallbackScenId = store.createScenario('Fallback Test Scenario');
    const fallbackPlan1Id = store.createEmptyPlan('Fallback Plan 1');
    const fallbackPlan2Id = store.createEmptyPlan('Fallback Plan 2');
    store.switchActivePlan(fallbackPlan2Id);
    useTacticalStore.setState({
      selectedInstanceId: 'dummy_inst',
      activeSimulationRunId: 'dummy_sim',
      plans: {
        ...useTacticalStore.getState().plans,
        [fallbackPlan2Id]: { ...useTacticalStore.getState().plans[fallbackPlan2Id], status: 'trashed' as const },
      },
    });
    store.purgeTrashedPlan(fallbackPlan2Id);
    expect(useTacticalStore.getState().activeScenarioId).toBe(fallbackScenId);
    expect(useTacticalStore.getState().activePlanId).not.toBe(fallbackPlan2Id);
    expect(useTacticalStore.getState().plans[fallbackPlan1Id]).toBeDefined();
    expect(useTacticalStore.getState().selectedInstanceId).toBeNull();
    expect(useTacticalStore.getState().activeSimulationRunId).toBeNull();
  });
});
