import type { StoreSet, StoreGet } from '../types';
import type { EquipmentInstance } from '../../types/equipment';
import { CATEGORY_META } from '../../types/equipment';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import type { SpxRadarCoverageConfig } from '../../types/spxRadarCoverage';
import { validateMutationGuard } from '../../domain/plan/planValidation';
import { selectActiveEquipment } from '../selectors/equipmentSelectors';
import {
  parseLegacyInstance,
  applyEquipmentPatchToCanonical,
} from '../../domain/adapters/legacyEquipmentAdapter';
import { invalidateVolumeCache } from '../../utils/radarVolumeEngine';
import { appendAuditToState } from '../internal/auditHelper';

export interface EquipmentSlice {
  addEquipment: (instance: EquipmentInstance) => void;
  updateEquipment: (instanceId: string, updates: Partial<EquipmentInstance>) => void;
  updateEquipmentSpxConfig: (
    instanceId: string,
    updates: Partial<SpxRadarCoverageConfig>
  ) => void;
  removeEquipment: (instanceId: string) => void;
  selectEquipment: (instanceId: string | null) => void;
}

export const createEquipmentSlice = (
  set: StoreSet,
  get: StoreGet
): EquipmentSlice => ({
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

      // Parse into Canonical Fragments (Pure Mapping)
      const parsed = parseLegacyInstance(instanceWithProfile, planId);
      const pid = parsed.placement.id;

      // Update canonical state
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
    const state = get();
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

      const placement = state.placements[instanceId];

      const definition = state.definitions[placement.definitionId];
      const observation = state.observations[instanceId];
      const visual = state.visuals[instanceId];

      if (!definition || !observation || !visual) {
        throw new Error(`Canonical fragment missing for placement ${instanceId}`);
      }

      const updatedCanonical = applyEquipmentPatchToCanonical(
        placement,
        definition,
        observation,
        visual,
        updates
      );
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

      const definition = state.definitions[placement.definitionId];
      const observation = state.observations[instanceId];
      const visual = state.visuals[instanceId];

      if (!definition || !observation || !visual) {
        throw new Error(`Canonical fragment missing for placement ${instanceId}`);
      }

      const newVisual = {
        ...visual,
        spxConfig: { ...(visual.spxConfig || {}), ...updates },
      };
      return {
        visuals: { ...state.visuals, [instanceId]: newVisual },
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

      const nextPlacements = { ...state.placements };
      const nextVisuals = { ...state.visuals };
      const nextDefinitions = { ...state.definitions };

      delete nextPlacements[instanceId];
      delete nextVisuals[instanceId];
      // Do NOT delete observations or simulations (preserve historical data)

      const definitionId = placement.definitionId;
      const hasOtherReferences = Object.values(nextPlacements).some(
        (p) => p.definitionId === definitionId
      );
      if (!hasOtherReferences) {
        delete nextDefinitions[definitionId];
      }

      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        visuals: nextVisuals,
        selectedInstanceId:
          state.selectedInstanceId === instanceId ? null : state.selectedInstanceId,
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
});
