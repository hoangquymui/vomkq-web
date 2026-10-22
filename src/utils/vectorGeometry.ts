/**
 * HÌNH HỌC CỰ LY & DIỆN TÍCH CHO LỚP VECTƠ OFFLINE
 * =================================================
 *
 * Vai trò: biến "hình học" của nhà / sông / suối / rừng thành **số đo** mà hệ thống
 * phân tích được:
 *   - cự ly thật từ 1 điểm (vị trí khí tài) tới đối tượng gần nhất (km),
 *   - diện tích (km²) để tính mật độ dân cư và tỷ lệ chiếm mặt đất,
 *   - chiều dài (km) để đo "vùng này có bao nhiêu km suối chảy qua".
 *
 * VÌ SAO PHẢI TÍNH CỰ LY THẬT THAY VÌ DÙNG CỰ LY TỚI TÂM
 *   Một ngôi nhà dài 50 m nếu chỉ lấy centroid thì cách khí tài có thể báo 0.05 km,
 *   trong khi thực tế chỉ 0.02 km. Với sông rộng vài trăm mét, lệch này quyết định
 *   "cái này có nằm trong tầm phủ không".
 *
 * CHIẾN LƯỢC HÌNH HỌC
 *   Mọi phép tính dùng phép chiếu tương đối (equirectangular) quanh tâm vùng quan tâm:
 *       eastKm  = Δlon · cos(lat₀) · R·π/180
 *       northKm = Δlat · R·π/180
 *   Ở cỡ bán kính vài chục km, sai số do độ cong Trái Đất < 0.1% - dưới ngưỡng có ý
 *   nghĩa cho bài toán phủ sóng. Cách này nhanh hơn nhiều lần so với công thức
 *   cross-track trên cầu cho từng đoạn, và cho phép dùng shoelace cho diện tích.
 */

import type { VectorBounds, VectorGeometry } from '../types/vectorFeature';
import { calculateHaversineDistanceKm } from './geo';

/** Bán kính Trái Đất (km) - dùng cho cả phép chiếu lẫn cự ly. */
const EARTH_RADIUS_KM = 6371.0;

/** 1 điểm toạ độ WGS-84 (độ thập phân). */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Cặp toạ độ trên mặt phẳng cục bộ: [east, north], đơn vị km. */
type LocalKm = [number, number];

/** Chuỗi toạ độ dạng GeoJSON: mảng cặp [lon, lat]. */
type CoordPair = readonly [number, number];

/**
 * Chiếu 1 điểm toạ độ về mặt phẳng cục bộ (km) lấy `center` làm gốc.
 * Đây là hàm nền cho mọi phép tính khoảng cách/diện tích bên dưới.
 */
export function projectToLocalKm(point: LatLon, center: LatLon): LocalKm {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const east = ((point.lon - center.lon) * Math.PI * EARTH_RADIUS_KM * cosLat) / 180;
  const north = ((point.lat - center.lat) * Math.PI * EARTH_RADIUS_KM) / 180;
  return [east, north];
}

/** Chiếu ngược từ mặt phẳng cục bộ (km) về toạ độ WGS-84. */
export function unprojectFromLocalKm(eastKm: number, northKm: number, center: LatLon): LatLon {
  const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1e-12;
  return {
    lat: center.lat + (northKm * 180) / (Math.PI * EARTH_RADIUS_KM),
    lon: center.lon + (eastKm * 180) / (Math.PI * EARTH_RADIUS_KM * cosLat),
  };
}

/** Bình phương khoảng cách từ P tới đoạn AB, tất cả trên mặt phẳng đã chiếu. */
function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/** Vị trí điểm gần nhất nằm trên đoạn AB (trên mặt phẳng đã chiếu). */
function nearestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): LocalKm {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return [ax, ay];

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return [ax + t * dx, ay + t * dy];
}

/**
 * Khoảng cách từ 1 điểm tới 1 đoạn thẳng (km), kèm điểm gần nhất nằm trên đoạn.
 *
 * Đo trên mặt phẳng cục bộ lấy `point` làm gốc, nên chính `point` nằm tại (0, 0).
 */
export function distancePointToSegmentKm(
  point: LatLon,
  segmentStart: LatLon,
  segmentEnd: LatLon
): { distanceKm: number; nearest: LatLon } {
  const [ax, ay] = projectToLocalKm(segmentStart, point);
  const [bx, by] = projectToLocalKm(segmentEnd, point);

  const nearest = nearestPointOnSegment(0, 0, ax, ay, bx, by);
  const distanceKm = Math.sqrt(nearest[0] * nearest[0] + nearest[1] * nearest[1]);

  return { distanceKm, nearest: unprojectFromLocalKm(nearest[0], nearest[1], point) };
}

/**
 * Khoảng cách từ 1 điểm tới một polyline (chuỗi đoạn thẳng), lấy giá trị nhỏ nhất.
 * @returns khoảng cách (km) và điểm gần nhất; `nearest` là null nếu polyline rỗng.
 */
export function distanceToPolylineKm(
  point: LatLon,
  coords: readonly CoordPair[]
): { distanceKm: number; nearest: LatLon | null } {
  if (coords.length === 0) return { distanceKm: Infinity, nearest: null };

  if (coords.length === 1) {
    const [lon, lat] = coords[0];
    return {
      distanceKm: calculateHaversineDistanceKm(point.lat, point.lon, lat, lon),
      nearest: { lat, lon },
    };
  }

  let bestDistance = Infinity;
  let bestNearest: LatLon | null = null;

  for (let i = 0; i + 1 < coords.length; i++) {
    const [lonA, latA] = coords[i];
    const [lonB, latB] = coords[i + 1];
    const result = distancePointToSegmentKm(
      point,
      { lat: latA, lon: lonA },
      { lat: latB, lon: lonB }
    );
    if (result.distanceKm < bestDistance) {
      bestDistance = result.distanceKm;
      bestNearest = result.nearest;
    }
  }

  return { distanceKm: bestDistance, nearest: bestNearest };
}

/**
 * Test điểm có nằm trong đa giác không (thuật toán ray casting).
 * `ring` là vòng ngoài cùng, đã khép kín (điểm đầu trùng điểm cuối).
 *
 * Lưu ý: phép chiếu lấy chính `point` làm gốc nên điểm test luôn nằm tại (0, 0).
 */
export function pointInPolygon(point: LatLon, ring: readonly CoordPair[]): boolean {
  if (ring.length < 3) return false;

  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lonI, latI] = ring[i];
    const [lonJ, latJ] = ring[j];
    const [xi, yi] = projectToLocalKm({ lat: latI, lon: lonI }, point);
    const [xj, yj] = projectToLocalKm({ lat: latJ, lon: lonJ }, point);

    // Đoạn (i→j) có cắt tia ngang trục x tại x = 0 không?
    const straddles = yi > 0 !== yj > 0;
    if (straddles && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Cự ly từ 1 điểm tới hình học bất kỳ (km), kèm điểm gần nhất trên hình học.
 *
 * - `Point`      : khoảng cách trực tiếp.
 * - `LineString` : khoảng cách nhỏ nhất tới bất kỳ đoạn nào của tuyến.
 * - `Polygon`    : 0 nếu điểm nằm trong vùng, ngược lại là khoảng cách tới cạnh.
 */
export function distanceToGeometryKm(
  point: LatLon,
  geometry: VectorGeometry
): { distanceKm: number; nearest: LatLon | null } {
  if (geometry.type === 'Point') {
    const lon = geometry.coordinates[0];
    const lat = geometry.coordinates[1];
    return {
      distanceKm: calculateHaversineDistanceKm(point.lat, point.lon, lat, lon),
      nearest: { lat, lon },
    };
  }

  if (geometry.type === 'LineString') {
    return distanceToPolylineKm(point, geometry.coordinates);
  }

  const outerRing = geometry.coordinates[0];
  if (pointInPolygon(point, outerRing)) {
    return { distanceKm: 0, nearest: { lat: point.lat, lon: point.lon } };
  }
  return distanceToPolylineKm(point, outerRing);
}

/** Tổng chiều dài của polyline (km) - cộng dồn từng đoạn bằng haversine. */
function polylineLengthKm(coords: readonly CoordPair[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    total += calculateHaversineDistanceKm(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0]
    );
  }
  return total;
}

/**
 * Chiều dài hình học (km).
 * Với `Polygon`, trả về chu vi (tổng các vòng) - dùng để ước lượng "đường bao quanh
 * vùng đất canh tác" hoặc bờ hồ.
 */
export function geometryLengthKm(geometry: VectorGeometry): number {
  if (geometry.type === 'Point') return 0;
  if (geometry.type === 'Polygon') {
    let total = 0;
    for (const ring of geometry.coordinates) total += polylineLengthKm(ring);
    return total;
  }
  return polylineLengthKm(geometry.coordinates);
}

/**
 * Diện tích đa giác (km²) bằng công thức shoelace trên mặt phẳng cục bộ.
 * Các lỗ (vòng trong) được trừ đi vì có chiều ngược.
 * Với `Point`/`LineString` luôn trả 0.
 */
export function geometryAreaKm2(geometry: VectorGeometry): number {
  if (geometry.type !== 'Polygon') return 0;

  const outer = geometry.coordinates[0];
  if (outer.length < 3) return 0;

  // Gốc chiếu = trung bình đỉnh vòng ngoài; điểm gốc nằm giữa vùng nên sai số nhỏ
  let meanLat = 0;
  let meanLon = 0;
  for (const [lon, lat] of outer) {
    meanLat += lat;
    meanLon += lon;
  }
  const center: LatLon = { lat: meanLat / outer.length, lon: meanLon / outer.length };

  const ringAreaKm2 = (ring: readonly CoordPair[]): number => {
    if (ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = projectToLocalKm({ lat: ring[i][1], lon: ring[i][0] }, center);
      const [xj, yj] = projectToLocalKm({ lat: ring[j][1], lon: ring[j][0] }, center);
      sum += xj * yi - xi * yj;
    }
    return Math.abs(sum) / 2;
  };

  let area = ringAreaKm2(outer);
  for (let i = 1; i < geometry.coordinates.length; i++) {
    area -= ringAreaKm2(geometry.coordinates[i]);
  }

  return Math.max(0, area);
}

/** Bounding box của hình học (độ). Trả null nếu hình học không có điểm hợp lệ. */
export function computeGeometryBounds(geometry: VectorGeometry): VectorBounds | null {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  let found = false;

  const visit = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    found = true;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  };

  if (geometry.type === 'Point') {
    visit(geometry.coordinates[0], geometry.coordinates[1]);
  } else if (geometry.type === 'LineString') {
    for (const [lon, lat] of geometry.coordinates) visit(lon, lat);
  } else {
    for (const ring of geometry.coordinates) {
      for (const [lon, lat] of ring) visit(lon, lat);
    }
  }

  return found ? { minLat, minLon, maxLat, maxLon } : null;
}

/**
 * Tâm hình học - 1 điểm đại diện, dùng để gắn nhãn trên bản đồ.
 * Với `Polygon` dùng trung bình đỉnh: ở đây chỉ dùng để đặt nhãn nên chấp nhận được.
 *
 * LƯU Ý QUAN TRỌNG: vòng khép kín có điểm đầu trùng điểm cuối, nên phải loại điểm lặp
 * đi trước khi tính trung bình. Nếu không, góc đầu của mọi đa giác bị tính 2 lần và
 * tâm lệch về góc đó (với hình vuông 5 điểm, lệch tới 20% cạnh - đủ để đặt nhãn sai chỗ).
 */
export function geometryCentroid(geometry: VectorGeometry): LatLon | null {
  if (geometry.type === 'Point') {
    return { lat: geometry.coordinates[1], lon: geometry.coordinates[0] };
  }

  let coords: readonly CoordPair[];
  if (geometry.type === 'LineString') {
    coords = geometry.coordinates;
  } else {
    // Bỏ điểm cuối nếu trùng điểm đầu (đặc tính của vòng khép kín)
    const ring = geometry.coordinates[0];
    const first = ring[0];
    const last = ring[ring.length - 1];
    const isClosed = first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
    coords = isClosed ? ring.slice(0, -1) : ring;
  }

  if (coords.length === 0) return null;

  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }

  return { lat: sumLat / coords.length, lon: sumLon / coords.length };
}

/**
 * Rút gọn hình học bằng Douglas-Peucker với sai số cho phép (km).
 * Dùng khi nhúng hình học vào prompt AI (giảm số token) hoặc giảm tải khi vẽ.
 * Điểm đầu và điểm cuối luôn được giữ.
 */
export function simplifyGeometry(geometry: VectorGeometry, toleranceKm: number): VectorGeometry {
  if (toleranceKm <= 0 || geometry.type === 'Point') return geometry;

  const simplifyRing = (coords: readonly CoordPair[]): [number, number][] => {
    if (coords.length <= 2) return coords.map((c) => [c[0], c[1]] as [number, number]);

    let meanLat = 0;
    let meanLon = 0;
    for (const [lon, lat] of coords) {
      meanLat += lat;
      meanLon += lon;
    }
    const center: LatLon = { lat: meanLat / coords.length, lon: meanLon / coords.length };
    const projected = coords.map(([lon, lat]) => projectToLocalKm({ lat, lon }, center));

    const keep = new Uint8Array(coords.length);
    keep[0] = 1;
    keep[coords.length - 1] = 1;

    const toleranceSq = toleranceKm * toleranceKm;
    const stack: [number, number][] = [[0, coords.length - 1]];

    while (stack.length > 0) {
      const [start, end] = stack.pop()!;
      if (end - start < 2) continue;

      let maxDist = -1;
      let maxIndex = -1;
      for (let i = start + 1; i < end; i++) {
        const dist = pointToSegmentDistanceSq(
          projected[i][0],
          projected[i][1],
          projected[start][0],
          projected[start][1],
          projected[end][0],
          projected[end][1]
        );
        if (dist > maxDist) {
          maxDist = dist;
          maxIndex = i;
        }
      }

      if (maxDist > toleranceSq && maxIndex > 0) {
        keep[maxIndex] = 1;
        stack.push([start, maxIndex], [maxIndex, end]);
      }
    }

    const out: [number, number][] = [];
    for (let i = 0; i < coords.length; i++) {
      if (keep[i]) out.push([coords[i][0], coords[i][1]]);
    }
    return out;
  };

  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: simplifyRing(geometry.coordinates) };
  }

  const rings = geometry.coordinates.map(simplifyRing);
  // Vòng khép kín rút gọn còn dưới 4 điểm thì hình học hỏng -> giữ nguyên
  if (rings.some((ring) => ring.length < 4)) return geometry;
  return { type: 'Polygon', coordinates: rings };
}
