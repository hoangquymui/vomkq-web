import type { AnalysisAoi, AnalysisSnapshot, AnalysisTerrainSample } from '../types/analysis';
import { validateAnalysisAoi } from './analysisGeometry';

interface WorkerResponse { requestId: string; stage?: string; snapshot?: AnalysisSnapshot; error?: string }
let worker: Worker | null = null;
let running = false;

export interface MeasureAnalysisOptions {
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
  baseUrl?: string;
  terrainSamples?: AnalysisTerrainSample[];
  regions?: string[];
}

export function registeredAnalysisRegions(): string[] {
  return typeof __OFFLINE_MAP_ASSETS__ !== 'undefined' && Array.isArray(__OFFLINE_MAP_ASSETS__.vectorRegions)
    ? [...__OFFLINE_MAP_ASSETS__.vectorRegions] : [];
}

/** One foreground measurement; terminate on cancel so even a long polygon operation cannot continue. */
export async function measureAnalysisRegion(aoi: AnalysisAoi, options: MeasureAnalysisOptions = {}): Promise<AnalysisSnapshot> {
  validateAnalysisAoi(aoi);
  if (options.signal?.aborted) throw new DOMException('Đã hủy phân tích.', 'AbortError');
  if (running) throw new Error('Một vùng đang được đo; hãy hủy hoặc chờ hoàn tất.');
  const baseUrl = new URL(options.baseUrl ?? import.meta.env.BASE_URL, location.href);
  if (baseUrl.origin !== location.origin) throw new Error('Phân tích local chỉ đọc asset cùng origin.');
  const registered = registeredAnalysisRegions();
  const regions = options.regions ?? registered;
  if (regions.some((region) => !registered.includes(region))) throw new Error('Nguồn vector chưa được đăng ký trong dự án local.');
  const activeWorker = worker ??= new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
  running = true;
  const requestId = crypto.randomUUID();
  return new Promise<AnalysisSnapshot>((resolve, reject) => {
    const cleanup = () => {
      running = false;
      activeWorker.removeEventListener('message', onMessage);
      activeWorker.removeEventListener('error', onError);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const discardWorker = () => { activeWorker.terminate(); if (worker === activeWorker) worker = null; };
    const onAbort = () => { discardWorker(); cleanup(); reject(new DOMException('Đã hủy phân tích.', 'AbortError')); };
    const onError = (event: ErrorEvent) => { discardWorker(); cleanup(); reject(new Error(event.message || 'Worker phân tích gặp lỗi.')); };
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.stage) options.onStage?.(message.stage);
      if (message.error) { cleanup(); reject(new Error(message.error)); }
      else if (message.snapshot) { cleanup(); resolve(message.snapshot); }
    };
    activeWorker.addEventListener('message', onMessage);
    activeWorker.addEventListener('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    activeWorker.postMessage({ requestId, aoi, baseUrl: baseUrl.href, regions, terrainSamples: options.terrainSamples ?? [] });
    if (options.signal?.aborted) onAbort();
  });
}
