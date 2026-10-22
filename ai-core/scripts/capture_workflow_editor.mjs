import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const browser = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDirectory = resolve(process.argv[3] || join(tmpdir(), "vector-ai-workflow-visual"));
const profile = await mkdtemp(join(tmpdir(), "vector-ai-workflow-chrome-"));
const child = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "http://127.0.0.1:3000/",
], { stdio: "ignore", windowsHide: true });

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function retry(task, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await task(); }
    catch (error) { lastError = error; await delay(100); }
  }
  throw lastError;
}

let socket;
try {
  const activePort = await retry(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/)[0]);
  const pages = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${activePort}/json/list`);
    if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
    return response.json();
  });
  const page = pages.find((candidate) => candidate.type === "page" && candidate.url.startsWith("http://127.0.0.1:3000"));
  if (!page) throw new Error("Không tìm thấy tab VECTOR AI trong Chrome headless.");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (!payload.id || !pending.has(payload.id)) return;
    const { resolve: resolveCall, reject: rejectCall } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) rejectCall(new Error(payload.error.message));
    else resolveCall(payload.result);
  });
  const command = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "JavaScript evaluation failed");
    return response.result.value;
  };
  const waitFor = (expression) => evaluate(`new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      try { if (${expression}) return resolve(true); }
      catch (error) { return reject(error); }
      if (performance.now() - started > 12000) return reject(new Error("Timeout: ${expression.replaceAll('"', '\\"')}"));
      setTimeout(poll, 50);
    };
    poll();
  })`);
  const screenshot = async (name) => {
    const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const path = join(outputDirectory, name);
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.navigate", { url: "http://127.0.0.1:3000/" });
  await delay(500);
  await retry(() => evaluate("document.readyState"), 50);
  try {
    await waitFor(`document.querySelector(".workflow-open")`);
  } catch (error) {
    const diagnostic = await evaluate(`({
      title: document.title,
      readyState: document.readyState,
      body: document.body?.innerText?.slice(0, 1000),
      scripts: [...document.scripts].map((item) => item.src || item.type),
    })`);
    throw new Error(`${error.message}\n${JSON.stringify(diagnostic, null, 2)}`);
  }
  await waitFor(`!document.querySelector("#appIntro") && !document.querySelector("#app")?.inert`);
  await evaluate(`document.querySelector(".workflow-open").click(); true`);
  await waitFor(`document.querySelectorAll(".workflow-node").length >= 9`);
  await mkdir(outputDirectory, { recursive: true });

  await command("Emulation.setDeviceMetricsOverride", { width: 1180, height: 700, deviceScaleFactor: 1, mobile: false });
  await delay(150);
  const firstNode = await evaluate(`(() => { const r=document.querySelector(".workflow-node").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: firstNode.x, y: firstNode.y, button: "left", buttons: 1, clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: firstNode.x + 42, y: firstNode.y + 28, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: firstNode.x + 42, y: firstNode.y + 28, button: "left", buttons: 0, clickCount: 1 });
  await delay(120);
  const desktopPath = await screenshot("workflow-editor-1180x700.png");

  await command("Emulation.setDeviceMetricsOverride", { width: 860, height: 560, deviceScaleFactor: 1, mobile: false });
  await delay(180);
  const compactPath = await screenshot("workflow-editor-860x560.png");
  await evaluate(`document.querySelector("[data-reset]").click(); true`);
  await waitFor(`document.querySelector("#confirmModal")?.classList.contains("open")`);
  const confirmPath = await screenshot("workflow-confirm-860x560.png");
  const report = await evaluate(`(() => {
    const modal=document.querySelector("#workflowModal");
    const confirm=document.querySelector("#confirmModal");
    const canvas=document.querySelector(".workflow-graph-canvas");
    const inspector=document.querySelector(".workflow-node-inspector");
    const dirty=document.querySelector("[data-dirty]");
    return {
      modalOpen: modal?.classList.contains("open"),
      nodes: document.querySelectorAll(".workflow-node").length,
      edges: document.querySelectorAll(".workflow-edge").length,
      dirtyVisible: Boolean(dirty && !dirty.hidden),
      inspectorVisible: Boolean(inspector && !inspector.hidden),
      canvasWidth: Math.round(canvas?.getBoundingClientRect().width || 0),
      bodyOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      workflowLayer: Number.parseInt(getComputedStyle(modal).zIndex, 10) || 0,
      confirmLayer: Number.parseInt(getComputedStyle(confirm).zIndex, 10) || 0,
    };
  })()`);
  await evaluate(`document.querySelector("#confirmCancel").click(); true`);
  console.log(JSON.stringify({ desktopPath, compactPath, confirmPath, ...report }, null, 2));
  if (!report.modalOpen || report.nodes < 9 || report.edges < 9 || !report.dirtyVisible || !report.inspectorVisible || report.bodyOverflowX || report.confirmLayer <= report.workflowLayer) {
    throw new Error(`Visual smoke test failed: ${JSON.stringify(report)}`);
  }
} finally {
  socket?.close();
  if (child.exitCode == null) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
  await retry(() => rm(profile, { recursive: true, force: true }), 30).catch(() => {});
}
