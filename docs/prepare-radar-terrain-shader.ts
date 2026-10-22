/** Prepare the real Cesium material shader for the offscreen GL regression. */
import fs from 'node:fs';
import * as Cesium from 'cesium';
import { createRadarDomeMaterial } from '../src/utils/radarDomeMaterial';
import { buildRadarTerrainMaskData } from '../src/utils/radarTerrainMask';
import { destinationPoint } from '../src/utils/radarLosEngine';
import type { RadarCoverageVolume } from '../src/types/radarVolume';

const azimuths = Array.from({ length: 180 }, (_, index) => index * 2);
const distances = [250, 10000, 20000, 20250];
const volume: RadarCoverageVolume = {
  radarId: 'fragment-regression', radarName: 'Fixture', calculatedAt: 0, cacheKey: 'fixture',
  radarLat: 16, radarLon: 108, radarAltM: 66, antennaHeightAGL: 25,
  minElevationDeg: 0, maxElevationDeg: 30, maxRangeKm: 20.25, coverageHeightKm: 1,
  altitudeBands: [50, 200], azimuthSamples: azimuths,
  nominalRanges: [], effectiveRanges: [], innerConeRadii: [], visibilityStates: [], bandInfos: [],
  terrainStatus: 'loaded', calculationState: 'READY', totalSamples: 0, terrainLimitedCount: 0, coverageRatioPercent: 0,
  terrainGrid: {
    azimuthSamples: azimuths, sampleDistances: distances,
    terrainHeights: new Float32Array(azimuths.length * distances.length),
    minimumVisibleHeights: new Float32Array(azimuths.length * distances.length),
  },
};
for (let radial = 0; radial < distances.length; radial++) {
  volume.terrainGrid!.minimumVisibleHeights[2 * distances.length + radial] = 700;
}
const data = buildRadarTerrainMaskData(volume)!;
// Cesium's uniform type checks reference browser DOM constructors. No DOM is
// used for this fixture; the atlas is supplied directly to the offscreen GPU.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  (globalThis as unknown as Record<string, unknown>)[name] ??= class {};
}
const material = createRadarDomeMaterial({
  baseColor: Cesium.Color.GREEN.withAlpha(0.3), rimColor: Cesium.Color.YELLOW,
  rimPower: 2, scanLineCount: 0, scanLineSpeed: 0,
});
const scenarios = [1, 2].map((exaggeration) => {
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(volume.radarLon, volume.radarLat, volume.radarAltM * exaggeration));
  const inverse = Cesium.Matrix4.inverseTransformation(matrix, new Cesium.Matrix4());
  const endpoints = [0, 8].map((azimuth) => {
    const destination = destinationPoint(volume.radarLat, volume.radarLon, 20000, azimuth);
    const world = Cesium.Cartesian3.fromDegrees(destination.lon, destination.lat, 200 * exaggeration);
    const local = Cesium.Matrix4.multiplyByPoint(inverse, world, new Cesium.Cartesian3());
    return [local.x, local.y, local.z];
  });
  return { exaggeration, radarToWorld: Array.from(Cesium.Matrix4.toArray(matrix)), endpoints };
});
fs.mkdirSync('scratch/radar-terrain-shader', { recursive: true });
fs.writeFileSync('scratch/radar-terrain-shader/fixture.json', JSON.stringify({
  shader: material.shaderSource,
  radarLongitude: Cesium.Math.toRadians(volume.radarLon), radarLatitude: Cesium.Math.toRadians(volume.radarLat),
  data: { ...data, pixels: Buffer.from(data.pixels).toString('base64') }, scenarios,
}));
material.destroy();
console.log('Prepared actual Cesium shader, opaque mask, and 1x/2x display scenarios.');
