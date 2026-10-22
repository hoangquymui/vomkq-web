/** Disk-backed real-pack check; reads only, makes no network calls and never rewrites map packs. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCircleAoi } from '../src/services/analysisGeometry';
import { measureAnalysisData, resetAnalysisDataCache } from '../src/services/analysisData';

const regions = process.argv.slice(2).filter((name) => /^[a-z]+$/.test(name));
const selectedRegions = regions.length ? regions : ['danang'];
const publicDirectory = path.resolve('public');
const requests: string[] = [];
const fetcher: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const filename = path.resolve(publicDirectory, relative);
  assert.ok(filename.startsWith(`${publicDirectory}${path.sep}`));
  requests.push(relative);
  try { return new Response(await readFile(filename), { status: 200 }); }
  catch { return new Response('missing', { status: 404 }); }
};
resetAnalysisDataCache();
const aoi = createCircleAoi(108.2, 16.05, 0.5);
for (const temperature of ['cold', 'warm']) {
  const started = performance.now();
  const snapshot = await measureAnalysisData(aoi, { baseUrl: 'http://local/', regions: selectedRegions, fetcher });
  const vector = snapshot.datasets.filter((dataset) => dataset.id.startsWith('vector:') && dataset.coverage !== 'outside');
  assert.ok(vector.length);
  assert.ok(snapshot.findings.some((finding) => finding.code === 'coverage-unverified'));
  assert.equal(snapshot.measurements.find((measurement) => measurement.id === 'terrain:min')?.value, null);
  for (const evidence of snapshot.evidence) assert.equal(evidence.version, snapshot.datasets.find((dataset) => dataset.id === evidence.sourceId)?.version);
  console.log(JSON.stringify({ temperature, elapsedMs: Math.round(performance.now() - started),
    requests: requests.length, features: snapshot.features?.length, measurements: snapshot.measurements.length,
    findings: snapshot.findings.map((finding) => finding.code),
    count: snapshot.measurements.find((measurement) => measurement.id === 'vector:building:count'),
    packHashes: vector.map((dataset) => ({ id: dataset.id, version: dataset.version, hash: dataset.hash })),
  }));
}
assert.ok(requests.some((filename) => filename.endsWith('/NaN_NaN.geojson')), 'Legacy anomalous cell must be read rather than dropped.');
console.log('Read-only real-pack smoke passed; Node timings are not browser FPS measurements.');
