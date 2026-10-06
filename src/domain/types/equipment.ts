/**
 * @fileoverview Defines the core domain entities for equipment: Definitions, Placements, and Observations.
 * This file is part of the Canonical Domain Model.
 */
import type { EquipmentCategory, OperationalStatus } from '../../types/equipment';

/**
 * Represents the immutable definition/profile of an equipment type.
 */
export interface EquipmentDefinition {
  id: string;
  planId: string;
  templateId: string;
  category: EquipmentCategory;
  name: string;

  // Strongly typed capabilities required by legacy math engines
  rangeKm: number;
  scanSpeed: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  coverageHeightKm: number;

  // Temporary architecture: Extensible record for optional specific fields in Checkpoint 1A.
  // Prevents leaking 'any' to engines and UI.
  capabilities: Record<string, unknown>;
}

/**
 * Represents the planned spatial and network intention for an equipment.
 */
export interface EquipmentPlacement {
  id: string; // Placement ID, matches legacy instanceId
  planId: string;
  definitionId: string;

  /**
   * Position semantics mapping to legacy implementation:
   * altM: The terrain altitude at this location (Above Sea Level). Maps to legacy `altitude`.
   * aglM: The physical antenna mast height (Above Ground Level). Maps to legacy `antennaHeightAGL`.
   */
  position: {
    lat: number;
    lon: number;
    altM: number;
    aglM: number;
  };

  network: {
    commandedBy?: string | null;
    groupId?: string;
  };
}

/**
 * Represents the actual gathered state or observed condition from the field.
 */
export interface ObservationState {
  placementId: string;
  status: OperationalStatus;

  // Future provenance readiness
  observedAt?: number;
  source?: string;
}
