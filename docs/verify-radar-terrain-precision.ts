/** Run: node node_modules/jiti/lib/jiti-cli.mjs docs/verify-radar-terrain-precision.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../src/types/equipment';
import { computeRadarCoverageVolume, generateVolumeCacheKey, sampleTerrainGridAndMasks } from '../src/utils/radarVolumeEngine';
import { calculateEarthBulgeMeters, EARTH_RADIUS_METERS } from '../src/utils/radarMath';

const radar: EquipmentInstance = {
  instanceId: 'terrain-precision', templateId: 'fixture', name: 'Fixture',
  category: 'RadarCanhGioi', latitude: 0, longitude: 0, altitude: 41,
  antennaHeightAGL: 25, rangeKm: 30, minElevationDeg: 0, maxElevationDeg: 30,
  coverageHeightKm: 1, scanSpeed: 1, color: '#06b6d4', status: 'Active',
  showDome: true, showSweep: false,
  altitudeDetectionTable: { headers: ['Altitude', 'Range'], rows: [{ altitudeM: 1000, val1: 30 }] },
};

function terrain(heightAt: (level: number, longitude: number, latitude: number) => number): Cesium.TerrainProvider {
  return {
    tilingScheme: new Cesium.GeographicTilingScheme(),
    availability: { computeMaximumLevelAtPosition: () => 13 },
    getTileDataAvailable: () => true,
    requestTileGeometry: async (_x: number, _y: number, level: number) => ({
      interpolateHeight: (_rectangle: Cesium.Rectangle, longitude: number, latitude: number) => heightAt(level, longitude, latitude),
    }),
  } as unknown as Cesium.TerrainProvider;
}

test('a 300 km radar retains nearby level 13 terrain while far samples use bounded lower levels', async () => {
  const grid = await sampleTerrainGridAndMasks(0, 0, 66, 300000, [0, 90], 6667,
    terrain((level, lon) => level * 100 + (lon > 0.00001 ? 1 : 0)));
  assert.equal(grid.terrainStatus, 'loaded');
  assert.ok(grid.terrainGrid);
  const retained = grid.terrainGrid;
  const stride = retained.sampleDistances.length;
  assert.equal(retained.terrainHeights.length, 2 * stride);
  for (const [distance, height] of [[250, 1300], [30000, 1300], [31000, 1100], [80000, 1100], [81000, 1000], [160000, 1000], [161000, 900], [300000, 900]]) {
    const index = retained.sampleDistances.indexOf(distance);
    assert.ok(index >= 0, `Missing required sample at ${distance} m`);
    assert.equal(retained.terrainHeights[index], height);
    assert.equal(retained.terrainHeights[stride + index], height + 1, 'Retained heights must remain azimuth-major');
  }
});

test('retained LOS height follows the prefix terrain horizon and uses raw physical MSL', async () => {
  const grid = await sampleTerrainGridAndMasks(0, 0, 66, 12000, [0, 90], 2000,
    terrain((_level, lon, lat) => Math.abs(lon) < 0.00001 && Math.abs(lat * EARTH_RADIUS_METERS - 5000) < 100 ? 900 : 0));
  assert.ok(grid.terrainGrid);
  const retained = grid.terrainGrid;
  const stride = retained.sampleDistances.length;
  const ridgeIndex = retained.sampleDistances.indexOf(5000);
  const shadowIndex = retained.sampleDistances.indexOf(10000);
  assert.equal(retained.minimumVisibleHeights[ridgeIndex], 900);
  const maskTan = (900 - 66 - calculateEarthBulgeMeters(5000)) / 5000;
  const expected = 66 + 10000 * maskTan + calculateEarthBulgeMeters(10000);
  assert.ok(Math.abs(retained.minimumVisibleHeights[shadowIndex] - expected) < 0.001);
  assert.ok(retained.minimumVisibleHeights[shadowIndex] > 1700, 'The shadow must keep rising behind the ridge');
  assert.ok(Math.abs(retained.minimumVisibleHeights[stride + shadowIndex]) < 0.001,
    'The opposite clear sector must not inherit another azimuth horizon');
  for (let index = 0; index < retained.terrainHeights.length; index++) {
    assert.ok(retained.minimumVisibleHeights[index] >= retained.terrainHeights[index]);
  }
});

test('default two-degree sampling detects a lateral ridge between former five-degree spokes', async () => {
  const ridgeAzimuthRad = 2 * Math.PI / 180;
  const ridgeEastM = 10000 * Math.sin(ridgeAzimuthRad);
  const ridgeNorthM = 10000 * Math.cos(ridgeAzimuthRad);
  const provider = terrain((_level, lon, lat) => {
    const eastM = lon * EARTH_RADIUS_METERS * Math.cos(lat / 2);
    const northM = lat * EARTH_RADIUS_METERS;
    return Math.hypot(eastM - ridgeEastM, northM - ridgeNorthM) < 100 ? 1400 : 0;
  });
  const params = { azimuthStepDeg: 5, customAltitudeBands: [1000] };
  const coarse = await computeRadarCoverageVolume(radar, provider, { ...params, terrainAzimuthStepDeg: 5 });
  assert.ok(coarse.visibilityStates[0].every((state) => state === 'VISIBLE'), 'Fixture peak falls between coarse spokes');
  const precise = await computeRadarCoverageVolume(radar, provider, params);
  assert.equal(precise.azimuthSamples.length, 180);
  assert.equal(precise.azimuthSamples[1], 2);
  assert.equal(precise.visibilityStates[0][1], 'TERRAIN_LIMITED');
  assert.ok(precise.effectiveRanges[0][1] < 10000);
  assert.ok(precise.terrainGrid);
  assert.deepEqual(precise.terrainGrid.azimuthSamples, precise.azimuthSamples);
  assert.notEqual(precise.cacheKey, coarse.cacheKey);
  assert.ok(precise.cacheKey.startsWith('vol_v3_'));
  assert.equal(generateVolumeCacheKey(radar, { ...params, terrainAzimuthStepDeg: 2 }, provider), precise.cacheKey);
});

test('unmeasured terrain has no retained grid for fragment clipping', async () => {
  const grid = await sampleTerrainGridAndMasks(0, 0, 66, 1000, [0], 2000, null);
  assert.equal(grid.terrainStatus, 'flat_fallback');
  assert.equal(grid.terrainGrid, undefined);
});
