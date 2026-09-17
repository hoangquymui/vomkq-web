import { create } from 'zustand';
import type { EquipmentInstance, EquipmentTemplate, PresetLocation } from '../types/equipment';
import type { LayoutSaveData, SavedEquipmentEntry } from '../types/layout';
import { EQUIPMENT_TEMPLATES, PRESET_LOCATIONS } from '../data/equipmentTemplates';

interface TacticalState {
  // Battlefield Entities
  instances: EquipmentInstance[];
  selectedInstanceId: string | null;

  // Tools & Modes
  activeTool: 'select' | 'place' | 'measure';
  pendingTemplate: EquipmentTemplate | null;
  viewMode: '3D' | '2D';

  // 3D Terrain & Basemap Options
  terrainEnabled: boolean;
  terrainExaggeration: number; // 1.0 -> 3.0
  basemap: 'satellite' | 'dark' | 'osm' | 'offline';
  vietnamOnly: boolean;

  // Visualization Toggles
  showAllDomes: boolean;
  showCommandLinks: boolean;
  showSweeps: boolean;

  // Measurement
  measurePoints: Array<{ lat: number; lon: number; height: number }>;

  // Navigation Target
  flyToTarget: PresetLocation | null;

  // Radar Coverage & LOS Parameters
  targetHeightMeters: number; // Độ cao mục tiêu H_mt (m)
  showBlindZones: boolean; // Hiển thị vùng mù (Đỏ)
  showConeOfSilence: boolean; // Hiển thị nón mù đỉnh đầu
  azimuthStepDeg: number; // Bước góc lấy mẫu (độ)
  kFactor: number; // Hệ số khúc xạ 4/3
  coverageResults: Record<string, import('../types/radarCoverage').RadarCoverageResult>;
  isCalculatingLOS: boolean;
  showRadarFieldModal: boolean;

  // Actions
  addEquipment: (instance: EquipmentInstance) => void;
  updateEquipment: (instanceId: string, updates: Partial<EquipmentInstance>) => void;
  removeEquipment: (instanceId: string) => void;
  selectEquipment: (instanceId: string | null) => void;

  setActiveTool: (tool: 'select' | 'place' | 'measure') => void;
  setPendingTemplate: (template: EquipmentTemplate | null) => void;
  setViewMode: (mode: '3D' | '2D') => void;

  setTerrainEnabled: (enabled: boolean) => void;
  setTerrainExaggeration: (exaggeration: number) => void;
  setBasemap: (basemap: 'satellite' | 'dark' | 'osm' | 'offline') => void;
  setVietnamOnly: (vietnamOnly: boolean) => void;
  toggleVietnamOnly: () => void;

  toggleDomes: () => void;
  toggleCommandLinks: () => void;
  toggleSweeps: () => void;

  // Radar Coverage Actions
  setTargetHeightMeters: (heightMeters: number) => void;
  toggleBlindZones: () => void;
  toggleConeOfSilence: () => void;
  setAzimuthStepDeg: (step: number) => void;
  setKFactor: (k: number) => void;
  setCoverageResult: (instanceId: string, result: import('../types/radarCoverage').RadarCoverageResult) => void;
  setIsCalculatingLOS: (calculating: boolean) => void;
  setShowRadarFieldModal: (show: boolean) => void;
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

export const useTacticalStore = create<TacticalState>((set, get) => ({
  instances: [],
  selectedInstanceId: null,

  activeTool: 'select',
  pendingTemplate: null,
  viewMode: '3D',

  terrainEnabled: true,
  terrainExaggeration: 1.8,
  basemap: 'satellite',
  vietnamOnly: true,

  showAllDomes: true,
  showCommandLinks: true,
  showSweeps: true,

  measurePoints: [],
  flyToTarget: PRESET_LOCATIONS[0], // Bắt đầu tại Tam Đảo (địa hình núi 3D)

  addEquipment: (instance) =>
    set((state) => ({
      instances: [...state.instances, instance],
      selectedInstanceId: instance.instanceId,
      activeTool: 'select',
      pendingTemplate: null,
    })),

  updateEquipment: (instanceId, updates) =>
    set((state) => ({
      instances: state.instances.map((item) =>
        item.instanceId === instanceId ? { ...item, ...updates } : item
      ),
    })),

  removeEquipment: (instanceId) =>
    set((state) => ({
      instances: state.instances.filter((item) => item.instanceId !== instanceId),
      selectedInstanceId:
        state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
    })),

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
  setVietnamOnly: (vietnamOnly) => set({ vietnamOnly }),
  toggleVietnamOnly: () => set((state) => ({ vietnamOnly: !state.vietnamOnly })),

  toggleDomes: () => set((state) => ({ showAllDomes: !state.showAllDomes })),
  toggleCommandLinks: () =>
    set((state) => ({ showCommandLinks: !state.showCommandLinks })),
  toggleSweeps: () => set((state) => ({ showSweeps: !state.showSweeps })),

  // Radar Coverage Initial State & Actions
  targetHeightMeters: 300, // Độ cao mục tiêu khảo sát mặc định 300m
  showBlindZones: true, // Mặc định hiển thị vùng mù (màu Đỏ)
  showConeOfSilence: true,
  azimuthStepDeg: 4, // 4 độ để quét 90 tia rất nhanh và mượt mà
  kFactor: 4 / 3, // Hệ số khúc xạ khí quyển chuẩn 4/3
  coverageResults: {},
  isCalculatingLOS: false,
  showRadarFieldModal: false,

  setTargetHeightMeters: (heightMeters) =>
    set({ targetHeightMeters: Math.max(10, heightMeters) }),
  toggleBlindZones: () =>
    set((state) => ({ showBlindZones: !state.showBlindZones })),
  toggleConeOfSilence: () =>
    set((state) => ({ showConeOfSilence: !state.showConeOfSilence })),
  setAzimuthStepDeg: (step) =>
    set({ azimuthStepDeg: Math.max(1, Math.min(15, step)) }),
  setKFactor: (k) => set({ kFactor: Math.max(1.0, Math.min(2.0, k)) }),
  setCoverageResult: (instanceId, result) =>
    set((state) => ({
      coverageResults: { ...state.coverageResults, [instanceId]: result },
    })),
  setIsCalculatingLOS: (calculating) => set({ isCalculatingLOS: calculating }),
  setShowRadarFieldModal: (show) => set({ showRadarFieldModal: show }),
  clearCoverageResults: () => set({ coverageResults: {} }),

  addMeasurePoint: (point) =>
    set((state) => ({ measurePoints: [...state.measurePoints, point] })),

  clearMeasurePoints: () => set({ measurePoints: [] }),

  triggerFlyTo: (location) => set({ flyToTarget: location }),
  clearFlyTo: () => set({ flyToTarget: null }),

  clearAll: () =>
    set({
      instances: [],
      selectedInstanceId: null,
      measurePoints: [],
    }),

  importFromLayout: (layout) => {
    const importedInstances: EquipmentInstance[] = layout.equipments.map((saved) => {
      const template =
        EQUIPMENT_TEMPLATES.find((t) => t.id === saved.templateId) ||
        EQUIPMENT_TEMPLATES[0];

      const statusMap = ['Active', 'Standby', 'Maintenance', 'Offline'] as const;
      const status = statusMap[saved.status] || 'Active';

      return {
        instanceId: saved.instanceId || `eq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        templateId: saved.templateId,
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
      },
      {
        instanceId: 'eq_radar_tamdao',
        templateId: 'radar_36d6',
        name: 'Đài Radar 36D6 Đỉnh Tam Đảo (Cao độ ~950m)',
        category: 'RadarCanhGioi',
        latitude: 21.458,
        longitude: 105.645,
        altitude: 950,
        antennaHeightAGL: 25,
        rangeKm: 320,
        scanSpeed: 36,
        minElevationDeg: 0.5,
        maxElevationDeg: 35,
        coverageHeightKm: 32,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#06b6d4',
        showDome: true,
        showSweep: true,
      },
      {
        instanceId: 'eq_radar_fansipan',
        templateId: 'radar_kolchuga',
        name: 'Trạm Trinh Sát Fansipan - Hoàng Liên Sơn (Cao độ ~3.140m)',
        category: 'TramQuanSat',
        latitude: 22.303,
        longitude: 103.775,
        altitude: 3140,
        antennaHeightAGL: 20,
        rangeKm: 400,
        scanSpeed: 0,
        minElevationDeg: 0,
        maxElevationDeg: 45,
        coverageHeightKm: 40,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#8b5cf6',
        showDome: true,
        showSweep: false,
      },
      {
        instanceId: 'eq_radar_haiphong',
        templateId: 'radar_p18',
        name: 'Trạm Radar P-18M Đồ Sơn - Hải Phòng',
        category: 'RadarCanhGioi',
        latitude: 20.71,
        longitude: 106.78,
        altitude: 60,
        antennaHeightAGL: 18,
        rangeKm: 260,
        scanSpeed: 24,
        minElevationDeg: 0,
        maxElevationDeg: 30,
        coverageHeightKm: 25,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#0ea5e9',
        showDome: true,
        showSweep: true,
      },
      {
        instanceId: 'eq_sam_s300_hanoi',
        templateId: 'sam_s300',
        name: 'Trận Địa Tên Lửa S-300PMU2 Đông Anh',
        category: 'TenLuaPhongKhong',
        latitude: 21.14,
        longitude: 105.83,
        altitude: 20,
        antennaHeightAGL: 8,
        rangeKm: 200,
        scanSpeed: 0,
        minElevationDeg: 3,
        maxElevationDeg: 65,
        coverageHeightKm: 27,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#ef4444',
        showDome: true,
        showSweep: false,
      },
      {
        instanceId: 'eq_sam_spyder_haiphong',
        templateId: 'sam_spyder',
        name: 'Trận Địa Tên Lửa Spyder-MR Cảng Hải Phòng',
        category: 'TenLuaPhongKhong',
        latitude: 20.86,
        longitude: 106.72,
        altitude: 10,
        antennaHeightAGL: 5,
        rangeKm: 50,
        scanSpeed: 0,
        minElevationDeg: 5,
        maxElevationDeg: 75,
        coverageHeightKm: 16,
        status: 'Active',
        commandedByInstanceId: c2Id,
        color: '#f97316',
        showDome: true,
        showSweep: false,
      },
    ];

    set({
      instances: sample,
      selectedInstanceId: 'eq_radar_tamdao',
    });
  },
}));
