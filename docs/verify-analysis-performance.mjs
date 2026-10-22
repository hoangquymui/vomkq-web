/** Isolated, paired headless Cesium render benchmark (Chrome CDP port 9339).
 * Counts Cesium scene.postRender, never requestAnimationFrame as a FPS proxy.
 * Uses 20 generic GIS markers from a real local snapshot; adds no equipment.
 * node docs/verify-analysis-performance.mjs [--baseline-only]
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = new URL('../logs/analysis-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const baselineOnly = process.argv.includes('--baseline-only');
const version = await fetch('http://127.0.0.1:9339/json/version').then(r => r.json());
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); const call = pending.get(message.id); if (call) { pending.delete(message.id); clearTimeout(call.timer); if (message.error) call.reject(new Error(JSON.stringify(message.error))); else call.resolve(message.result); } };
  return {
    socket,
    send(method, params = {}, timeoutMs = 60_000) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); },
  };
}
const browser = await connect(version.webSocketDebuggerUrl);
const { browserContextId } = await browser.send('Target.createBrowserContext');
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
const target = (await fetch('http://127.0.0.1:9339/json/list').then(r => r.json())).find(t => t.id === targetId);
const page = await connect(target.webSocketDebuggerUrl);
async function evaluate(expression, timeoutMs = 60_000) {
  const result = await page.send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function median(values) { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; }
function framesIn(record, start = record.started, end = record.ended) {
  const frames = record.frames.filter(t => t >= start && t <= end), intervals = frames.slice(1).map((t,i) => t - frames[i]);
  return { seconds: (end-start)/1000, frameCount: frames.length, renderedFps: frames.length/((end-start)/1000), medianFrameMs: median(intervals), p95FrameMs: [...intervals].sort((a,b)=>a-b)[Math.floor(intervals.length*.95)] ?? null };
}
const trials = [], psSamples = [], checks = [];
let gpu, scene, error;
try {
  gpu = await browser.send('SystemInfo.getInfo');
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('vompk.analysis.v2.enabled','false');window.__perfLongTasks=[];new PerformanceObserver(list=>window.__perfLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});` });
  await page.send('Page.navigate', { url: 'http://127.0.0.1:3000' });
  for (let i=0;i<100;i++) { if (await evaluate(`!!document.querySelector('.cesium-widget canvas')&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='GIS AI')`)) break; await pause(100); }
  const found = await evaluate(`(()=>{
    const canvas=document.querySelector('.cesium-widget canvas'); if(!canvas)return {found:false,reason:'No Cesium canvas'};
    const seen=new Set();
    for(let element=canvas;element;element=element.parentElement){
      const key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));let fiber=key?element[key]:null;
      for(;fiber&&!seen.has(fiber);fiber=fiber.return){seen.add(fiber);
        for(const candidate of [fiber,fiber.alternate]){let hook=candidate?.memoizedState;
          for(let i=0;hook&&i<120;i++,hook=hook.next){let value=hook.memoizedState;
            for(const possible of [value?.current,value?.[0]?.current]){try{if(possible?.scene?.canvas===canvas){window.__perfViewer=possible;return {found:true,hooks:i,component:fiber.type?.name||'React component'};}}catch{}}
          }
        }
      }
    } return {found:false,reason:'Viewer ref inaccessible through inspected React hooks'};
  })()`);
  assert(found.found, found.reason); checks.push('Real Cesium Viewer ref verified against scene.canvas');
  await evaluate(`(async()=>{const code=await fetch('/src/components/ui/TopBar.tsx').then(r=>r.text());const url=code.match(/from +['"]([^'"]*useAnalysisStore[^'"]*)['"]/)[1];window.__perfStore=(await import(url)).useAnalysisStore;const tactical=(await import('/src/store/useTacticalStore.ts')).useTacticalStore;tactical.getState().setBasemap('offline');const v=window.__perfViewer,C=v.camera.position.constructor;v.camera.setView({destination:C.fromDegrees(108.2,16.05,9000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});return true})()`);
  for(let i=0;i<60;i++){if(await evaluate(`window.__perfViewer.scene.globe.tilesLoaded`))break;await pause(200);}
  const measured = await evaluate(`(async()=>{const {createCircleAoi}=await import('/src/services/analysisGeometry.ts');const s=window.__perfStore.getState();s.setTab('chat');s.setEnabled(true);s.setAoi(createCircleAoi(108.2,16.05,.5));await s.measure();const next=window.__perfStore.getState();if(next.error||!next.snapshot)throw Error(next.error||'No snapshot');return {id:next.snapshot.id,features:next.snapshot.features.length}})()`);
  assert(measured.features >= 20, 'Need 20 observed generic local features for the controlled scene');
  scene = await evaluate(`(()=>{const v=window.__perfViewer,s=window.__perfStore.getState(),C=v.camera.position.constructor;let added=0;for(const f of s.snapshot.features.slice(0,20)){let p=f.geometry.coordinates;while(Array.isArray(p[0]))p=p[0];v.entities.add({id:'generic-perf-feature-'+added,position:C.fromDegrees(p[0],p[1],30),point:{pixelSize:6}});added++;}v.scene.requestRender();const gl=v.scene.context._gl,extension=gl.getExtension('WEBGL_debug_renderer_info');return {markers:added,entities:v.entities.values.length,primitives:v.scene.primitives.length,tilesLoaded:v.scene.globe.tilesLoaded,webglRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),snapshotId:s.snapshot.id}})()`);
  checks.push('20 real-source generic markers present in the same scene');
  await evaluate(`(()=>{
    window.__perfBegin=()=>{const v=window.__perfViewer,C=v.camera.position.constructor;v.camera.setView({destination:C.fromDegrees(108.2,16.05,9000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});const started=performance.now(),frames=[];const remove=v.scene.postRender.addEventListener(()=>frames.push(performance.now()));let last=started;const timer=setInterval(()=>{const now=performance.now(),dt=Math.min(50,now-last)/16.6667;last=now;v.camera.moveRight(8*Math.cos((now-started)/1000*Math.PI)*dt);v.camera.moveUp(4*Math.sin((now-started)/1000*Math.PI)*dt);v.scene.requestRender();},16);window.__perfRecording={started,frames,timer,remove};};
    window.__perfStop=()=>{const r=window.__perfRecording;r.remove();clearInterval(r.timer);return {started:r.started,ended:performance.now(),frames:r.frames,longTasks:window.__perfLongTasks.filter(t=>t.start>=r.started)};};
    window.__perfTab=async(label,needle)=>{const started=performance.now(),button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(!button)throw Error('Missing tab '+label);button.click();while(!document.body.innerText.includes(needle)){if(performance.now()-started>2000)throw Error('Tab did not settle '+label);await new Promise(resolve=>setTimeout(resolve,1));}await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-started;};return true;
  })()`);
  for (let trial=0; trial<3; trial++) {
    await evaluate(`(()=>{window.__perfStore.getState().setEnabled(false);window.__perfBegin();return true})()`);
    await pause(3000); const baseline = await evaluate(`window.__perfStop()`);
    const item = { trial, baseline: framesIn(baseline), baselineLongTasks: baseline.longTasks, baselineRaw: baseline };
    assert(item.baseline.frameCount > 5, 'No usable Cesium scene.postRender frame sample');
    if (!baselineOnly) {
      await evaluate(`(async()=>{const s=window.__perfStore.getState();s.setTab('chat');s.setEnabled(true);await s.refreshServices(true);if(!window.__perfStore.getState().selectedModel)throw Error('No installed local model');window.__perfBegin();window.__perfAiStarted=performance.now();window.__perfAiEnded=null;window.__perfGenerationStarted=null;const unsubscribe=window.__perfStore.subscribe(state=>{if(state.stage.includes('suy luận')&&!window.__perfGenerationStarted)window.__perfGenerationStarted=performance.now();});window.__perfRun=s.run('gis-analysis-v1','Nêu diện tích đa giác AOI bằng số liệu nguồn, kèm trích dẫn.').then(()=>{window.__perfAiEnded=performance.now();unsubscribe();});return true})()`);
      item.interactions = [];
      for (let i=0; i<6; i++) {
        await pause(150);
        item.interactions.push(await evaluate(`window.__perfTab(${JSON.stringify(i%2?'Chat':'Tài liệu')},${JSON.stringify(i%2?'Hỏi các tài liệu đã chọn.':'Nhập TXT/Markdown local')})`));
      }
      for(let i=0;i<120;i++){
        const active=await evaluate(`!window.__perfAiEnded`);
        if(!active)break;
        const ps=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).catch(e=>({error:String(e)}));
        psSamples.push({trial,at:new Date().toISOString(),...ps});await pause(150);
      }
      await evaluate(`(async()=>{await window.__perfRun;return true})()`,120000);
      const active = await evaluate(`(()=>{const r=window.__perfStop(),s=window.__perfStore.getState();return {record:r,started:window.__perfGenerationStarted||window.__perfAiStarted,ended:window.__perfAiEnded,result:s.result,error:s.error,model:s.selectedModel}})()`);
      assert(!active.error, active.error); assert(active.result?.usage.completion_tokens > 0, 'The broad question must actually invoke the model');
      item.active = framesIn(active.record, active.started, active.ended); item.activeLongTasks=active.record.longTasks;
      item.usage=active.result.usage; item.model=active.model; item.activeRaw=active.record; item.runId=active.result.runId;
      item.ratio=item.active.renderedFps/item.baseline.renderedFps;
    }
    trials.push(item);console.log(JSON.stringify({trial,baseline:item.baseline,active:item.active,ratio:item.ratio,interactions:item.interactions,completionTokens:item.usage?.completion_tokens}));
  }
  checks.push('Actual Cesium postRender samples recorded during deterministic camera motion');
  if (!baselineOnly) checks.push('Installed local model inference confirmed by durable completion_tokens');
} catch (caught) { error=String(caught.stack ?? caught); console.error(error); process.exitCode=1; }
finally {
  const summary={schemaVersion:1,browser:version.Browser,gpu,scene,trials,psSamples,checks,error:error??null,
    aggregate:{baselineMedianFps:median(trials.map(t=>t.baseline.renderedFps)),activeMedianFps:median(trials.filter(t=>t.active).map(t=>t.active.renderedFps)),medianRatio:median(trials.filter(t=>t.ratio).map(t=>t.ratio)),interactionMedianMs:median(trials.flatMap(t=>t.interactions??[])),interactionMaxMs:Math.max(0,...trials.flatMap(t=>t.interactions??[]))},
    note:'Isolated headless Chrome on this execution machine, with concurrent root CPU checks. postRender measures Cesium render completion, not display scanout or a certification of the user desktop. Ollama size_vram records GPU-resident allocation, not kernel-level GPU utilization.'};
  await writeFile(new URL(baselineOnly?'performance-baseline.json':'performance.json',output),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary.aggregate));
  await page.send('Page.close').catch(()=>{});page.socket.close();
  await browser.send('Target.disposeBrowserContext',{browserContextId}).catch(()=>{});browser.socket.close();
}
