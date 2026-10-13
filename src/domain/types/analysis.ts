/**
 * @fileoverview Domain definitions for Versioned Analysis Results & Freshness Lifecycle.
 * Complies with North Star v2.1 sections 1.3, 3.4-3.7, and Checkpoint 2B.
 */

export type ExecutionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'partial';

export type FreshnessStatus = 'current' | 'stale' | 'unknown';

export interface AnalysisDescriptor {
  id: string;
  nameVi: string;
  algorithmVersion: string;
  descriptionVi?: string;
  category: 'radar_coverage' | 'missile_envelope' | 'los_visibility';
}

export interface SpxAnalysisInputSnapshot {
  scenarioId: string;
  planId: string;
  planVersion: number;
  instanceId: string;
  // Spatial & antenna geometry (normalized)
  latitude: number;
  longitude: number;
  altitude: number;
  antennaHeightAGL: number;
  // Capability profile & radar parameters
  rangeKm: number;
  startRangeM?: number;
  endRangeM?: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  azimuthStartDeg?: number;
  azimuthEndDeg?: number;
  // Analysis environment & physical parameters
  kFactor: number;
  earthCurvature: boolean;
  altitudeReference: string;
  targetHeights: Array<{ id?: string; heightMeters: number; label: string }>;
  // Terrain & engine provenance
  terrainVersion: string;
  terrainProviderKey?: string;
  algorithmId: string;
  algorithmVersion: string;
}

export interface AnalysisResult<TData = any> {
  id: string;
  analysisId: string; // e.g. 'spx_radar_coverage'
  scenarioId: string;
  planId: string;
  planVersion: number;
  instanceId: string;
  calculatedAt: number;
  algorithmVersion: string;
  terrainVersion: string;
  inputSnapshot: SpxAnalysisInputSnapshot;
  inputFingerprint: string;
  requestId?: string;
  sequenceNumber?: number;
  appliedToOverlay?: boolean;
  executionStatus: ExecutionStatus;
  data?: TData; // Canonical payload (e.g. SpxCoverageResult)
  errorMessage?: string;
  warnings?: string[];
  limitations?: string[];
}

export const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  current: 'Hiện tại',
  stale: 'Đã cũ — Cần chạy lại',
  unknown: 'Chưa rõ nguồn gốc',
};

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  idle: 'Chưa phân tích',
  running: 'Đang phân tích',
  completed: 'Hoàn thành',
  failed: 'Lỗi phân tích',
  partial: 'Hoàn thành một phần',
};

export const SESSION_ONLY_DISCLAIMER = 'Kết quả chỉ lưu trong phiên làm việc';
