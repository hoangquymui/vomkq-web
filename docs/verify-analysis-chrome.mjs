/** Chrome CDP smoke/performance check. Start isolated Chrome with debugging port 9339.
 * node docs/verify-analysis-chrome.mjs [--ai] [--documents]
 * Unified GIS AI navigation; internal offline AOI/source regression stays available through APIs.
 * --ai also runs an installed local model. No placement analysis is invoked.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../logs/analysis-verification/', import.meta.url);
await mkdir(root, { recursive: true });
const target = await fetch('http://127.0.0.1:9339/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map(), exceptions = [];
socket.onclose = () => {
  for (const { reject, timeout } of pending.values()) { clearTimeout(timeout); reject(new Error('CDP target closed')); }
  pending.clear();
};
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timeout } = pending.get(message.id); pending.delete(message.id); clearTimeout(timeout);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
};
function send(method, params = {}, timeoutMs = 180000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, timeout = 180000) {
  const result = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true }, timeout);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const checks = [];
function check(name, condition) { assert(condition, name); checks.push(name); console.log(`PASS ${name}`); }
async function waitFor(expression, message) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('vompk.analysis.v2.enabled','false'); window.__analysisLongTasks=[]; new PerformanceObserver(list=>window.__analysisLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});` });
  await send('Page.navigate', { url: 'http://127.0.0.1:3000' });
  await waitFor(`document.body?.innerText.includes('GIS AI')`, 'GIS AI button did not mount');
  check('App mounts with one unified GIS AI button', await evaluate(`[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='GIS AI').length===1`));
  await evaluate(`(async()=>{const code=await fetch('/src/components/ui/TopBar.tsx').then(r=>r.text()); const url=code.match(/from\\s+["']([^"']*useAnalysisStore[^"']*)["']/)[1];window.__analysisStoreModule=await import(url);return url})()`);
  await evaluate(`(async()=>{const code=await fetch('/src/components/ui/AiPlacementAdvisorPanel.tsx').then(r=>r.text());const url=code.match(/from\\s+["']([^"']*useTacticalStore[^"']*)["']/)[1];window.__tacticalStore=(await import(url)).useTacticalStore;return url})()`);
  check('Feature initially disabled', await evaluate(`!window.__analysisStoreModule.useAnalysisStore.getState().enabled`));
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='GIS AI').click()`);
  await waitFor(`document.body.innerText.includes('GIS AI · local')`, 'GIS AI panel did not open');
  check('First opt-in click opens unified panel', await evaluate(`document.querySelector('aside[aria-label="Trợ lý GIS có nguồn"] h2')?.textContent==='GIS AI · local'`));
  check('Only the three requested tabs remain', await evaluate(`(()=>{const nav=document.querySelector('nav[aria-label="Các phần phân tích"]');const labels=[...nav.querySelectorAll('button')].map(b=>b.textContent.trim());return JSON.stringify(labels)===JSON.stringify(['AI phân tích','Chat','Tài liệu'])&&!['Vùng & số đo','Dữ liệu','Báo cáo'].some(label=>labels.includes(label));})()`));
  check('Legacy analysis is embedded without separate toolbar button or floating aside', await evaluate(`(()=>{const panel=document.querySelector('aside[aria-label="Trợ lý GIS có nguồn"]');return panel.innerText.includes('Lớp đối tượng trên bản đồ')&&panel.innerText.includes('Khí tài cần đặt')&&![...document.querySelectorAll('button')].some(b=>!panel.contains(b)&&b.textContent.trim().toLocaleLowerCase('vi')==='ai phân tích')&&![...document.querySelectorAll('aside')].some(a=>a.className.includes('left-[336px]'));})()`));
  await waitFor(`window.__tacticalStore.getState().aiAdvisorPanelOpen&&!window.__tacticalStore.getState().showMapOverlays`, 'Embedded analysis visibility lifecycle did not open');
  // A presentation-only summary sentinel verifies that navigation keeps legacy content.
  // No inference, candidate generation or placement operation runs here.
  await evaluate(`(()=>{const s=window.__tacticalStore.getState();window.__legacySmokeContent={summary:s.aiAdvisorSummary,suggestions:s.aiAdvisorSuggestions,route:s.aiAdvisorRoute,profile:s.siteProfile};window.__tacticalStore.setState({aiAdvisorSummary:'Nội dung phân tích giữ nguyên khi chuyển tab'});return true})()`);
  for (const label of ['Chat', 'Tài liệu', 'AI phân tích']) {
    await evaluate(`[...document.querySelectorAll('nav[aria-label="Các phần phân tích"] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    await waitFor(`window.__analysisStoreModule.useAnalysisStore.getState().tab===${JSON.stringify({ Chat: 'chat', 'Tài liệu': 'documents', 'AI phân tích': 'analysis' }[label])}`, `Tab ${label} did not activate`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check('Chat and document navigation preserve existing analysis content', await evaluate(`(()=>{const s=window.__tacticalStore.getState(),old=window.__legacySmokeContent;return s.aiAdvisorSummary==='Nội dung phân tích giữ nguyên khi chuyển tab'&&s.aiAdvisorSuggestions===old.suggestions&&s.aiAdvisorRoute===old.route&&s.siteProfile===old.profile&&document.querySelector('aside[aria-label="Trợ lý GIS có nguồn"]').innerText.includes(s.aiAdvisorSummary);})()`));
  await evaluate(`(()=>{window.__tacticalStore.setState({aiAdvisorSummary:window.__legacySmokeContent.summary});document.querySelector('button[aria-label="Đóng trợ lý GIS"]').click();return true})()`);
  await waitFor(`!window.__analysisStoreModule.useAnalysisStore.getState().panelOpen&&!window.__tacticalStore.getState().aiAdvisorPanelOpen&&window.__tacticalStore.getState().showMapOverlays`, 'Closing GIS AI did not restore the legacy overlay lifecycle');
  check('Closing unified panel restores legacy panel and map overlay state', await evaluate(`!document.querySelector('aside[aria-label="Trợ lý GIS có nguồn"]')&&!window.__tacticalStore.getState().aiAdvisorPanelOpen&&window.__tacticalStore.getState().showMapOverlays`));
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='GIS AI').click();window.__tacticalStore.getState().setBasemap('offline');return true})()`);
  await waitFor(`!!document.querySelector('aside[aria-label="Trợ lý GIS có nguồn"]')`, 'GIS AI panel did not reopen');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const measured = await evaluate(`(async()=>{
    const {useAnalysisStore}=window.__analysisStoreModule;
    const {createCircleAoi}=await import('/src/services/analysisGeometry.ts');
    const store=useAnalysisStore.getState(); store.setAoi(createCircleAoi(108.2,16.05,0.5));
    const started=performance.now(); await store.measure(); const next=useAnalysisStore.getState();
    if(next.error)throw Error(next.error); if(!next.snapshot)throw Error('No snapshot');
    window.__analysisSmokeSnapshot=next.snapshot;
    return {seconds:(performance.now()-started)/1000,measurements:next.snapshot.measurements.length,features:next.snapshot.features.length,findings:next.snapshot.findings.map(f=>f.code),datasets:next.snapshot.datasets.length,longTasks:window.__analysisLongTasks.filter(t=>t.start>=started)};
  })()`);
  check('Real AOI measured in worker with explicit limitations', measured.measurements > 10 && measured.findings.includes('coverage-unverified'));
  console.log(JSON.stringify(measured));
  const persisted = await evaluate(`(async()=>{ const snapshot=window.__analysisSmokeSnapshot; const response=await fetch('/vector-ai/api/v1/analysis/snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot})}); const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));const read=await fetch('/vector-ai/api/v1/analysis/snapshots/'+snapshot.id).then(r=>r.json());return {hash:data.snapshot.contentHash,readHash:read.snapshot.contentHash};})()`);
  check('Production worker snapshot accepted and durable hash preserved', persisted.hash === persisted.readHash && persisted.hash.length === 64);
  await new Promise(resolve=>setTimeout(resolve,100));
  await evaluate(`window.__analysisStoreModule.useAnalysisStore.getState().openSource(window.__analysisSmokeSnapshot.evidence[0])`);
  check('Legacy analysis does not expose the removed GIS measurement source card', await evaluate(`!document.body.innerText.includes('Nguồn: Diện tích vùng đã chọn')`));
  await evaluate(`[...document.querySelectorAll('nav[aria-label="Các phần phân tích"] button')].find(b=>b.textContent.trim()==='Chat').click()`);
  await waitFor(`document.body.innerText.includes('Nguồn: Diện tích vùng đã chọn')`, 'Source card did not open in Chat');
  check('Internal measurement evidence can be inspected in Chat', await evaluate(`document.body.innerText.includes('Nguồn: Diện tích vùng đã chọn')`));
  const cancelled = await evaluate(`(async()=>{const {useAnalysisStore}=window.__analysisStoreModule;const s=useAnalysisStore.getState();const old=s.snapshot.id;const operation=s.measure();s.cancel();await operation;const now=useAnalysisStore.getState();return now.busy==='idle'&&now.snapshot.id===old})()`);
  check('Cancelled measurement cannot replace completed snapshot', cancelled);
  const snapshot = await evaluate(`window.__analysisSmokeSnapshot`);
  await writeFile(new URL('real-snapshot.json', root), JSON.stringify(snapshot));
  if (process.argv.includes('--ai')) {
    const result = await evaluate(`(async()=>{const {useAnalysisStore}=window.__analysisStoreModule; const s=useAnalysisStore.getState();s.setTab('chat'); await s.run('gis-analysis-v1','Chỉ nêu diện tích vùng đã chọn từ phép đo, kèm nguồn.');const next=useAnalysisStore.getState();if(next.error)throw Error(next.error);return next.result})()`, 240000);
    check('Direct metric lookup completes with evidence without inference', result.validation.valid && result.citations.length > 0 && result.usage.modelInvoked === false);
    await writeFile(new URL('real-result.json', root), JSON.stringify(result));
    const shared = await evaluate(`(async()=>{const {useAnalysisStore}=window.__analysisStoreModule;const {importAnalysisPackage}=await import('/src/services/analysisPackage.ts');const s=useAnalysisStore.getState();s.setNotes('Ghi chú kiểm tra ZIP trên Chrome');const bytes=await s.exportPackage();if(!bytes)throw Error(useAnalysisStore.getState().error);const imported=await importAnalysisPackage(bytes);return {size:bytes.length,notes:imported.notes,answer:imported.result.answer,expected:s.result.answer,originalId:s.activeReportId,newId:imported.id}})()`);
    check('ZIP round-trip preserves answer and user note', shared.answer === shared.expected && shared.notes === 'Ghi chú kiểm tra ZIP trên Chrome' && shared.size > 0);
    const interpreted = await evaluate(`(async()=>{const {useAnalysisStore}=window.__analysisStoreModule; const s=useAnalysisStore.getState(); await s.run('gis-analysis-v1','Nêu diện tích đa giác AOI bằng số liệu nguồn, kèm trích dẫn.');const next=useAnalysisStore.getState();if(next.error)throw Error(next.error);return next.result})()`, 240000);
    check('Broad question invokes installed local model and validates result', interpreted.validation.valid && interpreted.citations.length > 0 && interpreted.usage.completion_tokens > 0);
    await writeFile(new URL('real-model-result.json', root), JSON.stringify(interpreted));
    if (process.argv.includes('--documents')) {
      const documentText = await readFile(new URL('analysis-document-fixture.md', import.meta.url), 'utf8');
      const qa = await evaluate(`(async()=>{
        const text=${JSON.stringify(documentText)}, form=new FormData();form.append('file',new File([text],'kiem-thu-gis-v2.md',{type:'text/markdown'}));form.append('scope',JSON.stringify({builtin:true}));
        const response=await fetch('/vector-ai/api/v1/documents',{method:'POST',body:form}); const uploaded=await response.json(); let id=uploaded.id;
        if(response.status===409){id=uploaded.detail?.document?.id;const revive=await fetch('/vector-ai/api/v1/documents/'+id+'/lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,state:'active'})});if(!revive.ok)throw Error('Cannot restore test fixture');}
        else {if(!response.ok)throw Error(JSON.stringify(uploaded)); const stream=await fetch('/vector-ai/api/v1/ingestion-runs/'+uploaded.run_id+'/events',{signal:AbortSignal.timeout(120000)});const events=await stream.text();if(!events.includes('event: completed'))throw Error('Fixture ingestion did not complete: '+events.slice(-500));}
        const {useAnalysisStore}=window.__analysisStoreModule; const s=useAnalysisStore.getState();await s.refreshDocuments();for(const selected of useAnalysisStore.getState().selectedDocumentIds)s.selectDocument(selected,false);s.selectDocument(id,true);
        try {await s.run('document-qa-v1','Trích nguyên văn câu trong tài liệu nói về gói vector cũ và độ đầy đủ.'); const state=useAnalysisStore.getState();if(state.error)throw Error(state.error); const result=state.result;if(result.citations[0])await state.openSource(result.citations[0]); return {result,documentId:id,source:useAnalysisStore.getState().sourceExcerpt,text};}
        finally {await fetch('/vector-ai/api/v1/documents/'+id+'/lifecycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,state:'archived'})});s.selectDocument(id,false);}
      })()`, 240000);
      check('TXT/Markdown ingestion and selected-document QA use local excerpts', qa.result.validation.valid && qa.result.citations.length > 0 && qa.result.citations.every(ref => ref.documentId === qa.documentId && qa.text.includes(ref.excerpt)) && qa.source && qa.result.answer.includes('Các gói vector cũ chưa có nhật ký truy vấn nên độ đầy đủ chưa được xác minh.'));
      await writeFile(new URL('real-document-result.json', root), JSON.stringify(qa.result));
    }
  }
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('chrome.png', root), Buffer.from(screenshot.data, 'base64'));
  check('No uncaught JavaScript exceptions', exceptions.length === 0);
  await writeFile(new URL('summary.json', root), JSON.stringify({ checks, measured, persisted, exceptions, browser: await fetch('http://127.0.0.1:9339/json/version').then(r=>r.json()).then(v=>v.Browser), performanceNote:'Headless Chrome smoke measurement, not a desktop GPU FPS certification.' }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, measured, persisted }));
} finally { await send('Page.close', {}, 5000).catch(()=>{}); socket.close(); }

