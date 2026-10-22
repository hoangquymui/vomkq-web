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
  buildRankingMessages,
  deriveAdvisorRadiusKm,
  getAdvisorViewport,
  parsePlacementRanking,
  resolveAdvisorSuggestionIndex,
} from '../utils/aiPlacementAdvisor';
import type {
  AiPlacementContext,
  AiPlacementRoutePoint,
  AiPlacementSuggestion,
} from '../utils/aiPlacementAdvisor';
import { generatePlacementCandidates } from '../utils/placementCandidateEngine';
import type { PlacementCandidate } from '../utils/placementCandidateEngine';
import { buildSiteProfile } from '../utils/featureAwareness';
import type { SiteProfile } from '../utils/featureAwareness';
import type { VectorFeature, VectorFeatureKind } from '../types/vectorFeature';
import { loadVectorFeatureStore } from '../services/vectorFeatureStore';
import type { RadarCoverageVolume } from '../types/radarVolume';
import { invalidateVolumeCache } from '../utils/radarVolumeEngine';
import { destinationPoint } from '../utils/radarLosEngine';
import {
  analyzeTerrainFlatness,
  type FlatPatch,
  type FlatnessAnalysisResult,
} from '../utils/terrainFlatnessEngine';
import { getTerrainProvider, ensureTerrainProvider } from '../utils/featureAwareness';
import {
  surveyRegionInventory,
  type RegionInventoryResult,
} from '../services/regionInventoryService';
import {
  createDefaultCompositeBatteryState,
  recalculateLaunchersFromCenter,
  updateSingleLauncherPosition,
} from '../utils/compositeBatteryGeometry';

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
 * Trạng thái luồng khảo sát dữ liệu GIS trong vòng tròn 1km (Region Inventory).
 * Tự động chạy ngay khi người dùng chọn tọa độ.
 */
export type RegionInventoryStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

/**
 * Cấu hình điều kiện phân tích mảng địa hình trận địa do người dùng tùy chỉnh.
 */
export interface TerrainAnalysisConfig {
  /** Chênh lệch độ cao tối đa nội bộ mảng (m). Mặc định 4m. */
  maxElevationDifferenceM: number;
  /** Diện tích tối đa mỗi mảng con (m²). Mặc định 10.000 m² = 1 ha (giới hạn trên). */
  maxPatchAreaM2: number;
  /** Độ dốc tối đa (°). Mặc định 6°. */
  maxSlopeDeg: number;
}

export const DEFAULT_TERRAIN_ANALYSIS_CONFIG: TerrainAnalysisConfig = {
  maxElevationDifferenceM: 4.0,
  maxPatchAreaM2: 10_000,
  maxSlopeDeg: 6.0,
};

/**
 * Trạng thái luồng phân tích độ bằng phẳng tìm mảng trận địa.
 * Chỉ chạy khi người dùng chủ động nhấn nút phân tích.
 * - idle    : chưa chạy phân tích mảng
 * - running : đang lấy mẫu địa hình DEM và chạy thuật toán phân cụm
 * - success : quét thành công và tìm thấy ít nhất 1 mảng đạt chuẩn
 * - empty   : quét thành công nhưng không có mảng nào đạt chuẩn
 * - error   : gặp lỗi trong quá trình tính toán
 */
export type AnalysisStatus = 'idle' | 'running' | 'success' | 'empty' | 'error';

/**
 * Vùng được chọn trên bản đồ để phân tích địa hình bằng phẳng.
 * Tâm vùng, bán kính cố định 1km, độc lập với kết quả quét.
 */
export interface AnalysisRegion {
  lat: number;
  lon: number;
  radiusKm: number; // Cố định 1.0 km
  regionId: string; // Nonce / Run ID chống race condition ghi đè kết quả cũ
}

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

  // === LỚP VECTƠ OFFLINE (OSM) & NHẬN THỨC VÙNG PHỦ ===
  // Lớp thứ hai của bản đồ (lớp thứ nhất là ảnh raster - chỉ để nhìn). Cho biết
  // pixel nào là nhà, pixel nào là sông/suối/núi, và mỗi đối tượng ở đâu.
  showVectorLayer: boolean;
  /**
   * Có hiện các bảng nổi chồng lên bản đồ hay không.
   *
   * VÌ SAO CẦN: bản đồ vệ tinh + lớp đối tượng vẽ lên rất nhiều chi tiết. Các bảng
   * nổi (Chú giải, Hiệu năng) đè lên đúng vùng quan tâm và che mất đối tượng. Khi
   * bật lớp vectơ, ta tự tắt chúng; người dùng bật lại bất cứ lúc nào.
   */
  showMapOverlays: boolean;
  /** Các loại đối tượng vectơ đang được hiển thị (rỗng = tất cả). */
  visibleVectorKinds: VectorFeatureKind[];
  /** Feature vectơ đang được chọn trên bản đồ (để đo cự ly tới khí tài). */
  selectedVectorFeature: VectorFeature | null;
  /** Đặc tính vùng phủ của khí tài đang chọn (null = chưa phân tích). */
  siteProfile: SiteProfile | null;
  /** true khi đang tính đặc tính vùng phủ. */
  isAnalyzingSite: boolean;
  /** Số gói dữ liệu vectơ đã tải (0 = chỉ có ảnh raster). */
  vectorPackCount: number;
  toggleVectorLayer: () => void;
  setShowVectorLayer: (on: boolean) => void;
  setShowMapOverlays: (show: boolean) => void;
  setVisibleVectorKinds: (kinds: VectorFeatureKind[]) => void;
  selectVectorFeature: (feature: VectorFeature | null) => void;
  /** Dựng đặc tính vùng phủ cho khí tài đang chọn (bán kính = tầm hoạt động). */
  analyzeSelectedSite: () => Promise<void>;

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

  // === Vùng Hỏa Lực SAM Cắt Địa Hình (Hiệp Đồng Radar & Cắt DEM Mặt Đất) ===
  samCoverageResults: Record<string, import('../types/samCoverage').SamCoverageResult>;
  setSamCoverageResult: (instanceId: string, result: import('../types/samCoverage').SamCoverageResult) => void;
  clearSamCoverageResults: () => void;

  // === So Sánh Tầm Nhìn Địa Hình GIS (Observer A vs B) ===
  showTerrainComparison: boolean;
  terrainComparisonResult: import('../utils/terrainComparisonEngine').TerrainComparisonResult | null;
  terrainComparisonLayers: {
    baseDem: boolean;
    maskA: boolean;
    maskB: boolean;
    overlap: boolean;
    nonOverlap: boolean;
    missingDem: boolean;
  };
  setShowTerrainComparison: (show: boolean) => void;
  setTerrainComparisonResult: (result: import('../utils/terrainComparisonEngine').TerrainComparisonResult | null) => void;
  toggleTerrainComparisonLayer: (
    layer: 'baseDem' | 'maskA' | 'maskB' | 'overlap' | 'nonOverlap' | 'missingDem'
  ) => void;


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
  /**
   * true khi kết quả do ĐỘNG CƠ CLIENT tính mà KHÔNG có diễn giải của AI (backend chưa chạy,
   * model trả JSON hỏng...). Vẫn là gợi ý CÓ CĂN CỨ, chỉ thiếu phần văn do AI viết.
   */
  aiAdvisorDegraded: boolean;
  aiAdvisorSuggestions: AiPlacementSuggestion[];
  aiAdvisorRoute: AiPlacementRoutePoint[];
  /** templateId của khí tài sẽ được đặt tại gợi ý; null = suy ra từ khí tài đang chọn */
  aiAdvisorTemplateId: string | null;
  setAiAdvisorPanelOpen: (open: boolean) => void;
  toggleAiAdvisorPanel: () => void;
  setAiAdvisorTemplateId: (templateId: string | null) => void;
  /**
   * Chạy phân tích theo 3 bước, KHÔNG bao giờ ném lỗi ra UI:
   *   1. Động cơ client tính ứng viên từ dữ liệu thật (placementCandidateEngine) -> gợi ý có căn cứ.
   *   2. Nếu VECTOR AI sẵn sàng: gửi danh sách ứng viên để AI XẾP HẠNG + viết diễn giải.
   *   3. Nếu AI không sẵn sàng / trả JSON hỏng: giữ kết quả động cơ và bật cờ `aiAdvisorDegraded`.
   */
  runAiPlacementAnalysis: (model: string) => Promise<void>;
  clearAiPlacementSuggestions: () => void;
  /** Đặt khí tài tại gợi ý thứ `index` (tái dùng đúng action addEquipment hiện có) */
  placeEquipmentAtSuggestion: (index: number) => void;
  /**
   * Gợi ý đang được chọn (bấm trên bản đồ hoặc trong danh sách panel).
   * `null` = không chọn gợi ý nào. Dùng để tô sáng marker + cuộn card tương ứng.
   */
  selectedAdvisorSuggestionIndex: number | null;
  selectAdvisorSuggestion: (index: number | null) => void;

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

  // Composite Battery Actions
  updateBatteryLauncherPosition: (
    instanceId: string,
    launcherId: string,
    lat: number,
    lon: number,
    alt: number,
    losResult?: { isValid: boolean; warningMessage?: string }
  ) => void;
  setBatteryCombatMode: (instanceId: string, mode: 'omnidirectional' | 'sector') => void;
  setBatteryCombatAzimuth: (instanceId: string, azimuthDeg: number) => void;
  setBatteryLayerVisibility: (
    instanceId: string,
    layer: 'tarDome' | 'fcrDome' | 'wezDome' | 'launchers',
    visible: boolean
  ) => void;
  setBatteryMastHeightOverride: (instanceId: string, mastHeightM?: number) => void;
  switchBatteryTarRadar: (instanceId: string, tarRadarId: string) => void;

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

  // === PHÂN TÍCH ĐỊA HÌNH BẰNG PHẲNG (Terrain Flatness Analysis) ===
  /** Vùng được chọn: tâm + bán kính 1km, độc lập với kết quả quét. */
  analysisRegion: AnalysisRegion | null;
  /** Trạng thái luồng khảo sát dữ liệu GIS tổng quan ('idle' | 'loading' | 'success' | 'empty' | 'error'). */
  regionInventoryStatus: RegionInventoryStatus;
  /** Kết quả khảo sát toàn bộ đối tượng GIS trong bán kính 1km. */
  regionInventoryResult: RegionInventoryResult | null;
  /** Thông báo lỗi khảo sát GIS nếu có. */
  regionInventoryError: string | null;
  /** Cấu hình điều kiện phân tích mảng trận địa do người dùng tùy chỉnh. */
  analysisConfig: TerrainAnalysisConfig;
  /** Trạng thái luồng tìm kiếm mảng phẳng trận địa ('idle' | 'running' | 'success' | 'empty' | 'error'). */
  analysisStatus: AnalysisStatus;
  /** Thông báo lỗi phân tích mảng gần nhất nếu có. */
  analysisError: string | null;
  /** true khi đang chờ người dùng click lên bản đồ để chọn tâm vùng phân tích. */
  isSelectingFlatnessCenter: boolean;
  /** Kết quả phân tích địa hình gần nhất. null = chưa chạy / đã xóa. */
  flatnessAnalysisResult: FlatnessAnalysisResult | null;
  /** Danh sách các mảng địa hình bằng phẳng (alias tiện ích theo hợp đồng). */
  flatnessPatches: FlatPatch[];
  /** true khi đang lấy mẫu DEM và tính cluster. */
  isAnalyzingFlatness: boolean;
  /** ID của mảng đang được hover trên bản đồ. */
  hoveredPatchId: string | null;
  /** ID của mảng được click → mở TerrainZoneInspector. */
  selectedPatchId: string | null;
  /** Hiển thị màn TerrainZoneInspector fullscreen hay không. */
  showTerrainZoneInspector: boolean;
  /** true khi đang ở chế độ soi chi tiết một mảng phẳng (alias theo hợp đồng). */
  isInspectingZone: boolean;

  startFlatnessSelection: () => void;
  cancelFlatnessSelection: () => void;
  selectAnalysisRegion: (lat: number, lon: number) => void;
  runRegionInventory: (lat: number, lon: number, radiusKm: number, regionId: string) => Promise<void>;
  setAnalysisConfig: (config: Partial<TerrainAnalysisConfig>) => void;
  resetAnalysisConfig: () => void;
  runFlatnessAnalysis: (lat?: number, lon?: number) => Promise<void>;
  setHoveredPatch: (id: string | null) => void;
  selectPatch: (id: string | null) => void;
  closeTerrainZoneInspector: () => void;
  clearFlatnessResult: () => void;
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

/** Số điểm tối đa nối thành "tuyến khả thi" trên bản đồ. */
const MAX_ADVISOR_ROUTE_POINTS = 5;

/**
 * Chuyển danh sách ứng viên của động cơ thành gợi ý + tuyến để render.
 * `route` lấy các điểm tốt nhất nối thành tuyến khả thi (động cơ quyết định, không phải AI).
 */
function candidatesToSuggestions(candidates: readonly PlacementCandidate[]): {
  suggestions: AiPlacementSuggestion[];
  route: AiPlacementRoutePoint[];
} {
  const suggestions: AiPlacementSuggestion[] = candidates.map((candidate) => ({
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    score: candidate.score,
    reason: candidate.reason,
    breakdown: candidate.breakdown,
    criteria: candidate.criteria,
  }));

  const route: AiPlacementRoutePoint[] = suggestions
    .slice(0, MAX_ADVISOR_ROUTE_POINTS)
    .map((suggestion) => ({ latitude: suggestion.latitude, longitude: suggestion.longitude }));

  return { suggestions, route };
}

/**
 * Gắn diễn giải của AI vào đúng ứng viên và sắp lại thứ tự theo xếp hạng của AI.
 * `index` của AI trỏ vào vị trí trong danh sách gợi ý đã gửi (1:1 với danh sách ứng viên).
 * Ứng viên AI bỏ qua vẫn được giữ, xếp sau, theo đúng thứ tự điểm của động cơ.
 */
function applyAiRanking(
  suggestions: readonly AiPlacementSuggestion[],
  ranking: readonly { index: number; reason: string }[]
): AiPlacementSuggestion[] {
  const aiReasonByIndex = new Map<number, string>();
  const order: number[] = [];
  for (const entry of ranking) {
    if (aiReasonByIndex.has(entry.index)) continue;
    aiReasonByIndex.set(entry.index, entry.reason);
    order.push(entry.index);
  }

  const remaining = suggestions.map((_, index) => index).filter((index) => !aiReasonByIndex.has(index));
  const orderedIndices = [...order, ...remaining];

  return orderedIndices.map((index) => {
    const base = suggestions[index];
    const aiReason = aiReasonByIndex.get(index);
    return aiReason ? { ...base, aiReason } : { ...base };
  });
}

// A completed profile belongs to the selected equipment and its current area.
// Invalidate pending work when that selection/area changes, so an older response
// cannot restore the previous equipment's numbers on the map or in the panel.
let siteAnalysisRequestId = 0;
function clearSiteProfileState(): { siteProfile: null; isAnalyzingSite: false } {
  siteAnalysisRequestId += 1;
  return { siteProfile: null, isAnalyzingSite: false };
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
      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
      const category = instance.category || tmpl?.category || 'RadarCanhGioi';
      const prefix = CATEGORY_META[category]?.prefix || 'EQ';
      const countSameCategory =
        state.instances.filter((i) => i.category === category).length + 1;
      const autoShortId = `${prefix}-${countSameCategory.toString().padStart(2, '0')}`;

      // Tự động hiệp đồng radar nếu là Tổ hợp Tên Lửa
      let autoRadarId = instance.designatedRadarId;
      let autoMaskMode = instance.samTerrainMaskMode;
      if (category === 'TenLuaPhongKhong' && !autoRadarId) {
        const tarTmplId = tmpl?.batteryConfig?.tarRadarId;
        const fcrTmplId = tmpl?.batteryConfig?.fcrRadarId;
        const pairedRadar = state.instances.find(
          (i) => (i.templateId === tarTmplId || i.templateId === fcrTmplId) && i.status === 'Active'
        );
        const fireControlRadar = state.instances.find((i) => i.canDesignateForSam && i.status === 'Active');
        const fallbackRadar = state.instances.find((i) => i.category === 'RadarCanhGioi' && i.status === 'Active');
        const targetRadar = pairedRadar || fireControlRadar || fallbackRadar;
        if (targetRadar) {
          autoRadarId = targetRadar.instanceId;
          autoMaskMode = 'intersection';
        }
      }

      // Khởi tạo Cụm Tổ Hợp Đồng Bộ 4 Bệ Phóng nếu là SAM có batteryConfig
      let compositeBattery = instance.compositeBattery;
      if (!compositeBattery && tmpl?.batteryConfig) {
        compositeBattery = createDefaultCompositeBatteryState(
          instance.latitude,
          instance.longitude,
          instance.altitude || 0,
          tmpl.batteryConfig
        );
      }

      const instanceWithProfile: EquipmentInstance = {
        ...instance,
        category,
        shortId: instance.shortId || autoShortId,
        designatedRadarId: autoRadarId || null,
        samTerrainMaskMode: autoMaskMode || (category === 'TenLuaPhongKhong' ? 'intersection' : undefined),
        targetAltitudeM: instance.targetAltitudeM ?? (category === 'TenLuaPhongKhong' ? 500 : undefined),
        batteryConfig: instance.batteryConfig || tmpl?.batteryConfig,
        compositeBattery,
        maxLaunchRangeKm: instance.maxLaunchRangeKm ?? tmpl?.maxLaunchRangeKm,
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

      let nextInstances = [...state.instances, instanceWithProfile];

      // Nếu khí tài vừa thêm là đài radar có khả năng chỉ thị mục tiêu:
      // Tự động gán cho các tổ hợp SAM chưa có đài chỉ thị và kích hoạt chế độ intersection
      const nextSamCoverage = { ...state.samCoverageResults };
      if (instanceWithProfile.canDesignateForSam) {
        nextInstances = nextInstances.map((inst) => {
          if (inst.category === 'TenLuaPhongKhong' && !inst.designatedRadarId) {
            delete nextSamCoverage[inst.instanceId];
            return {
              ...inst,
              designatedRadarId: instanceWithProfile.instanceId,
              samTerrainMaskMode: 'intersection',
            };
          }
          return inst;
        });
      }

      return {
        instances: nextInstances,
        samCoverageResults: nextSamCoverage,
        selectedInstanceId: instance.instanceId,
        activeTool: 'select',
        pendingTemplate: null,
        ...clearSiteProfileState(),
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
        updates.rangeKm !== undefined ||
        updates.designatedRadarId !== undefined ||
        updates.samTerrainMaskMode !== undefined;

      const nextVolumes = locationOrRadarChanged
        ? { ...state.coverageVolumes }
        : state.coverageVolumes;
      if (locationOrRadarChanged) {
        delete nextVolumes[instanceId];
      }

      // Xóa kết quả SAM coverage để tính toán lại khi vị trí, tầm hoặc liên kết radar đổi
      const nextSamCoverage = locationOrRadarChanged
        ? { ...state.samCoverageResults }
        : state.samCoverageResults;
      if (locationOrRadarChanged) {
        delete nextSamCoverage[instanceId];
        // Nếu đài radar này thay đổi vị trí, xóa cache của tất cả SAM đang hiệp đồng với nó
        state.instances.forEach((inst) => {
          if (inst.designatedRadarId === instanceId) {
            delete nextSamCoverage[inst.instanceId];
          }
        });
      }

      return {
        instances: state.instances.map((item) => {
          if (item.instanceId !== instanceId) return item;
          const updatedItem = { ...item, ...updates };

          // Đồng bộ tự động 4 bệ phóng khi di chuyển tâm tổ hợp SAM
          if (
            (updates.latitude !== undefined || updates.longitude !== undefined || updates.altitude !== undefined) &&
            updatedItem.compositeBattery &&
            updatedItem.batteryConfig
          ) {
            const nextLaunchers = recalculateLaunchersFromCenter(
              updatedItem.latitude,
              updatedItem.longitude,
              updatedItem.altitude || 0,
              updatedItem.compositeBattery.launchers,
              updatedItem.batteryConfig
            );
            updatedItem.compositeBattery = {
              ...updatedItem.compositeBattery,
              launchers: nextLaunchers,
            };
          }

          return updatedItem;
        }),
        coverageVolumes: nextVolumes,
        samCoverageResults: nextSamCoverage,
        ...(state.selectedInstanceId === instanceId &&
        (updates.latitude !== undefined || updates.longitude !== undefined || updates.rangeKm !== undefined)
          ? clearSiteProfileState()
          : {}),
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

  updateBatteryLauncherPosition: (instanceId, launcherId, lat, lon, alt, losResult) =>
    set((state) => ({
      instances: state.instances.map((item) => {
        if (item.instanceId !== instanceId || !item.compositeBattery || !item.batteryConfig) return item;
        const nextLaunchers = updateSingleLauncherPosition(
          item.latitude,
          item.longitude,
          launcherId,
          lat,
          lon,
          alt,
          item.compositeBattery.launchers,
          item.batteryConfig,
          losResult
        );
        return {
          ...item,
          compositeBattery: {
            ...item.compositeBattery,
            launchers: nextLaunchers,
          },
        };
      }),
    })),

  setBatteryCombatMode: (instanceId, mode) =>
    set((state) => ({
      instances: state.instances.map((item) => {
        if (item.instanceId !== instanceId || !item.compositeBattery) return item;
        return {
          ...item,
          compositeBattery: {
            ...item.compositeBattery,
            combatMode: mode,
          },
        };
      }),
    })),

  setBatteryCombatAzimuth: (instanceId, azimuthDeg) =>
    set((state) => ({
      instances: state.instances.map((item) => {
        if (item.instanceId !== instanceId || !item.compositeBattery) return item;
        return {
          ...item,
          compositeBattery: {
            ...item.compositeBattery,
            combatAzimuthDeg: (azimuthDeg + 360) % 360,
          },
        };
      }),
    })),

  setBatteryLayerVisibility: (instanceId, layer, visible) =>
    set((state) => ({
      instances: state.instances.map((item) => {
        if (item.instanceId !== instanceId || !item.compositeBattery) return item;
        return {
          ...item,
          compositeBattery: {
            ...item.compositeBattery,
            showLayers: {
              ...item.compositeBattery.showLayers,
              [layer]: visible,
            },
          },
        };
      }),
    })),

  setBatteryMastHeightOverride: (instanceId, mastHeightM) =>
    set((state) => ({
      instances: state.instances.map((item) => {
        if (item.instanceId !== instanceId || !item.compositeBattery) return item;
        return {
          ...item,
          compositeBattery: {
            ...item.compositeBattery,
            mastHeightOverrideM: mastHeightM,
          },
        };
      }),
    })),

  switchBatteryTarRadar: (instanceId, tarRadarId) => {
    invalidateVolumeCache(instanceId);
    set((state) => {
      const nextSamCoverage = { ...state.samCoverageResults };
      delete nextSamCoverage[instanceId];
      const nextSamVolumes = { ...state.samVolumes };
      delete nextSamVolumes[instanceId];

      const instances = state.instances.map((inst) => {
        if (inst.instanceId !== instanceId || !inst.batteryConfig) return inst;

        // Find candidate radar in alternateTarOptions or EQUIPMENT_TEMPLATES
        const altOption = inst.batteryConfig.alternateTarOptions?.find((o) => o.id === tarRadarId);
        const tmplOption = EQUIPMENT_TEMPLATES.find((t) => t.id === tarRadarId);

        const newTarId = altOption?.id || tmplOption?.id || tarRadarId;
        const newTarName = altOption?.name || tmplOption?.name || inst.batteryConfig.tarRadarName;
        const newRangeKm = altOption?.rangeKm ?? tmplOption?.defaultRangeKm ?? inst.batteryConfig.tarRangeKm;
        const newHeightKm = altOption?.heightKm ?? tmplOption?.coverageHeightKm ?? inst.batteryConfig.tarHeightKm;
        const newAglM = altOption?.aglM ?? tmplOption?.antennaHeightAGL ?? inst.batteryConfig.tarAglM;
        const newWavelengthM = altOption?.wavelengthM ?? tmplOption?.wavelengthM ?? inst.batteryConfig.tarWavelengthM;

        return {
          ...inst,
          batteryConfig: {
            ...inst.batteryConfig,
            tarRadarId: newTarId,
            tarRadarName: newTarName,
            tarRangeKm: newRangeKm,
            tarHeightKm: newHeightKm,
            tarAglM: newAglM,
            tarWavelengthM: newWavelengthM,
          },
        };
      });

      return {
        instances,
        samCoverageResults: nextSamCoverage,
        samVolumes: nextSamVolumes,
      };
    });
  },

  removeEquipment: (instanceId) => {
    invalidateVolumeCache(instanceId);
    set((state) => {
      const nextVolumes = { ...state.coverageVolumes };
      delete nextVolumes[instanceId];
      const nextSamCoverage = { ...state.samCoverageResults };
      delete nextSamCoverage[instanceId];

      const nextInstances = state.instances
        .filter((item) => item.instanceId !== instanceId)
        .map((item) => {
          if (item.designatedRadarId === instanceId) {
            delete nextSamCoverage[item.instanceId];
            return {
              ...item,
              designatedRadarId: null,
              samTerrainMaskMode: 'organic' as const,
            };
          }
          return item;
        });

      return {
        instances: nextInstances,
        selectedInstanceId:
          state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
        coverageVolumes: nextVolumes,
        samCoverageResults: nextSamCoverage,
        ...(state.selectedInstanceId === instanceId ? clearSiteProfileState() : {}),
      };
    });
  },

  selectEquipment: (instanceId) =>
    set((state) => ({
      selectedInstanceId: instanceId,
      activeTool: 'select',
      pendingTemplate: null,
      crossSectionProbePoint:
        state.selectedInstanceId === instanceId ? state.crossSectionProbePoint : null,
      ...(state.selectedInstanceId !== instanceId ? clearSiteProfileState() : {}),
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

  // === So Sánh Tầm Nhìn Địa Hình GIS (Observer A vs B) ===
  showTerrainComparison: false,
  terrainComparisonResult: null,
  terrainComparisonLayers: {
    baseDem: true,
    maskA: true,
    maskB: true,
    overlap: true,
    nonOverlap: true,
    missingDem: true,
  },
  setShowTerrainComparison: (show) => set({ showTerrainComparison: show }),
  setTerrainComparisonResult: (result) => set({ terrainComparisonResult: result }),
  toggleTerrainComparisonLayer: (layer) =>
    set((state) => ({
      terrainComparisonLayers: {
        ...state.terrainComparisonLayers,
        [layer]: !state.terrainComparisonLayers[layer],
      },
    })),


  // === LỚP VECTƠ OFFLINE & NHẬN THỨC VÙNG PHỦ ===
  showVectorLayer: false, // Mặc định tắt: nạp theo yêu cầu vì có thể nặng
  visibleVectorKinds: [], // Rỗng = hiện tất cả loại
  selectedVectorFeature: null,
  siteProfile: null,
  showMapOverlays: true,
  isAnalyzingSite: false,
  // Vite inject danh sách gói vectơ lúc khởi động; 0 nghĩa là chỉ có ảnh raster.
  vectorPackCount: typeof __OFFLINE_MAP_ASSETS__ === 'undefined'
    ? 0
    : Array.isArray(__OFFLINE_MAP_ASSETS__.vectorRegions)
      ? __OFFLINE_MAP_ASSETS__.vectorRegions.length
      : 0,
  toggleVectorLayer: () =>
    set((state) => ({
      showVectorLayer: !state.showVectorLayer,
      // Bật lớp đối tượng thì ẩn các bảng nổi để không che mất bản đồ.
      showMapOverlays: !state.showVectorLayer ? false : state.showMapOverlays,
    })),
  setShowVectorLayer: (on) =>
    set((state) => ({
      showVectorLayer: on,
      // Bật lớp đối tượng thì ẩn các bảng nổi để không che mất bản đồ.
      showMapOverlays: on ? false : state.showMapOverlays,
    })),
  setShowMapOverlays: (show) => set({ showMapOverlays: show }),
  setVisibleVectorKinds: (kinds) => set({ visibleVectorKinds: kinds }),
  selectVectorFeature: (feature) => set({ selectedVectorFeature: feature }),

  /**
   * Dựng đặc tính vùng phủ cho khí tài đang chọn.
   *
   * Bán kính phân tích = TẦM HOẠT ĐỘNG của chính khí tài đó (`instance.rangeKm`),
   * nên "trong phạm vi hoạt động" là điều kiện bắt buộc chứ không phải lựa chọn.
   * Nếu không có khí tài được chọn thì phân tích quanh tâm camera như cố vấn AI.
   */
  analyzeSelectedSite: async () => {
    const requestId = ++siteAnalysisRequestId;
    const state = get();
    const instance = state.instances.find((i) => i.instanceId === state.selectedInstanceId);

    const viewport = getAdvisorViewport();
    const lat = instance ? instance.latitude : viewport.lat;
    const lon = instance ? instance.longitude : viewport.lon;
    const radiusKm = instance ? instance.rangeKm : deriveAdvisorRadiusKm(viewport.heightM);

    set({ isAnalyzingSite: true, siteProfile: null });
    try {
      const store = await loadVectorFeatureStore();
      if (requestId !== siteAnalysisRequestId) return;
      const profile = await buildSiteProfile(lat, lon, radiusKm, undefined, store);
      if (requestId !== siteAnalysisRequestId) return;
      set({ siteProfile: profile, isAnalyzingSite: false });
    } catch (error) {
      if (requestId !== siteAnalysisRequestId) return;
      console.error('Không phân tích được vùng phủ:', error);
      set({ isAnalyzingSite: false, siteProfile: null });
    }
  },

  // 3D SAM Engagement Volume Initial State & Actions
  samVolumes: {},
  samEngagementModes: {},
  setSamVolume: (instanceId, volume) =>
    set((state) => ({
      samVolumes: { ...state.samVolumes, [instanceId]: volume },
    })),
  setSamEngagementMode: (instanceId, mode) =>
    set((state) => {
      const inst = state.instances.find((i) => i.instanceId === instanceId);
      if (!inst) return state;
      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === inst.templateId);
      const profiles = inst.samProfiles || tmpl?.samProfiles;
      let profile = profiles?.[mode];
      let resolvedMode = mode;

      if (!profile && profiles) {
        if (mode === 'jamming_passive' && profiles['passive_jamming']) {
          profile = profiles['passive_jamming'];
          resolvedMode = 'passive_jamming';
        } else if (mode === 'passive_jamming' && profiles['jamming_passive']) {
          profile = profiles['jamming_passive'];
          resolvedMode = 'jamming_passive';
        } else if (mode === 'jamming_active' && profiles['active_jamming']) {
          profile = profiles['active_jamming'];
          resolvedMode = 'active_jamming';
        } else if (mode === 'active_jamming' && profiles['jamming_active']) {
          profile = profiles['jamming_active'];
          resolvedMode = 'jamming_active';
        } else if (mode === 'tbk_optical' && profiles['tvk_optical']) {
          profile = profiles['tvk_optical'];
          resolvedMode = 'tvk_optical';
        } else if (mode === 'tvk_optical' && profiles['tbk_optical']) {
          profile = profiles['tbk_optical'];
          resolvedMode = 'tbk_optical';
        } else if (mode === 'jamming' && (profiles['active_jamming'] || profiles['jamming_active'])) {
          profile = profiles['active_jamming'] || profiles['jamming_active'];
          resolvedMode = profiles['active_jamming'] ? 'active_jamming' : 'jamming_active';
        }
      }

      const nextInstances = state.instances.map((i) => {
        if (i.instanceId !== instanceId) return i;
        return {
          ...i,
          samEngagementMode: resolvedMode,
          rangeKm: profile ? profile.dMaxKm : i.rangeKm,
          minEngagementRangeKm: profile ? profile.dMinKm : i.minEngagementRangeKm,
          maxEngagementAltitudeM: profile ? profile.hMaxM : i.maxEngagementAltitudeM,
          minEngagementAltitudeM: profile ? profile.hMinM : i.minEngagementAltitudeM,
          maxTargetSpeedMps: profile ? profile.vMaxMps : i.maxTargetSpeedMps,
          maxTargetParamKm: profile ? profile.pGhKm : i.maxTargetParamKm,
        };
      });
      return {
        instances: nextInstances,
        samEngagementModes: { ...state.samEngagementModes, [instanceId]: resolvedMode },
      };
    }),
  clearSamVolumes: () => set({ samVolumes: {} }),

  // Vùng Hỏa Lực SAM Cắt Địa Hình State & Actions
  samCoverageResults: {},
  setSamCoverageResult: (instanceId, result) =>
    set((state) => ({
      samCoverageResults: { ...state.samCoverageResults, [instanceId]: result },
    })),
  clearSamCoverageResults: () => set({ samCoverageResults: {} }),

  triggerRadarCameraPreset: (preset) => {
    const state = get();
    const inst = state.instances.find((i) => i.instanceId === state.selectedInstanceId);
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
  aiAdvisorDegraded: false,
  aiAdvisorSuggestions: [],
  aiAdvisorRoute: [],
  aiAdvisorTemplateId: null,
  selectedAdvisorSuggestionIndex: null,

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
  setAiAdvisorPanelOpen: (open) =>
    set((state) => {
      return {
        aiAdvisorPanelOpen: open,
        // Mở bảng phân tích thì tự bật lớp đối tượng: bảng này đếm nhà / sông /
        // suối, người dùng cần nhìn thấy chúng trên bản đồ mới tin được con số.
        // Đồng thời ẩn các bảng nổi khác cho khỏi chồng lên nhau.
        showVectorLayer: open ? true : state.showVectorLayer,
        // Đóng panel thì trả bảng nổi về lại. Nếu không, người dùng tắt bảng phân
        // tích rồi bấm bật lại lớp đối tượng thì mất luôn Bảng chú giải và không
        // còn đường nào để bật lại.
        showMapOverlays: open ? false : true,
      };
    }),
  toggleAiAdvisorPanel: () => get().setAiAdvisorPanelOpen(!get().aiAdvisorPanelOpen),
  setAiAdvisorTemplateId: (templateId) => set({ aiAdvisorTemplateId: templateId }),

  clearAiPlacementSuggestions: () =>
    set({
      aiAdvisorSuggestions: [],
      aiAdvisorRoute: [],
      aiAdvisorSummary: '',
      aiAdvisorError: null,
      aiAdvisorDegraded: false,
      aiAdvisorStatus: 'idle',
      selectedAdvisorSuggestionIndex: null,
    }),

  selectAdvisorSuggestion: (index) => {
    const list = get().aiAdvisorSuggestions;
    set({ selectedAdvisorSuggestionIndex: resolveAdvisorSuggestionIndex(index, list.length) });
  },

  runAiPlacementAnalysis: async (model) => {
    const state = get();
    const template = resolveAdvisorTemplate(state);

    // Ghi lại template đã chọn để UI phản ánh đúng khí tài vừa dùng
    set({ aiAdvisorTemplateId: template.id, aiAdvisorStatus: 'checking', aiAdvisorError: null });

    // 1. ĐỘNG CƠ CLIENT: tính ứng viên từ DỮ LIỆU THẬT (terrain + lớp vectơ OSM).
    // Đây là bước quyết định khắc phục hiện tượng "đặt đại": toạ độ KHÔNG do model bịa.
    const viewport = getAdvisorViewport();
    const areaRadiusKm = deriveAdvisorRadiusKm(viewport.heightM);

    let candidates: PlacementCandidate[] = [];
    try {
      candidates = await generatePlacementCandidates({
        center: { lat: viewport.lat, lon: viewport.lon },
        radiusKm: areaRadiusKm,
        template,
        placed: state.instances.map((item) => ({
          latitude: item.latitude,
          longitude: item.longitude,
          rangeKm: item.rangeKm,
        })),
      });
    } catch (error) {
      console.warn('Động cơ sinh ứng viên thất bại; không có gợi ý nào được tạo.', error);
    }

    const { suggestions, route } = candidatesToSuggestions(candidates);

    // Ghi ngay kết quả CÓ CĂN CỨ của động cơ: kể cả VECTOR AI chưa chạy, người dùng vẫn
    // thấy gợi ý kèm số liệu thật (thay vì màn hình trắng như trước).
    set({
      aiAdvisorSuggestions: suggestions,
      aiAdvisorRoute: route,
      aiAdvisorSummary: '',
      aiAdvisorDegraded: true,
      aiAdvisorError: null,
      // Danh sách mới -> bỏ chọn gợi ý cũ để index không trỏ sai.
      selectedAdvisorSuggestionIndex: null,
    });

    if (suggestions.length === 0) {
      set({
        aiAdvisorStatus: 'ready',
        aiAdvisorDegraded: false,
        aiAdvisorSummary:
          'Không tìm được ứng viên vị trí phù hợp trong vùng quan tâm (thiếu dữ liệu địa hình/vectơ hoặc vùng quá nhỏ).',
      });
      return;
    }

    // 2. VECTOR AI: chỉ XẾP HẠNG + DIỄN GIẢI danh sách ứng viên, KHÔNG sinh toạ độ.

    // 2a. Kiểm tra backend (health)
    const health = await checkVectorAiHealth();
    if (!health.ok) {
      // Backend local không trả lời (kể cả timeout) => vẫn giữ gợi ý của động cơ.
      const isOffline = health.error.kind === 'offline' || health.error.kind === 'timeout';
      set({
        aiAdvisorStatus: isOffline ? 'offline' : 'error',
        aiAdvisorError: health.error.message,
        aiAdvisorDegraded: true,
      });
      return;
    }

    // The local engine remains usable when the backend has no selected model.
    // Keep its measured candidates without issuing an invalid model="" request.
    if (model.trim().length === 0) {
      set({
        aiAdvisorStatus: 'ready',
        aiAdvisorDegraded: true,
        aiAdvisorSummary:
          'Đã tính ứng viên từ dữ liệu hiện có. Chọn mô hình AI để bổ sung xếp hạng và diễn giải.',
      });
      return;
    }

    // 2b. Dựng đặc tính địa hình vùng phủ (terrain + lớp vectơ OSM) làm NGỮ CẢNH cho AI
    // viết diễn giải. Toạ độ/điểm đã do động cơ quyết định ở bước 1, nên phần này chỉ
    // giúp AI hành văn sát thực tế; không có gói vectơ thì vẫn chạy được.
    let siteProfileText: string | undefined;
    try {
      const profile = await buildSiteProfile(viewport.lat, viewport.lon, areaRadiusKm);
      siteProfileText = profile.text;
    } catch (error) {
      console.warn('Không dựng được đặc tính địa hình; tiếp tục phân tích AI không có dữ liệu địa hình.', error);
    }

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
      areaRadiusKm,
      siteProfileText,
    };

    set({ aiAdvisorStatus: 'thinking' });

    // 2c. Hỏi model: gửi danh sách ứng viên đã tính điểm, xin XẾP HẠNG + diễn giải.
    const answer = await askVectorAi({
      model,
      messages: buildRankingMessages(context, candidates),
      // GIS evidence is provided by the local engine, rather than retrieved documents.
      strictSources: false,
    });
    if (!answer.ok) {
      // Vẫn giữ gợi ý của động cơ; chỉ thiếu phần diễn giải của AI.
      set({
        aiAdvisorStatus:
          answer.error.kind === 'offline' || answer.error.kind === 'timeout' ? 'offline' : 'error',
        aiAdvisorError: answer.error.message,
        aiAdvisorDegraded: true,
      });
      return;
    }

    // 2d. Parse xếp hạng; gắn diễn giải vào đúng ứng viên, GIỮ toạ độ/điểm của động cơ.
    const parsed = parsePlacementRanking(answer.value.text, suggestions.length);
    if (!parsed.ok) {
      set({ aiAdvisorStatus: 'error', aiAdvisorError: parsed.message, aiAdvisorDegraded: true });
      return;
    }

    const reranked = applyAiRanking(suggestions, parsed.value.ranking);
    set({
      aiAdvisorStatus: 'ready',
      aiAdvisorError: null,
      // AI không chọn ứng viên nào -> coi như suy giảm (chỉ còn số liệu động cơ).
      aiAdvisorDegraded: parsed.value.ranking.length === 0,
      aiAdvisorSummary: parsed.value.summary,
      aiAdvisorSuggestions: reranked,
      // AI xếp hạng lại làm đổi thứ tự -> bỏ chọn để index không trỏ sai gợi ý.
      selectedAdvisorSuggestionIndex: null,
      aiAdvisorRoute: reranked
        .slice(0, MAX_ADVISOR_ROUTE_POINTS)
        .map((item) => ({ latitude: item.latitude, longitude: item.longitude })),
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

    // Cao độ lấy từ SỐ LIỆU THẬT đã đo khi chấm điểm (criteria.elevationM). Nhờ vậy đài
    // không còn bị "chôn" dưới đất như bản cũ (vốn luôn đặt altitude = 0).
    const groundElevationM = suggestion.criteria?.hasTerrainData
      ? suggestion.criteria.elevationM
      : 0;

    const instance = createEquipmentFromTemplate(template, {
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5)),
      altitude: groundElevationM,
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
      ...clearSiteProfileState(),
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
      ...clearSiteProfileState(),
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
        name: 'Trận Địa Tên Lửa SPYDER (SR/MR) Cảng Hải Phòng',
        category: 'TenLuaPhongKhong',
        latitude: 20.86,
        longitude: 106.72,
        altitude: 10,
        antennaHeightAGL: 8,
        rangeKm: 50,
        minEngagementRangeKm: 1,
        maxEngagementAltitudeM: 16000,
        minEngagementAltitudeM: 20,
        maxTargetSpeedMps: 800,
        reactionTimeSeconds: 4,
        guidanceMethodVi: 'Chủ động sóng milimet Derby-MR & Hồng ngoại 2 băng IIR Python-5 kết hợp Datalink',
        scanSpeed: 0,
        minElevationDeg: 5,
        maxElevationDeg: 75,
        coverageHeightKm: 16,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#0ea5e9',
        showDome: true,
        showSweep: false,
        samEngagementMode: 'head_on',
        batteryConfig: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder')?.batteryConfig,
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
        batteryConfig: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')?.batteryConfig,
        samProfiles: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')?.samProfiles,
        coverageProfile: EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm')?.coverageProfile,
      },
    ];

    const sampleWithModels = sample.map((item) => {
      const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === item.templateId);
      const batteryConfig = item.batteryConfig || tmpl?.batteryConfig;
      const compositeBattery =
        item.compositeBattery ||
        (batteryConfig
          ? createDefaultCompositeBatteryState(item.latitude, item.longitude, item.altitude, batteryConfig)
          : undefined);
      return {
        ...item,
        batteryConfig,
        compositeBattery,
        realPhotoUrl: item.realPhotoUrl || tmpl?.realPhotoUrl,
        model3dUrl: item.model3dUrl || tmpl?.model3dUrl,
        model3dScale: item.model3dScale ?? tmpl?.model3dScale ?? 1.0,
      };
    });

    set({
      instances: sampleWithModels,
      selectedInstanceId: 'eq_radar_tamdao',
      ...clearSiteProfileState(),
    });
  },

  // === PHÂN TÍCH ĐỊA HÌNH BẰNG PHẲNG (Terrain Flatness Analysis) ===
  analysisRegion: null,
  regionInventoryStatus: 'idle',
  regionInventoryResult: null,
  regionInventoryError: null,
  analysisConfig: { ...DEFAULT_TERRAIN_ANALYSIS_CONFIG },
  analysisStatus: 'idle',
  analysisError: null,
  isSelectingFlatnessCenter: false,
  flatnessAnalysisResult: null,
  flatnessPatches: [],
  isAnalyzingFlatness: false,
  hoveredPatchId: null,
  selectedPatchId: null,
  showTerrainZoneInspector: false,
  isInspectingZone: false,

  startFlatnessSelection: () =>
    set({
      isSelectingFlatnessCenter: true,
      activeTool: 'select',
      pendingTemplate: null,
    }),

  cancelFlatnessSelection: () =>
    set({
      isSelectingFlatnessCenter: false,
    }),

  selectAnalysisRegion: (lat: number, lon: number) => {
    const regionId = Math.random().toString(36).substring(2, 9);
    const newRegion: AnalysisRegion = {
      lat,
      lon,
      radiusKm: 1.0,
      regionId,
    };

    // Ngay lập tức lưu vùng chọn, hiển thị vòng tròn, xóa kết quả mảng cũ
    // ĐẶC BIỆT: KHÔNG tự động gọi runFlatnessAnalysis!
    set({
      analysisRegion: newRegion,
      isSelectingFlatnessCenter: false,
      regionInventoryStatus: 'loading',
      regionInventoryResult: null,
      regionInventoryError: null,
      analysisStatus: 'idle',
      analysisError: null,
      isAnalyzingFlatness: false,
      flatnessAnalysisResult: null,
      flatnessPatches: [],
      selectedPatchId: null,
      hoveredPatchId: null,
      showTerrainZoneInspector: false,
      isInspectingZone: false,
    });

    // Tự động kích hoạt Luồng 1: Khảo sát dữ liệu GIS trong vòng tròn 1km
    void (useTacticalStore.getState() as any).runRegionInventory(lat, lon, 1.0, regionId);
  },

  runRegionInventory: async (lat: number, lon: number, radiusKm: number, regionId: string) => {
    try {
      const result = await surveyRegionInventory(lat, lon, radiusKm);
      const currentRegion = (useTacticalStore.getState() as any).analysisRegion as AnalysisRegion | null;
      if (!currentRegion || currentRegion.regionId !== regionId) {
        return;
      }

      set({
        regionInventoryStatus: 'success',
        regionInventoryResult: result,
        regionInventoryError: null,
      });
    } catch (err) {
      console.error('Lỗi khi khảo sát vùng GIS:', err);
      const currentRegion = (useTacticalStore.getState() as any).analysisRegion as AnalysisRegion | null;
      if (!currentRegion || currentRegion.regionId !== regionId) {
        return;
      }
      set({
        regionInventoryStatus: 'error',
        regionInventoryError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setAnalysisConfig: (config: Partial<TerrainAnalysisConfig>) => {
    set((state) => ({
      analysisConfig: {
        ...state.analysisConfig,
        ...config,
      },
    }));
  },

  resetAnalysisConfig: () => {
    set({
      analysisConfig: { ...DEFAULT_TERRAIN_ANALYSIS_CONFIG },
    });
  },

  runFlatnessAnalysis: async (targetLat?: number, targetLon?: number) => {
    const state = useTacticalStore.getState() as any;
    const currentRegion = state.analysisRegion as AnalysisRegion | null;
    const lat = typeof targetLat === 'number' ? targetLat : currentRegion?.lat;
    const lon = typeof targetLon === 'number' ? targetLon : currentRegion?.lon;

    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return;
    }

    const regionId = currentRegion?.regionId ?? Math.random().toString(36).substring(2, 9);
    if (!currentRegion) {
      set({
        analysisRegion: { lat, lon, radiusKm: 1.0, regionId },
      });
    }

    const config = state.analysisConfig as TerrainAnalysisConfig;

    set({
      analysisStatus: 'running',
      analysisError: null,
      isAnalyzingFlatness: true,
      flatnessAnalysisResult: null,
      flatnessPatches: [],
      selectedPatchId: null,
      hoveredPatchId: null,
      showTerrainZoneInspector: false,
      isInspectingZone: false,
    });

    try {
      let terrainProvider = getTerrainProvider();
      if (!terrainProvider) {
        terrainProvider = await ensureTerrainProvider();
      }
      if (!terrainProvider) {
        throw new Error('Chưa thể kết nối tới dữ liệu độ cao địa hình 3D (DEM). Vui lòng kiểm tra thư mục public/offline-terrain.');
      }
      const vectorStore = await loadVectorFeatureStore();
      const result = await analyzeTerrainFlatness(lat, lon, 1.0, {
        gridSize: 81, // 81 điểm trên đường kính 2000m -> bước lưới đều ~25m (đạt yêu cầu 20-25m)
        maxDeltaElevM: config.maxElevationDifferenceM,
        maxSlopeDeg: config.maxSlopeDeg,
        maxPatchAreaM2: config.maxPatchAreaM2,
        minPatchAreaM2: 10_000,
        terrainProvider,
        vectorStore,
      });

      // Kiểm tra nonce: Nếu người dùng đã chọn vùng khác hoặc đã xóa vùng trong lúc đang quét thì bỏ qua kết quả cũ
      const activeRegion = (useTacticalStore.getState() as any).analysisRegion as AnalysisRegion | null;
      if (!activeRegion || activeRegion.regionId !== regionId) {
        return;
      }

      if (result.patches.length > 0) {
        set({
          analysisStatus: 'success',
          flatnessAnalysisResult: result,
          flatnessPatches: result.patches,
          isAnalyzingFlatness: false,
          selectedPatchId: null, // Không tự động mở inspector khi chưa chọn mảng
          showTerrainZoneInspector: false,
          isInspectingZone: false,
        });
      } else {
        set({
          analysisStatus: 'empty',
          flatnessAnalysisResult: result,
          flatnessPatches: [],
          isAnalyzingFlatness: false,
          selectedPatchId: null,
          showTerrainZoneInspector: false,
          isInspectingZone: false,
        });
      }
    } catch (err) {
      console.error('Lỗi khi phân tích địa hình bằng phẳng:', err);
      const activeRegion = (useTacticalStore.getState() as any).analysisRegion as AnalysisRegion | null;
      if (!activeRegion || activeRegion.regionId !== regionId) {
        return;
      }
      const rawErrorMsg = err instanceof Error ? err.message : String(err);
      let friendlyError = rawErrorMsg;
      if (
        rawErrorMsg.includes('Terrain height unavailable') ||
        rawErrorMsg.includes('unavailable for') ||
        rawErrorMsg.includes('nằm ngoài phạm vi bao phủ')
      ) {
        friendlyError = 'Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ của gói DEM offline).';
      }
      set({
        analysisStatus: 'error',
        analysisError: friendlyError,
        isAnalyzingFlatness: false,
      });
    }
  },

  setHoveredPatch: (id: string | null) => set({ hoveredPatchId: id }),

  selectPatch: (id: string | null) =>
    set({
      selectedPatchId: id,
      showTerrainZoneInspector: id !== null,
      isInspectingZone: id !== null,
    }),

  closeTerrainZoneInspector: () =>
    set({
      showTerrainZoneInspector: false,
      isInspectingZone: false,
    }),

  clearFlatnessResult: () =>
    set({
      analysisRegion: null,
      regionInventoryStatus: 'idle',
      regionInventoryResult: null,
      regionInventoryError: null,
      analysisStatus: 'idle',
      analysisError: null,
      flatnessAnalysisResult: null,
      flatnessPatches: [],
      selectedPatchId: null,
      hoveredPatchId: null,
      showTerrainZoneInspector: false,
      isInspectingZone: false,
      isSelectingFlatnessCenter: false,
      isAnalyzingFlatness: false,
    }),
}));

