import * as Cesium from 'cesium';
import type { RadarCoverageVolume, VolumeMeshOptions } from '../types/radarVolume';

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
      innerRadius: Math.max(0.1, single.innerRadius * 0.3),
    });
  } else if (bands.length === 0) {
    // Fallback nếu maxAlt quá nhỏ (< altitudeBands[0])
    const firstAlt = altitudeBands[0];
    bands.push({
      altM: Math.max(0, Math.round(firstAlt * 0.3)),
      outerRanges: rangeMatrix[0],
      nominalRanges: nominalRanges[0],
      innerRadius: 0.1,
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
  const slicedBands = getSlicedBands(volume, mode, options.selectedAltitudeM);
  const numBands = slicedBands.length;
  const numAz = azimuthSamples.length;

  if (numBands < 2 || numAz < 3) return null;

  const showInnerCone = options.showInnerCone !== false;
  const showTopCap = options.showTopCap !== false;
  const showBottomCap = options.showBottomCap !== false;

  const center = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM);
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // Tính số lượng đỉnh cần cấp phát
  // 1. Vỏ ngoài: numBands * numAz đỉnh
  // 2. Nón mù trong (nếu bật): numBands * numAz đỉnh
  const outerVertexOffset = 0;
  const outerVertexCount = numBands * numAz;

  const innerVertexOffset = outerVertexCount;
  const innerVertexCount = showInnerCone ? numBands * numAz : 0;

  const totalVertices = outerVertexCount + innerVertexCount;

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);

  let apexHeightM = 0;
  let maxEffectiveRadiusM = 0;
  let sumRadiusM = 0;
  let radiusSampleCount = 0;

  // A. Điền tọa độ các đỉnh Vỏ Ngoài (Outer Shell)
  for (let k = 0; k < numBands; k++) {
    const band = slicedBands[k];
    const altM = band.altM;
    // Độ cao z so với vị trí anten radar
    const z = Math.max(0, altM - radarAltM);
    if (z > apexHeightM) apexHeightM = z;

    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const azRad = (azDeg * Math.PI) / 180;
      const uCoord = j / numAz;

      const rOuter = Math.max(0.1, band.outerRanges[j]);
      if (rOuter > maxEffectiveRadiusM) maxEffectiveRadiusM = rOuter;
      sumRadiusM += rOuter;
      radiusSampleCount++;

      // Tọa độ ENU cục bộ
      const x = rOuter * Math.sin(azRad);
      const y = rOuter * Math.cos(azRad);

      const vIdx = outerVertexOffset + (k * numAz + j);
      const pIdx = vIdx * 3;
      const stIdx = vIdx * 2;

      positions[pIdx] = x;
      positions[pIdx + 1] = y;
      positions[pIdx + 2] = z;

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
      const z = Math.max(0, altM - radarAltM);
      const rInner = Math.max(0.1, band.innerRadius || 0.1);
      const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

      for (let j = 0; j < numAz; j++) {
        const azDeg = azimuthSamples[j];
        const azRad = (azDeg * Math.PI) / 180;
        const uCoord = j / numAz;

        const x = rInner * Math.sin(azRad);
        const y = rInner * Math.cos(azRad);

        const vIdx = innerVertexOffset + (k * numAz + j);
        const pIdx = vIdx * 3;
        const stIdx = vIdx * 2;

        positions[pIdx] = x;
        positions[pIdx + 1] = y;
        positions[pIdx + 2] = z;

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

  // 3. Đậy nắp trên cùng tại H_max (Top Cap)
  if (showTopCap) {
    const topOuterRow = outerVertexOffset + (numBands - 1) * numAz;
    const topInnerRow = showInnerCone ? innerVertexOffset + (numBands - 1) * numAz : -1;

    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;

      const out0 = topOuterRow + j;
      const out1 = topOuterRow + jNext;

      if (topInnerRow >= 0) {
        const in0 = topInnerRow + j;
        const in1 = topInnerRow + jNext;
        indexList.push(out0, in0, out1);
        indexList.push(out1, in0, in1);
      }
    }
  }

  // 4. Đáy tầng thấp nhất (Bottom Cap)
  if (showBottomCap) {
    const botOuterRow = outerVertexOffset;
    const botInnerRow = showInnerCone ? innerVertexOffset : -1;

    for (let j = 0; j < numAz; j++) {
      const jNext = (j + 1) % numAz;

      const out0 = botOuterRow + j;
      const out1 = botOuterRow + jNext;

      if (botInnerRow >= 0) {
        const in0 = botInnerRow + j;
        const in1 = botInnerRow + jNext;
        indexList.push(out0, out1, in0);
        indexList.push(out1, in1, in0);
      }
    }
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

  const center = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM);
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  // Mỗi đỉnh trong lưới shadow bao gồm:
  // - Vỏ trong (Mặt sau của vật cản): tại r = band.outerRanges[j] (effective)
  // - Vỏ ngoài (Biên cự ly lý thuyết): tại r = band.nominalRanges[j] (nominal)
  const innerVertexOffset = 0;
  const outerVertexOffset = numBands * numAz;
  const totalVertices = numBands * numAz * 2;

  const positions = new Float64Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const st = new Float32Array(totalVertices * 2);

  let apexHeightM = 0;
  let maxEffectiveRadiusM = 0;

  for (let k = 0; k < numBands; k++) {
    const band = slicedBands[k];
    const altM = band.altM;
    const z = Math.max(0, altM - radarAltM);
    if (z > apexHeightM) apexHeightM = z;
    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const azRad = (azDeg * Math.PI) / 180;
      const uCoord = j / numAz;

      const rEff = Math.max(0.1, band.outerRanges[j]);
      const rNom = Math.max(rEff, band.nominalRanges[j]);

      if (rNom > maxEffectiveRadiusM) maxEffectiveRadiusM = rNom;

      // 1. Đỉnh mặt trong (Inner shell at obstacle)
      const inIdx = innerVertexOffset + (k * numAz + j);
      const inP = inIdx * 3;
      const inST = inIdx * 2;

      const inX = rEff * Math.sin(azRad);
      const inY = rEff * Math.cos(azRad);
      positions[inP] = inX;
      positions[inP + 1] = inY;
      positions[inP + 2] = z;

      const inLen = Math.sqrt(inX * inX + inY * inY + z * z) || 1;
      normals[inP] = inX / inLen;
      normals[inP + 1] = inY / inLen;
      normals[inP + 2] = z / inLen;

      st[inST] = uCoord;
      st[inST + 1] = vCoord;

      // 2. Đỉnh mặt ngoài (Outer shell at nominal range)
      const outIdx = outerVertexOffset + (k * numAz + j);
      const outP = outIdx * 3;
      const outST = outIdx * 2;

      const outX = rNom * Math.sin(azRad);
      const outY = rNom * Math.cos(azRad);
      positions[outP] = outX;
      positions[outP + 1] = outY;
      positions[outP + 2] = z;

      const outLen = Math.sqrt(outX * outX + outY * outY + z * z) || 1;
      normals[outP] = outX / outLen;
      normals[outP + 1] = outY / outLen;
      normals[outP + 2] = z / outLen;

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

      // Nắp trên (Top quad của band trên cùng)
      if (k === numBands - 2) {
        indexList.push(o10, i10, o11);
        indexList.push(o11, i10, i11);
      }

      // Nắp đáy (Bottom quad của band dưới cùng)
      if (k === 0) {
        indexList.push(o00, o01, i00);
        indexList.push(o01, i01, i00);
      }

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
    boundingSphere: new Cesium.BoundingSphere(
      new Cesium.Cartesian3(0, 0, geom.apexHeightM * 0.5),
      Math.max(geom.maxEffectiveRadiusM, geom.apexHeightM)
    ),
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
    boundingSphere: new Cesium.BoundingSphere(
      new Cesium.Cartesian3(0, 0, geom.apexHeightM * 0.5),
      Math.max(geom.maxEffectiveRadiusM, geom.apexHeightM)
    ),
  });

  return new Cesium.GeometryInstance({
    id: `radar-occ-${instanceId}`,
    geometry: cesiumGeometry,
    modelMatrix: geom.modelMatrix,
  });
}
