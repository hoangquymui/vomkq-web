import type { StoreSet, StoreGet } from '../types';
import type { RadarCoverageVolume } from '../../types/radarVolume';
import type { SamEngagementVolume, SamEngagementMode } from '../../utils/missileVolumeEngine';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { validateMutationGuard } from '../../domain/plan/planValidation';
import { destinationPoint } from '../../utils/radarLosEngine';
import { selectActiveEquipment } from '../selectors/equipmentSelectors';
import { appendAuditToState } from '../internal/auditHelper';

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

export interface DerivedVisualizationSlice {
  setCoverageVolume: (instanceId: string, volume: RadarCoverageVolume) => void;
  setDome3DMode: (mode: 'nominal' | 'terrain-aware') => void;
  setSelectedAltitudeM: (altM: number) => void;
  setIsCalculatingVolume: (calculating: boolean) => void;
  toggleOccludedVolume: () => void;
  clearCoverageVolumes: () => void;
  triggerRadarCameraPreset: (preset: 'observer' | 'behind-terrain' | 'top-down') => void;

  setSamVolume: (instanceId: string, volume: SamEngagementVolume) => void;
  setSamEngagementMode: (instanceId: string, mode: SamEngagementMode) => void;
  clearSamVolumes: () => void;

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
}

export const createDerivedVisualizationSlice = (
  set: StoreSet,
  get: StoreGet
): DerivedVisualizationSlice => ({
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

      if (!definition || !observation || !visual) {
        throw new Error(`Canonical fragment missing for placement ${instanceId}`);
      }

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
      let occDistM = (inst.rangeKm || 100) * 1000 * 0.45;
      let occAltM = (inst.altitude || 0) + 900;

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

      const camDistM = occDistM + Math.max(3000, occDistM * 0.3);
      const camPos = destinationPoint(inst.latitude, inst.longitude, camDistM, azDeg);
      const camAltM = Math.max(occAltM + 1200, (inst.altitude || 0) + 1800);
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
      showBlindZones: false,
      showConeOfSilence: true,
    }),
});
