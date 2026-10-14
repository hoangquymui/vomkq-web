/**
 * @fileoverview Unit tests for radarSurveillanceEvaluation pure domain module.
 * Part of Checkpoint 2C.5.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateRadarSurveillanceForPlan,
  RADAR_SURVEILLANCE_EVENT_TYPE,
  type RadarSurveillanceEvaluationPayload,
} from './radarSurveillanceEvaluation';
import type { EquipmentPlacement, EquipmentDefinition } from '../types/equipment';

describe('Checkpoint 2C.5: Radar Surveillance Evaluation Domain Module', () => {
  const PLAN_ID = 'plan_test_01';
  const SCENARIO_ID = 'scen_test_01';

  const mockRadarDef1: EquipmentDefinition = {
    id: 'def_radar_36d6',
    planId: PLAN_ID,
    templateId: 'tmpl_36d6',
    category: 'RadarCanhGioi',
    name: 'Radar Cảnh giới 36D6',
    rangeKm: 150,
    scanSpeed: 6,
    minElevationDeg: 0.5,
    maxElevationDeg: 45,
    coverageHeightKm: 20,
    capabilities: {},
  };

  const mockPlacement1: EquipmentPlacement = {
    id: 'placement_01',
    planId: PLAN_ID,
    definitionId: 'def_radar_36d6',
    position: {
      lat: 21.0285,
      lon: 105.8542,
      altM: 10,
      aglM: 15, // 15m mast height
    },
    network: {},
  };

  const mockRadarDef2: EquipmentDefinition = {
    id: 'def_radar_kolchuga',
    planId: PLAN_ID,
    templateId: 'tmpl_kolchuga',
    category: 'RadarCanhGioi',
    name: 'Radar Kolchuga',
    rangeKm: 300,
    scanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 30,
    coverageHeightKm: 30,
    capabilities: {},
  };

  const mockPlacement2: EquipmentPlacement = {
    id: 'placement_02',
    planId: PLAN_ID,
    definitionId: 'def_radar_kolchuga',
    position: {
      lat: 20.8449,
      lon: 106.6881,
      altM: 5,
      aglM: 25, // 25m mast height
    },
    network: {},
  };

  const mockMissileDef: EquipmentDefinition = {
    id: 'def_s300',
    planId: PLAN_ID,
    templateId: 'tmpl_s300',
    category: 'TenLuaPhongKhong',
    name: 'Tiểu đoàn Tên lửa S-300PMU1',
    rangeKm: 150,
    scanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 80,
    coverageHeightKm: 27,
    capabilities: {},
  };

  const mockMissilePlacement: EquipmentPlacement = {
    id: 'placement_missile',
    planId: PLAN_ID,
    definitionId: 'def_s300',
    position: {
      lat: 21.1,
      lon: 105.9,
      altM: 20,
      aglM: 0,
    },
    network: {},
  };

  it('evaluates radar surveillance horizon and blind zone for a single radar station', () => {
    const placements = { [mockPlacement1.id]: mockPlacement1 };
    const definitions = { [mockRadarDef1.id]: mockRadarDef1 };

    const event = evaluateRadarSurveillanceForPlan(
      PLAN_ID,
      SCENARIO_ID,
      placements,
      definitions,
      { targetAltitudeM: 1000 }
    );

    expect(event.eventType).toBe(RADAR_SURVEILLANCE_EVENT_TYPE);
    const payload = event.payload as RadarSurveillanceEvaluationPayload;

    expect(payload.planId).toBe(PLAN_ID);
    expect(payload.scenarioId).toBe(SCENARIO_ID);
    expect(payload.targetAltitudeM).toBe(1000);
    expect(payload.radarCount).toBe(1);

    const r1 = payload.evaluatedRadars[0];
    expect(r1.placementId).toBe('placement_01');
    expect(r1.name).toBe('Radar Cảnh giới 36D6');
    expect(r1.position.aglM).toBe(15);
    expect(r1.instrumentalRangeKm).toBe(150);

    // Horizon: 4.12 * (sqrt(15) + sqrt(1000)) ≈ 4.12 * (3.87298 + 31.62277) = 146.24 km
    expect(r1.radarHorizonKm).toBeCloseTo(146.24, 1);
    expect(r1.effectiveSurveillanceRangeKm).toBeCloseTo(146.24, 1);
    expect(r1.isHorizonConstrained).toBe(true); // 146.24 < 150 km

    // Cone of silence: 1000m * cot(45deg) = 1000m = 1.0 km
    expect(r1.coneOfSilenceRadiusKm).toBe(1.0);

    expect(payload.summary.horizonConstrainedCount).toBe(1);
    expect(payload.summary.totalEffectiveCoverageKm).toBe(r1.effectiveSurveillanceRangeKm);
  });

  it('evaluates multiple radar stations and calculates pairwise baselines', () => {
    const placements = {
      [mockPlacement1.id]: mockPlacement1,
      [mockPlacement2.id]: mockPlacement2,
      [mockMissilePlacement.id]: mockMissilePlacement, // Missile should not be evaluated as a radar station
    };
    const definitions = {
      [mockRadarDef1.id]: mockRadarDef1,
      [mockRadarDef2.id]: mockRadarDef2,
      [mockMissileDef.id]: mockMissileDef,
    };

    const event = evaluateRadarSurveillanceForPlan(
      PLAN_ID,
      SCENARIO_ID,
      placements,
      definitions,
      { targetAltitudeM: 1000 }
    );

    const payload = event.payload as RadarSurveillanceEvaluationPayload;
    expect(payload.radarCount).toBe(2);
    expect(payload.evaluatedRadars.length).toBe(2);

    // Pairwise baseline between placement_01 (Hanoi) and placement_02 (Hai Phong)
    expect(payload.interStationBaselinesKm).toBeDefined();
    expect(payload.interStationBaselinesKm?.length).toBe(1);
    const baseline = payload.interStationBaselinesKm![0];
    expect(baseline.fromPlacementId).toBe('placement_01');
    expect(baseline.toPlacementId).toBe('placement_02');
    // Distance between Hanoi and Hai Phong is approximately 85-95 km
    expect(baseline.distanceKm).toBeGreaterThan(80);
    expect(baseline.distanceKm).toBeLessThan(110);
  });

  it('handles plans with zero radar placements cleanly', () => {
    const placements = {
      [mockMissilePlacement.id]: mockMissilePlacement,
    };
    const definitions = {
      [mockMissileDef.id]: mockMissileDef,
    };

    const event = evaluateRadarSurveillanceForPlan(
      PLAN_ID,
      SCENARIO_ID,
      placements,
      definitions
    );

    const payload = event.payload as RadarSurveillanceEvaluationPayload;
    expect(payload.radarCount).toBe(0);
    expect(payload.evaluatedRadars).toEqual([]);
    expect(payload.interStationBaselinesKm).toBeUndefined();
    expect(payload.summary.totalEffectiveCoverageKm).toBe(0);
    expect(payload.summary.horizonConstrainedCount).toBe(0);
  });

  it('rejects invalid inputs with descriptive errors', () => {
    expect(() =>
      evaluateRadarSurveillanceForPlan('', SCENARIO_ID, {}, {})
    ).toThrow(/planId must be a non-empty string/);

    expect(() =>
      evaluateRadarSurveillanceForPlan(PLAN_ID, '', {}, {})
    ).toThrow(/scenarioId must be a non-empty string/);

    expect(() =>
      evaluateRadarSurveillanceForPlan(PLAN_ID, SCENARIO_ID, {}, {}, { targetAltitudeM: -50 })
    ).toThrow(/targetAltitudeM must be a non-negative finite number/);

    // Blocker B3: Reject missing definition
    const orphanedPlacement: EquipmentPlacement = {
      ...mockPlacement1,
      definitionId: 'non_existent_def',
    };
    expect(() =>
      evaluateRadarSurveillanceForPlan(
        PLAN_ID,
        SCENARIO_ID,
        { [orphanedPlacement.id]: orphanedPlacement },
        {}
      )
    ).toThrow(/EquipmentDefinition "non_existent_def" referenced by placement "placement_01" was not found/);

    // Blocker B3: Reject cross-plan definition ownership mismatch
    const foreignDef: EquipmentDefinition = {
      ...mockRadarDef1,
      id: 'def_foreign_plan',
      planId: 'other_plan_99',
    };
    const placementWithForeignDef: EquipmentPlacement = {
      ...mockPlacement1,
      definitionId: 'def_foreign_plan',
    };
    expect(() =>
      evaluateRadarSurveillanceForPlan(
        PLAN_ID,
        SCENARIO_ID,
        { [placementWithForeignDef.id]: placementWithForeignDef },
        { [foreignDef.id]: foreignDef }
      )
    ).toThrow(/Cross-plan ownership mismatch! Placement "placement_01" belongs to plan "plan_test_01", but references definition "def_foreign_plan" owned by plan "other_plan_99"/);
  });

  it('guarantees complete determinism and immutability', () => {
    const placements = { [mockPlacement1.id]: mockPlacement1 };
    const definitions = { [mockRadarDef1.id]: mockRadarDef1 };

    const event1 = evaluateRadarSurveillanceForPlan(PLAN_ID, SCENARIO_ID, placements, definitions);
    const event2 = evaluateRadarSurveillanceForPlan(PLAN_ID, SCENARIO_ID, placements, definitions);

    expect(event1).toEqual(event2);
    expect(Object.isFrozen(event1)).toBe(true);
    expect(Object.isFrozen(event1.payload)).toBe(true);
  });
});
