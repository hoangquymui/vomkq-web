import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { areaKm2, clipGeometryToAoi, createCircleAoi, createPolygonAoi, lengthKm, normalizeAnalysisGeometry, unionAreaKm2 } from '../src/services/analysisGeometry';
import { coverageForKind, measureAnalysisData, resetAnalysisDataCache, selectAnalysisCells } from '../src/services/analysisData';
import type { AnalysisAoi, AnalysisFeature, AnalysisGeometry } from '../src/types/analysis';

let passed = 0;
function check(label: string, fn: () => void) { fn(); passed++; console.log(`PASS ${label}`); }
const square = (west: number, south: number, east: number, north: number): AnalysisGeometry => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const aoi = createPolygonAoi([[0, 0], [1, 0], [1, 1], [0, 1]]);
const holeAoi: AnalysisAoi = { ...aoi, geometry: { type: 'Polygon', coordinates: [...aoi.geometry.coordinates, [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]]] } };
const metric = (snapshot: Awaited<ReturnType<typeof measureAnalysisData>>, id: string) => snapshot.measurements.find((measurement) => measurement.id === id)!;

check('AOI polygon closes without mutating input', () => { const raw = [[0, 0], [1, 0], [0, 1]]; assert.equal(createPolygonAoi(raw).geometry.coordinates[0].length, 4); assert.equal(raw.length, 3); });
check('Circle preserves radius/mode and validates coordinates', () => { assert.equal(createCircleAoi(108.2, 16.05, 1).geometry.coordinates[0].length, 65); assert.throws(() => createCircleAoi(200, 0, 1)); assert.throws(() => createCircleAoi(0, 0, 0)); });
check('Non-finite and out of range coordinates rejected', () => { assert.equal(normalizeAnalysisGeometry({ type: 'Point', coordinates: [NaN, 0] }), null); assert.equal(normalizeAnalysisGeometry({ type: 'Point', coordinates: [0, 91] }), null); });
check('Bad vertex is not silently removed', () => { assert.equal(normalizeAnalysisGeometry({ type: 'LineString', coordinates: [[0, 0], ['bad', 0], [1, 1]] }), null); });
check('Open rings and self intersections rejected', () => { assert.equal(normalizeAnalysisGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), null); assert.equal(normalizeAnalysisGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]] }), null); });
check('Hole outside exterior is rejected', () => { assert.equal(normalizeAnalysisGeometry({ type: 'Polygon', coordinates: [...aoi.geometry.coordinates, [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] }), null); });
check('Polygon holes remain in measurements', () => { assert.ok(normalizeAnalysisGeometry(holeAoi.geometry)); assert.ok(areaKm2(holeAoi.geometry) < areaKm2(aoi.geometry)); assert.equal(clipGeometryToAoi({ type: 'Point', coordinates: [0.5, 0.5] }, holeAoi.geometry), null); });
check('Touching/disjoint polygons do not throw or contribute area', () => { assert.equal(clipGeometryToAoi(square(1, 0, 2, 1), aoi.geometry), null); assert.equal(clipGeometryToAoi(square(2, 0, 3, 1), aoi.geometry), null); });
check('Clips polygons to AOI instead of full geometry area', () => { const raw = square(-1, 0, 0.5, 1); const clipped = clipGeometryToAoi(raw, aoi.geometry)!; assert.ok(Math.abs(areaKm2(clipped) / areaKm2(aoi.geometry) - 0.5) < 1e-6); });
check('Union eliminates overlapping areas', () => { assert.ok(Math.abs(unionAreaKm2([square(0, 0, 0.7, 1), square(0.3, 0, 1, 1)]) / areaKm2(aoi.geometry) - 1) < 1e-6); });
check('Lines crossing region are clipped', () => { const raw: AnalysisGeometry = { type: 'LineString', coordinates: [[-1, 0.5], [2, 0.5]] }; assert.ok(lengthKm(clipGeometryToAoi(raw, aoi.geometry)!) / lengthKm(raw) < 0.34); });
check('Lines crossing a hole exclude its length', () => { const raw: AnalysisGeometry = { type: 'LineString', coordinates: [[0, 0.5], [1, 0.5]] }; assert.ok(Math.abs(lengthKm(clipGeometryToAoi(raw, holeAoi.geometry)!) / lengthKm(raw) - 0.8) < 0.001); });
check('Boundary line contributes its measured length', () => { const raw: AnalysisGeometry = { type: 'LineString', coordinates: [[0, 0], [1, 0]] }; assert.ok(Math.abs(lengthKm(clipGeometryToAoi(raw, aoi.geometry)!) - lengthKm(raw)) < 1e-8); });
check('Multipart geometries normalize and clip', () => { const geometry: AnalysisGeometry = { type: 'MultiPolygon', coordinates: [(square(0, 0, 0.2, 0.2) as AnalysisAoi['geometry']).coordinates, (square(2, 2, 3, 3) as AnalysisAoi['geometry']).coordinates] }; assert.ok(normalizeAnalysisGeometry(geometry)); assert.ok(areaKm2(clipGeometryToAoi(geometry, aoi.geometry)!) < areaKm2(geometry)); assert.equal((clipGeometryToAoi({ type: 'MultiPoint', coordinates: [[0.1, 0.1], [2, 2]] }, aoi.geometry) as { coordinates: number[][] }).coordinates.length, 1); });
check('ROI selects true crossing bounds and preserves unusual cells', () => { assert.deepEqual(selectAnalysisCells({ cellDeg: 1, cells: ['0_0', '5_5', 'NaN_NaN'], cellBounds: { '5_5': [0.5, 0.5, 5, 5] } }, aoi), ['0_0', '5_5', 'NaN_NaN']); });
check('Legacy coverage unknown, successful filtered extraction partial', () => { assert.equal(coverageForKind(undefined, 'building', aoi), 'unknown'); assert.equal(coverageForKind({ schemaVersion: 1, requestedKinds: ['building'], extraction: 'legacy-first-coordinate-radius-filter', requests: [{ bbox: [0, 0, 1, 1], kinds: ['building'], status: 'empty' }] }, 'building', aoi), 'partial'); });
check('Complete ledger includes empty requests per kind', () => { const ledger = { schemaVersion: 1 as const, requestedKinds: ['building'], extraction: 'complete-geojson-scope', requests: [{ bbox: [0, 0, 1, 1], kinds: ['building'], status: 'empty' as const }] }; assert.equal(coverageForKind(ledger, 'building', aoi), 'observed'); assert.equal(coverageForKind(ledger, 'highway', aoi), 'unknown'); });
check('Failed and partial acquisition remain distinguishable', () => { assert.equal(coverageForKind({ schemaVersion: 1, requestedKinds: ['building'], requests: [{ bbox: [0, 0, 1, 1], kinds: ['building'], status: 'failed' }] }, 'building', aoi), 'missing'); assert.equal(coverageForKind({ schemaVersion: 1, requestedKinds: ['building'], extraction: 'complete-geojson-scope', requests: [{ bbox: [0, 0, 0.5, 1], kinds: ['building'], status: 'success' }] }, 'building', aoi), 'partial'); });

const f = (id: string | number, geometry: AnalysisGeometry, kind = 'building'): AnalysisFeature => ({ type: 'Feature', id, geometry, properties: { kind } });
function fixtureFetcher(files: Record<string, unknown>, requests: string[] = []): typeof fetch {
  return (async (input) => { const url = String(input); requests.push(url); const value = files[url]; return new Response(value === undefined ? 'missing' : JSON.stringify(value), { status: value === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
}
const baseUrl = 'http://local/';
const collection = (features: AnalysisFeature[], extras = {}) => ({ type: 'FeatureCollection', bbox: [0, 0, 1, 1], downloadedAt: '2026-10-06', features, ...extras });

resetAnalysisDataCache();
const missing = await measureAnalysisData(aoi, { baseUrl, regions: [], fetcher: fixtureFetcher({}) });
check('No vector data yields null, never zero observed', () => { assert.equal(metric(missing, 'vector:building:count').value, null); assert.equal(metric(missing, 'terrain:min').value, null); assert.equal(metric(missing, 'terrain:min').status, 'missing'); });
check('AOI number has explicit source', () => { assert.deepEqual(metric(missing, 'aoi:area').sourceIds, ['analysis:aoi']); assert.equal(missing.evidence.find((evidence) => evidence.fieldPath === 'measurements.aoi:area')!.value, metric(missing, 'aoi:area').value); });

resetAnalysisDataCache();
const observed = await measureAnalysisData(aoi, { baseUrl, regions: ['one', 'two'], fetcher: fixtureFetcher({
  [`${baseUrl}offline-vector/one.geojson`]: collection([f('building:way/10', square(0, 0, 0.7, 1)), f('building:way/11', square(0.3, 0, 1, 1)), f(1, square(0.1, 0.1, 0.2, 0.2))]),
  [`${baseUrl}offline-vector/two.geojson`]: collection([f('building:way/10', square(0, 0, 0.7, 1)), f(1, square(0.8, 0.8, 0.9, 0.9))]),
}), terrainSamples: [{ lon: 0.1, lat: 0.1, height: 0, sourceId: 'terrain:offline:l12' }, { lon: 0.2, lat: 0.2, height: null, sourceId: 'terrain:offline:l12' }, { lon: 2, lat: 2, height: 1000, sourceId: 'terrain:offline:l12' }] });
check('OSM duplicate across packs counted once', () => { assert.equal(metric(observed, 'vector:building:count').value, 4); assert.ok(observed.findings.some((finding) => finding.code === 'duplicates-removed')); });
check('Unqualified IDs do not merge unrelated sources', () => { assert.equal(observed.features!.filter((feature) => String(feature.id).endsWith(':feature:1')).length, 2); });
check('Legacy counts numeric but explicitly partial', () => { assert.equal(metric(observed, 'vector:building:count').status, 'partial'); assert.equal(metric(observed, 'vector:ridge:count').value, null); });
check('Union metric no overlapping double count', () => { assert.ok(Math.abs(metric(observed, 'vector:building:area').value! / areaKm2(aoi.geometry) - 1) < 1e-6); });
check('Area share uses union and does not exceed AOI due to overlap', () => { assert.ok(Math.abs(metric(observed, 'vector:building:area-share').value! - 100) < 1e-5); assert.equal(metric(observed, 'vector:building:area-share').unit, '%'); assert.equal(metric(observed, 'vector:building:area-share').status, 'partial'); });
check('Real zero terrain preserved; null and outside samples excluded', () => { assert.equal(metric(observed, 'terrain:min').value, 0); assert.equal(metric(observed, 'terrain:max').value, 0); assert.equal(metric(observed, 'terrain:min').status, 'partial'); });
check('Evidence source versions match datasets', () => { for (const evidence of observed.evidence) assert.equal(evidence.version, observed.datasets.find((dataset) => dataset.id === evidence.sourceId)?.version); });

resetAnalysisDataCache();
const conflict = await measureAnalysisData(aoi, { baseUrl, regions: ['one', 'two'], fetcher: fixtureFetcher({ [`${baseUrl}offline-vector/one.geojson`]: collection([f('building:way/10', square(0, 0, 0.7, 1))]), [`${baseUrl}offline-vector/two.geojson`]: collection([f('building:way/10', square(0, 0, 0.6, 1))]) }) });
check('Same OSM ID changed geometry excluded and flagged', () => { assert.equal(conflict.features!.length, 0); assert.equal(metric(conflict, 'vector:building:count').value, null); assert.ok(conflict.findings.some((finding) => finding.code === 'geometry-conflict')); });

resetAnalysisDataCache();
const malformedNear = await measureAnalysisData(aoi, { baseUrl, regions: ['bad'], fetcher: fixtureFetcher({
  [`${baseUrl}offline-vector/bad.geojson`]: collection([
    f('building:way/900', { type: 'Polygon', coordinates: [[[-1, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]] }),
    f('building:way/901', { type: 'Polygon', coordinates: [[[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, 0]], [[0.05, 0.05], [0.1, 0.05], [NaN, 0.1], [0.05, 0.1], [0.05, 0.05]]] }),
    f('building:way/902', { type: 'Polygon', coordinates: [[[10, 10], [11, 11], [10, 11], [11, 10], [10, 10]]] }),
  ]),
}) });
check('Bounds prefilter never bypasses validation of malformed/NaN or crossing geometry near AOI', () => {
  assert.equal(malformedNear.features!.length, 0);
  const finding = malformedNear.findings.find((finding) => finding.code === 'invalid-geometry')!;
  assert.match(finding.message, /^2 đối tượng trong phần dữ liệu được xét/);
  assert.match(finding.message, /không phải số lỗi của toàn gói/);
});

resetAnalysisDataCache();
const requests: string[] = [];
const files = {
  [`${baseUrl}offline-vector/tile.geojson`]: { type: 'vector-tile-index', bbox: [0, 0, 10, 10], cellDeg: 1, cells: ['0_0', '5_5', 'NaN_NaN'] },
  [`${baseUrl}offline-vector/tile/0_0.geojson`]: collection([f('peak:node/100', { type: 'Point', coordinates: [0.1, 0.1] }, 'peak')]),
  [`${baseUrl}offline-vector/tile/NaN_NaN.geojson`]: collection([f('building:way/100', square(0.2, 0.2, 0.3, 0.3))]),
};
const tile = await measureAnalysisData(aoi, { baseUrl, regions: ['tile'], fetcher: fixtureFetcher(files, requests) });
check('ROI fetch skips distant named cell', () => { assert.equal(requests.length, 3); assert.ok(!requests.some((url) => url.includes('/5_5'))); });
check('NaN_NaN data kept by valid geometry', () => { assert.equal(metric(tile, 'vector:building:count').value, 1); });
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
check('Source fingerprint includes exact selected cell content without loading distant cells', () => {
  const expected = createHash('sha256').update([
    jsonHash(files[`${baseUrl}offline-vector/tile.geojson`]),
    `0_0:${jsonHash(files[`${baseUrl}offline-vector/tile/0_0.geojson`])}`,
    `NaN_NaN:${jsonHash(files[`${baseUrl}offline-vector/tile/NaN_NaN.geojson`])}`,
  ].sort().join('\n')).digest('hex');
  assert.equal(tile.datasets.find((dataset) => dataset.id === 'vector:tile')!.hash, expected);
});
await measureAnalysisData(aoi, { baseUrl, regions: ['tile'], fetcher: fixtureFetcher(files, requests) });
check('Worker data LRU warm run reuses files', () => assert.equal(requests.length, 3));
resetAnalysisDataCache();
const changedCell = await measureAnalysisData(aoi, { baseUrl, regions: ['tile'], fetcher: fixtureFetcher({
  ...files,
  [`${baseUrl}offline-vector/tile/NaN_NaN.geojson`]: collection([f('building:way/100', square(0.2, 0.2, 0.4, 0.4))]),
}) });
check('Changed cell contents change fingerprint even when manifest version is unchanged', () => {
  const before = tile.datasets.find((dataset) => dataset.id === 'vector:tile')!;
  const after = changedCell.datasets.find((dataset) => dataset.id === 'vector:tile')!;
  assert.equal(before.version, after.version); assert.notEqual(before.hash, after.hash);
});
resetAnalysisDataCache();
const indexedCell = await measureAnalysisData(aoi, { baseUrl, regions: ['index'], fetcher: fixtureFetcher({
  [`${baseUrl}offline-vector/index.geojson`]: { type: 'vector-tile-index', bbox: [0, 0, 10, 10], cellDeg: 1, cells: ['5_5'], cellBounds: { '5_5': [0.5, 0.5, 5.5, 5.5] } },
  [`${baseUrl}offline-vector/index/5_5.geojson`]: collection([f('building:way/200', square(0.5, 0.5, 5.5, 5.5))]),
}) });
check('True bounds load crossing geometry whose anchor cell is distant', () => { assert.equal(metric(indexedCell, 'vector:building:count').value, 1); assert.ok(Math.abs(metric(indexedCell, 'vector:building:area-share').value! - 25) < 0.003); });
resetAnalysisDataCache();
const indexedTerrain = await measureAnalysisData(holeAoi, { baseUrl, regions: [], terrainSamples: [
  { lon: 0.1, lat: 0.1, height: null, sourceId: 'terrain:offline:l12' },
  { lon: 0.2, lat: 0.2, height: 0, sourceId: 'terrain:offline:l12' },
  { lon: 0.5, lat: 0.5, height: 1000, sourceId: 'terrain:offline:l12' },
  { lon: 0.3, lat: 0.3, height: Infinity, sourceId: 'terrain:offline:l12' },
] });
check('Terrain citations address persisted sample index after nulls; hole samples excluded', () => {
  assert.equal(indexedTerrain.terrainSamples!.length, 3);
  const citation = indexedTerrain.evidence.find((evidence) => evidence.fieldPath === 'terrainSamples.1')!;
  assert.equal(citation.value, 0); assert.equal(indexedTerrain.terrainSamples![1].height, citation.value);
  assert.equal(indexedTerrain.terrainSamples![2].height, null);
  assert.equal(indexedTerrain.datasets.find((dataset) => dataset.id === 'terrain:offline:l12')!.hash, jsonHash(indexedTerrain.terrainSamples));
});
resetAnalysisDataCache();
const brokenCell = await measureAnalysisData(aoi, { baseUrl, regions: ['tile'], fetcher: fixtureFetcher({ [`${baseUrl}offline-vector/tile.geojson`]: { type: 'vector-tile-index', bbox: [0, 0, 1, 1], cellDeg: 1, cells: ['0_0'] } }) });
check('Missing cell is not successful empty cell', () => { assert.ok(brokenCell.findings.some((finding) => finding.code === 'cell-unavailable')); assert.equal(metric(brokenCell, 'vector:building:count').value, null); });
resetAnalysisDataCache();
const complete = await measureAnalysisData(aoi, { baseUrl, regions: ['empty'], fetcher: fixtureFetcher({ [`${baseUrl}offline-vector/empty.geojson`]: collection([], { coverageLedger: { schemaVersion: 1, requestedKinds: ['building'], extraction: 'complete-geojson-scope', requests: [{ bbox: [0, 0, 1, 1], kinds: ['building'], status: 'empty' }] } }) }) });
check('Proven empty acquisition yields observed zero for requested kind only', () => { assert.equal(metric(complete, 'vector:building:count').value, 0); assert.equal(metric(complete, 'vector:building:count').status, 'observed'); assert.equal(metric(complete, 'vector:highway:count').value, null); });
const abort = new AbortController(); abort.abort();
await assert.rejects(measureAnalysisData(aoi, { baseUrl, regions: [], signal: abort.signal }), { name: 'AbortError' }); passed++;
console.log(`PASS cancellation before processing\n${passed} analysis geometry/data checks passed.`);
