/** Run: node node_modules/jiti/lib/jiti-cli.mjs docs/verify-radar-terrain-mask.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RadarCoverageVolume, RadarTerrainGrid } from '../src/types/radarVolume';
import {
  buildRadarTerrainMaskData,
  sampleRadarTerrainMaskData,
} from '../src/utils/radarTerrainMask';

function fixture(
  distances: number[],
  terrainAt: (azimuthDeg: number, distanceM: number) => number,
  visibleAt = terrainAt,
  azimuthCount = 180
): RadarCoverageVolume {
  const azimuthSamples = Array.from({ length: azimuthCount }, (_, index) => index * 360 / azimuthCount);
  const terrainGrid: RadarTerrainGrid = {
    azimuthSamples, sampleDistances: distances,
    terrainHeights: Float32Array.from(azimuthSamples.flatMap((az) => distances.map((dist) => terrainAt(az, dist)))),
    minimumVisibleHeights: Float32Array.from(azimuthSamples.flatMap((az) => distances.map((dist) => visibleAt(az, dist)))),
  };
  return {
    terrainStatus: 'loaded', terrainGrid, maxRangeKm: distances.at(-1)! / 1000,
    radarAltM: 66, antennaHeightAGL: 25,
  } as RadarCoverageVolume;
}

test('a ridge between visible mesh-corner azimuths still clips the face interior', () => {
  const distances = [250, 500, 750, 1000, 1500, 2000];
  const earthRadiusM = 6371000 * (4 / 3);
  const ridgeHeightM = 900;
  const ridgeRangeM = 1000;
  const obstacleTan = (ridgeHeightM - 66 - ridgeRangeM ** 2 / (2 * earthRadiusM)) / ridgeRangeM;
  const terrainAt = (az: number, dist: number) => az === 4 && dist === ridgeRangeM ? ridgeHeightM : 0;
  const visibleAt = (az: number, dist: number) => az === 4 && dist >= ridgeRangeM
    ? 66 + obstacleTan * dist + dist ** 2 / (2 * earthRadiusM) : 0;
  const mask = buildRadarTerrainMaskData(fixture(distances, terrainAt, visibleAt))!;
  const targetHeightM = 500;
  assert.ok(sampleRadarTerrainMaskData(mask, 0, 1500).minimumVisibleHeightM < targetHeightM);
  assert.ok(sampleRadarTerrainMaskData(mask, 10, 1500).minimumVisibleHeightM < targetHeightM);
  assert.ok(sampleRadarTerrainMaskData(mask, 4, 1500).minimumVisibleHeightM > targetHeightM);
  assert.equal(sampleRadarTerrainMaskData(mask, 4, 1500).terrainHeightM, 0,
    'The hidden point is above sea; LOS shadow and physical ground are distinct');
});

test('an irregular radial peak cannot disappear between clear uniform texture endpoints', () => {
  const distances = [250, 500, 600, 650, 750, 1000];
  const terrainAt = (_az: number, dist: number) => dist === 600 ? 900 : 0;
  const mask = buildRadarTerrainMaskData(fixture(distances, terrainAt))!;
  assert.equal(terrainAt(0, 500), 0);
  assert.equal(terrainAt(0, 750), 0);
  assert.equal(sampleRadarTerrainMaskData(mask, 1, 600).terrainHeightM, 900);
  assert.equal(sampleRadarTerrainMaskData(mask, 1, 1000).terrainHeightM, 0);
});

test('azimuth interpolation wraps from the last row back to north', () => {
  const mask = buildRadarTerrainMaskData(fixture([250, 500, 750, 1000], (az) => az === 0 ? 700 : 0))!;
  assert.equal(sampleRadarTerrainMaskData(mask, 359, 1000).minimumVisibleHeightM, 700);
  assert.deepEqual(sampleRadarTerrainMaskData(mask, -1, 1000), sampleRadarTerrainMaskData(mask, 359, 1000));
  assert.deepEqual(sampleRadarTerrainMaskData(mask, 360, 1000), sampleRadarTerrainMaskData(mask, 0, 1000));
  assert.equal(sampleRadarTerrainMaskData(mask, 180, 1000).minimumVisibleHeightM, 0);
});

test('measured sea at zero metres is usable data, while unavailable DEM has no atlas', () => {
  const volume = fixture([250, 500, 750, 1000], () => 0);
  const mask = buildRadarTerrainMaskData(volume)!;
  assert.ok(mask);
  assert.deepEqual(sampleRadarTerrainMaskData(mask, 20, 1000), { minimumVisibleHeightM: 0, terrainHeightM: 0 });
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainStatus: 'flat_fallback' }), null);
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainStatus: 'sampling_error' }), null);
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainGrid: undefined }), null);
});

test('RG16 packing rounds upward, handles negative heights, and keeps every alpha opaque', () => {
  const values = [-200.5, 12.1, 100000, -5000];
  const volume = fixture([250, 500, 750, 1000], (az) => values[az / 90], undefined, 4);
  const mask = buildRadarTerrainMaskData(volume)!;
  const decodeRow = (row: number) => {
    const offset = (row * mask.width + mask.width - 1) * 4;
    return mask.heightOffsetM + mask.pixels[offset] * 256 + mask.pixels[offset + 1];
  };
  assert.equal(decodeRow(0), -200);
  assert.equal(decodeRow(1), 13);
  assert.equal(decodeRow(2), 64511);
  assert.equal(decodeRow(3), -1024);
  for (let index = 0; index < mask.pixels.length; index += 4) {
    assert.equal(mask.pixels[index + 2], 0);
    assert.equal(mask.pixels[index + 3], 255);
  }
});

test('the texture contains the origin and exact range, and caps large-radar width', () => {
  const mask = buildRadarTerrainMaskData(fixture([250, 500, 750, 1001], () => 0))!;
  assert.equal(mask.radialStepM * (mask.width - 1), 1001);
  assert.equal(sampleRadarTerrainMaskData(mask, 45, 0).terrainHeightM, 41);
  const large = buildRadarTerrainMaskData(fixture([250, 300000, 600000], () => 0))!;
  assert.equal(large.width, 1201);
  assert.equal(large.height, large.azimuthCount * 2);
  assert.equal(large.rangeM, 600000);
});

test('malformed source grids cannot be advertised as measured mask data', () => {
  const volume = fixture([250, 500, 750, 1000], () => 0);
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainGrid: {
    ...volume.terrainGrid!, minimumVisibleHeights: new Float32Array([Number.NaN]),
  } }), null);
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainGrid: {
    ...volume.terrainGrid!, sampleDistances: [250, 250, 750, 1000],
  } }), null);
  assert.equal(buildRadarTerrainMaskData({ ...volume, terrainGrid: {
    ...volume.terrainGrid!, azimuthSamples: volume.terrainGrid!.azimuthSamples.map((az, index) => index === 0 ? NaN : az),
  } }), null);
});
