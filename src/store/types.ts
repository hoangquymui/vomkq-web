import type {
  EquipmentCategory,
  EquipmentInstance,
  EquipmentTemplate,
  PresetLocation,
} from '../types/equipment';
import type { LayoutSaveData } from '../types/layout';
import type { RadarCoverageVolume } from '../types/radarVolume';
import type {
  AiPlacementRoutePoint,
  AiPlacementSuggestion,
} from '../utils/aiPlacementAdvisor';
import type { Scenario } from '../domain/types/scenario';
import type { Plan } from '../domain/types/plan';
import type {
  EquipmentDefinition,
  EquipmentPlacement,
  ObservationState,
} from '../domain/types/equipment';
import type {
  SimulationState,
  SimulationRun,
  SimulationRunStatus,
  SimulationConfigSnapshot,
  SimulationRunDiagnostics,
  SimulationRunHandle,
} from '../domain/types/simulation';
import type {
  SimulationClockState,
} from '../domain/types/simulationClock';
import type {
  SimulationTimelineState,
  SimulationEvent,
} from '../domain/types/simulationTimeline';
import type {
  SimulationStepInput,
  SimulationStepOptions,
  SimulationStepResult,
} from '../domain/types/simulationRunner';
import type { LegacyPresentationState } from '../domain/adapters/legacyEquipmentAdapter';
import type {
  CanonicalStatePackage,
  CanonicalStatePackageV1,
  CanonicalStatePackageV2,
} from '../domain/serialization/canonicalStatePackage';
import type {
  AnalysisResult,
  SpxAnalysisInputSnapshot,
} from '../domain/types/analysis';
import type {
  SpxRadarCoverageConfig,
  SpxCoverageResult,
} from '../types/spxRadarCoverage';
import type {
  RadarCoverageResult,
  RadarCoverageField,
} from '../types/radarCoverage';
import type {
  SamEngagementVolume,
  SamEngagementMode,
} from '../utils/missileVolumeEngine';
import type { RevisionMetadata, AuditEvent } from '../domain/types/audit';

/**
 * Trạng thái cố vấn vị trí đặt khí tài (VECTOR AI local).
 */
export type AiAdvisorStatus =
  | 'idle'
  | 'checking'
  | 'thinking'
  | 'ready'
  | 'error'
  | 'offline';

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

export type StoreSet = (
  partial:
    | Partial<TacticalState>
    | ((state: TacticalState) => Partial<TacticalState> | TacticalState)
) => void;

export type StoreGet = () => TacticalState;

export interface TacticalState {
  // === Canonical Domain State (Target Source of Truth) ===
  scenarios: Record<string, Scenario>;
  plans: Record<string, Plan>;
  simulationRuns: Record<string, SimulationRun>;
  simulationClocks: Record<string, SimulationClockState>;
  simulationTimelines: Record<string, SimulationTimelineState>;
  definitions: Record<string, EquipmentDefinition>;
  placements: Record<string, EquipmentPlacement>;
  observations: Record<string, ObservationState>;
  simulations: Record<string, Record<string, SimulationState>>;
  // === Presentation/UI State ===
  visuals: Record<string, LegacyPresentationState>;

  // === Audit & Revision (Provenance) ===
  revisions: Record<string, RevisionMetadata>;
  revisionHeads: Record<string, string>;
  auditEvents: Record<string, AuditEvent>;
  auditEventOrder: string[];

  activeScenarioId: string | null;
  activePlanId: string | null;
  activeSimulationRunId: string | null;
  canonicalInitialized: boolean;

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
  showSimulationPanel: boolean;
  setShowSimulationPanel: (show: boolean) => void;
  toggleSimulationPanel: () => void;

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
  coverageResults: Record<string, RadarCoverageResult>;
  coverageFields: Record<string, RadarCoverageField>;
  coverageFieldCache: Record<string, RadarCoverageField>;
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
  samVolumes: Record<string, SamEngagementVolume>;
  samEngagementModes: Record<string, SamEngagementMode>;
  setSamVolume: (instanceId: string, volume: SamEngagementVolume) => void;
  setSamEngagementMode: (instanceId: string, mode: SamEngagementMode) => void;
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
  aiAdvisorTemplateId: string | null;
  setAiAdvisorPanelOpen: (open: boolean) => void;
  toggleAiAdvisorPanel: () => void;
  setAiAdvisorTemplateId: (templateId: string | null) => void;
  runAiPlacementAnalysis: (model: string) => Promise<void>;
  clearAiPlacementSuggestions: () => void;
  placeEquipmentAtSuggestion: (index: number) => void;

  // SPx Multi-Altitude Coverage (Cambridge Pixel Standard)
  showSpxPanel: boolean;
  spxConfig: SpxRadarCoverageConfig;
  spxResults: Record<string, SpxCoverageResult>;
  isCalculatingSpx: boolean;
  setShowSpxPanel: (show: boolean) => void;
  toggleSpxPanel: () => void;
  updateSpxConfig: (updates: Partial<SpxRadarCoverageConfig>) => void;
  setSpxResult: (instanceId: string, result: SpxCoverageResult) => void;
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
    result: SpxCoverageResult;
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

  // === Simulation Clock Foundation (Checkpoint 2C.2) ===
  initSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: {
      runToken?: string;
      importGen?: number;
      timeScale?: number;
    }
  ) => SimulationClockState;
  startSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;
  pauseSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;
  resumeSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number }
  ) => void;
  stepSimulationClock: (
    runIdOrHandle: string | SimulationRunHandle,
    elapsedRealMs: number,
    options?: { runToken?: string; importGen?: number }
  ) => SimulationClockState;
  setSimulationClockScale: (
    runIdOrHandle: string | SimulationRunHandle,
    timeScale: number,
    options?: { runToken?: string; importGen?: number }
  ) => void;
  resetSimulationClockSession: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: { runToken?: string; importGen?: number; preserveTimeScale?: boolean }
  ) => SimulationClockState;

  // === Simulation Event Timeline Foundation (Checkpoint 2C.3) ===
  initSimulationTimeline: (
    runIdOrHandle: string | SimulationRunHandle,
    options?: {
      runToken?: string;
      importGen?: number;
    }
  ) => SimulationTimelineState;
  appendSimulationEvent: (
    runIdOrHandle: string | SimulationRunHandle,
    eventInput: {
      eventType: string;
      payload?: unknown;
    },
    options?: {
      runToken?: string;
      importGen?: number;
    }
  ) => SimulationEvent;

  // === Deterministic Simulation Runner MVP (Checkpoint 2C.4) ===
  stepSimulation: (
    runIdOrHandle: string | SimulationRunHandle,
    input: SimulationStepInput,
    options?: SimulationStepOptions
  ) => SimulationStepResult;

  // === Functional Simulation Vertical Slice (Checkpoint 2C.5) ===
  stepSimulationWithRadarEvaluation: (
    runIdOrHandle: string | SimulationRunHandle,
    input: {
      elapsedRealMs: number;
      targetAltitudeM?: number;
    },
    options?: SimulationStepOptions
  ) => SimulationStepResult;

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
    updates: Partial<SpxRadarCoverageConfig>
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
  setCoverageResult: (instanceId: string, result: RadarCoverageResult) => void;
  setCoverageField: (instanceId: string, field: RadarCoverageField) => void;
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
