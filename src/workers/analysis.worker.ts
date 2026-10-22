import type { AnalysisAoi, AnalysisTerrainSample } from '../types/analysis';
import { measureAnalysisData } from '../services/analysisData';

interface WorkerRequest { requestId: string; aoi: AnalysisAoi; baseUrl: string; regions: string[]; terrainSamples: AnalysisTerrainSample[] }
// DOM and worker share only message interfaces; no Cesium objects or UI state enter the worker.
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { requestId, aoi, baseUrl, regions, terrainSamples } = event.data;
  void measureAnalysisData(aoi, { baseUrl, regions, terrainSamples,
    onStage: (stage) => self.postMessage({ requestId, stage }),
  }).then((snapshot) => self.postMessage({ requestId, snapshot }), (error: unknown) => self.postMessage({ requestId, error: String(error) }));
});
