import { create } from 'zustand';
import type {
  EquipmentCategory,
  EquipmentInstance,
  EquipmentTemplate,
  PresetLocation,
} from '../types/equipment';
import { CATEGORY_META } from '../types/equipment';
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

interface TacticalState {
  // Battlefield Entities
  instances: EquipmentInstance[];
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

  // === 3D Radar Coverage Volume (Chuẩn hóa vòm 3D theo Địa hình & Danh nghĩa) ===
  coverageVolumes: Record<string, RadarCoverageVolume>;
  dome3DMode: 'nominal' | 'terrain-aware';
  selectedAltitudeM: number;
  isCalculatingVolume: boolean;
  setCoverageVolume: (instanceId: string, volume: RadarCoverageVolume) => void;
  setDome3DMode: (mode: 'nominal' | 'terrain-aware') => void;
  setSelectedAltitudeM: (altM: number) => void;
  setIsCalculatingVolume: (calculating: boolean) => void;
  clearCoverageVolumes: () => void;

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
  categoryFilter: EquipmentCategory | 'All';

  toggleCoverageLayer: () => void;
  toggleRangeRingsLayer: () => void;
  toggleLabelsLayer: () => void;
  toggleMarkersLayer: () => void;
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
  clearCoverageResults: () => void;

  addMeasurePoint: (point: { lat: number; lon: number; height: number }) => void;
  clearMeasurePoints: () => void;

  triggerFlyTo: (location: PresetLocation) => void;
  clearFlyTo: () => void;

  clearAll: () => void;
  importFromLayout: (layout: LayoutSaveData) => void;
  exportToLayout: (layoutName: string) => LayoutSaveData;
  loadSampleScenario: () => void;
}

/**
 * Chọn template khí tài cho cố vấn AI theo thứ tự ưu tiên:
 * aiAdvisorTemplateId -> template của khí tài đang chọn -> template đang chờ đặt -> template đầu tiên.
 */
function resolveAdvisorTemplate(state: {
  aiAdvisorTemplateId: string | null;
  instances: EquipmentInstance[];
  selectedInstanceId: string | null;
  pendingTemplate: EquipmentTemplate | null;
}): EquipmentTemplate {
  const byId = state.aiAdvisorTemplateId
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === state.aiAdvisorTemplateId)
    : undefined;
  if (byId) return byId;

  const selected = state.instances.find((i) => i.instanceId === state.selectedInstanceId);
  const fromSelected = selected
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === selected.templateId)
    : undefined;
  if (fromSelected) return fromSelected;

  if (state.pendingTemplate) return state.pendingTemplate;
  return EQUIPMENT_TEMPLATES[0];
}

export const useTacticalStore = create<TacticalState>((set, get) => ({
  instances: [],
  selectedInstanceId: null,

  activeTool: 'select',
  pendingTemplate: null,
  viewMode: '3D',

  terrainEnabled: true,
  terrainExaggeration: 1.8,
  basemap: 'google-terrain',
  vietnamOnly: true,
  showMapDownloadModal: false,

  showAllDomes: true,
  showCommandLinks: true,
  showSweeps: true,
  showSensorNetwork: true,

  // 2D Tactical Layer Controls & Filters
  showCoverageLayer: true,
  showRangeRingsLayer: true,
  showLabelsLayer: true,
  showMarkersLayer: true,
  categoryFilter: 'All',

  measurePoints: [],
  flyToTarget: PRESET_LOCATIONS[0], // Bắt đầu tại Tam Đảo (địa hình núi 3D)

  addEquipment: (instance) =>
    set((state) => {
      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
      const category = instance.category || tmpl?.category || 'RadarCanhGioi';
      const prefix = CATEGORY_META[category]?.prefix || 'EQ';
      const countSameCategory =
        state.instances.filter((i) => i.category === category).length + 1;
      const autoShortId = `${prefix}-${countSameCategory.toString().padStart(2, '0')}`;

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
      };
      return {
        instances: [...state.instances, instanceWithProfile],
        selectedInstanceId: instance.instanceId,
        activeTool: 'select',
        pendingTemplate: null,
      };
    }),

  updateEquipment: (instanceId, updates) => {
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
      return {
        instances: state.instances.map((item) =>
          item.instanceId === instanceId ? { ...item, ...updates } : item
        ),
        coverageVolumes: nextVolumes,
      };
    });
  },

  updateEquipmentSpxConfig: (instanceId, updates) =>
    set((state) => ({
      instances: state.instances.map((item) =>
        item.instanceId === instanceId
          ? {
              ...item,
              spxConfig: {
                ...(item.spxConfig || {}),
                ...updates,
              },
            }
          : item
      ),
    })),

  removeEquipment: (instanceId) => {
    invalidateVolumeCache(instanceId);
    set((state) => {
      const nextVolumes = { ...state.coverageVolumes };
      delete nextVolumes[instanceId];
      return {
        instances: state.instances.filter((item) => item.instanceId !== instanceId),
        selectedInstanceId:
          state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
        coverageVolumes: nextVolumes,
      };
    });
  },

  selectEquipment: (instanceId) =>
    set({
      selectedInstanceId: instanceId,
      activeTool: 'select',
      pendingTemplate: null,
    }),

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
  setCategoryFilter: (category) => set({ categoryFilter: category }),

  // Radar Coverage Initial State & Actions
  targetHeightMeters: 300, // Độ cao mục tiêu khảo sát mặc định 300m
  showBlindZones: true, // Mặc định hiển thị vùng mù (màu Đỏ)
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

  // 3D Radar Coverage Volume Initial State & Actions
  coverageVolumes: {},
  dome3DMode: 'terrain-aware',
  selectedAltitudeM: 1000,
  isCalculatingVolume: false,
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
  clearCoverageVolumes: () => set({ coverageVolumes: {} }),

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
  isCalculatingSpx: false,

  setShowSpxPanel: (show) => set({ showSpxPanel: show }),
  toggleSpxPanel: () => set((state) => ({ showSpxPanel: !state.showSpxPanel })),
  updateSpxConfig: (updates) =>
    set((state) => ({ spxConfig: { ...state.spxConfig, ...updates } })),
  setSpxResult: (instanceId, result) =>
    set((state) => ({
      spxResults: { ...state.spxResults, [instanceId]: result },
    })),
  setIsCalculatingSpx: (calculating) =>
    set((state) =>
      state.isCalculatingSpx === calculating ? state : { isCalculatingSpx: calculating }
    ),

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
    const template = resolveAdvisorTemplate(state);

    // Ghi lại template đã chọn để UI phản ánh đúng khí tài vừa dùng
    set({ aiAdvisorTemplateId: template.id, aiAdvisorStatus: 'checking', aiAdvisorError: null });

    // 1. Kiểm tra backend (health)
    const health = await checkVectorAiHealth();
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
      placed: state.instances.map((item) => ({
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
      nameIndex: state.instances.length + 1,
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
    invalidateVolumeCache();
    set({
      instances: [],
      selectedInstanceId: null,
      measurePoints: [],
      coverageVolumes: {},
    });
  },

  importFromLayout: (layout) => {
    const importedInstances: EquipmentInstance[] = layout.equipments.map((saved, index) => {
      const template =
        EQUIPMENT_TEMPLATES.find((t) => t.id === saved.templateId) ||
        EQUIPMENT_TEMPLATES[0];

      const statusMap = ['Active', 'Standby', 'Maintenance', 'Offline'] as const;
      const status = statusMap[saved.status] || 'Active';
      const prefix = CATEGORY_META[template.category]?.prefix || 'EQ';
      const autoShortId = `${prefix}-${(index + 1).toString().padStart(2, '0')}`;

      return {
        instanceId: saved.instanceId || `eq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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
    });

    set({
      instances: importedInstances,
      selectedInstanceId: importedInstances[0]?.instanceId || null,
    });
  },

  exportToLayout: (layoutName) => {
    const state = get();
    const statusMap = { Active: 0, Standby: 1, Maintenance: 2, Offline: 3 };

    const entries: SavedEquipmentEntry[] = state.instances.map((item) => ({
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
        name: 'Trận Địa Tên Lửa Spyder-MR Cảng Hải Phòng',
        category: 'TenLuaPhongKhong',
        latitude: 20.86,
        longitude: 106.72,
        altitude: 10,
        antennaHeightAGL: 5,
        rangeKm: 50,
        minEngagementRangeKm: 1,
        maxEngagementAltitudeM: 16000,
        reactionTimeSeconds: 9,
        guidanceMethodVi: 'Chủ động sóng milimet Derby-MR & Hồng ngoại IIR Python-5',
        scanSpeed: 0,
        minElevationDeg: 5,
        maxElevationDeg: 75,
        coverageHeightKm: 16,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#f97316',
        showDome: true,
        showSweep: false,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder')?.coverageProfile,
      },
    ];

    set({
      instances: sample,
      selectedInstanceId: 'eq_radar_tamdao',
    });
  },
}));
