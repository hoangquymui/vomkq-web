import * as Cesium from 'cesium';
import type { RadarCoverageVolume, VolumeMeshOptions } from '../types/radarVolume';
import { destinationPoint } from './radarLosEngine';

// Cesium exports this helper at runtime but omits the private API from its declarations.
const verticalExaggeration = (Cesium as unknown as {
  VerticalExaggeration: { getHeight(height: number, scale: number, relativeHeight: number): number };
}).VerticalExaggeration;

function displayHeightTransform(options: VolumeMeshOptions) {
  const requestedScale = options.verticalExaggeration ?? 1;
  const requestedRelativeHeight = options.verticalExaggerationRelativeHeight ?? 0;
  const scale = Number.isFinite(requestedScale) && requestedScale >= 0 ? requestedScale : 1;
  const relativeHeight = Number.isFinite(requestedRelativeHeight) ? requestedRelativeHeight : 0;
  return (physicalHeightM: number) => verticalExaggeration.getHeight(physicalHeightM, scale, relativeHeight);
}

/** Use the same surface coordinates as the terrain sampler before converting to ENU. */
function createGeodeticPositionWriter(
  radarLat: number,
  radarLon: number,
  modelMatrix: Cesium.Matrix4,
  positions: Float64Array,
  toDisplayHeight: ReturnType<typeof displayHeightTransform>
) {
  const inverseModelMatrix = Cesium.Matrix4.inverseTransformation(modelMatrix, new Cesium.Matrix4());
  const worldPosition = new Cesium.Cartesian3();
  const localPosition = new Cesium.Cartesian3();

  return (positionIndex: number, rangeM: number, azimuthDeg: number, altitudeM: number) => {
    const destination = destinationPoint(radarLat, radarLon, rangeM, azimuthDeg);
    Cesium.Cartesian3.fromDegrees(
      destination.lon,
      destination.lat,
      toDisplayHeight(altitudeM),
      Cesium.Ellipsoid.WGS84,
      worldPosition
    );
    Cesium.Matrix4.multiplyByPoint(inverseModelMatrix, worldPosition, localPosition);
    positions[positionIndex] = localPosition.x;
    positions[positionIndex + 1] = localPosition.y;
    positions[positionIndex + 2] = localPosition.z;
    return localPosition;
  };
}

export interface RadarVolumeGeometry {
  /** Tọa độ các đỉnh (Float64Array, hệ ENU cục bộ mét, 3 giá trị/đỉnh) */
  positions: Float64Array;
  /** Vector pháp tuyến đã chuẩn hóa (Float32Array, 3 giá trị/đỉnh) */
  normals: Float32Array;
  /** Tọa độ vân bề mặt UV (Float32Array, u=azimuth (0..1), v=altitude (0..1)) */
  st: Float32Array;
  /** Chỉ số đỉnh tạo tam giác (Uint32Array) */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /** Độ cao lớn nhất của đỉnh volume so với gốc anten (m) */
  apexHeightM: number;
  /** Bán kính cực đại ngoài cùng (m) */
  maxEffectiveRadiusM: number;
  /** Bán kính trung bình ngoài cùng (m) */
  avgEffectiveRadiusM: number;
  /** Tâm radar trên Ellipsoid WGS-84 */
  center: Cesium.Cartesian3;
  /** Ma trận chuyển toạ độ ENU cục bộ sang ECEF GPU */
  modelMatrix: Cesium.Matrix4;
  mode: 'nominal' | 'terrain-aware';
}

/**
 * XÂY DỰNG HÌNH HỌC 3D DETECTION VOLUME THEO ĐỘ CAO VÀ PHƯƠNG VỊ
 * Nối các tầng lát cắt độ cao thành bề mặt 3D liền khối,
 * phản ánh chính xác sự biến dạng lõm/cắt khi sóng radar gặp núi cao (Tam Đảo, Sơn Trà...)
 */
interface SlicedBand {
  altM: number;
  outerRanges: number[];
  nominalRanges: number[];
  innerRadius: number;
}

const MAX_CAP_RADIAL_STEP_M = 2000;
const MIN_VOLUME_WIDTH_M = 0.001;

interface RadialCap {
  altitudeM: number;
  outerRanges: number[];
  innerRanges: number[];
  radialSteps: number;
  upward: boolean;
}

function createRadialCap(
  altitudeM: number,
  outerRanges: number[],
  innerRanges: number[],
  upward: boolean
): RadialCap {
  const maxWidth = Math.max(0, ...outerRanges.map((range, j) => range - innerRanges[j]));
  return {
    altitudeM,
    outerRanges,
    innerRanges,
    radialSteps: maxWidth > MIN_VOLUME_WIDTH_M ? Math.ceil(maxWidth / MAX_CAP_RADIAL_STEP_M) : 0,
    upward,
  };
}

function capVertexCount(cap: RadialCap, numAz: number): number {
  return cap.radialSteps > 0 ? (cap.radialSteps + 1) * numAz : 0;
}

/** Short radial strips follow the Earth instead of spanning a single long chord. */
function appendRadialCap(
  cap: RadialCap,
  azimuthSamples: number[],
  vertexOffset: number,
  writePosition: ReturnType<typeof createGeodeticPositionWriter>,
  normals: Float32Array,
  st: Float32Array,
  indices: number[]
): number {
  if (cap.radialSteps === 0) return 0;
  const numAz = azimuthSamples.length;
  let maxLocalHeight = -Infinity;
  for (let radial = 0; radial <= cap.radialSteps; radial++) {
    const fraction = radial / cap.radialSteps;
    for (let j = 0; j < numAz; j++) {
      const range = cap.innerRanges[j] + fraction * (cap.outerRanges[j] - cap.innerRanges[j]);
      const index = vertexOffset + radial * numAz + j;
      const positionIndex = index * 3;
      const local = writePosition(positionIndex, range, azimuthSamples[j], cap.altitudeM);
      maxLocalHeight = Math.max(maxLocalHeight, local.z);
      normals[positionIndex + 2] = cap.upward ? 1 : -1;
      st[index * 2] = j / numAz;
      st[index * 2 + 1] = cap.upward ? 1 : 0;
    }
  }
  for (let radial = 0; radial < cap.radialSteps; radial++) {
    for (let j = 0; j < numAz; j++) {
      const nextJ = (j + 1) % numAz;
      if (cap.outerRanges[j] - cap.innerRanges[j] <= MIN_VOLUME_WIDTH_M &&
          cap.outerRanges[nextJ] - cap.innerRanges[nextJ] <= MIN_VOLUME_WIDTH_M) continue;
      const p00 = vertexOffset + radial * numAz + j;
      const p01 = vertexOffset + radial * numAz + nextJ;
      const p10 = p00 + numAz;
      const p11 = p01 + numAz;
      if (cap.upward) {
        indices.push(p00, p01, p10, p10, p01, p11);
      } else {
        indices.push(p00, p10, p01, p10, p11, p01);
      }
    }
  }
  return maxLocalHeight;
}

/**
 * Trích xuất và cắt lát các tầng độ cao cho hình học 3D:
 * - Nếu selectedAltitudeM được truyền vào (> 0), chỉ lấy các tầng <= selectedAltitudeM
 * - Nếu selectedAltitudeM nằm giữa 2 tầng, nội suy tuyến tính một tầng đỉnh chính xác tại selectedAltitudeM
 * - Đảm bảo luôn trả về ít nhất 2 tầng để dựng vỏ 3D và nắp trên/đáy khép kín
 */
function getSlicedBands(
  volume: RadarCoverageVolume,
  mode: 'nominal' | 'terrain-aware',
  selectedAltitudeM?: number | null
): SlicedBand[] {
  const { altitudeBands, azimuthSamples, nominalRanges, effectiveRanges, innerConeRadii } = volume;
  const numBands = altitudeBands.length;
  const numAz = azimuthSamples.length;
  const rangeMatrix = mode === 'nominal' ? nominalRanges : effectiveRanges;
  if (numBands === 0) return [];

  // Nếu không chọn hoặc chọn >= trần cao nhất, dùng toàn bộ các tầng
  const maxAlt =
    selectedAltitudeM && selectedAltitudeM > 0
      ? selectedAltitudeM
      : altitudeBands[numBands - 1];

  const bands: SlicedBand[] = [];

  // Tìm các tầng <= maxAlt
  for (let k = 0; k < numBands; k++) {
    const alt = altitudeBands[k];
    if (alt <= maxAlt) {
      bands.push({
        altM: alt,
        outerRanges: rangeMatrix[k],
        nominalRanges: nominalRanges[k],
        innerRadius: innerConeRadii[k] || 0.1,
      });
    } else {
      break;
    }
  }

  // Nếu maxAlt lớn hơn tầng cuối cùng vừa lấy và nhỏ hơn tầng tiếp theo trong volume:
  // Tiến hành nội suy tuyến tính tầng đỉnh chính xác tại maxAlt
  if (bands.length > 0 && bands[bands.length - 1].altM < maxAlt) {
    const lastBand = bands[bands.length - 1];
    const nextIdx = bands.length;
    if (nextIdx < numBands) {
      const nextAlt = altitudeBands[nextIdx];
      const span = nextAlt - lastBand.altM;
      const t = span > 0 ? (maxAlt - lastBand.altM) / span : 0;

      const interpOuter: number[] = new Array(numAz);
      const interpNominal: number[] = new Array(numAz);
      for (let j = 0; j < numAz; j++) {
        interpOuter[j] =
          lastBand.outerRanges[j] + t * (rangeMatrix[nextIdx][j] - lastBand.outerRanges[j]);
        interpNominal[j] =
          lastBand.nominalRanges[j] + t * (nominalRanges[nextIdx][j] - lastBand.nominalRanges[j]);
      }
      const interpInner =
        (lastBand.innerRadius || 0.1) +
        t * ((innerConeRadii[nextIdx] || 0.1) - (lastBand.innerRadius || 0.1));

      bands.push({
        altM: maxAlt,
        outerRanges: interpOuter,
        nominalRanges: interpNominal,
        innerRadius: interpInner,
      });
    }
  }

  // Đảm bảo luôn có ít nhất 2 tầng để dựng vỏ 3D
  if (bands.length === 1) {
    // Nếu chỉ có 1 tầng (ví dụ chọn tầng thấp nhất 100m), thêm 1 tầng đáy thấp hơn
    const single = bands[0];
    const baseAlt = Math.max(0, Math.round(single.altM * 0.3));
    bands.unshift({
      altM: baseAlt,
      outerRanges: single.outerRanges,
      nominalRanges: single.nominalRanges,
      innerRadius: single.innerRadius,
    });
  } else if (bands.length === 0) {
    // Fallback nếu maxAlt quá nhỏ (< altitudeBands[0])
    const firstAlt = altitudeBands[0];
    bands.push({
      altM: Math.max(0, Math.round(maxAlt * 0.3)),
      outerRanges: rangeMatrix[0],
      nominalRanges: nominalRanges[0],
      innerRadius: innerConeRadii[0] || 0.1,
    });
    bands.push({
      altM: maxAlt > 0 ? maxAlt : firstAlt,
      outerRanges: rangeMatrix[0],
      nominalRanges: nominalRanges[0],
      innerRadius: innerConeRadii[0] || 0.1,
    });
  }

  return bands;
}

/**
 * XÂY DỰNG HÌNH HỌC 3D DETECTION VOLUME THEO ĐỘ CAO VÀ PHƯƠNG VỊ
 * Nối các tầng lát cắt độ cao thành bề mặt 3D liền khối,
 * phản ánh chính xác sự biến dạng lõm/cắt khi sóng radar gặp núi cao (Tam Đảo, Sơn Trà...)
 */
export function buildRadarVolumeGeometry(
  volume: RadarCoverageVolume,
  options: VolumeMeshOptions = { mode: 'terrain-aware' }
): RadarVolumeGeometry | null {
  const {
    azimuthSamples,
    radarLat,
    radarLon,
    radarAltM,
  } = volume;

  const mode = options.mode || 'terrain-aware';
  const slicedBands = getSlicedBands(volume, mode, options.selectedAltitudeM).map((band) => ({
    ...band,
    outerRanges: band.outerRanges.map((range, j) => Math.max(0.1, Math.min(range, band.nominalRanges[j]))),
  }));
  const numBands = slicedBands.length;
  const numAz = azimuthSamples.length;

  if (numBands < 2 || numAz < 3) return null;

  const showInnerCone = options.showInnerCone !== false;
  const showTopCap = options.showTopCap !== false;
  const showBottomCap = options.showBottomCap ?? (mode === 'nominal');
  const widths = slicedBands.map((band) => band.outerRanges.map((range) => range - band.innerRadius));
  if (!widths.some((row) => row.some((width) => width > MIN_VOLUME_WIDTH_M))) return null;
  const cellHasCoverage = (k: number, j: number, nextJ: number) =>
    widths[k][j] > MIN_VOLUME_WIDTH_M || widths[k][nextJ] > MIN_VOLUME_WIDTH_M ||
    widths[k + 1][j] > MIN_VOLUME_WIDTH_M || widths[k + 1][nextJ] > MIN_VOLUME_WIDTH_M;
  const makeCoverageCap = (band: SlicedBand, upward: boolean) => createRadialCap(
    band.altM,
    band.outerRanges,
    band.outerRanges.map((range) => range - band.innerRadius <= MIN_VOLUME_WIDTH_M
      ? range : showInnerCone ? Math.min(range, band.innerRadius) : 0),
    upward
  );
  const caps: RadialCap[] = [];
  if (showTopCap) caps.push(makeCoverageCap(slicedBands[numBands - 1], true));
  if (showBottomCap) caps.push(makeCoverageCap(slicedBands[0], false));

  const toDisplayHeight = displayHeightTransform(options);
  const center = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, toDisplayHeight(radarAltM));
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // Tính số lượng đỉnh cần cấp phát
  // 1. Vỏ ngoài: numBands * numAz đỉnh
  // 2. Nón mù trong (nếu bật): numBands * numAz đỉnh
  const outerVertexOffset = 0;
  const outerVertexCount = numBands * numAz;

  const innerVertexOffset = outerVertexCount;
  const innerVertexCount = showInnerCone ? numBands * numAz : 0;

  const shellVertexCount = outerVertexCount + innerVertexCount;
  const totalVertices = shellVertexCount + caps.reduce((count, cap) => count + capVertexCount(cap, numAz), 0);

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);
  const writePosition = createGeodeticPositionWriter(radarLat, radarLon, modelMatrix, positions, toDisplayHeight);

  let apexHeightM = 0;
  let maxEffectiveRadiusM = 0;
  let sumRadiusM = 0;
  let radiusSampleCount = 0;

  // A. Điền tọa độ các đỉnh Vỏ Ngoài (Outer Shell)
  for (let k = 0; k < numBands; k++) {
    const band = slicedBands[k];
    const altM = band.altM;
    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const uCoord = j / numAz;

      const rOuter = Math.max(0.1, band.outerRanges[j]);
      if (rOuter > maxEffectiveRadiusM) maxEffectiveRadiusM = rOuter;
      sumRadiusM += rOuter;
      radiusSampleCount++;

      // Tọa độ ENU cục bộ
      const vIdx = outerVertexOffset + (k * numAz + j);
      const pIdx = vIdx * 3;
      const stIdx = vIdx * 2;

      const { x, y, z } = writePosition(pIdx, rOuter, azDeg, altM);
      apexHeightM = Math.max(apexHeightM, z);

      // Normal hướng tâm ra ngoài
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      normals[pIdx] = x / len;
      normals[pIdx + 1] = y / len;
      normals[pIdx + 2] = z / len;

      st[stIdx] = uCoord;
      st[stIdx + 1] = vCoord;
    }
  }

  // B. Điền tọa độ các đỉnh Nón Mù Bên Trong (Inner Cone)
  if (showInnerCone) {
    for (let k = 0; k < numBands; k++) {
      const band = slicedBands[k];
      const altM = band.altM;
      const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

      for (let j = 0; j < numAz; j++) {
        const azDeg = azimuthSamples[j];
        const uCoord = j / numAz;
        const rInner = Math.min(band.outerRanges[j], Math.max(0.1, band.innerRadius));

        const vIdx = innerVertexOffset + (k * numAz + j);
        const pIdx = vIdx * 3;
        const stIdx = vIdx * 2;

        const { x, y, z } = writePosition(pIdx, rInner, azDeg, altM);
        apexHeightM = Math.max(apexHeightM, z);

        // Normal hướng vào trong nón mù
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        normals[pIdx] = -x / len;
        normals[pIdx + 1] = -y / len;
        normals[pIdx + 2] = z / len;

        st[stIdx] = uCoord;
        st[stIdx + 1] = vCoord;
      }
    }
  }

  // C. Dựng các tam giác chỉ số (Indices)
  const indexList: number[] = [];

  // 1. Nối các tầng vỏ ngoài (Outer Shell Quads)
  for (let k = 0; k < numBands - 1; k++) {
    const rowCurrent = outerVertexOffset + k * numAz;
    const rowNext = outerVertexOffset + (k + 1) * numAz;

    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;
      if (!cellHasCoverage(k, j, jNext)) continue;

      const p00 = rowCurrent + j;
      const p01 = rowCurrent + jNext;
      const p10 = rowNext + j;
      const p11 = rowNext + jNext;

      // Tam giác 1 & 2 mặt ngoài (thứ tự ngược chiều kim đồng hồ nhìn từ ngoài)
      indexList.push(p00, p01, p10);
      indexList.push(p10, p01, p11);
    }
  }

  // 2. Nối các tầng nón mù bên trong (Inner Cone Quads)
  if (showInnerCone) {
    for (let k = 0; k < numBands - 1; k++) {
      const rowCurrent = innerVertexOffset + k * numAz;
      const rowNext = innerVertexOffset + (k + 1) * numAz;

      for (let j = 0; j < numAz; j++) {
        const jNext = (j + 1) % numAz;
        if (!cellHasCoverage(k, j, jNext)) continue;

        const p00 = rowCurrent + j;
        const p01 = rowCurrent + jNext;
        const p10 = rowNext + j;
        const p11 = rowNext + jNext;

        // Mặt trong nhìn vào tâm
        indexList.push(p00, p10, p01);
        indexList.push(p10, p11, p01);
      }
    }
  }

  // Geodetic top and bottom caps, including a center when the inner cone is hidden.
  let capOffset = shellVertexCount;
  for (const cap of caps) {
    apexHeightM = Math.max(apexHeightM, appendRadialCap(cap, azimuthSamples, capOffset, writePosition, normals, st, indexList));
    capOffset += capVertexCount(cap, numAz);
  }

  const indices = new Uint32Array(indexList);
  const triangleCount = indices.length / 3;
  const avgEffectiveRadiusM = radiusSampleCount > 0 ? sumRadiusM / radiusSampleCount : maxEffectiveRadiusM;

  return {
    positions,
    normals,
    st,
    indices,
    vertexCount: totalVertices,
    triangleCount,
    apexHeightM,
    maxEffectiveRadiusM,
    avgEffectiveRadiusM,
    center,
    modelMatrix,
    mode,
  };
}

/**
 * XÂY DỰNG HÌNH HỌC 3D KHỐI BÓNG RÂM CHE KHUẤT (OCCLUDED / SHADOW VOLUME)
 * Khối nêm không gian vùng mù nằm phía sau các chướng ngại vật địa hình:
 * Nối từ cự ly điểm cản (effectiveRanges) tới cự ly danh định (nominalRanges).
 * Giúp người chỉ huy quan sát trực tiếp vùng khuất sau núi khi nhìn từ phía sau chướng ngại vật.
 */
export function buildRadarOccludedVolumeGeometry(
  volume: RadarCoverageVolume,
  options: VolumeMeshOptions = { mode: 'terrain-aware' }
): RadarVolumeGeometry | null {
  const {
    azimuthSamples,
    radarLat,
    radarLon,
    radarAltM,
  } = volume;

  const slicedBands = getSlicedBands(volume, 'terrain-aware', options.selectedAltitudeM);
  const numBands = slicedBands.length;
  const numAz = azimuthSamples.length;

  if (numBands < 2 || numAz < 3) return null;

  // Kiểm tra xem có bất kỳ tia nào trong các tầng được chọn bị địa hình chắn không
  let hasAnyOcclusion = false;
  for (let k = 0; k < numBands; k++) {
    const band = slicedBands[k];
    for (let j = 0; j < numAz; j++) {
      if (band.nominalRanges[j] - band.outerRanges[j] > 150) {
        hasAnyOcclusion = true;
        break;
      }
    }
    if (hasAnyOcclusion) break;
  }

  if (!hasAnyOcclusion) return null;

  const toDisplayHeight = displayHeightTransform(options);
  const center = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, toDisplayHeight(radarAltM));
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // Mỗi đỉnh trong lưới shadow bao gồm:
  // - Vỏ trong (Mặt sau của vật cản): tại r = band.outerRanges[j] (effective)
  // - Vỏ ngoài (Biên cự ly lý thuyết): tại r = band.nominalRanges[j] (nominal)
  const innerVertexOffset = 0;
  const outerVertexOffset = numBands * numAz;
  const shellVertexCount = numBands * numAz * 2;
  const makeShadowCap = (band: SlicedBand, upward: boolean) => {
    const innerRanges = band.outerRanges.map((range) => Math.max(0.1, range));
    const outerRanges = band.nominalRanges.map((range, j) =>
      range - innerRanges[j] > 150 ? range : innerRanges[j]);
    return createRadialCap(band.altM, outerRanges, innerRanges, upward);
  };
  const caps: RadialCap[] = [];
  if (options.showTopCap !== false) caps.push(makeShadowCap(slicedBands[numBands - 1], true));
  if (options.showBottomCap === true) caps.push(makeShadowCap(slicedBands[0], false));
  const totalVertices = shellVertexCount + caps.reduce((count, cap) => count + capVertexCount(cap, numAz), 0);

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);
  const writePosition = createGeodeticPositionWriter(radarLat, radarLon, modelMatrix, positions, toDisplayHeight);

  let apexHeightM = 0;
  let maxEffectiveRadiusM = 0;

  for (let k = 0; k < numBands; k++) {
    const band = slicedBands[k];
    const altM = band.altM;
    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const uCoord = j / numAz;

      const rEff = Math.max(0.1, band.outerRanges[j]);
      const rNom = band.nominalRanges[j] - rEff > 150 ? band.nominalRanges[j] : rEff;

      if (rNom > maxEffectiveRadiusM) maxEffectiveRadiusM = rNom;

      // 1. Đỉnh mặt trong (Inner shell at obstacle)
      const inIdx = innerVertexOffset + (k * numAz + j);
      const inP = inIdx * 3;
      const inST = inIdx * 2;

      const { x: inX, y: inY, z: inZ } = writePosition(inP, rEff, azDeg, altM);
      apexHeightM = Math.max(apexHeightM, inZ);

      const inLen = Math.sqrt(inX * inX + inY * inY + inZ * inZ) || 1;
      normals[inP] = inX / inLen;
      normals[inP + 1] = inY / inLen;
      normals[inP + 2] = inZ / inLen;

      st[inST] = uCoord;
      st[inST + 1] = vCoord;

      // 2. Đỉnh mặt ngoài (Outer shell at nominal range)
      const outIdx = outerVertexOffset + (k * numAz + j);
      const outP = outIdx * 3;
      const outST = outIdx * 2;

      const { x: outX, y: outY, z: outZ } = writePosition(outP, rNom, azDeg, altM);
      apexHeightM = Math.max(apexHeightM, outZ);

      const outLen = Math.sqrt(outX * outX + outY * outY + outZ * outZ) || 1;
      normals[outP] = outX / outLen;
      normals[outP + 1] = outY / outLen;
      normals[outP + 2] = outZ / outLen;

      st[outST] = uCoord;
      st[outST + 1] = vCoord;
    }
  }

  const indexList: number[] = [];

  // Tạo các tam giác cho các ô có bóng râm (nominal - effective > 150m)
  for (let k = 0; k < numBands - 1; k++) {
    const bandK = slicedBands[k];
    const bandKNext = slicedBands[k + 1];
    const inRowCurrent = innerVertexOffset + k * numAz;
    const inRowNext = innerVertexOffset + (k + 1) * numAz;

    const outRowCurrent = outerVertexOffset + k * numAz;
    const outRowNext = outerVertexOffset + (k + 1) * numAz;

    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;

      // Kiểm tra xem ô này có bị che khuất không
      const occ00 = bandK.nominalRanges[j] - bandK.outerRanges[j] > 150;
      const occ01 = bandK.nominalRanges[jNext] - bandK.outerRanges[jNext] > 150;
      const occ10 = bandKNext.nominalRanges[j] - bandKNext.outerRanges[j] > 150;
      const occ11 = bandKNext.nominalRanges[jNext] - bandKNext.outerRanges[jNext] > 150;

      if (!occ00 && !occ01 && !occ10 && !occ11) {
        continue;
      }

      // Mặt ngoài của vùng mù (Outer Shell Quads)
      const o00 = outRowCurrent + j;
      const o01 = outRowCurrent + jNext;
      const o10 = outRowNext + j;
      const o11 = outRowNext + jNext;
      indexList.push(o00, o01, o10);
      indexList.push(o10, o01, o11);

      // Mặt trong của vùng mù (Inner Shell Quads - mặt sườn núi)
      const i00 = inRowCurrent + j;
      const i01 = inRowCurrent + jNext;
      const i10 = inRowNext + j;
      const i11 = inRowNext + jNext;
      indexList.push(i00, i10, i01);
      indexList.push(i10, i11, i01);

      // Vách bên nếu ô liền kề không bị che khuất (Radial Side Walls)
      const prevJ = (j - 1 + numAz) % numAz;
      const prevOcc =
        bandK.nominalRanges[prevJ] - bandK.outerRanges[prevJ] > 150 ||
        bandKNext.nominalRanges[prevJ] - bandKNext.outerRanges[prevJ] > 150;
      if (!prevOcc) {
        // Vách bên trái
        indexList.push(i00, o00, i10);
        indexList.push(i10, o00, o10);
      }

      const nextOcc =
        bandK.nominalRanges[(jNext + 1) % numAz] - bandK.outerRanges[(jNext + 1) % numAz] > 150 ||
        bandKNext.nominalRanges[(jNext + 1) % numAz] - bandKNext.outerRanges[(jNext + 1) % numAz] > 150;
      if (!nextOcc) {
        // Vách bên phải
        indexList.push(i01, i11, o01);
        indexList.push(i11, o11, o01);
      }
    }
  }

  let capOffset = shellVertexCount;
  for (const cap of caps) {
    apexHeightM = Math.max(apexHeightM, appendRadialCap(cap, azimuthSamples, capOffset, writePosition, normals, st, indexList));
    capOffset += capVertexCount(cap, numAz);
  }
  if (indexList.length === 0) return null;

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
    avgEffectiveRadiusM: maxEffectiveRadiusM,
    center,
    modelMatrix,
    mode: 'terrain-aware',
  };
}

/**
 * Đóng gói RadarVolumeGeometry thành Cesium.GeometryInstance
 * Sử dụng ComponentDatatype.DOUBLE để GPU Cesium render chính xác ở mọi cự ly
 */
export function createRadarVolumeGeometryInstance(
  geom: RadarVolumeGeometry,
  instanceId: string = 'radar-volume'
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
    boundingSphere: Cesium.BoundingSphere.fromVertices(geom.positions),
  });

  return new Cesium.GeometryInstance({
    id: `radar-vol-${instanceId}`,
    geometry: cesiumGeometry,
    modelMatrix: geom.modelMatrix,
  });
}

/**
 * Đóng gói khối bóng râm Occluded Volume thành Cesium.GeometryInstance
 */
export function createRadarOccludedGeometryInstance(
  geom: RadarVolumeGeometry,
  instanceId: string = 'radar-occluded'
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
    boundingSphere: Cesium.BoundingSphere.fromVertices(geom.positions),
  });

  return new Cesium.GeometryInstance({
    id: `radar-occ-${instanceId}`,
    geometry: cesiumGeometry,
    modelMatrix: geom.modelMatrix,
  });
}
