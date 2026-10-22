import assert from 'node:assert/strict';
import { vectorCoverageRecord, vectorFeatureBounds } from '../download-tactical-vector.js';

const chunk = { row: 0, col: 1, minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
assert.equal(vectorCoverageRecord(chunk, ['building'], { elements: [] }).status, 'unknown');
assert.equal(vectorCoverageRecord(chunk, ['building'], { elements: [], provenance: { queriedAt: '2026-10-06', queryHash: 'hash' } }).status, 'empty');
assert.equal(vectorCoverageRecord(chunk, ['building'], { elements: [{ id: 1 }], provenance: { queriedAt: '2026-10-06', queryHash: 'hash' } }).status, 'success');
assert.equal(vectorCoverageRecord(chunk, ['building'], { error: new Error('timeout') }).status, 'failed');
assert.deepEqual(vectorCoverageRecord(chunk, ['peak', 'building'], { elements: [] }).kinds, ['building', 'peak']);
assert.deepEqual(vectorFeatureBounds([{ geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [3, 2], [0, 0]]]], } }, { geometry: { type: 'Point', coordinates: [-1, 1] } }]), [-1, 0, 3, 2]);
assert.equal(vectorFeatureBounds([{ geometry: { coordinates: [NaN, 0] } }]), null);
console.log('7 coverage ledger / true-bounds checks passed; importing downloader did not download data.');
