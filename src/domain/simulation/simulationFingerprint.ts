import type { Plan } from '../types/plan';
import type { Scenario } from '../types/scenario';
import type { EquipmentDefinition, EquipmentPlacement } from '../types/equipment';
import type { SimulationConfigSnapshot } from '../types/simulation';

/**
 * Narrow context interface containing strictly the state fields required
 * to compute a deterministic Plan input fingerprint.
 */
export interface PlanFingerprintContext {
  plans: Record<string, Plan>;
  scenarios: Record<string, Scenario>;
  placements: Record<string, EquipmentPlacement>;
  definitions: Record<string, EquipmentDefinition>;
  activeTerrainProviderKey?: string;
}

/**
 * Computes a deterministic semantic fingerprint of all physical and configuration inputs
 * of a Plan, including plan version, placement coordinates, referenced equipment profiles,
 * scenario terrain version, active terrain provider key, and simulation execution config.
 * Pure presentation labels (names, colors, display tags) are strictly excluded to avoid false-stale.
 */
export function computePlanInputFingerprint(
  state: PlanFingerprintContext,
  planId: string,
  configSnapshot?: SimulationConfigSnapshot,
  randomSeed?: number | string
): string {
  const plan = state.plans[planId];
  if (!plan) return '';

  const scenario = state.scenarios[plan.scenarioId];
  const terrainVersion = scenario?.terrainVersion || 'v1';
  const terrainProviderKey = state.activeTerrainProviderKey || `flat_${terrainVersion}`;

  const placements = Object.values(state.placements)
    .filter((p) => p.planId === planId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const items = placements.map((p) => {
    const def = state.definitions[p.definitionId];
    return {
      id: p.id,
      defId: p.definitionId,
      templateId: def?.templateId,
      category: def?.category,
      lat: p.position?.lat,
      lon: p.position?.lon,
      altM: p.position?.altM,
      aglM: p.position?.aglM,
      commandedBy: p.network?.commandedBy ?? null,
      rangeKm: def?.rangeKm,
      scanSpeed: def?.scanSpeed,
      minElev: def?.minElevationDeg,
      maxElev: def?.maxElevationDeg,
      covHeight: def?.coverageHeightKm,
    };
  });

  const payload = {
    planVersion: plan.version,
    terrainVersion,
    terrainProviderKey,
    configSnapshot: configSnapshot ?? null,
    randomSeed: randomSeed ?? null,
    items,
  };

  const str = JSON.stringify(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `pifp_${hex1}${hex2}`;
}
