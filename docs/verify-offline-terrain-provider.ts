/** Read-only provider regressions. Bundle with esbuild --external:cesium, then
 * run with node --test. The real-pack test never requests terrain over HTTP. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as Cesium from 'cesium';
import { getOfflineTerrainProvider, guardOfflineTerrainRequests } from '../src/services/offlineTerrainProvider';

test('guard blocks only known missing tiles and preserves arguments, throttling and promise identity', async () => {
  let availability: boolean | undefined = true;
  let calls = 0;
  let throttle = false;
  const pending = Promise.resolve(new Cesium.HeightmapTerrainData({
    buffer: new Uint16Array(4), width: 2, height: 2,
  }));
  const request = new Cesium.Request({ throttle: false });
  const provider = {
    getTileDataAvailable: () => availability,
    requestTileGeometry(this: unknown, x: number, y: number, level: number, inputRequest: Cesium.Request) {
      assert.equal(this, provider);
      assert.deepEqual([x, y, level], [2, 3, 4]);
      assert.equal(inputRequest, request);
      calls++;
      return throttle ? undefined : pending;
    },
  } as unknown as Cesium.CesiumTerrainProvider;
  assert.equal(guardOfflineTerrainRequests(provider), provider);
  const guardedRequest = provider.requestTileGeometry;
  assert.equal(guardOfflineTerrainRequests(provider).requestTileGeometry, guardedRequest);
  assert.equal(provider.requestTileGeometry(2, 3, 4, request), pending);
  availability = undefined;
  assert.equal(provider.requestTileGeometry(2, 3, 4, request), pending);
  throttle = true;
  assert.equal(provider.requestTileGeometry(2, 3, 4, request), undefined);
  assert.equal(calls, 3);
  availability = false;
  await assert.rejects(provider.requestTileGeometry(2, 3, 4, request)!, Cesium.RuntimeError);
  assert.equal(calls, 3, 'Known missing tile must not reach the underlying network request');
});

test('real sampleTerrain preserves a measured zero and returns undefined for a missing sample', async () => {
  let calls = 0;
  const zeroTerrain = new Cesium.HeightmapTerrainData({ buffer: new Uint16Array(4), width: 2, height: 2 });
  const provider = guardOfflineTerrainRequests({
    tilingScheme: new Cesium.GeographicTilingScheme(),
    getTileDataAvailable: (x: number) => x === 0,
    requestTileGeometry: async () => { calls++; return zeroTerrain; },
  } as unknown as Cesium.CesiumTerrainProvider);
  const positions = [Cesium.Cartographic.fromDegrees(-90, 0, 999), Cesium.Cartographic.fromDegrees(90, 0, 999)];
  const sampled = await Cesium.sampleTerrain(provider, 0, positions, false);
  assert.equal(sampled, positions);
  assert.equal(sampled[0].height, 0, 'Zero is valid measured terrain, not a failed sample');
  assert.equal(sampled[1].height, undefined, 'Missing tile must not turn into height zero');
  assert.equal(calls, 1);
  await assert.rejects(Cesium.sampleTerrain(provider, 0, [Cesium.Cartographic.fromDegrees(90, 0)], true), Cesium.RuntimeError);
  assert.equal(calls, 1);
});

test('provider construction is shared, failed loads retry, and loaded error events disable retries', async () => {
  const originalFromUrl = Cesium.CesiumTerrainProvider.fromUrl;
  let constructions = 0;
  let finish!: (provider: Cesium.CesiumTerrainProvider) => void;
  const deferred = new Promise<Cesium.CesiumTerrainProvider>((resolve) => { finish = resolve; });
  const provider = {
    errorEvent: new Cesium.Event(),
    getTileDataAvailable: () => false,
    requestTileGeometry: () => { throw new Error('No network request expected'); },
  } as unknown as Cesium.CesiumTerrainProvider;
  Cesium.CesiumTerrainProvider.fromUrl = async (url, options) => {
    constructions++;
    assert.equal(url, './offline-terrain');
    assert.deepEqual(options, { requestVertexNormals: false, requestWaterMask: false, requestMetadata: false });
    if (constructions === 1) throw new Error('Fixture layer load failed');
    return deferred;
  };
  try {
    const failed = getOfflineTerrainProvider();
    assert.equal(getOfflineTerrainProvider(), failed);
    await assert.rejects(failed, /Fixture layer load failed/);
    assert.equal(constructions, 1);
    const retry = getOfflineTerrainProvider();
    assert.equal(getOfflineTerrainProvider(), retry);
    assert.equal(constructions, 2);
    finish(provider);
    assert.equal(await retry, provider);
    assert.equal(getOfflineTerrainProvider(), retry, 'Reuse after successful construction');
    assert.equal(constructions, 2);
    const error = { retry: true };
    provider.errorEvent.raiseEvent(error);
    assert.equal(error.retry, false);
    await assert.rejects(provider.requestTileGeometry(1, 2, 3)!, Cesium.RuntimeError);
  } finally {
    Cesium.CesiumTerrainProvider.fromUrl = originalFromUrl;
  }
});

test('current local pack rejects all 52 logged missing tiles without HTTP while retaining advertised terrain', async (context) => {
  const directory = path.resolve('public/offline-terrain');
  const layerPath = path.join(directory, 'layer.json');
  if (!fs.existsSync(layerPath)) { context.skip('Local terrain pack is not installed'); return; }
  const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
  const originalFetchJson = Cesium.Resource.prototype.fetchJson;
  let jsonReads = 0;
  Cesium.Resource.prototype.fetchJson = async function () {
    assert.equal(this.url, 'https://current-local-terrain.invalid/layer.json');
    jsonReads++;
    return layer;
  };
  try {
    const provider = await Cesium.CesiumTerrainProvider.fromUrl('https://current-local-terrain.invalid', { requestMetadata: false });
    let advertised = 0;
    layer.available.forEach((ranges: Array<{ startX: number; endX: number; startY: number; endY: number }>, level: number) => {
      for (const range of ranges) for (let x = range.startX; x <= range.endX; x++) for (let tmsY = range.startY; tmsY <= range.endY; tmsY++) {
        assert.equal(fs.existsSync(path.join(directory, `${level}/${x}/${tmsY}.terrain`)), true);
        assert.equal(provider.getTileDataAvailable(x, 2 ** level - 1 - tmsY, level), true);
        advertised++;
      }
    });
    assert.ok(advertised > 0);
    assert.equal(provider.hasMetadata, false);
    let geometryRequests = 0;
    provider.requestTileGeometry = () => { geometryRequests++; throw new Error('Missing tiles must never reach HTTP'); };
    guardOfflineTerrainRequests(provider);
    const positions: Cesium.Cartographic[] = [];
    for (let x = 824; x <= 827; x++) for (let tmsY = 295; tmsY <= 307; tmsY++) {
      const cesiumY = 2 ** 9 - 1 - tmsY;
      assert.equal(fs.existsSync(path.join(directory, `9/${x}/${tmsY}.terrain`)), false);
      assert.equal(provider.getTileDataAvailable(x, cesiumY, 9), false);
      assert.equal(provider.loadTileDataAvailability(x, cesiumY, 9), undefined);
      positions.push(Cesium.Rectangle.center(provider.tilingScheme.tileXYToRectangle(x, cesiumY, 9)));
    }
    const sampled = await Cesium.sampleTerrain(provider, 9, positions, false);
    assert.equal(sampled.length, 52);
    assert.ok(sampled.every(position => position.height === undefined));
    assert.equal(geometryRequests, 0);
    assert.equal(jsonReads, 1);
    console.log(`Current pack: ${advertised} available tiles preserved; ${sampled.length} missing log tiles rejected without HTTP.`);
  } finally {
    Cesium.Resource.prototype.fetchJson = originalFetchJson;
  }
});
