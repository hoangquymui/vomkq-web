import {
  calculateSamPearMaxRange,
  calculateSamDeadConeRadius,
  extractSamAltitudeBands,
  computeSamEngagementVolume,
  buildSamLayerGeometry,
  getSamCrossSectionProfile,
  calculateSpyderDomeMaxRange,
} from '../../src/utils/missileVolumeEngine';
import { EQUIPMENT_TEMPLATES, SPYDER_SYSTEM_DEFAULT_CONFIG } from '../../src/data/equipmentTemplates';

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

  console.log('--- TEST 6: SPYDER Semi-elliptical Formula & Parameters (Bảng 1 & Ảnh 2) ---');
  const spyderTmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === 'sam_spyder');
  if (!spyderTmpl) throw new Error('sam_spyder template not found');
  if (!spyderTmpl.spyderConfig) throw new Error('sam_spyder template missing spyderConfig');

  const { sr, mr, targetSpeeds } = spyderTmpl.spyderConfig;
  console.log(`- SPYDER-SR: D_max=${sr.dMaxKm}km, D_min=${sr.dMinKm}km, H_max=${sr.hMaxM}m, H_min=${sr.hMinM}m, Color=${sr.colorHex}`);
  console.log(`- SPYDER-MR: D_max=${mr.dMaxKm}km, D_min=${mr.dMinKm}km, H_max=${mr.hMaxM}m, H_min=${mr.hMinM}m, Color=${mr.colorHex}`);
  console.log(`- Tốc độ mục tiêu: Máy bay <${targetSpeeds.aircraftMps}m/s, Trực thăng 0-${targetSpeeds.helicopterMps}m/s, UAV <${targetSpeeds.uavMps}m/s`);

  if (sr.dMaxKm !== 20 || sr.dMinKm !== 1 || sr.hMaxM !== 9000 || sr.hMinM !== 20) {
    throw new Error('SPYDER-SR parameters mismatch with Bảng 1');
  }
  if (mr.dMaxKm !== 50 || mr.dMinKm !== 2 || mr.hMaxM !== 16000 || mr.hMinM !== 20) {
    throw new Error('SPYDER-MR parameters mismatch with Bảng 1');
  }
  if (targetSpeeds.aircraftMps !== 800 || targetSpeeds.helicopterMps !== 200 || targetSpeeds.uavMps !== 300) {
    throw new Error('SPYDER target speed limits mismatch with Bảng 1');
  }

  // Semi-elliptical curve testing: D(H) = D_max * sqrt(1 - (H / H_max)^2)
  const srBase = calculateSpyderDomeMaxRange(0, 20000, 9000);
  const srMid = calculateSpyderDomeMaxRange(5400, 20000, 9000); // 5400/9000 = 0.6 -> sqrt(1-0.36) = 0.8 -> 16000m
  const srTop = calculateSpyderDomeMaxRange(9000, 20000, 9000);
  const srAbove = calculateSpyderDomeMaxRange(9500, 20000, 9000);

  console.log(`- SR D(0m) = ${srBase}m (kỳ vọng 20000m)`);
  console.log(`- SR D(5400m) = ${srMid}m (kỳ vọng 16000m)`);
  console.log(`- SR D(9000m) = ${srTop}m (kỳ vọng 0m)`);

  if (Math.abs(srBase - 20000) > 1) throw new Error('SR D(0) must be 20000m');
  if (Math.abs(srMid - 16000) > 1) throw new Error('SR D(5400) must be 16000m by semi-ellipse');
  if (srTop !== 0) throw new Error('SR D(9000) must be 0m');
  if (srAbove !== 0) throw new Error('SR D(>9000) must be 0m');

  const mrBase = calculateSpyderDomeMaxRange(0, 50000, 16000);
  const mrMid = calculateSpyderDomeMaxRange(9600, 50000, 16000); // 9600/16000 = 0.6 -> 40000m
  const mrTop = calculateSpyderDomeMaxRange(16000, 50000, 16000);
  console.log(`- MR D(0m) = ${mrBase}m (kỳ vọng 50000m)`);
  console.log(`- MR D(9600m) = ${mrMid}m (kỳ vọng 40000m)`);
  console.log(`- MR D(16000m) = ${mrTop}m (kỳ vọng 0m)`);

  if (Math.abs(mrBase - 50000) > 1) throw new Error('MR D(0) must be 50000m');
  if (Math.abs(mrMid - 40000) > 1) throw new Error('MR D(9600) must be 40000m by semi-ellipse');
  if (mrTop !== 0) throw new Error('MR D(16000) must be 0m');
  console.log('✓ TEST 6 PASS');

  console.log('--- TEST 7: Compute SPYDER Dual Dome Volume (Flat Fallback) ---');
  const spyderInst = {
    instanceId: 'test_spyder',
    templateId: 'sam_spyder',
    name: 'SPYDER Haiphong Test',
    category: 'TenLuaPhongKhong' as const,
    latitude: 20.85,
    longitude: 106.68,
    altitude: 15,
    antennaHeightAGL: 5,
    rangeKm: 50,
    scanSpeed: 0,
    minElevationDeg: 0,
    maxElevationDeg: 80,
    coverageHeightKm: 16,
    status: 'Active' as const,
    color: '#0ea5e9',
    showDome: true,
    showSweep: false,
    spyderConfig: SPYDER_SYSTEM_DEFAULT_CONFIG,
  };

  const spyderMRVol = await computeSamEngagementVolume(spyderInst, null, {
    azimuthStepDeg: 15,
  });

  console.log(`- SPYDER isDualDome: ${spyderMRVol.isSpyderDualDome}`);
  console.log(`- SPYDER MR bands: ${spyderMRVol.altitudeBands.length} tầng (top = ${spyderMRVol.altitudeBands[spyderMRVol.altitudeBands.length - 1]}m)`);
  console.log(`- SPYDER SR nested volume present: ${!!spyderMRVol.spyderSrVolume}`);

  if (!spyderMRVol.isSpyderDualDome) throw new Error('isSpyderDualDome must be true');
  if (!spyderMRVol.spyderSrVolume) throw new Error('spyderSrVolume must be present in computed volume');

  const spyderSRVol = spyderMRVol.spyderSrVolume;
  console.log(`- SPYDER SR bands: ${spyderSRVol.altitudeBands.length} tầng (top = ${spyderSRVol.altitudeBands[spyderSRVol.altitudeBands.length - 1]}m)`);

  if (spyderMRVol.altitudeBands[spyderMRVol.altitudeBands.length - 1] < 15500) {
    throw new Error('MR top altitude band should reach ~16000m');
  }
  if (spyderSRVol.altitudeBands[spyderSRVol.altitudeBands.length - 1] < 8500) {
    throw new Error('SR top altitude band should reach ~9000m');
  }

  // Test 3D Geometry building for both domes
  const geomMR = buildSamLayerGeometry(spyderMRVol, 'outer_boundary', { mode: 'nominal' });
  const geomSR = buildSamLayerGeometry(spyderSRVol, 'outer_boundary', { mode: 'nominal' });
  if (!geomMR || !geomSR) throw new Error('SPYDER geometry building failed');
  console.log(`- SPYDER MR 3D Mesh vertices: ${geomMR.vertexCount}, triangles: ${geomMR.triangleCount}`);
  console.log(`- SPYDER SR 3D Mesh vertices: ${geomSR.vertexCount}, triangles: ${geomSR.triangleCount}`);
  console.log('✓ TEST 7 PASS');

  console.log('--- TEST 8: SPYDER Dual Dome Cross Section Profile ---');
  const spyderProfile = getSamCrossSectionProfile(spyderMRVol, 90);
  console.log(`- MR Profile points: ${spyderProfile.points.length} điểm`);
  console.log(`- Nested SR Profile present: ${!!spyderProfile.spyderSrProfile}`);

  if (!spyderProfile.spyderSrProfile) throw new Error('spyderSrProfile must be present in profile');
  const srProfile = spyderProfile.spyderSrProfile;
  console.log(`- SR Profile points: ${srProfile.points.length} điểm`);

  const mrNearGround = spyderProfile.points[0];
  const srNearGround = srProfile.points[0];
  console.log(`- MR near ground (alt=${mrNearGround.altM}m): dMax=${(mrNearGround.dMaxM / 1000).toFixed(1)}km`);
  console.log(`- SR near ground (alt=${srNearGround.altM}m): dMax=${(srNearGround.dMaxM / 1000).toFixed(1)}km`);

  if (Math.abs(mrNearGround.dMaxM - 50000) > 2000) {
    throw new Error('MR near ground range should be ~50km');
  }
  if (Math.abs(srNearGround.dMaxM - 20000) > 2000) {
    throw new Error('SR near ground range should be ~20km');
  }
  console.log('✓ TEST 8 PASS');

  console.log('\n========================================');
  console.log('🎉 ALL 8/8 SAM & SPYDER TESTS PASSED SUCCESSFULLY!');
  console.log('========================================');
}

runTests().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
