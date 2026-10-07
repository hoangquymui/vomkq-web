import type { LayoutSaveData } from '../../types/layout';
import type { CanonicalStatePackageV1 } from './canonicalStatePackage';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { CATEGORY_META, type EquipmentInstance } from '../../types/equipment';
import { parseLegacyInstance } from '../adapters/legacyEquipmentAdapter';

export function migrateLegacyLayoutToV1(layout: LayoutSaveData): CanonicalStatePackageV1 {
  const fallbackIso = '2024-01-01T00:00:00.000Z';
  const deterministicExportedAt = layout.savedAtIso8601 || fallbackIso;
  
  let rawTime = new Date(deterministicExportedAt).getTime();
  if (isNaN(rawTime)) {
    rawTime = new Date(fallbackIso).getTime();
  }

  const pkg: CanonicalStatePackageV1 = {
    schemaVersion: 1,
    metadata: {
      exportedAt: deterministicExportedAt,
      layoutName: layout.layoutName,
    },
    context: {
      activeScenarioId: 's_legacy_migrated',
      activePlanId: 'p_legacy_migrated',
      activeSimulationRunId: null,
    },
    scenarios: {},
    plans: {},
    placements: {},
    definitions: {},
    observations: {},
    simulationRuns: {},
    simulations: {},
    visuals: {},
  };

  const scenarioId = 's_legacy_migrated';
  const planId = 'p_legacy_migrated';

  pkg.scenarios[scenarioId] = {
    id: scenarioId,
    name: 'Migrated Scenario',
    terrainVersion: 'v1',
    status: 'draft',
    createdAt: rawTime,
  };

  pkg.plans[planId] = {
    id: planId,
    scenarioId,
    version: 1,
    name: 'Migrated Plan',
    status: 'draft',
  };

  // Pre-validate uniqueness
  const sourceIds = new Set<string>();
  for (const item of layout.equipments) {
    if (!item.instanceId) throw new Error('migrateLegacyLayoutToV1: empty source instance ID');
    if (sourceIds.has(item.instanceId)) throw new Error(`migrateLegacyLayoutToV1: duplicate source instance ID ${item.instanceId}`);
    sourceIds.add(item.instanceId);
  }
  for (const item of layout.equipments) {
    if (item.commandedByInstanceId && !sourceIds.has(item.commandedByInstanceId)) {
      throw new Error(`migrateLegacyLayoutToV1: dangling commandedByInstanceId ${item.commandedByInstanceId}`);
    }
  }

  // Pure deterministic IDs based on source instance ID
  const generateDeterministicId = (prefix: string, sourceId: string) => `${prefix}_${sourceId}`;

  const idMap: Record<string, string> = {};

  layout.equipments.forEach((saved, index) => {
    const template = EQUIPMENT_TEMPLATES.find((t) => t.id === saved.templateId) || EQUIPMENT_TEMPLATES[0];

    const statusMap = ['Active', 'Standby', 'Maintenance', 'Offline'] as const;
    const status = statusMap[saved.status] || 'Active';
    const prefix = CATEGORY_META[template.category]?.prefix || 'EQ';
    const autoShortId = `${prefix}-${(index + 1).toString().padStart(2, '0')}`;

    // IMPORTANT: deterministic ID mapping
    const newPlacementId = generateDeterministicId('placement', saved.instanceId);
    const newDefId = generateDeterministicId('def', saved.instanceId);

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

    pkg.placements[newPlacementId] = parsed.placement;
    pkg.definitions[newDefId] = parsed.definition;
    pkg.observations[newPlacementId] = parsed.observation;
    pkg.visuals[newPlacementId] = parsed.visual;
  });

  // Second pass: wire network references deterministically
  layout.equipments.forEach((saved) => {
    if (saved.commandedByInstanceId) {
      const newId = idMap[saved.instanceId];
      const newCommandedBy = idMap[saved.commandedByInstanceId];
      if (newId && newCommandedBy && pkg.placements[newId]) {
        pkg.placements[newId].network = {
          ...pkg.placements[newId].network,
          commandedBy: newCommandedBy
        };
      }
    }
  });

  return pkg;
}
