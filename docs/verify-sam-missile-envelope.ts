import {
  calculateSamPearMaxRange,
  calculateSamDeadConeRadius,
  extractSamAltitudeBands,
  computeSamEngagementVolume,
  buildSamLayerGeometry,
  getSamCrossSectionProfile,
} from '../src/utils/missileVolumeEngine';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';

async function runTests() {
  console.log('--- TEST 1: C-125-2TM Pechora Pear-shaped Range Calculation ---');
  const dMaxM = 35400;
  const hMinM = 20;
  const hMaxM = 25000;
  const hOptM = 6000;

  const rFloor = calculateSamPearMaxRange(hMinM, dMaxM, hMinM, hMaxM, hOptM);
  const rOpt = calculateSamPearMaxRange(hOptM, dMaxM, hMinM, hMaxM, hOptM);
  const rHigh = calculateSamPearMaxRange(15000, dMaxM, hMinM, hMaxM, hOptM);
  const rCeil = calculateSamPearMaxRange(hMaxM, dMaxM, hMinM, hMaxM, hOptM);
  const rAbove = calculateSamPearMaxRange(26000, dMaxM, hMinM, hMaxM, hOptM);

  console.log(`- Cự ly khí động tại sàn H_min (20m): ${Math.round(rFloor)}m (${(rFloor / 1000).toFixed(1)}km)`);
  console.log(`- Cự ly tại tối ưu H_opt (6000m): ${Math.round(rOpt)}m (${(rOpt / 1000).toFixed(1)}km)`);
  console.log(`- Cự ly tại tầng cao (15000m): ${Math.round(rHigh)}m (${(rHigh / 1000).toFixed(1)}km)`);
  console.log(`- Cự ly tại trần H_max (25000m): ${Math.round(rCeil)}m (${(rCeil / 1000).toFixed(1)}km)`);
  console.log(`- Cự ly trên trần (26000m): ${Math.round(rAbove)}m`);

  if (Math.abs(rOpt - dMaxM) > 1) throw new Error('rOpt must reach dMaxM exactly!');
  if (rFloor <= 0 || rFloor >= rOpt) throw new Error('rFloor must be between 0 and rOpt!');
  if (rCeil <= 0 || rCeil > dMaxM) throw new Error('rCeil at H_max must have realistic plateau!');
  if (rAbove !== 0) throw new Error('rAbove must be 0!');
  console.log('✓ TEST 1 PASS');

  console.log('--- TEST 2: Nón mù đỉnh đầu 65° & Tâm khí tài ---');
  const coneAtOrigin = calculateSamDeadConeRadius(0, 0, 65.0);
  const coneAt10k = calculateSamDeadConeRadius(10000, 0, 65.0);
  const expectedCone10k = 10000 / Math.tan((65.0 * Math.PI) / 180);
  console.log(`- Nón mù tại tâm khí tài Delta H = 0: ${coneAtOrigin}m (phát từ tâm khí tài)`);
  console.log(`- Nón mù tại 10000m: ${coneAt10k.toFixed(1)}m (theo cot(65°))`);
  if (coneAtOrigin !== 0) throw new Error('coneAtOrigin must be 0 at weapon center!');
  if (Math.abs(coneAt10k - expectedCone10k) > 1) throw new Error('coneAt10k calculation mismatch!');
  console.log('✓ TEST 2 PASS');

  console.log('--- TEST 3: C-125 Template & Profiles ---');
  const tmpl2tm = EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_c125_2tm');
  if (!tmpl2tm) throw new Error('sam_c125_2tm template not found');
  if (!tmpl2tm.samProfiles?.head_on || !tmpl2tm.samProfiles?.tail_chase) {
    throw new Error('samProfiles head_on and tail_chase missing');
  }
  console.log(`- S-125-2TM Bắn đón: ${tmpl2tm.samProfiles.head_on.dMaxKm}km, V_max: ${tmpl2tm.samProfiles.head_on.vMaxMps}m/s`);
  console.log(`- S-125-2TM Bắn đuổi: ${tmpl2tm.samProfiles.tail_chase.dMaxKm}km, H_max: ${tmpl2tm.samProfiles.tail_chase.hMaxM}m`);
  console.log('✓ TEST 3 PASS');

  console.log('--- TEST 4: Compute SAM Volume (Flat Fallback) ---');
  const dummyInst = {
    instanceId: 'test_c125',
    templateId: 'sam_c125_2tm',
    name: 'C-125-2TM Test',
    category: 'TenLuaPhongKhong' as const,
    latitude: 21.0,
    longitude: 105.8,
    altitude: 20,
    antennaHeightAGL: 6,
    rangeKm: 35.4,
    scanSpeed: 0,
    minElevationDeg: 8.5,
    maxElevationDeg: 64.5,
    coverageHeightKm: 25,
    status: 'Active' as const,
    color: '#f43f5e',
    showDome: true,
    showSweep: false,
    samProfiles: tmpl2tm.samProfiles,
  };

  const samVol = await computeSamEngagementVolume(dummyInst, null, {
    mode: 'head_on',
    azimuthStepDeg: 15,
  });

  console.log(`- Volume altitudeBands: ${samVol.altitudeBands.length} tầng`);
  console.log(`- Azimuth samples: ${samVol.azimuthSamples.length} hướng`);
  console.log(`- Optimal ranges size: ${samVol.optimalRanges.length}x${samVol.optimalRanges[0].length}`);

  if (samVol.altitudeBands.length < 5) throw new Error('Bands too few');
  if (samVol.azimuthSamples.length !== 24) throw new Error('Azimuth count mismatch');

  // Test build geometry
  const geomOuter = buildSamLayerGeometry(samVol, 'outer_boundary', { mode: 'nominal' });
  const geomHigh = buildSamLayerGeometry(samVol, 'high_prob', { mode: 'nominal' });
  const geomOpt = buildSamLayerGeometry(samVol, 'optimal', { mode: 'nominal' });

  if (!geomOuter || !geomHigh || !geomOpt) throw new Error('Geometry creation failed');
  console.log(`- 3D Mesh vertices: Outer=${geomOuter.vertexCount}, High=${geomHigh.vertexCount}, Opt=${geomOpt.vertexCount}`);
  console.log(`- 3D Mesh triangles: Outer=${geomOuter.triangleCount}, High=${geomHigh.triangleCount}, Opt=${geomOpt.triangleCount}`);
  console.log('✓ TEST 4 PASS');

  console.log('--- TEST 5: Cross Section Profile ---');
  const profile = getSamCrossSectionProfile(samVol, 45);
  console.log(`- Profile points: ${profile.points.length} điểm`);
  console.log(`- Point 10 (alt=${profile.points[10].altM}m): dOpt=${profile.points[10].dOptM}m, dHigh=${profile.points[10].dHighM}m, dMax=${profile.points[10].dMaxM}m`);

  if (profile.points[10].dOptM >= profile.points[10].dHighM) throw new Error('dOpt must be smaller than dHigh');
  if (profile.points[10].dHighM >= profile.points[10].dMaxM) throw new Error('dHigh must be smaller than dMax');
  console.log('✓ TEST 5 PASS');

  console.log('\n========================================');
  console.log('🎉 ALL 5/5 SAM TESTS PASSED SUCCESSFULLY!');
  console.log('========================================');
}

runTests().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
