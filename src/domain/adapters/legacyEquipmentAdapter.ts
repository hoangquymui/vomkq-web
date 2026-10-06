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

/**
 * Parses a legacy EquipmentInstance into its Canonical Domain fragments.
 * This is a pure function used for one-time hydration and migration.
 * It DOES NOT fabricate SimulationState or historical Plan/Scenario data.
 *
 * @param inst - The legacy EquipmentInstance object
 * @returns A tuple of Canonical fragments
 */
export function parseLegacyInstance(inst: EquipmentInstance, planId: string): {
  placement: EquipmentPlacement;
  definition: EquipmentDefinition;
  observation: ObservationState;
  visual: LegacyPresentationState;
} {
  const id = inst.instanceId;

  return {
    placement: {
      id,
      planId,
      definitionId: id, // 1-to-1 temporary mapping
      position: {
        lat: inst.latitude,
        lon: inst.longitude,
        altM: inst.altitude,
        aglM: inst.antennaHeightAGL,
      },
      network: {
        commandedBy: inst.commandedByInstanceId,
        groupId: inst.networkGroupId,
      },
    },
    observation: {
      placementId: id,
      status: inst.status,
    },
    definition: {
      id,
      planId,
      templateId: inst.templateId,
      category: inst.category,
      name: inst.name,
      rangeKm: inst.rangeKm,
      scanSpeed: inst.scanSpeed,
      minElevationDeg: inst.minElevationDeg,
      maxElevationDeg: inst.maxElevationDeg,
      coverageHeightKm: inst.coverageHeightKm,
      capabilities: {
        shortId: inst.shortId,
        wavelengthM: inst.wavelengthM,
        coverageProfile: inst.coverageProfile,
        altitudeDetectionTable: inst.altitudeDetectionTable,
        minEngagementRangeKm: inst.minEngagementRangeKm,
        maxEngagementAltitudeM: inst.maxEngagementAltitudeM,
        minEngagementAltitudeM: inst.minEngagementAltitudeM,
        maxTargetSpeedMps: inst.maxTargetSpeedMps,
        maxTargetParamKm: inst.maxTargetParamKm,
        optimalAltitudeM: inst.optimalAltitudeM,
        reactionTimeSeconds: inst.reactionTimeSeconds,
        deployTimeMinutes: inst.deployTimeMinutes,
        guidanceMethodVi: inst.guidanceMethodVi,
        samEngagementMode: inst.samEngagementMode,
        samProfiles: inst.samProfiles,
        frequencyRangeGhz: inst.frequencyRangeGhz,
        spyderConfig: inst.spyderConfig,
      },
    },
    visual: {
      color: inst.color,
      showDome: inst.showDome,
      showSweep: inst.showSweep,
      spxConfig: inst.spxConfig,
      targetAltitudeM: inst.targetAltitudeM,
      realPhotoUrl: inst.realPhotoUrl,
      model3dUrl: inst.model3dUrl,
      model3dScale: inst.model3dScale,
      model3dHeadingOffset: inst.model3dHeadingOffset,
      model3dAltitudeOffset: inst.model3dAltitudeOffset,
      customModelFileName: inst.customModelFileName,
      customPhotoFileName: inst.customPhotoFileName,
    }
  };
}

/**
 * Pure helper to route a partial legacy EquipmentInstance patch into Canonical Domain fragments.
 * Adheres strictly to the 46-field routing policy.
 */
export function applyEquipmentPatchToCanonical(
  currentPlacement: EquipmentPlacement,
  currentDefinition: EquipmentDefinition,
  currentObservation: ObservationState,
  currentVisual: LegacyPresentationState,
  patch: Partial<EquipmentInstance>
): {
  placement: EquipmentPlacement;
  definition: EquipmentDefinition;
  observation: ObservationState;
  visual: LegacyPresentationState;
} {
  // Deep clone fragments to ensure purity
  const p: EquipmentPlacement = {
    ...currentPlacement,
    position: { ...currentPlacement.position },
    network: { ...currentPlacement.network }
  };
  const d: EquipmentDefinition = {
    ...currentDefinition,
    capabilities: { ...currentDefinition.capabilities }
  };
  const o: ObservationState = { ...currentObservation };
  const v: LegacyPresentationState = { ...currentVisual };

  // Helper to check explicit presence (including false, 0, '')
  const has = (key: keyof EquipmentInstance) => patch[key] !== undefined;

  // A. PLACEMENT FIELDS
  if (has('latitude')) p.position.lat = patch.latitude!;
  if (has('longitude')) p.position.lon = patch.longitude!;
  if (has('altitude')) p.position.altM = patch.altitude!;
  if (has('antennaHeightAGL')) p.position.aglM = patch.antennaHeightAGL!;
  if (has('commandedByInstanceId')) p.network.commandedBy = patch.commandedByInstanceId;
  if (has('networkGroupId')) p.network.groupId = patch.networkGroupId;

  // B. DEFINITION FIELDS
  if (has('templateId')) d.templateId = patch.templateId!;
  if (has('category')) d.category = patch.category!;
  if (has('name')) d.name = patch.name!;
  if (has('rangeKm')) d.rangeKm = patch.rangeKm!;
  if (has('scanSpeed')) d.scanSpeed = patch.scanSpeed!;
  if (has('minElevationDeg')) d.minElevationDeg = patch.minElevationDeg!;
  if (has('maxElevationDeg')) d.maxElevationDeg = patch.maxElevationDeg!;
  if (has('coverageHeightKm')) d.coverageHeightKm = patch.coverageHeightKm!;

  // Capabilities
  if (has('shortId')) d.capabilities.shortId = patch.shortId;
  if (has('wavelengthM')) d.capabilities.wavelengthM = patch.wavelengthM;
  if (has('minEngagementRangeKm')) d.capabilities.minEngagementRangeKm = patch.minEngagementRangeKm;
  if (has('maxEngagementAltitudeM')) d.capabilities.maxEngagementAltitudeM = patch.maxEngagementAltitudeM;
  if (has('minEngagementAltitudeM')) d.capabilities.minEngagementAltitudeM = patch.minEngagementAltitudeM;
  if (has('maxTargetSpeedMps')) d.capabilities.maxTargetSpeedMps = patch.maxTargetSpeedMps;
  if (has('maxTargetParamKm')) d.capabilities.maxTargetParamKm = patch.maxTargetParamKm;
  if (has('optimalAltitudeM')) d.capabilities.optimalAltitudeM = patch.optimalAltitudeM;
  if (has('reactionTimeSeconds')) d.capabilities.reactionTimeSeconds = patch.reactionTimeSeconds;
  if (has('deployTimeMinutes')) d.capabilities.deployTimeMinutes = patch.deployTimeMinutes;
  if (has('guidanceMethodVi')) d.capabilities.guidanceMethodVi = patch.guidanceMethodVi;
  if (has('samEngagementMode')) d.capabilities.samEngagementMode = patch.samEngagementMode;
  if (has('samProfiles')) d.capabilities.samProfiles = patch.samProfiles;
  if (has('frequencyRangeGhz')) d.capabilities.frequencyRangeGhz = patch.frequencyRangeGhz;
  if (has('spyderConfig')) d.capabilities.spyderConfig = patch.spyderConfig;
  if (has('coverageProfile')) d.capabilities.coverageProfile = patch.coverageProfile;
  if (has('altitudeDetectionTable')) d.capabilities.altitudeDetectionTable = patch.altitudeDetectionTable;

  // C. OBSERVATION FIELDS
  if (has('status')) o.status = patch.status!;

  // D. PRESENTATION FIELDS
  if (has('color')) v.color = patch.color!;
  if (has('showDome')) v.showDome = patch.showDome!;
  if (has('showSweep')) v.showSweep = patch.showSweep!;
  if (has('spxConfig')) v.spxConfig = patch.spxConfig;
  if (has('targetAltitudeM')) v.targetAltitudeM = patch.targetAltitudeM;
  if (has('realPhotoUrl')) v.realPhotoUrl = patch.realPhotoUrl;
  if (has('model3dUrl')) v.model3dUrl = patch.model3dUrl;
  if (has('model3dScale')) v.model3dScale = patch.model3dScale;
  if (has('model3dHeadingOffset')) v.model3dHeadingOffset = patch.model3dHeadingOffset;
  if (has('model3dAltitudeOffset')) v.model3dAltitudeOffset = patch.model3dAltitudeOffset;
  if (has('customModelFileName')) v.customModelFileName = patch.customModelFileName;
  if (has('customPhotoFileName')) v.customPhotoFileName = patch.customPhotoFileName;

  // E. EXCLUDED & UNKNOWN FIELDS
  const knownFields = new Set<string>([
    'latitude', 'longitude', 'altitude', 'antennaHeightAGL', 'commandedByInstanceId', 'networkGroupId',
    'templateId', 'category', 'name', 'rangeKm', 'scanSpeed', 'minElevationDeg', 'maxElevationDeg', 'coverageHeightKm',
    'shortId', 'wavelengthM', 'minEngagementRangeKm', 'maxEngagementAltitudeM', 'minEngagementAltitudeM',
    'maxTargetSpeedMps', 'maxTargetParamKm', 'optimalAltitudeM', 'reactionTimeSeconds', 'deployTimeMinutes',
    'guidanceMethodVi', 'samEngagementMode', 'samProfiles', 'frequencyRangeGhz', 'spyderConfig', 'coverageProfile', 'altitudeDetectionTable',
    'status',
    'color', 'showDome', 'showSweep', 'spxConfig', 'targetAltitudeM', 'realPhotoUrl', 'model3dUrl', 'model3dScale',
    'model3dHeadingOffset', 'model3dAltitudeOffset', 'customModelFileName', 'customPhotoFileName',
    'currentSweepHeading', 'instanceId'
  ]);

  for (const key of Object.keys(patch)) {
    if (!knownFields.has(key)) {
      console.warn(`[Diagnostic] applyEquipmentPatchToCanonical: ignoring unknown/unmapped field: ${key}`);
    }
  }

  return { placement: p, definition: d, observation: o, visual: v };
}
