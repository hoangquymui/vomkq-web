import type { StoreSet, StoreGet } from '../types';
import type { LayoutSaveData, SavedEquipmentEntry } from '../../types/layout';
import type {
  CanonicalStatePackage,
  CanonicalStatePackageV1,
  CanonicalStatePackageV2,
} from '../../domain/serialization/canonicalStatePackage';
import {
  validateCanonicalStatePackage,
  migrateCanonicalPackageV1ToV2,
} from '../../domain/serialization/canonicalStatePackage';
import type { EquipmentInstance } from '../../types/equipment';
import { CATEGORY_META } from '../../types/equipment';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { SAMPLE_SCENARIO_EQUIPMENT } from '../../data/sampleScenarioData';
import { validateMutationGuard } from '../../domain/plan/planValidation';
import { selectActiveEquipment } from '../selectors/equipmentSelectors';
import {
  parseLegacyInstance,
  type LegacyPresentationState,
} from '../../domain/adapters/legacyEquipmentAdapter';
import type {
  EquipmentDefinition,
  EquipmentPlacement,
  ObservationState,
} from '../../domain/types/equipment';
import { invalidateVolumeCache } from '../../utils/radarVolumeEngine';
import { appendAuditToState } from '../internal/auditHelper';

export interface WorkspaceSlice {
  validateActiveScenarioContext: () => void;
  ensureActiveWorkspace: () => void;
  clearAll: () => void;
  importFromLayout: (layout: LayoutSaveData) => void;
  exportToLayout: (layoutName: string) => LayoutSaveData;
  loadSampleScenario: () => void;
  exportCanonicalPackage: (layoutName?: string) => CanonicalStatePackageV1;
  exportCanonicalPackageV2: (layoutName?: string) => CanonicalStatePackageV2;
  importCanonicalPackage: (pkg: CanonicalStatePackage) => void;
}

export const createWorkspaceSlice = (
  set: StoreSet,
  get: StoreGet
): WorkspaceSlice => ({
  validateActiveScenarioContext: () => {
    const state = get();
    if (!state.activeScenarioId)
      throw new Error('validateActiveScenarioContext: No active scenario');
    const scenario = state.scenarios[state.activeScenarioId];
    if (!scenario)
      throw new Error('validateActiveScenarioContext: Active scenario does not exist');

    if (!state.activePlanId) throw new Error('validateActiveScenarioContext: No active plan');
    const plan = state.plans[state.activePlanId];
    if (!plan) throw new Error('validateActiveScenarioContext: Active plan does not exist');

    if (plan.scenarioId !== state.activeScenarioId)
      throw new Error('validateActiveScenarioContext: Plan does not belong to active scenario');
  },

  ensureActiveWorkspace: () =>
    set((state) => {
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
          scenarios[nextScenarioId] = {
            id: nextScenarioId,
            name: 'Default Scenario',
            terrainVersion: 'v1',
            createdAt: Date.now(),
            status: 'active',
          };
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
          throw new Error(
            'ensureActiveWorkspace: default-plan exists but belongs to a different scenario'
          );
        }
      } else if (!nextScenarioId && nextPlanId) {
        throw new Error(
          'ensureActiveWorkspace: activePlanId exists but activeScenarioId is missing'
        );
      } else if (nextScenarioId && !nextPlanId) {
        if (!scenarios[nextScenarioId])
          throw new Error('ensureActiveWorkspace: activeScenarioId points to missing scenario');
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
          throw new Error(
            'ensureActiveWorkspace: scenario-specific default plan belongs to a different scenario'
          );
        }
      } else {
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

      for (const did of Object.keys(definitions)) {
        if (!definitions[did].planId || definitions[did].planId === 'unowned') {
          const referencingPlacements = Object.values(placements).filter(
            (p) => p.definitionId === did
          );
          if (referencingPlacements.length === 0) {
            throw new Error(
              `ensureActiveWorkspace: Orphan definition ${did} has no referencing placements`
            );
          }
          const planIds = new Set(referencingPlacements.map((p) => p.planId).filter(Boolean));
          if (planIds.size > 1) {
            throw new Error(`ensureActiveWorkspace: Definition ${did} referenced by conflicting plans`);
          }
          definitions[did] = { ...definitions[did], planId: [...planIds][0]! };
          modified = true;
        }
      }

      if (
        modified ||
        nextScenarioId !== state.activeScenarioId ||
        nextPlanId !== state.activePlanId
      ) {
        return {
          activeScenarioId: nextScenarioId,
          activePlanId: nextPlanId,
          scenarios,
          plans,
          placements,
          definitions,
        };
      }
      return {};
    }),

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
          const hasOtherRefs = Object.values(state.placements).some(
            (other) => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
        }
      }

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

      const sourceIds = new Set<string>();
      for (const item of layout.equipments) {
        if (!item.instanceId) throw new Error('importFromLayout: empty source instance ID');
        if (sourceIds.has(item.instanceId))
          throw new Error(`importFromLayout: duplicate source instance ID ${item.instanceId}`);
        sourceIds.add(item.instanceId);
      }
      for (const item of layout.equipments) {
        if (item.commandedByInstanceId && !sourceIds.has(item.commandedByInstanceId)) {
          throw new Error(
            `importFromLayout: dangling commandedByInstanceId ${item.commandedByInstanceId}`
          );
        }
      }

      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          delete nextPlacements[p.id];
          delete nextVisuals[p.id];
          const hasOtherRefs = Object.values(state.placements).some(
            (other) => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
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
        const template =
          EQUIPMENT_TEMPLATES.find((t) => t.id === saved.templateId) || EQUIPMENT_TEMPLATES[0];

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
              commandedBy: newCommandedBy,
            };
          }
        }
      });

      const firstPlanPlacement = Object.values(nextPlacements).find((p) => p.planId === planId);
      const nextState = {
        placements: nextPlacements,
        definitions: nextDefinitions,
        observations: nextObservations,
        visuals: nextVisuals,
        selectedInstanceId: firstPlanPlacement ? firstPlanPlacement.id : null,
        samEngagementModes: {},
      };

      const importedIds = Object.keys(idMap).map((k) => idMap[k]);

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
    set((state) => {
      validateMutationGuard(state);
      const planId = state.activePlanId!;

      const nextPlacements = { ...state.placements };
      const nextDefinitions = { ...state.definitions };
      const nextObservations = { ...state.observations };
      const nextVisuals = { ...state.visuals };

      for (const p of Object.values(state.placements)) {
        if (p.planId === planId) {
          delete nextPlacements[p.id];
          delete nextVisuals[p.id];
          const hasOtherRefs = Object.values(state.placements).some(
            (other) => other.id !== p.id && other.definitionId === p.definitionId
          );
          if (!hasOtherRefs) {
            delete nextDefinitions[p.definitionId];
          }
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

      SAMPLE_SCENARIO_EQUIPMENT.forEach((item) => {
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

      SAMPLE_SCENARIO_EQUIPMENT.forEach((item) => {
        if (item.commandedByInstanceId) {
          const newId = idMap[item.instanceId];
          const newCommandedBy = idMap[item.commandedByInstanceId];
          if (newId && newCommandedBy && nextPlacements[newId]) {
            nextPlacements[newId].network = {
              ...nextPlacements[newId].network,
              commandedBy: newCommandedBy,
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

      const importedIds = Object.keys(idMap).map((k) => idMap[k]);

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
        simulationClocks: {},
        simulationTimelines: {},
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
        lastImportGen: Math.max(
          (get().lastImportGen || 0) + 1,
          (get().workspaceContextGeneration || 0) + 1
        ),
        showWorkspaceModal: false,
        workspaceModalTab: 'plans' as const,
      };

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
});
