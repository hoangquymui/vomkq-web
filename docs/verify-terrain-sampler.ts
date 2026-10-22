/** Run with: node node_modules/jiti/lib/jiti-cli.mjs docs/verify-terrain-sampler.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { sampleTerrainOptimized } from '../src/utils/terrainSampler';

function constantTile(height: number): Cesium.HeightmapTerrainData {
  return new Cesium.HeightmapTerrainData({
    buffer: new Float32Array([height, height, height, height]), width: 2, height: 2,
  });
}

test('mixed DEM availability samples each point at its own level and preserves order and measured zero', async () => {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const requests: { level: number; longitude: number; latitude: number }[] = [];
  const provider = {
    tilingScheme,
    availability: { computeMaximumLevelAtPosition: (position: Cesium.Cartographic) => position.longitude < 0 ? 3 : 1 },
    getTileDataAvailable(x: number, y: number, level: number) {
      const center = Cesium.Rectangle.center(tilingScheme.tileXYToRectangle(x, y, level));
      return level <= (center.longitude < 0 ? 3 : 1);
    },
    async requestTileGeometry(x: number, y: number, level: number) {
      assert.equal(this.getTileDataAvailable(x, y, level), true, 'Never request a tile known to be missing');
      const center = Cesium.Rectangle.center(tilingScheme.tileXYToRectangle(x, y, level));
      requests.push({ level, longitude: center.longitude, latitude: center.latitude });
      return constantTile(center.longitude < 0 ? 1600 : center.latitude < 0 ? -12 : 0);
    },
  } as unknown as Cesium.TerrainProvider;
  const positions = [
    Cesium.Cartographic.fromDegrees(90, 20),
    Cesium.Cartographic.fromDegrees(-90, 20),
    Cesium.Cartographic.fromDegrees(80, -45),
  ];
  const heights = await sampleTerrainOptimized(provider, -90, 20, positions, 3, 1);
  assert.deepEqual(heights, [0, 1600, -12]);
  assert.ok(requests.some((request) => request.level === 3));
  assert.ok(requests.filter((request) => request.longitude >= 0).every((request) => request.level === 1));
});

test('a silently missing fine tile retries an available parent while retaining successful fine samples', async () => {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const requests: string[] = [];
  const provider = {
    tilingScheme,
    availability: { computeMaximumLevelAtPosition: () => 3 },
    getTileDataAvailable: (_x: number, _y: number, level: number) => level === 3 || level === 1,
    async requestTileGeometry(x: number, y: number, level: number) {
      const west = Cesium.Rectangle.center(tilingScheme.tileXYToRectangle(x, y, level)).longitude < 0;
      requests.push(`${west ? 'west' : 'east'}:${level}`);
      if (!west && level === 3) throw new Cesium.RuntimeError('Fixture fine tile is absent');
      return constantTile(west ? 1250 : 740);
    },
  } as unknown as Cesium.TerrainProvider;
  const positions = [Cesium.Cartographic.fromDegrees(-90, 20, 999), Cesium.Cartographic.fromDegrees(90, 20, 999)];
  assert.deepEqual(await sampleTerrainOptimized(provider, -90, 20, positions, 3), [1250, 740]);
  assert.deepEqual(requests, ['west:3', 'east:3', 'east:1']);
});

test('a point with no available parent fails explicitly instead of becoming zero terrain', async () => {
  let requests = 0;
  const provider = {
    tilingScheme: new Cesium.GeographicTilingScheme(),
    availability: { computeMaximumLevelAtPosition: () => -1 },
    getTileDataAvailable: () => false,
    requestTileGeometry: async () => { requests++; return constantTile(0); },
  } as unknown as Cesium.TerrainProvider;
  await assert.rejects(
    sampleTerrainOptimized(provider, 108, 16, [Cesium.Cartographic.fromDegrees(108, 16, 999)], 9),
    /Terrain height unavailable for 1 sample/,
  );
  assert.equal(requests, 0);
});

test('network failure at every available parent cannot return stale input heights', async () => {
  const requestedLevels: number[] = [];
  const provider = {
    tilingScheme: new Cesium.GeographicTilingScheme(),
    getTileDataAvailable: () => true,
    requestTileGeometry: async (_x: number, _y: number, level: number) => {
      requestedLevels.push(level);
      throw new Cesium.RuntimeError('Fixture requests fail');
    },
  } as unknown as Cesium.TerrainProvider;
  await assert.rejects(
    sampleTerrainOptimized(provider, 108, 16, [Cesium.Cartographic.fromDegrees(108, 16, 999)], 2),
    /Terrain height unavailable/,
  );
  assert.deepEqual(requestedLevels, [2, 1, 0]);
});
