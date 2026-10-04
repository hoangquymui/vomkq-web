/**
 * @fileoverview Pure adapter to project Canonical Domain Models into the legacy EquipmentInstance.
 * THIS IS A ONE-WAY PROJECTION. DO NOT USE FOR BIDIRECTIONAL SYNC.
 */
import type { EquipmentInstance } from '../../types/equipment';
import type { EquipmentDefinition, EquipmentPlacement, ObservationState } from '../types/equipment';
import type { SimulationState } from '../types/simulation';
import type { SpxRadarCoverageConfig } from '../../types/spxRadarCoverage';
import type { CoverageProfile } from '../../types/radarCoverage';
import type { AltitudeDetectionTable, SpyderSystemConfig } from '../../types/equipment';

/**
 * Presentation/UI specific fields that exist in the legacy EquipmentInstance
 * but do not belong in the Canonical Domain Model.
 */
export interface LegacyPresentationState {
  color: string;
  showDome: boolean;
  showSweep: boolean;
  spxConfig?: Partial<SpxRadarCoverageConfig>;
  targetAltitudeM?: number;
  realPhotoUrl?: string;
  model3dUrl?: string;
  model3dScale?: number;
  model3dHeadingOffset?: number;
  model3dAltitudeOffset?: number;
  customModelFileName?: string;
  customPhotoFileName?: string;
}

/**
 * Hydrates a legacy EquipmentInstance from canonical domain and presentation states.
 * This function is pure, deterministic, and does not mutate its inputs.
 *
 * @param placement - The spatial and network plan (Canonical Domain)
 * @param definition - The immutable capabilities profile (Canonical Domain)
 * @param observation - The observed operational status (Canonical Domain)
 * @param visual - The UI/render-specific toggles and styles (Presentation)
 * @param simulation - (Optional) Current tick state like sweep heading (Canonical Domain)
 * @returns A pure EquipmentInstance object compatible with existing math engines.
 */
export function hydrateLegacyInstance(
  placement: EquipmentPlacement,
  definition: EquipmentDefinition,
  observation: ObservationState,
  visual: LegacyPresentationState,
  simulation?: SimulationState
): EquipmentInstance {
  return {
    // Identity & Profile
    instanceId: placement.id,
    templateId: definition.templateId,
    name: definition.name,
    category: definition.category,

    // Core Capabilities
    rangeKm: definition.rangeKm,
    scanSpeed: definition.scanSpeed,
    minElevationDeg: definition.minElevationDeg,
    maxElevationDeg: definition.maxElevationDeg,
    coverageHeightKm: definition.coverageHeightKm,

    // Position (Plan)
    latitude: placement.position.lat,
    longitude: placement.position.lon,
    altitude: placement.position.altM,
    antennaHeightAGL: placement.position.aglM,

    // Network (Plan)
    commandedByInstanceId: placement.network.commandedBy,
    networkGroupId: placement.network.groupId,

    // Actual/Observed State
    status: observation.status,

    // Simulation State
    currentSweepHeading: simulation?.currentSweepHeading,

    // Visualization / Presentation
    color: visual.color,
    showDome: visual.showDome,
    showSweep: visual.showSweep,
    spxConfig: visual.spxConfig,
    targetAltitudeM: visual.targetAltitudeM,
    realPhotoUrl: visual.realPhotoUrl,
    model3dUrl: visual.model3dUrl,
    model3dScale: visual.model3dScale,
    model3dHeadingOffset: visual.model3dHeadingOffset,
    model3dAltitudeOffset: visual.model3dAltitudeOffset,
    customModelFileName: visual.customModelFileName,
    customPhotoFileName: visual.customPhotoFileName,

    // Extended Capabilities from the extensible Record
    shortId: definition.capabilities.shortId as string | undefined,
    wavelengthM: definition.capabilities.wavelengthM as number | undefined,
    coverageProfile: definition.capabilities.coverageProfile as CoverageProfile | undefined,
    altitudeDetectionTable: definition.capabilities.altitudeDetectionTable as AltitudeDetectionTable | undefined,
    minEngagementRangeKm: definition.capabilities.minEngagementRangeKm as number | undefined,
    maxEngagementAltitudeM: definition.capabilities.maxEngagementAltitudeM as number | undefined,
    minEngagementAltitudeM: definition.capabilities.minEngagementAltitudeM as number | undefined,
    maxTargetSpeedMps: definition.capabilities.maxTargetSpeedMps as number | undefined,
    maxTargetParamKm: definition.capabilities.maxTargetParamKm as number | undefined,
    optimalAltitudeM: definition.capabilities.optimalAltitudeM as number | undefined,
    reactionTimeSeconds: definition.capabilities.reactionTimeSeconds as number | undefined,
    deployTimeMinutes: definition.capabilities.deployTimeMinutes as number | undefined,
    guidanceMethodVi: definition.capabilities.guidanceMethodVi as string | undefined,
    samEngagementMode: definition.capabilities.samEngagementMode as EquipmentInstance['samEngagementMode'],
    samProfiles: definition.capabilities.samProfiles as EquipmentInstance['samProfiles'],
    frequencyRangeGhz: definition.capabilities.frequencyRangeGhz as string | undefined,
    spyderConfig: definition.capabilities.spyderConfig as SpyderSystemConfig | undefined,
  };
}
