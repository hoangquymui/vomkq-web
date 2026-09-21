/**
 * Harness kiểm chứng runtime (chạy bằng Node, không thuộc app):
 * 1. Dựng vòm radar bằng chính buildRadarDomeGeometry đã port -> đếm đỉnh/tam giác, quét NaN.
 * 2. Kiểm tra parsePlacementAdvice với JSON bẩn (markdown, toạ độ sai, trùng, mảng rỗng).
 * 3. Kiểm tra normalizeScore / deriveAdvisorRadiusKm.
 */
import { buildRadarDomeGeometry, DOME_FOOTPRINT_SEGMENTS } from '../src/utils/radarDomeGeometry';
import {
  parsePlacementAdvice,
  deriveAdvisorRadiusKm,
} from '../src/utils/aiPlacementAdvisor';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';

let failures = 0;
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, JSON.stringify(detail));
}

// --- 1. Vòm radar P-18 Terek (đúng tham số video tham chiếu) ---
const template = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_p18_terek');
check('template radar_p18_terek tồn tại', Boolean(template), {
  id: template?.id,
  domeColor: template?.domeColor,
});
check('template radar_p18 có domeColor', EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_p18')?.domeColor === '#77ff7e', {
  domeColor: EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_p18')?.domeColor,
});

const instance = {
  instanceId: 'verify_1',
  templateId: 'radar_p18_terek',
  name: 'P-18 Terek verify',
  category: 'RadarCanhGioi' as const,
  latitude: 16.194667,
  longitude: 108.084,
  altitude: 414,
  antennaHeightAGL: 10,
  rangeKm: 20,
  scanSpeed: 36,
  minElevationDeg: 0,
  maxElevationDeg: 70,
  coverageHeightKm: 6,
  status: 'Active' as const,
  commandedByInstanceId: null,
  color: '#77ff7e',
  showDome: true,
  showSweep: true,
  coverageProfile: template?.coverageProfile,
};

const geometry = buildRadarDomeGeometry(instance, null, {
  azimuthSegments: 96,
  elevationRings: 12,
  terrainMasked: false,
});

check('buildRadarDomeGeometry trả về geometry', geometry !== null, null);

if (geometry) {
  check('đỉnh = (12+1)*96 + 1 = 1249', geometry.vertexCount === 1249, geometry.vertexCount);
  check('tam giác = 12*96*2 + 96 = 2400', geometry.triangleCount === 2400, geometry.triangleCount);
  check('chỉ số tam giác = 7200', geometry.indices.length === 7200, geometry.indices.length);

  const badPositions = Array.from(geometry.positions).filter((v) => !Number.isFinite(v)).length;
  const badNormals = Array.from(geometry.normals).filter((v) => !Number.isFinite(v)).length;
  const badSt = Array.from(geometry.st).filter((v) => !Number.isFinite(v)).length;
  const badIndices = Array.from(geometry.indices).filter((v) => !Number.isFinite(v) || v < 0 || v >= geometry.vertexCount).length;

  check('positions không có NaN/Inf', badPositions === 0, badPositions);
  check('normals không có NaN/Inf', badNormals === 0, badNormals);
  check('st không có NaN/Inf', badSt === 0, badSt);
  check('indices hợp lệ', badIndices === 0, badIndices);

  check(
    'bán kính đáy = 20 km (trần 6 km không cắt vì góc tà min = 0)',
    Math.abs(geometry.baseRadiusM - 20000) < 1,
    geometry.baseRadiusM
  );
  check('đỉnh vòm cao < 20 km', geometry.apexHeightM > 0 && geometry.apexHeightM <= 20000, geometry.apexHeightM);
  check('modelMatrix là ma trận 4x4', geometry.modelMatrix.length === 16, geometry.modelMatrix.length);
  check('center hữu hạn', Number.isFinite(geometry.center.x) && Number.isFinite(geometry.center.y) && Number.isFinite(geometry.center.z), {
    x: geometry.center.x,
    y: geometry.center.y,
    z: geometry.center.z,
  });
  check('footprint = 96 điểm', DOME_FOOTPRINT_SEGMENTS === 96, DOME_FOOTPRINT_SEGMENTS);
}

// --- 1b. Trường hợp xấu: coverageHeightKm/altitude không hợp lệ phải không sinh NaN ---
const nastyInstance = { ...instance, coverageHeightKm: Number.NaN, altitude: Number.NaN, antennaHeightAGL: Number.NaN, rangeKm: Number.NaN };
const nastyGeometry = buildRadarDomeGeometry(nastyInstance as typeof instance, null, {});
check(
  'geometry với tham số NaN: hoặc null hoặc không có NaN',
  nastyGeometry === null ||
    Array.from(nastyGeometry.positions).every((v) => Number.isFinite(v)),
  nastyGeometry ? 'ok' : 'null'
);

// --- 2. parsePlacementAdvice ---
const dirty =
  'Đây là kết quả:\n```json\n' +
  JSON.stringify({
    summary: 'Ưu tiên tuyến ven biển',
    suggestions: [
      { lat: 16.1, lon: 108.2, score: 0.9, reason: 'ven biển' },
      { lat: 16.1, lon: 108.2, score: 0.9, reason: 'trùng toạ độ -> loại' },
      { lat: 95.5, lon: -200.3, score: 88, reason: 'kẹp biên' },
      { lat: 'abc', lon: 108.0, score: 0.5, reason: 'lat sai -> loại' },
    ],
    route: [
      { lat: 16.0, lon: 108.0 },
      { lat: 16.2, lon: 108.3 },
      { lat: Number.NaN, lon: 108.1 },
    ],
  }) +
  '\n```\nHết.';

const parsed = parsePlacementAdvice(dirty);
check('parse OK', parsed.ok, parsed.ok ? 'ok' : parsed.message);
if (parsed.ok) {
  check('summary đọc được', parsed.value.summary === 'Ưu tiên tuyến ven biển', parsed.value.summary);
  check('suggestions: loại trùng + loại lat sai => 2', parsed.value.suggestions.length === 2, parsed.value.suggestions.length);
  check('kẹp lat 95.5 -> 90', parsed.value.suggestions[1]?.latitude === 90, parsed.value.suggestions[1]?.latitude);
  check('kẹp lon -200.3 -> -180', parsed.value.suggestions[1]?.longitude === -180, parsed.value.suggestions[1]?.longitude);
  check('score 88 -> 0.88', parsed.value.suggestions[1]?.score === 0.88, parsed.value.suggestions[1]?.score);
  check('route: loại NaN => 2 điểm', parsed.value.route.length === 2, parsed.value.route.length);
}

const emptyArrays = parsePlacementAdvice('{"summary":"","suggestions":[],"route":[]}');
check(
  'chấp nhận mảng rỗng',
  emptyArrays.ok && emptyArrays.value.suggestions.length === 0 && emptyArrays.value.route.length === 0,
  emptyArrays.ok ? 'ok' : emptyArrays.message
);

const noJson = parsePlacementAdvice('Xin lỗi, tôi không thể trả lời.');
check('không có JSON -> lỗi có kiểm soát', !noJson.ok, noJson.ok ? 'unexpected ok' : noJson.message);

const brokenJson = parsePlacementAdvice('{"summary": "a", "suggestions": [ }');
check('JSON hỏng -> lỗi có kiểm soát', !brokenJson.ok, brokenJson.ok ? 'unexpected ok' : brokenJson.message);

// --- 3. deriveAdvisorRadiusKm ---
check('radius(95000m) = 76 km', deriveAdvisorRadiusKm(95000) === 76, deriveAdvisorRadiusKm(95000));
check('radius(1500000m) kẹp 400 km', deriveAdvisorRadiusKm(1500000) === 400, deriveAdvisorRadiusKm(1500000));
check('radius(NaN) = 15 km', deriveAdvisorRadiusKm(Number.NaN) === 15, deriveAdvisorRadiusKm(Number.NaN));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
