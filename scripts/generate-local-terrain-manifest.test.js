import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Cartographic, CesiumTerrainProvider, Resource } from 'cesium';
import { generateLocalTerrainManifest } from './generate-local-terrain-manifest.js';

function fixture(t, tiles, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vompk-terrain-manifest-'));
  const expectedDirectory = path.resolve(directory);
  t.after(() => {
    assert.equal(path.resolve(directory), expectedDirectory);
    assert.equal(path.dirname(expectedDirectory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('vompk-terrain-manifest-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const source = {
    format: 'quantized-mesh-1.0',
    version: '1.2.0',
    scheme: 'tms',
    projection: 'EPSG:4326',
    tiles: ['{z}/{x}/{y}.terrain'],
    attribution: 'Keep the source attribution',
    minzoom: 0,
    maxzoom: 0,
    metadataAvailability: 10,
    extensions: ['octvertexnormals', 'watermask', 'metadata'],
    available: [[{ startX: 0, startY: 0, endX: 1, endY: 0 }]],
    ...overrides,
  };
  const layerPath = path.join(directory, 'layer.json');
  fs.writeFileSync(layerPath, JSON.stringify(source));
  for (const tile of tiles) {
    const tilePath = path.join(directory, `${tile}.terrain`);
    fs.mkdirSync(path.dirname(tilePath), { recursive: true });
    fs.writeFileSync(tilePath, Buffer.alloc(100));
  }
  return { directory, layerPath, source };
}

function advertisedTiles(available) {
  const tiles = new Set();
  available.forEach((ranges, level) => {
    for (const range of ranges) {
      for (let x = range.startX; x <= range.endX; x++) {
        for (let y = range.startY; y <= range.endY; y++) {
          const tile = `${level}/${x}/${y}`;
          assert.ok(!tiles.has(tile), `Overlapping availability for ${tile}`);
          tiles.add(tile);
        }
      }
    }
  });
  return tiles;
}

test('availability exactly preserves local TMS tiles, gaps, and unrelated metadata', (t) => {
  const tiles = ['0/0/0', '0/1/0', '1/0/0', '1/0/1', '1/1/0', '1/1/1', '1/3/1'];
  const { directory, layerPath, source } = fixture(t, tiles);
  const result = generateLocalTerrainManifest(directory);
  const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));

  assert.deepEqual(advertisedTiles(layer.available), new Set(tiles));
  assert.deepEqual(result, { tileCount: 7, rangeCount: 3, maxZoom: 1, excludedTileCount: 0 });
  assert.equal(layer.maxzoom, 1);
  assert.ok(!Object.hasOwn(layer, 'metadataAvailability'));
  assert.deepEqual(layer.extensions, ['octvertexnormals', 'watermask']);
  for (const field of ['format', 'version', 'scheme', 'projection', 'tiles', 'attribution', 'minzoom']) {
    assert.deepEqual(layer[field], source[field]);
  }
  assert.equal(fs.readdirSync(directory).filter((file) => file.endsWith('.tmp')).length, 0);
});

test('string extensions retain normals and water masks without global metadata', (t) => {
  const { directory, layerPath } = fixture(t, ['0/0/0'], {
    extensions: 'octvertexnormals-watermask-metadata',
  });
  generateLocalTerrainManifest(directory);
  assert.deepEqual(JSON.parse(fs.readFileSync(layerPath, 'utf8')).extensions, ['octvertexnormals', 'watermask']);
});

test('partial downloads exclude unavailable parent chains while preserving child files', (t) => {
  const { directory, layerPath } = fixture(t, ['0/0/0', '1/3/1', '2/6/2']);
  const result = generateLocalTerrainManifest(directory);
  assert.deepEqual(advertisedTiles(JSON.parse(fs.readFileSync(layerPath, 'utf8')).available), new Set(['0/0/0']));
  assert.equal(result.excludedTileCount, 2);
  assert.ok(fs.existsSync(path.join(directory, '2/6/2.terrain')));
});

test('empty packs and malformed tile paths leave the existing manifest untouched', (t) => {
  const { directory, layerPath } = fixture(t, []);
  const before = fs.readFileSync(layerPath, 'utf8');
  assert.throws(() => generateLocalTerrainManifest(directory), /No terrain tiles/);
  fs.mkdirSync(path.join(directory, '0/2'), { recursive: true });
  fs.writeFileSync(path.join(directory, '0/2/0.terrain'), Buffer.alloc(100));
  assert.throws(() => generateLocalTerrainManifest(directory), /Invalid terrain X/);
  assert.equal(fs.readFileSync(layerPath, 'utf8'), before);
});

test('zero-byte terrain files leave the existing manifest untouched', (t) => {
  const { directory, layerPath } = fixture(t, ['0/0/0']);
  const before = fs.readFileSync(layerPath, 'utf8');
  fs.writeFileSync(path.join(directory, '0/0/0.terrain'), '');
  assert.throws(() => generateLocalTerrainManifest(directory), /Empty terrain tile/);
  assert.equal(fs.readFileSync(layerPath, 'utf8'), before);
});

test('unsupported projections preserve the previous manifest', (t) => {
  const { directory, layerPath } = fixture(t, ['0/0/0'], { projection: 'EPSG:3857' });
  const before = fs.readFileSync(layerPath, 'utf8');
  assert.throws(() => generateLocalTerrainManifest(directory), /requires EPSG:4326/);
  assert.equal(fs.readFileSync(layerPath, 'utf8'), before);
});

test('Cesium consumes static TMS availability and rejects missing tiles without metadata discovery', async (t) => {
  const { directory, layerPath } = fixture(t, ['0/0/0', '0/1/0', '1/0/0', '1/0/1', '1/1/0', '1/1/1']);
  generateLocalTerrainManifest(directory);
  const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
  const fetchJson = Resource.prototype.fetchJson;
  let requests = 0;
  Resource.prototype.fetchJson = async function () {
    assert.equal(this.url, 'https://local-terrain.invalid/layer.json');
    requests++;
    return layer;
  };
  try {
    const provider = await CesiumTerrainProvider.fromUrl('https://local-terrain.invalid', {
      requestMetadata: false,
    });
    assert.equal(provider.hasMetadata, false);
    assert.equal(provider.availability.computeMaximumLevelAtPosition(Cartographic.fromDegrees(-90, 45)), 1);
    assert.equal(provider.availability.computeMaximumLevelAtPosition(Cartographic.fromDegrees(90, 45)), 0);
    assert.equal(provider.getTileDataAvailable(0, 0, 1), true);
    assert.equal(provider.getTileDataAvailable(3, 0, 1), false);
    assert.equal(provider.loadTileDataAvailability(3, 0, 1), undefined);
    assert.equal(requests, 1);
  } finally {
    Resource.prototype.fetchJson = fetchJson;
  }
});
