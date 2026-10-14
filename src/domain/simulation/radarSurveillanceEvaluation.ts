/**
 * @fileoverview Pure domain calculation for evaluating Radar Surveillance Horizon
 * and Overhead Blind Zone (Cone of Silence) within a Plan during a simulation step.
 * Part of Checkpoint 2C.5 First Functional Simulation Vertical Slice.
 *
 * Implements approved, real radar physical laws:
 * 1. Radio Horizon Distance (D_nt = 4.12 * (sqrt(h_a) + sqrt(H_mt))) from radar doctrine.
 * 2. Overhead Cone of Silence Radius (R_kh_mu = H_mt * cot(eps_max)).
 * 3. Inter-station baseline distance via Haversine geodesic calculation.
 *
 * Guaranteed invariants:
 * - Pure function: Zero side effects or mutations to Plan, Scenario, or Placement records.
 * - Deterministic: Produces bit-for-bit identical results for identical inputs.
 * - JSON-compatible: All output numbers are finite, rounded deterministically, and safe for Timeline storage.
 */

import {
  calculateRadarHorizonDistanceKm,
  calculateConeOfSilenceRadiusKm,
} from '../../utils/radarMath';
import { calculateHaversineDistanceKm } from '../../utils/geo';
import type { EquipmentPlacement, EquipmentDefinition } from '../types/equipment';
import type { AppendSimulationEventParams } from '../types/simulationTimeline';
import { deepFreeze } from '../../utils/deepFreeze';

export const RADAR_SURVEILLANCE_EVENT_TYPE = 'RADAR_SURVEILLANCE_EVALUATION';
export const DEFAULT_SURVEILLANCE_ALTITUDE_M = 1000; // Standard 1000m low/medium altitude threat level

export interface EvaluatedRadarStation {
  readonly placementId: string;
  readonly name: string;
  readonly category: string;
  readonly position: {
    readonly lat: number;
    readonly lon: number;
    readonly altASLM: number;
    readonly aglM: number;
  };
  readonly instrumentalRangeKm: number;
  readonly radarHorizonKm: number;
  readonly effectiveSurveillanceRangeKm: number;
  readonly coneOfSilenceRadiusKm: number;
  readonly isHorizonConstrained: boolean;
  readonly minElevationDeg: number;
  readonly maxElevationDeg: number;
}

export interface RadarSurveillanceEvaluationPayload {
  readonly planId: string;
  readonly scenarioId: string;
  readonly targetAltitudeM: number;
  readonly radarCount: number;
  readonly evaluatedRadars: readonly EvaluatedRadarStation[];
  readonly interStationBaselinesKm?: readonly {
    readonly fromPlacementId: string;
    readonly toPlacementId: string;
    readonly distanceKm: number;
  }[];
  readonly summary: {
    readonly totalInstrumentalCoverageKm: number;
    readonly totalEffectiveCoverageKm: number;
    readonly horizonConstrainedCount: number;
  };
}

/**
 * Pure evaluation function for radar surveillance coverage within a Plan.
 * Captures read-only inputs from placements and definitions and produces
 * a structured AppendSimulationEventParams ready for atomic runner commit.
 */
export function evaluateRadarSurveillanceForPlan(
  planId: string,
  scenarioId: string,
  placements: Record<string, EquipmentPlacement>,
  definitions: Record<string, EquipmentDefinition>,
  options?: {
    targetAltitudeM?: number;
  }
): AppendSimulationEventParams {
  if (!planId || typeof planId !== 'string') {
    throw new TypeError('evaluateRadarSurveillanceForPlan: planId must be a non-empty string');
  }
  if (!scenarioId || typeof scenarioId !== 'string') {
    throw new TypeError('evaluateRadarSurveillanceForPlan: scenarioId must be a non-empty string');
  }

  const targetAltitudeM = options?.targetAltitudeM ?? DEFAULT_SURVEILLANCE_ALTITUDE_M;
  if (!Number.isFinite(targetAltitudeM) || targetAltitudeM < 0) {
    throw new RangeError(
      `evaluateRadarSurveillanceForPlan: targetAltitudeM must be a non-negative finite number (got ${targetAltitudeM})`
    );
  }

  // 1. Gather all placements belonging to the specified Plan
  const planPlacements = Object.values(placements || {}).filter(
    (p) => p && p.planId === planId
  );

  const evaluatedRadars: EvaluatedRadarStation[] = [];
  let totalInstrumentalKm = 0;
  let totalEffectiveKm = 0;
  let horizonConstrainedCount = 0;

  for (const placement of planPlacements) {
    const def = definitions?.[placement.definitionId];
    if (!def) {
      throw new Error(
        `evaluateRadarSurveillanceForPlan: EquipmentDefinition "${placement.definitionId}" referenced by placement "${placement.id}" was not found`
      );
    }

    // Enforce Plan-owned EquipmentDefinition contract (Blocker B3)
    if (def.planId && def.planId !== planId) {
      throw new Error(
        `evaluateRadarSurveillanceForPlan: Cross-plan ownership mismatch! Placement "${placement.id}" belongs to plan "${planId}", but references definition "${def.id}" owned by plan "${def.planId}"`
      );
    }

    // Evaluate items categorized as radar ('radar', 'RadarCanhGioi', 'CamBienThuDong')
    const cat = String(def.category || '').toLowerCase();
    const isRadar =
      cat === 'radar' ||
      cat === 'radarcanhgioi' ||
      cat === 'cambienthudong';
    if (!isRadar) continue;

    const aglM = Number.isFinite(placement.position?.aglM) ? Math.max(0, placement.position.aglM) : 0;
    const altM = Number.isFinite(placement.position?.altM) ? Math.max(0, placement.position.altM) : 0;
    const instrumentalRangeKm = Number.isFinite(def.rangeKm) ? Math.max(0, def.rangeKm) : 0;
    const maxElev = Number.isFinite(def.maxElevationDeg) && def.maxElevationDeg > 0 ? def.maxElevationDeg : 45;
    const minElev = Number.isFinite(def.minElevationDeg) ? def.minElevationDeg : 0.5;

    // Real mathematical domain calculations from radarMath.ts
    const rawHorizonKm = calculateRadarHorizonDistanceKm(aglM, targetAltitudeM);
    const radarHorizonKm = Number(rawHorizonKm.toFixed(2));

    const rawConeKm = calculateConeOfSilenceRadiusKm(targetAltitudeM, maxElev);
    const coneOfSilenceRadiusKm = Number(rawConeKm.toFixed(2));

    const effectiveSurveillanceRangeKm = Number(Math.min(instrumentalRangeKm, radarHorizonKm).toFixed(2));
    const isHorizonConstrained = radarHorizonKm < instrumentalRangeKm;

    if (isHorizonConstrained) {
      horizonConstrainedCount++;
    }
    totalInstrumentalKm += instrumentalRangeKm;
    totalEffectiveKm += effectiveSurveillanceRangeKm;

    evaluatedRadars.push({
      placementId: placement.id,
      name: def.name || placement.id,
      category: def.category || 'radar',
      position: {
        lat: Number(placement.position?.lat?.toFixed(5) ?? 0),
        lon: Number(placement.position?.lon?.toFixed(5) ?? 0),
        altASLM: altM,
        aglM,
      },
      instrumentalRangeKm,
      radarHorizonKm,
      effectiveSurveillanceRangeKm,
      coneOfSilenceRadiusKm,
      isHorizonConstrained,
      minElevationDeg: minElev,
      maxElevationDeg: maxElev,
    });
  }

  // Calculate pairwise baselines if 2 or more radars exist
  const baselines: { fromPlacementId: string; toPlacementId: string; distanceKm: number }[] = [];
  if (evaluatedRadars.length >= 2) {
    for (let i = 0; i < evaluatedRadars.length; i++) {
      for (let j = i + 1; j < evaluatedRadars.length; j++) {
        const r1 = evaluatedRadars[i];
        const r2 = evaluatedRadars[j];
        const dist = calculateHaversineDistanceKm(
          r1.position.lat,
          r1.position.lon,
          r2.position.lat,
          r2.position.lon
        );
        baselines.push({
          fromPlacementId: r1.placementId,
          toPlacementId: r2.placementId,
          distanceKm: Number(dist.toFixed(2)),
        });
      }
    }
  }

  const payload: RadarSurveillanceEvaluationPayload = {
    planId,
    scenarioId,
    targetAltitudeM,
    radarCount: evaluatedRadars.length,
    evaluatedRadars: Object.freeze(evaluatedRadars),
    ...(baselines.length > 0 ? { interStationBaselinesKm: Object.freeze(baselines) } : {}),
    summary: Object.freeze({
      totalInstrumentalCoverageKm: Number(totalInstrumentalKm.toFixed(2)),
      totalEffectiveCoverageKm: Number(totalEffectiveKm.toFixed(2)),
      horizonConstrainedCount,
    }),
  };

  return deepFreeze({
    eventType: RADAR_SURVEILLANCE_EVENT_TYPE,
    payload,
  });
}
