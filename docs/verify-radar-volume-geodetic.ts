/** Run with: npx tsx docs/verify-radar-volume-geodetic.ts */
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import type { RadarCoverageVolume } from '../src/types/radarVolume';
import {
  buildRadarVolumeGeometry,
  buildRadarOccludedVolumeGeometry,
  createRadarVolumeGeometryInstance,
  createRadarOccludedGeometryInstance,
} from '../src/utils/radarVolumeGeometry';
import type { RadarVolumeGeometry } from '../src/utils/radarVolumeGeometry';
import { destinationPoint } from '../src/utils/radarLosEngine';

const azimuthSamples = Array.from({ length: 72 }, (_, index) => index * 5);
const bands = [50, 500, 1000];
const volume: RadarCoverageVolume = {
  radarId: 'geodetic-test', radarName: 'Geodetic test', calculatedAt: 0, cacheKey: 'test',
  radarLat: 16.0225, radarLon: 108.1028, radarAltM: 66, antennaHeightAGL: 25,
  minElevationDeg: 0, maxElevationDeg: 30, maxRangeKm: 300, coverageHeightKm: 1,
  altitudeBands: bands, azimuthSamples,
  nominalRanges: bands.map(() => azimuthSamples.map(() => 300000)),
  effectiveRanges: bands.map(() => azimuthSamples.map(() => 120000)),
  innerConeRadii: [0.1, 750, 1750],
  visibilityStates: bands.map(() => azimuthSamples.map(() => 'TERRAIN_LIMITED')),
  bandInfos: [], terrainStatus: 'loaded', calculationState: 'READY',
  totalSamples: 216, terrainLimitedCount: 216, coverageRatioPercent: 0,
};

function worldVertex(geometry: RadarVolumeGeometry, index: number) {
  return Cesium.Matrix4.multiplyByPoint(geometry.modelMatrix,
    Cesium.Cartesian3.fromArray(geometry.positions, index * 3), new Cesium.Cartesian3());
}

function checkVertex(geometry: RadarVolumeGeometry, index: number, rangeM: number, az: number, altitudeM: number) {
  const recovered = Cesium.Cartographic.fromCartesian(worldVertex(geometry, index));
  const expected = destinationPoint(volume.radarLat, volume.radarLon, rangeM, az);
  assert(Math.abs(recovered.height - altitudeM) < 0.00001, 'Surface altitude must match the LOS target altitude');
  assert(Math.abs(recovered.latitude - Cesium.Math.toRadians(expected.lat)) < 1e-10);
  assert(Math.abs(recovered.longitude - Cesium.Math.toRadians(expected.lon)) < 1e-10);
}

function verifyBounds(geometry: RadarVolumeGeometry, occluded: boolean) {
  const instance = occluded ? createRadarOccludedGeometryInstance(geometry) : createRadarVolumeGeometryInstance(geometry);
  const sphere = (instance.geometry as Cesium.Geometry).boundingSphere;
  assert(sphere);
  for (let index = 0; index < geometry.vertexCount; index++) {
    const local = Cesium.Cartesian3.fromArray(geometry.positions, index * 3);
    assert(Cesium.Cartesian3.distance(local, sphere.center) <= sphere.radius + 0.00001,
      'The bounding sphere must contain vertices below the tangent plane');
  }
}

function verifyCaps(geometry: RadarVolumeGeometry, shellVertexCount: number, displayBands = bands) {
  let testedRadialEdges = 0;
  let testedTriangles = 0;
  for (let index = shellVertexCount; index < geometry.vertexCount; index++) {
    const altitude = Cesium.Cartographic.fromCartesian(worldVertex(geometry, index)).height;
    assert(Math.abs(altitude - displayBands[0]) < 0.00001 || Math.abs(altitude - displayBands[2]) < 0.00001);
  }
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const indices = Array.from(geometry.indices.subarray(offset, offset + 3));
    if (indices.some((index) => index < shellVertexCount)) continue;
    const vertices = indices.map((index) => worldVertex(geometry, index));
    const altitudeM = Cesium.Cartographic.fromCartesian(vertices[0]).height;
    for (let edge = 0; edge < 3; edge++) {
      const left = indices[edge];
      const right = indices[(edge + 1) % 3];
      if (Math.abs(right - left) !== azimuthSamples.length) continue;
      const lengthM = Cesium.Cartesian3.distance(vertices[edge], vertices[(edge + 1) % 3]);
      assert(lengthM < 2020, 'Radial cap edges must be about 2 km or shorter');
      const midpoint = Cesium.Cartesian3.midpoint(vertices[edge], vertices[(edge + 1) % 3], new Cesium.Cartesian3());
      assert(Math.abs(Cesium.Cartographic.fromCartesian(midpoint).height - altitudeM) < 0.1,
        'Radial chord sag must remain below 10 cm');
      testedRadialEdges++;
    }
    const centroid = new Cesium.Cartesian3(
      (vertices[0].x + vertices[1].x + vertices[2].x) / 3,
      (vertices[0].y + vertices[1].y + vertices[2].y) / 3,
      (vertices[0].z + vertices[1].z + vertices[2].z) / 3);
    const maxEdgeM = Math.max(...vertices.map((vertex, edge) => Cesium.Cartesian3.distance(vertex, vertices[(edge + 1) % 3])));
    const angularChordToleranceM = maxEdgeM * maxEdgeM / (6 * 6300000) + 0.1;
    assert(Math.abs(Cesium.Cartographic.fromCartesian(centroid).height - altitudeM) < angularChordToleranceM,
      'Cap triangles must respect the remaining angular chord tolerance');
    testedTriangles++;
  }
  assert(testedRadialEdges > 0 && testedTriangles > 0);
}

for (const mode of ['nominal', 'terrain-aware'] as const) {
  const geometry = buildRadarVolumeGeometry(volume, { mode });
  assert(geometry);
  for (let band = 0; band < bands.length; band++) {
    for (let az = 0; az < azimuthSamples.length; az++) {
      checkVertex(geometry, band * 72 + az, mode === 'nominal' ? 300000 : 120000, azimuthSamples[az], bands[band]);
      checkVertex(geometry, bands.length * 72 + band * 72 + az,
        volume.innerConeRadii[band], azimuthSamples[az], bands[band]);
    }
  }
  assert(geometry.positions[2] < 0, 'A band below the antenna must remain below it');
  verifyBounds(geometry, false);
  verifyCaps(geometry, bands.length * 72 * 2);
  console.log(`PASS: ${mode} geodetic vertices, curved caps, and bounds`);
}

const shadow = buildRadarOccludedVolumeGeometry(volume, { mode: 'terrain-aware' });
assert(shadow);
for (let band = 0; band < bands.length; band++) {
  for (let az = 0; az < 72; az++) {
    checkVertex(shadow, band * 72 + az, 120000, azimuthSamples[az], bands[band]);
    checkVertex(shadow, bands.length * 72 + band * 72 + az, 300000, azimuthSamples[az], bands[band]);
  }
}
verifyBounds(shadow, true);
verifyCaps(shadow, bands.length * 72 * 2);
console.log('PASS: occluded geodetic vertices, curved caps, and bounds');

const withoutCone = buildRadarVolumeGeometry(volume, { mode: 'nominal', showInnerCone: false });
assert(withoutCone);
verifyCaps(withoutCone, bands.length * 72);
checkVertex(withoutCone, bands.length * 72, 0, azimuthSamples[0], bands[2]);
console.log('PASS: caps close the center when the inner cone is hidden');

const blocked: RadarCoverageVolume = {
  ...volume,
  innerConeRadii: bands.map(() => 2000),
  effectiveRanges: bands.map(() => azimuthSamples.map(() => 500)),
};
assert.equal(buildRadarVolumeGeometry(blocked, { mode: 'terrain-aware' }), null);
assert.equal(buildRadarVolumeGeometry(blocked, { mode: 'terrain-aware', selectedAltitudeM: 50 }), null);
const outsideEnvelope = { ...blocked, nominalRanges: bands.map(() => azimuthSamples.map(() => 500)) };
assert.equal(buildRadarVolumeGeometry(outsideEnvelope, { mode: 'nominal' }), null);
console.log('PASS: blocked and outside-envelope rings create no phantom volume');

const partiallyBlocked: RadarCoverageVolume = {
  ...blocked,
  effectiveRanges: bands.map(() => azimuthSamples.map((az) => az < 90 ? 500 : 120000)),
};
const clipped = buildRadarVolumeGeometry(partiallyBlocked, { mode: 'terrain-aware' });
assert(clipped);
for (let band = 0; band < bands.length; band++) {
  for (let az = 0; az < 18; az++) {
    checkVertex(clipped, bands.length * 72 + band * 72 + az, 500, azimuthSamples[az], bands[band]);
  }
}
console.log('PASS: empty sectors collapse the cone onto the terrain-limited boundary');

const lowSlice = buildRadarVolumeGeometry(volume, { mode: 'nominal', selectedAltitudeM: 10 });
assert(lowSlice);
const lowSliceAltitudes = Array.from({ length: lowSlice.vertexCount }, (_, index) =>
  Cesium.Cartographic.fromCartesian(worldVertex(lowSlice, index)).height);
assert(Math.max(...lowSliceAltitudes) <= 10.00001);
assert(Math.min(...lowSliceAltitudes) < 10);
console.log('PASS: below-first-band slices have ordered base and top altitudes');

// Apply the same display transform as Cesium terrain; LOS inputs remain physical MSL.
for (const relativeHeightM of [0, 100]) {
  const toDisplayHeight = (rawHeightM: number) => (rawHeightM - relativeHeightM) * 2 + relativeHeightM;
  const displayBands = bands.map(toDisplayHeight);
  for (const occluded of [false, true]) {
    const options = {
      mode: 'terrain-aware' as const,
      verticalExaggeration: 2,
      verticalExaggerationRelativeHeight: relativeHeightM,
    };
    const geometry = occluded
      ? buildRadarOccludedVolumeGeometry(volume, options)
      : buildRadarVolumeGeometry(volume, options);
    assert(geometry);
    const centerHeightM = Cesium.Cartographic.fromCartesian(geometry.center).height;
    assert(Math.abs(centerHeightM - toDisplayHeight(volume.radarAltM)) < 0.00001,
      'The ENU origin must share the terrain display altitude transform');
    for (let band = 0; band < bands.length; band++) {
      for (let az = 0; az < 72; az++) {
        checkVertex(geometry, band * 72 + az, 120000, azimuthSamples[az], displayBands[band]);
        checkVertex(geometry, bands.length * 72 + band * 72 + az,
          occluded ? 300000 : volume.innerConeRadii[band], azimuthSamples[az], displayBands[band]);
      }
    }
    verifyCaps(geometry, bands.length * 72 * 2, displayBands);
    verifyBounds(geometry, occluded);
  }
  assert.deepEqual(volume.altitudeBands, [50, 500, 1000], 'Display exaggeration must not mutate physical bands');
  assert.equal(volume.radarAltM, 66, 'Display exaggeration must not mutate physical antenna altitude');
  console.log(`PASS: coverage and shadow display exaggeration 2x relative to ${relativeHeightM} m`);
}
