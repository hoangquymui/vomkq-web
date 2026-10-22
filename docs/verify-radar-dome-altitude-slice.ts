/** Run with: npx tsx docs/verify-radar-dome-altitude-slice.ts */
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../src/utils/equipmentFactory';
import { computeRadarCoverageVolume } from '../src/utils/radarVolumeEngine';
import { buildRadarVolumeGeometry } from '../src/utils/radarVolumeGeometry';
import type { RadarVolumeGeometry } from '../src/utils/radarVolumeGeometry';

function verifySliceAltitude(geometry: RadarVolumeGeometry, expectedAltitudeM: number) {
  let maxAltitudeM = -Infinity;
  const local = new Cesium.Cartesian3();
  const world = new Cesium.Cartesian3();
  for (let index = 0; index < geometry.positions.length; index += 3) {
    Cesium.Cartesian3.fromArray(geometry.positions, index, local);
    Cesium.Matrix4.multiplyByPoint(geometry.modelMatrix, local, world);
    const altitudeM = Cesium.Cartographic.fromCartesian(world).height;
    assert(altitudeM <= expectedAltitudeM + 0.00001, 'Vertices must remain below the selected MSL altitude');
    maxAltitudeM = Math.max(maxAltitudeM, altitudeM);
  }
  assert(Math.abs(maxAltitudeM - expectedAltitudeM) < 0.00001,
    `Expected top altitude ${expectedAltitudeM} m MSL, received ${maxAltitudeM} m`);
  assert(geometry.triangleCount > 0);
}

async function runTests() {
  const template = EQUIPMENT_TEMPLATES.find((candidate) => candidate.id === 'radar_36d6');
  assert(template);
  const instance = createEquipmentFromTemplate(template, {
    latitude: 16.029,
    longitude: 108.176,
    altitude: 156,
  });
  instance.antennaHeightAGL = 12;
  instance.rangeKm = 60;
  const volume = await computeRadarCoverageVolume(instance, null, {
    azimuthStepDeg: 10,
    radialStepMeters: 2000,
  });

  for (const altitudeM of [100, 300, 500, 750]) {
    const geometry = buildRadarVolumeGeometry(volume, {
      mode: 'terrain-aware',
      selectedAltitudeM: altitudeM,
    });
    assert(geometry);
    verifySliceAltitude(geometry, altitudeM);
    console.log(`PASS: altitude slice ${altitudeM} m MSL`);
  }
  const full = buildRadarVolumeGeometry(volume, { mode: 'terrain-aware' });
  assert(full);
  verifySliceAltitude(full, volume.altitudeBands[volume.altitudeBands.length - 1]);
  console.log('PASS: full coverage height');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
