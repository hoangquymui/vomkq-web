/**
 * HÌNH HỌC VÒM PHỦ SÓNG RADAR (port trung thực từ dự án Unity VomKQ_test)
 *
 * Được port nguyên trạng sang vpk từ `vomkq-web/src/utils/radarDomeGeometry.ts`
 * (spec: vomkq-web/docs/dome-video-match/README.md mục 3 & 5).
 *
 * Nguồn tham chiếu (chỉ đọc, KHÔNG sửa):
 * - Assets/Script/Map/RadarDomeMeshRenderer.cs   -> BuildFallbackDome / BuildDome / BuildSurfaceTriangles
 * - Assets/Script/Map/RadarCoverageData.cs       -> DirectionFromAngles / GetRangeAtElevation
 *
 * Quy ước toạ độ (đã đối chiếu với Unity):
 *   Unity DirectionFromAngles(az, elev) = (sin(az)*cos(el), sin(el), cos(az)*cos(el))
 *   Unity: x = phải, y = LÊN, z = tới trước. Với az = 0 -> hướng +Z (Bắc), az = 90 -> hướng +X (Đông).
 *   Web dùng hệ ENU cục bộ của Cesium (x = East, y = North, z = Up) nên ánh xạ:
 *     east  = sin(az) * cos(elev)
 *     north = cos(az) * cos(elev)
 *     up    = sin(elev)
 *   => bearing Bắc, chiều kim đồng hồ, khớp với `destinationPoint(lat, lon, dist, bearingDeg)`
 *      đang dùng trong radarLosEngine.ts.
 *
 * Bán kính tại (az, elev):
 *   Rprofile = getProfileMaxRange(profile, elev, instance.rangeKm) * 1000      (m)
 *   H        = coverageHeightKm * 1000                                          (m)
 *   elev <= 0.01  ->  radius = Rprofile
 *   elev  > 0.01  ->  radius = min(Rprofile, H / sin(elevRad))
 *                     (chính là MaxRangeAtCoverageHeight trong Unity)
 *
 * Toạ độ đỉnh được trả về dạng Float64 trong hệ ENU CỤC BỘ (nhỏ, gần gốc) kèm `modelMatrix`
 * để Cesium chuyển sang ECEF bằng GPU RTE (EncodedCartesian3) -> không mất chính xác ở
 * cự ly hàng trăm km. Vì vậy attribute `position` phải là ComponentDatatype.DOUBLE
 * (xem createRadarDomeGeometryInstance).
 */
import * as Cesium from 'cesium';
import type { EquipmentInstance } from '../types/equipment';
import type { RadarCoverageField, RayCoverageData } from '../types/radarCoverage';
import { getProfileMaxRange } from './radarMath';
import { EQUIPMENT_TEMPLATES } from '../data/equipmentTemplates';

/** Số phân đoạn phương vị mặc định — Unity RadarDomeMeshRenderer.azimuthSegments = 96 */
export const DOME_DEFAULT_AZIMUTH_SEGMENTS = 96;
/** Số vòng góc tà mặc định — Unity RadarDomeMeshRenderer.elevationRings = 12 */
export const DOME_DEFAULT_ELEVATION_RINGS = 12;
/** Biên hợp lệ của số phân đoạn phương vị (theo yêu cầu UI: 32..192) */
export const DOME_MIN_AZIMUTH_SEGMENTS = 32;
export const DOME_MAX_AZIMUTH_SEGMENTS = 192;
/** Biên hợp lệ của số vòng góc tà (theo yêu cầu UI: 4..32) */
export const DOME_MIN_ELEVATION_RINGS = 4;
export const DOME_MAX_ELEVATION_RINGS = 32;
/** Số điểm của vòng chân đế mặt đất — Unity CoverageFootprint LineRenderer.positionCount = 96 */
export const DOME_FOOTPRINT_SEGMENTS = 96;
/** Bán kính tối thiểu — Unity: Mathf.Clamp(range, 0.25f, maxRange) */
export const DOME_MIN_RADIUS_M = 0.25;
/** Ngưỡng góc tà để bỏ qua phép chia sin (độ) — Unity: elev <= 0.01f */
const ELEVATION_SIN_THRESHOLD_DEG = 0.01;

export interface RadarDomeGeometryOptions {
  /** Số phân đoạn phương vị (mặc định 96) */
  azimuthSegments?: number;
  /** Số vòng góc tà (mặc định 12) */
  elevationRings?: number;
  /**
   * Cắt vòm theo địa hình: bán kính bị giới hạn bởi `visibleEndM` của tia LOS tương ứng.
   * Mặc định false (vòm lý tưởng, giống video tham chiếu).
   */
  terrainMasked?: boolean;
}

export interface RadarDomeGeometry {
  /** Toạ độ đỉnh, Float64, hệ ENU cục bộ, 3 thành phần/đỉnh */
  positions: Float64Array;
  /** Normal GIẢ = hướng xuyên tâm từ tâm radar tới đỉnh (đã chuẩn hoá), 3 thành phần/đỉnh */
  normals: Float32Array;
  /** UV: u = azFraction (0..1), v = heightFraction (0..1), 2 thành phần/đỉnh */
  st: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /** Độ cao lớn nhất của đỉnh vòm so với gốc ăng-ten (m) */
  apexHeightM: number;
  /** Bán kính lớn nhất của vòng đáy (vòng góc tà nhỏ nhất) (m) */
  baseRadiusM: number;
  azimuthSegments: number;
  elevationRings: number;
  /** Tâm radar (gốc ăng-ten) trên ellipsoid WGS-84 */
  center: Cesium.Cartesian3;
  /** Ma trận ENU tại tâm: chuyển toạ độ cục bộ trong `positions` sang ECEF */
  modelMatrix: Cesium.Matrix4;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Cự ly LOS hiệu dụng của một tia: hết tầm nếu không bị chắn, dừng ở vật cản nếu bị chắn */
function rayVisibleEndM(ray: RayCoverageData): number {
  const candidate = Number.isFinite(ray.visibleEndM) ? ray.visibleEndM : ray.maxRangeM;
  return Number.isFinite(candidate) ? candidate : 0;
}

/**
 * Bộ nội suy `visibleEndM` theo (azimuth, elevation) trên lưới thô của RadarCoverageField.
 * Lưới vòm (96 x 12) thường mịn hơn lưới field (ví dụ 72 x 24) nên phải nội suy song tuyến tính.
 * Trả về Number.POSITIVE_INFINITY khi không có dữ liệu tia (=> không cắt gì cả).
 */
function createRayRangeSampler(
  field: RadarCoverageField
): (azimuthDeg: number, elevationDeg: number) => number {
  const azimuths = Object.keys(field.azimuthRays)
    .map(Number)
    .filter((az) => Number.isFinite(az))
    .sort((a, b) => a - b);
  const azimuthCount = azimuths.length;
  const rangesByAzimuth: RayCoverageData[][] = azimuths.map(
    (az) => field.azimuthRays[az] ?? []
  );

  if (azimuthCount === 0) {
    return () => Number.POSITIVE_INFINITY;
  }

  const valueAtAzimuth = (azIndex: number, elevationDeg: number): number => {
    const rays = rangesByAzimuth[((azIndex % azimuthCount) + azimuthCount) % azimuthCount];
    if (!rays || rays.length === 0) return Number.POSITIVE_INFINITY;
    if (rays.length === 1) return rayVisibleEndM(rays[0]);

    const first = rays[0];
    if (elevationDeg <= first.elevationDeg) return rayVisibleEndM(first);
    const last = rays[rays.length - 1];
    if (elevationDeg >= last.elevationDeg) return rayVisibleEndM(last);

    for (let i = 0; i < rays.length - 1; i++) {
      const rayLow = rays[i];
      const rayHigh = rays[i + 1];
      if (elevationDeg >= rayLow.elevationDeg && elevationDeg <= rayHigh.elevationDeg) {
        const span = rayHigh.elevationDeg - rayLow.elevationDeg;
        const fraction = span > 0 ? (elevationDeg - rayLow.elevationDeg) / span : 0;
        const low = rayVisibleEndM(rayLow);
        const high = rayVisibleEndM(rayHigh);
        return low + (high - low) * fraction;
      }
    }
    return rayVisibleEndM(last);
  };

  return (azimuthDeg: number, elevationDeg: number): number => {
    if (azimuthCount === 1) return valueAtAzimuth(0, elevationDeg);

    const az = ((azimuthDeg % 360) + 360) % 360;
    let lowIndex = azimuthCount - 1;
    for (let i = 0; i < azimuthCount; i++) {
      if (azimuths[i] <= az) lowIndex = i;
      else break;
    }
    const highIndex = (lowIndex + 1) % azimuthCount;
    const azLow = azimuths[lowIndex];
    let azHigh = azimuths[highIndex];
    if (highIndex === 0) azHigh += 360;

    const span = azHigh - azLow;
    const fraction = span > 0 ? (az - azLow) / span : 0;
    const low = valueAtAzimuth(lowIndex, elevationDeg);
    const high = valueAtAzimuth(highIndex, elevationDeg);
    return low + (high - low) * fraction;
  };
}

/**
 * Dựng lưới tam giác cho vỏ vòm phủ sóng.
 *
 * @param instance Khí tài radar (nguồn: vị trí, độ cao ăng-ten, coverageHeightKm, rangeKm, profile)
 * @param field    Coverage Field từ radarLosEngine (SINGLE SOURCE OF TRUTH). Có thể null khi LOS
 *                 chưa tính xong -> khi đó dùng công thức danh nghĩa (tương đương BuildFallbackDome).
 * @returns null nếu không dựng được vòm (thiếu dải góc tà hợp lệ)
 */
export function buildRadarDomeGeometry(
  instance: EquipmentInstance,
  field: RadarCoverageField | null,
  options: RadarDomeGeometryOptions = {}
): RadarDomeGeometry | null {
  const profile =
    instance.coverageProfile ||
    EQUIPMENT_TEMPLATES.find((t) => t.id === instance.templateId)?.coverageProfile;

  // Dải góc tà: ưu tiên dải thật của Coverage Field, nếu chưa có thì lấy theo profile/khí tài.
  const minElevationDeg = field
    ? field.minElevationDeg
    : profile?.minElevationDeg ?? instance.minElevationDeg;
  const maxElevationDeg = field
    ? field.maxElevationDeg
    : profile?.maxElevationDeg ?? instance.maxElevationDeg;

  if (!Number.isFinite(minElevationDeg) || !Number.isFinite(maxElevationDeg)) return null;
  if (maxElevationDeg <= minElevationDeg) return null;

  // Unity: coverageHeight = Mathf.Max(1f, coverageHeight) — tránh mẫu số 0
  const coverageHeightM = Math.max(1, instance.coverageHeightKm * 1000);

  const azimuthSegments = clampInt(
    options.azimuthSegments ?? DOME_DEFAULT_AZIMUTH_SEGMENTS,
    DOME_MIN_AZIMUTH_SEGMENTS,
    DOME_MAX_AZIMUTH_SEGMENTS
  );
  const elevationRings = clampInt(
    options.elevationRings ?? DOME_DEFAULT_ELEVATION_RINGS,
    DOME_MIN_ELEVATION_RINGS,
    DOME_MAX_ELEVATION_RINGS
  );

  const terrainMasked = options.terrainMasked === true && field != null;
  const sampleVisibleEndM = terrainMasked && field ? createRayRangeSampler(field) : null;

  const originAltitudeM = (instance.altitude || 0) + (instance.antennaHeightAGL || 0);
  const center = Cesium.Cartesian3.fromDegrees(
    instance.longitude,
    instance.latitude,
    originAltitudeM
  );
  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);

  const ringVertexCount = (elevationRings + 1) * azimuthSegments;
  const vertexCount = ringVertexCount + 1; // +1 cho đỉnh nắp (centroid của vòng cuối)
  const positions = new Float64Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const st = new Float32Array(vertexCount * 2);

  let baseRadiusM = 0;

  for (let ring = 0; ring <= elevationRings; ring++) {
    const ringT = ring / elevationRings;
    const elevationDeg = minElevationDeg + (maxElevationDeg - minElevationDeg) * ringT;
    const elevationRad = (elevationDeg * Math.PI) / 180;
    const cosElevation = Math.cos(elevationRad);
    const sinElevation = Math.sin(elevationRad);

    for (let azimuthIndex = 0; azimuthIndex < azimuthSegments; azimuthIndex++) {
      const azimuthDeg = (azimuthIndex / azimuthSegments) * 360;
      const azimuthRad = (azimuthDeg * Math.PI) / 180;

      // 1. Cự ly tối đa theo coverage profile tại góc tà này
      let radiusM = getProfileMaxRange(profile, elevationDeg, instance.rangeKm) * 1000;

      // 2. Giới hạn theo trần độ cao phủ sóng: MaxRangeAtCoverageHeight
      if (elevationDeg > ELEVATION_SIN_THRESHOLD_DEG) {
        radiusM = Math.min(radiusM, coverageHeightM / sinElevation);
      }

      // 3. Cắt theo địa hình (tuỳ chọn, mặc định tắt)
      if (sampleVisibleEndM) {
        radiusM = Math.min(radiusM, sampleVisibleEndM(azimuthDeg, elevationDeg));
      }

      if (!Number.isFinite(radiusM)) radiusM = 0;
      radiusM = Math.max(DOME_MIN_RADIUS_M, radiusM);

      const vertexIndex = ring * azimuthSegments + azimuthIndex;
      const i3 = vertexIndex * 3;

      // Hệ ENU cục bộ: x = East, y = North, z = Up
      positions[i3] = Math.sin(azimuthRad) * cosElevation * radiusM;
      positions[i3 + 1] = Math.cos(azimuthRad) * cosElevation * radiusM;
      positions[i3 + 2] = sinElevation * radiusM;

      // Normal GIẢ = hướng xuyên tâm (đơn vị) — KHÔNG dùng normal hình học thật
      normals[i3] = Math.sin(azimuthRad) * cosElevation;
      normals[i3 + 1] = Math.cos(azimuthRad) * cosElevation;
      normals[i3 + 2] = sinElevation;

      const i2 = vertexIndex * 2;
      st[i2] = azimuthIndex / azimuthSegments;
      st[i2 + 1] = positions[i3 + 2]; // tạm lưu độ cao, chuyển sang heightFraction ở bước sau

      if (ring === 0 && radiusM > baseRadiusM) baseRadiusM = radiusM;
    }
  }

  // Độ cao đỉnh cao nhất so với gốc ăng-ten -> dùng cho heightFraction
  let apexHeightM = 0;
  for (let vertexIndex = 0; vertexIndex < ringVertexCount; vertexIndex++) {
    const up = positions[vertexIndex * 3 + 2];
    if (up > apexHeightM) apexHeightM = up;
  }
  const apexDivisor = apexHeightM > 1e-6 ? apexHeightM : 1;
  for (let vertexIndex = 0; vertexIndex < ringVertexCount; vertexIndex++) {
    const up = positions[vertexIndex * 3 + 2];
    const heightFraction = Math.min(1, Math.max(0, up / apexDivisor));
    st[vertexIndex * 2 + 1] = heightFraction;
  }

  // Nắp đỉnh: nối vòng cuối về centroid của vòng cuối (giống BuildDome của Unity).
  // KHÔNG nắp về tâm ăng-ten (Unity cố ý bỏ) để vòm không che chính khí tài.
  const topRingStart = elevationRings * azimuthSegments;
  let centroidEast = 0;
  let centroidNorth = 0;
  let centroidUp = 0;
  for (let azimuthIndex = 0; azimuthIndex < azimuthSegments; azimuthIndex++) {
    const i3 = (topRingStart + azimuthIndex) * 3;
    centroidEast += positions[i3];
    centroidNorth += positions[i3 + 1];
    centroidUp += positions[i3 + 2];
  }
  centroidEast /= azimuthSegments;
  centroidNorth /= azimuthSegments;
  centroidUp /= azimuthSegments;

  const apexVertexIndex = vertexCount - 1;
  const apexI3 = apexVertexIndex * 3;
  positions[apexI3] = centroidEast;
  positions[apexI3 + 1] = centroidNorth;
  positions[apexI3 + 2] = centroidUp;

  const centroidLength = Math.hypot(centroidEast, centroidNorth, centroidUp);
  if (centroidLength > 1e-6) {
    normals[apexI3] = centroidEast / centroidLength;
    normals[apexI3 + 1] = centroidNorth / centroidLength;
    normals[apexI3 + 2] = centroidUp / centroidLength;
  } else {
    normals[apexI3] = 0;
    normals[apexI3 + 1] = 0;
    normals[apexI3 + 2] = 1;
  }

  st[apexVertexIndex * 2] = 0.5;
  st[apexVertexIndex * 2 + 1] = Math.min(1, Math.max(0, centroidUp / apexDivisor));

  // Tam giác: lưới quad giữa các vòng + quạt nắp ở vòng cuối.
  // Chỉ sinh 1 chiều winding; renderState `cull: { enabled: false }` (tương đương `Cull Off`
  // của Unity) lo việc hiển thị cả 2 mặt nên không cần nhân đôi tam giác như Unity.
  const indices = new Uint32Array(elevationRings * azimuthSegments * 6 + azimuthSegments * 3);
  let cursor = 0;
  for (let ring = 0; ring < elevationRings; ring++) {
    const currentStart = ring * azimuthSegments;
    const nextStart = (ring + 1) * azimuthSegments;
    for (let azimuthIndex = 0; azimuthIndex < azimuthSegments; azimuthIndex++) {
      const nextAzimuthIndex = (azimuthIndex + 1) % azimuthSegments;
      const v00 = currentStart + azimuthIndex;
      const v01 = currentStart + nextAzimuthIndex;
      const v10 = nextStart + azimuthIndex;
      const v11 = nextStart + nextAzimuthIndex;

      indices[cursor++] = v00;
      indices[cursor++] = v10;
      indices[cursor++] = v11;
      indices[cursor++] = v00;
      indices[cursor++] = v11;
      indices[cursor++] = v01;
    }
  }
  for (let azimuthIndex = 0; azimuthIndex < azimuthSegments; azimuthIndex++) {
    const nextAzimuthIndex = (azimuthIndex + 1) % azimuthSegments;
    indices[cursor++] = apexVertexIndex;
    indices[cursor++] = topRingStart + azimuthIndex;
    indices[cursor++] = topRingStart + nextAzimuthIndex;
  }

  return {
    positions,
    normals,
    st,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
    apexHeightM,
    baseRadiusM,
    azimuthSegments,
    elevationRings,
    center,
    modelMatrix,
  };
}

/**
 * Bọc hình học thuần thành GeometryInstance của Cesium.
 *
 * LƯU Ý QUAN TRỌNG: attribute `position` phải khai ComponentDatatype.DOUBLE.
 * PrimitivePipeline chỉ gọi GeometryPipeline.encodeAttribute (chia high/low cho GPU RTE)
 * khi componentDatatype là DOUBLE — nhờ đó toạ độ giữ đủ độ chính xác Float64.
 */
export function createRadarDomeGeometryInstance(
  geometry: RadarDomeGeometry
): Cesium.GeometryInstance {
  const attributes = new Cesium.GeometryAttributes();
  attributes.position = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: geometry.positions,
  });
  attributes.normal = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: geometry.normals,
  });
  attributes.st = new Cesium.GeometryAttribute({
    componentDatatype: Cesium.ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: geometry.st,
  });

  const cesiumGeometry = new Cesium.Geometry({
    attributes,
    indices: geometry.indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(
      Array.from(geometry.positions)
    ),
  });

  return new Cesium.GeometryInstance({
    geometry: cesiumGeometry,
    modelMatrix: geometry.modelMatrix,
  });
}
