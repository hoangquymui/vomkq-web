/**
 * @fileoverview Defines the simulation execution state and run context.
 * Part of the Canonical Domain Model.
 */

export interface SimulationRun {
  id: string;
  planId: string;
  scenarioId: string; // Provenance context ensuring self-contained run history
  timestamp: number;
  config: Record<string, unknown>;
}

export interface SimulationState {
  runId: string;
  placementId: string;
  timeOffset: number; // Time t in the simulation tick
  currentSweepHeading?: number; // Operational state changing over simulation ticks
  activeTargets?: string[];
}
