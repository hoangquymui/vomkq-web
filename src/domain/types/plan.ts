/**
 * @fileoverview Defines the Plan, which is a specific versioned proposal
 * of equipment placements within a Scenario.
 */
import type { EquipmentPlacement } from './equipment';

export interface Plan {
  id: string;
  scenarioId: string;
  version: number;
  name: string;
  status: 'draft' | 'proposed' | 'approved';
  /** Dictionary of all placements in this plan */
  placements: Record<string, EquipmentPlacement>;
}
