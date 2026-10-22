/** Actual Chrome local terrain+vector regression, CDP :9339; no AI/placement runs. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const folder = new URL('../logs/local-data-verification/', import.meta.url);
const useWorker = !process.argv.includes('--fallback');
await mkdir(folder, { recursive: true });
const target = await fetch('http://127.0.0.1:9339/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(), terrainFailures = [], workerRequests = [], pageEvents = [];
let sequence = 0;
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (['Page.frameNavigated', 'Inspector.targetCrashed', 'Runtime.exceptionThrown'].includes(event.method)) pageEvents.push({ method: event.method, params: event.params });
  if (event.method === 'Network.responseReceived') {
    const { url, status } = event.params.response;
    if (url.includes('/offline-terrain/') && status >= 400) terrainFailures.push({ url, status });
    if (url.includes('vector-loader.worker')) workerRequests.push({ url, status });
  }
  const call = pending.get(event.id); if (!call) return;
  pending.delete(event.id); clearTimeout(call.timer);
  event.error ? call.reject(new Error(JSON.stringify(event.error))) : call.resolve(event.result);
};
socket.onclose = () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Target closed')); } pending.clear(); };
function send(method, params = {}, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, timeout);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, timeout = 30_000) {
  const value = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true }, timeout);
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
function check(name, condition) { assert(condition, name); checks.push(name); console.log(`PASS ${name}`); }
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('vompk.analysis.v2.enabled','false');" + (useWorker ? '' : 'window.Worker=undefined;') });
  await send('Page.navigate', { url: 'http://127.0.0.1:3000' });
  for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector('.cesium-widget canvas')`)) break; await pause(100); }
  await pause(2500);
  const terrain = await evaluate(`(async()=>{
    const helper=await import('/src/services/offlineTerrainProvider.ts');const first=helper.getOfflineTerrainProvider(),second=helper.getOfflineTerrainProvider();const provider=await first;
    const code=await fetch('/src/components/map/CesiumGlobe.tsx').then(r=>r.text());const url=code.match(/from\\s+["']([^"']*\\/cesium\\.js[^"']*)["']/)[1];const C=await import(url);
    const y=511-300,rectangle=provider.tilingScheme.tileXYToRectangle(824,y,9),position=C.Rectangle.center(rectangle);
    await C.sampleTerrain(provider,9,[position],false);
    return {samePromise:first===second,available:provider.getTileDataAvailable(824,y,9),heightMissing:position.height===undefined};
  })()`);
  check('Viewer helper shares one terrain provider promise', terrain.samePromise);
  check('Known absent fixed-level terrain sample stays missing without HTTP', terrain.available === false && terrain.heightMissing);
  check('Initial map and absent sampling generate no terrain HTTP errors', terrainFailures.length === 0);
  const loading = await evaluate(`(async()=>{
    const {loadVectorFeatureStore}=await import('/src/services/vectorFeatureStore.ts');let longestGap=0,ticks=0,last=performance.now();const started=last;
    const timer=setInterval(()=>{const now=performance.now();longestGap=Math.max(longestGap,now-last);last=now;ticks++},16);
    try {const store=await loadVectorFeatureStore();window.__localDataStore=store;return {count:store?.featureCount,packs:store?.packs.length,readyMs:performance.now()-started,longestGap,ticks};}finally{clearInterval(timer)}
  })()`, 240_000);
  await pause(300);
  const timing = await evaluate(`window.__vectorPerf.last()`);
  check('All 841841 local vector features and nine packs remain available', loading.count === 841841 && loading.packs === 9);
  check(useWorker ? 'Large JSON files actually parse in the worker' : 'Fallback parses without a worker', useWorker ? timing.workerParseMs > 0 && timing.mainThreadParseMs === 0 : timing.workerParseMs === 0 && timing.mainThreadParseMs > 0);
  const cached = await evaluate(`(async()=>{const {loadVectorFeatureStore}=await import('/src/services/vectorFeatureStore.ts');const before=performance.now();const store=await loadVectorFeatureStore();return {same:store===window.__localDataStore,milliseconds:performance.now()-before}})()`);
  check('Warm lookup returns the identical full store', cached.same);
  const result = { mode: useWorker ? 'worker' : 'fallback', checks, terrain, terrainFailures, loading, timing, cached, workerRequests,
    pageEvents, note: 'Actual installed headless Chrome and full current local archive; CPU/long tasks include other page work. Not desktop FPS certification.' };
  await writeFile(new URL(useWorker ? 'browser.json' : 'browser-fallback.json', folder), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(new URL('browser-failure.json', folder), JSON.stringify({ message: String(error), checks, terrainFailures, workerRequests, pageEvents }, null, 2));
  throw error;
} finally { await send('Page.close', {}, 5000).catch(() => {}); socket.close(); }
