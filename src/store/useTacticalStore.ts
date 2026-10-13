import { create } from 'zustand';
import type {
  EquipmentCategory,
  EquipmentInstance,
  EquipmentTemplate,
  PresetLocation,
} from '../types/equipment';
import { CATEGORY_META, ENABLE_3D_MODELS } from '../types/equipment';
import type { LayoutSaveData, SavedEquipmentEntry } from '../types/layout';
import { EQUIPMENT_TEMPLATES, PRESET_LOCATIONS } from '../data/equipmentTemplates';
import { DEFAULT_SPX_CONFIG } from '../types/spxRadarCoverage';
import { createEquipmentFromTemplate } from '../utils/equipmentFactory';
import { checkVectorAiHealth, askVectorAi } from '../services/vectorAiClient';
import {
  buildPlacementMessages,
  deriveAdvisorRadiusKm,
  getAdvisorViewport,
  parsePlacementAdvice,
} from '../utils/aiPlacementAdvisor';
import type {
  AiPlacementContext,
  AiPlacementRoutePoint,
  AiPlacementSuggestion,
} from '../utils/aiPlacementAdvisor';
import type { RadarCoverageVolume } from '../types/radarVolume';
import { invalidateVolumeCache } from '../utils/radarVolumeEngine';
import { destinationPoint } from '../utils/radarLosEngine';

import { SCENARIO_STATUS_LABELS, type Scenario, type ScenarioStatus } from '../domain/types/scenario';
import { PLAN_STATUS_LABELS, type Plan, type PlanStatus } from '../domain/types/plan';
export { SCENARIO_STATUS_LABELS, PLAN_STATUS_LABELS };
export type { ScenarioStatus, PlanStatus };
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../domain/types/equipment';
import type {
  SimulationState,
  SimulationRun,
  SimulationRunStatus,
  SimulationRunFreshness,
  SimulationConfigSnapshot,
  SimulationRunDiagnostics,
  SimulationRunHandle,
} from '../domain/types/simulation';
export type { SimulationRunStatus, SimulationRunFreshness, SimulationConfigSnapshot, SimulationRunDiagnostics, SimulationRunHandle };
import { hydrateLegacyInstance, parseLegacyInstance, applyEquipmentPatchToCanonical, type LegacyPresentationState } from '../domain/adapters/legacyEquipmentAdapter';
import {
  validateCanonicalStatePackage,
  migrateCanonicalPackageV1ToV2,
  type CanonicalStatePackage,
  type CanonicalStatePackageV1,
  type CanonicalStatePackageV2,
} from '../domain/serialization/canonicalStatePackage';
import type { AuditActor } from '../domain/types/audit';
import { createAuditAppend, revisionScopeKey } from '../domain/audit/auditEngine';
import type {
  AnalysisResult,
  ExecutionStatus,
  FreshnessStatus,
  SpxAnalysisInputSnapshot,
} from '../domain/types/analysis';
import {
  buildSpxInputSnapshot,
  computeAnalysisFingerprint,
  evaluateAnalysisFreshness,
  resolveEffectiveSpxConfigFromCanonical,
} from '../domain/analysis/analysisFingerprint';
export type { AnalysisResult, ExecutionStatus, FreshnessStatus, SpxAnalysisInputSnapshot };

import { deepFreeze } from '../utils/deepFreeze';
export { deepFreeze };

import {
  computePlanInputFingerprint,
  type PlanFingerprintContext,
} from '../domain/simulation/simulationFingerprint';
export { computePlanInputFingerprint };
export type { PlanFingerprintContext };

import {
  evaluateSimulationRunFreshness,
  isSimulationRunFresh,
  type SimulationFreshnessContext,
} from '../domain/simulation/simulationFreshness';
export { evaluateSimulationRunFreshness, isSimulationRunFresh };
export type { SimulationFreshnessContext };

import {
  validateMutationGuard,
  validatePlanGraph,
  type MutationGuardContext,
  type PlanGraphValidationContext,
} from '../domain/plan/planValidation';
export { validateMutationGuard, validatePlanGraph };
export type { MutationGuardContext, PlanGraphValidationContext };

import {
  isPlanEligibleForPurge,
  type PlanPurgeContext,
} from '../domain/plan/planPurgeRules';
export { isPlanEligibleForPurge };
export type { PlanPurgeContext };

import {
  isScenarioEligibleForPurge,
  type ScenarioPurgeContext,
} from '../domain/scenario/scenarioPurgeRules';
export { isScenarioEligibleForPurge };
export type { ScenarioPurgeContext };

/**
 * Trạng thái cố vấn vị trí đặt khí tài (VECTOR AI local).
 * - idle     : chưa chạy
 * - checking : đang kiểm tra backend (GET /api/v1/health)
 * - thinking : backend sẵn sàng, đang chờ model trả lời
 * - ready    : đã có gợi ý
 * - error    : lỗi có thể xử lý (HTTP/parse/stream)
 * - offline  : không kết nối được backend 127.0.0.1:8000
 */
export type AiAdvisorStatus = 'idle' | 'checking' | 'thinking' | 'ready' | 'error' | 'offline';

/**
 * Bộ tham số "kiểu vòm tham chiếu" mặc định — port từ Defense/RadarDome.shader + RadarDomeMeshRenderer.cs
 * của dự án Unity VomKQ_test. Dùng chung cho state khởi tạo và nút "Khôi phục mặc định kiểu video"
 * để hai nơi không bao giờ lệch nhau.
 * Nguồn: vomkq-web/docs/dome-video-match/README.md mục 5.
 */
export const DOME_STYLE_DEFAULTS = {
  domeAlpha: 0.3, // Unity RadarDomeMeshRenderer.domeAlpha | 0.05–0.9 | độ đục lòng vòm
  domeAzimuthSegments: 96, // Unity RadarDomeMeshRenderer.azimuthSegments | 32–192
  domeElevationRings: 12, // Unity RadarDomeMeshRenderer.elevationRings | 4–32
  domeRimColor: '#fff232', // Unity shader _RimColor = (1, 0.95, 0.2)
  domeRimPower: 2.0, // Unity shader _RimPower | 0.5–8
  domeScanLineCount: 14, // Unity shader _ScanLineCount | 1–40
  domeScanLineSpeed: 0.6, // Unity shader _ScanLineSpeed | -5..5
  domeScanLineAnimated: true,
  showDomeFootprint: true, // Unity showGroundFootprint
  domeTerrainMasked: false, // vòm lý tưởng giống video (Unity fallback dome chưa cắt địa hình)
  domeColorOverride: null as string | null,
} as const;

/**
 * Điểm khảo sát chấm trên mặt cắt đứng 2D để đồng bộ ra vị trí 3D trên quả cầu Cesium.
 */
export interface CrossSectionProbePoint {
  instanceId: string;
  azimuthDeg: number;
  distM: number;
  distKm: number;
  altM: number;
  terrainAltM?: number;
  status: string;
  lat: number;
  lon: number;
}

interface TacticalState {
  // === Canonical Domain State (Target Source of Truth) ===
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
  simulationRuns: Record<string, SimulationRun>;
  definitions: Record<string, EquipmentDefinition>;
  placements: Record<string, EquipmentPlacement>;
  observations: Record<string, ObservationState>;
  simulations: Record<string, Record<string, SimulationState>>;
  // === Presentation/UI State ===
  visuals: Record<string, LegacyPresentationState>;

  // === Audit & Revision (Provenance) ===
  revisions: Record<string, import('../domain/types/audit').RevisionMetadata>;
  revisionHeads: Record<string, string>;
  auditEvents: Record<string, import('../domain/types/audit').AuditEvent>;
  auditEventOrder: string[];

  activeScenarioId: string | null;
  activePlanId: string | null;
  activeSimulationRunId: string | null;
  canonicalInitialized: boolean;

  /**
   * One-time hydration helper. Parses current legacy instances[] into Canonical Domain objects.
   * Does NOT enable canonical projection automatically.
   */
  /**
   * Executes the final migration cutover per-instance, validating completeness,
   * consistency, and finally setting `canonicalInitialized = true`.
   */
  ensureActiveWorkspace: () => void;
  createPlanAlternative: (sourcePlanId?: string, name?: string) => void;
  switchActivePlan: (planId: string) => void;
  saveActivePlan: () => void;
  validateActiveScenarioContext: () => void;

  // Checkpoint 2A: Scenario & Plan Workspace Actions
  createScenario: (name: string, terrainVersion?: string) => string;
  switchScenario: (scenarioId: string) => void;
  renameScenario: (scenarioId: string, newName: string) => void;
  archiveScenario: (scenarioId: string) => void;
  restoreScenario: (scenarioId: string) => void;
  trashDraftScenario: (scenarioId: string) => void;
  restoreDraftScenario: (scenarioId: string) => void;
  purgeTrashedScenario: (scenarioId: string) => void;

  createEmptyPlan: (name?: string) => string;
  renamePlan: (planId: string, newName: string) => void;
  proposePlan: (planId: string) => void;
  withdrawAndReviseProposedPlan: (planId: string, reason: string) => string;
  trashDraftPlan: (planId: string) => void;
  restoreDraftPlan: (planId: string) => void;
  purgeTrashedPlan: (planId: string) => void;
  archivePlan: (planId: string) => void;
  restorePlan: (planId: string) => void;

  emptyTrash: (scope?: 'all' | 'plans' | 'scenarios') => {
    purgedPlans: string[];
    purgedScenarios: string[];
    retainedPlans: { id: string; name: string; reason: string }[];
    retainedScenarios: { id: string; name: string; reason: string }[];
  };
  getTrashSummary: (scope?: 'all' | 'plans' | 'scenarios') => {
    eligiblePlans: Plan[];
    eligibleScenarios: Scenario[];
    retainedPlans: { plan: Plan; reason: string }[];
    retainedScenarios: { scenario: Scenario; reason: string }[];
  };

  // Workspace Context Generation Token & UI Modal State
  workspaceContextGeneration: number;
  lastImportGen?: number;
  showWorkspaceModal: boolean;
  setShowWorkspaceModal: (show: boolean) => void;
  workspaceModalTab: 'scenarios' | 'plans';
  setWorkspaceModalTab: (tab: 'scenarios' | 'plans') => void;

  // Battlefield Entities
  selectedInstanceId: string | null;

  // Tools & Modes
  activeTool: 'select' | 'place' | 'measure' | 'move';
  pendingTemplate: EquipmentTemplate | null;
  viewMode: '3D' | '2D';

  // 3D Terrain & Basemap Options
  terrainEnabled: boolean;
  terrainExaggeration: number; // 1.0 -> 3.0
  basemap: 'google-terrain' | 'google-hybrid' | 'satellite' | 'offline' | 'topo' | 'dark' | 'osm';
  vietnamOnly: boolean;
  showMapDownloadModal: boolean;

  // Visualization Toggles
  showAllDomes: boolean;
  showCommandLinks: boolean;
  showSweeps: boolean;
  showSensorNetwork: boolean;

  // Measurement
  measurePoints: Array<{ lat: number; lon: number; height: number }>;

  // Navigation Target
  flyToTarget: PresetLocation | null;

  // Radar Coverage & LOS Parameters
  targetHeightMeters: number; // Độ cao mục tiêu H_mt (m)
  showBlindZones: boolean; // Hiển thị vùng mù (Đỏ)
  showConeOfSilence: boolean; // Hiển thị nón mù đỉnh đầu
  azimuthStepDeg: number; // Bước góc lấy mẫu phương vị (độ)
  elevationStepDeg: number; // Bước góc lấy mẫu góc tà (độ)
  kFactor: number; // Hệ số khúc xạ 4/3
  coverageResults: Record<string, import('../types/radarCoverage').RadarCoverageResult>;
  coverageFields: Record<string, import('../types/radarCoverage').RadarCoverageField>;
  coverageFieldCache: Record<string, import('../types/radarCoverage').RadarCoverageField>;
  isCalculatingLOS: boolean;
  showRadarFieldModal: boolean;
  showCrossSection: boolean; // Bật/tắt bảng Mặt cắt ngang 2D
  selectedAzimuthDeg: number; // Góc phương vị đang khảo sát mặt cắt ngang (0-359)
  crossSectionProbePoint: CrossSectionProbePoint | null; // Điểm khảo sát được chấm trên mặt cắt 2D để đồng bộ ra 3D

  // === 3D Radar Coverage Volume (Chuẩn hóa vòm 3D theo Địa hình & Danh nghĩa) ===
  coverageVolumes: Record<string, RadarCoverageVolume>;
  dome3DMode: 'nominal' | 'terrain-aware';
  selectedAltitudeM: number;
  isCalculatingVolume: boolean;
  showOccludedVolume: boolean;
  setCoverageVolume: (instanceId: string, volume: RadarCoverageVolume) => void;
  setDome3DMode: (mode: 'nominal' | 'terrain-aware') => void;
  setSelectedAltitudeM: (altM: number) => void;
  setIsCalculatingVolume: (calculating: boolean) => void;
  toggleOccludedVolume: () => void;
  triggerRadarCameraPreset: (preset: 'observer' | 'behind-terrain' | 'top-down') => void;
  clearCoverageVolumes: () => void;

  // === 3D SAM Engagement Volume & Tác chiến Tên Lửa ===
  samVolumes: Record<string, import('../utils/missileVolumeEngine').SamEngagementVolume>;
  samEngagementModes: Record<string, import('../utils/missileVolumeEngine').SamEngagementMode>;
  setSamVolume: (instanceId: string, volume: import('../utils/missileVolumeEngine').SamEngagementVolume) => void;
  setSamEngagementMode: (instanceId: string, mode: import('../utils/missileVolumeEngine').SamEngagementMode) => void;
  clearSamVolumes: () => void;

  // === Kiểu vòm phủ sóng tham chiếu (port từ Unity Defense/RadarDome) ===
  domeAlpha: number; // Độ đục màu nền vòm | 0.05–0.9 | mặc định 0.30
  domeAzimuthSegments: number; // Số phân đoạn phương vị của lưới vòm | 32–192 | mặc định 96
  domeElevationRings: number; // Số vòng góc tà của lưới vòm | 4–32 | mặc định 12
  domeRimColor: string; // Màu viền sáng (hex) | mặc định #fff232
  domeRimPower: number; // Độ gắt viền sáng | 0.5–8 | mặc định 2.0
  domeScanLineCount: number; // Số đường quét ngang | 1–40 | mặc định 14
  domeScanLineSpeed: number; // Tốc độ dòng quét trôi lên | -5..5 | mặc định 0.6
  domeScanLineAnimated: boolean; // Bật/tắt animation dòng quét | mặc định true
  showDomeFootprint: boolean; // Vẽ vòng chân đế mặt đất | mặc định true
  domeTerrainMasked: boolean; // Cắt vòm theo địa hình (visibleEndM) | mặc định false
  domeColorOverride: string | null; // Ghi đè màu vòm | null = theo template -> màu khí tài
  setDomeAlpha: (alpha: number) => void;
  setDomeAzimuthSegments: (segments: number) => void;
  setDomeElevationRings: (rings: number) => void;
  setDomeRimColor: (color: string) => void;
  setDomeRimPower: (power: number) => void;
  setDomeScanLineCount: (count: number) => void;
  setDomeScanLineSpeed: (speed: number) => void;
  setDomeScanLineAnimated: (animated: boolean) => void;
  toggleDomeScanLineAnimated: () => void;
  setShowDomeFootprint: (show: boolean) => void;
  setDomeTerrainMasked: (masked: boolean) => void;
  setDomeColorOverride: (color: string | null) => void;
  resetDomeStyleDefaults: () => void;

  // === Cố vấn vị trí đặt khí tài bằng AI local (VECTOR AI @ 127.0.0.1:8000) ===
  aiAdvisorPanelOpen: boolean;
  aiAdvisorStatus: AiAdvisorStatus;
  aiAdvisorError: string | null;
  aiAdvisorSummary: string;
  aiAdvisorSuggestions: AiPlacementSuggestion[];
  aiAdvisorRoute: AiPlacementRoutePoint[];
  /** templateId của khí tài sẽ được đặt tại gợi ý; null = suy ra từ khí tài đang chọn */
  aiAdvisorTemplateId: string | null;
  setAiAdvisorPanelOpen: (open: boolean) => void;
  toggleAiAdvisorPanel: () => void;
  setAiAdvisorTemplateId: (templateId: string | null) => void;
  /** Kiểm tra backend -> dựng prompt -> hỏi model -> parse JSON. Không bao giờ ném lỗi ra UI. */
  runAiPlacementAnalysis: (model: string) => Promise<void>;
  clearAiPlacementSuggestions: () => void;
  /** Đặt khí tài tại gợi ý thứ `index` (tái dùng đúng action addEquipment hiện có) */
  placeEquipmentAtSuggestion: (index: number) => void;

  // SPx Multi-Altitude Coverage (Cambridge Pixel Standard)
  showSpxPanel: boolean;
  spxConfig: import('../types/spxRadarCoverage').SpxRadarCoverageConfig;
  spxResults: Record<string, import('../types/spxRadarCoverage').SpxCoverageResult>;
  isCalculatingSpx: boolean;
  setShowSpxPanel: (show: boolean) => void;
  toggleSpxPanel: () => void;
  updateSpxConfig: (updates: Partial<import('../types/spxRadarCoverage').SpxRadarCoverageConfig>) => void;
  setSpxResult: (instanceId: string, result: import('../types/spxRadarCoverage').SpxCoverageResult) => void;
  setIsCalculatingSpx: (calculating: boolean) => void;

  // Versioned Analysis Results & Freshness Lifecycle (Checkpoint 2B)
  analysisResults: Record<string, AnalysisResult<any>>;
  spxRecalculateToken: number;
  spxRequestedRecalculateInstanceId: string | 'all' | null;
  clearSpxRecalculateRequest: () => void;
  recordAnalysisResult: (result: AnalysisResult<any>) => void;
  commitSpxAnalysisResult: (payload: {
    requestId: string;
    scenarioId: string;
    planId: string;
    gen: number;
    instanceId: string;
    result: import('../types/spxRadarCoverage').SpxCoverageResult;
    snapshot: SpxAnalysisInputSnapshot;
    inputFingerprint: string;
  }) => boolean;
  clearAnalysisResult: (resultId: string) => void;
  clearPlanAnalysisResults: (planId: string) => void;
  triggerSpxRecalculate: (instanceId?: string) => void;
  spxRequestRegistry: Record<string, { planId: string; instanceId: string; sequenceNumber: number; registeredAt: number }>;
  spxSequenceCounters: Record<string, number>;
  spxAcceptedSequences: Record<string, number>;
  spxActiveResultIds: Record<string, string>;
  activeTerrainProviderKey?: string;
  setActiveTerrainProviderKey: (key: string) => void;
  registerSpxAnalysisRequest: (planId: string, instanceId: string, customRequestId?: string) => string;

  // === Simulation Run Lifecycle & Provenance (Checkpoint 2C.1) ===
  registerSimulationRun: (params: {
    scenarioId: string;
    planId: string;
    configSnapshot?: SimulationConfigSnapshot;
    randomSeed?: number | string;
    initialStatus?: 'pending' | 'running';
    campaignId?: string;
    autoActivate?: boolean;
    customRunId?: string;
  }) => SimulationRunHandle;
  updateSimulationRunStatus: (
    runIdOrHandle: string | SimulationRunHandle,
    nextStatus: SimulationRunStatus,
    options?: {
      runToken?: string;
      completedAt?: number;
      resultSummary?: Record<string, unknown>;
      diagnostics?: SimulationRunDiagnostics;
      eventCount?: number;
      expectedWorkspaceGeneration?: number;
    }
  ) => void;
  setActiveSimulationRunId: (runId: string | null) => void;

  // Quản lý Bố Cục (Save/Load Layout Modal)
  showLayoutModal: boolean;
  setShowLayoutModal: (show: boolean) => void;
  toggleLayoutModal: () => void;

  // Actions
  addEquipment: (instance: EquipmentInstance) => void;
  updateEquipment: (instanceId: string, updates: Partial<EquipmentInstance>) => void;
  removeEquipment: (instanceId: string) => void;
  selectEquipment: (instanceId: string | null) => void;
  setActiveTool: (tool: 'select' | 'place' | 'measure' | 'move') => void;
  setPendingTemplate: (template: EquipmentTemplate | null) => void;
  setViewMode: (mode: '3D' | '2D') => void;
  updateEquipmentSpxConfig: (
    instanceId: string,
    updates: Partial<import('../types/spxRadarCoverage').SpxRadarCoverageConfig>
  ) => void;

  setTerrainEnabled: (enabled: boolean) => void;
  setTerrainExaggeration: (exaggeration: number) => void;
  setBasemap: (basemap: 'google-terrain' | 'google-hybrid' | 'satellite' | 'offline' | 'topo' | 'dark' | 'osm') => void;
  setShowMapDownloadModal: (show: boolean) => void;
  setVietnamOnly: (vietnamOnly: boolean) => void;
  toggleVietnamOnly: () => void;

  toggleDomes: () => void;
  toggleCommandLinks: () => void;
  toggleSweeps: () => void;
  toggleSensorNetwork: () => void;

  // 2D Tactical Layer Controls & Filters
  showCoverageLayer: boolean;
  showRangeRingsLayer: boolean;
  showLabelsLayer: boolean;
  showMarkersLayer: boolean;
  showModelsLayer: boolean;
  categoryFilter: EquipmentCategory | 'All';

  toggleCoverageLayer: () => void;
  toggleRangeRingsLayer: () => void;
  toggleLabelsLayer: () => void;
  toggleMarkersLayer: () => void;
  toggleModelsLayer: () => void;
  setCategoryFilter: (category: EquipmentCategory | 'All') => void;

  // Radar Coverage Actions
  setTargetHeightMeters: (heightMeters: number) => void;
  toggleBlindZones: () => void;
  toggleConeOfSilence: () => void;
  setAzimuthStepDeg: (step: number) => void;
  setElevationStepDeg: (step: number) => void;
  setKFactor: (k: number) => void;
  setCoverageResult: (instanceId: string, result: import('../types/radarCoverage').RadarCoverageResult) => void;
  setCoverageField: (instanceId: string, field: import('../types/radarCoverage').RadarCoverageField) => void;
  setIsCalculatingLOS: (calculating: boolean) => void;
  setShowRadarFieldModal: (show: boolean) => void;
  setShowCrossSection: (show: boolean) => void;
  toggleCrossSection: () => void;
  setSelectedAzimuthDeg: (azimuthDeg: number) => void;
  setCrossSectionProbePoint: (point: CrossSectionProbePoint | null) => void;
  clearCrossSectionProbePoint: () => void;
  clearCoverageResults: () => void;

  addMeasurePoint: (point: { lat: number; lon: number; height: number }) => void;
  clearMeasurePoints: () => void;

  triggerFlyTo: (location: PresetLocation) => void;
  clearFlyTo: () => void;

  clearAll: () => void;
  importFromLayout: (layout: LayoutSaveData) => void;
  exportToLayout: (layoutName: string) => LayoutSaveData;
  loadSampleScenario: () => void;
  exportCanonicalPackage: (layoutName?: string) => CanonicalStatePackageV1;
  exportCanonicalPackageV2: (layoutName?: string) => CanonicalStatePackageV2;
  importCanonicalPackage: (pkg: CanonicalStatePackage) => void;
}


/**
 * Chọn template khí tài cho cố vấn AI theo thứ tự ưu tiên:
 * aiAdvisorTemplateId -> template của khí tài đang chọn -> template đang chờ đặt -> template đầu tiên.
 */
function resolveAdvisorTemplate(state: TacticalState): EquipmentTemplate {
  const byId = state.aiAdvisorTemplateId
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === state.aiAdvisorTemplateId)
    : undefined;
  if (byId) return byId;

  const activeInstances = selectActiveEquipment(state);
  const selected = activeInstances.find((i) => i.instanceId === state.selectedInstanceId);
  const fromSelected = selected
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === selected.templateId)
    : undefined;
  if (fromSelected) return fromSelected;

  if (state.pendingTemplate) return state.pendingTemplate;
  return EQUIPMENT_TEMPLATES[0];
}


function appendAuditToState(
  state: any,
  nextStateMap: any,
  scope: import('../domain/types/audit').RevisionScope,
  action: import('../domain/types/audit').AuditAction,
  targetType: import('../domain/types/audit').AuditTargetType,
  targetIds: string[],
  actorType: import('../domain/types/audit').AuditActorType = 'HUMAN',
  sourceType: import('../domain/types/audit').AuditSourceType = 'USER_ACTION',
  derivedFromRevisionId: string | null = null,
  reason?: string
) {
  const prevStateForFingerprint = {
    scenarios: state.scenarios,
    plans: state.plans,
    placements: state.placements,
    definitions: state.definitions,
    observations: state.observations,
    simulationRuns: state.simulationRuns,
    simulations: state.simulations
  };

  const nextStateForFingerprint = {
    scenarios: nextStateMap.scenarios || state.scenarios,
    plans: nextStateMap.plans || state.plans,
    placements: nextStateMap.placements || state.placements,
    definitions: nextStateMap.definitions || state.definitions,
    observations: nextStateMap.observations || state.observations,
    simulationRuns: nextStateMap.simulationRuns || state.simulationRuns,
    simulations: nextStateMap.simulations || state.simulations
  };

  const actor: AuditActor = { type: actorType };

  const result = createAuditAppend(
    scope,
    prevStateForFingerprint,
    nextStateForFingerprint,
    nextStateMap.revisions || state.revisions,
    nextStateMap.revisionHeads || state.revisionHeads,
    action,
    targetType,
    targetIds,
    actor,
    sourceType,
    derivedFromRevisionId,
    reason
  );

  if (!result) return {};

  const { revision, event } = result;

  return {
    revisions: { ...(nextStateMap.revisions || state.revisions), [revision.revisionId]: revision },
    revisionHeads: { ...(nextStateMap.revisionHeads || state.revisionHeads), [revisionScopeKey(scope)]: revision.revisionId },
    auditEvents: { ...(nextStateMap.auditEvents || state.auditEvents), [event.eventId]: event },
    auditEventOrder: [...(nextStateMap.auditEventOrder || state.auditEventOrder), event.eventId]
  };
}


export const useTacticalStore = create<TacticalState>((set, get) => ({
  // Canonical State Initialization
  scenarios: {},
  plans: {},
  simulationRuns: {},
  definitions: {},
  placements: {},
  observations: {},
  simulations: {},
  visuals: {},

  revisions: {},
  revisionHeads: {},
  auditEvents: {},
  auditEventOrder: [],

  activeScenarioId: null,
  activePlanId: null,
  activeSimulationRunId: null,
  canonicalInitialized: false,

  validateActiveScenarioContext: () => {
    const state = get();
    if (!state.activeScenarioId) throw new Error('validateActiveScenarioContext: No active scenario');
    const scenario = state.scenarios[state.activeScenarioId];
    if (!scenario) throw new Error('validateActiveScenarioContext: Active scenario does not exist');

    if (!state.activePlanId) throw new Error('validateActiveScenarioContext: No active plan');
    const plan = state.plans[state.activePlanId];
    if (!plan) throw new Error('validateActiveScenarioContext: Active plan does not exist');

    if (plan.scenarioId !== state.activeScenarioId) throw new Error('validateActiveScenarioContext: Plan does not belong to active scenario');
  },

  ensureActiveWorkspace: () => set((state) => {
    let nextScenarioId = state.activeScenarioId;
    let nextPlanId = state.activePlanId;
    const scenarios = { ...state.scenarios };
    const plans = { ...state.plans };
    const placements = { ...state.placements };
    const definitions = { ...state.definitions };

    if (!nextScenarioId && !nextPlanId) {
      nextScenarioId = 'default-scenario';
      nextPlanId = 'default-plan';
      if (!scenarios[nextScenarioId]) {
        scenarios[nextScenarioId] = { id: nextScenarioId, name: 'Default Scenario', terrainVersion: 'v1', createdAt: Date.now(), status: 'active' };
      }
      if (!plans[nextPlanId]) {
        plans[nextPlanId] = {
          id: nextPlanId,
          scenarioId: nextScenarioId,
          version: 1,
          name: 'Default Plan',
          status: 'draft',
          alternativeId: nextPlanId,
          revisionNumber: 1,
          baseRevisionPlanId: null,
        };
      } else if (plans[nextPlanId].scenarioId !== nextScenarioId) {
        throw new Error('ensureActiveWorkspace: default-plan exists but belongs to a different scenario');
      }
    }
    else if (!nextScenarioId && nextPlanId) {
      throw new Error('ensureActiveWorkspace: activePlanId exists but activeScenarioId is missing');
    }
    else if (nextScenarioId && !nextPlanId) {
      if (!scenarios[nextScenarioId]) throw new Error('ensureActiveWorkspace: activeScenarioId points to missing scenario');
      nextPlanId = `plan_${nextScenarioId}_default`;
      if (!plans[nextPlanId]) {
        plans[nextPlanId] = {
          id: nextPlanId,
          scenarioId: nextScenarioId,
          version: 1,
          name: 'Default Plan',
          status: 'draft',
          alternativeId: nextPlanId,
          revisionNumber: 1,
          baseRevisionPlanId: null,
        };
      } else if (plans[nextPlanId].scenarioId !== nextScenarioId) {
        throw new Error('ensureActiveWorkspace: scenario-specific default plan belongs to a different scenario');
      }
    }
    else {
      if (!scenarios[nextScenarioId!] || !plans[nextPlanId!]) {
        throw new Error('ensureActiveWorkspace: Active IDs point to non-existing records');
      }
      if (plans[nextPlanId!].scenarioId !== nextScenarioId) {
        throw new Error('ensureActiveWorkspace: Plan scenarioId mismatch');
      }
    }

    let modified = false;
    for (const pid of Object.keys(placements)) {
      const pl = placements[pid];
      if (!pl.planId || pl.planId === 'unowned') {
        // Before assigning, check if the referenced Definition is already owned by another plan.
        // If yes, this is a contradictory ownership — do NOT silently repair.
        if (pl.definitionId) {
          const def = definitions[pl.definitionId];
          if (def && def.planId && def.planId !== 'unowned' && def.planId !== nextPlanId) {
            throw new Error(
              `ensureActiveWorkspace: Unowned Placement ${pid} references Definition ${pl.definitionId} ` +
              `already owned by plan ${def.planId}. Cannot silently repair contradictory ownership.`
            );
          }
        }
        placements[pid] = { ...pl, planId: nextPlanId! };
        modified = true;
      }
    }

    // DEFINITION OWNERSHIP INFERENCE
    for (const did of Object.keys(definitions)) {
      if (!definitions[did].planId || definitions[did].planId === 'unowned') {
        const referencingPlacements = Object.values(placements).filter(p => p.definitionId === did);
        if (referencingPlacements.length === 0) {
          throw new Error(`ensureActiveWorkspace: Orphan definition ${did} has no referencing placements`);
        }
        const planIds = new Set(referencingPlacements.map(p => p.planId).filter(Boolean));
        if (planIds.size > 1) {
          throw new Error(`ensureActiveWorkspace: Definition ${did} referenced by conflicting plans`);
        }
        definitions[did] = { ...definitions[did], planId: [...planIds][0]! };
        modified = true;
      }
    }

    if (modified || nextScenarioId !== state.activeScenarioId || nextPlanId !== state.activePlanId) {
      return {
        activeScenarioId: nextScenarioId,
        activePlanId: nextPlanId,
        scenarios,
        plans,
        placements,
        definitions
      };
    }
    return {};
  }),

  createPlanAlternative: (sourcePlanId?: string, name?: string) => set((state) => {
    if (!state.activeScenarioId) throw new Error('createPlanAlternative: No active scenario');
    const scenario = state.scenarios[state.activeScenarioId];
    if (scenario?.status === 'archived') throw new Error('createPlanAlternative: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('createPlanAlternative: Scenario is trashed');

    const srcId = sourcePlanId || state.activePlanId;
    if (!srcId) throw new Error('createPlanAlternative: No source plan');
    const sourcePlan = state.plans[srcId];
    if (!sourcePlan) throw new Error('createPlanAlternative: Source plan not found');
    if (sourcePlan.scenarioId !== state.activeScenarioId) throw new Error('createPlanAlternative: Source plan from another scenario');
    if (sourcePlan.status === 'trashed') throw new Error('createPlanAlternative: Cannot create alternative from trashed plan');

    validatePlanGraph(state, srcId);

    // Helper for unique IDs
    const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
      let id;
      do {
        id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
      } while (existing[id]);
      return id;
    };

    const newPlanId = generateUniqueId('plan', state.plans);
    const plansInScenario = Object.values(state.plans).filter(p => p.scenarioId === state.activeScenarioId);
    const maxVersion = Math.max(...plansInScenario.map(p => p.version), sourcePlan.version);
    const newPlan: Plan = {
      id: newPlanId,
      scenarioId: sourcePlan.scenarioId,
      version: maxVersion + 1,
      name: (name && name.trim()) || `${sourcePlan.name} (Phương án thay thế)`,
      status: 'draft' as const,
      alternativeId: newPlanId,
      revisionNumber: 1,
      baseRevisionPlanId: null,
    };

    const nextPlans = { ...state.plans, [newPlanId]: newPlan };
    const nextPlacements = { ...state.placements };
    const nextDefinitions = { ...state.definitions };
    const nextObservations = { ...state.observations };
    const nextVisuals = { ...state.visuals };

    const placementIdMap: Record<string, string> = {};

    // First pass: create all placements and definitions
    for (const p of Object.values(state.placements)) {
      if (p.planId === srcId) {
        const newPlacementId = generateUniqueId('P_alt', nextPlacements);
        placementIdMap[p.id] = newPlacementId;

        const oldDefId = p.definitionId;
        const newDefId = generateUniqueId('D_alt', nextDefinitions);

        const oldDef = state.definitions[oldDefId];
        nextDefinitions[newDefId] = { ...oldDef, id: newDefId, planId: newPlanId };

        nextPlacements[newPlacementId] = {
          ...p,
          id: newPlacementId,
          planId: newPlanId,
          definitionId: newDefId
        };

        const oldVisual = state.visuals[p.id];
        if (oldVisual) {
          nextVisuals[newPlacementId] = { ...oldVisual };
        }

        // We DO NOT clone ObservationState, SimulationState, or SimulationRun.
        // A fresh ObservationState is created ONLY as an initial compatibility state for the NEW Placement.
        // It must NOT be treated as copied historical observation, historical event, or evidence from the source Plan.
        nextObservations[newPlacementId] = {
          placementId: newPlacementId,
          status: 'Active',
        };
      }
    }

    // Second pass: fix network reference remapping
    for (const pid of Object.values(placementIdMap)) {
      const p = nextPlacements[pid];
      if (p.network?.commandedBy && placementIdMap[p.network.commandedBy]) {
        p.network = { ...p.network, commandedBy: placementIdMap[p.network.commandedBy] };
      }
    }
    const nextState = {
      plans: nextPlans,
      placements: nextPlacements,
      definitions: nextDefinitions,
      observations: nextObservations,
      visuals: nextVisuals,
      activePlanId: newPlanId,
      selectedInstanceId: null,
      activeTool: 'select' as const,
      pendingTemplate: null,
      measurePoints: [],
      activeSimulationRunId: null,
      coverageVolumes: {},
      spxResults: {},
      samVolumes: {},
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle' as const,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const derivedFromRevisionId = state.revisionHeads[revisionScopeKey({ type: 'PLAN', id: srcId })] || null;

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: newPlanId },
      'BRANCH',
      'PLAN',
      [newPlanId],
      'HUMAN',
      'USER_ACTION',
      derivedFromRevisionId
    );

    return { ...nextState, ...auditUpdates };
  }),

  switchActivePlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('switchActivePlan: Target plan does not exist');
    if (!state.activeScenarioId) throw new Error('switchActivePlan: Target Scenario missing');
    if (plan.scenarioId !== state.activeScenarioId) throw new Error('switchActivePlan: Target plan belongs to another scenario');
    if (plan.status === 'trashed') throw new Error('switchActivePlan: Cannot select trashed plan');
    if (plan.status === 'withdrawn') throw new Error('switchActivePlan: Cannot select withdrawn plan');
    if (plan.status === 'archived') throw new Error('switchActivePlan: Cannot select archived plan');

    validatePlanGraph(state, planId);

    // Calculate new projection and restore active plan's SPx results from versioned analysisResults
    const planSpxResults: Record<string, import('../types/spxRadarCoverage').SpxCoverageResult> = {};
    const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
    const instanceIds = new Set<string>();
    Object.values(state.analysisResults).forEach((res) => {
      if (res.planId === planId && res.analysisId === 'spx_radar_coverage' && res.appliedToOverlay) {
        instanceIds.add(res.instanceId);
      }
    });
    for (const instId of instanceIds) {
      const key = `${planId}:${instId}`;
      const activeResId = state.spxActiveResultIds?.[key];
      let selectedRecord: AnalysisResult | undefined;
      if (activeResId && state.analysisResults[activeResId]?.appliedToOverlay) {
        selectedRecord = state.analysisResults[activeResId];
      } else {
        const matches = Object.values(state.analysisResults).filter(
          (r) => r.planId === planId && r.instanceId === instId && r.analysisId === 'spx_radar_coverage' && r.appliedToOverlay
        );
        if (matches.length > 0) {
          matches.sort((a, b) => {
            const seqA = a.sequenceNumber ?? 0;
            const seqB = b.sequenceNumber ?? 0;
            if (seqA !== seqB) {
              return seqB - seqA;
            }
            return b.calculatedAt - a.calculatedAt;
          });
          selectedRecord = matches[0];
        }
      }
      if (selectedRecord?.data) {
        planSpxResults[instId] = selectedRecord.data;
        nextActiveResultIds[key] = selectedRecord.id;
      }
    }

    return {
      activePlanId: planId,
      selectedInstanceId: null,
      activeTool: 'select' as const,
      pendingTemplate: null,
      measurePoints: [],
      activeSimulationRunId: null,
      coverageVolumes: {},
      spxResults: planSpxResults,
      spxActiveResultIds: nextActiveResultIds,
      samVolumes: {},
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle' as const,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };
  }),

  saveActivePlan: () => {
    const state = get();
    // saveActivePlan is validation-only — NOT a mutation operation.
    // It must NOT require draft status; proposed/approved Plans are also validatable.
    if (!state.activeScenarioId) throw new Error('saveActivePlan: No active scenario');
    const scenario = state.scenarios[state.activeScenarioId];
    if (!scenario) throw new Error('saveActivePlan: Active scenario does not exist');
    if (!state.activePlanId) throw new Error('saveActivePlan: No active plan');
    const plan = state.plans[state.activePlanId];
    if (!plan) throw new Error('saveActivePlan: Active plan does not exist');
    if (plan.scenarioId !== state.activeScenarioId) throw new Error('saveActivePlan: Plan belongs to wrong scenario');
    // NOTE: No status check — draft/proposed/approved all validatable
    validatePlanGraph(state, state.activePlanId);
    // No Zustand set() call — validation only.
  },

  createScenario: (name: string, terrainVersion = 'v1') => {
    if (!name || !name.trim()) throw new Error('createScenario: Scenario name cannot be empty');
    let createdScenarioId = '';
    set((state) => {
      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newScenarioId = generateUniqueId('scen', state.scenarios);
      createdScenarioId = newScenarioId;
      const newScenario = {
        id: newScenarioId,
        name: name.trim(),
        terrainVersion: terrainVersion || 'v1',
        createdAt: Date.now(),
        status: 'draft' as const,
      };

      const baselinePlanId = generateUniqueId('plan_' + newScenarioId + '_base', state.plans);
      const baselinePlan: Plan = {
        id: baselinePlanId,
        scenarioId: newScenarioId,
        version: 1,
        name: 'Phương án gốc',
        status: 'draft' as const,
        alternativeId: baselinePlanId,
        revisionNumber: 1,
        baseRevisionPlanId: null,
      };

      const nextState = {
        scenarios: { ...state.scenarios, [newScenarioId]: newScenario },
        plans: { ...state.plans, [baselinePlanId]: baselinePlan },
        activeScenarioId: newScenarioId,
        activePlanId: baselinePlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'ADD',
        'SCENARIO',
        [newScenarioId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    });
    return createdScenarioId;
  },

  switchScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('switchScenario: Target scenario does not exist');
    if (scenario.status === 'trashed') throw new Error('switchScenario: Cannot switch to trashed scenario');

    const matchingPlans = Object.values(state.plans).filter(
      p => p.scenarioId === scenarioId && p.status !== 'trashed' && p.status !== 'withdrawn' && p.status !== 'archived'
    );
    let targetPlanId: string | null = null;
    if (matchingPlans.length > 0) {
      matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
      targetPlanId = matchingPlans[0].id;
      validatePlanGraph(state, targetPlanId);
    }

    const planSpxResults: Record<string, import('../types/spxRadarCoverage').SpxCoverageResult> = {};
    const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
    if (targetPlanId) {
      const instanceIds = new Set<string>();
      Object.values(state.analysisResults).forEach((res) => {
        if (res.planId === targetPlanId && res.analysisId === 'spx_radar_coverage' && res.appliedToOverlay) {
          instanceIds.add(res.instanceId);
        }
      });
      for (const instId of instanceIds) {
        const targetKey: string = `${targetPlanId}:${instId}`;
        const activeResId = state.spxActiveResultIds?.[targetKey];
        let selectedRecord: AnalysisResult | undefined;
        if (activeResId && state.analysisResults[activeResId]?.appliedToOverlay) {
          selectedRecord = state.analysisResults[activeResId];
        } else {
          const matches = Object.values(state.analysisResults).filter(
            (r) => r.planId === targetPlanId && r.instanceId === instId && r.analysisId === 'spx_radar_coverage' && r.appliedToOverlay
          );
          if (matches.length > 0) {
            matches.sort((a, b) => {
              const seqA = a.sequenceNumber ?? 0;
              const seqB = b.sequenceNumber ?? 0;
              if (seqA !== seqB) {
                return seqB - seqA;
              }
              return b.calculatedAt - a.calculatedAt;
            });
            selectedRecord = matches[0];
          }
        }
        if (selectedRecord?.data) {
          planSpxResults[instId] = selectedRecord.data;
          nextActiveResultIds[targetKey] = selectedRecord.id;
        }
      }
    }

    return {
      activeScenarioId: scenarioId,
      activePlanId: targetPlanId,
      selectedInstanceId: null,
      activeTool: 'select' as const,
      pendingTemplate: null,
      measurePoints: [],
      activeSimulationRunId: null,
      coverageVolumes: {},
      spxResults: planSpxResults,
      spxActiveResultIds: nextActiveResultIds,
      samVolumes: {},
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle' as const,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };
  }),

  renameScenario: (scenarioId: string, newName: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('renameScenario: Scenario does not exist');
    if (scenario.status === 'archived') throw new Error('renameScenario: Cannot rename archived scenario');
    if (scenario.status === 'trashed') throw new Error('renameScenario: Cannot rename trashed scenario');
    if (!newName || !newName.trim()) throw new Error('renameScenario: Scenario name cannot be empty');

    const nextState = {
      scenarios: {
        ...state.scenarios,
        [scenarioId]: { ...scenario, name: newName.trim() }
      }
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'UPDATE',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  archiveScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('archiveScenario: Target scenario does not exist');
    if (scenario.status === 'archived') throw new Error('archiveScenario: Scenario is already archived');
    if (scenario.status === 'trashed') throw new Error('archiveScenario: Cannot archive trashed scenario');

    const isTargetActive = state.activeScenarioId === scenarioId;
    const contextHygiene = isTargetActive
      ? {
        activeSimulationRunId: null,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
      }
      : {};

    const nextState = {
      scenarios: {
        ...state.scenarios,
        [scenarioId]: {
          ...scenario,
          status: 'archived' as const,
          archivedAt: Date.now(),
        },
      },
      ...contextHygiene,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'ARCHIVE',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  restoreScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('restoreScenario: Target scenario does not exist');
    if (scenario.status !== 'archived') throw new Error('restoreScenario: Scenario is not archived');

    const nextState = {
      scenarios: {
        ...state.scenarios,
        [scenarioId]: {
          ...scenario,
          status: 'active' as const,
          archivedAt: undefined,
        },
      },
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'RESTORE',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  trashDraftScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('trashDraftScenario: Target scenario does not exist');
    if (scenario.status === 'trashed') throw new Error('trashDraftScenario: Scenario is already trashed');
    if (scenario.status === 'archived') throw new Error('trashDraftScenario: Cannot trash archived scenario. Restore first.');

    const childPlans = Object.values(state.plans).filter((p) => p.scenarioId === scenarioId);
    const nonDraftPlans = childPlans.filter(
      (p) => p.status === 'proposed' || p.status === 'approved' || p.status === 'withdrawn' || p.status === 'archived'
    );
    if (nonDraftPlans.length > 0) {
      throw new Error('trashDraftScenario: Cannot trash scenario containing proposed or approved plans. Use archive instead.');
    }
    const hasSimulationRuns = Object.values(state.simulationRuns).some((r) => r.scenarioId === scenarioId);
    if (hasSimulationRuns) {
      throw new Error('trashDraftScenario: Cannot trash scenario referenced by simulation runs. Use archive instead.');
    }

    let nextActiveScenarioId = state.activeScenarioId;
    let nextActivePlanId = state.activePlanId;
    if (state.activeScenarioId === scenarioId) {
      const remainingScenarios = Object.values(state.scenarios).filter(
        (s) => s.id !== scenarioId && s.status !== 'trashed'
      );
      if (remainingScenarios.length > 0) {
        nextActiveScenarioId = remainingScenarios[0].id;
        const matchingPlans = Object.values(state.plans).filter(
          (p) => p.scenarioId === nextActiveScenarioId && p.status !== 'trashed' && p.status !== 'withdrawn' && p.status !== 'archived'
        );
        matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        nextActivePlanId = matchingPlans.length > 0 ? matchingPlans[0].id : null;
      } else {
        nextActiveScenarioId = null;
        nextActivePlanId = null;
      }
    }

    const nextState = {
      scenarios: {
        ...state.scenarios,
        [scenarioId]: {
          ...scenario,
          status: 'trashed' as const,
          trashedAt: Date.now(),
        },
      },
      activeScenarioId: nextActiveScenarioId,
      activePlanId: nextActivePlanId,
      activeSimulationRunId: state.activeScenarioId === scenarioId ? null : state.activeSimulationRunId,
      selectedInstanceId: null,
      activeTool: 'select' as const,
      pendingTemplate: null,
      measurePoints: [],
      coverageVolumes: {},
      spxResults: {},
      samVolumes: {},
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle' as const,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'TRASH',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  restoreDraftScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('restoreDraftScenario: Target scenario does not exist');
    if (scenario.status !== 'trashed') throw new Error('restoreDraftScenario: Scenario is not trashed');

    const nextState = {
      scenarios: {
        ...state.scenarios,
        [scenarioId]: {
          ...scenario,
          status: 'draft' as const,
          trashedAt: undefined,
        },
      },
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'RESTORE',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  purgeTrashedScenario: (scenarioId: string) => set((state) => {
    const scenario = state.scenarios[scenarioId];
    if (!scenario) throw new Error('purgeTrashedScenario: Target scenario does not exist');
    const el = isScenarioEligibleForPurge(state, scenarioId);
    if (!el.eligible) {
      throw new Error(`purgeTrashedScenario: ${el.reason || 'Scenario is not eligible for purge'}`);
    }

    const childPlans = Object.values(state.plans).filter((p) => p.scenarioId === scenarioId);
    const childPlanIds = new Set(childPlans.map((p) => p.id));

    const scenarioPlacementIds = new Set(
      Object.values(state.placements)
        .filter((p) => childPlanIds.has(p.planId))
        .map((p) => p.id)
    );
    const scenarioDefIds = new Set(
      Object.values(state.definitions)
        .filter((d) => childPlanIds.has(d.planId))
        .map((d) => d.id)
    );

    const nextPlacements = { ...state.placements };
    for (const pId of scenarioPlacementIds) delete nextPlacements[pId];

    const nextDefinitions = { ...state.definitions };
    for (const dId of scenarioDefIds) delete nextDefinitions[dId];

    const nextObservations = { ...state.observations };
    for (const pId of scenarioPlacementIds) delete nextObservations[pId];

    const nextVisuals = { ...state.visuals };
    for (const pId of scenarioPlacementIds) delete nextVisuals[pId];

    const nextPlans = { ...state.plans };
    for (const pId of childPlanIds) delete nextPlans[pId];

    const nextScenarios = { ...state.scenarios };
    delete nextScenarios[scenarioId];

    const nextCoverageVolumes = { ...state.coverageVolumes };
    const nextSpxResults = { ...state.spxResults };
    const nextSamVolumes = { ...state.samVolumes };
    const nextCoverageResults = { ...state.coverageResults };
    const nextCoverageFields = { ...state.coverageFields };
    for (const pId of scenarioPlacementIds) {
      delete nextCoverageVolumes[pId];
      delete nextSpxResults[pId];
      delete nextSamVolumes[pId];
      delete nextCoverageResults[pId];
      delete nextCoverageFields[pId];
    }

    const nextAnalysisResults = { ...state.analysisResults };
    for (const resId in nextAnalysisResults) {
      if (nextAnalysisResults[resId].scenarioId === scenarioId) {
        delete nextAnalysisResults[resId];
      }
    }

    const nextSamEngagementModes = { ...state.samEngagementModes };
    for (const pId of scenarioPlacementIds) {
      delete nextSamEngagementModes[pId];
    }

    let nextActiveScenarioId = state.activeScenarioId;
    let nextActivePlanId = state.activePlanId;
    let contextHygiene = {};

    if (state.activeScenarioId === scenarioId) {
      const remainingScenarios = Object.values(nextScenarios).filter(
        (s) => s.id !== scenarioId && s.status !== 'trashed'
      );
      if (remainingScenarios.length > 0) {
        nextActiveScenarioId = remainingScenarios[0].id;
        const matchingPlans = Object.values(nextPlans).filter(
          (p) =>
            p.scenarioId === nextActiveScenarioId &&
            p.status !== 'trashed' &&
            p.status !== 'withdrawn' &&
            p.status !== 'archived'
        );
        matchingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        nextActivePlanId = matchingPlans.length > 0 ? matchingPlans[0].id : null;
      } else {
        nextActiveScenarioId = null;
        nextActivePlanId = null;
      }
      contextHygiene = {
        activeSimulationRunId: null,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
      };
    }

    const nextState = {
      scenarios: nextScenarios,
      plans: nextPlans,
      placements: nextPlacements,
      definitions: nextDefinitions,
      observations: nextObservations,
      visuals: nextVisuals,
      coverageVolumes: nextCoverageVolumes,
      spxResults: nextSpxResults,
      analysisResults: nextAnalysisResults,
      samVolumes: nextSamVolumes,
      coverageResults: nextCoverageResults,
      coverageFields: nextCoverageFields,
      samEngagementModes: nextSamEngagementModes,
      spxRequestRegistry: Object.fromEntries(
        Object.entries(state.spxRequestRegistry || {}).filter(([_, r]) => !childPlanIds.has(r.planId))
      ),
      spxSequenceCounters: Object.fromEntries(
        Object.entries(state.spxSequenceCounters || {}).filter(([k]) => !childPlanIds.has(k.split(':')[0]))
      ),
      spxAcceptedSequences: Object.fromEntries(
        Object.entries(state.spxAcceptedSequences || {}).filter(([k]) => !childPlanIds.has(k.split(':')[0]))
      ),
      spxActiveResultIds: Object.fromEntries(
        Object.entries(state.spxActiveResultIds || {}).filter(([k]) => !childPlanIds.has(k.split(':')[0]))
      ),
      activeScenarioId: nextActiveScenarioId,
      activePlanId: nextActivePlanId,
      ...contextHygiene,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'REMOVE',
      'SCENARIO',
      [scenarioId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  createEmptyPlan: (name?: string) => {
    let createdPlanId = '';
    set((state) => {
      if (!state.activeScenarioId) throw new Error('createEmptyPlan: No active scenario');
      const scenario = state.scenarios[state.activeScenarioId];
      if (!scenario) throw new Error('createEmptyPlan: Active scenario does not exist');
      if (scenario.status === 'archived') throw new Error('createEmptyPlan: Scenario is archived');
      if (scenario.status === 'trashed') throw new Error('createEmptyPlan: Scenario is trashed');

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newPlanId = generateUniqueId('plan', state.plans);
      createdPlanId = newPlanId;
      const plansInScenario = Object.values(state.plans).filter((p) => p.scenarioId === state.activeScenarioId);
      const maxVersion = plansInScenario.length > 0 ? Math.max(...plansInScenario.map((p) => p.version)) : 0;
      const newPlan: Plan = {
        id: newPlanId,
        scenarioId: state.activeScenarioId,
        version: maxVersion + 1,
        name: (name && name.trim()) || 'Phương án mới',
        status: 'draft' as const,
        alternativeId: newPlanId,
        revisionNumber: 1,
        baseRevisionPlanId: null,
      };

      const nextState = {
        plans: { ...state.plans, [newPlanId]: newPlan },
        activePlanId: newPlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: newPlanId },
        'ADD',
        'PLAN',
        [newPlanId],
        'HUMAN',
        'USER_ACTION'
      );

      return { ...nextState, ...auditUpdates };
    });
    return createdPlanId;
  },

  renamePlan: (planId: string, newName: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('renamePlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('renamePlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('renamePlan: Scenario is trashed');
    if (plan.scenarioId !== state.activeScenarioId) throw new Error('renamePlan: Plan does not belong to active scenario');
    if (plan.status !== 'draft') throw new Error('renamePlan: Only draft plans can be renamed');
    if (!newName || !newName.trim()) throw new Error('renamePlan: Plan name cannot be empty');

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: { ...plan, name: newName.trim() }
      }
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'UPDATE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  proposePlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('proposePlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('proposePlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('proposePlan: Scenario is trashed');
    if (plan.scenarioId !== state.activeScenarioId) throw new Error('proposePlan: Plan does not belong to active scenario');
    if (plan.status !== 'draft') throw new Error('proposePlan: Only draft plans can be proposed');
    validatePlanGraph(state, planId);

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: { ...plan, status: 'proposed' as const }
      }
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'UPDATE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  withdrawAndReviseProposedPlan: (planId: string, reason: string) => {
    if (!reason || !reason.trim()) {
      throw new Error('withdrawAndReviseProposedPlan: Reason is required to withdraw a proposal');
    }
    let createdRevisionPlanId = '';
    set((state) => {
      const plan = state.plans[planId];
      if (!plan) throw new Error('withdrawAndReviseProposedPlan: Plan does not exist');
      const scenario = state.scenarios[plan.scenarioId];
      if (scenario?.status === 'archived') throw new Error('withdrawAndReviseProposedPlan: Scenario is archived');
      if (scenario?.status === 'trashed') throw new Error('withdrawAndReviseProposedPlan: Scenario is trashed');
      if (plan.scenarioId !== state.activeScenarioId) throw new Error('withdrawAndReviseProposedPlan: Plan does not belong to active scenario');
      if (plan.status !== 'proposed') throw new Error('withdrawAndReviseProposedPlan: Only proposed plans can be withdrawn and revised');

      validatePlanGraph(state, planId);

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const newPlanId = generateUniqueId('plan', state.plans);
      createdRevisionPlanId = newPlanId;

      const currentAlternativeId = plan.alternativeId || plan.id;
      const nextRevisionNumber = (plan.revisionNumber || 1) + 1;

      // 1. Mark existing proposed plan as immutable withdrawn snapshot
      const withdrawnPlan: Plan = {
        ...plan,
        status: 'withdrawn' as const,
        withdrawnAt: Date.now(),
        withdrawnReason: reason.trim(),
      };

      // 2. Create new draft revision of the SAME alternative
      const newDraftPlan: Plan = {
        id: newPlanId,
        scenarioId: plan.scenarioId,
        version: plan.version, // SAME alternative version!
        name: plan.name,
        status: 'draft' as const,
        alternativeId: currentAlternativeId,
        revisionNumber: nextRevisionNumber,
        baseRevisionPlanId: plan.id,
      };

      const nextPlans = {
        ...state.plans,
        [planId]: withdrawnPlan,
        [newPlanId]: newDraftPlan,
      };

      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextObservations = { ...state.observations };
      const nextVisuals = { ...state.visuals };

      const placementIdMap: Record<string, string> = {};

      // Clone placements and definitions for the new revision
      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          const newPlacementId = generateUniqueId('P_rev', nextPlacements);
          placementIdMap[p.id] = newPlacementId;

          const oldDefId = p.definitionId;
          const newDefId = generateUniqueId('D_rev', nextDefinitions);

          const oldDef = state.definitions[oldDefId];
          nextDefinitions[newDefId] = { ...oldDef, id: newDefId, planId: newPlanId };

          nextPlacements[newPlacementId] = {
            ...p,
            id: newPlacementId,
            planId: newPlanId,
            definitionId: newDefId,
          };

          const oldVisual = state.visuals[p.id];
          if (oldVisual) {
            nextVisuals[newPlacementId] = { ...oldVisual };
          }

          nextObservations[newPlacementId] = {
            placementId: newPlacementId,
            status: 'Active',
          };
        }
      }

      // Remap network references
      for (const pid of Object.values(placementIdMap)) {
        const p = nextPlacements[pid];
        if (p.network?.commandedBy && placementIdMap[p.network.commandedBy]) {
          p.network = { ...p.network, commandedBy: placementIdMap[p.network.commandedBy] };
        }
      }

      const nextState = {
        plans: nextPlans,
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        activePlanId: newPlanId,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        activeSimulationRunId: null,
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
      };

      // Audit withdrawal of old proposal
      const withdrawAudit = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'WITHDRAW',
        'PLAN',
        [planId],
        'HUMAN',
        'USER_ACTION',
        null,
        reason.trim()
      );

      const stateWithWithdraw = { ...nextState, ...withdrawAudit };
      const derivedFromRevisionId = stateWithWithdraw.revisionHeads[revisionScopeKey({ type: 'PLAN', id: planId })] || null;

      // Audit branch/new revision
      const branchAudit = appendAuditToState(
        stateWithWithdraw,
        stateWithWithdraw,
        { type: 'PLAN', id: newPlanId },
        'BRANCH',
        'PLAN',
        [newPlanId],
        'HUMAN',
        'USER_ACTION',
        derivedFromRevisionId
      );

      return { ...stateWithWithdraw, ...branchAudit };
    });
    return createdRevisionPlanId;
  },

  trashDraftPlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('trashDraftPlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('trashDraftPlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('trashDraftPlan: Scenario is trashed');
    if (plan.status !== 'draft') throw new Error('trashDraftPlan: Only draft plans can be moved to trash');

    const hasSimulationRuns = Object.values(state.simulationRuns).some((r) => r.planId === planId);
    if (hasSimulationRuns) {
      throw new Error('trashDraftPlan: Cannot trash plan referenced by simulation runs');
    }

    let nextActivePlanId = state.activePlanId;
    let contextHygiene = {};
    if (state.activePlanId === planId) {
      const remainingPlans = Object.values(state.plans).filter(
        (p) =>
          p.scenarioId === plan.scenarioId &&
          p.id !== planId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      );
      remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
      nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
      contextHygiene = {
        activeSimulationRunId: null,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
      };
    }

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: {
          ...plan,
          status: 'trashed' as const,
          trashedAt: Date.now(),
        },
      },
      activePlanId: nextActivePlanId,
      ...contextHygiene,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'TRASH',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  restoreDraftPlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('restoreDraftPlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('restoreDraftPlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('restoreDraftPlan: Scenario is trashed');
    if (plan.status !== 'trashed') throw new Error('restoreDraftPlan: Plan is not trashed');

    let nextActivePlanId = state.activePlanId;
    if (!nextActivePlanId && state.activeScenarioId === plan.scenarioId) {
      nextActivePlanId = planId;
    }

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: {
          ...plan,
          status: 'draft' as const,
          trashedAt: undefined,
        },
      },
      activePlanId: nextActivePlanId,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'RESTORE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  purgeTrashedPlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('purgeTrashedPlan: Plan does not exist');
    const el = isPlanEligibleForPurge(state, planId);
    if (!el.eligible) {
      throw new Error(`purgeTrashedPlan: ${el.reason || 'Plan is not eligible for purge'}`);
    }

    const planPlacementIds = new Set(
      Object.values(state.placements)
        .filter((p) => p.planId === planId)
        .map((p) => p.id)
    );
    const planDefIds = new Set(
      Object.values(state.definitions)
        .filter((d) => d.planId === planId)
        .map((d) => d.id)
    );

    const nextPlacements = { ...state.placements };
    for (const pId of planPlacementIds) delete nextPlacements[pId];

    const nextDefinitions = { ...state.definitions };
    for (const dId of planDefIds) delete nextDefinitions[dId];

    const nextObservations = { ...state.observations };
    for (const pId of planPlacementIds) delete nextObservations[pId];

    const nextVisuals = { ...state.visuals };
    for (const pId of planPlacementIds) delete nextVisuals[pId];

    const nextPlans = { ...state.plans };
    delete nextPlans[planId];

    const nextCoverageVolumes = { ...state.coverageVolumes };
    const nextSpxResults = { ...state.spxResults };
    const nextSamVolumes = { ...state.samVolumes };
    const nextCoverageResults = { ...state.coverageResults };
    const nextCoverageFields = { ...state.coverageFields };
    for (const pId of planPlacementIds) {
      delete nextCoverageVolumes[pId];
      delete nextSpxResults[pId];
      delete nextSamVolumes[pId];
      delete nextCoverageResults[pId];
      delete nextCoverageFields[pId];
    }

    const nextAnalysisResults = { ...state.analysisResults };
    for (const resId in nextAnalysisResults) {
      if (nextAnalysisResults[resId].planId === planId) {
        delete nextAnalysisResults[resId];
      }
    }

    const nextSamEngagementModes = { ...state.samEngagementModes };
    for (const pId of planPlacementIds) {
      delete nextSamEngagementModes[pId];
    }

    let nextActivePlanId = state.activePlanId;
    let contextHygiene = {};
    if (state.activePlanId === planId) {
      const remainingPlans = Object.values(nextPlans).filter(
        (p) =>
          p.scenarioId === plan.scenarioId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      );
      remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
      nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
      contextHygiene = {
        activeSimulationRunId: null,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
      };
    }

    const nextState = {
      plans: nextPlans,
      placements: nextPlacements,
      definitions: nextDefinitions,
      observations: nextObservations,
      visuals: nextVisuals,
      coverageVolumes: nextCoverageVolumes,
      spxResults: nextSpxResults,
      analysisResults: nextAnalysisResults,
      samVolumes: nextSamVolumes,
      coverageResults: nextCoverageResults,
      coverageFields: nextCoverageFields,
      samEngagementModes: nextSamEngagementModes,
      spxRequestRegistry: Object.fromEntries(
        Object.entries(state.spxRequestRegistry || {}).filter(([_, r]) => r.planId !== planId)
      ),
      spxSequenceCounters: Object.fromEntries(
        Object.entries(state.spxSequenceCounters || {}).filter(([k]) => !k.startsWith(`${planId}:`))
      ),
      spxAcceptedSequences: Object.fromEntries(
        Object.entries(state.spxAcceptedSequences || {}).filter(([k]) => !k.startsWith(`${planId}:`))
      ),
      spxActiveResultIds: Object.fromEntries(
        Object.entries(state.spxActiveResultIds || {}).filter(([k]) => !k.startsWith(`${planId}:`))
      ),
      activePlanId: nextActivePlanId,
      ...contextHygiene,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'WORKSPACE', id: 'canonical-root' },
      'REMOVE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  getTrashSummary: (scope?: 'all' | 'plans' | 'scenarios') => {
    const state = get();
    const targetScope = scope || 'all';

    const eligiblePlans: Plan[] = [];
    const retainedPlans: { plan: Plan; reason: string }[] = [];
    const eligibleScenarios: Scenario[] = [];
    const retainedScenarios: { scenario: Scenario; reason: string }[] = [];

    if (targetScope === 'all' || targetScope === 'plans') {
      const trashedPlans = Object.values(state.plans).filter((p) => p.status === 'trashed');
      for (const p of trashedPlans) {
        const el = isPlanEligibleForPurge(state, p.id);
        if (el.eligible) {
          eligiblePlans.push(p);
        } else {
          retainedPlans.push({ plan: p, reason: el.reason || 'Bị bảo vệ lịch sử' });
        }
      }
    }

    if (targetScope === 'all' || targetScope === 'scenarios') {
      const trashedScenarios = Object.values(state.scenarios).filter((s) => s.status === 'trashed');
      for (const s of trashedScenarios) {
        const el = isScenarioEligibleForPurge(state, s.id);
        if (el.eligible) {
          eligibleScenarios.push(s);
        } else {
          retainedScenarios.push({ scenario: s, reason: el.reason || 'Bị bảo vệ lịch sử' });
        }
      }
    }

    return {
      eligiblePlans,
      eligibleScenarios,
      retainedPlans,
      retainedScenarios,
    };
  },

  emptyTrash: (scope?: 'all' | 'plans' | 'scenarios') => {
    const summary = get().getTrashSummary(scope);

    // Purge eligible plans first, then scenarios
    for (const p of summary.eligiblePlans) {
      get().purgeTrashedPlan(p.id);
    }
    for (const s of summary.eligibleScenarios) {
      get().purgeTrashedScenario(s.id);
    }

    return {
      purgedPlans: summary.eligiblePlans.map((p) => p.id),
      purgedScenarios: summary.eligibleScenarios.map((s) => s.id),
      retainedPlans: summary.retainedPlans.map((r) => ({
        id: r.plan.id,
        name: r.plan.name,
        reason: r.reason,
      })),
      retainedScenarios: summary.retainedScenarios.map((r) => ({
        id: r.scenario.id,
        name: r.scenario.name,
        reason: r.reason,
      })),
    };
  },

  archivePlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('archivePlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('archivePlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('archivePlan: Scenario is trashed');
    if (plan.status === 'archived') throw new Error('archivePlan: Plan is already archived');
    if (plan.status === 'trashed') throw new Error('archivePlan: Cannot archive trashed plan');

    let nextActivePlanId = state.activePlanId;
    let contextHygiene = {};
    if (state.activePlanId === planId) {
      const remainingPlans = Object.values(state.plans).filter(
        (p) =>
          p.scenarioId === plan.scenarioId &&
          p.id !== planId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      );
      remainingPlans.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
      nextActivePlanId = remainingPlans.length > 0 ? remainingPlans[0].id : null;
      contextHygiene = {
        activeSimulationRunId: null,
        selectedInstanceId: null,
        activeTool: 'select' as const,
        pendingTemplate: null,
        measurePoints: [],
        coverageVolumes: {},
        spxResults: {},
        samVolumes: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
      };
    }

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: {
          ...plan,
          status: 'archived' as const,
          archivedAt: Date.now(),
          archivedFromStatus: plan.status,
        },
      },
      activePlanId: nextActivePlanId,
      ...contextHygiene,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'ARCHIVE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  restorePlan: (planId: string) => set((state) => {
    const plan = state.plans[planId];
    if (!plan) throw new Error('restorePlan: Plan does not exist');
    const scenario = state.scenarios[plan.scenarioId];
    if (scenario?.status === 'archived') throw new Error('restorePlan: Scenario is archived');
    if (scenario?.status === 'trashed') throw new Error('restorePlan: Scenario is trashed');
    if (plan.status !== 'archived') throw new Error('restorePlan: Plan is not archived');

    const restoredStatus = plan.archivedFromStatus || 'draft';

    let nextActivePlanId = state.activePlanId;
    if (!nextActivePlanId && state.activeScenarioId === plan.scenarioId && restoredStatus !== 'withdrawn') {
      nextActivePlanId = planId;
    }

    const nextState = {
      plans: {
        ...state.plans,
        [planId]: {
          ...plan,
          status: restoredStatus,
          archivedAt: undefined,
          archivedFromStatus: undefined,
        },
      },
      activePlanId: nextActivePlanId,
      workspaceContextGeneration: (state.workspaceContextGeneration || 0) + 1,
    };

    const auditUpdates = appendAuditToState(
      state,
      nextState,
      { type: 'PLAN', id: planId },
      'RESTORE',
      'PLAN',
      [planId],
      'HUMAN',
      'USER_ACTION'
    );

    return { ...nextState, ...auditUpdates };
  }),

  workspaceContextGeneration: 0,
  lastImportGen: 0,
  showWorkspaceModal: false,
  setShowWorkspaceModal: (show: boolean) => set({ showWorkspaceModal: show }),
  workspaceModalTab: 'plans' as const,
  setWorkspaceModalTab: (tab: 'scenarios' | 'plans') => set({ workspaceModalTab: tab }),

  selectedInstanceId: null,

  activeTool: 'select',
  pendingTemplate: null,
  viewMode: '3D',

  terrainEnabled: true,
  terrainExaggeration: 1.8,
  activeTerrainProviderKey: 'flat_v1',
  spxActiveResultIds: {},
  basemap: 'google-terrain',
  vietnamOnly: true,
  showMapDownloadModal: false,

  showAllDomes: true,
  showCommandLinks: true,
  showSweeps: true,
  showSensorNetwork: true,

  // 2D & 3D Tactical Layer Controls & Filters
  showCoverageLayer: true,
  showRangeRingsLayer: true,
  showLabelsLayer: true,
  showMarkersLayer: true,
  showModelsLayer: ENABLE_3D_MODELS,
  categoryFilter: 'All',

  measurePoints: [],
  flyToTarget: PRESET_LOCATIONS[0], // Bắt đầu tại Tam Đảo (địa hình núi 3D)

  addEquipment: (instance) =>
    set((state) => {
      validateMutationGuard(state);
      const planId = state.activePlanId!;

      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
      const category = instance.category || tmpl?.category || 'RadarCanhGioi';
      const prefix = CATEGORY_META[category]?.prefix || 'EQ';
      const activeInstances = selectActiveEquipment(state);
      const sameCategoryIds = activeInstances
        .filter((i) => i.category === category)
        .map((i) => i.shortId)
        .filter(Boolean) as string[];
      let maxNumber = 0;
      for (const sid of sameCategoryIds) {
        const match = sid.match(new RegExp(`^${prefix}-(\\d+)$`));
        if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
      }
      const autoShortId = `${prefix}-${(maxNumber + 1).toString().padStart(2, '0')}`;

      const instanceWithProfile: EquipmentInstance = {
        ...instance,
        category,
        shortId: instance.shortId || autoShortId,
        coverageProfile: instance.coverageProfile || tmpl?.coverageProfile,
        altitudeDetectionTable: instance.altitudeDetectionTable || tmpl?.altitudeDetectionTable,
        minEngagementRangeKm: instance.minEngagementRangeKm ?? tmpl?.minEngagementRangeKm,
        maxEngagementAltitudeM: instance.maxEngagementAltitudeM ?? tmpl?.maxEngagementAltitudeM,
        reactionTimeSeconds: instance.reactionTimeSeconds ?? tmpl?.reactionTimeSeconds,
        guidanceMethodVi: instance.guidanceMethodVi ?? tmpl?.guidanceMethodVi,
        frequencyRangeGhz: instance.frequencyRangeGhz ?? tmpl?.frequencyRangeGhz,
        networkGroupId: instance.networkGroupId ?? tmpl?.networkGroupId,
        realPhotoUrl: instance.realPhotoUrl || tmpl?.realPhotoUrl,
        model3dUrl: instance.model3dUrl || tmpl?.model3dUrl,
        model3dScale: instance.model3dScale ?? tmpl?.model3dScale ?? 1.0,
        model3dHeadingOffset: instance.model3dHeadingOffset ?? tmpl?.model3dHeadingOffset ?? 0,
        model3dAltitudeOffset: instance.model3dAltitudeOffset ?? tmpl?.model3dAltitudeOffset ?? 0,
      };

      // 2. Parse into Canonical Fragments (Pure Mapping)
      const parsed = parseLegacyInstance(instanceWithProfile, planId);
      const pid = parsed.placement.id;

      // 3. Update canonical state
      const nextState = {
        placements: { ...state.placements, [pid]: parsed.placement },
        definitions: { ...state.definitions, [parsed.definition.id]: parsed.definition },
        observations: { ...state.observations, [pid]: parsed.observation },
        visuals: { ...state.visuals, [pid]: parsed.visual },
        selectedInstanceId: instance.instanceId,
        activeTool: 'select' as const,
        pendingTemplate: null,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'ADD',
        'EQUIPMENT',
        [pid]
      );

      return { ...nextState, ...auditUpdates };
    }),

  updateEquipment: (instanceId, updates) => {
    const state = useTacticalStore.getState();
    validateMutationGuard(state);
    const pTarget = state.placements[instanceId];
    if (!pTarget) throw new Error(`Placement not found`);
    if (pTarget.planId !== state.activePlanId) throw new Error(`Placement belongs to another plan`);
    if (
      updates.latitude !== undefined ||
      updates.longitude !== undefined ||
      updates.altitude !== undefined ||
      updates.antennaHeightAGL !== undefined ||
      updates.rangeKm !== undefined ||
      updates.minElevationDeg !== undefined ||
      updates.maxElevationDeg !== undefined ||
      updates.coverageHeightKm !== undefined
    ) {
      invalidateVolumeCache(instanceId);
    }
    set((state) => {
      const locationOrRadarChanged =
        updates.latitude !== undefined ||
        updates.longitude !== undefined ||
        updates.altitude !== undefined ||
        updates.antennaHeightAGL !== undefined ||
        updates.rangeKm !== undefined;
      const nextVolumes = locationOrRadarChanged
        ? { ...state.coverageVolumes }
        : state.coverageVolumes;
      if (locationOrRadarChanged) {
        delete nextVolumes[instanceId];
      }

      // CHECKPOINT 1B.3.3: Canonical-first migration logic
      const placement = state.placements[instanceId];

      const definition = state.definitions[placement.definitionId];
      const observation = state.observations[instanceId];
      const visual = state.visuals[instanceId];

      if (!definition || !observation || !visual) {
        throw new Error(`Canonical fragment missing for placement ${instanceId}`);
      }

      const updatedCanonical = applyEquipmentPatchToCanonical(placement, definition, observation, visual, updates);
      const nextState = {
        placements: { ...state.placements, [placement.id]: updatedCanonical.placement },
        definitions: { ...state.definitions, [definition.id]: updatedCanonical.definition },
        observations: { ...state.observations, [placement.id]: updatedCanonical.observation },
        visuals: { ...state.visuals, [placement.id]: updatedCanonical.visual },
        coverageVolumes: nextVolumes,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: state.activePlanId! },
        'UPDATE',
        'EQUIPMENT',
        [placement.id]
      );

      return { ...nextState, ...auditUpdates };
    });
  },

  updateEquipmentSpxConfig: (instanceId, updates) =>
    set((state) => {
      validateMutationGuard(state);
      const pTarget = state.placements[instanceId];
      if (!pTarget) throw new Error(`Placement not found`);
      if (pTarget.planId !== state.activePlanId) throw new Error(`Placement belongs to another plan`);

      const placement = state.placements[instanceId];

      // Canonical-backed path
      const definition = state.definitions[placement.definitionId];
      const observation = state.observations[instanceId];
      const visual = state.visuals[instanceId];

      if (!definition || !observation || !visual) throw new Error(`Canonical fragment missing for placement ${instanceId}`);

      const newVisual = {
        ...visual,
        spxConfig: { ...(visual.spxConfig || {}), ...updates },
      };
      return {
        visuals: { ...state.visuals, [instanceId]: newVisual }
      };
    }),

  removeEquipment: (instanceId) => {
    const state = get();
    validateMutationGuard(state);

    const pTarget = state.placements[instanceId];
    if (!pTarget) {
      throw new Error(`Target equipment ${instanceId} does not exist`);
    }
    if (pTarget.planId !== state.activePlanId) {
      throw new Error(`Target equipment ${instanceId} belongs to another plan`);
    }

    invalidateVolumeCache(instanceId);

    set((state) => {
      const nextVolumes = { ...state.coverageVolumes };
      delete nextVolumes[instanceId];

      const placement = state.placements[instanceId];

      // Canonical-backed
      const nextPlacements = { ...state.placements };
      const nextVisuals = { ...state.visuals };
      const nextDefinitions = { ...state.definitions };

      delete nextPlacements[instanceId];
      delete nextVisuals[instanceId];
      // Do NOT delete observations or simulations (preserve historical data)

      const definitionId = placement.definitionId;
      const hasOtherReferences = Object.values(nextPlacements).some((p) => p.definitionId === definitionId);
      if (!hasOtherReferences) {
        delete nextDefinitions[definitionId];
      }

      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        visuals: nextVisuals,
        selectedInstanceId: state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
        coverageVolumes: nextVolumes,
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: state.activePlanId! },
        'REMOVE',
        'EQUIPMENT',
        [instanceId]
      );

      return { ...nextState, ...auditUpdates };
    });
  },

  selectEquipment: (instanceId) =>
    set((state) => ({
      selectedInstanceId: instanceId,
      activeTool: 'select',
      pendingTemplate: null,
      crossSectionProbePoint:
        state.selectedInstanceId === instanceId ? state.crossSectionProbePoint : null,
    })),

  setActiveTool: (tool) =>
    set(() => {
      if (tool !== 'place') {
        return { activeTool: tool, pendingTemplate: null };
      }
      return { activeTool: tool };
    }),

  setPendingTemplate: (template) =>
    set({
      pendingTemplate: template,
      activeTool: template ? 'place' : 'select',
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setTerrainEnabled: (enabled) => set({ terrainEnabled: enabled }),
  setTerrainExaggeration: (exaggeration) => set({ terrainExaggeration: exaggeration }),
  setActiveTerrainProviderKey: (activeTerrainProviderKey) => set({ activeTerrainProviderKey }),
  setBasemap: (basemap) => set({ basemap }),
  setShowMapDownloadModal: (showMapDownloadModal) => set({ showMapDownloadModal }),
  setVietnamOnly: (vietnamOnly) => set({ vietnamOnly }),
  toggleVietnamOnly: () => set((state) => ({ vietnamOnly: !state.vietnamOnly })),

  toggleDomes: () => set((state) => ({ showAllDomes: !state.showAllDomes })),
  toggleCommandLinks: () =>
    set((state) => ({ showCommandLinks: !state.showCommandLinks })),
  toggleSweeps: () => set((state) => ({ showSweeps: !state.showSweeps })),
  toggleSensorNetwork: () =>
    set((state) => ({ showSensorNetwork: !state.showSensorNetwork })),

  toggleCoverageLayer: () =>
    set((state) => ({ showCoverageLayer: !state.showCoverageLayer })),
  toggleRangeRingsLayer: () =>
    set((state) => ({ showRangeRingsLayer: !state.showRangeRingsLayer })),
  toggleLabelsLayer: () =>
    set((state) => ({ showLabelsLayer: !state.showLabelsLayer })),
  toggleMarkersLayer: () =>
    set((state) => ({ showMarkersLayer: !state.showMarkersLayer })),
  toggleModelsLayer: () =>
    set((state) => ({ showModelsLayer: !state.showModelsLayer })),
  setCategoryFilter: (category) => set({ categoryFilter: category }),

  // Radar Coverage Initial State & Actions
  targetHeightMeters: 300, // Độ cao mục tiêu khảo sát mặc định 300m
  showBlindZones: false, // Mặc định tắt vùng mù dạng tia đỏ cũ vì đã có shadow terrain 3D
  showConeOfSilence: true,
  azimuthStepDeg: 5, // 5 độ quét 72 hướng cực nhanh và mượt mà
  elevationStepDeg: 3, // Bước góc tà 3 độ
  kFactor: 4 / 3, // Hệ số khúc xạ khí quyển chuẩn 4/3
  coverageResults: {},
  coverageFields: {},
  coverageFieldCache: {},
  isCalculatingLOS: false,
  showRadarFieldModal: false,
  showCrossSection: false,
  selectedAzimuthDeg: 45,
  crossSectionProbePoint: null,

  // 3D Radar Coverage Volume Initial State & Actions
  coverageVolumes: {},
  dome3DMode: 'terrain-aware',
  selectedAltitudeM: 1000,
  isCalculatingVolume: false,
  showOccludedVolume: true,
  setCoverageVolume: (instanceId, volume) =>
    set((state) => ({
      coverageVolumes: { ...state.coverageVolumes, [instanceId]: volume },
    })),
  setDome3DMode: (mode) => set({ dome3DMode: mode }),
  setSelectedAltitudeM: (altM) => set({ selectedAltitudeM: altM }),
  setIsCalculatingVolume: (calculating) =>
    set((state) =>
      state.isCalculatingVolume === calculating ? state : { isCalculatingVolume: calculating }
    ),
  toggleOccludedVolume: () => set((state) => ({ showOccludedVolume: !state.showOccludedVolume })),
  clearCoverageVolumes: () => set({ coverageVolumes: {} }),

  // 3D SAM Engagement Volume Initial State & Actions
  samVolumes: {},
  samEngagementModes: {},
  setSamVolume: (instanceId, volume) =>
    set((state) => ({
      samVolumes: { ...state.samVolumes, [instanceId]: volume },
    })),
  setSamEngagementMode: (instanceId, mode) =>
    set((state) => {
      validateMutationGuard(state);
      const pTarget = state.placements[instanceId];
      if (!pTarget) throw new Error(`Placement not found`);
      if (pTarget.planId !== state.activePlanId) throw new Error(`Placement belongs to another plan`);

      const placement = state.placements[instanceId];

      // Canonical-backed path
      const definition = state.definitions[placement.definitionId];
      const observation = state.observations[instanceId];
      const visual = state.visuals[instanceId];

      if (!definition || !observation || !visual) throw new Error(`Canonical fragment missing for placement ${instanceId}`);

      const newDefinition = {
        ...definition,
        capabilities: { ...definition.capabilities },
      };

      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === definition.templateId);
      const samProfilesAny = (newDefinition.capabilities as any).samProfiles || (tmpl as any)?.samProfiles;
      const profile = samProfilesAny?.[mode];

      (newDefinition.capabilities as any).samEngagementMode = mode;
      if (profile) {
        newDefinition.rangeKm = profile.dMaxKm;
        (newDefinition.capabilities as any).minEngagementRangeKm = profile.dMinKm;
        (newDefinition.capabilities as any).maxEngagementAltitudeM = profile.hMaxM;
        (newDefinition.capabilities as any).minEngagementAltitudeM = profile.hMinM;
        (newDefinition.capabilities as any).maxTargetSpeedMps = profile.vMaxMps;
        (newDefinition.capabilities as any).maxTargetParamKm = profile.pGhKm;
      }
      const nextState = {
        definitions: { ...state.definitions, [newDefinition.id]: newDefinition },
        samEngagementModes: { ...state.samEngagementModes, [instanceId]: mode },
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: state.activePlanId! },
        'OPERATIONAL_CHANGE',
        'EQUIPMENT',
        [instanceId]
      );

      return { ...nextState, ...auditUpdates };
    }),
  clearSamVolumes: () => set({ samVolumes: {} }),

  triggerRadarCameraPreset: (preset) => {
    const state = get();
    const inst = selectActiveEquipment(state).find((i) => i.instanceId === state.selectedInstanceId);
    if (!inst) return;

    const azDeg = state.selectedAzimuthDeg || 0;
    const field = state.coverageFields[inst.instanceId];
    const volume = state.coverageVolumes[inst.instanceId];

    if (preset === 'top-down') {
      const rangeKm = inst.rangeKm || 100;
      const targetHeight = Math.max(30000, rangeKm * 2200);
      set({
        flyToTarget: {
          id: `top-down-${inst.instanceId}`,
          name: `Nhìn thẳng từ trên xuống - ${inst.name}`,
          latitude: inst.latitude,
          longitude: inst.longitude,
          height: targetHeight,
          heading: 0,
          pitch: -89.5,
        },
      });
      return;
    }

    if (preset === 'observer') {
      // Đặt camera hơi lùi về phía sau đài (ngược hướng azDeg 180 độ), nhìn theo hướng azDeg
      const offsetDistM = 1500;
      const backAz = (azDeg + 180) % 360;
      const camPos = destinationPoint(inst.latitude, inst.longitude, offsetDistM, backAz);
      const camAltM = (inst.altitude || 0) + (inst.antennaHeightAGL || 15) + 350;

      set({
        flyToTarget: {
          id: `observer-${inst.instanceId}`,
          name: `Quan sát từ đài radar - ${inst.name}`,
          latitude: camPos.lat,
          longitude: camPos.lon,
          height: camAltM,
          heading: azDeg,
          pitch: -12,
        },
      });
      return;
    }

    if (preset === 'behind-terrain') {
      // Tìm điểm cản trên hướng azDeg
      let occDistM = (inst.rangeKm || 100) * 1000 * 0.45;
      let occAltM = (inst.altitude || 0) + 900;

      // Tra cứu từ field hoặc volume
      const rays = field?.azimuthRays?.[azDeg] || [];
      const botRay = rays[0];
      if (botRay && botRay.hasOcclusion && botRay.occlusionPoint) {
        occDistM = botRay.occlusionPoint.distanceM;
        occAltM = botRay.occlusionPoint.terrainAltM;
      } else if (volume && volume.effectiveRanges && volume.nominalRanges) {
        const azIdx = Math.min(
          volume.azimuthSamples.length - 1,
          Math.max(0, Math.floor((azDeg / 360) * volume.azimuthSamples.length))
        );
        const eff = volume.effectiveRanges[0]?.[azIdx];
        const nom = volume.nominalRanges[0]?.[azIdx];
        if (eff && nom && nom - eff > 200) {
          occDistM = eff;
        }
      }

      // Đặt camera ở phía sau điểm cản (xa hơn điểm cản dọc theo tia azDeg)
      const camDistM = occDistM + Math.max(3000, occDistM * 0.3);
      const camPos = destinationPoint(inst.latitude, inst.longitude, camDistM, azDeg);
      const camAltM = Math.max(occAltM + 1200, (inst.altitude || 0) + 1800);
      // Ống kính quay ngược lại về phía núi và radar
      const lookBackHeading = (azDeg + 180) % 360;

      set({
        flyToTarget: {
          id: `behind-terrain-${inst.instanceId}`,
          name: `Quan sát từ phía sau núi - ${inst.name}`,
          latitude: camPos.lat,
          longitude: camPos.lon,
          height: camAltM,
          heading: lookBackHeading,
          pitch: -22,
        },
      });
      return;
    }
  },

  // Kiểu vòm tham chiếu (xem DOME_STYLE_DEFAULTS)
  ...DOME_STYLE_DEFAULTS,

  // Cố vấn vị trí đặt khí tài (VECTOR AI local)
  aiAdvisorPanelOpen: false,
  aiAdvisorStatus: 'idle',
  aiAdvisorError: null,
  aiAdvisorSummary: '',
  aiAdvisorSuggestions: [],
  aiAdvisorRoute: [],
  aiAdvisorTemplateId: null,

  // SPx Multi-Altitude Coverage (Cambridge Pixel Standard)
  showSpxPanel: false,
  spxConfig: DEFAULT_SPX_CONFIG,
  spxResults: {},
  analysisResults: {},
  spxRecalculateToken: 0,
  spxRequestedRecalculateInstanceId: null,
  isCalculatingSpx: false,
  spxRequestRegistry: {},
  spxSequenceCounters: {},
  spxAcceptedSequences: {},
  registerSpxAnalysisRequest: (planId, instanceId, customRequestId) => {
    const state = get();
    const key = `${planId}:${instanceId}`;
    const nextSeq = (state.spxSequenceCounters[key] || 0) + 1;
    const reqId = customRequestId || `req_spx_${planId}_${instanceId}_${Date.now()}_${nextSeq}`;
    set((s) => ({
      spxSequenceCounters: { ...s.spxSequenceCounters, [key]: nextSeq },
      spxRequestRegistry: {
        ...s.spxRequestRegistry,
        [reqId]: {
          planId,
          instanceId,
          sequenceNumber: nextSeq,
          registeredAt: Date.now(),
        },
      },
    }));
    return reqId;
  },

  setShowSpxPanel: (show) => set({ showSpxPanel: show }),
  toggleSpxPanel: () => set((state) => ({ showSpxPanel: !state.showSpxPanel })),
  updateSpxConfig: (updates) =>
    set((state) => ({ spxConfig: { ...state.spxConfig, ...updates } })),

  setSpxResult: (instanceId, result) =>
    set((state) => {
      const placement = state.placements[instanceId];
      const plan = state.activePlanId ? state.plans[state.activePlanId] : null;
      const def = placement ? state.definitions[placement.definitionId] : null;
      const scenId = state.activeScenarioId || 'unknown_scenario';
      let nextAnalysis = state.analysisResults;
      if (placement && plan && def) {
        const visual = state.visuals[placement.id];
        const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
          state.spxConfig,
          placement,
          def,
          visual?.spxConfig
        );
        const snapshot = buildSpxInputSnapshot(
          scenId,
          plan,
          placement,
          def,
          effectiveConfig,
          state.scenarios[scenId]?.terrainVersion || 'v1',
          state.activeTerrainProviderKey
        );
        const fp = computeAnalysisFingerprint(snapshot);
        const resId = `ar_spx_${plan.id}_${instanceId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const analysisRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId: scenId,
          planId: plan.id,
          planVersion: plan.version,
          instanceId,
          calculatedAt: Date.now(),
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint: fp,
          appliedToOverlay: true,
          executionStatus: 'completed',
          data: result,
        });
        nextAnalysis = { ...state.analysisResults, [resId]: analysisRecord };
        const key = `${plan.id}:${instanceId}`;
        return {
          spxResults: { ...state.spxResults, [instanceId]: result },
          analysisResults: nextAnalysis,
          spxActiveResultIds: { ...(state.spxActiveResultIds || {}), [key]: resId },
        };
      }
      return {
        spxResults: { ...state.spxResults, [instanceId]: result },
        analysisResults: nextAnalysis,
      };
    }),

  recordAnalysisResult: (result) =>
    set((state) => ({
      analysisResults: {
        ...state.analysisResults,
        [result.id]: Object.freeze({ ...result }),
      },
    })),

  commitSpxAnalysisResult: ({
    requestId,
    scenarioId,
    planId,
    gen,
    instanceId,
    result,
    snapshot,
    inputFingerprint,
  }) => {
    let appliedToOverlay = false;
    set((state) => {
      // P1-A: Validate target Scenario, Plan, Placement, Definition, and ownership
      const scenario = state.scenarios[scenarioId];
      if (!scenario || scenario.status === 'trashed') {
        return state;
      }

      const plan = state.plans[planId];
      if (!plan || plan.scenarioId !== scenarioId || plan.status === 'trashed') {
        return state;
      }

      const placement = state.placements[instanceId];
      if (!placement || placement.planId !== planId) {
        return state;
      }

      const def = state.definitions[placement.definitionId];
      if (!def || def.planId !== planId) {
        return state;
      }

      // Reject async job if started before package import (P1-A)
      if (state.lastImportGen && gen < state.lastImportGen) {
        return state;
      }

      // Request sequence tracking (P1-C)
      const key = `${planId}:${instanceId}`;
      let requestSeq: number;
      let nextRequestRegistry = state.spxRequestRegistry;
      let nextSequenceCounters = state.spxSequenceCounters;

      if (state.spxRequestRegistry && state.spxRequestRegistry[requestId]) {
        requestSeq = state.spxRequestRegistry[requestId].sequenceNumber;
      } else {
        const nextSeq = ((state.spxSequenceCounters && state.spxSequenceCounters[key]) || 0) + 1;
        requestSeq = nextSeq;
        nextSequenceCounters = { ...(state.spxSequenceCounters || {}), [key]: nextSeq };
        nextRequestRegistry = {
          ...(state.spxRequestRegistry || {}),
          [requestId]: {
            planId,
            instanceId,
            sequenceNumber: nextSeq,
            registeredAt: Date.now(),
          },
        };
      }

      const currentAcceptedSeq = (state.spxAcceptedSequences && state.spxAcceptedSequences[key]) || 0;
      const isOlderThanAccepted = currentAcceptedSeq > 0 && requestSeq < currentAcceptedSeq;

      const recordCalculatedAt = Date.now();
      const resId = `ar_spx_${planId}_${instanceId}_${recordCalculatedAt}_${Math.random().toString(36).substring(2, 7)}`;

      const isContextStale =
        state.activeScenarioId !== scenarioId ||
        state.activePlanId !== planId ||
        state.workspaceContextGeneration !== gen;

      if (isContextStale || isOlderThanAccepted) {
        const rejectedRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId,
          planId,
          planVersion: snapshot.planVersion,
          instanceId,
          calculatedAt: recordCalculatedAt,
          sequenceNumber: requestSeq,
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint,
          requestId,
          appliedToOverlay: false,
          executionStatus: 'completed',
          data: result,
        });
        return {
          analysisResults: { ...state.analysisResults, [resId]: rejectedRecord },
          spxRequestRegistry: nextRequestRegistry,
          spxSequenceCounters: nextSequenceCounters,
        };
      }

      // P1-B: Check if current input in store still matches the fingerprint of this result using effective config
      const visual = state.visuals[placement.id];
      const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
        state.spxConfig,
        placement,
        def,
        visual?.spxConfig
      );
      const currentSnapshot = buildSpxInputSnapshot(
        scenarioId,
        plan,
        placement,
        def,
        effectiveConfig,
        scenario.terrainVersion || 'v1',
        state.activeTerrainProviderKey
      );
      if (computeAnalysisFingerprint(currentSnapshot) !== inputFingerprint) {
        const mismatchedRecord: AnalysisResult = Object.freeze({
          id: resId,
          analysisId: 'spx_radar_coverage',
          scenarioId,
          planId,
          planVersion: snapshot.planVersion,
          instanceId,
          calculatedAt: recordCalculatedAt,
          sequenceNumber: requestSeq,
          algorithmVersion: snapshot.algorithmVersion,
          terrainVersion: snapshot.terrainVersion,
          inputSnapshot: snapshot,
          inputFingerprint,
          requestId,
          appliedToOverlay: false,
          executionStatus: 'completed',
          data: result,
        });
        return {
          analysisResults: { ...state.analysisResults, [resId]: mismatchedRecord },
          spxRequestRegistry: nextRequestRegistry,
          spxSequenceCounters: nextSequenceCounters,
        };
      }

      appliedToOverlay = true;
      const acceptedRecord: AnalysisResult = Object.freeze({
        id: resId,
        analysisId: 'spx_radar_coverage',
        scenarioId,
        planId,
        planVersion: snapshot.planVersion,
        instanceId,
        calculatedAt: recordCalculatedAt,
        sequenceNumber: requestSeq,
        algorithmVersion: snapshot.algorithmVersion,
        terrainVersion: snapshot.terrainVersion,
        inputSnapshot: snapshot,
        inputFingerprint,
        requestId,
        appliedToOverlay: true,
        executionStatus: 'completed',
        data: result,
      });

      return {
        analysisResults: { ...state.analysisResults, [resId]: acceptedRecord },
        spxResults: { ...state.spxResults, [instanceId]: result },
        spxAcceptedSequences: { ...(state.spxAcceptedSequences || {}), [key]: requestSeq },
        spxActiveResultIds: { ...(state.spxActiveResultIds || {}), [key]: resId },
        spxRequestRegistry: nextRequestRegistry,
        spxSequenceCounters: nextSequenceCounters,
      };
    });
    return appliedToOverlay;
  },

  triggerSpxRecalculate: (instanceId?: string) =>
    set((state) => ({
      spxRecalculateToken: (state.spxRecalculateToken || 0) + 1,
      spxRequestedRecalculateInstanceId: instanceId || 'all',
    })),

  clearSpxRecalculateRequest: () =>
    set({
      spxRequestedRecalculateInstanceId: null,
    }),

  clearAnalysisResult: (resultId) =>
    set((state) => {
      const targetRecord = state.analysisResults[resultId];
      const nextAnalysis = { ...state.analysisResults };
      delete nextAnalysis[resultId];

      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      const nextSpxResults = { ...state.spxResults };

      for (const [key, id] of Object.entries(nextActiveResultIds)) {
        if (id === resultId) {
          delete nextActiveResultIds[key];
          const [keyPlanId, instanceId] = key.split(':');
          if (keyPlanId === state.activePlanId) {
            delete nextSpxResults[instanceId];
          }
        }
      }

      if (targetRecord && targetRecord.planId === state.activePlanId) {
        const instId = targetRecord.instanceId;
        if (
          nextSpxResults[instId] &&
          (nextSpxResults[instId] === targetRecord.data ||
            nextSpxResults[instId]?.cacheKey === targetRecord.data?.cacheKey)
        ) {
          delete nextSpxResults[instId];
        }
      }

      return {
        analysisResults: nextAnalysis,
        spxActiveResultIds: nextActiveResultIds,
        spxResults: nextSpxResults,
      };
    }),

  clearPlanAnalysisResults: (planId) =>
    set((state) => {
      const nextAnalysis = { ...state.analysisResults };
      for (const k in nextAnalysis) {
        if (nextAnalysis[k].planId === planId) delete nextAnalysis[k];
      }

      const nextActiveResultIds = { ...(state.spxActiveResultIds || {}) };
      const nextSpxResults = { ...state.spxResults };

      for (const key of Object.keys(nextActiveResultIds)) {
        if (key.startsWith(`${planId}:`)) {
          delete nextActiveResultIds[key];
          if (planId === state.activePlanId) {
            const instanceId = key.split(':')[1];
            delete nextSpxResults[instanceId];
          }
        }
      }

      return {
        analysisResults: nextAnalysis,
        spxActiveResultIds: nextActiveResultIds,
        spxResults: nextSpxResults,
      };
    }),

  setIsCalculatingSpx: (calculating) =>
    set((state) =>
      state.isCalculatingSpx === calculating ? state : { isCalculatingSpx: calculating }
    ),

  // === Simulation Run Lifecycle & Provenance (Checkpoint 2C.1) ===
  registerSimulationRun: (params) => {
    const state = get();
    const scenario = state.scenarios[params.scenarioId];
    if (!scenario) {
      throw new Error(`Cannot register SimulationRun: Scenario ${params.scenarioId} not found`);
    }
    if (scenario.status === 'trashed') {
      throw new Error(`Cannot register SimulationRun: Scenario ${params.scenarioId} is trashed`);
    }

    const plan = state.plans[params.planId];
    if (!plan) {
      throw new Error(`Cannot register SimulationRun: Plan ${params.planId} not found`);
    }
    if (plan.status === 'trashed') {
      throw new Error(`Cannot register SimulationRun: Plan ${params.planId} is trashed`);
    }
    if (plan.scenarioId !== params.scenarioId) {
      throw new Error(
        `Cannot register SimulationRun: Plan ${params.planId} belongs to Scenario ${plan.scenarioId}, not ${params.scenarioId}`
      );
    }

    if (params.customRunId && state.simulationRuns[params.customRunId]) {
      throw new Error(
        `Cannot register SimulationRun: Run ${params.customRunId} already exists in active registry`
      );
    }

    const runId = params.customRunId ?? `sim_run_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const runToken = `rt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    const configSnapshot: SimulationConfigSnapshot = params.configSnapshot
      ? JSON.parse(JSON.stringify(params.configSnapshot))
      : { timeStepSeconds: 1, durationSeconds: 60 };
    const legacyConfig: Record<string, unknown> = JSON.parse(JSON.stringify(configSnapshot));
    const initialStatus = params.initialStatus ?? 'pending';
    const now = Date.now();
    const importGen = state.lastImportGen ?? 0;
    const planInputFingerprint = computePlanInputFingerprint(
      state,
      params.planId,
      configSnapshot,
      params.randomSeed
    );

    const newRun: SimulationRun = {
      id: runId,
      scenarioId: params.scenarioId,
      planId: params.planId,
      timestamp: now,
      config: legacyConfig,
      status: initialStatus,
      planVersion: plan.version,
      // scenarioVersion: Scenario does not currently maintain an explicit revision counter (known limitation)
      modelVersion: 'v2.0-canonical',
      simulationVersion: '1.0.0',
      campaignId: params.campaignId,
      randomSeed: params.randomSeed,
      configSnapshot,
      startedAt: initialStatus === 'running' ? now : undefined,
      completedAt: undefined,
      eventCount: 0,
      diagnostics: { durationMs: 0, warnings: [], errors: [] },
      workspaceGeneration: state.workspaceContextGeneration ?? 0,
      importGen,
      planInputFingerprint,
      runToken,
    };

    deepFreeze(newRun);

    let shouldActivate = false;
    if (params.autoActivate) {
      if (state.activeScenarioId === params.scenarioId && state.activePlanId === params.planId) {
        shouldActivate = true;
      }
    }

    set((s) => ({
      simulationRuns: {
        ...s.simulationRuns,
        [runId]: newRun,
      },
      activeSimulationRunId: shouldActivate ? runId : s.activeSimulationRunId,
    }));

    const handle: SimulationRunHandle = {
      runId,
      runToken,
      importGen,
    };
    (handle as any).toString = () => runId;
    return handle;
  },

  updateSimulationRunStatus: (runIdOrHandle, nextStatus, options) => {
    let runId: string;
    let providedToken: string | undefined = options?.runToken;
    let providedImportGen: number | undefined;
    if (typeof runIdOrHandle === 'object' && runIdOrHandle !== null) {
      runId = runIdOrHandle.runId;
      if (runIdOrHandle.runToken) {
        providedToken = runIdOrHandle.runToken;
      }
      if (runIdOrHandle.importGen !== undefined) {
        providedImportGen = runIdOrHandle.importGen;
      }
    } else {
      runId = runIdOrHandle;
    }

    const state = get();
    const currentRun = state.simulationRuns[runId];
    if (!currentRun) {
      throw new Error(`SimulationRun not found: ${runId}`);
    }

    // Caller generation check: reject if handle was issued in an obsolete workspace generation replaced by import
    if (
      providedImportGen !== undefined &&
      state.lastImportGen !== undefined &&
      providedImportGen !== state.lastImportGen
    ) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Workspace was replaced by import after registration (caller generation: ${providedImportGen}, current: ${state.lastImportGen})`
      );
    }

    // Incarnation enforcement (Blocker 2):
    // If run has runToken (newly created run), caller MUST present matching token.
    // Stale callers cannot update a replaced run with the same ID.
    // Legacy runs (without runToken) remain updateable without token for backwards compatibility.
    // However, if caller presents an active runToken for an imported historical run that has no runToken, reject it.
    if (currentRun.runToken !== undefined) {
      if (!providedToken || providedToken !== currentRun.runToken) {
        throw new Error(
          `Cannot update SimulationRun ${runId}: Invalid or missing execution incarnation token (expected ${currentRun.runToken}, got ${providedToken ?? 'none'})`
        );
      }
    } else if (providedToken !== undefined) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Record is an imported historical run without an active execution incarnation token`
      );
    }

    // Workspace replacement guard (Blocker 1):
    // Only import replacements or explicit generation expectations block completion;
    // plan context switching does not invalidate legitimate historical execution.
    if (options?.expectedWorkspaceGeneration !== undefined) {
      if (options.expectedWorkspaceGeneration !== state.workspaceContextGeneration) {
        throw new Error(
          `Cannot update SimulationRun ${runId}: Workspace generation mismatch (expected ${options.expectedWorkspaceGeneration}, current is ${state.workspaceContextGeneration})`
        );
      }
    }
    if (
      currentRun.importGen !== undefined &&
      state.lastImportGen !== undefined &&
      currentRun.importGen !== (state.lastImportGen ?? 0)
    ) {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Workspace was replaced by import after registration (run import generation: ${currentRun.importGen}, current: ${state.lastImportGen ?? 0})`
      );
    }

    // Source ownership validation: plan and scenario must exist and not be trashed
    const plan = state.plans[currentRun.planId];
    if (!plan || plan.status === 'trashed') {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Plan ${currentRun.planId} does not exist or is trashed`
      );
    }
    const scenario = state.scenarios[currentRun.scenarioId];
    if (!scenario || scenario.status === 'trashed') {
      throw new Error(
        `Cannot update SimulationRun ${runId}: Scenario ${currentRun.scenarioId} does not exist or is trashed`
      );
    }

    // Historical legacy record policy:
    // Historical legacy records lacking execution lifecycle status are read-only;
    // they cannot arbitrarily jump through the state machine.
    if (!currentRun.status) {
      throw new Error(
        `Cannot transition SimulationRun ${runId}: Historical legacy run without execution lifecycle status is read-only`
      );
    }

    const TERMINAL_STATUSES: Set<SimulationRunStatus> = new Set(['completed', 'failed', 'cancelled']);
    if (currentRun.status && TERMINAL_STATUSES.has(currentRun.status)) {
      throw new Error(
        `Cannot transition terminal SimulationRun ${runId} (status: ${currentRun.status}) to ${nextStatus}`
      );
    }

    // State machine transition validation
    if (currentRun.status === 'pending') {
      if (nextStatus !== 'running' && nextStatus !== 'cancelled') {
        throw new Error(
          `Invalid transition for SimulationRun ${runId}: pending cannot transition directly to ${nextStatus}`
        );
      }
    } else if (currentRun.status === 'running') {
      if (nextStatus === 'pending' || nextStatus === 'running') {
        throw new Error(
          `Invalid transition for SimulationRun ${runId}: running cannot transition to ${nextStatus}`
        );
      }
    }

    // Stale completion guard (Blocker 3):
    // Reject completion if plan inputs or plan version have changed since run was registered
    if (nextStatus === 'completed') {
      if (!isSimulationRunFresh(state, currentRun)) {
        throw new Error(
          `Cannot complete SimulationRun ${runId}: Plan inputs or version have changed since run was registered (stale)`
        );
      }
    }

    // Payload validation: eventCount must be finite non-negative integer
    if (options?.eventCount !== undefined) {
      if (
        typeof options.eventCount !== 'number' ||
        !Number.isFinite(options.eventCount) ||
        !Number.isInteger(options.eventCount) ||
        options.eventCount < 0
      ) {
        throw new Error(
          `SimulationRun eventCount must be a finite non-negative integer, got: ${options.eventCount}`
        );
      }
    }

    const isTerminal = TERMINAL_STATUSES.has(nextStatus);

    // Lifecycle constraints: completedAt and resultSummary are ONLY allowed for terminal statuses
    if (!isTerminal) {
      if (options?.completedAt !== undefined) {
        throw new Error(
          `Cannot provide completedAt for non-terminal SimulationRun status: ${nextStatus}`
        );
      }
      if (options?.resultSummary !== undefined) {
        throw new Error(
          `Cannot provide resultSummary for non-terminal SimulationRun status: ${nextStatus}`
        );
      }
    }

    let completedAt = currentRun.completedAt;
    if (isTerminal) {
      if (options?.completedAt !== undefined) {
        if (
          typeof options.completedAt !== 'number' ||
          !Number.isFinite(options.completedAt) ||
          options.completedAt <= 0
        ) {
          throw new Error(
            `SimulationRun completedAt must be a valid positive finite timestamp, got: ${options.completedAt}`
          );
        }
        completedAt = options.completedAt;
      } else {
        completedAt = Date.now();
      }

      if (currentRun.startedAt && completedAt < currentRun.startedAt) {
        throw new Error(
          `SimulationRun completedAt (${completedAt}) cannot be earlier than startedAt (${currentRun.startedAt})`
        );
      }
    }

    let startedAt = currentRun.startedAt;
    if (nextStatus === 'running' && !startedAt) {
      startedAt = Date.now();
    }

    const resultSummary = options?.resultSummary
      ? JSON.parse(JSON.stringify(options.resultSummary))
      : currentRun.resultSummary;
    const diagnostics = options?.diagnostics
      ? JSON.parse(JSON.stringify(options.diagnostics))
      : currentRun.diagnostics;
    const eventCount = options?.eventCount !== undefined
      ? options.eventCount
      : (currentRun.eventCount ?? 0);

    const updatedRun: SimulationRun = {
      ...currentRun,
      status: nextStatus,
      startedAt,
      completedAt,
      eventCount,
      resultSummary,
      diagnostics,
    };

    deepFreeze(updatedRun);

    set((s) => {
      if (!s.simulationRuns[runId]) {
        throw new Error(`SimulationRun not found during atomic update: ${runId}`);
      }
      return {
        simulationRuns: {
          ...s.simulationRuns,
          [runId]: updatedRun,
        },
      };
    });
  },

  setActiveSimulationRunId: (runId) => {
    if (runId === null) {
      set({ activeSimulationRunId: null });
      return;
    }
    const state = get();
    const run = state.simulationRuns[runId];
    if (!run) {
      throw new Error(`Cannot set active SimulationRun: Run ${runId} not found`);
    }
    if (!state.activeScenarioId || !state.activePlanId) {
      throw new Error(
        `Cannot activate SimulationRun ${runId}: No active Scenario and Plan context`
      );
    }
    if (run.planId !== state.activePlanId || run.scenarioId !== state.activeScenarioId) {
      throw new Error(
        `Cannot activate SimulationRun ${runId}: Context mismatch (run belongs to Plan ${run.planId}/Scenario ${run.scenarioId}, active context is Plan ${state.activePlanId}/Scenario ${state.activeScenarioId})`
      );
    }
    const freshness = evaluateSimulationRunFreshness(state, run);
    if (freshness !== 'current') {
      if (freshness === 'unknown') {
        throw new Error(
          `Cannot activate SimulationRun ${runId}: Run is not fresh (unverified provenance)`
        );
      }
      throw new Error(
        `Cannot activate SimulationRun ${runId}: Run is stale (inputs or plan have changed since registration)`
      );
    }
    set({ activeSimulationRunId: runId });
  },

  // Quản lý Bố Cục Modal
  showLayoutModal: false,
  setShowLayoutModal: (show) => set({ showLayoutModal: show }),
  toggleLayoutModal: () => set((state) => ({ showLayoutModal: !state.showLayoutModal })),

  setTargetHeightMeters: (heightMeters) =>
    set({ targetHeightMeters: Math.max(10, heightMeters) }),
  toggleBlindZones: () =>
    set((state) => ({ showBlindZones: !state.showBlindZones })),
  toggleConeOfSilence: () =>
    set((state) => ({ showConeOfSilence: !state.showConeOfSilence })),
  setAzimuthStepDeg: (step) =>
    set({ azimuthStepDeg: Math.max(1, Math.min(15, step)) }),
  setElevationStepDeg: (step) =>
    set({ elevationStepDeg: Math.max(1, Math.min(10, step)) }),
  setKFactor: (k) => set({ kFactor: Math.max(1.0, Math.min(2.0, k)) }),
  setCoverageResult: (instanceId, result) =>
    set((state) => {
      if (state.coverageResults[instanceId] === result) {
        return state;
      }
      return {
        coverageResults: { ...state.coverageResults, [instanceId]: result },
      };
    }),
  setCoverageField: (instanceId, field) =>
    set((state) => {
      if (
        state.coverageFields[instanceId]?.cacheKey === field.cacheKey &&
        state.coverageFieldCache[field.cacheKey] === field
      ) {
        return state;
      }
      return {
        coverageFields: { ...state.coverageFields, [instanceId]: field },
        coverageFieldCache: { ...state.coverageFieldCache, [field.cacheKey]: field },
      };
    }),
  setIsCalculatingLOS: (calculating) =>
    set((state) =>
      state.isCalculatingLOS === calculating ? state : { isCalculatingLOS: calculating }
    ),
  setShowRadarFieldModal: (show) => set({ showRadarFieldModal: show }),
  setShowCrossSection: (show) => set({ showCrossSection: show }),
  toggleCrossSection: () =>
    set((state) => ({ showCrossSection: !state.showCrossSection })),
  setSelectedAzimuthDeg: (azimuthDeg) =>
    set({ selectedAzimuthDeg: ((azimuthDeg % 360) + 360) % 360 }),
  setCrossSectionProbePoint: (point) => set({ crossSectionProbePoint: point }),
  clearCrossSectionProbePoint: () => set({ crossSectionProbePoint: null }),
  clearCoverageResults: () =>
    set({ coverageResults: {}, coverageFields: {} }),

  // === Kiểu vòm tham chiếu: setter có kẹp biên theo đúng bảng tham số ở DOME_STYLE_DEFAULTS ===
  setDomeAlpha: (alpha) =>
    set({ domeAlpha: Math.min(0.9, Math.max(0.05, alpha)) }),
  setDomeAzimuthSegments: (segments) =>
    set({ domeAzimuthSegments: Math.min(192, Math.max(32, Math.round(segments))) }),
  setDomeElevationRings: (rings) =>
    set({ domeElevationRings: Math.min(32, Math.max(4, Math.round(rings))) }),
  setDomeRimColor: (color) => set({ domeRimColor: color }),
  setDomeRimPower: (power) =>
    set({ domeRimPower: Math.min(8, Math.max(0.5, power)) }),
  setDomeScanLineCount: (count) =>
    set({ domeScanLineCount: Math.min(40, Math.max(1, Math.round(count))) }),
  setDomeScanLineSpeed: (speed) =>
    set({ domeScanLineSpeed: Math.min(5, Math.max(-5, speed)) }),
  setDomeScanLineAnimated: (animated) => set({ domeScanLineAnimated: animated }),
  toggleDomeScanLineAnimated: () =>
    set((state) => ({ domeScanLineAnimated: !state.domeScanLineAnimated })),
  setShowDomeFootprint: (show) => set({ showDomeFootprint: show }),
  setDomeTerrainMasked: (masked) => set({ domeTerrainMasked: masked }),
  setDomeColorOverride: (color) => set({ domeColorOverride: color }),
  resetDomeStyleDefaults: () =>
    set({
      ...DOME_STYLE_DEFAULTS,
      // Bật lại đúng trạng thái mặc định "kiểu video": không khối mù đỏ, có vòng nón mù đỉnh đầu
      showBlindZones: false,
      showConeOfSilence: true,
    }),

  // === Cố vấn vị trí đặt khí tài bằng AI local (VECTOR AI) ===
  setAiAdvisorPanelOpen: (open) => set({ aiAdvisorPanelOpen: open }),
  toggleAiAdvisorPanel: () =>
    set((state) => ({ aiAdvisorPanelOpen: !state.aiAdvisorPanelOpen })),
  setAiAdvisorTemplateId: (templateId) => set({ aiAdvisorTemplateId: templateId }),

  clearAiPlacementSuggestions: () =>
    set({
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorStatus: 'idle',
    }),

  runAiPlacementAnalysis: async (model) => {
    const state = get();
    const reqScenarioId = state.activeScenarioId;
    const reqPlanId = state.activePlanId;
    const reqGen = state.workspaceContextGeneration;
    const isStale = () => {
      const now = get();
      return (
        now.workspaceContextGeneration !== reqGen ||
        now.activePlanId !== reqPlanId ||
        now.activeScenarioId !== reqScenarioId
      );
    };
    const template = resolveAdvisorTemplate(state);

    // Ghi lại template đã chọn để UI phản ánh đúng khí tài vừa dùng
    set({ aiAdvisorTemplateId: template.id, aiAdvisorStatus: 'checking', aiAdvisorError: null });

    // 1. Kiểm tra backend (health)
    const health = await checkVectorAiHealth();
    if (isStale()) return;
    if (!health.ok) {
      // Backend local không trả lời (kể cả timeout) => coi như chưa kết nối
      const isOffline = health.error.kind === 'offline' || health.error.kind === 'timeout';
      set({
        aiAdvisorStatus: isOffline ? 'offline' : 'error',
        aiAdvisorError: health.error.message,
      });
      return;
    }

    // 2. Dựng prompt từ state tác chiến hiện tại
    const viewport = getAdvisorViewport();
    const context: AiPlacementContext = {
      equipment: {
        templateId: template.id,
        name: template.name,
        category: template.categoryNameVi || template.category,
        rangeKm: template.defaultRangeKm,
        minElevationDeg: template.minElevationDeg,
        maxElevationDeg: template.maxElevationDeg,
        coverageHeightKm: template.coverageHeightKm,
        antennaHeightAGL: template.antennaHeightAGL,
      },
      placed: selectActiveEquipment(state).map((item) => ({
        shortId: item.shortId,
        name: item.name,
        category: item.category,
        latitude: item.latitude,
        longitude: item.longitude,
        altitude: item.altitude,
        rangeKm: item.rangeKm,
        status: item.status,
      })),
      viewport,
      areaRadiusKm: deriveAdvisorRadiusKm(viewport.heightM),
    };

    set({ aiAdvisorStatus: 'thinking' });

    // 3. Hỏi model qua SSE
    const answer = await askVectorAi({
      model,
      messages: buildPlacementMessages(context),
    });
    if (isStale()) return;
    if (!answer.ok) {
      set({
        aiAdvisorStatus:
          answer.error.kind === 'offline' || answer.error.kind === 'timeout' ? 'offline' : 'error',
        aiAdvisorError: answer.error.message,
      });
      return;
    }

    // 4. Parse JSON an toàn
    const parsed = parsePlacementAdvice(answer.value.text);
    if (!parsed.ok) {
      set({ aiAdvisorStatus: 'error', aiAdvisorError: parsed.message });
      return;
    }

    if (isStale()) return;
    set({
      aiAdvisorStatus: 'ready',
      aiAdvisorError: null,
      aiAdvisorSummary: parsed.value.summary,
      aiAdvisorSuggestions: parsed.value.suggestions,
      aiAdvisorRoute: parsed.value.route,
    });
  },

  placeEquipmentAtSuggestion: (index) => {
    const state = get();
    const suggestion = state.aiAdvisorSuggestions[index];
    if (!suggestion) return;
    if (!Number.isFinite(suggestion.latitude) || !Number.isFinite(suggestion.longitude)) return;

    const template = resolveAdvisorTemplate(state);
    const latitude = Math.min(90, Math.max(-90, suggestion.latitude));
    const longitude = Math.min(180, Math.max(-180, suggestion.longitude));

    // GIẢ ĐỊNH: gợi ý của AI chỉ có lat/lon nên cao độ mặt đất chưa biết -> đặt 0 m.
    // Người dùng có thể dùng công cụ "Di chuyển đài" để trạm lại đúng cao độ DEM.
    const instance = createEquipmentFromTemplate(template, {
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      altitude: 0,
      nameIndex: selectActiveEquipment(state).length + 1,
    });

    // Tái dùng đúng action addEquipment sẵn có (tự sinh shortId, gán profile, chọn khí tài)
    get().addEquipment(instance);
  },

  addMeasurePoint: (point) =>
    set((state) => ({ measurePoints: [...state.measurePoints, point] })),

  clearMeasurePoints: () => set({ measurePoints: [] }),

  triggerFlyTo: (location) => set({ flyToTarget: location }),
  clearFlyTo: () => set({ flyToTarget: null }),

  clearAll: () => {
    const state = get();
    validateMutationGuard(state);
    invalidateVolumeCache();
    set((state) => {

      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextVisuals = { ...state.visuals };

      for (const p of Object.values(state.placements)) {
        if (p.planId === state.activePlanId) {
          delete nextPlacements[p.id];
          delete nextVisuals[p.id];
          // Safe Definition deletion: only delete if no other Placement in ANY Plan still references it
          const hasOtherRefs = Object.values(state.placements).some(
            other => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
          // DO NOT delete observations (historical data must survive)
        }
      }

      // Rebuild instances atomically
      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        visuals: nextVisuals,
        selectedInstanceId: null,
        pendingTemplate: null,
        activeTool: 'select' as const,
        measurePoints: [],
        coverageVolumes: {},
        samEngagementModes: {},
      };

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: state.activePlanId! },
        'CLEAR_ALL',
        'PLAN',
        [state.activePlanId!]
      );

      return { ...nextState, ...auditUpdates };
    });
  },

  importFromLayout: (layout) => {
    set((state) => {
      validateMutationGuard(state);
      const planId = state.activePlanId!;

      const nextPlacements: Record<string, EquipmentPlacement> = { ...state.placements };
      const nextDefinitions: Record<string, EquipmentDefinition> = { ...state.definitions };
      const nextVisuals: Record<string, LegacyPresentationState> = { ...state.visuals };
      const nextObservations: Record<string, ObservationState> = { ...state.observations };

      // VALIDATION PHASE
      const sourceIds = new Set<string>();
      for (const item of layout.equipments) {
        if (!item.instanceId) throw new Error('importFromLayout: empty source instance ID');
        if (sourceIds.has(item.instanceId)) throw new Error(`importFromLayout: duplicate source instance ID ${item.instanceId}`);
        sourceIds.add(item.instanceId);
      }
      for (const item of layout.equipments) {
        if (item.commandedByInstanceId && !sourceIds.has(item.commandedByInstanceId)) {
          throw new Error(`importFromLayout: dangling commandedByInstanceId ${item.commandedByInstanceId}`);
        }
      }

      // Cleanup current plan items
      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          delete nextPlacements[p.id];
          delete nextVisuals[p.id];
          // Safe Definition deletion: only delete if no other Placement in ANY Plan still references it
          const hasOtherRefs = Object.values(state.placements).some(
            other => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
          // Rule 1: DO NOT delete observations (historical data must survive)
        }
      }

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const idMap: Record<string, string> = {};

      layout.equipments.forEach((saved, index) => {
        const template = EQUIPMENT_TEMPLATES.find((t) => t.id === saved.templateId) || EQUIPMENT_TEMPLATES[0];

        const statusMap = ['Active', 'Standby', 'Maintenance', 'Offline'] as const;
        const status = statusMap[saved.status] || 'Active';
        const prefix = CATEGORY_META[template.category]?.prefix || 'EQ';
        const autoShortId = `${prefix}-${(index + 1).toString().padStart(2, '0')}`;

        const newPlacementId = generateUniqueId('P_import', nextPlacements);
        const newDefId = generateUniqueId('D_import', nextDefinitions);

        idMap[saved.instanceId] = newPlacementId;

        const legacyItem: EquipmentInstance = {
          instanceId: newPlacementId,
          templateId: saved.templateId,
          shortId: saved.shortId || autoShortId,
          name: template.name,
          category: template.category,
          latitude: saved.latitude,
          longitude: saved.longitude,
          altitude: saved.groundElevationMeters || 0,
          antennaHeightAGL: saved.antennaHeightAGL || template.antennaHeightAGL,
          rangeKm: saved.currentRange || template.defaultRangeKm,
          scanSpeed: saved.currentScanSpeed ?? template.defaultScanSpeed,
          minElevationDeg: saved.currentMinElevation ?? template.minElevationDeg,
          maxElevationDeg: saved.currentMaxElevation ?? template.maxElevationDeg,
          coverageHeightKm: saved.currentCoverageHeight || template.coverageHeightKm,
          status,
          commandedByInstanceId: saved.commandedByInstanceId,
          color: template.symbolColor,
          showDome: true,
          showSweep: true,
          coverageProfile: template.coverageProfile,
          altitudeDetectionTable: template.altitudeDetectionTable,
        };

        const parsed = parseLegacyInstance(legacyItem, planId);
        parsed.definition.id = newDefId;
        parsed.placement.definitionId = newDefId;

        nextPlacements[newPlacementId] = parsed.placement;
        nextDefinitions[newDefId] = parsed.definition;
        nextObservations[newPlacementId] = parsed.observation;
        nextVisuals[newPlacementId] = parsed.visual;
      });

      layout.equipments.forEach((saved) => {
        if (saved.commandedByInstanceId) {
          const newId = idMap[saved.instanceId];
          const newCommandedBy = idMap[saved.commandedByInstanceId];
          if (newId && newCommandedBy && nextPlacements[newId]) {
            nextPlacements[newId].network = {
              ...nextPlacements[newId].network,
              commandedBy: newCommandedBy
            };
          }
        }
      });

      // Rule 2 & 3: select first placement belonging to Plan after import
      const firstPlanPlacement = Object.values(nextPlacements).find(p => p.planId === planId);
      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        selectedInstanceId: firstPlanPlacement ? firstPlanPlacement.id : null,
        samEngagementModes: {},
      };

      const importedIds = Object.keys(idMap).map(k => idMap[k]);

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'IMPORT',
        'EQUIPMENT',
        importedIds,
        'UNKNOWN',
        'IMPORT'
      );

      return { ...nextState, ...auditUpdates };
    });
  },

  exportToLayout: (layoutName) => {
    const state = get();
    const statusMap = { Active: 0, Standby: 1, Maintenance: 2, Offline: 3 };

    const entries: SavedEquipmentEntry[] = selectActiveEquipment(state).map((item) => ({
      instanceId: item.instanceId,
      templateId: item.templateId,
      shortId: item.shortId,
      posX: 0,
      posY: 0,
      posZ: 0,
      latitude: item.latitude,
      longitude: item.longitude,
      groundElevationMeters: item.altitude,
      antennaHeightAGL: item.antennaHeightAGL,
      currentRange: item.rangeKm,
      currentScanSpeed: item.scanSpeed,
      currentMinElevation: item.minElevationDeg,
      currentMaxElevation: item.maxElevationDeg,
      currentCoverageHeight: item.coverageHeightKm,
      status: statusMap[item.status] ?? 0,
      commandedByInstanceId: item.commandedByInstanceId || null,
    }));

    return {
      layoutName: layoutName || 'Bố cục phòng không VomKQ',
      savedAtIso8601: new Date().toISOString(),
      equipments: entries,
    };
  },

  loadSampleScenario: () => {
    // Kịch bản bố trí phòng không bảo vệ miền Bắc kết hợp các cao điểm địa hình thực
    const c2Id = 'eq_c2_hanoi';
    const sample: EquipmentInstance[] = [
      {
        instanceId: c2Id,
        shortId: 'CP-01',
        templateId: 'c2_command_post',
        name: 'Sở Chỉ Huy Trung Đoàn PK Sóc Sơn',
        category: 'SoChiHuy',
        latitude: 21.284,
        longitude: 105.85,
        altitude: 45,
        antennaHeightAGL: 30,
        rangeKm: 120,
        scanSpeed: 0,
        minElevationDeg: 0,
        maxElevationDeg: 90,
        coverageHeightKm: 20,
        status: 'Active',
        commandedByInstanceId: null,
        color: '#eab308',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'c2_command_post')?.coverageProfile,
      },
      {
        instanceId: 'eq_radar_tamdao',
        shortId: 'R-01',
        templateId: 'radar_36d6',
        name: 'Đài Radar 36D6 Đỉnh Tam Đảo (Cao độ ~950m)',
        category: 'RadarCanhGioi',
        latitude: 21.458,
        longitude: 105.645,
        altitude: 950,
        antennaHeightAGL: 25,
        rangeKm: 300,
        scanSpeed: 36,
        minElevationDeg: 0.5,
        maxElevationDeg: 30,
        coverageHeightKm: 30,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#06b6d4',
        showDome: true,
        showSweep: true,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6')?.coverageProfile,
      },
      {
        instanceId: 'eq_radar_fansipan',
        shortId: 'ESM-01',
        templateId: 'radar_kolchuga',
        name: 'Trạm Trinh Sát Thụ Động Kolchuga-M Fansipan (3.143m)',
        category: 'CamBienThuDong',
        latitude: 22.303,
        longitude: 103.775,
        altitude: 3140,
        antennaHeightAGL: 20,
        rangeKm: 600,
        scanSpeed: 0,
        minElevationDeg: 0,
        maxElevationDeg: 45,
        coverageHeightKm: 40,
        frequencyRangeGhz: '0.1 - 18.0 GHz (VHF/UHF/SHF)',
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#a855f7',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_kolchuga')?.coverageProfile,
      },
      {
        instanceId: 'eq_radar_bavi_esm',
        shortId: 'ESM-02',
        templateId: 'radar_kolchuga',
        name: 'Trạm Trinh Sát Thụ Động Kolchuga-M Ba Vì (1.200m)',
        category: 'CamBienThuDong',
        latitude: 21.08,
        longitude: 105.36,
        altitude: 1200,
        antennaHeightAGL: 20,
        rangeKm: 600,
        scanSpeed: 0,
        minElevationDeg: 0,
        maxElevationDeg: 45,
        coverageHeightKm: 40,
        frequencyRangeGhz: '0.1 - 18.0 GHz (VHF/UHF/SHF)',
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#a855f7',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_kolchuga')?.coverageProfile,
      },
      {
        instanceId: 'eq_radar_haiphong',
        shortId: 'R-02',
        templateId: 'radar_p18',
        name: 'Trạm Radar P-18M Đồ Sơn - Hải Phòng',
        category: 'RadarCanhGioi',
        latitude: 20.71,
        longitude: 106.78,
        altitude: 60,
        antennaHeightAGL: 18,
        rangeKm: 250,
        scanSpeed: 24,
        minElevationDeg: 0,
        maxElevationDeg: 25,
        coverageHeightKm: 25,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#0ea5e9',
        showDome: true,
        showSweep: true,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_p18')?.coverageProfile,
      },
      {
        instanceId: 'eq_radar_danang_spx',
        shortId: 'R-03',
        templateId: 'radar_36d6',
        name: 'Trạm Radar Sơn Trà - Đà Nẵng (Ảnh mẫu SPx)',
        category: 'RadarCanhGioi',
        latitude: 16.043,
        longitude: 108.1208,
        altitude: 103,
        antennaHeightAGL: 40,
        rangeKm: 50,
        scanSpeed: 30,
        minElevationDeg: -10,
        maxElevationDeg: 40,
        coverageHeightKm: 20,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#06b6d4',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6')?.coverageProfile,
      },
      {
        instanceId: 'eq_sam_s300_hanoi',
        shortId: 'SAM-01',
        templateId: 'sam_s300',
        name: 'Trận Địa Tên Lửa S-300PMU2 Đông Anh',
        category: 'TenLuaPhongKhong',
        latitude: 21.14,
        longitude: 105.83,
        altitude: 20,
        antennaHeightAGL: 8,
        rangeKm: 200,
        minEngagementRangeKm: 3,
        maxEngagementAltitudeM: 27000,
        reactionTimeSeconds: 5,
        guidanceMethodVi: 'Radar Track-via-Missile (TVM) 48N6E2',
        scanSpeed: 0,
        minElevationDeg: 3,
        maxElevationDeg: 65,
        coverageHeightKm: 27,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#ef4444',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_s300')?.coverageProfile,
      },
      {
        instanceId: 'eq_sam_spyder_haiphong',
        shortId: 'SAM-02',
        templateId: 'sam_spyder',
        name: 'Trận Địa Tên Lửa Spyder (SR/MR) Cảng Hải Phòng',
        category: 'TenLuaPhongKhong',
        latitude: 20.86,
        longitude: 106.72,
        altitude: 10,
        antennaHeightAGL: 5,
        rangeKm: 50,
        minEngagementRangeKm: 2,
        maxEngagementAltitudeM: 16000,
        minEngagementAltitudeM: 20,
        maxTargetSpeedMps: 800,
        reactionTimeSeconds: 9,
        guidanceMethodVi: 'Chủ động sóng milimet Derby-MR & Hồng ngoại IIR Python-5',
        scanSpeed: 0,
        minElevationDeg: 5,
        maxElevationDeg: 75,
        coverageHeightKm: 16,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#0ea5e9',
        showDome: true,
        showSweep: false,
        spyderConfig: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder')?.spyderConfig,
        samProfiles: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder')?.samProfiles,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder')?.coverageProfile,
      },
      {
        instanceId: 'eq_sam_c125_sontay',
        shortId: 'SAM-03',
        templateId: 'sam_c125_2tm',
        name: 'Trận Địa Tên Lửa C-125-2TM Pechora Sơn Tây',
        category: 'TenLuaPhongKhong',
        latitude: 21.135,
        longitude: 105.495,
        altitude: 35,
        antennaHeightAGL: 6,
        rangeKm: 35.4,
        minEngagementRangeKm: 3.5,
        maxEngagementAltitudeM: 25000,
        minEngagementAltitudeM: 20,
        optimalAltitudeM: 6000,
        maxTargetSpeedMps: 900,
        maxTargetParamKm: 25.0,
        reactionTimeSeconds: 5,
        deployTimeMinutes: 25,
        guidanceMethodVi: 'Lệnh vô tuyến bám qua đạn (Command Guidance) & Quang truyền hình Karat',
        scanSpeed: 0,
        minElevationDeg: 6.0,
        maxElevationDeg: 65.0,
        coverageHeightKm: 25,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#f43f5e',
        showDome: true,
        showSweep: false,
        samEngagementMode: 'head_on',
        samProfiles: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')?.samProfiles,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')?.coverageProfile,
      },
    ];

    set((state) => {
      validateMutationGuard(state);
      const planId = state.activePlanId!;

      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextObservations = { ...state.observations };
      const nextVisuals = { ...state.visuals };

      // Cleanup current plan items
      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          delete nextPlacements[p.id];
          delete nextVisuals[p.id];
          // Safe Definition deletion: only delete if no other Placement in ANY Plan still references it
          const hasOtherRefs = Object.values(state.placements).some(
            other => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
          // Preserve nextObservations (historical data must survive)
        }
      }

      const generateUniqueId = (prefix: string, existing: Record<string, any>) => {
        let id;
        do {
          id = prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 7);
        } while (existing[id]);
        return id;
      };

      const idMap: Record<string, string> = {};

      sample.forEach((item) => {
        const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId);

        const newPlacementId = generateUniqueId('P_sample', nextPlacements);
        const newDefId = generateUniqueId('D_sample', nextDefinitions);

        idMap[item.instanceId] = newPlacementId;

        const legacyItem = {
          ...item,
          instanceId: newPlacementId,
          realPhotoUrl: item.realPhotoUrl || tmpl?.realPhotoUrl,
          model3dUrl: item.model3dUrl || tmpl?.model3dUrl,
          model3dScale: item.model3dScale ?? tmpl?.model3dScale ?? 1.0,
        };

        const parsed = parseLegacyInstance(legacyItem, planId);
        parsed.definition.id = newDefId;
        parsed.placement.definitionId = newDefId;

        nextPlacements[legacyItem.instanceId] = parsed.placement;
        nextDefinitions[parsed.definition.id] = parsed.definition;
        nextObservations[legacyItem.instanceId] = parsed.observation;
        nextVisuals[legacyItem.instanceId] = parsed.visual;
      });

      sample.forEach((item) => {
        if (item.commandedByInstanceId) {
          const newId = idMap[item.instanceId];
          const newCommandedBy = idMap[item.commandedByInstanceId];
          if (newId && newCommandedBy && nextPlacements[newId]) {
            nextPlacements[newId].network = {
              ...nextPlacements[newId].network,
              commandedBy: newCommandedBy
            };
          }
        }
      });
      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        selectedInstanceId: idMap['eq_radar_tamdao'] || Object.values(idMap)[0] || null,
        samEngagementModes: {},
      };

      const importedIds = Object.keys(idMap).map(k => idMap[k]);

      const auditUpdates = appendAuditToState(
        state,
        nextState,
        { type: 'PLAN', id: planId },
        'IMPORT',
        'EQUIPMENT',
        importedIds,
        'SYSTEM',
        'SYSTEM'
      );

      return { ...nextState, ...auditUpdates };
    });
  },

  exportCanonicalPackage: (layoutName) => {
    const state = get();
    return structuredClone({
      schemaVersion: 1,
      metadata: {
        exportedAt: new Date().toISOString(),
        layoutName: layoutName || 'Exported Package',
      },
      context: {
        activeScenarioId: state.activeScenarioId,
        activePlanId: state.activePlanId,
        activeSimulationRunId: state.activeSimulationRunId,
      },
      scenarios: state.scenarios,
      plans: state.plans,
      placements: state.placements,
      definitions: state.definitions,
      observations: state.observations,
      simulationRuns: state.simulationRuns,
      simulations: state.simulations,
      visuals: state.visuals,
    });
  },

  exportCanonicalPackageV2: (layoutName) => {
    const state = get();
    return structuredClone({
      schemaVersion: 2,
      metadata: {
        exportedAt: new Date().toISOString(),
        layoutName: layoutName || 'Exported Package V2',
      },
      context: {
        activeScenarioId: state.activeScenarioId,
        activePlanId: state.activePlanId,
        activeSimulationRunId: state.activeSimulationRunId,
      },
      scenarios: state.scenarios,
      plans: state.plans,
      placements: state.placements,
      definitions: state.definitions,
      observations: state.observations,
      simulationRuns: state.simulationRuns,
      simulations: state.simulations,
      visuals: state.visuals,
      revisions: state.revisions,
      revisionHeads: state.revisionHeads,
      auditEvents: state.auditEvents,
      auditEventOrder: state.auditEventOrder,
    });
  },

  importCanonicalPackage: (pkg: CanonicalStatePackage) => {
    validateCanonicalStatePackage(pkg);
    const isV2 = pkg.schemaVersion === 2;
    const v2Pkg = isV2
      ? (pkg as CanonicalStatePackageV2)
      : migrateCanonicalPackageV1ToV2(pkg as CanonicalStatePackageV1);
    const clone = structuredClone(v2Pkg);

    set(() => {
      const nextState = {
        canonicalInitialized: true,
        activeScenarioId: clone.context.activeScenarioId,
        activePlanId: clone.context.activePlanId,
        activeSimulationRunId: clone.context.activeSimulationRunId,
        scenarios: clone.scenarios,
        plans: clone.plans,
        placements: clone.placements,
        definitions: clone.definitions,
        observations: clone.observations,
        simulationRuns: clone.simulationRuns,
        simulations: clone.simulations,
        visuals: clone.visuals,
        revisions: clone.revisions || {},
        revisionHeads: clone.revisionHeads || {},
        auditEvents: clone.auditEvents || {},
        auditEventOrder: clone.auditEventOrder || [],
        selectedInstanceId: null,
        coverageVolumes: {},
        spxResults: {},
        analysisResults: {},
        spxRequestedRecalculateInstanceId: null,
        spxRequestRegistry: {},
        spxSequenceCounters: {},
        spxAcceptedSequences: {},
        spxActiveResultIds: {},
        samVolumes: {},
        coverageResults: {},
        coverageFields: {},
        aiAdvisorSuggestions: [],
        aiAdvisorRoute: [],
        aiAdvisorSummary: '',
        aiAdvisorError: null,
        aiAdvisorStatus: 'idle' as const,
        workspaceContextGeneration: (get().workspaceContextGeneration || 0) + 1,
        lastImportGen: Math.max((get().lastImportGen || 0) + 1, (get().workspaceContextGeneration || 0) + 1),
        showWorkspaceModal: false,
        workspaceModalTab: 'plans' as const,
      };

      // Append IMPORT audit event on top of loaded history without overwriting prior records.
      // For V1 packages, this records the import itself without fabricating fake past history.
      const auditUpdates = appendAuditToState(
        get(),
        nextState,
        { type: 'WORKSPACE', id: 'canonical-root' },
        'IMPORT',
        'WORKSPACE',
        ['canonical-root'],
        'UNKNOWN',
        'IMPORT'
      );

      return { ...nextState, ...auditUpdates };
    });
  },
}));

// === Canonical Read Model (Selectors) ===

export const selectScenarios = (() => {
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: Scenario[] = [];

  return (state: TacticalState): Scenario[] => {
    if (lastScenarios === state.scenarios) {
      return lastResult;
    }
    lastScenarios = state.scenarios;
    lastResult = Object.values(state.scenarios).filter((s) => s.status !== 'trashed');
    return lastResult;
  };
})();

export const selectAllScenarios = (() => {
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: Scenario[] = [];

  return (state: TacticalState): Scenario[] => {
    if (lastScenarios === state.scenarios) {
      return lastResult;
    }
    lastScenarios = state.scenarios;
    lastResult = Object.values(state.scenarios);
    return lastResult;
  };
})();

export const selectPlansForActiveScenario = (() => {
  let lastPlans: Record<string, Plan> | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastResult: Plan[] = [];

  return (state: TacticalState): Plan[] => {
    if (
      lastPlans === state.plans &&
      lastActiveScenarioId === state.activeScenarioId
    ) {
      return lastResult;
    }
    lastPlans = state.plans;
    lastActiveScenarioId = state.activeScenarioId;
    lastResult = state.activeScenarioId
      ? Object.values(state.plans).filter(
        (p) =>
          p.scenarioId === state.activeScenarioId &&
          p.status !== 'trashed' &&
          p.status !== 'withdrawn' &&
          p.status !== 'archived'
      )
      : [];
    return lastResult;
  };
})();

export const selectAllPlansForActiveScenario = (() => {
  let lastPlans: Record<string, Plan> | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastResult: Plan[] = [];

  return (state: TacticalState): Plan[] => {
    if (
      lastPlans === state.plans &&
      lastActiveScenarioId === state.activeScenarioId
    ) {
      return lastResult;
    }
    lastPlans = state.plans;
    lastActiveScenarioId = state.activeScenarioId;
    lastResult = state.activeScenarioId
      ? Object.values(state.plans).filter((p) => p.scenarioId === state.activeScenarioId)
      : [];
    return lastResult;
  };
})();

export const selectActiveScenario = (state: TacticalState) =>
  state.activeScenarioId ? state.scenarios[state.activeScenarioId] || null : null;

export const selectActivePlan = (state: TacticalState) => {
  if (!state.activeScenarioId || !state.activePlanId) return null;
  const scenario = state.scenarios[state.activeScenarioId];
  if (!scenario) return null;
  const plan = state.plans[state.activePlanId];
  if (!plan) return null;
  if (plan.scenarioId !== state.activeScenarioId) return null;
  return plan;
};

export const selectActivePlacements = (() => {
  let lastPlacements: Record<string, EquipmentPlacement> | null = null;
  let lastActivePlanId: string | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastPlans: Record<string, Plan> | null = null;
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastResult: EquipmentPlacement[] = [];

  return (state: TacticalState): EquipmentPlacement[] => {
    if (
      lastPlacements === state.placements &&
      lastActivePlanId === state.activePlanId &&
      lastActiveScenarioId === state.activeScenarioId &&
      lastPlans === state.plans &&
      lastScenarios === state.scenarios
    ) {
      return lastResult;
    }
    lastPlacements = state.placements;
    lastActivePlanId = state.activePlanId;
    lastActiveScenarioId = state.activeScenarioId;
    lastPlans = state.plans;
    lastScenarios = state.scenarios;

    const activePlan = selectActivePlan(state);
    if (!activePlan) {
      lastResult = [];
    } else {
      lastResult = Object.values(state.placements).filter(p => p.planId === state.activePlanId);
    }
    return lastResult;
  };
})();

export const selectActiveEquipment = (() => {
  let lastActivePlanId: string | null = null;
  let lastActiveScenarioId: string | null = null;
  let lastPlans: Record<string, Plan> | null = null;
  let lastScenarios: Record<string, Scenario> | null = null;
  let lastPlacements: Record<string, EquipmentPlacement> | null = null;
  let lastDefinitions: Record<string, EquipmentDefinition> | null = null;
  let lastObservations: Record<string, ObservationState> | null = null;
  let lastVisuals: Record<string, LegacyPresentationState> | null = null;
  let lastActiveSimulationRunId: string | null = null;
  let lastSimulationRuns: Record<string, SimulationRun> | null = null;
  let lastSimulations: Record<string, Record<string, SimulationState>> | null = null;
  let lastImportGen: number | undefined = undefined;
  let lastActiveTerrainProviderKey: string | undefined = undefined;
  let lastPlanVersion: number | undefined = undefined;
  let lastScenarioStatus: string | undefined = undefined;
  let lastScenarioTerrainVersion: string | undefined = undefined;
  let lastResult: EquipmentInstance[] = [];

  return (state: TacticalState): EquipmentInstance[] => {
    const currentPlanVersion = state.activePlanId ? state.plans[state.activePlanId]?.version : undefined;
    const currentScenarioStatus = state.activeScenarioId ? state.scenarios[state.activeScenarioId]?.status : undefined;
    const currentScenarioTerrainVersion = state.activeScenarioId ? state.scenarios[state.activeScenarioId]?.terrainVersion : undefined;

    if (
      lastActivePlanId === state.activePlanId &&
      lastActiveScenarioId === state.activeScenarioId &&
      lastPlans === state.plans &&
      lastScenarios === state.scenarios &&
      lastPlacements === state.placements &&
      lastDefinitions === state.definitions &&
      lastObservations === state.observations &&
      lastVisuals === state.visuals &&
      lastActiveSimulationRunId === state.activeSimulationRunId &&
      lastSimulationRuns === state.simulationRuns &&
      lastSimulations === state.simulations &&
      lastImportGen === state.lastImportGen &&
      lastActiveTerrainProviderKey === state.activeTerrainProviderKey &&
      lastPlanVersion === currentPlanVersion &&
      lastScenarioStatus === currentScenarioStatus &&
      lastScenarioTerrainVersion === currentScenarioTerrainVersion
    ) {
      return lastResult;
    }

    lastActivePlanId = state.activePlanId;
    lastActiveScenarioId = state.activeScenarioId;
    lastPlans = state.plans;
    lastScenarios = state.scenarios;
    lastPlacements = state.placements;
    lastDefinitions = state.definitions;
    lastObservations = state.observations;
    lastVisuals = state.visuals;
    lastActiveSimulationRunId = state.activeSimulationRunId;
    lastSimulationRuns = state.simulationRuns;
    lastSimulations = state.simulations;
    lastImportGen = state.lastImportGen;
    lastActiveTerrainProviderKey = state.activeTerrainProviderKey;
    lastPlanVersion = currentPlanVersion;
    lastScenarioStatus = currentScenarioStatus;
    lastScenarioTerrainVersion = currentScenarioTerrainVersion;

    const placements = selectActivePlacements(state);
    if (placements.length === 0) {
      lastResult = [];
      return lastResult;
    }

    lastResult = placements
      .map(placement => {
        const definition = state.definitions[placement.definitionId];
        const observation = state.observations[placement.id];
        const visual = state.visuals[placement.id];
        const activeRun = state.activeSimulationRunId
          ? state.simulationRuns[state.activeSimulationRunId]
          : undefined;
        // Strictly require active Run record exists, ownership matches BOTH activePlanId and activeScenarioId, AND is fresh
        const isRunValidAndMatching = Boolean(
          activeRun &&
          activeRun.planId === state.activePlanId &&
          activeRun.scenarioId === state.activeScenarioId &&
          isSimulationRunFresh(state, activeRun)
        );
        const simulation = (state.activeSimulationRunId && isRunValidAndMatching)
          ? state.simulations[state.activeSimulationRunId]?.[placement.id]
          : undefined;
        if (!definition || !observation || !visual) return null;
        if (definition.planId !== placement.planId || definition.planId !== state.activePlanId) return null;

        return hydrateLegacyInstance(placement, definition, observation, visual, simulation);
      })
      .filter((inst): inst is EquipmentInstance => inst !== null);

    return lastResult;
  };
})();

export const selectEquipmentById = (state: TacticalState, id: string): EquipmentInstance | null => {
  return selectActiveEquipment(state).find(e => e.instanceId === id) || null;
};

export const selectDefinitionForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  const d = state.definitions[p.definitionId];
  if (!d || d.planId !== activePlan.id) return null;
  return d;
};

export const selectObservationForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  return state.observations[placementId] || null;
};

export const selectVisualForPlacement = (state: TacticalState, placementId: string) => {
  const activePlan = selectActivePlan(state);
  if (!activePlan) return null;
  const p = state.placements[placementId];
  if (!p || p.planId !== activePlan.id) return null;
  return state.visuals[placementId] || null;
};

// === Analysis Results & Freshness Selectors (Checkpoint 2B) ===

export const selectActivePlanAnalysisResults = (state: TacticalState): AnalysisResult[] => {
  if (!state.activePlanId) return [];
  return Object.values(state.analysisResults).filter((r) => r.planId === state.activePlanId);
};

export const selectInstanceAnalysisResult = (
  state: TacticalState,
  instanceId: string,
  analysisId = 'spx_radar_coverage'
): AnalysisResult | null => {
  if (!state.activePlanId) return null;

  // SELECTED RESULT = DISPLAYED OVERLAY
  // If overlay is not displayed for this instance in active plan, there is no selected result
  const activeOverlay = state.spxResults[instanceId];
  if (!activeOverlay) return null;

  const key = `${state.activePlanId}:${instanceId}`;
  const activeResId = state.spxActiveResultIds?.[key];
  if (activeResId && state.analysisResults[activeResId]) {
    const candidate = state.analysisResults[activeResId];
    if (
      candidate.planId === state.activePlanId &&
      candidate.instanceId === instanceId &&
      (candidate.data === activeOverlay || (activeOverlay.cacheKey && candidate.data?.cacheKey === activeOverlay.cacheKey))
    ) {
      return candidate;
    }
  }

  // Fallback: strictly match actual active overlay by payload reference or cacheKey
  const matches = Object.values(state.analysisResults).filter(
    (r) =>
      r.planId === state.activePlanId &&
      r.instanceId === instanceId &&
      r.analysisId === analysisId &&
      (r.data === activeOverlay || (activeOverlay.cacheKey && r.data?.cacheKey === activeOverlay.cacheKey))
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const seqA = a.sequenceNumber ?? 0;
    const seqB = b.sequenceNumber ?? 0;
    if (seqA !== seqB) {
      return seqB - seqA;
    }
    return b.calculatedAt - a.calculatedAt;
  });
  return matches[0];
};

export const selectAnalysisFreshness = (
  state: TacticalState,
  instanceId: string
): {
  freshness: FreshnessStatus;
  currentSnapshot: SpxAnalysisInputSnapshot | null;
  result: AnalysisResult | null;
  hasResult: boolean;
} => {
  if (!state.activeScenarioId || !state.activePlanId) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const plan = state.plans[state.activePlanId];
  const placement = state.placements[instanceId];
  if (!plan || !placement || placement.planId !== plan.id) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const definition = state.definitions[placement.definitionId];
  if (!definition) {
    return { freshness: 'unknown', currentSnapshot: null, result: null, hasResult: false };
  }
  const scenario = state.scenarios[state.activeScenarioId];
  const terrainVersion = scenario?.terrainVersion || 'v1';
  const terrainProviderKey = state.activeTerrainProviderKey;

  const visual = state.visuals[placement.id];
  const effectiveConfig = resolveEffectiveSpxConfigFromCanonical(
    state.spxConfig,
    placement,
    definition,
    visual?.spxConfig
  );

  const currentSnapshot = buildSpxInputSnapshot(
    state.activeScenarioId,
    plan,
    placement,
    definition,
    effectiveConfig,
    terrainVersion,
    terrainProviderKey
  );
  const result = selectInstanceAnalysisResult(state, instanceId);
  const hasResult = result !== null;
  const freshness = evaluateAnalysisFreshness(currentSnapshot, result);
  return { freshness, currentSnapshot, result, hasResult };
};

// === Simulation Run Selectors (Checkpoint 2C.1) ===

export const selectSimulationRunById = (state: TacticalState, runId: string): SimulationRun | null => {
  return state.simulationRuns[runId] || null;
};

export const selectSimulationRunsByPlan = (state: TacticalState, planId: string): SimulationRun[] => {
  return Object.values(state.simulationRuns).filter((r) => r.planId === planId);
};

export const selectSimulationRunsByScenario = (state: TacticalState, scenarioId: string): SimulationRun[] => {
  return Object.values(state.simulationRuns).filter((r) => r.scenarioId === scenarioId);
};

export const selectActiveSimulationRun = (state: TacticalState): SimulationRun | null => {
  if (!state.activeSimulationRunId) return null;
  const run = state.simulationRuns[state.activeSimulationRunId];
  if (!run) return null;
  if (run.planId !== state.activePlanId || run.scenarioId !== state.activeScenarioId) return null;
  if (!isSimulationRunFresh(state, run)) return null;
  return run;
};
