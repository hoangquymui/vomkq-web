/** Generic Cesium rendering regression/paired idle benchmark, isolated Chrome CDP :9339.
 * No equipment, analysis or inference is created. Compare forced continuous drawing
 * with the configured explicit-render mode in the same loaded map and camera.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const folder = new URL('../logs/map-verification/', import.meta.url);
await mkdir(folder, { recursive: true });
const target = await fetch('http://127.0.0.1:9339/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data), call = pending.get(event.id);
  if (!call) return;
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
async function evaluate(expression) {
  const value = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
function check(name, condition) { assert(condition, name); checks.push(name); console.log(`PASS ${name}`); }
async function wait(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Not ready: ${expression}`); }
async function sample(mode, move = false) {
  await evaluate(`(()=>{const v=window.__mapViewer;v.scene.requestRenderMode=${mode};window.__mapFrames=0;window.__mapStarted=performance.now();window.__mapRemove=v.scene.postRender.addEventListener(()=>window.__mapFrames++);if(${move}){window.__mapMovement=setInterval(()=>v.camera.moveRight(8),33);}return true})()`);
  const before = await send('Performance.getMetrics');
  await pause(2200);
  const after = await send('Performance.getMetrics');
  const result = await evaluate(`(()=>{window.__mapRemove();clearInterval(window.__mapMovement);return {frames:window.__mapFrames,seconds:(performance.now()-window.__mapStarted)/1000}})()`);
  const metric = (set, name) => set.metrics.find(m => m.name === name)?.value ?? 0;
  return { ...result, framesPerSecond: result.frames / result.seconds,
    taskSeconds: metric(after, 'TaskDuration') - metric(before, 'TaskDuration') };
}
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('vompk.analysis.v2.enabled','false')" });
  await send('Page.navigate', { url: 'http://127.0.0.1:3000' });
  await wait(`!!document.querySelector('.cesium-widget canvas')`);
  const found = await evaluate(`(()=>{
    const canvas=document.querySelector('.cesium-widget canvas'),seen=new Set();
    for(let element=canvas;element;element=element.parentElement){const key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));let fiber=key?element[key]:null;
      for(;fiber&&!seen.has(fiber);fiber=fiber.return){seen.add(fiber);for(const candidate of [fiber,fiber.alternate]){let hook=candidate?.memoizedState;for(let i=0;hook&&i<120;i++,hook=hook.next){for(const value of [hook.memoizedState?.current,hook.memoizedState?.[0]?.current]){try{if(value?.scene?.canvas===canvas){window.__mapViewer=value;const resources=hook.next?.memoizedState?.current;if(Array.isArray(resources))window.__mapGraphicsResources=resources;return true}}catch{}}}}}}
    return false;
  })()`);
  check('Actual mounted Cesium Viewer found', found);
  const configuration = await evaluate(`(()=>{const v=window.__mapViewer;return {requestRenderMode:v.scene.requestRenderMode,maximumRenderTimeChange:String(v.scene.maximumRenderTimeChange),resolutionScale:v.resolutionScale,targetFrameRate:v.targetFrameRate}})()`);
  check('Explicit rendering configured without time-driven continuous frames', configuration.requestRenderMode && configuration.maximumRenderTimeChange === 'Infinity');
  await evaluate(`(async()=>{const code=await fetch('/src/components/ui/TopBar.tsx').then(r=>r.text());const url=code.match(/from +['"]([^'"]*useTacticalStore[^'"]*)['"]/)[1];window.__mapStore=(await import(url)).useTacticalStore;window.__mapStore.getState().setBasemap('offline');const v=window.__mapViewer;v.camera.cancelFlight();v.camera.setView({destination:v.camera.position.constructor.fromDegrees(108.2,16.05,9000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});return true})()`);
  await wait(`window.__mapViewer.scene.globe.tilesLoaded`); await pause(2500);
  const continuous = await sample(false);
  const idle = await sample(true);
  check('Loaded static scene draws at least 90% fewer idle frames', continuous.frames > 10 && idle.frames <= continuous.frames * .1);
  const moving = await sample(true, true);
  check('Camera movement continues to redraw in explicit mode', moving.frames > 10);
  await pause(1500);
  // Presentation-only fake material tests the existing animation redraw gate.
  // It is never added to the scene, creates no geometry, and computes no coverage.
  await evaluate(`(()=>{const resources=window.__mapGraphicsResources;if(!resources||resources.length)throw Error('Expected empty live graphics resource list');window.__mapFakeAnimation={primitive:{show:true,isDestroyed:()=>false},material:{isDestroyed:()=>false,uniforms:{u_scanLineCount:1,u_scanLineSpeed:1}}};resources.push(window.__mapFakeAnimation);return true})()`);
  const animated = await sample(true);
  check('Active time-based graphics keep the render loop awake', animated.frames > 10);
  await evaluate(`(()=>{window.__mapFakeAnimation.primitive.show=false;return true})()`); await pause(150);
  const hiddenAnimation = await sample(true);
  check('Hidden animated graphics do not keep drawing', hiddenAnimation.frames <= 2);
  await evaluate(`(()=>{window.__mapGraphicsResources.pop();return true})()`);
  const staticChange = await evaluate(`(async()=>{const v=window.__mapViewer;let frames=0;const remove=v.scene.postRender.addEventListener(()=>frames++);const before=window.__mapStore.getState().showLabelsLayer;window.__mapStore.setState({showLabelsLayer:!before});await new Promise(r=>setTimeout(r,300));remove();window.__mapStore.setState({showLabelsLayer:before});return frames})()`);
  check('React scene update explicitly redraws after becoming idle', staticChange > 0);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('map.png', folder), Buffer.from(screenshot.data, 'base64'));
  const result = { checks, configuration, continuous, idle, moving, animated, hiddenAnimation, staticChange,
    note: 'Paired Chrome headless, same loaded offline map; idle frame counts are not interactive FPS. No desktop GPU certification.' };
  await writeFile(new URL('render.json', folder), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await send('Page.close', {}, 5000).catch(() => {}); socket.close(); }
