/** Generic, read-only GIS analysis protocol v1. Coordinates are WGS84 [longitude, latitude]. */
export type AnalysisGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint'; coordinates: number[][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export type AnalysisPolygon = Extract<AnalysisGeometry, { type: 'Polygon' }>;
export interface AnalysisFeature {
  type: 'Feature';
  id?: string | number;
  geometry: AnalysisGeometry;
  properties: Record<string, unknown>;
}
export interface AnalysisAoi {
  mode: 'point' | 'circle' | 'polygon';
  label: string;
  geometry: AnalysisPolygon;
}
export type AnalysisDataStatus = 'observed' | 'missing' | 'outside' | 'partial' | 'unknown';
export interface AnalysisDataset {
  id: string;
  version: string;
  downloadedAt: string | null;
  coverage: 'observed' | 'partial' | 'outside' | 'unknown';
  bounds?: number[];
  hash?: string | null;
}
export interface AnalysisMeasurement {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  method: string;
  status: AnalysisDataStatus;
  kind?: string;
  sourceIds: string[];
}
export interface AnalysisFinding {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceIds: string[];
  geometry?: AnalysisGeometry;
}
export interface EvidenceRef {
  id: string;
  kind: 'gis' | 'document';
  sourceId: string;
  version: string;
  label: string;
  fieldPath?: string;
  value?: number | null;
  unit?: string;
  excerpt?: string;
  documentId?: string;
  chunkId?: string;
  /** Namespaced citations retain the immutable source snapshot/evidence ID. */
  snapshotId?: string;
  originEvidenceId?: string;
  geometry?: AnalysisGeometry;
}
export interface AnalysisSnapshot {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  aoi: AnalysisAoi;
  datasets: AnalysisDataset[];
  measurements: AnalysisMeasurement[];
  findings: AnalysisFinding[];
  evidence: EvidenceRef[];
  features?: AnalysisFeature[];
  terrainSamples?: AnalysisTerrainSample[];
  contentHash?: string;
}
export interface DraftAnnotation {
  id: string;
  label: string;
  geometry: AnalysisGeometry;
  evidenceIds: string[];
}
export type AnalysisWorkflowId = 'gis-analysis-v1' | 'data-quality-v1' | 'document-qa-v1' | 'report-summary-v1';
export interface AnalysisResult {
  schemaVersion: 1;
  runId: string;
  snapshotId: string | null;
  workflowId: AnalysisWorkflowId;
  createdAt: string;
  status: 'complete' | 'partial' | 'insufficient';
  answer: string;
  citations: EvidenceRef[];
  missingData: string[];
  warnings: string[];
  draftAnnotations: DraftAnnotation[];
  validation: { valid: boolean; issues: string[] };
  model: string;
  usage: Record<string, unknown>;
  sourceSnapshots?: AnalysisSnapshot[];
}
export type AnalysisRunStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export interface AnalysisRunRecord {
  runId: string;
  status: AnalysisRunStatus;
  snapshotId: string | null;
  workflowId?: string;
  createdAt?: string;
  updatedAt?: string;
  durationSeconds?: number;
  metadata?: { model?: string; modelDigest?: string; workflowVersion?: number; [key: string]: unknown };
  result?: AnalysisResult | null;
  error?: string | null;
}
export interface AnalysisReport {
  schemaVersion: 1;
  id: string;
  revision: number;
  parentId?: string;
  /** Archive provenance is separate from the local report revision chain. */
  importedFrom?: { reportId: string; revision: number; importedAt: string };
  title: string;
  createdAt: string;
  updatedAt: string;
  snapshot: AnalysisSnapshot | null;
  result: AnalysisResult;
  notes: string;
  annotations: DraftAnnotation[];
}
export interface SharedAnalysis {
  schemaVersion: 1;
  format: 'vompk-analysis';
  createdAt: string;
  report: AnalysisReport;
}
export interface AnalysisTerrainSample {
  lon: number;
  lat: number;
  height: number | null;
  sourceId: string;
}
export type AnalysisTerrainSampler = (positions: [number, number][], signal?: AbortSignal) => Promise<AnalysisTerrainSample[]>;
