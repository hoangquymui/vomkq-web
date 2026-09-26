import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import {
  calculateEarthBulgeMeters,
  DEFAULT_K_FACTOR,
  EARTH_RADIUS_METERS,
} from './radarMath';
import { sampleTerrainGridAndMasks } from './radarVolumeEngine';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';

export type SamEngagementMode =
  | 'head_on'
  | 'tail_chase'
  | 'jamming_passive'
  | 'jamming_active'
  | 'tbk_optical';

export type SamProbabilityLayer = 'outer_boundary' | 'high_prob' | 'optimal';

export interface SamVolumeGeometry {
  positions: Float64Array;
  normals: Float32Array;
  st: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  apexHeightM: number;
  maxEffectiveRadiusM: number;
  center: Cesium.Cartesian3;
  modelMatrix: Cesium.Matrix4;
}

export interface SamEngagementVolume {
  instanceId: string;
  instanceName: string;
  mode: SamEngagementMode;
  modeVi: string;
  centerLat: number;
  centerLon: number;
  centerAltM: number;
  antennaHeightAGL: number;
  dMaxKm: number;
  dMinKm: number;
  hMaxM: number;
  hMinM: number;
  hOptM: number;
  pGhKm: number;
  vMaxMps: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  azimuthSamples: number[];
  altitudeBands: number[];
  innerConeRadii: number[];
  optimalRanges: number[][]; // [bandIdx][azIdx] (70% D_max)
  highProbRanges: number[][]; // [bandIdx][azIdx] (85% D_max)
  nominalRanges: number[][]; // [bandIdx][azIdx] (100% D_max)
  effectiveRanges: number[][]; // [bandIdx][azIdx] sau khi cắt địa hình
  terrainStatus: 'loaded' | 'flat_fallback' | 'sampling_error';
  cacheKey: string;
  maxMaskInfoByAzDist?: Map<string, { maxTan: number; peakDist: number; peakAlt: number }>;
}

/** Cache bộ nhớ lưu các SamEngagementVolume đã tính toán */
const samVolumeCache = new Map<string, SamEngagementVolume>();

/**
 * 1. HÀM TÍNH BIÊN CỰ LY QUẢ LÊ KHÍ ĐỘNG SAM THEO ĐỘ CAO (D_max(H))
 * Dạng hình học: Phình cực đại tại H_opt (5-8km), thu hẹp ở sát đất do không khí đặc,
 * và vuốt dần về trần hỏa lực H_max (giữ khoảng 35% tầm xa cực đại tại trần bắn).
 * @param deltaHM Độ cao tương đối so với bệ phóng (m)
 * @param dMaxM Cự ly tiêu diệt cực đại danh định (m)
 * @param hMinM Độ cao sàn hỏa lực tương đối (m)
 * @param hMaxM Trần hỏa lực tối đa (m)
 * @param hOptM Độ cao tối ưu khí động học đạt cự ly lớn nhất (m)
 */
export function calculateSamPearMaxRange(
  deltaHM: number,
  dMaxM: number,
  hMinM: number = 0,
  hMaxM: number = 25000,
  hOptM: number = 6000
): number {
  if (deltaHM < 0 || deltaHM > hMaxM) return 0;

  // Nửa trên (từ H_opt đến H_max): suy giảm lực nâng khí động theo mật độ không khí
  let upperFactor = 1.0;
  if (deltaHM >= hOptM) {
    const span = Math.max(1, hMaxM - hOptM);
    const ratio = Math.min(1, (deltaHM - hOptM) / span);
    // Tại trần hỏa lực H_max, tên lửa vẫn giữ khoảng 35% tầm xa cực đại
    upperFactor = 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - ratio * ratio));
  }

  // Nửa dưới (từ hMinM đến H_opt): suy giảm do mật độ không khí lớn & khí động
  let lowerFactor = 1.0;
  if (deltaHM < hOptM) {
    const span = Math.max(1, hOptM - hMinM);
    const ratio = Math.min(1, Math.max(0, (deltaHM - hMinM) / span));
    // Tầng sát đất đạt khoảng 45% - 50% cự ly cực đại (trước khi bị cắt bởi góc ngẩng bệ phóng 6°)
    lowerFactor = 0.45 + 0.55 * Math.pow(ratio, 0.28);
  }

  return Math.max(0, dMaxM * upperFactor * lowerFactor);
}

/**
 * 2. HÀM TÍNH NÓN MÙ CỰC CẬN & GÓC TÀ ĐỈNH ĐẦU HÌNH NÓN (Cone of Silence)
 * Vùng mù hình nón có đỉnh (apex) đặt tại đúng tâm khí tài (deltaH = 0 -> R = 0).
 * Góc cực đại ngẩng được so với mặt phẳng ngang là maxElevDeg (mặc định 65°).
 * Bán kính nón mù tại độ cao deltaH: R = deltaH * cotg(maxElevDeg).
 */
export function calculateSamDeadConeRadius(
  altM: number,
  centerAltM: number,
  dMinMOrMaxElevDeg: number = 65.0,
  maxElevDeg: number = 65.0
): number {
  const elevDeg =
    typeof maxElevDeg === 'number' && maxElevDeg > 0 && maxElevDeg <= 89
      ? maxElevDeg
      : dMinMOrMaxElevDeg <= 89
        ? dMinMOrMaxElevDeg
        : 65.0;
  const deltaH = Math.max(0, altM - centerAltM);
  const rad = (Math.max(10, Math.min(85, elevDeg)) * Math.PI) / 180;
  const cot = 1 / Math.tan(rad);
  const coneM = deltaH * cot;
  return Math.round(coneM);
}

/**
 * 3. TRÍCH XUẤT CÁC TẦNG ĐỘ CAO CHO SAM
 * Phát vòm từ tâm khí tài (tầng 0 tại đúng centerAltM với deltaH = 0),
 * trải đều lên đến trần độ cao cực đại centerAltM + hMaxM.
 */
export function extractSamAltitudeBands(
  centerAltM: number,
  hMaxM: number,
  hOptM: number
): number[] {
  const relAltitudes = [
    0,
    50,
    150,
    300,
    600,
    1000,
    2000,
    3500,
    Math.round(hOptM),
    8000,
    11000,
    14000,
    Math.round(hMaxM),
  ];
  const uniqueBands = Array.from(
    new Set(
      relAltitudes
        .filter((h) => h >= 0 && h <= hMaxM)
        .map((h) => Math.round(centerAltM + h))
    )
  ).sort((a, b) => a - b);

  if (uniqueBands[0] !== Math.round(centerAltM)) {
    uniqueBands.unshift(Math.round(centerAltM));
  }
  const topAlt = Math.round(centerAltM + hMaxM);
  if (uniqueBands[uniqueBands.length - 1] !== topAlt) {
    uniqueBands.push(topAlt);
  }
  return uniqueBands;
}

/**
 * 4. TÍNH TOÁN KHỐI THỂ TÍCH HỎA LỰC SAM 3D CẮT ĐỊA HÌNH
 */
export async function computeSamEngagementVolume(
  instance: EquipmentInstance,
  terrainProvider: Cesium.TerrainProvider | null,
  options: {
    mode?: SamEngagementMode;
    azimuthStepDeg?: number;
    radialStepMeters?: number;
    kFactor?: number;
  } = {}
): Promise<SamEngagementVolume> {
  const mode: SamEngagementMode = options.mode || instance.samEngagementMode || 'head_on';
  const tmpl = EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId);
  const profile = (instance.samProfiles || tmpl?.samProfiles)?.[mode];

  const dMaxKm = profile?.dMaxKm || instance.rangeKm || tmpl?.defaultRangeKm || 25;
  const dMinKm = profile?.dMinKm || instance.minEngagementRangeKm || tmpl?.minEngagementRangeKm || 3.5;
  const hMaxM = profile?.hMaxM || instance.maxEngagementAltitudeM || tmpl?.maxEngagementAltitudeM || 18000;
  const hMinM = profile?.hMinM || instance.minEngagementAltitudeM || tmpl?.minEngagementAltitudeM || 20;
  const hOptM = instance.optimalAltitudeM || tmpl?.optimalAltitudeM || Math.round(hMaxM * 0.35);
  const pGhKm = profile?.pGhKm || instance.maxTargetParamKm || tmpl?.maxTargetParamKm || 16.5;
  const vMaxMps = profile?.vMaxMps || instance.maxTargetSpeedMps || tmpl?.maxTargetSpeedMps || 700;
  const modeVi = profile?.modeVi || 'Bắn đón (Không nhiễu)';

  // Góc ngẩng bệ phóng cố định 6° và góc cực đại ngẩng được 65°
  const minElevationDeg = instance.minElevationDeg !== undefined ? instance.minElevationDeg : 6.0;
  const maxElevationDeg = instance.maxElevationDeg !== undefined ? instance.maxElevationDeg : 65.0;

  const azimuthStepDeg = options.azimuthStepDeg || 5;
  const radialStepMeters = options.radialStepMeters || Math.max(1200, Math.round((dMaxKm * 1000) / 40));
  const kFactor = options.kFactor || DEFAULT_K_FACTOR;

  const centerLat = instance.latitude;
  const centerLon = instance.longitude;
  const centerGroundAltM = instance.altitude || 0;
  const antennaHeightAGL = instance.antennaHeightAGL || 6;
  const centerAltM = centerGroundAltM + antennaHeightAGL;
  const dMaxM = dMaxKm * 1000;
  const dMinM = dMinKm * 1000;

  const cacheKey = `sam_${instance.instanceId}_${mode}_${centerLat.toFixed(4)}_${centerLon.toFixed(4)}_${centerAltM.toFixed(1)}_${dMaxKm}_${hMaxM}_${minElevationDeg}_${maxElevationDeg}_${azimuthStepDeg}_${kFactor.toFixed(2)}`;
  const cached = samVolumeCache.get(cacheKey);
  if (cached) return cached;

  // Trích xuất các tầng độ cao (bắt đầu từ centerAltM với deltaH = 0)
  const altitudeBands = extractSamAltitudeBands(centerAltM, hMaxM, hOptM);
  const azimuthSamples: number[] = [];
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    azimuthSamples.push(az);
  }

  // Nón mù hình nón theo từng tầng độ cao: deltaH * cotg(maxElevationDeg)
  const innerConeRadii = altitudeBands.map((altM) =>
    calculateSamDeadConeRadius(altM, centerAltM, maxElevationDeg)
  );

  // Lấy mẫu độ cao địa hình DEM và tính góc che khuất tích lũy
  const { terrainMap, maxMaskInfoByAzDist, sampleDistances, terrainStatus } = await sampleTerrainGridAndMasks(
    centerLat,
    centerLon,
    centerAltM,
    dMaxM,
    azimuthSamples,
    radialStepMeters,
    terrainProvider,
    kFactor
  );

  const tanMinElev = Math.tan((minElevationDeg * Math.PI) / 180);
  const cotMinElev = 1 / tanMinElev;
  const rEquiv = EARTH_RADIUS_METERS * kFactor;
  const aQuad = 1 / (2 * rEquiv);

  const optimalRanges: number[][] = [];
  const highProbRanges: number[][] = [];
  const nominalRanges: number[][] = [];
  const effectiveRanges: number[][] = [];

  for (let b = 0; b < altitudeBands.length; b++) {
    const altM = altitudeBands[b];
    const deltaH = Math.max(0, altM - centerAltM);
    const innerConeM = innerConeRadii[b];

    // Tại tâm bệ phóng (deltaH = 0): cự ly = 0
    if (deltaH === 0) {
      nominalRanges.push(azimuthSamples.map(() => 0));
      optimalRanges.push(azimuthSamples.map(() => 0));
      highProbRanges.push(azimuthSamples.map(() => 0));
      effectiveRanges.push(azimuthSamples.map(() => 0));
      continue;
    }

    // Giới hạn biên hỏa lực bởi góc ngẩng cố định của bệ phóng (6 độ)
    const launchLimitM = Math.round(deltaH * cotMinElev);
    const aeroMaxM = calculateSamPearMaxRange(deltaH, dMaxM, 0, hMaxM, hOptM);
    let nomMaxRangeM = Math.min(aeroMaxM, launchLimitM);
    nomMaxRangeM = Math.max(innerConeM, nomMaxRangeM);

    const optMaxM = Math.max(innerConeM, Math.round(nomMaxRangeM * 0.70));
    const highProbM = Math.max(innerConeM, Math.round(nomMaxRangeM * 0.85));

    const optRow: number[] = [];
    const highProbRow: number[] = [];
    const nomRow: number[] = [];
    const effRow: number[] = [];

    for (let j = 0; j < azimuthSamples.length; j++) {
      const az = azimuthSamples[j];
      nomRow.push(nomMaxRangeM);
      optRow.push(optMaxM);
      highProbRow.push(highProbM);

      if (nomMaxRangeM <= innerConeM) {
        effRow.push(innerConeM);
        continue;
      }

      // Kiểm tra góc che chắn địa hình
      let effDistM = nomMaxRangeM;
      for (const dist of sampleDistances) {
        if (dist > nomMaxRangeM) break;
        if (dist <= innerConeM) continue;

        const groundAlt = terrainMap.get(`${az}_${dist}`) || 0;
        const deltaHBulge = calculateEarthBulgeMeters(dist, kFactor);
        const tanTarget = (altM - centerAltM - deltaHBulge) / dist;
        const maskInfo = maxMaskInfoByAzDist.get(`${az}_${dist}`);
        const maxMaskTan = maskInfo ? maskInfo.maxTan : -Number.MAX_VALUE;

        if (altM < groundAlt || (maxMaskTan > tanMinElev && tanTarget < maxMaskTan)) {
          // Bị địa hình chắn
          const bQuad = Math.max(tanMinElev, maxMaskTan);
          const cQuad = -(altM - centerAltM);
          const disc = bQuad * bQuad - 4 * aQuad * cQuad;
          if (disc >= 0 && altM > centerAltM) {
            const dCutoff = (-bQuad + Math.sqrt(disc)) / (2 * aQuad);
            effDistM = Math.min(dist, Math.max(innerConeM, dCutoff));
          } else {
            effDistM = Math.min(dist, Math.max(innerConeM, maskInfo ? maskInfo.peakDist : dist));
          }
          break;
        }
      }

      effRow.push(Math.round(effDistM));
    }

    optimalRanges.push(optRow);
    highProbRanges.push(highProbRow);
    nominalRanges.push(nomRow);
    effectiveRanges.push(effRow);
  }

  const volume: SamEngagementVolume = {
    instanceId: instance.instanceId,
    instanceName: instance.name,
    mode,
    modeVi,
    centerLat,
    centerLon,
    centerAltM,
    antennaHeightAGL,
    dMaxKm,
    dMinKm,
    hMaxM,
    hMinM,
    hOptM,
    pGhKm,
    vMaxMps,
    minElevationDeg,
    maxElevationDeg,
    azimuthSamples,
    altitudeBands,
    innerConeRadii,
    optimalRanges,
    highProbRanges,
    nominalRanges,
    effectiveRanges,
    terrainStatus,
    cacheKey,
    maxMaskInfoByAzDist,
  };

  samVolumeCache.set(cacheKey, volume);
  return volume;
}

/**
 * 5. XÂY DỰNG MESH ĐA GIÁC 3D CHO TỪNG LỚP HỎA LỰC SAM
 * Khí tài phát vòm từ đỉnh tâm (0,0,0), mặt dưới ngẩng 6° và nón mù hình nón ngẩng 65°.
 */
export function buildSamLayerGeometry(
  volume: SamEngagementVolume,
  layer: SamProbabilityLayer = 'outer_boundary',
  options: {
    mode?: 'nominal' | 'terrain-aware';
    showInnerCone?: boolean;
    showTopCap?: boolean;
    showBottomCap?: boolean;
  } = {}
): SamVolumeGeometry | null {
  const { altitudeBands, azimuthSamples, innerConeRadii, centerLat, centerLon, centerAltM } = volume;
  const numBands = altitudeBands.length;
  const numAz = azimuthSamples.length;
  if (numBands < 2 || numAz < 3) return null;

  const isTerrainAware = options.mode !== 'nominal';
  const showInnerCone = options.showInnerCone !== false;
  const showTopCap = options.showTopCap !== false;

  // Lựa chọn ma trận cự ly tương ứng với lớp
  let rangeMatrix = isTerrainAware ? volume.effectiveRanges : volume.nominalRanges;
  let scale = 1.0;
  if (layer === 'high_prob') {
    scale = 0.85;
    rangeMatrix = volume.highProbRanges;
  } else if (layer === 'optimal') {
    scale = 0.70;
    rangeMatrix = volume.optimalRanges;
  }

  const center = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerAltM);
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // M tầng cao phía trên đỉnh tâm khí tài (k = 1 ... numBands - 1)
  const M = numBands - 1;
  const outerApexIdx = 0;
  const outerRingVertexCount = M * numAz;
  const outerVertexCount = 1 + outerRingVertexCount;

  const innerApexIdx = showInnerCone ? outerVertexCount : -1;
  const innerRingVertexCount = showInnerCone ? M * numAz : 0;
  const innerVertexCount = showInnerCone ? 1 + innerRingVertexCount : 0;

  // Nếu không có nón mù mà có top cap thì cần 1 đỉnh centroid trên đỉnh
  const topCentroidIdx = !showInnerCone && showTopCap ? outerVertexCount : -1;
  const extraCentroidCount = topCentroidIdx >= 0 ? 1 : 0;

  const totalVertices = outerVertexCount + innerVertexCount + extraCentroidCount;

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);

  // Đỉnh nón ngoài tại tâm khí tài (0, 0, 0)
  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  normals[0] = 0;
  normals[1] = 0;
  normals[2] = -1;
  st[0] = 0.5;
  st[1] = 0.0;

  const outerIdx = (k: number, j: number) => 1 + (k - 1) * numAz + j;

  let apexHeightM = Math.max(1, altitudeBands[numBands - 1] - centerAltM);
  let maxEffectiveRadiusM = 0;

  // A. Vỏ ngoài quả lê (Outer Shell) cho các tầng k = 1 .. M
  for (let k = 1; k < numBands; k++) {
    const altM = altitudeBands[k];
    const z = Math.max(0, altM - centerAltM);
    const vCoord = z / apexHeightM;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const azRad = (azDeg * Math.PI) / 180;
      const uCoord = j / numAz;

      let rOuter = rangeMatrix[k][j];
      if (layer !== 'outer_boundary' && isTerrainAware) {
        rOuter = Math.min(rOuter, volume.effectiveRanges[k][j] * scale);
      }
      rOuter = Math.max(innerConeRadii[k], rOuter);
      if (rOuter > maxEffectiveRadiusM) maxEffectiveRadiusM = rOuter;

      const x = rOuter * Math.sin(azRad);
      const y = rOuter * Math.cos(azRad);

      const vIdx = outerIdx(k, j);
      const pIdx = vIdx * 3;
      const stIdx = vIdx * 2;

      positions[pIdx] = x;
      positions[pIdx + 1] = y;
      positions[pIdx + 2] = z;

      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      normals[pIdx] = x / len;
      normals[pIdx + 1] = y / len;
      normals[pIdx + 2] = z / len;

      st[stIdx] = uCoord;
      st[stIdx + 1] = vCoord;
    }
  }

  // B. Nón mù cực cận đỉnh đầu hình nón (Inner Cone)
  const innerIdx = (k: number, j: number) => innerApexIdx + 1 + (k - 1) * numAz + j;

  if (showInnerCone && innerApexIdx >= 0) {
    // Đỉnh nón trong tại đúng tâm khí tài (0, 0, 0)
    const iApIdx = innerApexIdx * 3;
    positions[iApIdx] = 0;
    positions[iApIdx + 1] = 0;
    positions[iApIdx + 2] = 0;
    normals[iApIdx] = 0;
    normals[iApIdx + 1] = 0;
    normals[iApIdx + 2] = 1;
    st[innerApexIdx * 2] = 0.5;
    st[innerApexIdx * 2 + 1] = 0.0;

    const maxElevRad = (volume.maxElevationDeg * Math.PI) / 180;
    const sinMaxElev = Math.sin(maxElevRad);
    const cosMaxElev = Math.cos(maxElevRad);

    for (let k = 1; k < numBands; k++) {
      const altM = altitudeBands[k];
      const z = Math.max(0, altM - centerAltM);
      const rInner = Math.max(0.1, innerConeRadii[k]);
      const vCoord = z / apexHeightM;

      for (let j = 0; j < numAz; j++) {
        const azDeg = azimuthSamples[j];
        const azRad = (azDeg * Math.PI) / 180;
        const uCoord = j / numAz;

        const x = rInner * Math.sin(azRad);
        const y = rInner * Math.cos(azRad);

        const vIdx = innerIdx(k, j);
        const pIdx = vIdx * 3;
        const stIdx = vIdx * 2;

        positions[pIdx] = x;
        positions[pIdx + 1] = y;
        positions[pIdx + 2] = z;

        // Normal hình nón hướng vào lòng vùng mù
        normals[pIdx] = -Math.sin(azRad) * sinMaxElev;
        normals[pIdx + 1] = -Math.cos(azRad) * sinMaxElev;
        normals[pIdx + 2] = cosMaxElev;

        st[stIdx] = uCoord;
        st[stIdx + 1] = vCoord;
      }
    }
  }

  // C. Dựng các tam giác chỉ số (Indices)
  const indexList: number[] = [];

  // 1a. Quạt đáy từ đỉnh tâm outerApexIdx tới tầng 1
  for (let j = 0; j < numAz; j++) {
    const jNext = (j + 1) % numAz;
    indexList.push(outerApexIdx, outerIdx(1, j), outerIdx(1, jNext));
  }

  // 1b. Quads nối các tầng vỏ ngoài (k = 1 .. M - 1)
  for (let k = 1; k < M; k++) {
    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;
      const p00 = outerIdx(k, j);
      const p01 = outerIdx(k, jNext);
      const p10 = outerIdx(k + 1, j);
      const p11 = outerIdx(k + 1, jNext);

      indexList.push(p00, p01, p10);
      indexList.push(p10, p01, p11);
    }
  }

  // 2. Nón mù bên trong
  if (showInnerCone && innerApexIdx >= 0) {
    // 2a. Quạt đỉnh nón trong từ innerApexIdx tới tầng 1 (hướng mặt vào trong vùng mù)
    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;
      indexList.push(innerApexIdx, innerIdx(1, jNext), innerIdx(1, j));
    }

    // 2b. Quads nối nón mù các tầng k = 1 .. M - 1
    for (let k = 1; k < M; k++) {
      for (let j = 0; j < numAz; j++) {
        const jNext = (j + 1) % numAz;
        const p00 = innerIdx(k, j);
        const p01 = innerIdx(k, jNext);
        const p10 = innerIdx(k + 1, j);
        const p11 = innerIdx(k + 1, jNext);

        indexList.push(p00, p10, p01);
        indexList.push(p10, p11, p01);
      }
    }
  }

  // 3. Nắp trên cùng tại H_max (Top Cap)
  if (showTopCap) {
    if (showInnerCone && innerApexIdx >= 0) {
      for (let j = 0; j < numAz; j++) {
        const jNext = (j + 1) % numAz;
        const out0 = outerIdx(M, j);
        const out1 = outerIdx(M, jNext);
        const in0 = innerIdx(M, j);
        const in1 = innerIdx(M, jNext);

        indexList.push(out0, in0, out1);
        indexList.push(out1, in0, in1);
      }
    } else if (topCentroidIdx >= 0) {
      // Centroid trên đỉnh nắp
      let cEast = 0;
      let cNorth = 0;
      const topZ = positions[outerIdx(M, 0) * 3 + 2];
      for (let j = 0; j < numAz; j++) {
        cEast += positions[outerIdx(M, j) * 3];
        cNorth += positions[outerIdx(M, j) * 3 + 1];
      }
      cEast /= numAz;
      cNorth /= numAz;
      const pIdx = topCentroidIdx * 3;
      positions[pIdx] = cEast;
      positions[pIdx + 1] = cNorth;
      positions[pIdx + 2] = topZ;
      normals[pIdx] = 0;
      normals[pIdx + 1] = 0;
      normals[pIdx + 2] = 1;
      st[topCentroidIdx * 2] = 0.5;
      st[topCentroidIdx * 2 + 1] = 1.0;

      for (let j = 0; j < numAz; j++) {
        const jNext = (j + 1) % numAz;
        indexList.push(topCentroidIdx, outerIdx(M, j), outerIdx(M, jNext));
      }
    }
  }

  const indices = new Uint32Array(indexList);
  return {
    positions,
    normals,
    st,
    indices,
    vertexCount: totalVertices,
    triangleCount: indices.length / 3,
    apexHeightM,
    maxEffectiveRadiusM,
    center,
    modelMatrix,
  };
}


/**
 * 6. ĐÓNG GÓI THÀNH CESIUM GEOMETRY INSTANCE
 */
export function createSamVolumeGeometryInstance(
  geom: SamVolumeGeometry,
  instanceId: string,
  layer: SamProbabilityLayer
): Cesium.GeometryInstance {
  const attributes = new Cesium.GeometryAttributes();
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: geom.positions,
  });
  attributes.normal = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: geom.normals,
  });
  attributes.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: geom.st,
  });

  const cesiumGeometry = new Cesium.Geometry({
    attributes,
    indices: geom.indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: new Cesium.BoundingSphere(
      new Cesium.Cartesian3(0, 0, geom.apexHeightM * 0.5),
      Math.max(geom.maxEffectiveRadiusM, geom.apexHeightM)
    ),
  });

  return new Cesium.GeometryInstance({
    id: `sam-vol-${instanceId}-${layer}`,
    geometry: cesiumGeometry,
    modelMatrix: geom.modelMatrix,
  });
}

/**
 * 7. XUẤT DỮ LIỆU ĐƯỜNG CONG MẶT CẮT ĐỨNG 2D (CROSS SECTION WEZ PROFILE)
 * Phục vụ vẽ trực tiếp trên RadarCrossSectionPanel
 */
export interface SamCrossSectionCurvePoint {
  altM: number;
  dMinM: number;
  dOptM: number;
  dHighM: number;
  dMaxM: number;
  dEffectiveM: number;
}

export function getSamCrossSectionProfile(
  volume: SamEngagementVolume,
  azimuthDeg: number = 0
): {
  points: SamCrossSectionCurvePoint[];
  hMinM: number;
  hMaxM: number;
  hOptM: number;
  dMaxM: number;
  dMinM: number;
  modeVi: string;
} {
  const { altitudeBands, azimuthSamples, optimalRanges, highProbRanges, nominalRanges, effectiveRanges, innerConeRadii } = volume;

  // Tìm chỉ số góc azimuth gần nhất
  let closestAzIdx = 0;
  let minDiff = 360;
  for (let j = 0; j < azimuthSamples.length; j++) {
    let diff = Math.abs(azimuthSamples[j] - azimuthDeg);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      closestAzIdx = j;
    }
  }

  const points: SamCrossSectionCurvePoint[] = altitudeBands.map((altM, k) => ({
    altM,
    dMinM: innerConeRadii[k],
    dOptM: optimalRanges[k][closestAzIdx],
    dHighM: highProbRanges[k][closestAzIdx],
    dMaxM: nominalRanges[k][closestAzIdx],
    dEffectiveM: effectiveRanges[k][closestAzIdx],
  }));

  return {
    points,
    hMinM: volume.hMinM,
    hMaxM: volume.hMaxM,
    hOptM: volume.hOptM,
    dMaxM: volume.dMaxKm * 1000,
    dMinM: volume.dMinKm * 1000,
    modeVi: volume.modeVi,
  };
}
