/** Run: node node_modules/jiti/lib/jiti-cli.mjs docs/verify-radar-volume-terrain.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../src/types/equipment';
import {
  computeRadarCoverageVolume,
  generateVolumeCacheKey,
  invalidateVolumeCache,
  sampleTerrainGridAndMasks,
} from '../src/utils/radarVolumeEngine';
import { EARTH_RADIUS_METERS } from '../src/utils/radarMath';

const radar: EquipmentInstance = {
  instanceId: 'terrain-regression', templateId: 'fixture', name: 'Fixture',
  category: 'RadarCanhGioi', latitude: 0, longitude: 0, altitude: 41,
  antennaHeightAGL: 25, rangeKm: 30, minElevationDeg: 0.5, maxElevationDeg: 30,
  coverageHeightKm: 1, scanSpeed: 1, color: '#06b6d4', status: 'Active',
  showDome: true, showSweep: false,
  altitudeDetectionTable: {
    headers: ['Altitude', 'Range'],
    rows: [{ altitudeM: 100, val1: 30, val2: 30 }],
  },
};
const params = { azimuthStepDeg: 90, terrainAzimuthStepDeg: 90, radialStepMeters: 6667, customAltitudeBands: [100] };

// Exercise Cesium.sampleTerrain itself; only tile interpolation is synthetic.
function terrain(heightAt: (longitude: number, latitude: number) => number): Cesium.TerrainProvider {
  return {
    tilingScheme: new Cesium.GeographicTilingScheme(),
    getTileDataAvailable: () => true,
    requestTileGeometry: async () => ({
      interpolateHeight: (_rectangle: Cesium.Rectangle, longitude: number, latitude: number) => heightAt(longitude, latitude),
    }),
  } as unknown as Cesium.TerrainProvider;
}

test('a narrow nearby ridge cannot disappear between the former 6.7 km radial samples', async () => {
  invalidateVolumeCache();
  const provider = terrain((_lon, lat) => {
    const northM = lat * EARTH_RADIUS_METERS;
    return Math.abs(northM - 13250) <= 250 ? 900 : 0;
  });
  const volume = await computeRadarCoverageVolume(radar, provider, params);
  assert.equal(volume.terrainStatus, 'loaded');
  assert.equal(volume.visibilityStates[0][0], 'TERRAIN_LIMITED');
  assert.ok(volume.effectiveRanges[0][0] < 13250);
  assert.ok(volume.effectiveRanges[0][0] >= 12750, 'A distant ridge must not pull the foreground cutoff back to the radar');
  assert.equal(volume.visibilityStates[0][2], 'VISIBLE', 'The opposite azimuth remains unobstructed');
});

test('a below-horizontal terrain horizon still blocks targets below it', async () => {
  const elevatedRadar = {
    ...radar, instanceId: 'elevated-radar', altitude: 1000, antennaHeightAGL: 25,
    rangeKm: 300, minElevationDeg: 0,
    altitudeDetectionTable: { ...radar.altitudeDetectionTable!, rows: [{ altitudeM: 950, val1: 300, val2: 300 }] },
  };
  const provider = terrain((_lon, lat) => Math.abs(lat * EARTH_RADIUS_METERS - 5000) < 500 ? 900 : 0);
  const volume = await computeRadarCoverageVolume(elevatedRadar, provider, {
    ...params, customAltitudeBands: [950],
  });
  assert.equal(volume.visibilityStates[0][0], 'TERRAIN_LIMITED');
  assert.ok(volume.effectiveRanges[0][0] < volume.nominalRanges[0][0]);
});

test('an earlier ridge shadow takes precedence over a later local-ground crossing', async () => {
  const shadowCutoffM = 20050;
  const ridgeDistanceM = 5000;
  const equivalentEarthRadiusM = EARTH_RADIUS_METERS * (4 / 3);
  const targetDeltaM = 100 - (radar.altitude + radar.antennaHeightAGL!);
  const maskTan = targetDeltaM / shadowCutoffM - shadowCutoffM / (2 * equivalentEarthRadiusM);
  const ridgeHeightM = radar.altitude + radar.antennaHeightAGL!
    + maskTan * ridgeDistanceM + ridgeDistanceM ** 2 / (2 * equivalentEarthRadiusM);
  for (const groundHeightM of [100.1, 101]) {
    const provider = terrain((_lon, lat) => {
      const northM = lat * EARTH_RADIUS_METERS;
      if (Math.abs(northM - ridgeDistanceM) < 100) return ridgeHeightM;
      // Both weaker and stronger new local masks must preserve the prior ridge shadow.
      return northM >= 20249 ? groundHeightM : 0;
    });
    const volume = await computeRadarCoverageVolume({ ...radar, instanceId: 'shadow-before-ground' }, provider, params);
    assert.equal(volume.visibilityStates[0][0], 'TERRAIN_LIMITED');
    assert.ok(Math.abs(volume.effectiveRanges[0][0] - shadowCutoffM) <= 1,
      `Expected the 20.05 km shadow boundary, got ${volume.effectiveRanges[0][0]} m`);
  }
});

test('cache distinguishes absent, flat ellipsoid and measured terrain providers', async () => {
  invalidateVolumeCache();
  const missing = await computeRadarCoverageVolume(radar, null, params);
  assert.equal(missing.terrainStatus, 'flat_fallback');
  assert.ok(missing.visibilityStates.flat().every((state) => state === 'NO_DATA'));
  const ellipsoid = new Cesium.EllipsoidTerrainProvider();
  const flat = await computeRadarCoverageVolume(radar, ellipsoid, params);
  assert.equal(flat.terrainStatus, 'flat_fallback');
  const provider = terrain(() => 900);
  const measured = await computeRadarCoverageVolume(radar, provider, params);
  assert.equal(measured.terrainStatus, 'loaded');
  assert.notEqual(measured.cacheKey, missing.cacheKey);
  assert.notEqual(measured.cacheKey, flat.cacheKey);
  assert.equal(await computeRadarCoverageVolume(radar, provider, params), measured, 'Loaded provider cache is reusable');
  const secondProvider = terrain(() => 0);
  assert.notEqual(generateVolumeCacheKey(radar, params, secondProvider), measured.cacheKey);
  assert.equal((await computeRadarCoverageVolume(radar, secondProvider, params)).visibilityStates[0][0], 'VISIBLE');
});

test('unavailable DEM is NO_DATA and recovers on the same provider after a retry', async () => {
  let fails = true;
  const provider = terrain(() => {
    if (fails) throw new Cesium.RuntimeError('Fixture DEM unavailable');
    return 900;
  });
  const first = await computeRadarCoverageVolume(radar, provider, params);
  assert.equal(first.terrainStatus, 'sampling_error');
  assert.equal(first.calculationState, 'ERROR');
  assert.ok(first.visibilityStates.flat().every((state) => state === 'NO_DATA'));
  fails = false;
  const second = await computeRadarCoverageVolume(radar, provider, params);
  assert.equal(second.terrainStatus, 'loaded');
  assert.notEqual(second, first);
  assert.equal(second.visibilityStates[0][0], 'TERRAIN_LIMITED');
});

test('terrain sampling includes exact envelope ends and keeps radial gaps bounded', async () => {
  const grid = await sampleTerrainGridAndMasks(0, 0, 66, 50000, [0], 6667, terrain(() => 0), 4 / 3, [12345]);
  assert.ok(grid.sampleDistances.includes(12345));
  assert.equal(grid.sampleDistances.at(-1), 50000);
  for (let i = 1; i < grid.sampleDistances.length; i++) {
    assert.ok(grid.sampleDistances[i] > grid.sampleDistances[i - 1]);
    assert.ok(grid.sampleDistances[i] - grid.sampleDistances[i - 1] <= 1000);
  }
});
