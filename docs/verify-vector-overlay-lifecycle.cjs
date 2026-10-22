/**
 * Run the actual VectorOverlay effect with real Cesium entity/property collections.
 * Only React effects, WebGL-facing handler and GeoJSON loading are substituted.
 * node docs/verify-vector-overlay-lifecycle.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const Cesium = require('cesium');

const componentCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/map/VectorOverlay.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function event() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(listener) { listeners.add(listener); },
    removeEventListener(listener) { listeners.delete(listener); },
    fire() { for (const listener of [...listeners]) listener(); },
  };
}
function point(id, kind = 'place') {
  return {
    id, kind, geometry: { type: 'Point', coordinates: [105.5, 21.5] },
    properties: { kind }, regionKey: 'test',
    bounds: { minLat: 21.5, maxLat: 21.5, minLon: 105.5, maxLon: 105.5 },
  };
}
function line(id, count) {
  return {
    ...point(id, 'water_river'),
    geometry: { type: 'LineString', coordinates: Array.from({ length: count }, (_, i) => [105.5 + i / 100000, 21.5]) },
  };
}
const vertexCount = (feature) => feature.geometry.type === 'Point' ? 1 :
  feature.geometry.type === 'LineString' ? feature.geometry.coordinates.length :
    feature.geometry.coordinates.reduce((count, ring) => count + ring.length, 0);
const pause = () => new Promise((resolve) => setTimeout(resolve, 2));
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) {
    if (predicate()) return;
    await pause();
  }
  throw new Error('Timed out: ' + label);
}

function fixture({ visible = true, features = [], supplied = true, kinds, height = 95000 } = {}) {
  const slots = [];
  const pendingEffects = [];
  const pendingLoads = [];
  const loadedSources = [];
  const batches = [];
  const handlers = [];
  let hook = 0;
  let loads = 0;
  let queries = 0;
  let renders = 0;
  let deferNext = false;
  let candidates = features;
  let rectangle = Cesium.Rectangle.fromDegrees(105, 21, 106, 22);
  let selected = null;
  const store = {
    featureCount: 1000000,
    // Picking must use the visible subset, not construct an archive-wide map.
    get allFeatures() { throw new Error('Full archive scan on interactive path'); },
  };
  const camera = {
    changed: event(), moveEnd: event(),
    positionCartographic: { latitude: Cesium.Math.toRadians(21.35), longitude: Cesium.Math.toRadians(105.645), height },
    computeViewRectangle: () => rectangle,
  };
  const dataSources = new Cesium.DataSourceCollection();
  const viewer = {
    isDestroyed: () => false, camera, dataSources,
    scene: { canvas: {}, requestRender() { renders++; }, pick: () => selected },
  };
  let props = { viewer, visible, kinds, store: supplied ? store : undefined, onSelectFeature: () => {} };
  const fakeReact = {
    useRef(value) {
      const index = hook++;
      return slots[index] ?? (slots[index] = { current: value });
    },
    useEffect(callback, deps) {
      const index = hook++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: callback() };
        });
      }
    },
  };
  class Handler {
    constructor() { this.actions = new Map(); this.destroyed = false; handlers.push(this); }
    setInputAction(callback, kind) { this.actions.set(kind, callback); }
    destroy() { this.destroyed = true; }
  }
  const fakeCesium = {
    ...Cesium, ScreenSpaceEventHandler: Handler,
    GeoJsonDataSource: {
      async load(collection) {
        batches.push(collection.features);
        if (deferNext) {
          deferNext = false;
          await new Promise((resolve) => pendingLoads.push(resolve));
        }
        const source = new Cesium.CustomDataSource('batch');
        loadedSources.push(source);
        for (const feature of collection.features) {
          const entity = new Cesium.Entity({ id: feature.id, properties: feature.properties });
          if (feature.geometry.type === 'Point') {
            entity.billboard = new Cesium.BillboardGraphics({ image: 'default-pin' });
            entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(...feature.geometry.coordinates));
          } else if (feature.geometry.type === 'LineString') {
            entity.polyline = new Cesium.PolylineGraphics({
              positions: feature.geometry.coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
            });
          } else {
            entity.polygon = new Cesium.PolygonGraphics({
              hierarchy: new Cesium.PolygonHierarchy(feature.geometry.coordinates[0].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))),
            });
          }
          source.entities.add(entity);
        }
        return source;
      },
    },
  };
  const query = (_store, _bounds, selectedKinds) => {
    queries++;
    return candidates.filter((feature) => !selectedKinds || selectedKinds.includes(feature.kind));
  };
  const module = { exports: {} };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require(specifier) {
      if (specifier === 'react') return fakeReact;
      if (specifier === 'cesium') return fakeCesium;
      if (specifier.endsWith('vectorFeatureStore')) return {
        loadVectorFeatureStore: async () => { loads++; return store; },
        queryFeaturesInBounds: query,
        queryFeaturesInRadius: (_store, _lat, _lon, _radius, selectedKinds) => query(_store, null, selectedKinds),
      };
      if (specifier.endsWith('vectorStyle')) return {
        VECTOR_KIND_COLORS: new Proxy({}, { get: () => '#336699' }),
        VECTOR_LINE_WIDTHS: {}, VECTOR_POINT_SIZES: {},
      };
      throw new Error('Unexpected dependency: ' + specifier);
    },
  }, { filename: 'VectorOverlay.js' });
  function render(changes = {}) {
    props = { ...props, ...changes };
    hook = 0;
    module.exports.VectorOverlay(props);
    for (const callback of pendingEffects.splice(0)) callback();
  }
  render();
  return {
    viewer, camera, batches, loadedSources, pendingLoads, handlers,
    render, get queries() { return queries; }, get loads() { return loads; }, get renders() { return renders; },
    get source() { return dataSources.length ? dataSources.get(0) : null; },
    set candidates(value) { candidates = value; },
    move(west = 105.01) { rectangle = Cesium.Rectangle.fromDegrees(west, 21, west + 1, 22); camera.changed.fire(); camera.moveEnd.fire(); },
    defer() { deferNext = true; },
    click(entity) { selected = { id: entity }; handlers.at(-1).actions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({ position: {} }); },
    cleanup() { for (const slot of [...slots].reverse()) slot?.cleanup?.(); },
  };
}

(async () => {
  let checks = 0;
  const hidden = fixture({ visible: false, supplied: false });
  await pause();
  assert.equal(hidden.loads, 0);
  assert.equal(hidden.camera.moveEnd.listeners.size, 0);
  hidden.cleanup(); checks++;

  const absent = fixture();
  absent.render({ store: null });
  await pause();
  assert.equal(absent.loads, 0);
  absent.cleanup(); checks++;

  const first = point('first');
  const empty = fixture();
  await until(() => empty.queries === 1, 'initial empty view');
  assert.equal(empty.camera.changed.listeners.size, 1);
  assert.equal(empty.camera.moveEnd.listeners.size, 1);
  empty.candidates = [first];
  empty.move();
  await until(() => empty.source?.entities.values.length === 1, 'enter downloaded view');
  assert.equal(empty.source.entities.values[0].id, 'first');
  empty.cleanup();
  assert.equal(empty.camera.changed.listeners.size, 0);
  assert.equal(empty.camera.moveEnd.listeners.size, 0); checks++;

  const featureList = Array.from({ length: 4000 }, (_, i) => point('point-' + i));
  const dense = fixture({ features: featureList });
  await until(() => dense.source, 'bounded dense overlay');
  assert.equal(dense.source.entities.values.length, 3000);
  assert(dense.batches.length > 1);
  assert(dense.batches.every((batch) => batch.length <= 128));
  assert(dense.source.entities.values.every((entity) => !entity.billboard && entity.point));
  assert.equal(featureList.length, 4000, 'render caps must preserve the input source');
  const readySource = dense.source;
  const readyBatches = dense.batches.length;
  const readyQueries = dense.queries;
  dense.camera.changed.fire(); dense.camera.moveEnd.fire();
  await new Promise((resolve) => setTimeout(resolve, 375));
  assert.equal(dense.queries, readyQueries, 'unchanged view must skip spatial queries');
  assert.equal(dense.batches.length, readyBatches);
  dense.move(105.05);
  await until(() => dense.queries > readyQueries, 'new view selection');
  await pause();
  assert.equal(dense.source, readySource, 'unchanged feature identities must retain the datasource');
  assert.equal(dense.batches.length, readyBatches);
  let picked;
  dense.render({ kinds: undefined, onSelectFeature: (feature) => { picked = feature; } });
  dense.click(dense.source.entities.values[0]);
  assert.equal(picked, featureList[0], 'picking returns the original feature without scanning full store');
  dense.cleanup(); checks++;

  const complex = Array.from({ length: 20 }, (_, i) => line('line-' + i, 3000));
  complex.unshift(line('too-big', 8001));
  const bounded = fixture({ features: complex });
  await until(() => bounded.source, 'vertex budgets');
  const drawn = bounded.batches.flat();
  assert(drawn.every((feature) => vertexCount(feature) <= 8000));
  assert(drawn.reduce((count, feature) => count + vertexCount(feature), 0) <= 50000);
  assert(bounded.batches.every((batch) => batch.length === 1 || batch.reduce((count, feature) => count + vertexCount(feature), 0) <= 4096));
  assert(drawn.every((feature) => feature.id !== 'too-big'));
  assert(bounded.source.entities.values[0].polyline.positions.getValue().length === 3000, 'style must retain loaded line positions');
  assert.equal(complex[0].geometry.coordinates.length, 8001);
  bounded.cleanup(); checks++;

  const polygon = {
    ...point('polygon', 'forest'),
    geometry: { type: 'Polygon', coordinates: [[[105.5, 21.5], [105.6, 21.5], [105.6, 21.6], [105.5, 21.5]]] },
  };
  const geometry = fixture({ features: [polygon] });
  await until(() => geometry.source, 'polygon style');
  assert.equal(geometry.source.entities.values[0].polygon.hierarchy.getValue().positions.length, 4);
  geometry.cleanup(); checks++;

  const lifecycle = fixture({ features: [first] });
  await until(() => lifecycle.source, 'initial retained source');
  const oldSource = lifecycle.source;
  const next = point('second');
  lifecycle.candidates = [next];
  lifecycle.defer(); lifecycle.move(105.2);
  await until(() => lifecycle.pendingLoads.length, 'replacement loading');
  assert.equal(lifecycle.source, oldSource, 'ready source stays visible during construction');
  lifecycle.pendingLoads.shift()();
  await until(() => lifecycle.source !== oldSource, 'replacement commit');
  assert.equal(lifecycle.source.entities.values[0].id, 'second');
  assert.equal(oldSource.entities.values.length, 0, 'old source is cleared');
  lifecycle.cleanup(); checks++;

  const cancelled = fixture({ features: [first] });
  cancelled.defer();
  await until(() => cancelled.pendingLoads.length, 'cancel during load');
  cancelled.cleanup();
  cancelled.pendingLoads.shift()();
  await until(() => cancelled.loadedSources.length, 'late load resolution');
  await pause();
  assert.equal(cancelled.viewer.dataSources.length, 0, 'late source cannot be attached after unmount');
  assert(cancelled.loadedSources.every((source) => source.entities.values.length === 0));
  checks++;

  const stale = fixture({ features: [first] });
  stale.defer();
  await until(() => stale.pendingLoads.length, 'stale initial load');
  stale.candidates = [next]; stale.move(105.3);
  stale.pendingLoads.shift()();
  await until(() => stale.source, 'latest camera build');
  assert.equal(stale.source.entities.values[0].id, 'second');
  assert(stale.loadedSources[0].entities.values.length === 0);
  stale.cleanup(); checks++;

  const filters = fixture({ features: [point('place'), point('river', 'water_river'), point('road', 'highway')], kinds: ['highway', 'water_river'], height: 130000 });
  await until(() => filters.source, 'far view filter intersection');
  assert.deepEqual(filters.source.entities.values.map((entity) => entity.id), ['river']);
  const filterSource = filters.source;
  filters.render({ kinds: ['highway', 'water_river'] });
  await pause();
  assert.equal(filters.source, filterSource, 'equivalent new filter array must not rebuild');
  filters.render({ visible: false });
  assert.equal(filters.viewer.dataSources.length, 0);
  filters.cleanup(); checks++;
  console.log('PASS: ' + checks + ' overlay lifecycle checks (budgets, batches, reuse, geometry, filters, picking, cancellation and empty views).');
})().catch((error) => { console.error(error); process.exitCode = 1; });
