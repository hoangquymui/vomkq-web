/**
 * @fileoverview Defines the simulation execution state and run context.
 * Part of the Canonical Domain Model.
 */

export type SimulationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SimulationRunFreshness = 'current' | 'stale' | 'unknown';

export interface SimulationConfigSnapshot {
  timeStepSeconds?: number;
  durationSeconds?: number;
  [key: string]: unknown;
}

export interface SimulationRunDiagnostics {
  durationMs?: number;
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
}

export interface SimulationRunHandle {
  runId: string;
  runToken: string;
  importGen?: number;
}

/**
 * Canonical domain record representing a simulation execution.
 * Preserves legacy fields (id, planId, scenarioId, timestamp, config) for schema V1/V2 compatibility,
 * while providing full provenance and execution lifecycle metadata.
 */
export interface SimulationRun {
  // Legacy canonical identity & linkage
  id: string;
  planId: string;
  scenarioId: string; // Provenance context ensuring self-contained run history
  timestamp: number;
  config: Record<string, unknown>;

  // Extended Provenance & Execution Metadata (optional for legacy record compatibility)
  status?: SimulationRunStatus;
  planVersion?: number;
  scenarioVersion?: string | number;
  modelVersion?: string;
  simulationVersion?: string;
  algorithmVersion?: string;
  campaignId?: string;
  randomSeed?: number | string;
  configSnapshot?: SimulationConfigSnapshot;
  startedAt?: number;
  completedAt?: number | null;
  eventCount?: number;
  resultSummary?: Record<string, unknown>;
  diagnostics?: SimulationRunDiagnostics;
  workspaceGeneration?: number;
  planInputFingerprint?: string;
  runToken?: string;
  importGen?: number;
}

export interface SimulationState {
  runId: string;
  placementId: string;
  timeOffset: number; // Time t in the simulation tick
  currentSweepHeading?: number; // Operational state changing over simulation ticks
  activeTargets?: string[];
}
