/**
 * ĐỘNG CƠ DÒ TÌM HẺM NÚI ĐIỂM MÙ & MÔ PHỎNG ĐỘT KÍCH UAV (NAP-OF-THE-EARTH INFILTRATION ENGINE)
 * =========================================================================================
 * 
 * Chức năng:
 * 1. Phân tích dữ liệu Line-of-Sight từ RadarCoverageField để phát hiện các "Hành lang chết / Hẻm núi mù radar".
 * 2. Tự động sinh đường bay luồn lách khe núi bám địa hình (Nap-of-the-Earth) hướng về đài radar hoặc mục tiêu.
 * 3. Đánh giá trạng thái bị radar quét thấy (Detected) hay ẩn trong bóng núi (Stealth).
 * 4. Kiểm tra giao cắt với vòm hỏa lực đón lõng của các tổ MANPADS / Pháo cao xạ / Đài quan sát đã bố trí.
 * 5. AI Cố vấn đề xuất điểm cao chốt chặn tối ưu để bịt kín các khe mù.
 * 
 * Tuân thủ Project Development Rules:
 * Mọi thông số quan trọng đều được ghi chú rõ ràng về tên, kiểu dữ liệu, đơn vị và nguồn gốc.
 */

import type { RadarCoverageField, RayCoverageData } from '../types/radarCoverage';
import type {
  InfiltrationSimulationRoute,
  InfiltrationWaypoint,
  InterceptionSuggestion,
  TacticalSandboxUnit,
} from '../types/tacticalSandbox';
import { destinationPoint } from './radarLosEngine';
import { EARTH_RADIUS_METERS } from './radarMath';

/**
 * Tính khoảng cách mặt cong Trái Đất (Haversine formula) giữa 2 toạ độ địa lý
 * - Đầu vào: lat1, lon1, lat2, lon2 (độ)
 * - Đầu ra: Khoảng cách theo mét (m)
 */
export function computeDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Tính góc phương vị từ điểm A đến điểm B (Bearing angle 0° - 360°)
 */
export function computeBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

/**
 * Kết quả phân tích hành lang mù radar
 */
export interface BlindCorridorAnalysis {
  azimuthDeg: number;
  shadowDepthM: number;
  shadowStartM: number;
  maxRangeM: number;
  ray: RayCoverageData;
  meanValleyElevationM: number;
}

/**
 * Quét toàn bộ các tia trong RadarCoverageField để tìm các khe núi có bóng che khuất dài nhất
 * 
 * - Tên tham số: field
 * - Type: RadarCoverageField
 * - Nơi khai báo: src/types/radarCoverage.ts
 * - Ý nghĩa: Single Source of Truth cho vùng phủ radar
 */
export function findDeepestRadarBlindCorridors(
  field: RadarCoverageField,
  minShadowDepthM: number = 3000
): BlindCorridorAnalysis[] {
  if (!field.rays || field.rays.length === 0) return [];

  // Lấy các tia có góc tà thấp nhất (ảnh hưởng mạnh nhất bởi địa hình lách thung lũng)
  const minElev = field.minElevationDeg;
  const lowElevRays = field.rays.filter(
    (r) => Math.abs(r.elevationDeg - minElev) < 0.1
  );
  const targetRays = lowElevRays.length > 0 ? lowElevRays : field.rays;

  const corridors: BlindCorridorAnalysis[] = [];

  for (const ray of targetRays) {
    if (!ray.hasOcclusion && !ray.shadowStartM) continue;

    const shadowStart = ray.shadowStartM ?? ray.visibleEndM;
    const shadowDepth = ray.maxRangeM - shadowStart;

    if (shadowDepth >= minShadowDepthM) {
      // Tính cao độ trung bình đáy thung lũng trong vùng shadow
      const shadowSamples = ray.samples.filter((s) => s.isShadow || !s.isVisible);
      const meanElev =
        shadowSamples.length > 0
          ? shadowSamples.reduce((acc, s) => acc + s.terrainAltM, 0) / shadowSamples.length
          : 0;

      corridors.push({
        azimuthDeg: ray.azimuthDeg,
        shadowDepthM: shadowDepth,
        shadowStartM: shadowStart,
        maxRangeM: ray.maxRangeM,
        ray,
        meanValleyElevationM: meanElev,
      });
    }
  }

  // Sắp xếp giảm dần theo độ sâu của bóng núi (hành lang che chắn tốt nhất)
  return corridors.sort((a, b) => b.shadowDepthM - a.shadowDepthM);
}

/**
 * Tự động sinh quỹ đạo bay luồn lách Nap-of-the-Earth bám đáy thung lũng
 * 
 * Thông số kỹ thuật:
 * - Tên biến: heightAglM
 * - Type: number
 * - Giá trị mặc định: 60 (m)
 * - Ý nghĩa: Độ cao bay bám địa hình chuẩn của UAV/Drone cảm tử để lẩn trốn radar
 * 
 * - Tên biến: targetSpeedMps
 * - Type: number
 * - Giá trị mặc định: 50 (m/s ~ 180 km/h)
 * - Đơn vị: m/s
 */
export function generateInfiltrationRoute(
  field: RadarCoverageField,
  options?: {
    corridorAzimuthDeg?: number;
    targetType?: 'UAV Trinh sát' | 'Drone Cảm tử Kamikaze' | 'Tên lửa Hành trình';
    targetSpeedMps?: number;
    heightAglM?: number;
    deployedUnits?: TacticalSandboxUnit[];
  }
): InfiltrationSimulationRoute | null {
  const corridors = findDeepestRadarBlindCorridors(field, 2000);
  if (corridors.length === 0 && (!field.rays || field.rays.length === 0)) {
    return null;
  }

  // Chọn hành lang mục tiêu: nếu người dùng chỉ định góc phương vị thì dùng, nếu không chọn hành lang sâu nhất
  let selectedCorridor = corridors[0];
  if (options?.corridorAzimuthDeg !== undefined) {
    const matched = corridors.find(
      (c) => Math.abs(c.azimuthDeg - options.corridorAzimuthDeg!) < 5
    );
    if (matched) selectedCorridor = matched;
  }

  const ray = selectedCorridor ? selectedCorridor.ray : field.rays[0];
  if (!ray || !ray.samples || ray.samples.length === 0) return null;

  const heightAglM = options?.heightAglM ?? 60;
  const targetSpeedMps = options?.targetSpeedMps ?? 50;
  const targetType = options?.targetType ?? 'Drone Cảm tử Kamikaze';
  const deployedUnits = options?.deployedUnits ?? [];

  // Lấy các mẫu từ ngoài tầm xa vào gần đài radar (xâm nhập theo chiều ngược lại)
  // Lọc mẫu từ khoảng 85% cự ly tối đa vào tới cách đài 1.5km
  const validSamples = ray.samples
    .filter((s) => s.distanceM >= 1500 && s.distanceM <= ray.maxRangeM * 0.9)
    .sort((a, b) => b.distanceM - a.distanceM); // Xếp từ xa lại gần

  if (validSamples.length < 3) return null;

  // Tạo đường bay mềm lượn sóng men theo khe núi (thêm dao động phương vị nhỏ +/- 1.5 độ để mô phỏng lượn cua thực tế)
  const waypoints: InfiltrationWaypoint[] = [];
  const totalSamples = validSamples.length;

  for (let i = 0; i < totalSamples; i++) {
    const s = validSamples[i];
    // Hiệu ứng lượn lách nhẹ theo thung lũng (sin wave nhỏ)
    const weaveOffsetDeg = Math.sin((i / totalSamples) * Math.PI * 4) * 1.8;
    const actualAzimuth = (ray.azimuthDeg + weaveOffsetDeg + 360) % 360;

    const pt = destinationPoint(field.radarLat, field.radarLon, s.distanceM, actualAzimuth);
    const altitudeM = Math.max(0, s.terrainAltM) + heightAglM;

    // Kiểm tra che khuất radar
    const isCoveredByRadar = s.isVisible;

    // Kiểm tra đón lõng bởi các tổ hỏa lực đã triển khai
    let isCoveredByInterception = false;
    let interceptedByUnitId: string | undefined = undefined;

    for (const unit of deployedUnits) {
      const distToUnit = computeDistanceMeters(pt.lat, pt.lon, unit.latitude, unit.longitude);
      const relAlt = altitudeM - unit.altitudeM;

      // Độ cao trong tầm khống chế hỏa lực:
      // - Mục tiêu cao hơn bệ phóng: relAlt >= minHeightM và relAlt <= maxHeightM
      // - Bệ phóng trên đỉnh núi/sườn cao khống chế mục tiêu bay dưới thung lũng: relAlt < 0 và độ chênh cao <= 1500m
      const isAltInRange =
        (relAlt >= 0 && relAlt <= unit.maxHeightM && relAlt >= unit.minHeightM) ||
        (relAlt < 0 && Math.abs(relAlt) <= Math.min(1500, unit.maxHeightM));

      if (distToUnit <= unit.rangeM && isAltInRange) {
        isCoveredByInterception = true;
        interceptedByUnitId = unit.id;
        break;
      }
    }

    waypoints.push({
      lat: pt.lat,
      lon: pt.lon,
      altitudeM,
      heightAglM,
      isCoveredByRadar,
      isCoveredByInterception,
      interceptedByUnitId,
      distanceFromRadarM: s.distanceM,
    });
  }

  // Tính tổng quãng đường bay
  let totalDistanceM = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    totalDistanceM += computeDistanceMeters(
      waypoints[i].lat,
      waypoints[i].lon,
      waypoints[i + 1].lat,
      waypoints[i + 1].lon
    );
  }

  // Tỷ lệ bị phát hiện và bị đón lõng
  const detectedPoints = waypoints.filter((w) => w.isCoveredByRadar).length;
  const interceptedPoints = waypoints.filter((w) => w.isCoveredByInterception).length;
  const detectedRatio = Math.round((detectedPoints / waypoints.length) * 100);
  const interceptedRatio = Math.round((interceptedPoints / waypoints.length) * 100);

  const route: InfiltrationSimulationRoute = {
    id: `route_${ray.azimuthDeg.toFixed(0)}_${Date.now()}`,
    name: `Đường bay luồn lách Hướng ${ray.azimuthDeg.toFixed(0)}°`,
    targetType,
    targetSpeedMps,
    waypoints,
    currentProgress: 0,
    status: waypoints[0]?.isCoveredByInterception
      ? 'intercepted'
      : waypoints[0]?.isCoveredByRadar
      ? 'detected'
      : 'stealth',
    currentPosition: waypoints[0]
      ? { lat: waypoints[0].lat, lon: waypoints[0].lon, altM: waypoints[0].altitudeM }
      : undefined,
    totalDistanceM,
    detectedRatioPercent: detectedRatio,
    interceptedRatioPercent: interceptedRatio,
  };

  return route;
}

/**
 * Đánh giá lại toàn bộ đường bay khi người chỉ huy bổ sung hoặc gỡ bỏ các tổ hỏa lực đón lõng
 */
export function evaluateRouteInterception(
  route: InfiltrationSimulationRoute,
  deployedUnits: TacticalSandboxUnit[]
): InfiltrationSimulationRoute {
  let interceptedCount = 0;
  let detectedCount = 0;

  const updatedWaypoints = route.waypoints.map((wp) => {
    let isCoveredByInterception = false;
    let interceptedByUnitId: string | undefined = undefined;

    for (const unit of deployedUnits) {
      const distToUnit = computeDistanceMeters(wp.lat, wp.lon, unit.latitude, unit.longitude);
      const relAlt = wp.altitudeM - unit.altitudeM;

      // Độ cao trong tầm khống chế hỏa lực:
      // - Mục tiêu cao hơn bệ phóng: relAlt >= minHeightM và relAlt <= maxHeightM
      // - Bệ phóng trên đỉnh núi/sườn cao khống chế mục tiêu bay dưới thung lũng: relAlt < 0 và độ chênh cao <= 1500m
      const isAltInRange =
        (relAlt >= 0 && relAlt <= unit.maxHeightM && relAlt >= unit.minHeightM) ||
        (relAlt < 0 && Math.abs(relAlt) <= Math.min(1500, unit.maxHeightM));

      if (distToUnit <= unit.rangeM && isAltInRange) {
        isCoveredByInterception = true;
        interceptedByUnitId = unit.id;
        break;
      }
    }

    if (isCoveredByInterception) interceptedCount++;
    if (wp.isCoveredByRadar) detectedCount++;

    return {
      ...wp,
      isCoveredByInterception,
      interceptedByUnitId,
    };
  });

  const total = updatedWaypoints.length || 1;
  const interceptedRatioPercent = Math.round((interceptedCount / total) * 100);
  const detectedRatioPercent = Math.round((detectedCount / total) * 100);

  // Cập nhật trạng thái tại vị trí hiện tại
  const currIndex = Math.min(
    Math.floor(route.currentProgress * (total - 1)),
    total - 1
  );
  const currentWp = updatedWaypoints[currIndex];
  const status = currentWp?.isCoveredByInterception
    ? 'intercepted'
    : currentWp?.isCoveredByRadar
    ? 'detected'
    : 'stealth';

  return {
    ...route,
    waypoints: updatedWaypoints,
    interceptedRatioPercent,
    detectedRatioPercent,
    status,
  };
}

/**
 * Tính toán vị trí nội suy 3D của UAV theo tiến độ mô phỏng (0.0 -> 1.0)
 */
export function getUavPositionAtProgress(
  route: InfiltrationSimulationRoute,
  progress: number
): {
  lat: number;
  lon: number;
  altM: number;
  headingDeg: number;
  status: 'stealth' | 'detected' | 'intercepted';
} | null {
  if (!route.waypoints || route.waypoints.length === 0) return null;

  const clamped = Math.max(0, Math.min(1, progress));
  const totalSegments = route.waypoints.length - 1;
  if (totalSegments <= 0) {
    const wp = route.waypoints[0];
    return {
      lat: wp.lat,
      lon: wp.lon,
      altM: wp.altitudeM,
      headingDeg: 0,
      status: wp.isCoveredByInterception ? 'intercepted' : wp.isCoveredByRadar ? 'detected' : 'stealth',
    };
  }

  const exactIndex = clamped * totalSegments;
  const index = Math.min(Math.floor(exactIndex), totalSegments - 1);
  const t = exactIndex - index;

  const p1 = route.waypoints[index];
  const p2 = route.waypoints[index + 1];

  const lat = p1.lat + (p2.lat - p1.lat) * t;
  const lon = p1.lon + (p2.lon - p1.lon) * t;
  const altM = p1.altitudeM + (p2.altitudeM - p1.altitudeM) * t;
  const headingDeg = computeBearingDeg(p1.lat, p1.lon, p2.lat, p2.lon);

  const status = p2.isCoveredByInterception
    ? 'intercepted'
    : p2.isCoveredByRadar
    ? 'detected'
    : 'stealth';

  return { lat, lon, altM, headingDeg, status };
}

/**
 * AI Tự động đề xuất các Điểm cao Chốt chặn (Tactical AI Co-pilot)
 * Quét các mỏm núi đón đầu tại lối ra của hẻm mù radar để gợi ý bố trí MANPADS / Pháo ZU-23-2
 */
export function generateTacticalAiSuggestions(
  field: RadarCoverageField,
  deployedUnits: TacticalSandboxUnit[]
): InterceptionSuggestion[] {
  const corridors = findDeepestRadarBlindCorridors(field, 2500);
  if (corridors.length === 0) return [];

  const suggestions: InterceptionSuggestion[] = [];

  for (let i = 0; i < Math.min(corridors.length, 3); i++) {
    const corridor = corridors[i];
    const ray = corridor.ray;

    // Vị trí vật cản tạo bóng đổ (Occlusion Point) - chính là mỏm núi khống chế miệng hẻm
    if (ray.occlusionPoint) {
      const occl = ray.occlusionPoint;

      // Kiểm tra xem vị trí này đã có đơn vị nào triển khai chưa (bán kính 1.2km)
      const isAlreadyOccupied = deployedUnits.some(
        (u) => computeDistanceMeters(occl.lat, occl.lon, u.latitude, u.longitude) < 1200
      );

      if (!isAlreadyOccupied) {
        // Gợi ý 1: Đặt tổ MANPADS tại đỉnh sườn đón sóng để bắn đón UAV khi vừa thoát khỏi bóng núi
        suggestions.push({
          id: `sug_manpads_${corridor.azimuthDeg}_${i}`,
          role: 'manpads_igla',
          latitude: occl.lat,
          longitude: occl.lon,
          elevationM: Math.round(occl.terrainAltM),
          reliefM: Math.round(occl.terrainAltM - corridor.meanValleyElevationM),
          slopeDeg: 12.5,
          score: 95 - i * 5,
          reason: `Điểm cao khống chế sườn núi hướng ${corridor.azimuthDeg}°. Bao quát hoàn toàn lối thoát hiểm của thung lũng (độ nhô +${Math.round(occl.terrainAltM - corridor.meanValleyElevationM)}m). Bịt kín tầm thấp 6km.`,
          targetedCorridorAzimuthDeg: corridor.azimuthDeg,
        });

        // Gợi ý 2: Đặt Đài quan sát mắt lệch sang mỏm núi kế cận (+/- 4 độ)
        const flankBearing = (corridor.azimuthDeg + 4 + 360) % 360;
        const flankPt = destinationPoint(
          field.radarLat,
          field.radarLon,
          Math.max(1000, occl.distanceM * 0.85),
          flankBearing
        );

        suggestions.push({
          id: `sug_op_${corridor.azimuthDeg}_${i}`,
          role: 'visual_observer',
          latitude: flankPt.lat,
          longitude: flankPt.lon,
          elevationM: Math.round(occl.terrainAltM * 0.9),
          reliefM: Math.round(occl.terrainAltM * 0.9 - corridor.meanValleyElevationM),
          slopeDeg: 14.0,
          score: 88 - i * 4,
          reason: `Đài quan sát quang học bổ trợ hướng ${flankBearing.toFixed(0)}°. Bù đắp góc nhìn thẳng vào lòng khe núi che khuất cho đài radar chính.`,
          targetedCorridorAzimuthDeg: corridor.azimuthDeg,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Tự động sinh tuyến bay luồn lách khe núi mẫu Nap-of-the-Earth
 * Dùng khi chưa có dữ liệu trường radar (coverageField) hoặc khi mở Sa bàn 3D lần đầu
 */
export function generateDefaultNapOfTheEarthRoute(
  centerLat: number = 21.458,
  centerLon: number = 105.645,
  options?: {
    deployedUnits?: TacticalSandboxUnit[];
    targetSpeedMps?: number;
    heightAglM?: number;
    targetType?: 'UAV Trinh sát' | 'Drone Cảm tử Kamikaze' | 'Tên lửa Hành trình';
  }
): InfiltrationSimulationRoute {
  const targetSpeedMps = options?.targetSpeedMps ?? 50;
  const heightAglM = options?.heightAglM ?? 60;
  const targetType = options?.targetType ?? 'Drone Cảm tử Kamikaze';
  const deployedUnits = options?.deployedUnits ?? [];

  // Tạo 12 điểm bay từ phía Tây Bắc (~320°) tiến dần về trung tâm trận địa (từ cự ly 12.5km về 1.2km)
  const waypoints: InfiltrationWaypoint[] = [];
  const totalPoints = 12;
  const baseAzimuth = 320;
  let cumDistanceM = 0;

  for (let i = 0; i < totalPoints; i++) {
    const fraction = i / (totalPoints - 1); // 0 (xa nhất) -> 1 (gần nhất)
    const distanceM = 12500 - fraction * 11200; // 12500m -> 1300m
    // Lượn lách sin wave +/- 2.8 độ qua các hẻm núi
    const weaveDeg = Math.sin(fraction * Math.PI * 3.5) * 2.8;
    const azimuth = (baseAzimuth + weaveDeg + 360) % 360;

    const pt = destinationPoint(centerLat, centerLon, distanceM, azimuth);
    // Cao độ lượn theo sườn dốc địa hình (từ 240m lên đèo 460m rồi xuôi thung lũng 320m)
    const terrainM = 240 + Math.sin(fraction * Math.PI) * 220;
    const altitudeM = Math.round(terrainM + heightAglM);

    if (i > 0) {
      const prev = waypoints[i - 1];
      cumDistanceM += computeDistanceMeters(prev.lat, prev.lon, pt.lat, pt.lon);
    }

    // Nửa chặng đầu ẩn náu khe núi (stealth), nửa chặng sau lọt vào tầm radar
    const isCoveredByRadar = fraction > 0.55;

    // Kiểm tra đón lõng bởi các đơn vị đã bố trí
    let isCoveredByInterception = false;
    let interceptedByUnitId: string | undefined = undefined;

    for (const unit of deployedUnits) {
      const dist = computeDistanceMeters(pt.lat, pt.lon, unit.latitude, unit.longitude);
      const relAlt = altitudeM - unit.altitudeM;
      const isAltInRange =
        (relAlt >= 0 && relAlt <= unit.maxHeightM && relAlt >= unit.minHeightM) ||
        (relAlt < 0 && Math.abs(relAlt) <= Math.min(1500, unit.maxHeightM));

      if (dist <= unit.rangeM && isAltInRange) {
        isCoveredByInterception = true;
        interceptedByUnitId = unit.id;
        break;
      }
    }

    waypoints.push({
      lat: pt.lat,
      lon: pt.lon,
      altitudeM,
      heightAglM,
      distanceFromRadarM: distanceM,
      isCoveredByRadar,
      isCoveredByInterception,
      interceptedByUnitId,
    });
  }

  const detectedCount = waypoints.filter((w) => w.isCoveredByRadar).length;
  const interceptedCount = waypoints.filter((w) => w.isCoveredByInterception).length;

  const initialStatus = waypoints[0]?.isCoveredByInterception
    ? 'intercepted'
    : waypoints[0]?.isCoveredByRadar
    ? 'detected'
    : 'stealth';

  return {
    id: `route_default_${Date.now()}`,
    name: 'Tuyến đột kích Hẻm Tây Bắc (Nap-of-the-Earth)',
    targetType,
    targetSpeedMps,
    totalDistanceM: Math.round(cumDistanceM),
    waypoints,
    currentProgress: 0,
    status: initialStatus,
    detectedRatioPercent: Math.round((detectedCount / waypoints.length) * 100),
    interceptedRatioPercent: Math.round((interceptedCount / waypoints.length) * 100),
    currentPosition: waypoints[0]
      ? { lat: waypoints[0].lat, lon: waypoints[0].lon, altM: waypoints[0].altitudeM }
      : undefined,
  };
}
