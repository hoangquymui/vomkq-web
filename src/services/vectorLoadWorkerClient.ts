import type { VectorFeature } from '../types/vectorFeature';
import { createConcurrencyGate } from '../utils/concurrencyGate';
import type { VectorLoadHeader, VectorLoadMetrics, VectorLoadRequest, VectorLoadResponse } from './vectorLoadProtocol';

export interface WorkerLoadedVector { header: VectorLoadHeader; features: VectorFeature[] }
/** Prepared bytes survive worker failure, allowing fallback without another HTTP request. */
export interface WorkerVectorFallback { fallbackBlob: Blob }
export interface VectorWorkerLoadOptions {
  maxChars?: number;
  signal?: AbortSignal;
  onMetrics?: (metrics: VectorLoadMetrics) => void;
  appendBatch: (features: VectorFeature[], batch: VectorFeature[]) => Promise<void>;
}
/** Two files bound raw-document memory and leave CPU capacity for the map/UI. */
const FILE_WORKER_CONCURRENCY = 2;
/** Four total prepared/decoding jobs overlap I/O while bounding encoded-byte backlog. */
const FILE_DOWNLOAD_CONCURRENCY = 4;
const fileGate = createConcurrencyGate(FILE_WORKER_CONCURRENCY);
const downloadGate = createConcurrencyGate(FILE_DOWNLOAD_CONCURRENCY);
const workers: Worker[] = [];
const busyWorkers = new Set<Worker>();
let workerUnavailable = false;
let requestSequence = 0;

/** At most two reusable workers; each owns one file and one unacknowledged batch. */
export async function loadVectorFileInWorker(url: string, regionKey: string, options: VectorWorkerLoadOptions): Promise<WorkerLoadedVector | WorkerVectorFallback | null> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || workerUnavailable) return null;
  if (options.signal?.aborted) throw new DOMException('Vector loading cancelled.', 'AbortError');
  const absoluteUrl = new URL(url, window.location.href);
  if (absoluteUrl.origin !== new URL(window.location.href).origin) throw new Error('Vector loader only reads local same-origin assets.');
  const releaseDownload = await downloadGate.acquire();
  try {
    if (options.signal?.aborted) throw new DOMException('Vector loading cancelled.', 'AbortError');
    if (workerUnavailable) return null;
    const fetchStartedAt = performance.now();
    let blob: Blob;
    try {
      // Blob preparation keeps encoded bytes out of JSON/text processing on the
      // window. Structured cloning a Blob shares immutable backing bytes.
      const response = await fetch(absoluteUrl.href, { signal: options.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ${absoluteUrl.href}`);
      blob = await response.blob();
    } finally {
      options.onMetrics?.({ fetchMs: performance.now() - fetchStartedAt, parseMs: 0, normalizeMs: 0 });
    }
    return await decodePreparedBlob(absoluteUrl.href, regionKey, blob, options);
  } finally { releaseDownload(); }
}

async function decodePreparedBlob(url: string, regionKey: string, blob: Blob, options: VectorWorkerLoadOptions): Promise<WorkerLoadedVector | WorkerVectorFallback> {
  const release = await fileGate.acquire();
  let assignedWorker: Worker | null = null;
  try {
    if (options.signal?.aborted) throw new DOMException('Vector loading cancelled.', 'AbortError');
    if (workerUnavailable) return { fallbackBlob: blob };
    assignedWorker = workers.find((candidate) => !busyWorkers.has(candidate)) ?? null;
    if (!assignedWorker) {
      try {
        assignedWorker = new Worker(new URL('../workers/vector-loader.worker.ts', import.meta.url), { type: 'module' });
        workers.push(assignedWorker);
      }
      catch { workerUnavailable = true; return { fallbackBlob: blob }; }
    }
    const activeWorker = assignedWorker;
    busyWorkers.add(activeWorker);
    const discardWorker = (): void => {
      activeWorker.terminate();
      const index = workers.indexOf(activeWorker);
      if (index >= 0) workers.splice(index, 1);
      busyWorkers.delete(activeWorker);
    };
    const requestId = ++requestSequence;
    return await new Promise<WorkerLoadedVector | WorkerVectorFallback>((resolve, reject) => {
      let header: VectorLoadHeader | null = null;
      const features: VectorFeature[] = [];
      let sequence = 0, consuming = false, finished = false;
      const post = (message: VectorLoadRequest): void => activeWorker.postMessage(message);
      const cleanup = (): void => {
        activeWorker.removeEventListener('message', onMessage);
        activeWorker.removeEventListener('error', onError);
        activeWorker.removeEventListener('messageerror', onError);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const fail = (error: Error, discard: boolean): void => {
        if (finished) return;
        finished = true; cleanup();
        if (discard) discardWorker();
        reject(error);
      };
      const fallback = (): void => {
        if (finished) return;
        if (options.signal?.aborted) { onAbort(); return; }
        // Transport/startup failure is not a failed data cell. Discard any
        // partial batches, then let this SAME file use the cooperative decoder.
        workerUnavailable = true;
        finished = true; cleanup();
        discardWorker();
        features.length = 0;
        resolve({ fallbackBlob: blob });
      };
      const onAbort = (): void => {
        // Terminating interrupts JSON.parse and a large geometry immediately;
        // a cancel message cannot interrupt synchronous work inside a worker.
        fail(new DOMException('Vector loading cancelled.', 'AbortError'), true);
      };
      const onError = (): void => {
        fallback();
      };
      const onMessage = (event: MessageEvent<VectorLoadResponse>): void => {
        const message = event.data;
        if (message.requestId !== requestId || finished) return;
        if (message.kind === 'header') header = message.header;
        else if (message.kind === 'batch') {
          if (!header || consuming || message.sequence !== sequence || !Array.isArray(message.features)) {
            fallback(); return;
          }
          consuming = true;
          void options.appendBatch(features, message.features).then(() => {
            if (finished) return;
            consuming = false; sequence++;
            try { post({ kind: 'ack', requestId, sequence: message.sequence }); }
            catch { fallback(); }
          }, (error: unknown) => fail(error instanceof Error ? error : new Error(String(error)), true));
        } else if (message.kind === 'error') {
          options.onMetrics?.(message.metrics);
          fail(new Error(message.message), false);
        } else if (message.kind === 'complete') {
          if (!header || consuming) { fallback(); return; }
          options.onMetrics?.(message.metrics);
          finished = true; cleanup(); resolve({ header, features });
        }
      };
      activeWorker.addEventListener('message', onMessage);
      activeWorker.addEventListener('error', onError);
      activeWorker.addEventListener('messageerror', onError);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try { post({ kind: 'load', requestId, url, blob, regionKey, maxChars: options.maxChars }); }
      catch { fallback(); }
      if (options.signal?.aborted) onAbort();
    });
  } finally {
    if (assignedWorker) busyWorkers.delete(assignedWorker);
    release();
  }
}
