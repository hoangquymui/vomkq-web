import { toVectorFeature, type RawGeoJson, type RawVectorTileIndex } from '../services/vectorFeatureDecode';
import { VECTOR_LOAD_BATCH_CHARS, VECTOR_LOAD_BATCH_FEATURES,
  type VectorLoadMetrics, type VectorLoadRequest, type VectorLoadResponse } from '../services/vectorLoadProtocol';
import type { VectorFeature } from '../types/vectorFeature';

interface ActiveLoad {
  requestId: number;
  controller: AbortController;
  ack: { sequence: number; resolve: () => void; reject: (error: Error) => void } | null;
}
let active: ActiveLoad | null = null;
const send = (message: VectorLoadResponse): void => self.postMessage(message);

/** One document per worker; the client caps the pool at two raw documents. */
async function loadDocument(request: Extract<VectorLoadRequest, { kind: 'load' }>, state: ActiveLoad): Promise<void> {
  const metrics: VectorLoadMetrics = { fetchMs: 0, parseMs: 0, normalizeMs: 0 };
  let fetchStartedAt: number | null = null;
  const cancelled = (): void => {
    if (state.controller.signal.aborted) throw new Error('Vector loading cancelled.');
  };
  const flush = (batch: VectorFeature[], sequence: number): Promise<void> => {
    cancelled();
    return new Promise<void>((resolve, reject) => {
      state.ack = { sequence, resolve, reject };
      // Main thread acknowledges only after consuming this bounded message.
      send({ kind: 'batch', requestId: request.requestId, sequence, features: batch });
    });
  };
  try {
    const url = new URL(request.url, self.location.href);
    if (url.origin !== self.location.origin) throw new Error('Vector worker only reads local same-origin assets.');
    fetchStartedAt = performance.now();
    let text: string;
    if (request.blob) {
      // UTF8 decoding stays off the main thread. The client already recorded
      // network/blob preparation; this body-read time is added once separately.
      text = await request.blob.text();
    } else {
      const response = await fetch(url, { signal: state.controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ${url.href}`);
      text = await response.text();
    }
    metrics.fetchMs = performance.now() - fetchStartedAt;
    fetchStartedAt = null;
    cancelled();
    if (request.maxChars !== undefined && text.length > request.maxChars) throw new Error(`Gói vectơ "${request.regionKey}" quá lớn (${text.length} ký tự)`);
    const parseStartedAt = performance.now();
    let raw: RawGeoJson | RawVectorTileIndex;
    try { raw = JSON.parse(text) as RawGeoJson | RawVectorTileIndex; }
    finally { metrics.parseMs = performance.now() - parseStartedAt; text = ''; }
    cancelled();
    if (raw.type === 'vector-tile-index') {
      send({ kind: 'header', requestId: request.requestId, header: raw as RawVectorTileIndex });
    } else {
      if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error(`Gói vectơ "${request.regionKey}" không phải FeatureCollection hợp lệ`);
      // Metadata is tiny; never clone raw.features into the window.
      send({ kind: 'header', requestId: request.requestId, header: {
        type: raw.type, name: raw.name, bbox: raw.bbox, metadata: raw.metadata,
      } });
      let batch: VectorFeature[] = [], batchChars = 0, sequence = 0;
      let normalizeStartedAt = performance.now();
      for (let index = 0; index < raw.features.length; index++) {
        cancelled();
        const feature = toVectorFeature(raw.features[index], request.regionKey);
        // Release normalized raw objects progressively; keep no archive clone in the worker.
        delete raw.features[index];
        if (!feature) continue;
        const featureChars = JSON.stringify(feature).length;
        if (batch.length && (batch.length >= VECTOR_LOAD_BATCH_FEATURES || batchChars + featureChars > VECTOR_LOAD_BATCH_CHARS)) {
          metrics.normalizeMs += performance.now() - normalizeStartedAt;
          await flush(batch, sequence++);
          normalizeStartedAt = performance.now();
          batch = []; batchChars = 0;
        }
        batch.push(feature); batchChars += featureChars;
      }
      metrics.normalizeMs += performance.now() - normalizeStartedAt;
      if (batch.length) await flush(batch, sequence);
    }
    cancelled();
    send({ kind: 'complete', requestId: request.requestId, metrics });
  } catch (error) {
    if (fetchStartedAt !== null) metrics.fetchMs = performance.now() - fetchStartedAt;
    send({ kind: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error), metrics });
  } finally {
    state.ack = null;
    if (active === state) active = null;
  }
}

self.addEventListener('message', (event: MessageEvent<VectorLoadRequest>) => {
  const message = event.data;
  if (message.kind === 'ack') {
    if (active?.requestId === message.requestId && active.ack?.sequence === message.sequence) {
      const ack = active.ack; active.ack = null; ack.resolve();
    }
  } else if (message.kind === 'cancel') {
    if (active?.requestId === message.requestId) {
      active.controller.abort();
      active.ack?.reject(new Error('Vector loading cancelled.'));
      active.ack = null;
    }
  } else if (message.kind === 'load') {
    if (active) {
      send({ kind: 'error', requestId: message.requestId, message: 'Vector worker is already loading a file.', metrics: { fetchMs: 0, parseMs: 0, normalizeMs: 0 } });
      return;
    }
    active = { requestId: message.requestId, controller: new AbortController(), ack: null };
    void loadDocument(message, active);
  }
});
