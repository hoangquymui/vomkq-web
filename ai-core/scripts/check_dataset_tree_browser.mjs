// Isolated Vite + browser fixture. Never reads/writes the user's runtime DB.
import { createServer } from "vite";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeOnly = process.argv.includes("--knowledge-only");
const output = await mkdtemp(join(tmpdir(), "vector-dataset-test-images-"));
const server = await createServer({ configFile:false, root, logLevel:"error", cacheDir:join(output,"vite-cache"), server:{ host:"127.0.0.1", port:0, strictPort:false, watch:{ignored:["**/runtime/**","**/deliverables/**","**/backend/.venv*/**","**/src-tauri/target/**"]} }, optimizeDeps:{ entries:["scripts/check_dataset_tree_browser.html","scripts/check_knowledge_content_browser.html","scripts/check_runtime.html"] } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "vector-dataset-test-profile-"));
const browser = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const processHandle = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `${url}/scripts/${knowledgeOnly ? "check_knowledge_content_browser" : "check_dataset_tree_browser"}.html`], { stdio:"ignore", windowsHide:true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) { let last; const until=Date.now()+30000; for (let i=0;i<120 && Date.now()<until;i++) { try { return await fn(); } catch(e) { last=e; await delay(100); } } throw last; }
let socket;
try {
  const port = await retry(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]);
  const page = await retry(async () => { const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p=pages.find((p) => p.type === "page"); if (!p) throw new Error("No test page"); return p; });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, {once:true}); socket.addEventListener("error", reject, {once:true}); });
  let id=0; const pending=new Map(), runtimeErrors=[];
  socket.addEventListener("message", (e) => { const m=JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") runtimeErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); const p=pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); });
  const command = (method, params={}) => new Promise((resolve, reject) => { const n=++id; const timer=setTimeout(() => { pending.delete(n); reject(new Error(`Timeout ${method}`)); }, 45000); pending.set(n,{resolve,reject,timer}); socket.send(JSON.stringify({id:n,method,params})); });
  const evaluate = async (expression) => { const r=await command("Runtime.evaluate", {expression, awaitPromise:true, returnByValue:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width:1260, height:860, deviceScaleFactor:1, mobile:false });
  if (!knowledgeOnly) {
  await retry(async () => { if (!await evaluate("window.datasetReady === true")) throw new Error(`Fixture not ready${runtimeErrors.length ? `: ${runtimeErrors.at(-1)}` : ""}`); });
  const checks = await evaluate("window.datasetTest.run()");
  checks.push(...await evaluate("window.datasetTest.convenience()"));
  // Native mouse events, not synthetic change events, exercise the drag path.
  const point = async (selector) => evaluate(`(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); const n=document.querySelector(${JSON.stringify(selector)}); n.scrollIntoView({block:'center',inline:'center'}); await new Promise(requestAnimationFrame); const r=n.getBoundingClientRect(); const x=r.x+r.width/2, y=r.y+r.height/2; if (!n.contains(document.elementFromPoint(x,y))) throw new Error('Pointer target is covered: ' + ${JSON.stringify(selector)}); return {x,y}; })()`);
  await evaluate(`document.querySelector('[data-fullscreen]').click(); true`); await delay(100);
  const expandedShot = await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const expandedPath = join(output,"diagram-only-fullscreen.png"); await writeFile(expandedPath,Buffer.from(expandedShot.data,"base64"));
  const contextPoint = await point('[data-local-node="root"]');
  await command("Input.dispatchMouseEvent", {type:"mousePressed", ...contextPoint, button:"right", buttons:2, clickCount:1});
  await command("Input.dispatchMouseEvent", {type:"mouseReleased", ...contextPoint, button:"right", buttons:0, clickCount:1});
  await delay(50);
  if (!await evaluate(`!!document.querySelector('[role="menu"] [data-context-action="document-trash"]')`)) throw new Error("Native right click did not open document menu");
  const contextShot = await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const contextPath = join(output,"fullscreen-context-menu.png"); await writeFile(contextPath,Buffer.from(contextShot.data,"base64"));
  for (let count=0; count<2; count++) {
    await command("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await command("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  }
  await evaluate(`Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => true)`);
  checks.push("Native right click opens the document menu in fullscreen; Escape dismisses menu then fullscreen");
  const a = await point('[data-drag="source"]');
  await command("Input.dispatchMouseEvent", { type:"mousePressed", ...a, button:"left", buttons:1, clickCount:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:a.x-20, y:a.y+10, button:"left", buttons:1 });
  const b = await point('[data-local-node="note"]');
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", ...b, button:"left", buttons:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseReleased", ...b, button:"left", buttons:0, clickCount:1 });
  await delay(50); checks.push(await evaluate("window.datasetTest.finishDrag()"));
  await evaluate("window.datasetTest.prepareCatalogDrag()"); await delay(50);
  const documentHandle = await point('[data-drag-document="0"]');
  await command("Input.dispatchMouseEvent", { type:"mousePressed", ...documentHandle, button:"left", buttons:1, clickCount:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:documentHandle.x-20, y:documentHandle.y+10, button:"left", buttons:1 });
  const folderTarget = await point('[data-catalog-folder]');
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", ...folderTarget, button:"left", buttons:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseReleased", ...folderTarget, button:"left", buttons:0, clickCount:1 });
  await delay(50); checks.push(await evaluate("window.datasetTest.finishCatalogDrag()"));
  const folderShot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const folderPath=join(output,"knowledge-folder-drag.png"); await writeFile(folderPath,Buffer.from(folderShot.data,"base64"));
  await evaluate("window.datasetTest.reset()");
  await evaluate(`document.querySelector('[data-select="section"]').click(); document.querySelector('[data-select="section"]').scrollIntoView({block:'center',inline:'center'}); true`);
  const shots=[folderPath, expandedPath, contextPath];
  for (const [width,height] of [[1260,860],[860,620]]) {
    await command("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false}); await delay(100);
    const metrics=await evaluate(`(() => { const view=document.querySelector('[data-viewport]').getBoundingClientRect(), inspector=document.querySelector('[data-inspector]').getBoundingClientRect(); return {width:view.width,height:view.height,inspectorWidth:inspector.width,overflow:document.documentElement.scrollWidth > innerWidth}; })()`);
    if(metrics.height<150 || metrics.width<170 || metrics.overflow) throw new Error(`Bad layout at ${width}: ${JSON.stringify(metrics)}`);
    const shot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
    const path=join(output, `dataset-${width}x${height}.png`); await writeFile(path,Buffer.from(shot.data,"base64")); shots.push(path);
  }
  await command("Emulation.setDeviceMetricsOverride", {width:1260,height:860,deviceScaleFactor:1,mobile:false});
  await evaluate("window.datasetTest.overview()");
  await delay(100);
  const overviewShot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const overviewPath=join(output,"knowledge-root.png"); await writeFile(overviewPath,Buffer.from(overviewShot.data,"base64")); shots.push(overviewPath);
  console.log(JSON.stringify({checks,screenshots:shots},null,2));
  // Existing UI regression suite also runs through Vite so CSS imports resolve.
  await command("Page.navigate", {url:`${url}/scripts/check_runtime.html`});
  await retry(async () => { const title=await evaluate("document.title"); if(!/^(PASS|FAIL) —/.test(title)) throw new Error("Waiting for existing regressions"); });
  const regression=await evaluate(`({title:document.title,status:document.querySelector('#status').textContent,failures:[...document.querySelectorAll('#results li')].map(e=>e.textContent).filter(t=>t.startsWith('FAIL'))})`);
  console.log(JSON.stringify(regression,null,2));
  if(regression.failures.length) throw new Error("Existing browser regressions failed");
  }
  await command("Page.navigate", {url:`${url}/scripts/check_knowledge_content_browser.html`});
  await retry(async () => { if (!await evaluate("window.knowledgeReady === true")) throw new Error("Knowledge editor fixture not ready"); });
  console.log(JSON.stringify({knowledgeChecks:await evaluate("window.knowledgeTest.run()")},null,2));
  await evaluate("window.knowledgeTest.prepareNativeMultiline()");
  await command("Input.dispatchKeyEvent", {type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r"});
  await command("Input.dispatchKeyEvent", {type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
  await command("Input.insertText", {text:"10w/57kt"});
  console.log(await evaluate("window.knowledgeTest.finishNativeMultiline()"));
  const multilineShot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const multilinePath=join(output,"knowledge-multiline-fraction.png"); await writeFile(multilinePath,Buffer.from(multilineShot.data,"base64")); console.log(multilinePath);
  for (const [width,height] of [[1260,860],[620,720]]) {
    await command("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
    await evaluate("window.knowledgeTest.show()"); await evaluate("document.fonts.ready.then(() => true)");
    const metrics = await evaluate(`(() => { const dialog=document.querySelector('dialog'), r=dialog.getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom,overflow:dialog.scrollWidth>dialog.clientWidth+2}; })()`);
    if (metrics.left<0 || metrics.right>width || metrics.bottom>height || metrics.overflow) throw new Error(`Knowledge layout broken: ${JSON.stringify(metrics)}`);
    const shot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
    const path=join(output,`knowledge-${width}x${height}.png`); await writeFile(path,Buffer.from(shot.data,"base64")); console.log(path);
  }
  await command("Emulation.setDeviceMetricsOverride", {width:1260,height:860,deviceScaleFactor:1,mobile:false});
  await evaluate("window.knowledgeTest.edit()");
  const editorShot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const editorPath=join(output,"knowledge-edit.png"); await writeFile(editorPath,Buffer.from(editorShot.data,"base64")); console.log(editorPath);
  await evaluate(`document.querySelector('[data-symbols]').click(); true`); await delay(50);
  const symbolsShot=await command("Page.captureScreenshot", {format:"png",captureBeyondViewport:false});
  const symbolsPath=join(output,"knowledge-symbol-library.png"); await writeFile(symbolsPath,Buffer.from(symbolsShot.data,"base64")); console.log(symbolsPath);
} finally {
  socket?.close();
  if (processHandle.exitCode == null) spawnSync("taskkill", ["/PID",String(processHandle.pid),"/T","/F"], {windowsHide:true,stdio:"ignore"});
  await server.close();
  // Only this freshly allocated test profile is disposable; keep screenshots.
  const expectedParent=resolve(tmpdir());
  if(dirname(resolve(profile))===expectedParent && profile.includes("vector-dataset-test-profile-")) await retry(() => rm(profile,{recursive:true,force:true})).catch(() => {});
}
