import type { StoreSet, StoreGet, CrossSectionProbePoint } from '../types';
import type { EquipmentCategory, EquipmentTemplate, PresetLocation } from '../../types/equipment';
import type { RadarCoverageField, RadarCoverageResult } from '../../types/radarCoverage';

export interface UiPresentationSlice {
  setShowWorkspaceModal: (show: boolean) => void;
  setWorkspaceModalTab: (tab: 'scenarios' | 'plans') => void;
  setShowLayoutModal: (show: boolean) => void;
  toggleLayoutModal: () => void;

  setActiveTool: (tool: 'select' | 'place' | 'move' | 'measure') => void;
  setPendingTemplate: (template: EquipmentTemplate | null) => void;
  setViewMode: (mode: '3D' | '2D') => void;

  setTerrainEnabled: (enabled: boolean) => void;
  setTerrainExaggeration: (exaggeration: number) => void;
  setActiveTerrainProviderKey: (activeTerrainProviderKey: string) => void;
  setBasemap: (
    basemap: 'google-terrain' | 'google-hybrid' | 'satellite' | 'offline' | 'topo' | 'dark' | 'osm'
  ) => void;
  setShowMapDownloadModal: (show: boolean) => void;
  setVietnamOnly: (vietnamOnly: boolean) => void;
  toggleVietnamOnly: () => void;

  toggleDomes: () => void;
  toggleCommandLinks: () => void;
  toggleSweeps: () => void;
  toggleSensorNetwork: () => void;

  toggleCoverageLayer: () => void;
  toggleRangeRingsLayer: () => void;
  toggleLabelsLayer: () => void;
  toggleMarkersLayer: () => void;
  toggleModelsLayer: () => void;
  setCategoryFilter: (category: EquipmentCategory | 'All') => void;

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
}

export const createUiPresentationSlice = (
  set: StoreSet,
  _get: StoreGet
): UiPresentationSlice => ({
  setShowWorkspaceModal: (show: boolean) => set({ showWorkspaceModal: show }),
  setWorkspaceModalTab: (tab: 'scenarios' | 'plans') => set({ workspaceModalTab: tab }),
  setShowLayoutModal: (show) => set({ showLayoutModal: show }),
  toggleLayoutModal: () => set((state) => ({ showLayoutModal: !state.showLayoutModal })),

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

  addMeasurePoint: (point) =>
    set((state) => ({ measurePoints: [...state.measurePoints, point] })),
  clearMeasurePoints: () => set({ measurePoints: [] }),

  triggerFlyTo: (location) => set({ flyToTarget: location }),
  clearFlyTo: () => set({ flyToTarget: null }),
});
