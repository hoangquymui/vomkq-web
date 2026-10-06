/**
 * @fileoverview Defines the Plan, which is a specific versioned proposal
 * of equipment placements within a Scenario.
 */
export interface Plan {
  id: string;
  scenarioId: string;
  version: number;
  name: string;
  status: 'draft' | 'proposed' | 'approved';
}
