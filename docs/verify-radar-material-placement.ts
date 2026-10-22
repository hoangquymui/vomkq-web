/** Run with: node node_modules/jiti/lib/jiti-cli.mjs docs/verify-radar-material-placement.ts */
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import type { RadarCoverageVolume } from '../src/types/radarVolume';
import {
  createRadarDomeMaterial,
  createRadarOccludedMaterial,
  RADAR_DOME_MATERIAL_TYPE,
  releaseRadarDomeMaterial,
  updateRadarDomeMaterials,
} from '../src/utils/radarDomeMaterial';

// Exercise Cesium's real Fabric constructor and the production canvas path.
// A GL context is unnecessary for uniform validation and camera matrix binding.
class CanvasFixture {
  width = 0;
  height = 0;
  image: { data: Uint8ClampedArray } | undefined;
  getContext(kind: string) {
    assert.equal(kind, '2d');
    return {
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: { data: Uint8ClampedArray }) => { this.image = image; },
    };
  }
}
const globals = globalThis as unknown as Record<string, unknown>;
globals.HTMLCanvasElement = CanvasFixture;
for (const name of ['HTMLImageElement', 'HTMLVideoElement', 'ImageBitmap', 'OffscreenCanvas']) {
  globals[name] ??= class {};
}
let canvasCount = 0;
globals.document = {
  createElement: (tag: string) => {
    assert.equal(tag, 'canvas');
    canvasCount++;
    return new CanvasFixture();
  },
};

const azimuths = [0, 90, 180, 270];
const distances = [250, 500, 1000];
function makeVolume(id: number): RadarCoverageVolume {
  return {
    radarId: `placement-${id}`, radarName: 'Placement fixture', calculatedAt: id, cacheKey: `placement-${id}`,
    radarLat: 16 + id * 0.01, radarLon: 108 + id * 0.02,
    radarAltM: 66 + id, antennaHeightAGL: 25,
    minElevationDeg: 0, maxElevationDeg: 30, maxRangeKm: 1, coverageHeightKm: 1,
    altitudeBands: [50, 200], azimuthSamples: azimuths,
    nominalRanges: [], effectiveRanges: [], innerConeRadii: [], visibilityStates: [], bandInfos: [],
    terrainStatus: 'loaded', calculationState: 'READY', totalSamples: 12, terrainLimitedCount: 4, coverageRatioPercent: 67,
    terrainGrid: {
      azimuthSamples: azimuths, sampleDistances: distances,
      terrainHeights: Float32Array.from([41, 41, 41, 41, 300, 41, 41, 41, 41, 41, 41, 41]),
      minimumVisibleHeights: Float32Array.from([41, 41, 41, 41, 300, 550, 41, 41, 41, 41, 41, 41]),
    },
  };
}

const baseParams = {
  baseColor: Cesium.Color.GREEN.withAlpha(0.3), rimColor: Cesium.Color.YELLOW,
  rimPower: 2, scanLineCount: 14, scanLineSpeed: 0.6,
};

function assertMatrix(actual: number[], expected: Cesium.Matrix4, description: string) {
  assert(Array.isArray(actual) && actual.length === 16, `${description}: uniform must remain a numeric mat4 array`);
  for (let index = 0; index < 16; index++) {
    assert(Number.isFinite(actual[index]), `${description}: matrix element ${index} must be finite`);
    assert(Math.abs(actual[index] - expected[index]) < 1e-8, `${description}: matrix element ${index} differs`);
  }
}

function assertMatrixBinding(material: Cesium.Material, uniformName: string, expected: Cesium.Matrix4) {
  const bindings = (material as unknown as { _uniforms: Record<string, () => unknown> })._uniforms;
  const generatedName = Object.keys(bindings).find((name) => name.startsWith(`${uniformName}_`));
  assert(generatedName, `${uniformName}: Cesium must generate a GPU uniform binding`);
  const bound = bindings[generatedName]();
  assert(bound instanceof Cesium.Matrix4, `${uniformName}: Cesium must bind the value as mat4`);
  assertMatrix(Cesium.Matrix4.toArray(bound), expected, `${uniformName} bound value`);
}

const live: Cesium.Material[] = [];
try {
  const nominalFirst = createRadarDomeMaterial(baseParams);
  live.push(nominalFirst);
  assert.equal(nominalFirst.uniforms.u_maskMode, 0);

  // Reproduce the original construction against the registered cache. Cesium's
  // deep Fabric merge turns an overriding mat4 array into a generic object.
  const evidenceFrame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(108, 16, 66));
  assert.throws(() => new Cesium.Material({
    fabric: {
      type: RADAR_DOME_MATERIAL_TYPE,
      uniforms: { u_radarToWorld: Cesium.Matrix4.toArray(evidenceFrame) },
    },
  }), (error: unknown) => {
    const message = String(error);
    assert.match(message, /uniform 'u_radarToWorld' has invalid type/);
    console.log(`PASS: reproduced prior production failure: ${message.split('\n', 1)[0]}`);
    return true;
  });

  for (let placement = 0; placement < 3; placement++) {
    const volume = makeVolume(placement);
    const exaggeration = placement === 1 ? 2 : 1;
    const relativeHeightM = placement === 1 ? 100 : 0;
    const displayRadarHeightM = (volume.radarAltM - relativeHeightM) * exaggeration + relativeHeightM;
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(volume.radarLon, volume.radarLat, displayRadarHeightM));
    const terrainMask = {
      volume, modelMatrix: frame, verticalExaggeration: exaggeration,
      verticalExaggerationRelativeHeight: relativeHeightM,
    };

    // These exact production constructor calls previously threw:
    // DeveloperError: fabric: uniform 'u_radarToWorld' has invalid type.
    const coverage = createRadarDomeMaterial({ ...baseParams, terrainMask });
    live.push(coverage);
    const shadow = createRadarOccludedMaterial(0.2, terrainMask);
    live.push(shadow);
    const repeated = createRadarDomeMaterial({ ...baseParams, terrainMask });
    live.push(repeated);
    assert.equal(coverage.uniforms.u_maskMode, 1);
    assert.equal(shadow.uniforms.u_maskMode, 2);
    assert.equal(repeated.uniforms.u_maskMode, 1);
    assert.equal(coverage.uniforms.u_terrainMask, shadow.uniforms.u_terrainMask);
    assert.equal(coverage.uniforms.u_terrainMask, repeated.uniforms.u_terrainMask);
    const canvas = coverage.uniforms.u_terrainMask as CanvasFixture;
    assert(canvas instanceof CanvasFixture && canvas.width > 1 && canvas.height === 8);
    assert(canvas.image && canvas.image.data.length === canvas.width * canvas.height * 4);

    for (const material of [coverage, shadow, repeated]) {
      assertMatrix(material.uniforms.u_radarToWorld, frame, 'Placement radar-to-world');
      assertMatrixBinding(material, 'u_radarToWorld', frame);
      assert.equal(material.uniforms.u_verticalExaggeration, exaggeration);
      assert.equal(material.uniforms.u_exaggerationRelativeHeight, relativeHeightM);
      assert.match(material.shaderSource, /uniform mat4 u_radarToWorld/);
      assert.match(material.shaderSource, /uniform mat4 u_eyeToRadar/);
    }

    const worldToRadar = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4());
    for (const cameraOffsetM of [0, 12345]) {
      const inverseView = Cesium.Matrix4.fromTranslation(
        new Cesium.Cartesian3(6400000 + cameraOffsetM, 250000 + cameraOffsetM, 1750000 - cameraOffsetM));
      const expectedEyeToRadar = Cesium.Matrix4.multiply(worldToRadar, inverseView, new Cesium.Matrix4());
      const time = 123.5 + cameraOffsetM;
      updateRadarDomeMaterials(time, inverseView);
      for (const material of [coverage, shadow, repeated]) {
        assert.equal(material.uniforms.u_time, time);
        assertMatrix(material.uniforms.u_eyeToRadar, expectedEyeToRadar, 'Placement camera-to-radar');
        assertMatrixBinding(material, 'u_eyeToRadar', expectedEyeToRadar);
      }
    }
    console.log(`PASS: masked coverage, shadow, repeated placement, camera/time updates (${exaggeration}x)`);
  }

  const nominalLast = createRadarDomeMaterial(baseParams);
  live.push(nominalLast);
  assert.equal(nominalLast.uniforms.u_maskMode, 0, 'Masked placement must not mutate nominal defaults');
  assertMatrix(nominalLast.uniforms.u_radarToWorld, Cesium.Matrix4.IDENTITY, 'Nominal radar-to-world');
  assert.equal(canvasCount, 3, 'Coverage and shadow must reuse one canvas for each volume');

  const released = live.shift()!;
  const previousTime = released.uniforms.u_time;
  releaseRadarDomeMaterial(released);
  assert(released.isDestroyed());
  updateRadarDomeMaterials(999);
  assert.equal(released.uniforms.u_time, previousTime, 'Released materials must leave the frame ticker');
  console.log('PASS: nominal defaults, atlas reuse, and material release');
} finally {
  for (const material of live) {
    if (!material.isDestroyed()) releaseRadarDomeMaterial(material);
  }
}
