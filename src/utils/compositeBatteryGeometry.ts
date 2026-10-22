import type {
  CompositeBatteryConfig,
  CompositeBatteryState,
  CompositeLauncherItem,
} from '../types/equipment';
import { destinationPoint } from './radarLosEngine';
import { EARTH_RADIUS_METERS } from './radarMath';

/**
 * Cấu hình độ trong suốt (Alpha) và màu sắc phân tầng chuẩn tác chiến phòng không
 * Giải quyết triệt để Z-Fighting và lóa màu khi bật đồng thời 3 lớp vòm lồng vào nhau:
 * - Vòm TAR (Xanh dương): Bao quát rộng nhất, nhẹ nhất (alpha 0.10)
 * - Vòm FCR (Cam): Quạt bám bắt dẫn bắn, vừa phải (alpha 0.18)
 * - Vùng Hỏa Lực WEZ (Đỏ đậm): Nổi bật nhất (alpha 0.36) kèm viền nét trần H_max và lõi rỗng R_min
 */
export const COMPOSITE_DOME_STYLES = {
  tar: {
    colorHex: '#0ea5e9', // Xanh dương Sky Blue chuẩn Radar chỉ thị mục tiêu TAR
    alpha: 0.12,
    outlineColorHex: '#38bdf8',
    outlineAlpha: 0.65,
  },
  fcr: {
    colorHex: '#f97316', // Orange (Đã deprecated cho render trực tiếp, thông số FCR chuyển sang cắt trực tiếp Vòm WEZ)
    alpha: 0.18,
    outlineColorHex: '#fb923c',
    outlineAlpha: 0.65,
  },
  wez: {
    colorHex: '#ef4444', // Red (Vùng hỏa lực tiêu diệt WEZ, co theo góc quạt khi ở Sector mode)
    alpha: 0.38,
    outlineColorHex: '#f87171',
    outlineAlpha: 0.85,
    launchBoundaryColorHex: '#dc2626', // Vòng đón R_launch_max
  },
};

/**
 * Tính khoảng cách mặt cầu (m) và phương vị (độ) giữa hai điểm tọa độ
 */
export function calculateDistanceAndBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { distanceM: number; bearingDeg: number } {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  // Haversine formula
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceM = EARTH_RADIUS_METERS * c;

  // Bearing formula
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  let bearingDeg = (Math.atan2(y, x) * 180) / Math.PI;
  bearingDeg = (bearingDeg + 360) % 360;

  return { distanceM, bearingDeg };
}

/**
 * Sinh danh sách 4 Bệ phóng ban đầu xung quanh vị trí Tâm Tổ Hợp
 * Bố trí góc phương vị chuẩn trận địa: 45°, 135°, 225°, 315°
 */
export function generateInitialLaunchers(
  centerLat: number,
  centerLon: number,
  centerAlt: number,
  batteryConfig: CompositeBatteryConfig
): CompositeLauncherItem[] {
  const launcherCount = batteryConfig.launcherCount || 4;
  const dist = batteryConfig.defaultLauncherDistanceM || 100;
  // Bố trí góc phương vị chuẩn trận địa quân sự:
  // - 3 bệ phóng (C-125M / C-125-2TM): Bố trí tam giác đều 0°, 120°, 240° quanh đài điều khiển
  // - 4 bệ phóng (S-300): 45°, 135°, 225°, 315°
  // - 6 bệ phóng (SPYDER SR/MR): Bố trí 6 hướng 60°, 120°, 180°, 240°, 300°, 360° (0°)
  const azimuths = launcherCount === 3 
    ? [0, 120, 240] 
    : launcherCount === 4 
      ? [45, 135, 225, 315] 
      : launcherCount === 6
        ? [60, 120, 180, 240, 300, 360]
        : Array.from({ length: launcherCount }, (_, i) => Math.round((i * 360) / launcherCount));

  const isSpyder = batteryConfig.batteryType.includes('SPYDER');
  const launchers: CompositeLauncherItem[] = [];

  for (let i = 0; i < launcherCount; i++) {
    const bearing = azimuths[i % azimuths.length];
    const dest = destinationPoint(centerLat, centerLon, dist, bearing);

    let launcherName = `${batteryConfig.launcherName} #${i + 1}`;
    if (isSpyder && launcherCount === 6) {
      if (i < 3) {
        launcherName = `Xe bệ phóng MFU-MR #${i + 1} (8 đạn Derby/Python-5 MR)`;
      } else {
        launcherName = `Xe bệ phóng MFU-SR #${i + 1} (4 đạn Python-5/Derby SR)`;
      }
    }

    launchers.push({
      id: `launcher_${i + 1}`,
      index: i + 1,
      name: launcherName,
      latitude: dest.lat,
      longitude: dest.lon,
      altitude: centerAlt, // Tạm thời dùng độ cao của tâm đài
      distanceToCenterM: dist,
      bearingFromCenterDeg: bearing,
      isValid: true,
    });
  }

  return launchers;
}

/**
 * Tự động đồng bộ tính toán lại vị trí (lat, lon) của cả 4 bệ phóng khi di chuyển Tâm Tổ Hợp
 * Bảo toàn cự ly distanceToCenterM và bearingFromCenterDeg của từng bệ phóng
 */
export function recalculateLaunchersFromCenter(
  centerLat: number,
  centerLon: number,
  centerAlt: number,
  currentLaunchers: CompositeLauncherItem[],
  batteryConfig: CompositeBatteryConfig
): CompositeLauncherItem[] {
  return currentLaunchers.map((launcher) => {
    const dest = destinationPoint(
      centerLat,
      centerLon,
      launcher.distanceToCenterM,
      launcher.bearingFromCenterDeg
    );

    // Kiểm tra ràng buộc cự ly cáp
    const isCableValid = launcher.distanceToCenterM <= batteryConfig.maxCableDistanceM;
    let warningMessage: string | undefined;
    if (!isCableValid) {
      warningMessage = `Vượt cự ly cáp cho phép (${launcher.distanceToCenterM.toFixed(0)}m > ${batteryConfig.maxCableDistanceM}m)!`;
    }

    return {
      ...launcher,
      latitude: dest.lat,
      longitude: dest.lon,
      altitude: centerAlt, // Sẽ được cập nhật chính xác qua terrainProvider nếu có
      isValid: isCableValid,
      warningMessage,
    };
  });
}

/**
 * Kiểm tra đường ngắm thẳng (Line-of-Sight - LOS) giữa Đài Dẫn Bắn FCR và Bệ phóng
 * Đỉnh ăng-ten FCR: centerGroundAltM + antennaHeightAGL
 * Điểm thu bắt đạn phía trên bệ phóng: launcherGroundAltM + 25m
 * @param fcrAltM Độ cao mặt đất tại tâm đài FCR (m)
 * @param fcrAntennaHeightAGL Chiều cao cột ăng-ten đài FCR (m)
 * @param launcherAltM Độ cao mặt đất tại bệ phóng (m)
 * @param intermediateHeights Mảng độ cao địa hình lấy mẫu tại các điểm trung gian dọc tuyến nối (m)
 */
export function checkLauncherLineOfSight(
  fcrAltM: number,
  fcrAntennaHeightAGL: number,
  launcherAltM: number,
  intermediateHeights: number[]
): { isValid: boolean; warningMessage?: string } {
  if (!intermediateHeights || intermediateHeights.length === 0) {
    return { isValid: true };
  }

  const hFcrTop = fcrAltM + fcrAntennaHeightAGL;
  const hLauncherTarget = launcherAltM + 25; // Điểm bắt đạn cao 25m phía trên bệ
  const n = intermediateHeights.length;

  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const hRay = (1 - t) * hFcrTop + t * hLauncherTarget;
    const hTerrain = intermediateHeights[i];

    // Nếu sườn đồi núi cao hơn đường ngắm thẳng (cho biên độ đệm 0.5m)
    if (hTerrain > hRay + 0.5) {
      return {
        isValid: false,
        warningMessage: 'Bị địa hình đồi núi che khuất sóng điều khiển từ đài FCR!',
      };
    }
  }

  return { isValid: true };
}

/**
 * Cập nhật vị trí khi người dùng kéo thả trực tiếp 1 bệ phóng đơn lẻ trên bản đồ
 */
export function updateSingleLauncherPosition(
  centerLat: number,
  centerLon: number,
  launcherId: string,
  newLat: number,
  newLon: number,
  newAlt: number,
  launchers: CompositeLauncherItem[],
  batteryConfig: CompositeBatteryConfig,
  losResult?: { isValid: boolean; warningMessage?: string }
): CompositeLauncherItem[] {
  const { distanceM, bearingDeg } = calculateDistanceAndBearing(
    centerLat,
    centerLon,
    newLat,
    newLon
  );

  return launchers.map((launcher) => {
    if (launcher.id !== launcherId) return launcher;

    const isCableValid = distanceM <= batteryConfig.maxCableDistanceM;
    let isValid = isCableValid;
    let warningMessage: string | undefined;

    if (!isCableValid) {
      warningMessage = `Vượt cự ly cáp cho phép (${distanceM.toFixed(0)}m > ${batteryConfig.maxCableDistanceM}m)!`;
    } else if (losResult && !losResult.isValid) {
      isValid = false;
      warningMessage = losResult.warningMessage;
    }

    return {
      ...launcher,
      latitude: newLat,
      longitude: newLon,
      altitude: newAlt,
      distanceToCenterM: distanceM,
      bearingFromCenterDeg: bearingDeg,
      isValid,
      warningMessage,
    };
  });
}

/**
 * Kiểm tra góc nằm trong dải quạt chiến đấu (Sector)
 */
export function isAzimuthInSector(
  azimuthDeg: number,
  centerAzimuthDeg: number,
  sectorSpanDeg: number
): boolean {
  if (sectorSpanDeg >= 360) return true;
  const halfSpan = sectorSpanDeg / 2;
  let diff = (azimuthDeg - centerAzimuthDeg + 360) % 360;
  if (diff > 180) diff -= 360;
  return Math.abs(diff) <= halfSpan;
}

/**
 * Tạo trạng thái khởi tạo đầy đủ cho Cụm Tổ Hợp SAM
 */
export function createDefaultCompositeBatteryState(
  centerLat: number,
  centerLon: number,
  centerAlt: number,
  batteryConfig: CompositeBatteryConfig
): CompositeBatteryState {
  const launchers = generateInitialLaunchers(centerLat, centerLon, centerAlt, batteryConfig);
  return {
    launchers,
    combatMode: batteryConfig.fcrSectorAngleDeg >= 360 ? 'omnidirectional' : 'sector',
    combatAzimuthDeg: 0, // Mặc định hướng Bắc 0°
    showLayers: {
      tarDome: true, // Vòm TAR (Xanh dương)
      fcrDome: true, // Vòm FCR (Cam)
      wezDome: true, // Vùng Hỏa Lực WEZ (Đỏ)
      launchers: true, // 4 Bệ phóng & cáp
    },
    mastHeightOverrideM: undefined,
  };
}
