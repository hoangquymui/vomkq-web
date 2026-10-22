/**
 * Runs the actual transpiled loader with fixture HTTP responses and a controlled
 * clock. Tests scheduling, all-data semantics and request reuse, not browser FPS.
 * Run: node docs/verify-vector-store-loading.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Use the project's existing compiler; no runtime/package downloads for tests.
function sourceModule(file, context, modules = new Map()) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"').replaceAll('import.meta.url', '"file:///fixture/"'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { ...context, module, exports: module.exports,
    require(name) {
      assert.ok(name.startsWith('.'), `unexpected dependency ${name}`);
      return sourceModule(path.resolve(path.dirname(file), `${name}.ts`), context, modules);
    },
  }, { filename: file });
  return module.exports;
}

function point(id, index, kind = 'place') {
  return { type: 'Feature', id, properties: { kind, name: id },
    geometry: { type: 'Point', coordinates: [105.5 + (index % 4) * 0.02, 21.5 + (index % 3) * 0.02] } };
}
const collection = (features, metadata = {}) => ({ type: 'FeatureCollection', features, metadata });
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture({ scheduler = true, allFail = false, worker = false, startupError = false, postError = false } = {}) {
  const entries = new Map();
  const expected = [];
  // Input order differs from completion order, and features exceed any display
  // cap. No rendering reduction may leak into the full analysis store.
  const cells = ['210_1050', '210_1051', '209_1050'];
  for (let cell = 0; cell < cells.length; cell++) {
    const features = Array.from({ length: 8192 }, (_, index) => point(`a:${cell}:${index}`, index));
    entries.set(`/offline-vector/a/${cells[cell]}.geojson`, collection(features));
    expected.push(...features);
  }
  entries.set('/offline-vector/a.geojson', { type: 'vector-tile-index', name: 'A', cells,
    center: { lat: 21.5, lon: 105.5 }, featureCount: expected.length });

  const linesAndPolygon = [
    { type: 'Feature', id: 'river', properties: { kind: 'water_river', name: 'River' },
      geometry: { type: 'LineString', coordinates: [['105.5', '21.5'], ['bad', 21.5], [105.6, 21.6]] } },
    { type: 'Feature', id: 'polygon', properties: { kind: 'forest' }, geometry: { type: 'Polygon', coordinates: [
      [[105.5, 21.5], [105.6, 21.5], [105.6, 21.6], [105.5, 21.5]],
      [[105.52, 21.52], [105.54, 21.52], [105.54, 21.54], [105.52, 21.52]],
    ] } },
    point('duplicate', 2), point('duplicate', 3),
  ];
  const invalid = [point('wrong-kind', 0, 'unsupported'),
    { ...point('bad-coordinate', 0), geometry: { type: 'Point', coordinates: ['bad', 21] } },
    { ...point('unsupported-multi', 0), geometry: { type: 'MultiPoint', coordinates: [[105, 21]] } },
  ];
  const mono = [...Array.from({ length: 4096 }, (_, index) => point(`mono:${index}`, index, 'peak')), ...linesAndPolygon];
  entries.set('/offline-vector/mono.geojson', collection([...mono, ...invalid], { region: 'mono', featureCount: mono.length }));
  expected.push(...mono);

  // Old index with no explicit cells must retain bbox fallback behavior.
  entries.set('/offline-vector/legacy.geojson', { type: 'vector-tile-index',
    bbox: [10.01, 10.01, 10.02, 10.02], cellDeg: 0.1, name: 'Legacy' });
  const legacy = [point('legacy:0', 0)];
  entries.set('/offline-vector/legacy/100_100.geojson', collection(legacy));
  expected.push(...legacy);
  // Failed cell, successful empty cell and failed pack remain isolated.
  entries.set('/offline-vector/partial.geojson', { type: 'vector-tile-index', cells: ['failed', 'empty', 'good'] });
  entries.set('/offline-vector/partial/empty.geojson', collection([]));
  entries.set('/offline-vector/partial/good.geojson', collection([point('partial:good', 0)]));
  expected.push(point('partial:good', 0));

  const calls = new Map();
  let clock = 0, yields = 0, timers = 0, beats = 0, inFlight = 0, peakInFlight = 0;
  const modules = new Map();
  const workerStats = { created: 0, terminated: 0, live: 0, maxLive: 0,
    batches: [], unacknowledged: 0, maxUnacknowledged: 0, maxPerWorkerUnacknowledged: 0,
    preparedJobs: 0, maxPreparedJobs: 0, decoderJobs: 0, maxDecoderJobs: 0 };
  const context = {
    __OFFLINE_MAP_ASSETS__: { vectorRegions: ['a', 'mono', 'legacy', 'partial', 'missing'] },
    performance: { now: () => { clock += 0.5; return clock; } },
    window: { location: { href: 'http://fixture.local/app/' } }, URL, Blob, AbortController, DOMException,
    console: { info() {}, warn() {} },
    setTimeout(callback, delay = 0) {
      timers++;
      return setTimeout(() => { clock += 10000; beats++; callback(); }, delay);
    },
    fetch: async (url) => {
      url = String(url).replace('http://fixture.local', '');
      calls.set(url, (calls.get(url) ?? 0) + 1);
      const cell = /\/offline-vector\/[^/]+\/[^/]+\.geojson$/.test(url);
      if (cell) { inFlight++; peakInFlight = Math.max(peakInFlight, inFlight); }
      // Simulate a macrotask response and deliberately out-of-order completion.
      await new Promise((resolve) => setTimeout(resolve, url.includes('210_1050') ? 3 : 0));
      if (cell) inFlight--;
      const entry = entries.get(url);
      if (allFail || !entry) return { ok: false, status: 404 };
      return { ok: true, text: async () => JSON.stringify(entry), blob: async () => {
        workerStats.preparedJobs++;
        workerStats.maxPreparedJobs = Math.max(workerStats.maxPreparedJobs, workerStats.preparedJobs);
        return new Blob([JSON.stringify(entry)]);
      } };
    },
  };
  if (scheduler) context.scheduler = { yield: async function () {
    assert.equal(this, context.scheduler, 'scheduler.yield retains its receiver');
    yields++;
    await new Promise((resolve) => setTimeout(() => { clock += 10000; beats++; resolve(); }, 0));
  } };
  if (worker) context.Worker = class FixtureWorker {
    constructor() {
      workerStats.created++;
      workerStats.live++; workerStats.maxLive = Math.max(workerStats.maxLive, workerStats.live);
      this.listeners = new Map(); this.ended = false; this.inbound = null;
      this.unacknowledged = 0; this.decoding = false;
      const workerSelf = {
        location: { href: 'http://fixture.local/src/workers/vector-loader.worker.ts', origin: 'http://fixture.local' },
        addEventListener: (name, callback) => { assert.equal(name, 'message'); this.inbound = callback; },
        postMessage: (message) => {
          if (this.ended) return;
          if ((message.kind === 'complete' || message.kind === 'error') && this.decoding) {
            this.decoding = false; workerStats.decoderJobs--; workerStats.preparedJobs--;
          }
          if (message.kind === 'batch') {
            this.unacknowledged++;
            workerStats.maxPerWorkerUnacknowledged = Math.max(workerStats.maxPerWorkerUnacknowledged, this.unacknowledged);
            workerStats.unacknowledged++;
            workerStats.maxUnacknowledged = Math.max(workerStats.maxUnacknowledged, workerStats.unacknowledged);
            workerStats.batches.push(plain(message.features));
          }
          const copied = structuredClone(message);
          setTimeout(() => {
            if (!this.ended) for (const callback of this.listeners.get('message') ?? []) callback({ data: copied });
          }, 0);
        },
      };
      sourceModule(path.join(__dirname, '../src/workers/vector-loader.worker.ts'), { ...context, self: workerSelf, window: undefined });
    }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    postMessage(message) {
      if (this.ended) throw new Error('Worker terminated');
      if (postError) throw new Error('Simulated postMessage transport failure');
      if (message.kind === 'load') {
        this.decoding = true; workerStats.decoderJobs++;
        workerStats.maxDecoderJobs = Math.max(workerStats.maxDecoderJobs, workerStats.decoderJobs);
      }
      if (startupError && message.kind === 'load') {
        setTimeout(() => {
          if (!this.ended) for (const callback of this.listeners.get('error') ?? []) callback({ message: 'Simulated CSP/startup failure' });
        }, 0);
        return;
      }
      if (message.kind === 'ack') { this.unacknowledged--; workerStats.unacknowledged--; }
      const copied = structuredClone(message);
      setTimeout(() => { if (!this.ended) this.inbound({ data: copied }); }, 0);
    }
    terminate() {
      if (this.ended) return;
      this.ended = true; this.listeners.clear(); workerStats.terminated++; workerStats.live--;
      if (this.decoding) { this.decoding = false; workerStats.decoderJobs--; workerStats.preparedJobs--; }
      workerStats.unacknowledged -= this.unacknowledged; this.unacknowledged = 0;
    }
  };
  const loader = sourceModule(path.join(__dirname, '../src/services/vectorFeatureStore.ts'), context, modules);
  return { context, loader, expected, entries, calls, modules, workerStats,
    stats: () => ({ yields, timers, beats, inFlight, peakInFlight }) };
}

async function checkScheduling(scheduler, worker = false) {
  const f = fixture({ scheduler, worker });
  const loading = f.loader.loadVectorFeatureStore();
  const duplicateLoading = f.loader.loadVectorFeatureStore();
  const [store, duplicateStore] = await Promise.all([loading, duplicateLoading]);
  assert.ok(store);
  assert.equal(store, duplicateStore, 'concurrent loads share the same immutable store instance');
  assert.deepEqual(plain(store.packs.map((pack) => pack.info.regionKey)), ['a', 'mono', 'legacy', 'partial']);
  assert.equal(store.featureCount, f.expected.length);
  assert.deepEqual(plain(store.allFeatures.map((feature) => feature.id)), f.expected.map((feature) => feature.id));
  assert.equal(store.allFeatures.filter((feature) => feature.id === 'duplicate').length, 2,
    'loader must not change existing duplicate-feature semantics');
  const counts = Object.fromEntries(['building', 'water_river', 'water_stream', 'water_body', 'peak', 'ridge', 'highway', 'forest', 'land', 'place'].map((kind) => [kind, 0]));
  for (const feature of f.expected) counts[feature.properties.kind]++;
  assert.deepEqual(plain(store.kindCounts), counts);
  const river = store.allFeatures.find((feature) => feature.id === 'river');
  assert.deepEqual(plain(river.geometry.coordinates), [[105.5, 21.5], [105.6, 21.6]]);
  assert.deepEqual(plain(river.bounds), { minLon: 105.5, maxLon: 105.6, minLat: 21.5, maxLat: 21.6 });
  assert.equal(store.allFeatures.find((feature) => feature.id === 'polygon').geometry.coordinates.length, 2);
  const bounds = { minLon: 105.49, maxLon: 105.53, minLat: 21.49, maxLat: 21.53 };
  const query = f.loader.queryFeaturesInBounds(store, bounds, ['peak']);
  const reference = store.allFeatures.filter((feature) => feature.kind === 'peak'
    && feature.bounds.maxLat >= bounds.minLat && feature.bounds.minLat <= bounds.maxLat
    && feature.bounds.maxLon >= bounds.minLon && feature.bounds.minLon <= bounds.maxLon);
  assert.deepEqual(plain(query.map((feature) => feature.id).sort()), plain(reference.map((feature) => feature.id).sort()));
  assert.equal(new Set(query).size, query.length, 'grid query removes repeated cell references');
  for (const count of f.calls.values()) assert.equal(count, 1, 'no duplicated index/cell fetch');
  assert.equal(f.calls.get('/offline-vector/a.geojson'), 1);
  assert.ok(f.stats().beats > 0, 'input/paint tasks can run before the store completes');
  if (scheduler) assert.ok(f.stats().yields > 4, 'normalization, flatten and merge reach scheduler checkpoints');
  else assert.ok(f.stats().timers > 4, 'fallback yields through macrotasks');
  assert.equal(f.stats().inFlight, 0);
  assert.ok(f.stats().peakInFlight <= 16);
  // The artificial wait clock grows 10 seconds per yield. mergeMs must record
  // active CPU slices, not include those scheduling delays.
  const timing = f.context.window.__vectorPerf.last();
  assert.equal(timing.indexRefetchCount, 0);
  if (worker) {
    assert.equal(f.workerStats.created, 2, 'hundreds of files reuse the bounded pool');
    assert.equal(f.workerStats.maxLive, 2, 'only two raw documents/workers can be active');
    assert.ok(f.workerStats.maxUnacknowledged <= 2, 'at most one unacknowledged batch per worker');
    assert.equal(f.workerStats.maxPerWorkerUnacknowledged, 1, 'each worker waits for its own main-thread ACK');
    assert.equal(f.workerStats.unacknowledged, 0);
    assert.equal(f.workerStats.maxPreparedJobs, 4, 'I/O preparation overlaps decoding, with at most four held jobs');
    assert.equal(f.workerStats.maxDecoderJobs, 2, 'only two prepared blobs decode at once');
    assert.equal(f.workerStats.preparedJobs, 0);
    assert.equal(f.workerStats.decoderJobs, 0);
    for (const batch of f.workerStats.batches) {
      assert.ok(batch.length <= 256);
      assert.ok(batch.length === 1 || JSON.stringify(batch).length < 512 * 1024 + 1024);
    }
  }
  // The second cache-hit timer also completes, so its record can supersede the
  // first. The first record is checked in a separate single-load fixture below.
  const callsBefore = f.calls.size;
  assert.equal(await f.loader.loadVectorFeatureStore(), store);
  assert.equal(f.calls.size, callsBefore, 'warm cache emits no network requests');
  console.log(`PASS ${worker ? 'worker + ACK' : scheduler ? 'scheduler' : 'setTimeout'}: ${store.featureCount} features, exact order/count/query, ${f.stats().yields || f.stats().timers} yields`);
}

(async () => {
  await checkScheduling(true);
  await checkScheduling(false);
  await checkScheduling(true, true);
  for (const failure of ['startupError', 'postError']) {
    const recovered = fixture({ worker: true, [failure]: true });
    const store = await recovered.loader.loadVectorFeatureStore();
    assert.equal(store.featureCount, recovered.expected.length, 'worker unavailability must preserve the current file as well as queued files');
    assert.deepEqual(plain(store.allFeatures.map((feature) => feature.id)), recovered.expected.map((feature) => feature.id));
    assert.ok(recovered.workerStats.created <= 2);
    assert.equal(recovered.workerStats.terminated, recovered.workerStats.created);
    for (const count of recovered.calls.values()) assert.equal(count, 1, 'fallback fetches each asset exactly once after startup/transport failure');
    console.log(`PASS ${failure}: current and queued files fall back with all ${store.featureCount} features retained`);
  }
  const timingFixture = fixture();
  const first = await timingFixture.loader.loadVectorFeatureStore();
  const timing = timingFixture.context.window.__vectorPerf.last();
  assert.ok(timing.mergeMs > 0 && timing.mergeMs < 10000, 'active merge CPU excludes simulated yield waits');
  assert.equal(timing.indexRefetchCount, 0);
  assert.equal(timing.requestCount, timingFixture.calls.size);
  const originalCalls = new Map(timingFixture.calls);
  timingFixture.loader.resetVectorFeatureStoreCache();
  const reloaded = await timingFixture.loader.loadVectorFeatureStore();
  assert.notEqual(reloaded, first);
  assert.deepEqual(plain(reloaded.allFeatures), plain(first.allFeatures));
  for (const [url, count] of originalCalls) assert.equal(timingFixture.calls.get(url), count + 1, 'explicit reset reloads each asset once');
  const unavailable = fixture({ allFail: true });
  assert.equal(await unavailable.loader.loadVectorFeatureStore(), null);
  unavailable.context.__OFFLINE_MAP_ASSETS__.vectorRegions = [];
  unavailable.loader.resetVectorFeatureStoreCache();
  unavailable.calls.clear();
  assert.equal(await unavailable.loader.loadVectorFeatureStore(), null);
  assert.equal(unavailable.calls.size, 0, 'no configured packs means no network');
  console.log('PASS timing/reset/errors: CPU-only merge, repeat loading, partial failure isolation, no-pack fallback');

  const protocol = fixture({ worker: true });
  const client = protocol.modules.get(path.join(__dirname, '../src/services/vectorLoadWorkerClient.ts')).exports;
  const options = { appendBatch: async (features, batch) => { features.push(...batch); } };
  const metrics = [];
  const parsed = await client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', { ...options, onMetrics: (value) => metrics.push(value) });
  assert.equal(parsed.features.length, 4100);
  assert.ok(metrics.some((value) => value.parseMs > 0 && value.normalizeMs > 0));
  assert.ok(metrics[0].fetchMs > 0 && metrics[0].parseMs === 0, 'network/blob preparation is recorded before worker decoding');
  await assert.rejects(client.loadVectorFileInWorker('/offline-vector/missing.geojson', 'missing', options), /HTTP 404/);
  await assert.rejects(client.loadVectorFileInWorker('http://outside.invalid/file', 'outside', options), /same-origin/);
  await assert.rejects(client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', { ...options, maxChars: 10 }), /quá lớn/);
  assert.equal(protocol.workerStats.created, 1, 'ordinary file errors keep the shared worker usable');
  // Hold the first batch to ensure main consumption precedes acknowledgement.
  const controller = new AbortController();
  let consumeStarted;
  const started = new Promise((resolve) => { consumeStarted = resolve; });
  let resume;
  const held = new Promise((resolve) => { resume = resolve; });
  const cancelled = client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', {
    signal: controller.signal,
    appendBatch: async () => { consumeStarted(); await held; },
  });
  await started;
  assert.equal(protocol.workerStats.unacknowledged, 1);
  const batchesBefore = protocol.workerStats.batches.length;
  await new Promise((resolve) => setTimeout(resolve, 4));
  assert.equal(protocol.workerStats.batches.length, batchesBefore, 'worker waits for ACK rather than flooding window');
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(protocol.workerStats.terminated, 1);
  resume();
  assert.equal((await client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', options)).features.length, 4100);
  assert.equal(protocol.workerStats.created, 2, 'cancelled worker is replaced on the next load');
  // A huge feature is retained alone instead of silently truncating geometry/property data.
  const huge = point('large-single-feature', 0); huge.properties.name = 'x'.repeat(600 * 1024);
  protocol.entries.set('/offline-vector/huge.geojson', collection([huge, point('after-huge', 1)]));
  const hugeResult = await client.loadVectorFileInWorker('/offline-vector/huge.geojson', 'huge', options);
  assert.equal(hugeResult.features[0].properties.name.length, 600 * 1024);
  assert.equal(hugeResult.features[1].id, 'after-huge');
  assert.ok(protocol.workerStats.batches.some((batch) => batch.length === 1 && batch[0].id === huge.id));
  console.log('PASS worker protocol: bounded ACK, same-origin, errors, cancellation/restart, large feature retained');

  // Pool member B keeps loading while member A is waiting for consumption/ACK.
  const isolatedController = new AbortController();
  let isolatedStarted;
  const isolatedReady = new Promise((resolve) => { isolatedStarted = resolve; });
  let isolatedResume;
  const isolatedHold = new Promise((resolve) => { isolatedResume = resolve; });
  const isolatedLoad = client.loadVectorFileInWorker('/offline-vector/a/210_1050.geojson', 'a', {
    signal: isolatedController.signal,
    appendBatch: async () => { isolatedStarted(); await isolatedHold; },
  });
  await isolatedReady;
  const independentResult = await client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', options);
  assert.equal(independentResult.features.length, 4100, 'other pool member progresses while one ACK is held');
  assert.equal(protocol.workerStats.live, 2);
  assert.ok(protocol.workerStats.maxLive <= 2);
  assert.ok(protocol.workerStats.maxUnacknowledged <= 2);
  assert.equal(protocol.workerStats.maxPerWorkerUnacknowledged, 1);
  isolatedController.abort();
  await assert.rejects(isolatedLoad, { name: 'AbortError' });
  isolatedResume();
  assert.equal(protocol.workerStats.live, 1, 'aborting one member leaves the other worker alive');
  const createdBeforeReuse = protocol.workerStats.created;
  assert.equal((await client.loadVectorFileInWorker('/offline-vector/mono.geojson', 'mono', options)).features.length, 4100);
  assert.equal(protocol.workerStats.created, createdBeforeReuse, 'surviving worker is reused after an isolated abort');
  console.log('PASS two-worker pool: bounded raw files/batches, independent progress, isolated abort and survivor reuse');
})().catch((error) => { console.error(error); process.exitCode = 1; });
