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
export function buildRadarVolumeGeometry(
  volume: RadarCoverageVolume,
  options: VolumeMeshOptions = { mode: 'terrain-aware' }
): RadarVolumeGeometry | null {
  const {
    altitudeBands,
    azimuthSamples,
    nominalRanges,
    effectiveRanges,
    innerConeRadii,
    radarLat,
    radarLon,
    radarAltM,
  } = volume;

  const numBands = altitudeBands.length;
  const numAz = azimuthSamples.length;

  if (numBands < 2 || numAz < 3) return null;

  const mode = options.mode || 'terrain-aware';
  const rangeMatrix = mode === 'nominal' ? nominalRanges : effectiveRanges;

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
    const altM = altitudeBands[k];
    // Độ cao z so với vị trí anten radar
    const z = Math.max(0, altM - radarAltM);
    if (z > apexHeightM) apexHeightM = z;

    const vCoord = numBands > 1 ? k / (numBands - 1) : 0;

    for (let j = 0; j < numAz; j++) {
      const azDeg = azimuthSamples[j];
      const azRad = (azDeg * Math.PI) / 180;
      const uCoord = j / numAz;

      const rOuter = Math.max(0.1, rangeMatrix[k][j]);
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
      const altM = altitudeBands[k];
      const z = Math.max(0, altM - radarAltM);
      const rInner = Math.max(0.1, innerConeRadii[k] || 0.1);
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
