import { create } from 'zustand';
import { ENABLE_3D_MODELS } from '../types/equipment';
import { PRESET_LOCATIONS } from '../data/equipmentTemplates';
import { DEFAULT_SPX_CONFIG } from '../types/spxRadarCoverage';

import { SCENARIO_STATUS_LABELS, type ScenarioStatus } from '../domain/types/scenario';
import { PLAN_STATUS_LABELS, type PlanStatus } from '../domain/types/plan';
export { SCENARIO_STATUS_LABELS, PLAN_STATUS_LABELS };
export type { ScenarioStatus, PlanStatus };

import type {
  SimulationRunStatus,
  SimulationRunFreshness,
  SimulationConfigSnapshot,
  SimulationRunDiagnostics,
  SimulationRunHandle,
} from '../domain/types/simulation';
export type {
  SimulationRunStatus,
  SimulationRunFreshness,
  SimulationConfigSnapshot,
  SimulationRunDiagnostics,
  SimulationRunHandle,
};

import {
  MIN_SIMULATION_TIME_SCALE,
  MAX_SIMULATION_TIME_SCALE,
  DEFAULT_SIMULATION_TIME_SCALE,
  MIN_SIMULATION_RESOLUTION_MS,
  MIN_FRACTIONAL_RESOLUTION_MS,
  MAX_SUPPORTED_SIM_TIME_MS,
  MAX_SUPPORTED_SIM_TIME_NS,
  type SimulationClockPhase,
  type SimulationClockState,
} from '../domain/types/simulationClock';
export {
  MIN_SIMULATION_TIME_SCALE,
  MAX_SIMULATION_TIME_SCALE,
  DEFAULT_SIMULATION_TIME_SCALE,
  MIN_SIMULATION_RESOLUTION_MS,
  MIN_FRACTIONAL_RESOLUTION_MS,
  MAX_SUPPORTED_SIM_TIME_MS,
  MAX_SUPPORTED_SIM_TIME_NS,
};
export type { SimulationClockPhase, SimulationClockState };

import type {
  AnalysisResult,
  ExecutionStatus,
  FreshnessStatus,
  SpxAnalysisInputSnapshot,
} from '../domain/types/analysis';
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

import type {
  TacticalState,
  AiAdvisorStatus,
  CrossSectionProbePoint,
} from './types';
export type { TacticalState, AiAdvisorStatus, CrossSectionProbePoint };

import {
  selectScenarios,
  selectAllScenarios,
  selectPlansForActiveScenario,
  selectAllPlansForActiveScenario,
  selectActiveScenario,
  selectActivePlan,
} from './selectors/scenarioSelectors';
import {
  selectActivePlacements,
  selectActiveEquipment,
  selectEquipmentById,
  selectDefinitionForPlacement,
  selectObservationForPlacement,
  selectVisualForPlacement,
} from './selectors/equipmentSelectors';
import {
  selectActivePlanAnalysisResults,
  selectInstanceAnalysisResult,
  selectAnalysisFreshness,
} from './selectors/analysisSelectors';
import {
  selectSimulationRunById,
  selectSimulationRunsByPlan,
  selectSimulationRunsByScenario,
  selectActiveSimulationRun,
} from './selectors/simulationSelectors';
import {
  selectSimulationClockByRunId,
  selectActiveSimulationClock,
  selectSimulationClockPhase,
  selectSimulationClockTimeMs,
  selectSimulationClockTimeNs,
  selectSimulationClockTimeScale,
} from './selectors/simulationClockSelectors';
import {
  selectSimulationTimelineByRunId,
  selectActiveSimulationTimeline,
  selectSimulationEventsByRunId,
  selectActiveSimulationEvents,
  selectSimulationEventCount,
} from './selectors/simulationTimelineSelectors';

export {
  selectScenarios,
  selectAllScenarios,
  selectPlansForActiveScenario,
  selectAllPlansForActiveScenario,
  selectActiveScenario,
  selectActivePlan,
  selectActivePlacements,
  selectActiveEquipment,
  selectEquipmentById,
  selectDefinitionForPlacement,
  selectObservationForPlacement,
  selectVisualForPlacement,
  selectActivePlanAnalysisResults,
  selectInstanceAnalysisResult,
  selectAnalysisFreshness,
  selectSimulationRunById,
  selectSimulationRunsByPlan,
  selectSimulationRunsByScenario,
  selectActiveSimulationRun,
  selectSimulationClockByRunId,
  selectActiveSimulationClock,
  selectSimulationClockPhase,
  selectSimulationClockTimeMs,
  selectSimulationClockTimeNs,
  selectSimulationClockTimeScale,
  selectSimulationTimelineByRunId,
  selectActiveSimulationTimeline,
  selectSimulationEventsByRunId,
  selectActiveSimulationEvents,
  selectSimulationEventCount,
};

import {
  createSimulationRunSlice,
  type SimulationRunSlice,
} from './slices/simulationRunSlice';
import {
  createSimulationClockSlice,
  type SimulationClockSlice,
} from './slices/simulationClockSlice';
import {
  createSimulationTimelineSlice,
  type SimulationTimelineSlice,
} from './slices/simulationTimelineSlice';
import {
  createSpxAnalysisSlice,
  type SpxAnalysisSlice,
} from './slices/spxAnalysisSlice';
import {
  createUiPresentationSlice,
  type UiPresentationSlice,
} from './slices/uiPresentationSlice';
import {
  createDerivedVisualizationSlice,
  DOME_STYLE_DEFAULTS,
  type DerivedVisualizationSlice,
} from './slices/derivedVisualizationSlice';
import {
  createAiAdvisorSlice,
  resolveAdvisorTemplate,
  type AiAdvisorSlice,
} from './slices/aiAdvisorSlice';
import {
  createEquipmentSlice,
  type EquipmentSlice,
} from './slices/equipmentSlice';
import {
  createScenarioSlice,
  type ScenarioSlice,
} from './slices/scenarioSlice';
import {
  createPlanSlice,
  type PlanSlice,
} from './slices/planSlice';
import {
  createWorkspaceSlice,
  type WorkspaceSlice,
} from './slices/workspaceSlice';

export {
  createSimulationRunSlice,
  createSpxAnalysisSlice,
  createUiPresentationSlice,
  createDerivedVisualizationSlice,
  createAiAdvisorSlice,
  createEquipmentSlice,
  createScenarioSlice,
  createPlanSlice,
  createWorkspaceSlice,
  createSimulationClockSlice,
  createSimulationTimelineSlice,
  DOME_STYLE_DEFAULTS,
  resolveAdvisorTemplate,
};
export type {
  SimulationRunSlice,
  SimulationClockSlice,
  SpxAnalysisSlice,
  UiPresentationSlice,
  DerivedVisualizationSlice,
  AiAdvisorSlice,
  EquipmentSlice,
  ScenarioSlice,
  PlanSlice,
  WorkspaceSlice,
  SimulationTimelineSlice,
};

export const useTacticalStore = create<TacticalState>((set, get) => ({
  // === Canonical Domain State Initialization ===
  scenarios: {},
  plans: {},
  simulationRuns: {},
  simulationClocks: {},
  simulationTimelines: {},
  definitions: {},
  placements: {},
  observations: {},
  simulations: {},
  visuals: {},

  // === Audit & Revision (Provenance) ===
  revisions: {},
  revisionHeads: {},
  auditEvents: {},
  auditEventOrder: [],

  activeScenarioId: null,
  activePlanId: null,
  activeSimulationRunId: null,
  canonicalInitialized: false,

  // === Workspace Context Generation Token & UI Modal State ===
  workspaceContextGeneration: 0,
  lastImportGen: 0,
  showWorkspaceModal: false,
  workspaceModalTab: 'plans',

  // === Battlefield Entities ===
  selectedInstanceId: null,

  // === Tools & Modes ===
  activeTool: 'select',
  pendingTemplate: null,
  viewMode: '3D',

  // === 3D Terrain & Basemap Options ===
  terrainEnabled: true,
  terrainExaggeration: 1.8,
  activeTerrainProviderKey: 'flat_v1',
  spxActiveResultIds: {},
  basemap: 'google-terrain',
  vietnamOnly: true,
  showMapDownloadModal: false,

  // === Visualization Toggles ===
  showAllDomes: true,
  showCommandLinks: true,
  showSweeps: true,
  showSensorNetwork: true,

  // === 2D Tactical Layer Controls & Filters ===
  showCoverageLayer: true,
  showRangeRingsLayer: true,
  showLabelsLayer: true,
  showMarkersLayer: true,
  showModelsLayer: ENABLE_3D_MODELS,
  categoryFilter: 'All',

  // === Measurement ===
  measurePoints: [],

  // === Navigation Target ===
  flyToTarget: PRESET_LOCATIONS[0],

  // === Radar Coverage & LOS Parameters ===
  targetHeightMeters: 300,
  showBlindZones: false,
  showConeOfSilence: true,
  azimuthStepDeg: 5,
  elevationStepDeg: 3,
  kFactor: 4 / 3,
  coverageResults: {},
  coverageFields: {},
  coverageFieldCache: {},
  isCalculatingLOS: false,
  showRadarFieldModal: false,
  showCrossSection: false,
  selectedAzimuthDeg: 45,
  crossSectionProbePoint: null,

  // === 3D Radar Coverage Volume ===
  coverageVolumes: {},
  dome3DMode: 'terrain-aware',
  selectedAltitudeM: 1000,
  isCalculatingVolume: false,
  showOccludedVolume: true,

  // === 3D SAM Engagement Volume ===
  samVolumes: {},
  samEngagementModes: {},

  // === Kiểu vòm phủ sóng tham chiếu ===
  ...DOME_STYLE_DEFAULTS,

  // === Cố vấn vị trí đặt khí tài bằng AI local ===
  aiAdvisorPanelOpen: false,
  aiAdvisorStatus: 'idle',
  aiAdvisorError: null,
  aiAdvisorSummary: '',
  aiAdvisorSuggestions: [],
  aiAdvisorRoute: [],
  aiAdvisorTemplateId: null,

  // === SPx Multi-Altitude Coverage ===
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

  // === Quản lý Bố Cục Modal ===
  showLayoutModal: false,

  // === Slice Composition ===
  ...createUiPresentationSlice(set, get),
  ...createDerivedVisualizationSlice(set, get),
  ...createAiAdvisorSlice(set, get),
  ...createSimulationRunSlice(set, get),
  ...createSimulationClockSlice(set, get),
  ...createSimulationTimelineSlice(set, get),
  ...createSpxAnalysisSlice(set, get),
  ...createEquipmentSlice(set, get),
  ...createScenarioSlice(set, get),
  ...createPlanSlice(set, get),
  ...createWorkspaceSlice(set, get),
}));
