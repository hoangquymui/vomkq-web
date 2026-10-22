import type { VectorFeature } from '../types/vectorFeature';
import type { RawGeoJson, RawVectorTileIndex } from './vectorFeatureDecode';

/** Transport budgets only. Every valid feature is retained, including a large single feature. */
export const VECTOR_LOAD_BATCH_FEATURES = 256;
/** Approximate serialized characters, bounding clone payloads independently of feature count. */
export const VECTOR_LOAD_BATCH_CHARS = 512 * 1024;

/** fetchMs includes network/body reads; worker Blob.text reads are reported here too. */
export interface VectorLoadMetrics { fetchMs: number; parseMs: number; normalizeMs: number }
export type VectorLoadHeader = Omit<RawGeoJson, 'features'> | RawVectorTileIndex;
export type VectorLoadRequest =
  | { kind: 'load'; requestId: number; url: string; blob?: Blob; regionKey: string; maxChars?: number }
  | { kind: 'ack'; requestId: number; sequence: number }
  | { kind: 'cancel'; requestId: number };
export type VectorLoadResponse =
  | { kind: 'header'; requestId: number; header: VectorLoadHeader }
  | { kind: 'batch'; requestId: number; sequence: number; features: VectorFeature[] }
  | { kind: 'complete'; requestId: number; metrics: VectorLoadMetrics }
  | { kind: 'error'; requestId: number; message: string; metrics: VectorLoadMetrics };
